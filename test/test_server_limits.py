import http.client
import json
import socket
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path
from unittest.mock import patch

from public_library import PublicLibrary
from server import BoundedHTTPServer, Handler


class ServerLimitsTests(unittest.TestCase):
    def start_server(self, **limits):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        Path(folder.name, 'index.html').write_text('ready')
        server = BoundedHTTPServer(('127.0.0.1', 0), partial(Handler, directory=folder.name), **limits)
        server.library = PublicLibrary(Path(folder.name) / 'books.db')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), thread.join(), server.server_close()))
        return server

    def wait_for_slots(self, server, expected):
        end = time.monotonic() + 4
        while server._slots._value != expected and time.monotonic() < end:
            time.sleep(.01)
        self.assertEqual(server._slots._value, expected)

    def test_stalled_connections_are_bounded_and_release_slots(self):
        server = self.start_server(max_workers=2, idle_timeout=.3, header_timeout=1, request_timeout=5)
        first = socket.create_connection(server.server_address, timeout=2)
        second = socket.create_connection(server.server_address, timeout=2)
        self.addCleanup(first.close); self.addCleanup(second.close)
        self.wait_for_slots(server, 0)
        with socket.create_connection(server.server_address, timeout=2) as extra:
            self.assertIn(b'503 Service Unavailable', extra.recv(1024))
        self.wait_for_slots(server, 2)
        connection = http.client.HTTPConnection(*server.server_address, timeout=2)
        self.addCleanup(connection.close)
        connection.request('GET', '/')
        self.assertEqual(connection.getresponse().status, 200)

    def test_partial_body_is_rejected_without_publishing(self):
        server = self.start_server(max_workers=2, idle_timeout=2, header_timeout=2, request_timeout=5)
        with socket.create_connection(server.server_address, timeout=2) as client:
            client.sendall(b'POST /api/workbooks HTTP/1.0\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{}')
            client.shutdown(socket.SHUT_WR)
            result = b''
            while True:
                chunk = client.recv(4096)
                if not chunk: break
                result += chunk
        self.assertIn(b'400 Bad Request', result)
        self.assertIn('請求內容不完整'.encode(), result)
        self.assertEqual(server.library.list_books(), [])

    def test_dripped_headers_and_body_have_total_deadlines(self):
        server = self.start_server(max_workers=1, idle_timeout=.5, header_timeout=.35, request_timeout=1)
        with socket.create_connection(server.server_address, timeout=2) as client:
            self.wait_for_slots(server, 0)
            for _ in range(8):
                try: client.sendall(b'G')
                except OSError: break
                time.sleep(.1)
            self.wait_for_slots(server, 1)
        with socket.create_connection(server.server_address, timeout=2) as client:
            client.sendall(b'POST /api/workbooks HTTP/1.0\r\nHost: localhost\r\nContent-Length: 1000\r\n\r\n')
            self.wait_for_slots(server, 0)
            for _ in range(16):
                try: client.sendall(b'x')
                except OSError: break
                time.sleep(.1)
            self.wait_for_slots(server, 1)
        self.assertEqual(server.library.list_books(), [])

    def test_full_20mb_upload_reaches_extractor(self):
        server = self.start_server(max_workers=2, idle_timeout=5, header_timeout=5, request_timeout=30)
        connection = http.client.HTTPConnection(*server.server_address, timeout=15)
        self.addCleanup(connection.close)
        with patch('server.extract_file', side_effect=lambda name, data: {'title':name, 'bytes':len(data)}):
            connection.request('POST', '/api/extract?name=large.txt', body=b'x' * 20_000_000)
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())['bytes'], 20_000_000)

    def test_two_normal_uploads_can_run_concurrently(self):
        server = self.start_server(max_workers=2, idle_timeout=5, header_timeout=5, request_timeout=15)
        entered, release, guard = threading.Event(), threading.Event(), threading.Lock()
        count = 0
        def extract(name, data):
            nonlocal count
            with guard:
                count += 1
                if count == 2: entered.set()
            if not release.wait(5): raise RuntimeError('test did not release uploads')
            return {'bytes':len(data)}
        def upload():
            connection = http.client.HTTPConnection(*server.server_address, timeout=10)
            try:
                connection.request('POST', '/api/extract?name=test.txt', body=b'x' * 2_000_001)
                response = connection.getresponse()
                return response.status, json.loads(response.read())['bytes']
            finally: connection.close()
        with patch('server.extract_file', side_effect=extract), ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(upload) for _ in range(2)]
            try: self.assertTrue(entered.wait(5), 'both uploads should reach the handler')
            finally: release.set()
            self.assertEqual([future.result(timeout=10) for future in futures], [(200, 2_000_001), (200, 2_000_001)])

    def test_large_upload_limit_reports_busy_and_releases_after_failure(self):
        server = self.start_server(max_workers=3, max_large_uploads=1, idle_timeout=5, header_timeout=5, request_timeout=20)
        entered, release = threading.Event(), threading.Event()
        def extract(name, data):
            if name == 'wait.txt':
                entered.set()
                if not release.wait(10): raise RuntimeError('test did not release upload')
            if name == 'fail.txt': raise RuntimeError('extract failed')
            return {'bytes':len(data)}
        def upload(name):
            connection = http.client.HTTPConnection(*server.server_address, timeout=12)
            try:
                connection.request('POST', f'/api/extract?name={name}', body=b'x' * 2_000_001)
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally: connection.close()
        with patch('server.extract_file', side_effect=extract), ThreadPoolExecutor(max_workers=1) as pool:
            running = pool.submit(upload, 'wait.txt')
            try:
                self.assertTrue(entered.wait(5))
                status, body = upload('busy.txt')
                self.assertEqual(status, 503)
                self.assertIn('稍後再試', body['error'])
            finally: release.set()
            self.assertEqual(running.result(timeout=10), (200, {'bytes':2_000_001}))
            self.assertEqual(upload('fail.txt')[0], 502)
            self.assertEqual(upload('again.txt'), (200, {'bytes':2_000_001}))


if __name__ == '__main__':
    unittest.main()
