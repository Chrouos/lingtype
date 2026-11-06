import unittest
import threading
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
from urllib.request import Request
from functools import partial
from arxiv_import import canonical_url, parse_article

NL = chr(10)
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
        self.assertEqual(paper['sections'][1]['text'], 'The method x works.')
        self.assertNotIn('Reference text', str(paper))

    def test_pdf_and_versioned_urls_open_the_html_version(self):
        self.assertEqual(canonical_url('https://arxiv.org/pdf/2611.05306'), 'https://arxiv.org/html/2611.05306')
        self.assertEqual(canonical_url('https://arxiv.org/pdf/2611.05306v2.pdf'), 'https://arxiv.org/html/2611.05306v2')
        with self.assertRaises(ValueError):
            canonical_url('https://arxiv.org/pdf/../../etc')

    def test_keeps_numbers_references_figures_and_skips_untypeable_formulas(self):
        html = r'''<html><body><article><h1 class="ltx_title_document">P</h1>
        <div class="ltx_abstract"><h6>Abstract</h6><p class="ltx_p"><span>Abstract.</span> Short.</p></div>
        <div class="ltx_para"><p class="ltx_p">Links: Lab</p></div>
        <section><h2 class="ltx_title_section"><span class="ltx_tag">1 </span>Intro</h2>
        <div class="ltx_para"><p class="ltx_p">Costs fall (<math alttext="3.6\times"><mn>3.6</mn><mo>×</mo></math>) as
        <a href="#S1.F1" class="ltx_ref"><span class="ltx_ref_tag">Figure</span> <span class="ltx_ref_tag">1</span></a> shows
        <cite>[<a href="#bib.bib1" class="ltx_ref">4</a>]</cite>. Let <math alttext="r_{M}"><msub><mi>r</mi><mi>M</mi></msub></math> be a ratio.</p></div>
        <figure id="S1.F1" class="ltx_figure"><object type="image/svg+xml" data="2611.05306v1/a.svg"></object><img src="https://evil.test/x.png">
        <figcaption><span class="ltx_tag">Figure 1: </span>Cost <math alttext="\frac{a}{b}"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>.</figcaption></figure>
        <div class="ltx_para"><p class="ltx_p">Next paragraph.</p></div>
        <table class="ltx_equation"><tr><td><math alttext="E=mc^{2}" display="block"><mi>E</mi><annotation>E=mc^2</annotation></math></td><td class="ltx_eqn_eqno">(1)</td></tr></table>
        <figure class="ltx_table"><figcaption>Table 1: Sizes.</figcaption><table><tr><th>Work</th><th>Words</th></tr><tr><td>Book</td><td>27K</td></tr></table></figure>
        </section></article></body></html>'''
        paper = parse_article(html, 'https://arxiv.org/html/2611.05306')
        abstract, intro = paper['sections']
        self.assertEqual(abstract['text'], 'Short.')
        first, second, equation = intro['text'].split('\n\n')
        self.assertEqual(first, 'Costs fall (3.6x) as Figure 1 shows. Let  be a ratio.')
        self.assertEqual(second, 'Next paragraph.')
        self.assertEqual(equation, '')
        self.assertEqual([f['tex'] for f in paper['formulas']], ['r_{M}', r'\frac{a}{b}', 'E=mc^{2}'])
        self.assertTrue(paper['formulas'][2]['display'])
        self.assertNotIn('annotation', str(paper['formulas']))
        figure, table = paper['figures']
        self.assertEqual(figure['label'], 'Figure 1')
        self.assertEqual(figure['images'], ['https://arxiv.org/html/2611.05306v1/a.svg'])
        self.assertEqual(figure['caption'], 'Cost .')
        self.assertEqual((figure['anchor'], figure['where']), ('Next paragraph.', 'start'))
        self.assertEqual(table['rows'], [['Work', 'Words'], ['Book', '27K']])
        self.assertEqual((table['label'], table['where']), ('Table 1', 'end'))

    def test_span_tables_run_in_headings_and_list_labels(self):
        html = r'''<html><body><article><section><h2 class="ltx_title_section">1 Intro</h2>
        <ol><li class="ltx_item"><span class="ltx_tag ltx_tag_item"><span>RQ1</span></span>
        <div class="ltx_para"><p class="ltx_p">Is it needed?</p></div></li></ol>
        <section class="ltx_paragraph"><h5 class="ltx_title ltx_title_paragraph">Inference step.</h5>
        <div class="ltx_para"><p class="ltx_p">One call to a model.</p></div></section>
        <figure class="ltx_table"><figure class="ltx_table ltx_minipage"><p class="ltx_p"><span class="ltx_tabular">
        <span class="ltx_tr"><span class="ltx_td"></span><span class="ltx_td">Accuracy</span></span>
        <span class="ltx_tr"><span class="ltx_td">SAC</span><span class="ltx_td">70.2</span></span></span></p></figure>
        <figcaption><span class="ltx_tag">Table 2: </span>Results.</figcaption>
        <img src="../../evil.png"></figure>
        </section></article></body></html>'''
        paper = parse_article(html, 'https://arxiv.org/html/2611.05306')
        self.assertEqual(paper['sections'][0]['text'].split(NL + NL), ['RQ1 Is it needed?', 'Inference step. One call to a model.'])
        [table] = paper['figures']
        self.assertEqual((table['label'], table['caption'], table['images']), ('Table 2', 'Results.', []))
        self.assertEqual(table['rows'], [['', 'Accuracy'], ['SAC', '70.2']])

    def test_a_heading_without_its_paragraph_stays_out_and_spans_keep_columns(self):
        html = r'''<html><body><article><section><h2 class="ltx_title_section">G.1 One</h2>
        <div class="ltx_para"><p class="ltx_p">First text.</p></div>
        <section class="ltx_paragraph"><h5 class="ltx_title ltx_title_paragraph">Compaction prompt</h5>
        <div class="ltx_listing"><div class="ltx_listingline">code here</div></div></section></section>
        <section><h2 class="ltx_title_section">G.2 Two</h2><div class="ltx_para"><p class="ltx_p">As described.</p></div>
        <figure class="ltx_table"><span class="ltx_tabular"><span class="ltx_tr"><span class="ltx_td ltx_colspan ltx_colspan_2">Accuracy</span><span class="ltx_td">Cost</span></span>
        <span class="ltx_tr"><span class="ltx_td">1</span><span class="ltx_td">2</span><span class="ltx_td">3</span></span></span>
        <figcaption>Table 1: T.</figcaption></figure></section></article></body></html>'''
        paper = parse_article(html, 'https://arxiv.org/html/2611.05306')
        self.assertEqual([s['text'] for s in paper['sections']], ['First text.', 'As described.'])
        self.assertEqual(paper['figures'][0]['rows'], [['Accuracy', '', 'Cost'], ['1', '2', '3']])

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
