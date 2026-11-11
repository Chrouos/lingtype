import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from public_library import PublicLibrary


SCRIPT = Path(__file__).resolve().parent.parent / 'moderate.py'


class ModerationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.library = PublicLibrary(Path(self.folder.name) / 'public.db')
        self.book, self.owner = self.library.publish({'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'測試', 'text':'Hello world.', 'words':[]}})
        self.comment = self.library.add_comment(self.book, 'Reader', 'Text\x1b[31m\u202e')

    def command(self, action, identifier, confirmation=''):
        return subprocess.run([sys.executable, str(SCRIPT), '--data-dir', self.folder.name, action, identifier], input=confirmation, text=True, capture_output=True)

    def test_review_and_confirmation_before_comment_removal(self):
        listed = self.command('list-comments', self.book)
        self.assertEqual(listed.returncode, 0)
        self.assertEqual(json.loads(listed.stdout)[0]['id'], self.comment)
        shown = self.command('show-comment', self.comment)
        self.assertEqual(shown.returncode, 0)
        self.assertNotIn('\x1b', shown.stdout)
        self.assertNotIn('\u202e', shown.stdout)
        self.assertEqual(json.loads(shown.stdout)['id'], self.comment)
        cancelled = self.command('remove-comment', self.comment, 'wrong\n')
        self.assertNotEqual(cancelled.returncode, 0)
        self.assertIsNotNone(self.library.moderation_comment(self.comment))
        removed = self.command('remove-comment', self.comment, self.comment + '\n')
        self.assertEqual(removed.returncode, 0, removed.stderr)
        self.assertIsNone(self.library.moderation_comment(self.comment))
        self.assertIsNotNone(self.library.get(self.book))

    def test_remove_book_cleans_dependents_and_updates_quota(self):
        self.library.set_like(self.book, 'a' * 32, True)
        self.library.record_visit(self.book, 'a' * 32, 'reads')
        self.library.record_attempt(self.book, 'Reader', 30, 100, 'a' * 32)
        other, _ = self.library.publish({'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'Other', 'text':'Another.', 'words':[]}})
        result = self.command('remove-book', self.book, self.book + '\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(self.library.get(self.book))
        self.assertIsNotNone(self.library.get(other))
        with sqlite3.connect(self.library.path) as db:
            for table in ('likes', 'comments', 'attempts', 'covers', 'reads', 'starts'):
                self.assertEqual(db.execute(f'SELECT COUNT(*) FROM {table} WHERE book_id = ?', (self.book,)).fetchone()[0], 0)
            self.assertGreater(db.execute('SELECT bytes FROM content_usage').fetchone()[0], 0)

    def test_changed_record_is_not_removed(self):
        record = self.library.moderation_comment(self.comment)
        with sqlite3.connect(self.library.path) as db:
            db.execute('UPDATE comments SET text = ? WHERE id = ?', ('Changed', self.comment))
        self.assertFalse(self.library.moderation_remove_comment(record))
        book = self.library.moderation_book(self.book)
        with sqlite3.connect(self.library.path) as db:
            db.execute('UPDATE books SET created = ? WHERE id = ?', ('Changed', self.book))
        self.assertFalse(self.library.moderation_remove_book(book))
        self.assertIsNotNone(self.library.get(self.book))

    def test_book_removal_rolls_back_if_dependent_deletion_fails(self):
        record = self.library.moderation_book(self.book)
        with sqlite3.connect(self.library.path) as db:
            db.execute("CREATE TRIGGER fail_comment_delete BEFORE DELETE ON comments BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.library.moderation_remove_book(record)
        self.assertIsNotNone(self.library.get(self.book))
        self.assertIsNotNone(self.library.moderation_comment(self.comment))

    def test_missing_database_is_not_created(self):
        missing = Path(self.folder.name) / 'missing'
        result = subprocess.run([sys.executable, str(SCRIPT), '--data-dir', str(missing), 'show-book', self.book], text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(missing.exists())


if __name__ == '__main__':
    unittest.main()
