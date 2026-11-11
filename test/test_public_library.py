import json
import tempfile
import unittest
import threading
import sqlite3
import hashlib
from io import BytesIO
from PIL import Image
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from public_library import PublicLibrary, validate_workbook, seed_id
from server import Handler


class PublicLibraryTests(unittest.TestCase):
    def test_bundled_books_are_seeded_once_updated_in_place_and_stay_removed(self):
        with tempfile.TemporaryDirectory() as folder:
            books = Path(folder) / 'library'; books.mkdir()
            novel = {'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'A Novel', 'text':'One.\n\nTwo.', 'words':[], 'category':'novel', 'authors':['Writer'], 'sections':[{'title':'Chapter I', 'text':'One.\n\nTwo.'}]}}
            (books / 'novel.json').write_text(json.dumps(novel), encoding='utf-8')
            library = PublicLibrary(Path(folder) / 'books.db')
            identifier = seed_id('novel')
            self.assertEqual(library.seed(books), [identifier])
            self.assertEqual(library.seed(books), [identifier])
            shelf = library.list_books()
            self.assertEqual([(book['id'], book['title'], book['category'], book['authors']) for book in shelf], [(identifier, 'A Novel', 'novel', ['Writer'])])
            # No key matches a bundled book, so the API cannot remove it.
            self.assertFalse(library.unpublish(identifier, ''))
            library.set_like(identifier, 'c' * 32, True)
            novel['lesson']['title'] = 'A Novel, Revised'
            (books / 'novel.json').write_text(json.dumps(novel), encoding='utf-8')
            library.seed(books)
            self.assertEqual(library.get(identifier)['lesson']['title'], 'A Novel, Revised')
            self.assertEqual(library.list_books()[0]['likes'], 1)
            library.moderation_remove_book(library.moderation_book(identifier))
            self.assertEqual(library.seed(books), [])
            self.assertEqual(library.list_books(), [])
            self.assertEqual(library.seed(Path(folder) / 'missing'), [])

    def test_bundled_library_files_are_valid_shareable_books(self):
        folder = Path(__file__).resolve().parent.parent / 'library'
        files = sorted(folder.glob('*.json'))
        self.assertTrue(files)
        categories = set()
        for path in files:
            book = json.loads(path.read_text(encoding='utf-8'))
            validate_workbook(book)
            lesson = book['lesson']
            categories.add(lesson['category'])
            self.assertTrue(lesson['license'] and lesson['sourceUrl'].startswith('https://'), path.name)
            self.assertEqual(lesson['text'], '\n\n'.join(section['text'] for section in lesson['sections']), path.name)
            self.assertTrue(all(len(section['text']) <= 12000 for section in lesson['sections']), path.name)
            if lesson['category'] == 'arxiv': self.assertRegex(lesson['license'], r'\bCC (BY|0)\b', path.name)
        self.assertEqual(categories, {'novel', 'arxiv'})

    def test_shared_author_metadata_is_bounded_and_visible_on_shelf(self):
        with tempfile.TemporaryDirectory() as folder:
            library = PublicLibrary(Path(folder) / 'books.db')
            authors = ['𠮷' * 150] + [f'Author {i}' for i in range(119)]
            book = {'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'Paper', 'text':'Text.', 'words':[], 'authors':authors}}
            identifier, _ = library.publish(book)
            self.assertEqual(library.get(identifier)['lesson']['authors'], authors)
            self.assertEqual(library.list_books()[0]['authors'], authors[:4])
            self.assertEqual(PublicLibrary(library.path).list_books()[0]['authors'], authors[:4])
            book['lesson']['authors'] = ['x' * 201]
            with self.assertRaisesRegex(ValueError, '作者'): library.publish(book)

    def test_cover_upgrade_preserves_legacy_database_and_owner_permissions(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'legacy.db'
            identifier, key = 'a' * 32, 'b' * 64
            book = {'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'Legacy', 'text':'Old book.', 'words':[], 'authors':['Legacy Author']}}
            image = BytesIO(); Image.new('RGB', (2, 2), 'red').save(image, 'PNG')
            blue = BytesIO(); Image.new('RGB', (2, 2), 'blue').save(blue, 'PNG')
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL, owner_hash TEXT)')
                db.execute('CREATE TABLE covers (book_id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL)')
                db.execute('INSERT INTO books VALUES (?, ?, ?, ?, ?)', (identifier, 'Legacy', '2026-01-01', json.dumps(book), hashlib.sha256(key.encode()).hexdigest()))
                db.execute('INSERT INTO covers VALUES (?, ?, ?)', (identifier, 'image/png', image.getvalue()))
            library = PublicLibrary(path)
            self.assertEqual(library.list_books()[0]['authors'], ['Legacy Author'])
            self.assertEqual(library.get_cover(identifier), ('image/png', image.getvalue()))
            self.assertEqual(library.cover_revision(identifier), 0)
            self.assertFalse(library.set_cover(identifier, 'wrong', blue.getvalue(), 0))
            self.assertEqual(library.cover_revision(identifier), 0)
            self.assertTrue(library.set_cover(identifier, key, blue.getvalue(), 0))
            self.assertEqual(library.get_cover(identifier), ('image/png', blue.getvalue()))
            self.assertEqual(library.cover_revision(identifier), 1)
            # A second server process sees the migrated schema and revision.
            self.assertEqual(PublicLibrary(path).cover_revision(identifier), 1)

    def test_large_pdf_section_count_is_accepted_within_size_limit(self):
        sections = [{'title':f'p. {i}', 'text':f'Page {i}.'} for i in range(2002)]
        book = {'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'PDF', 'text':'Text.', 'words':[], 'sections':sections}}
        raw = validate_workbook(book)
        self.assertLess(len(raw.encode('utf-8')), 2_000_000)
        book['lesson']['sections'] = [{'title':'p', 'text':'x'}] * 4000
        self.assertTrue(validate_workbook(book))
        book['lesson']['sections'] = [{'title':'p', 'text':'x'}] * 4001
        with self.assertRaisesRegex(ValueError, '章節'):
            validate_workbook(book)
        book['lesson']['sections'] = []
        book['lesson']['translations'] = {'zh':'中' * 700_000}
        with self.assertRaisesRegex(ValueError, '2 MB'):
            validate_workbook(book)

    def test_http_full_capacity_returns_retryable_status(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            library = PublicLibrary(Path(folder) / 'books.db')
            book, _ = library.publish({'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'Book', 'text':'Hello.', 'words':[]}})
            with sqlite3.connect(library.path) as db:
                library.max_bytes = db.execute('SELECT bytes FROM content_usage WHERE id = 1').fetchone()[0]
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=folder))
            server.library = library
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base = f'http://127.0.0.1:{server.server_port}'
                payload = json.dumps({'visitor':'a' * 32, 'attemptId':'b' * 32, 'author':'Reader', 'wpm':40, 'accuracy':95}).encode()
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(f'{base}/api/workbooks/{book}/community/attempts', data=payload, headers={'Origin':base}))
                self.assertEqual(error.exception.code, 507)
                self.assertEqual(library.community(book)['practiceCount'], 0)
            finally:
                server.shutdown(); thread.join(); server.server_close()

    def test_request_limit_is_per_client_and_recovers_after_window(self):
        from server import RequestLimiter
        limiter = RequestLimiter(limit=2, window=60)
        self.assertTrue(limiter.allow('one', now=0))
        self.assertTrue(limiter.allow('one', now=1))
        self.assertFalse(limiter.allow('one', now=2))
        self.assertTrue(limiter.allow('two', now=2))
        self.assertTrue(limiter.allow('one', now=61))

    def test_total_storage_limit_rejects_new_books_without_deleting_existing(self):
        with tempfile.TemporaryDirectory() as folder:
            book = {'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'One', 'text':'Hello.', 'words':[]}}
            size = len(json.dumps(book, ensure_ascii=False).encode('utf-8'))
            library = PublicLibrary(Path(folder) / 'books.db', max_bytes=size)
            identifier, _ = library.publish(book)
            with self.assertRaises(ValueError): library.publish(book)
            self.assertEqual(library.get(identifier), book)

    def test_publication_is_persistent_and_retrievable(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'books.db'
            library = PublicLibrary(path)
            workbook = {'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'A book', 'text':'Hello world.', 'words':[], 'translations':{}}}
            identifier, secret = library.publish(workbook)
            self.assertEqual(library.list_books()[0]['title'], 'A book')
            self.assertEqual(PublicLibrary(path).get(identifier), workbook)
            self.assertIsNone(library.get('missing'))
            self.assertFalse(library.unpublish(identifier, 'incorrect'))
            self.assertTrue(library.unpublish(identifier, secret))
            self.assertIsNone(library.get(identifier))

    def test_rejects_invalid_or_oversized_books(self):
        with tempfile.TemporaryDirectory() as folder:
            library = PublicLibrary(Path(folder) / 'books.db')
            with self.assertRaises(ValueError): library.publish({'format':'wrong'})
            with self.assertRaises(ValueError): library.publish({'format':'lingtype-workbook','version':1,'lesson':{'title':'x','text':'x'*2_000_001,'words':[]}})
            self.assertEqual(library.list_books(), [])

    def test_publish_with_client_credentials_can_be_retried_without_losing_ownership(self):
        with tempfile.TemporaryDirectory() as folder:
            library = PublicLibrary(Path(folder) / 'books.db')
            workbook = {'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'Shared', 'text':'Hello.', 'words':[]}}
            identifier, key = 'a' * 32, 'b' * 64
            self.assertEqual(library.publish(workbook, identifier, key), (identifier, key))
            library.max_bytes = 0  # A retry remains possible even if the store is now full.
            self.assertEqual(library.publish(workbook, identifier, key), (identifier, key))
            self.assertEqual(len(library.list_books()), 1)
            with self.assertRaises(ValueError): library.publish(workbook, identifier, 'c' * 64)
            with self.assertRaises(ValueError): library.publish({**workbook, 'lesson':{**workbook['lesson'], 'text':'Changed.'}}, identifier, key)
            with self.assertRaises(ValueError): library.publish(workbook, identifier, None)
            self.assertTrue(library.unpublish(identifier, key))

    def test_page_and_modules_are_revalidated_on_every_load(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'views.mjs').write_text('export {};', encoding='utf-8')
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=folder))
            server.library = PublicLibrary(Path(folder) / 'books.db')
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(base + '/views.mjs') as response:
                    self.assertEqual(response.headers['Cache-Control'], 'no-cache')
                    modified = response.headers['Last-Modified']
                with self.assertRaises(HTTPError) as unchanged:
                    urlopen(Request(base + '/views.mjs', headers={'If-Modified-Since':modified}))
                self.assertEqual(unchanged.exception.code, 304)
                with urlopen(base + '/api/workbooks') as response:
                    self.assertEqual(response.headers.get_all('Cache-Control'), ['no-store'])
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_http_publish_list_and_fetch(self):
        with tempfile.TemporaryDirectory() as folder:
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=folder))
            server.library = PublicLibrary(Path(folder) / 'books.db')
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            data = json.dumps({'format':'lingtype-workbook','version':1,'lesson':{'title':'Shared','text':'Hello.','words':[],'translations':{}}}).encode()
            try:
                request = Request(base + '/api/workbooks', data=data, headers={'Content-Type':'application/json', 'Origin':base})
                published = json.load(urlopen(request)); identifier = published['id']
                self.assertEqual(json.load(urlopen(base + '/api/workbooks'))['books'][0]['id'], identifier)
                self.assertEqual(json.load(urlopen(base + '/api/workbooks/' + identifier))['lesson']['text'], 'Hello.')
                client_headers = {'Content-Type':'application/json', 'Origin':base, 'X-Publication-Id':'a' * 32, 'X-Owner-Key':'b' * 64}
                for _ in range(2):
                    retry = json.load(urlopen(Request(base + '/api/workbooks', data=data, headers=client_headers)))
                    self.assertEqual((retry['id'], retry['ownerKey']), ('a' * 32, 'b' * 64))
                long_book = json.dumps({'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'Long', 'text':'Opening ' * 50 + 'needle_987', 'words':[]}}).encode()
                found = json.load(urlopen(Request(base + '/api/workbooks', data=long_book, headers={'Origin':base})))
                shelf = json.load(urlopen(base + '/api/workbooks?query=needle_987'))
                self.assertEqual((shelf['total'], [book['id'] for book in shelf['books']]), (1, [found['id']]))
                image = BytesIO(); Image.new('RGB', (2, 2), 'red').save(image, 'PNG')
                cover_url = base + '/api/workbooks/' + identifier + '/cover'
                cover = Request(cover_url, data=image.getvalue(), headers={'Origin':base, 'X-Owner-Key':published['ownerKey']})
                self.assertEqual(urlopen(cover).status, 200)
                self.assertEqual(urlopen(cover_url).headers.get_content_type(), 'image/png')
                community_url = base + '/api/workbooks/' + identifier + '/community'
                attempt = json.dumps({'visitor':'a' * 32, 'attemptId':'b' * 32, 'author':'Reader', 'wpm':40, 'accuracy':95}).encode()
                for _ in range(2):
                    self.assertTrue(json.load(urlopen(Request(community_url + '/attempts', data=attempt, headers={'Origin':base})))['saved'])
                self.assertEqual(json.load(urlopen(community_url))['practiceCount'], 1)
                fast = json.dumps({'visitor':'c' * 32, 'attemptId':'d' * 32, 'author':'Fast', 'wpm':0, 'accuracy':100, 'completionOnly':True}).encode()
                self.assertTrue(json.load(urlopen(Request(community_url + '/attempts', data=fast, headers={'Origin':base})))['saved'])
                stats = json.load(urlopen(community_url))
                self.assertEqual((stats['practiceCount'], stats['completions']), (2, 2))
                self.assertEqual([row['author'] for row in stats['ranking']], ['Reader'])
                start = json.dumps({'visitor':'e' * 32}).encode()
                for _ in range(2):
                    self.assertEqual(json.load(urlopen(Request(community_url + '/start', data=start, headers={'Origin':base})))['count'], 3)
                like = json.dumps({'visitor':'a' * 32, 'liked':True}).encode()
                self.assertEqual(json.load(urlopen(Request(community_url + '/like', data=like, headers={'Origin':base})))['likes'], 1)
                comment = json.dumps({'author':'Reader', 'text':'Lovely story'}).encode()
                posted = json.load(urlopen(Request(community_url + '/comments', data=comment, headers={'Origin':base})))
                self.assertEqual(json.load(urlopen(community_url + '?visitor=' + 'a' * 32))['comments'][0]['text'], 'Lovely story')
                retry_comment = json.dumps({'author':'Reader', 'text':'A retry', 'commentId':'c' * 32}).encode()
                for _ in range(2):
                    self.assertEqual(json.load(urlopen(Request(community_url + '/comments', data=retry_comment, headers={'Origin':base})))['id'], 'c' * 32)
                self.assertEqual(len(json.load(urlopen(community_url))['comments']), 2)
                deleted_retry = Request(community_url + '/comments/' + 'c' * 32, method='DELETE', headers={'Origin':base, 'X-Owner-Key':published['ownerKey']})
                self.assertEqual(urlopen(deleted_retry).status, 200)
                with self.assertRaises(HTTPError) as removed:
                    urlopen(Request(community_url + '/comments', data=retry_comment, headers={'Origin':base}))
                self.assertEqual(removed.exception.code, 410)
                self.assertEqual(len(json.load(urlopen(community_url))['comments']), 1)
                remove_comment = Request(community_url + '/comments/' + posted['id'], method='DELETE', headers={'Origin':base, 'X-Owner-Key':published['ownerKey']})
                self.assertEqual(urlopen(remove_comment).status, 200)
                deletion = Request(base + '/api/workbooks/' + identifier, method='DELETE', headers={'Origin':base, 'X-Owner-Key':published['ownerKey']})
                self.assertEqual(urlopen(deletion).status, 200)
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(base + '/api/workbooks', data=data, headers={'Origin':'https://other.example'}))
                self.assertEqual(error.exception.code, 403)
                error.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


    def test_http_cover_needs_the_owner_and_a_real_image(self):
        with tempfile.TemporaryDirectory() as folder:
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=folder))
            server.library = PublicLibrary(Path(folder) / 'books.db')
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            data = json.dumps({'format':'lingtype-workbook','version':1,'lesson':{'title':'Shared','text':'Hello.','words':[],'translations':{}}}).encode()
            try:
                published = json.load(urlopen(Request(base + '/api/workbooks', data=data, headers={'Content-Type':'application/json', 'Origin':base})))
                cover_url = base + '/api/workbooks/' + published['id'] + '/cover'
                image = BytesIO(); Image.new('RGB', (2, 2), 'red').save(image, 'PNG')
                for body, key, code in ((None, None, 404), (image.getvalue(), 'wrong', 404), (b'not an image', published['ownerKey'], 400)):
                    with self.assertRaises(HTTPError) as error:
                        urlopen(cover_url if body is None else Request(cover_url, data=body, headers={'Origin':base, 'X-Owner-Key':key}))
                    self.assertEqual(error.exception.code, code)
                    error.exception.close()
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(cover_url, data=image.getvalue(), headers={'Origin':'https://other.example', 'X-Owner-Key':published['ownerKey']}))
                self.assertEqual(error.exception.code, 403)
                error.exception.close()
                response = urlopen(Request(cover_url, data=image.getvalue(), headers={'Origin':base, 'X-Owner-Key':published['ownerKey']}))
                self.assertEqual(json.load(response), {'saved':True})
                fetched = urlopen(cover_url)
                self.assertEqual(fetched.headers.get('X-Content-Type-Options'), 'nosniff')
                self.assertEqual(fetched.read(), image.getvalue())
                revision_url = base + '/api/workbooks/' + published['id'] + '/cover-revision'
                self.assertEqual(json.load(urlopen(revision_url))['revision'], 1)
                blue = BytesIO(); Image.new('RGB', (2, 2), 'blue').save(blue, 'PNG')
                headers = {'Origin':base, 'X-Owner-Key':published['ownerKey'], 'X-Cover-Revision':'1'}
                self.assertEqual(urlopen(Request(cover_url, data=blue.getvalue(), headers=headers)).status, 200)
                # A delayed request and an old client must not overwrite the new cover.
                for old_headers in (headers, {'Origin':base, 'X-Owner-Key':published['ownerKey']}):
                    with self.assertRaises(HTTPError) as error:
                        urlopen(Request(cover_url, data=image.getvalue(), headers=old_headers))
                    self.assertEqual(error.exception.code, 409)
                    error.exception.close()
                self.assertEqual(urlopen(cover_url).read(), blue.getvalue())
                self.assertEqual(json.load(urlopen(revision_url))['revision'], 2)
                # A tiny PNG can claim enormous dimensions. Pillow rejects it
                # before decoding pixels; the API must return 400 and retain the
                # existing image and revision.
                import struct, zlib
                oversized = bytearray(image.getvalue())
                oversized[16:24] = struct.pack('>II', 20000, 20000)
                oversized[29:33] = struct.pack('>I', zlib.crc32(oversized[12:29]) & 0xffffffff)
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(cover_url, data=bytes(oversized), headers={**headers, 'X-Cover-Revision':'2'}))
                self.assertEqual(error.exception.code, 400)
                error.exception.close()
                self.assertEqual(urlopen(cover_url).read(), blue.getvalue())
                self.assertEqual(json.load(urlopen(revision_url))['revision'], 2)
                # Two tabs read the same version. Exactly one conditional write succeeds.
                barrier = threading.Barrier(2)
                outcomes = []
                def upload(body):
                    barrier.wait()
                    try:
                        with urlopen(Request(cover_url, data=body, headers={**headers, 'X-Cover-Revision':'2'})) as reply:
                            outcomes.append(reply.status)
                    except HTTPError as error:
                        outcomes.append(error.code); error.close()
                workers = [threading.Thread(target=upload, args=(body,)) for body in (image.getvalue(), blue.getvalue())]
                for worker in workers: worker.start()
                for worker in workers: worker.join()
                self.assertEqual(sorted(outcomes), [200, 409])
                self.assertEqual(json.load(urlopen(revision_url))['revision'], 3)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

if __name__ == '__main__':
    unittest.main()
