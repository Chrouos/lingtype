"""Serve Lingtype and retrieve arXiv HTML on the local machine."""
import json
import os
import re
import sqlite3
import sys
import threading
import time
from collections import deque
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


class RequestLimiter:
    def __init__(self, limit=120, window=60):
        self.limit, self.window = limit, window
        self.clients = {}
        self.lock = threading.Lock()

    def allow(self, client, now=None):
        now = time.monotonic() if now is None else now
        with self.lock:
            if len(self.clients) >= 10000:
                self.clients = {key: times for key, times in self.clients.items() if times and now - times[-1] < self.window}
                if len(self.clients) >= 10000 and client not in self.clients:
                    return False
            times = self.clients.setdefault(client, deque())
            while times and now - times[0] >= self.window:
                times.popleft()
            if len(times) >= self.limit:
                return False
            times.append(now)
            return True


request_limiter = RequestLimiter()


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
    def allowed_request(self):
        if request_limiter.allow(self.client_address[0]):
            return True
        self.send_json({'error': '請求過於頻繁，請稍後再試。'}, 429)
        return False

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
        community = re.fullmatch(r'/api/workbooks/([0-9a-f]{32})/community/(like|comments|attempts|read|start)', path)
        cover = re.fullmatch(r'/api/workbooks/([0-9a-f]{32})/cover', path)
        if path not in ('/api/translate', '/api/workbooks', '/api/extract') and not community and not cover:
            self.send_error(404)
            return
        if not self.same_origin():
            self.send_error(403)
            return
        if not self.allowed_request(): return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if cover:
                # A cover arrives as the raw image; only the owner of the workbook may set it.
                if not 0 < length <= 2_000_000:
                    raise ValueError('封面必須小於 2 MB。')
                saved = self.server.library.set_cover(cover.group(1), self.headers.get('X-Owner-Key', ''), self.rfile.read(length))
                self.send_json({'saved':True} if saved else {'error':'找不到練習冊或沒有修改權限。'}, 200 if saved else 404)
                return
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
            if community:
                identifier, action = community.groups()
                if action == 'like': self.send_json({'likes':self.server.library.set_like(identifier, payload.get('visitor'), payload.get('liked'))})
                elif action == 'comments': self.send_json({'id':self.server.library.add_comment(identifier, payload.get('author', ''), payload.get('text'))}, 201)
                elif action in ('read', 'start'): self.send_json({'count':self.server.library.record_visit(identifier, payload.get('visitor'), action + 's')})
                else:
                    self.server.library.record_attempt(identifier, payload.get('author', ''), payload.get('wpm'), payload.get('accuracy'), payload.get('visitor', ''))
                    self.send_json({'saved':True}, 201)
                return
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
        comment = re.fullmatch(r'/api/workbooks/([0-9a-f]{32})/community/comments/([0-9a-f]{32})', urlsplit(self.path).path)
        if comment:
            if not self.same_origin(): return self.send_error(403)
            if not self.allowed_request(): return
            removed = self.server.library.remove_comment(*comment.groups(), self.headers.get('X-Owner-Key', ''))
            return self.send_json({'removed':True} if removed else {'error':'找不到留言或沒有刪除權限。'}, 200 if removed else 404)
        match = re.fullmatch(r'/api/workbooks/([0-9a-f]{32})', urlsplit(self.path).path)
        if not match:
            self.send_error(404)
            return
        if not self.same_origin():
            self.send_error(403)
            return
        if not self.allowed_request(): return
        try:
            removed = self.server.library.unpublish(match.group(1), self.headers.get('X-Owner-Key', ''))
            self.send_json({'removed':True} if removed else {'error':'找不到練習冊或沒有刪除權限。'}, 200 if removed else 404)
        except sqlite3.Error:
            self.send_json({'error':'無法刪除公開練習冊。'}, 500)

    def do_GET(self):
        request = urlsplit(self.path)
        if request.path.startswith('/api/') and not self.allowed_request(): return
        cover = re.fullmatch(r'/api/workbooks/([0-9a-f]{32})/cover', request.path)
        if cover:
            try: found = self.server.library.get_cover(cover.group(1))
            except sqlite3.Error: return self.send_json({'error':'無法讀取封面。'}, 500)
            if not found: return self.send_json({'error':'這本練習冊沒有封面。'}, 404)
            mime, data = found
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(data)
            return
        community = re.fullmatch(r'/api/workbooks/([0-9a-f]{32})/community', request.path)
        if community:
            try: self.send_json(self.server.library.community(community.group(1), parse_qs(request.query).get('visitor', [''])[0]))
            except ValueError as error: self.send_json({'error':str(error)}, 404)
            except sqlite3.Error: self.send_json({'error':'無法讀取社群資料。'}, 500)
            return
        if request.path == '/api/workbooks':
            try: self.send_json(self.server.library.shelf())
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
