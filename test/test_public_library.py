import json
import tempfile
import unittest
import threading
from io import BytesIO
from PIL import Image
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from public_library import PublicLibrary
from server import Handler


class PublicLibraryTests(unittest.TestCase):
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
                image = BytesIO(); Image.new('RGB', (2, 2), 'red').save(image, 'PNG')
                cover_url = base + '/api/workbooks/' + identifier + '/cover'
                cover = Request(cover_url, data=image.getvalue(), headers={'Origin':base, 'X-Owner-Key':published['ownerKey']})
                self.assertEqual(urlopen(cover).status, 200)
                self.assertEqual(urlopen(cover_url).headers.get_content_type(), 'image/png')
                community_url = base + '/api/workbooks/' + identifier + '/community'
                like = json.dumps({'visitor':'a' * 32, 'liked':True}).encode()
                self.assertEqual(json.load(urlopen(Request(community_url + '/like', data=like, headers={'Origin':base})))['likes'], 1)
                comment = json.dumps({'author':'Reader', 'text':'Lovely story'}).encode()
                posted = json.load(urlopen(Request(community_url + '/comments', data=comment, headers={'Origin':base})))
                self.assertEqual(json.load(urlopen(community_url + '?visitor=' + 'a' * 32))['comments'][0]['text'], 'Lovely story')
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
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

if __name__ == '__main__':
    unittest.main()
