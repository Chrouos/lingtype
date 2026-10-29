import unittest
import threading
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
from urllib.request import Request
from functools import partial
from arxiv_import import canonical_url, parse_article
from server import Handler, ArxivRedirect, fetch_error_message


class ArxivTests(unittest.TestCase):
    def test_url_is_limited_to_arxiv_identifiers(self):
        self.assertEqual(canonical_url('https://arxiv.org/abs/2610.32770v1'), 'https://arxiv.org/html/2610.32770v1')
        with self.assertRaises(ValueError):
            canonical_url('https://arxiv.org.evil.test/html/2610.32770v1')

    def test_extracts_sections_and_ignores_math_and_references(self):
        html = '''<html><head><title>Example</title></head><body><article>
        <h1 class="ltx_title ltx_title_document">A paper</h1>
        <div class="ltx_abstract"><h6>Abstract</h6><p class="ltx_p">An abstract.</p></div>
        <section class="ltx_section"><h2 class="ltx_title_section">1 Introduction</h2>
        <div class="ltx_para"><p class="ltx_p">The method <math><mi>x</mi></math> works.</p></div></section>
        <section class="ltx_bibliography"><p class="ltx_p">Reference text.</p></section>
        </article></body></html>'''
        paper = parse_article(html, 'https://arxiv.org/html/2610.32770v1')
        self.assertEqual(paper['title'], 'A paper')
        self.assertEqual([s['title'] for s in paper['sections']], ['Abstract', '1 Introduction'])
        self.assertEqual(paper['sections'][1]['text'], 'The method works.')
        self.assertNotIn('Reference text', str(paper))

    def test_server_rejects_non_arxiv_urls(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory='site'))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch('server.build_opener') as opener:
                with self.assertRaises(HTTPError) as response:
                    urlopen(f'http://127.0.0.1:{server.server_port}/api/arxiv?url=https%3A%2F%2Fexample.com%2F')
                self.assertEqual(response.exception.code, 400)
                response.exception.close()
                opener.assert_not_called()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_redirect_allows_only_arxiv_article_urls(self):
        handler = ArxivRedirect()
        req = Request('https://arxiv.org/html/2610.32770')
        result = handler.redirect_request(req, None, 302, 'Found', {}, 'https://arxiv.org/html/2610.32770v1')
        self.assertEqual(result.full_url, 'https://arxiv.org/html/2610.32770v1')
        self.assertIsNone(handler.redirect_request(req, None, 302, 'Found', {}, 'https://example.com/'))

    def test_error_message_identifies_http_and_network_failures(self):
        http = HTTPError('https://arxiv.org/html/2610.32770', 403, 'Forbidden', {}, None)
        self.assertIn('HTTP 403', fetch_error_message(http))
        http.close()
        self.assertIn('connection refused', fetch_error_message(URLError('connection refused')))


if __name__ == '__main__':
    unittest.main()
