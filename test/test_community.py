import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from PIL import Image

from public_library import PublicLibrary, CommentRemovedError, _search_terms


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

    def test_comment_retries_are_idempotent_and_cannot_replace_another_comment(self):
        comment_id = 'c' * 32
        self.assertEqual(self.library.add_comment(self.book, ' Reader ', ' Hello ', comment_id), comment_id)
        self.assertEqual(self.library.add_comment(self.book, 'Reader', 'Hello', comment_id), comment_id)
        self.assertEqual(len(self.library.community(self.book)['comments']), 1)
        with self.assertRaises(ValueError): self.library.add_comment(self.book, 'Reader', 'Changed', comment_id)
        other, _ = self.library.publish(workbook())
        with self.assertRaises(ValueError): self.library.add_comment(other, 'Reader', 'Hello', comment_id)
        self.library.add_comment(self.book, 'Reader', 'Hello', 'd' * 32)
        self.assertEqual(len(self.library.community(self.book)['comments']), 2)
        with self.assertRaises(ValueError): self.library.add_comment(self.book, '', 'Hello', 'invalid')

    def test_removed_comment_cannot_be_recreated_by_a_delayed_retry(self):
        import sqlite3
        comment_id = 'c' * 32
        self.library.add_comment(self.book, 'Reader', 'Hello', comment_id)
        with sqlite3.connect(self.path) as db:
            used = db.execute('SELECT bytes FROM content_usage WHERE id = 1').fetchone()[0]
        self.library.max_bytes = used
        self.assertTrue(self.library.remove_comment(self.book, comment_id, self.owner), 'deletion succeeds even when quota is full')
        with sqlite3.connect(self.path) as db:
            self.assertLess(db.execute('SELECT bytes FROM content_usage WHERE id = 1').fetchone()[0], used)
        restarted = PublicLibrary(self.path)
        with self.assertRaises(CommentRemovedError): restarted.add_comment(self.book, 'Reader', 'Hello', comment_id)
        self.assertEqual(restarted.community(self.book)['comments'], [])
        self.assertEqual(restarted.add_comment(self.book, 'Reader', 'Hello', 'd' * 32), 'd' * 32)

    def test_moderation_and_book_removal_keep_deleted_ids_from_returning(self):
        import sqlite3
        comment_id = 'e' * 32
        self.library.add_comment(self.book, '', 'Hello', comment_id)
        self.assertTrue(self.library.moderation_remove_comment(self.library.moderation_comment(comment_id)))
        with self.assertRaises(CommentRemovedError): self.library.add_comment(self.book, '', 'Hello', comment_id)
        another_id = 'f' * 32
        self.library.add_comment(self.book, '', 'Another', another_id)
        with sqlite3.connect(self.path) as db:
            used = db.execute('SELECT bytes FROM content_usage WHERE id = 1').fetchone()[0]
        self.library.max_bytes = used
        self.assertTrue(self.library.moderation_remove_book(self.library.moderation_book(self.book)))
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM retired_comments WHERE book_id = ?', (self.book,)).fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM retired_books WHERE id = ?', (self.book,)).fetchone()[0], 1)
            self.assertLess(db.execute('SELECT bytes FROM content_usage WHERE id = 1').fetchone()[0], used)
        with self.assertRaisesRegex(ValueError, '已下架'):
            self.library.publish(workbook(), self.book, 'a' * 64)
        new_book, _ = self.library.publish(workbook())
        self.assertNotEqual(new_book, self.book)

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

    def test_publishing_counts_existing_covers_toward_capacity(self):
        image = BytesIO()
        Image.new('RGB', (3, 4), 'red').save(image, 'PNG')
        self.library.set_cover(self.book, self.owner, image.getvalue())
        import json
        payload_size = len(json.dumps(workbook(), ensure_ascii=False, allow_nan=False).encode('utf-8'))
        self.library.max_bytes = payload_size * 2 + len(image.getvalue()) - 1
        with self.assertRaisesRegex(ValueError, '儲存空間已滿'):
            self.library.publish(workbook())
        self.assertEqual(len(self.library.list_books()), 1)

    def test_capacity_includes_community_data_and_reclaims_deleted_content(self):
        import sqlite3
        visitor = 'a' * 32
        self.library.record_visit(self.book, visitor, 'reads')
        self.library.record_visit(self.book, visitor, 'starts')
        self.library.set_like(self.book, visitor, True)
        comment = self.library.add_comment(self.book, '讀者', '你好')
        self.library.record_attempt(self.book, '讀者', 30, 100, visitor, 'b' * 32)
        with sqlite3.connect(self.path) as db:
            used = db.execute('SELECT bytes FROM content_usage WHERE id = 1').fetchone()[0]
        self.library.max_bytes = used
        # Retrying an existing record consumes no extra quota.
        self.library.record_visit(self.book, visitor, 'reads')
        self.library.set_like(self.book, visitor, True)
        self.library.record_attempt(self.book, '讀者', 30, 100, visitor, 'b' * 32)
        for action in (
            lambda: self.library.record_visit(self.book, 'c' * 32, 'reads'),
            lambda: self.library.record_visit(self.book, 'c' * 32, 'starts'),
            lambda: self.library.set_like(self.book, 'c' * 32, True),
            lambda: self.library.add_comment(self.book, '', '新留言'),
            lambda: self.library.record_attempt(self.book, '', 40, 99, 'c' * 32),
            lambda: self.library.publish(workbook()),
        ):
            with self.assertRaisesRegex(ValueError, '儲存空間已滿'): action()
        self.assertTrue(self.library.remove_comment(self.book, comment, self.owner))
        self.library.set_like(self.book, visitor, False)
        self.library.add_comment(self.book, 'R', '新')
        with sqlite3.connect(self.path) as db:
            self.assertLess(db.execute('SELECT bytes FROM content_usage WHERE id = 1').fetchone()[0], used)

    def test_capacity_migration_counts_existing_community_data(self):
        import sqlite3
        self.library.add_comment(self.book, '讀者', '既有留言')
        with sqlite3.connect(self.path) as db:
            expected = db.execute('SELECT bytes FROM content_usage WHERE id = 1').fetchone()[0]
            for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'usage_%'").fetchall():
                db.execute(f'DROP TRIGGER {name}')
            db.execute('DROP TABLE content_usage')
        migrated = PublicLibrary(self.path, max_bytes=expected)
        with self.assertRaisesRegex(ValueError, '儲存空間已滿'):
            migrated.add_comment(self.book, '', '新留言')
        self.assertTrue(migrated.unpublish(self.book, self.owner))
        self.assertTrue(migrated.publish(workbook()))

    def test_shelf_indexes_avoid_sorting_all_comments_and_grouping_all_attempts(self):
        import sqlite3
        with sqlite3.connect(self.path) as db:
            comments = db.execute('EXPLAIN QUERY PLAN SELECT c.author, c.text, c.created, c.book_id, b.title FROM comments c JOIN books b ON b.id = c.book_id ORDER BY c.created DESC LIMIT 5').fetchall()
            ranking = db.execute("""EXPLAIN QUERY PLAN SELECT a.author, MAX(a.wpm), a.accuracy, a.book_id, b.title
                FROM attempts a JOIN books b ON b.id = a.book_id WHERE a.ranked = 1
                GROUP BY a.book_id, CASE WHEN a.visitor != '' THEN a.visitor ELSE a.id END
                ORDER BY MAX(a.wpm) DESC, a.created ASC LIMIT 10""").fetchall()
        comments_plan = ' '.join(row[3] for row in comments)
        ranking_plan = ' '.join(row[3] for row in ranking)
        self.assertIn('comments_created', comments_plan)
        self.assertNotIn('TEMP B-TREE FOR ORDER BY', comments_plan)
        self.assertIn('attempts_ranked_reader', ranking_plan)
        self.assertNotIn('TEMP B-TREE FOR GROUP BY', ranking_plan)

    def test_shelf_includes_books_older_than_latest_hundred(self):
        for _ in range(100):
            self.library.publish(workbook())
        pages = [self.library.shelf(page=page) for page in range(1, 6)]
        self.assertEqual(pages[0]['total'], 101)
        self.assertTrue(all(len(page['books']) <= 24 for page in pages))
        self.assertIn(self.book, [book['id'] for page in pages for book in page['books']])

    def test_shelf_filters_and_sorts_before_pagination(self):
        for index in range(30):
            self.library.publish({'format':'lingtype-workbook', 'version':1, 'lesson':{'title':f'Other {index}', 'text':'text', 'category':'misc', 'words':[]}})
        target, _ = self.library.publish({'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'Café 100%_Story', 'text':'A train at night', 'category':'旅行', 'words':[]}})
        self.library.set_like(self.book, 'a' * 32, True)
        match = self.library.shelf(query='CAFÉ %_', category='旅行')
        self.assertEqual([book['id'] for book in match['books']], [target])
        self.assertEqual(match['total'], 1)
        self.assertIn('旅行', match['categories'])
        self.assertEqual([book['id'] for book in self.library.shelf(query='hello world')['books']], [self.book])
        self.assertEqual(self.library.shelf(sort='likes')['books'][0]['id'], self.book)
        with self.assertRaises(ValueError): self.library.shelf(page=0)
        with self.assertRaises(ValueError): self.library.shelf(sort='invalid')

    def test_shelf_searches_all_text_before_paginating(self):
        ids = []
        for index in range(26):
            book = {'format':'lingtype-workbook', 'version':1, 'lesson':{
                'title':f'Journey {index}', 'text':'Opening ' * 50 + 'A hidden CAFÉ 100%_treasure.',
                'category':'travel', 'words':[]}}
            ids.append(self.library.publish(book)[0])
        first = self.library.shelf(query='journey café %_treasure', category='travel', sort='new', page=1)
        second = self.library.shelf(query='journey café %_treasure', category='travel', sort='new', page=2)
        self.assertEqual(first['total'], 26)
        self.assertEqual(len(first['books']), 24)
        self.assertEqual(len(second['books']), 2)
        self.assertEqual(set(ids), {book['id'] for page in (first, second) for book in page['books']})
        self.assertEqual(self.library.shelf(query='journey absent')['total'], 0)

        repeated = 'JOURNEY café CAFÉ %_treasure journey %_TREASURE'
        for page, expected in ((1, first), (2, second)):
            actual = self.library.shelf(query=repeated, category='travel', sort='new', page=page)
            self.assertEqual((actual['total'], [book['id'] for book in actual['books']]),
                             (expected['total'], [book['id'] for book in expected['books']]))
        self.assertEqual(self.library.shelf(query='absent absent')['total'], 0)

    def test_search_terms_are_deduplicated_after_case_normalization(self):
        self.assertEqual(_search_terms(' '.join(['X'] * 100)), ['x'])
        self.assertEqual(_search_terms(' Café  CAFÉ %_ %_ word café '), ['café', '%_', 'word'])

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

    def test_retrying_attempt_with_same_id_is_idempotent(self):
        attempt_id, visitor = 'e' * 32, 'a' * 32
        self.library.record_attempt(self.book, 'Reader', 40, 95, visitor, attempt_id)
        self.library.record_attempt(self.book, 'Reader', 40, 95, visitor, attempt_id)
        self.assertEqual(self.library.community(self.book)['practiceCount'], 1)
        with self.assertRaises(ValueError): self.library.record_attempt(self.book, 'Reader', 41, 95, visitor, attempt_id)
        with self.assertRaises(ValueError): self.library.record_attempt(self.book, 'Reader', 40, 95, visitor, 'invalid')

    def test_unranked_completions_count_without_entering_rankings(self):
        visitor, attempt_id = 'a' * 32, 'b' * 32
        self.library.record_attempt(self.book, 'Reader', 0, 100, visitor, attempt_id, True)
        self.library.record_attempt(self.book, 'Reader', 0, 100, visitor, attempt_id, True)
        info = self.library.community(self.book)
        self.assertEqual((info['practiceCount'], info['completions'], info['completionRate']), (1, 1, 100))
        self.assertEqual(info['ranking'], [])
        shelf = self.library.shelf()
        self.assertEqual(shelf['ranking'], [])
        self.assertEqual((shelf['books'][0]['practiceCount'], shelf['books'][0]['completions']), (1, 1))
        with self.assertRaises(ValueError): self.library.record_attempt(self.book, 'Reader', 0, 100, visitor, attempt_id, False)

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
