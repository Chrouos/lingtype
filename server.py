"""Serve Lingtype and retrieve arXiv HTML on the local machine."""
import json
import os
import re
import sqlite3
import sys
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from arxiv_import import canonical_url, parse_article
from importers import extract_file, fetch_article, youtube_id, youtube_transcript
from public_library import PublicLibrary
sys.path.insert(0, str(Path(__file__).resolve().parent / '.deps'))
from translate import translate_sentences


class ArxivRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            safe_url = canonical_url(newurl)
        except ValueError:
            return None
        return super().redirect_request(req, fp, code, msg, headers, safe_url)


def fetch_error_message(error):
    if isinstance(error, HTTPError):
        return f'arXiv 回應 HTTP {error.code}，無法取得論文 HTML。'
    if isinstance(error, URLError):
        return f'連線 arXiv 失敗：{error.reason}'
    if isinstance(error, TimeoutError):
        return '連線 arXiv 逾時，請稍後重試。'
    return f'讀取 arXiv 失敗：{error}'


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def same_origin(self):
        origin = self.headers.get('Origin')
        if not origin:
            return True
        parsed = urlsplit(origin)
        return parsed.scheme in ('http', 'https') and parsed.netloc == self.headers.get('Host') and not parsed.path and not parsed.query and not parsed.fragment

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ('/api/translate', '/api/workbooks', '/api/extract'):
            self.send_error(404)
            return
        if not self.same_origin():
            self.send_error(403)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if path == '/api/extract':
                # An uploaded document arrives as raw bytes, its file name in the query string.
                if not 0 < length <= 20_000_000:
                    raise ValueError('檔案超過 20 MB 或是空的。')
                name = parse_qs(urlsplit(self.path).query).get('name', [''])[0]
                self.send_json(extract_file(name, self.rfile.read(length)))
                return
            if not 0 < length <= 2_000_000:
                raise ValueError('翻譯內容過大或空白。')
            payload = json.loads(self.rfile.read(length))
            if path == '/api/workbooks':
                identifier, owner_key = self.server.library.publish(payload)
                self.send_json({'id':identifier, 'ownerKey':owner_key}, 201)
                return
            translated = translate_sentences(payload.get('sentences'), payload.get('language'))
            result, status = {'translations': translated}, 200
        except (ValueError, json.JSONDecodeError, AttributeError) as error:
            result, status = {'error': str(error)}, 400
        except RuntimeError as error:
            result, status = {'error': str(error)}, 502
        except (URLError, TimeoutError, OSError, KeyError):
            result, status = {'error': '無法連線 Google 翻譯，請檢查網路。'}, 502
        except sqlite3.Error:
            result, status = {'error':'無法儲存公開練習冊。'}, 500
        self.send_json(result, status)

    def do_DELETE(self):
        match = re.fullmatch(r'/api/workbooks/([0-9a-f]{32})', urlsplit(self.path).path)
        if not match:
            self.send_error(404)
            return
        if not self.same_origin():
            self.send_error(403)
            return
        try:
            removed = self.server.library.unpublish(match.group(1), self.headers.get('X-Owner-Key', ''))
            self.send_json({'removed':True} if removed else {'error':'找不到練習冊或沒有刪除權限。'}, 200 if removed else 404)
        except sqlite3.Error:
            self.send_json({'error':'無法刪除公開練習冊。'}, 500)

    def do_GET(self):
        request = urlsplit(self.path)
        if request.path == '/api/workbooks':
            try: self.send_json({'books':self.server.library.list_books()})
            except sqlite3.Error: self.send_json({'error':'無法讀取公開練習冊。'}, 500)
            return
        match = re.fullmatch(r'/api/workbooks/([0-9a-f]{32})', request.path)
        if match:
            try:
                workbook = self.server.library.get(match.group(1))
                self.send_json(workbook if workbook else {'error':'找不到這本練習冊。'}, 200 if workbook else 404)
            except sqlite3.Error: self.send_json({'error':'無法讀取公開練習冊。'}, 500)
            return
        if request.path == '/api/import':
            self.import_url(parse_qs(request.query).get('url', [''])[0])
            return
        if request.path != '/api/arxiv':
            return super().do_GET()
        try:
            url = canonical_url(parse_qs(request.query).get('url', [''])[0])
            req = Request(url, headers={'User-Agent': 'Lingtype/1.0 (personal reading tool)', 'Accept': 'text/html'})
            with build_opener(ArxivRedirect).open(req, timeout=20) as response:
                content = response.read(5_000_001)
                if len(content) > 5_000_000:
                    raise ValueError('論文 HTML 超過 5 MB，無法匯入。')
                result = parse_article(content.decode('utf-8', errors='replace'), url)
            status = 200
        except ValueError as error:
            result, status = {'error': str(error)}, 400
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            result, status = {'error': fetch_error_message(error)}, 502
        body = json.dumps(result, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


    def import_url(self, url):
        """One address box for everything: arXiv papers keep their sections, YouTube gives its subtitles, other pages their article."""
        try:
            host = (urlsplit(url.strip()).hostname or '').lower()
            if host == 'arxiv.org':
                self.path = '/api/arxiv?' + urlencode({'url': url})
                return self.do_GET()
            result = youtube_transcript(url) if youtube_id(url) else fetch_article(url)
            self.send_json(result)
        except ValueError as error:
            self.send_json({'error': str(error)}, 400)
        except RuntimeError as error:
            self.send_json({'error': str(error)}, 502)
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            self.send_json({'error': f'無法讀取這個網址：{getattr(error, "reason", error)}'}, 502)


if __name__ == '__main__':
    handler = partial(Handler, directory=str(Path(__file__).resolve().parent / 'site'))
    host = os.environ.get('LINGTYPE_HOST', '127.0.0.1')
    port = int(os.environ.get('LINGTYPE_PORT', '8765'))
    server = ThreadingHTTPServer((host, port), handler)
    server.library = PublicLibrary(Path(os.environ.get('LINGTYPE_DATA_DIR', Path(__file__).resolve().parent / '.lingtype')) / 'public.db')
    print(f'Lingtype: http://{host}:{port}', flush=True)
    server.serve_forever()
