import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from PIL import Image

from public_library import PublicLibrary


def workbook():
    return {'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'A story', 'text':'Hello world.', 'words':[], 'translations':{}}}


class CommunityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'library.db'
        self.library = PublicLibrary(self.path)
        self.book, self.owner = self.library.publish(workbook())

    def test_likes_are_idempotent_and_persist(self):
        self.assertEqual(self.library.set_like(self.book, 'a' * 32, True), 1)
        self.assertEqual(self.library.set_like(self.book, 'a' * 32, True), 1)
        self.assertEqual(self.library.set_like(self.book, 'b' * 32, True), 2)
        self.assertEqual(PublicLibrary(self.path).community(self.book, 'a' * 32)['likes'], 2)
        self.assertTrue(self.library.community(self.book, 'a' * 32)['liked'])
        self.assertEqual(self.library.set_like(self.book, 'a' * 32, False), 1)

    def test_comments_validate_and_owner_can_remove(self):
        comment = self.library.add_comment(self.book, '讀者', '<hello>')
        self.assertEqual(self.library.community(self.book)['comments'][0]['text'], '<hello>')
        self.assertFalse(self.library.remove_comment(self.book, comment, 'wrong'))
        self.assertTrue(self.library.remove_comment(self.book, comment, self.owner))
        with self.assertRaises(ValueError): self.library.add_comment(self.book, '', ' ')
        with self.assertRaises(ValueError): self.library.add_comment(self.book, '', 'x' * 1001)

    def test_missing_book_and_invalid_visitor_rejected(self):
        with self.assertRaises(ValueError): self.library.set_like('f' * 32, 'a' * 32, True)
        with self.assertRaises(ValueError): self.library.set_like(self.book, 'invalid', True)

    def test_completed_attempts_are_counted_and_ranked(self):
        self.library.record_attempt(self.book, 'Reader', 42.5, 95)
        self.library.record_attempt(self.book, '', 55, 100)
        info = PublicLibrary(self.path).community(self.book)
        self.assertEqual(info['practiceCount'], 2)
        self.assertEqual(info['ranking'][0]['wpm'], 55)
        self.assertEqual(info['ranking'][0]['author'], '匿名讀者')
        with self.assertRaises(ValueError): self.library.record_attempt(self.book, '', -1, 100)
        with self.assertRaises(ValueError): self.library.record_attempt(self.book, '', 10, 101)
        with self.assertRaises(ValueError): self.library.record_attempt(self.book, '', 251, 100)

    def test_cover_validates_image_and_owner(self):
        image = BytesIO()
        Image.new('RGB', (3, 4), 'red').save(image, 'PNG')
        with self.assertRaises(ValueError): self.library.set_cover(self.book, self.owner, b'not an image')
        self.assertFalse(self.library.set_cover(self.book, 'wrong', image.getvalue()))
        self.assertTrue(self.library.set_cover(self.book, self.owner, image.getvalue()))
        content_type, content = PublicLibrary(self.path).get_cover(self.book)
        self.assertEqual(content_type, 'image/png')
        self.assertEqual(content, image.getvalue())

    def test_reads_starts_and_completion_rate_count_each_reader_once(self):
        a, b, c = 'a' * 32, 'b' * 32, 'c' * 32
        self.assertEqual(self.library.record_visit(self.book, a, 'reads'), 1)
        self.assertEqual(self.library.record_visit(self.book, a, 'reads'), 1)
        self.library.record_visit(self.book, b, 'reads')
        for visitor in (a, b, c): self.library.record_visit(self.book, visitor, 'starts')
        self.library.record_visit(self.book, a, 'starts')
        self.library.record_attempt(self.book, 'A', 40, 90, a)
        self.library.record_attempt(self.book, 'A', 50, 95, a)
        info = PublicLibrary(self.path).community(self.book)
        self.assertEqual((info['reads'], info['starts'], info['completions'], info['completionRate']), (2, 3, 1, 33))
        self.assertEqual(len(info['ranking']), 1, 'one reader appears once, with their best run')
        self.assertEqual(info['ranking'][0]['wpm'], 50)
        with self.assertRaises(ValueError): self.library.record_visit(self.book, 'bad', 'reads')
        with self.assertRaises(ValueError): self.library.record_visit(self.book, a, 'likes')
        with self.assertRaises(ValueError): self.library.record_visit('f' * 32, a, 'reads')
        with self.assertRaises(ValueError): self.library.record_attempt(self.book, '', 10, 50, 'bad')

    def test_finishing_without_a_recorded_start_still_counts_as_started(self):
        self.library.record_attempt(self.book, '', 30, 90, 'd' * 32)
        self.assertEqual(self.library.community(self.book)['completionRate'], 100)

    def test_shelf_lists_numbers_ranking_and_recent_comments(self):
        other, _ = self.library.publish({'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'Second', 'text':'Two  words\nhere.', 'category':'旅行', 'words':[]}})
        self.library.set_like(other, 'a' * 32, True)
        self.library.record_visit(other, 'a' * 32, 'reads')
        self.library.record_attempt(other, 'Fast', 70, 99, 'a' * 32)
        self.library.record_attempt(self.book, 'Slow', 20, 80)
        self.library.add_comment(other, 'Reader', 'Nice')
        shelf = self.library.shelf()
        second = next(book for book in shelf['books'] if book['id'] == other)
        self.assertEqual((second['likes'], second['reads'], second['completions'], second['comments'], second['category'], second['words'], second['summary']), (1, 1, 1, 1, '旅行', 3, 'Two words here.'))
        self.assertFalse(second['hasCover'])
        first = next(book for book in shelf['books'] if book['id'] == self.book)
        self.assertIsNone(first['completionRate'])
        self.assertEqual([(r['author'], r['title']) for r in shelf['ranking']], [('Fast', 'Second'), ('Slow', 'A story')])
        self.assertEqual(shelf['comments'][0]['title'], 'Second')

    def test_older_databases_gain_summaries_and_attempt_readers(self):
        import sqlite3
        from contextlib import closing
        path = Path(self.tmp.name) / 'old.db'
        with closing(sqlite3.connect(path)) as db, db:
            db.execute('CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL, owner_hash TEXT)')
            db.execute('CREATE TABLE attempts (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, author TEXT NOT NULL, wpm REAL NOT NULL, accuracy REAL NOT NULL, created TEXT NOT NULL)')
            db.execute("INSERT INTO books VALUES ('e' || hex(randomblob(15)), 'Old', '2026-01-01', ?, NULL)", ('{"format":"lingtype-workbook","version":1,"lesson":{"title":"Old","text":"An old story.","words":[]}}',))
            db.execute("INSERT INTO attempts VALUES ('x', (SELECT id FROM books), 'Past', 30, 90, '2026-01-02')")
        library = PublicLibrary(path)
        book = library.list_books()[0]
        self.assertEqual((book['summary'], book['words'], book['practiceCount']), ('An old story.', 3, 1))
        self.assertEqual(library.community(book['id'])['ranking'][0]['author'], 'Past')

if __name__ == '__main__': unittest.main()
