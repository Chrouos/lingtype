import json
import tempfile
import unittest
import threading
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from public_library import PublicLibrary
from server import Handler


class PublicLibraryTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
