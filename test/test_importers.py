import io

NL = chr(10)
import json
from email.message import Message
import sys
import tempfile
import threading
import unittest
import zipfile
from functools import partial
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '.deps'))
import importers
from importers import captions_to_text, extract_file, html_to_text, public_url, youtube_id, youtube_transcript


def zipped(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def tiny_pdf(text):
    """A one-page PDF whose content stream draws `text`."""
    stream = f'BT /F1 12 Tf 72 720 Td ({text}) Tj ET'.encode()
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
               b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    out, offsets = io.BytesIO(), []
    out.write(b'%PDF-1.4\n')
    for number, body in enumerate(objects, 1):
        offsets.append(out.tell())
        out.write(b'%d 0 obj\n' % number + body + b'\nendobj\n')
    xref = out.tell()
    out.write(b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1))
    for offset in offsets:
        out.write(b'%010d 00000 n \n' % offset)
    out.write(b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objects) + 1, xref))
    return out.getvalue()


class FileImportTests(unittest.TestCase):
    def test_plain_text_and_markdown_keep_paragraphs(self):
        result = extract_file('notes.md', 'First line\nstill first.\n\n\nSecond paragraph.'.encode())
        self.assertEqual(result, {'title': 'notes', 'text': 'First line still first.\n\nSecond paragraph.'})

    def test_common_legacy_text_and_bom_utf16_keep_their_characters(self):
        text = '“That’s right,” she said. — Yes.'
        for name, data in [('story.txt', text.encode('cp1252')), ('story.txt', text.encode('utf-16')),
                           ('story.txt', text.encode('utf-8-sig'))]:
            with self.subTest(data=data):
                self.assertEqual(extract_file(name, data)['text'], text)
        html = '<html><body><main><p>“That’s right,” she said.</p></main></body></html>'.encode('cp1252')
        self.assertEqual(extract_file('story.html', html)['text'], '“That’s right,” she said.')

    def test_bomless_utf16_english_is_not_imported_with_nul_characters(self):
        text = 'Hello there. This is a test. Café is open.'
        for encoding in ('utf-16-le', 'utf-16-be'):
            with self.subTest(encoding=encoding):
                self.assertEqual(extract_file('story.txt', text.encode(encoding))['text'], text)
        # Even-length legacy text has no such zero-byte signature.
        self.assertEqual(extract_file('story.txt', '“All ready.”'.encode('cp1252'))['text'], '“All ready.”')

    def test_html_prefers_the_article_over_menus(self):
        page = '<title>Ignored</title><meta property="og:title" content="The Harbour"><nav><p>Home About Contact Login Register</p></nav><article><h1>The Harbour</h1><p>Boats returned before dusk, one by one.</p><p>The lights flickered across the water all night.</p></article><footer><p>Copyright 2026 all rights reserved here.</p></footer>'
        result = html_to_text(page)
        self.assertEqual(result['title'], 'The Harbour')
        wiki = '<main><p>Touch typing is a style of typing.[1] It is fast.[citation needed]</p><h2>See also</h2><ul><li>Typewriter keyboard layouts and more</li></ul></main>'
        self.assertEqual(html_to_text(wiki)['text'], 'Touch typing is a style of typing. It is fast.')
        self.assertEqual(result['text'], 'The Harbour\n\nBoats returned before dusk, one by one.\n\nThe lights flickered across the water all night.')

    def test_short_dialogue_survives_html_file_and_web_import(self):
        page = b'<html><body><main><h1>A Dialogue</h1><p>Are you ready?</p><p>Yes.</p><p>Let us go.</p></main></body></html>'
        expected = 'A Dialogue\n\nAre you ready?\n\nYes.\n\nLet us go.'
        self.assertEqual(extract_file('dialogue.html', page)['text'], expected)
        response = io.BytesIO(page)
        response.headers = Message()
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        opener = SimpleNamespace(open=lambda request, timeout: response)
        self.assertEqual(importers.fetch_article('https://example.com/dialogue', opener)['text'], expected)

    def test_html_article_keeps_text_in_divs_and_inline_elements(self):
        page = (b'<html><body><nav>Navigation to other pages</nav><article><h1>Harbour</h1>'
                b'<div>The boats returned <span>before sunset</span>.</div>'
                b'<div>Everyone was relieved.</div><script>ignore me</script>'
                b'<p>They went home safely.</p></article><footer>Copyright belongs here</footer></body></html>')
        result = extract_file('harbour.html', page)
        self.assertEqual(result['text'], 'Harbour\n\nThe boats returned before sunset.\n\nEveryone was relieved.\n\nThey went home safely.')

    def test_html_fragment_without_body_keeps_article_text(self):
        fragment = b'<article><h1>Welcome</h1><div>The whole <span>story</span> is written here.</div><div>A second sentence.</div></article>'
        self.assertEqual(extract_file('article.html', fragment)['text'],
                         'Welcome\n\nThe whole story is written here.\n\nA second sentence.')

    def test_web_import_uses_declared_or_legacy_encoding_without_http_charset(self):
        def read_page(page, content_type='text/html'):
            response = io.BytesIO(page)
            response.headers = Message()
            response.headers['Content-Type'] = content_type
            return importers.fetch_article('https://example.com/story', SimpleNamespace(open=lambda request, timeout: response))['text']
        legacy = '<html><body><main><p>“That’s right,” she said.</p></main></body></html>'
        self.assertEqual(read_page(legacy.encode('cp1252')), '“That’s right,” she said.')
        declared = '<html><head><meta charset="windows-1251"></head><body><main><p>Привет мир.</p></main></body></html>'
        self.assertEqual(read_page(declared.encode('cp1251')), 'Привет мир.')
        self.assertEqual(read_page(legacy.encode('utf-16')), '“That’s right,” she said.')

    def test_docx_paragraphs(self):
        document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world.</w:t></w:r></w:p><w:p><w:r><w:t>Second one.</w:t></w:r></w:p></w:body></w:document>'
        result = extract_file('Essay.docx', zipped({'word/document.xml': document}))
        self.assertEqual(result, {'title': 'Essay', 'text': 'Hello world.\n\nSecond one.'})

    def test_docx_nonbreaking_hyphens_and_carriage_returns(self):
        document = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:body><w:p><w:r><w:t>A well</w:t><w:noBreakHyphen/><w:t>known</w:t>'
                    '<w:cr/><w:t>example.</w:t><w:tab/><w:t>Next.</w:t><w:br/><w:t>Done.</w:t>'
                    '</w:r></w:p></w:body></w:document>')
        self.assertEqual(extract_file('essay.docx', zipped({'word/document.xml': document}))['text'],
                         'A well-known example. Next. Done.')

    def test_docx_nested_text_box_is_read_once_in_document_order(self):
        document = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:body><w:p><w:r><w:t>Before.</w:t><w:txbxContent>'
                    '<w:p><w:r><w:t>Text box.</w:t></w:r></w:p></w:txbxContent>'
                    '<w:t>After.</w:t></w:r></w:p><w:p><w:r><w:t>Next.</w:t>'
                    '</w:r></w:p></w:body></w:document>')
        self.assertEqual(extract_file('essay.docx', zipped({'word/document.xml': document}))['text'],
                         'Before.\n\nText box.\n\nAfter.\n\nNext.')

    def test_docx_alternate_content_uses_only_one_rendering(self):
        document = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body><w:p>'
                    '<mc:AlternateContent><mc:Choice Requires="w14"><w:txbxContent><w:p><w:r><w:t>Choice text.</w:t></w:r></w:p></w:txbxContent></mc:Choice>'
                    '<mc:Fallback><w:txbxContent><w:p><w:r><w:t>Fallback text.</w:t></w:r></w:p></w:txbxContent></mc:Fallback></mc:AlternateContent>'
                    '<mc:AlternateContent><mc:Choice Requires="w14"/><mc:Fallback><w:r><w:t>Only fallback.</w:t></w:r></mc:Fallback></mc:AlternateContent>'
                    '</w:p></w:body></w:document>')
        self.assertEqual(extract_file('essay.docx', zipped({'word/document.xml': document}))['text'],
                         'Choice text.\n\nOnly fallback.')

    def test_epub_chapters_become_sections_in_reading_order(self):
        chapter = lambda title, body: f'<html><body><h1>{title}</h1><p>{body}</p></body></html>'
        long = 'The quiet morning stretched across the hills and valleys. ' * 8
        book = zipped({
            'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
            'OEBPS/book.opf': '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>A Small Book</dc:title></metadata><manifest><item id="c" href="cover.xhtml"/><item id="b" href="two.xhtml"/><item id="a" href="one.xhtml"/></manifest><spine><itemref idref="c"/><itemref idref="a"/><itemref idref="b"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>',
            'OEBPS/cover.xhtml': '<html><body><p>Cover</p></body></html>',
            'OEBPS/one.xhtml': chapter('Chapter One', long),
            'OEBPS/two.xhtml': chapter('Chapter Two', long),
        })
        result = extract_file('book.epub', book)
        self.assertEqual(result['title'], 'A Small Book')
        self.assertEqual([section['title'] for section in result['sections']], ['Chapter One', 'Chapter Two'])
        self.assertTrue(result['text'].startswith('Chapter One\n\nThe quiet morning'))

    def test_epub_preserves_short_chapters_and_resolves_encoded_paths(self):
        book = zipped({
            'META-INF/container.xml': '<container><rootfile full-path="OPS/book.opf"/></container>',
            'OPS/book.opf': '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="nav" href="nav.xhtml" properties="nav"/><item id="a" href="chapters/Short%20one.xhtml#start"/><item id="b" href="../Other/Two.xhtml"/></manifest><spine><itemref idref="nav"/><itemref idref="a"/><itemref idref="b"/></spine></package>',
            'OPS/nav.xhtml': '<html><body><p>Navigation list.</p></body></html>',
            'OPS/chapters/Short one.xhtml': '<html><body><h1>First</h1><p>A short chapter.</p></body></html>',
            'Other/Two.xhtml': '<html><body><h1>Second</h1><p>Another short chapter.</p><p>Wait!</p><div>Outside <span>the paragraph</span> text.<p>Nested.</p>After nested.</div><h2>References</h2><p>Source [1].</p></body></html>',
        })
        result = extract_file('short.epub', book)
        self.assertEqual([section['title'] for section in result['sections']], ['First', 'Second'])
        self.assertEqual(result['text'], 'First\n\nA short chapter.\n\nSecond\n\nAnother short chapter.\n\nWait!\n\nOutside the paragraph text.\n\nNested.\n\nAfter nested.\n\nReferences\n\nSource [1].')

    def test_epub_accepts_encoded_colons_in_archive_paths(self):
        book = zipped({
            'META-INF/container.xml':'<container><rootfile full-path="OPS%3AArchive/book.opf"/></container>',
            'OPS:Archive/book.opf':'<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="Chapter%3A%20Intro.xhtml"/></manifest><spine><itemref idref="a"/></spine></package>',
            'OPS:Archive/Chapter: Intro.xhtml':'<html><body><p>Actual chapter text.</p></body></html>',
        })
        self.assertEqual(extract_file('book.epub', book)['text'], 'Actual chapter text.')

    def test_epub_keeps_body_text_outside_a_long_article_or_main(self):
        long = 'The long main passage continues. ' * 20
        for element in ('article', 'main'):
            book = zipped({
                'META-INF/container.xml':'<container><rootfile full-path="book.opf"/></container>',
                'book.opf':'<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
                'chapter.xhtml':f'<html><body><header><h1>Chapter heading</h1></header><p>Before.</p><{element}><p>{long}</p></{element}><aside>A footnote.</aside><footer>End note.</footer><nav><p>Navigation only.</p></nav><p>After.</p></body></html>',
            })
            with self.subTest(element=element):
                result = extract_file('book.epub', book)
                self.assertEqual(result['text'], f'Chapter heading\n\nBefore.\n\n{long.strip()}\n\nA footnote.\n\nEnd note.\n\nAfter.')

    def test_epub_rejects_missing_external_and_escaping_spine_paths(self):
        container = '<container><rootfile full-path="OPS/book.opf"/></container>'
        for href in ('missing.xhtml', 'https://example.com/chapter.xhtml', 'https%3A%2F%2Fexample.com%2Fchapter.xhtml', '%2e%2e/%2e%2e/outside.xhtml', '/absolute.xhtml', 'bad%5cname.xhtml'):
            opf = f'<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="{href}"/></manifest><spine><itemref idref="a"/></spine></package>'
            book = zipped({'META-INF/container.xml':container, 'OPS/book.opf':opf, 'outside.xhtml':'<p>Should not import</p>'})
            with self.subTest(href=href), self.assertRaisesRegex(ValueError, 'EPUB'):
                extract_file('broken.epub', book)
        book = zipped({'META-INF/container.xml':'<container><rootfile full-path="%2e%2e/outside.opf"/></container>', '../outside.opf':'<package/>'})
        with self.assertRaisesRegex(ValueError, 'EPUB'):
            extract_file('broken.epub', book)

    def test_pdf_text(self):
        result = extract_file('paper.pdf', tiny_pdf('Typing builds reading fluency.'))
        self.assertEqual(result['text'], 'Typing builds reading fluency.')
        self.assertEqual(result['title'], 'paper')
        self.assertNotIn('sections', result)
        self.assertEqual(result['pages'], [1])

    def test_pdf_untagged_repeated_text_and_sequential_numbers_are_preserved(self):
        pages = [f'Important repeated text.\n{number}\nTemperature {number} degrees.' for number in (1, 2, 3)]
        class Page:
            def __init__(self, text): self.text = text
            def extract_text(self, **_kwargs): return self.text
        class Reader:
            def __init__(self, data): self.pages, self.metadata = [Page(text) for text in pages], {}
        with patch('pypdf.PdfReader', Reader):
            result = extract_file('measurements.pdf', b'%PDF')
        for section, number in zip(result['sections'], (1, 2, 3)):
            self.assertIn('Important repeated text.', section['text'])
            self.assertIn(f'{number}', section['text'])
            self.assertIn(f'Temperature {number} degrees.', section['text'])
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import DecodedStreamObject, NameObject
        writer = PdfWriter()
        for number in (1, 2, 3):
            page = PdfReader(io.BytesIO(tiny_pdf('placeholder'))).pages[0]
            stream = DecodedStreamObject()
            stream.set_data(f'BT /F1 12 Tf 72 700 Td (Important repeated text.) Tj ET BT /F1 12 Tf 72 680 Td ({number}) Tj ET'.encode())
            page[NameObject('/Contents')] = stream
            writer.add_page(page)
        out = io.BytesIO(); writer.write(out)
        actual = extract_file('untagged.pdf', out.getvalue())
        for section, number in zip(actual['sections'], (1, 2, 3)):
            self.assertIn('Important repeated text.', section['text'])
            self.assertIn(str(number), section['text'])

    def test_pdf_explicit_artifact_can_be_removed_without_losing_body(self):
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import DecodedStreamObject, NameObject
        page = PdfReader(io.BytesIO(tiny_pdf('placeholder'))).pages[0]
        stream = DecodedStreamObject()
        stream.set_data(b'/Artifact BMC BT /F1 12 Tf 72 770 Td (Running header) Tj ET EMC BT /F1 12 Tf 72 700 Td (Important repeated text.) Tj ET BT /F1 12 Tf 72 680 Td (1) Tj ET')
        page[NameObject('/Contents')] = stream
        self.assertIn('Running header', page.extract_text())
        result = importers.pdf_page_text(page)
        self.assertNotIn('Running header', result)
        self.assertIn('Important repeated text.', result)
        self.assertIn('1', result)
        writer = PdfWriter(); writer.add_page(page)
        out = io.BytesIO(); writer.write(out)
        imported = extract_file('tagged.pdf', out.getvalue())
        self.assertNotIn('Running header', imported['text'])
        self.assertIn('Important repeated text.', imported['text'])
        self.assertIn('1', imported['text'])

    def test_pdf_ambiguous_marked_content_falls_back_to_complete_text(self):
        from pypdf import PdfReader
        from pypdf.generic import DecodedStreamObject, NameObject
        page = PdfReader(io.BytesIO(tiny_pdf('placeholder'))).pages[0]
        stream = DecodedStreamObject()
        stream.set_data(b'BT /F1 12 Tf 72 700 Td (Before ) Tj /Artifact BMC (uncertain) Tj EMC ( after.) Tj ET')
        page[NameObject('/Contents')] = stream
        self.assertEqual(importers.pdf_page_text(page), page.extract_text())

    def test_pdf_misaligned_visitor_text_preserves_full_extraction(self):
        class Page:
            def extract_text(self, visitor_text, **_kwargs):
                visitor_text('only part', None, None, None, None)
                return 'complete extracted content'
        self.assertEqual(importers.pdf_page_text(Page()), 'complete extracted content')

    def test_a_symbol_drawn_for_a_caption_colon_becomes_a_colon(self):
        from unittest.mock import patch
        class Page:
            def extract_text(self, **_kwargs): return 'Figure 2' + chr(0x22C3) + chr(0xFE00) + ' The burden of context.'
        class Reader:
            def __init__(self, data): self.pages, self.metadata = [Page()], {}
        with patch('pypdf.PdfReader', Reader):
            self.assertEqual(extract_file('paper.pdf', b'%PDF')['text'], 'Figure 2: The burden of context.')

    def test_pdf_line_wrapped_compound_keeps_its_hyphen(self):
        class Page:
            def extract_text(self, **_kwargs): return 'A well-\nknown example. A cross-\nsection follows.'
        class Reader:
            def __init__(self, data): self.pages, self.metadata = [Page()], {}
        with patch('pypdf.PdfReader', Reader):
            self.assertEqual(extract_file('paper.pdf', b'%PDF')['text'], 'A well-known example. A cross-section follows.')
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import DecodedStreamObject, NameObject
        page = PdfReader(io.BytesIO(tiny_pdf('placeholder'))).pages[0]
        stream = DecodedStreamObject()
        stream.set_data(b'BT /F1 12 Tf 72 700 Td (A well-) Tj 0 -20 Td (known example.) Tj ET')
        page[NameObject('/Contents')] = stream
        writer = PdfWriter(); writer.add_page(page)
        out = io.BytesIO(); writer.write(out)
        self.assertEqual(extract_file('real.pdf', out.getvalue())['text'], 'A well-known example.')

    def test_pdf_pages_become_sections_that_remember_their_page(self):
        from pypdf import PdfReader, PdfWriter
        writer = PdfWriter()
        for text in ('First page words.', '', 'Third page words.'):
            writer.add_page(PdfReader(io.BytesIO(tiny_pdf(text))).pages[0])
        out = io.BytesIO()
        writer.write(out)
        result = extract_file('book.pdf', out.getvalue())
        self.assertEqual(result['sections'], [{'title': 'p. 1', 'text': 'First page words.', 'page': 1}, {'title': 'p. 3', 'text': 'Third page words.', 'page': 3}])
        self.assertEqual(result['text'], 'First page words.\n\nThird page words.')
        self.assertEqual(result['pages'], [1, 3])

    def test_pdf_page_limit_rejects_before_extraction_and_allows_boundary(self):
        class Page:
            def __init__(self, text): self.text = text
            def extract_text(self, **_kwargs): return self.text
        class Reader:
            def __init__(self, data):
                self.pages = [Page('')] * 1999 + [Page('Last page.')]
                self.metadata = {}
        with patch('pypdf.PdfReader', Reader):
            result = importers.pdf_to_text(b'%PDF')
            self.assertEqual(result['text'], 'Last page.')
            self.assertEqual(result['pages'], [2000])
        class NeverExtract:
            def extract_text(self): raise AssertionError('must reject before extraction')
        class TooLong:
            def __init__(self, data): self.pages = [NeverExtract()] * 2001
        with patch('pypdf.PdfReader', TooLong):
            with self.assertRaisesRegex(importers.PdfPageLimitError, '2000 頁'):
                extract_file('book.pdf', b'%PDF')

    def test_subtitles_and_rejections(self):
        srt = '1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:02,000 --> 00:00:03,000\n<i>General Kenobi.</i>\n'
        self.assertEqual(extract_file('clip.srt', srt.encode())['text'], 'Hello there. General Kenobi.')
        repeated = ('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello.\n\n'
                    '00:00:01.000 --> 00:00:02.000\nHello.\n\n00:00:01.900 --> 00:00:02.500\nHello.\n\n'
                    '00:00:02.500 --> 00:00:03.000\nHello.\n\n00:00:03.100 --> 00:00:04.000\nHello.')
        self.assertEqual(extract_file('clip.vtt', repeated.encode())['text'], 'Hello. Hello. Hello. Hello.')
        with self.assertRaises(ValueError): extract_file('virus.exe', b'MZ')
        with self.assertRaises(ValueError): extract_file('empty.txt', b'   ')
        with self.assertRaises(ValueError): extract_file('broken.docx', b'not a zip')
        bomb = zipped({'word/document.xml': 'x'})
        with patch.object(importers, 'MAX_UNZIPPED', 0):
            with self.assertRaises(ValueError): extract_file('big.docx', bomb)

    def test_subtitles_preserve_parentheticals_and_decode_entities(self):
        vtt = ('WEBVTT\r\r00:00:01.000 --> 00:00:04.000\r'
               '<i>I think (perhaps) you &amp; I</i> [both] know 1 &lt; 2.\r')
        self.assertEqual(extract_file('clip.vtt', vtt.encode())['text'],
                         'I think (perhaps) you & I [both] know 1 < 2.')

    def test_subtitles_preserve_angle_bracket_text_but_strip_known_markup(self):
        vtt = ('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n'
               '<v Speaker><c.emphasis>3 < 5 > 4</c></v> and <i>bold</i> '
               '<00:00:02.000> words &lt; 7 &gt; 6; keep <unknown>text</unknown>.\n')
        self.assertEqual(extract_file('clip.vtt', vtt.encode())['text'],
                         '3 < 5 > 4 and bold words < 7 > 6; keep <unknown>text</unknown>.')
        srt = '1\n00:00:01,000 --> 00:00:02,000\n<b>1 < 2 > 0</b>\n'
        self.assertEqual(extract_file('clip.srt', srt.encode())['text'], '1 < 2 > 0')


class WebAndYoutubeTests(unittest.TestCase):
    def test_https_uses_the_original_hostname_for_certificate_verification(self):
        with patch('socket.getaddrinfo', return_value=[(2, 1, 6, '', ('93.184.216.34', 443))]), patch('socket.socket') as socket_class, patch('ssl.SSLContext.wrap_socket', autospec=True, side_effect=OSError('stop')) as wrap:
            with self.assertRaises(OSError): importers.fetch_article('https://example.com/')
            self.assertEqual(socket_class.return_value.connect.call_args.args[0], ('93.184.216.34', 443))
            self.assertEqual(wrap.call_args.kwargs['server_hostname'], 'example.com')
            self.assertTrue(wrap.call_args.args[0].check_hostname)

    def test_fetch_connects_to_validated_address_without_a_second_dns_lookup(self):
        from unittest.mock import MagicMock
        response = MagicMock()
        response.getheader.return_value = None
        response.status = 200
        response.headers.get.return_value = 'text/html'
        response.headers.get_content_charset.return_value = 'utf-8'
        response.read.return_value = b'<article><p>This is a public article with enough content to import successfully.</p></article>'
        with patch('socket.getaddrinfo', return_value=[(2, 1, 6, '', ('93.184.216.34', 80))]) as dns, patch('http.client.HTTPConnection.connect', autospec=True) as connect:
            connect.side_effect = OSError('stopped after connection target is selected')
            with self.assertRaises(OSError): importers.fetch_article('http://example.com/')
            self.assertEqual(dns.call_count, 1)
            self.assertEqual(connect.call_args.args[0].host, '93.184.216.34')

    def test_private_addresses_are_refused(self):
        def resolve(addresses):
            return lambda host, port: [(None, None, None, None, (address, port)) for address in addresses]
        with patch('socket.getaddrinfo', resolve(['127.0.0.1'])):
            with self.assertRaises(ValueError): public_url('http://localhost:8765/')
        with patch('socket.getaddrinfo', resolve(['10.0.0.5'])):
            with self.assertRaises(ValueError): public_url('https://intranet.example/')
        with patch('socket.getaddrinfo', resolve(['93.184.216.34'])):
            self.assertEqual(public_url('https://example.com/a'), 'https://example.com/a')
        with self.assertRaises(ValueError): public_url('file:///etc/passwd')

    def test_youtube_ids(self):
        for url in ['https://www.youtube.com/watch?v=arj7oStGLkU&t=30', 'https://youtu.be/arj7oStGLkU', 'https://m.youtube.com/shorts/arj7oStGLkU', 'https://www.youtube.com/embed/arj7oStGLkU']:
            self.assertEqual(youtube_id(url), 'arj7oStGLkU', url)
        self.assertIsNone(youtube_id('https://example.com/watch?v=arj7oStGLkU'))
        self.assertIsNone(youtube_id('https://www.youtube.com/watch?v=short'))

    def test_captions_join_into_paragraphs(self):
        punctuated = [{'text': 'So in college, I was a government major.', 'start': 0, 'duration': 2}, {'text': '(Laughter)', 'start': 2, 'duration': 1}, {'text': 'I had to write a lot of papers.', 'start': 3, 'duration': 2}]
        self.assertEqual(captions_to_text(punctuated), 'So in college, I was a government major. I had to write a lot of papers.')
        # Caption pieces split sentences anywhere, yet every paragraph still ends at a sentence.
        pieces = [{'text': f'Line {i} ends here. And then it', 'start': i, 'duration': 1} for i in range(30)]
        paragraphs = captions_to_text(pieces).split('\n\n')
        self.assertGreater(len(paragraphs), 1)
        self.assertTrue(all(part.endswith('.') for part in paragraphs[:-1]))
        automatic = [{'text': 'so in college i was a government major which meant', 'start': 0, 'duration': 2}, {'text': 'i had to write a lot of papers', 'start': 2, 'duration': 2}]
        self.assertEqual(captions_to_text(automatic), 'so in college i was a government major which meant i had\nto write a lot of papers')

    def test_translated_captions_follow_the_english_sentences_by_time(self):
        cue = lambda text, start, duration: {'text': text, 'start': start, 'duration': duration}
        english = [cue('So in college,', 12.6, 2.7), cue('I was a government major,', 15.3, 1.6), cue('which means I had to write\na lot of papers.', 16.9, 2.5), cue('Now, when a normal student writes a paper,', 19.4, 3), cue('they spread ‘the work’ out.', 22.4, 2)]
        chinese = [cue('譯者: Adrienne Lin\n審譯者: Regina Chu', 0, 12.6), cue('大學的時候，', 12.6, 2.7), cue('我主修政治學，', 15.3, 1.6), cue('這表示我必須要寫很多論文。', 16.9, 2.5), cue('一般學生寫論文時，', 19.4, 3), cue('會把工作分散開來。', 22.4, 2)]
        self.assertEqual(importers.align_translations(english, chinese), {
            'So in college, I was a government major, which means I had to write a lot of papers.': '大學的時候，我主修政治學，這表示我必須要寫很多論文。',
            "Now, when a normal student writes a paper, they spread 'the work' out.": '一般學生寫論文時，會把工作分散開來。'})
        korean = [cue('대학 시절,', 12.6, 2.7), cue('저는 정치학 전공이었고,', 15.3, 4)]
        self.assertEqual(list(importers.align_translations(english, korean, ' ').values()), ['대학 시절, 저는 정치학 전공이었고,'])
        self.assertEqual(importers.align_translations([cue('no punctuation at all here', 0, 2)], chinese), {})
        laughter = importers.align_translations([cue('It went well.', 40, 2)], [cue('很順利。（笑聲）', 40, 2)])
        self.assertEqual(laughter, {'It went well.': '很順利。'})
        pause = [cue('Now ...', 30, 1), cue("here's my brain.", 31, 2)]
        self.assertEqual(importers.align_translations(pause, [cue('現在……', 30, 1), cue('這是我的大腦。', 31, 2)]), {"Now ... here's my brain.": '現在……這是我的大腦。'})

    def test_transcript_prefers_human_english_captions(self):
        snippet = lambda text, start: SimpleNamespace(text=text, start=start, duration=1.0)
        class Listing:
            # English and human Chinese subtitles; no Japanese or Korean.
            def find_manually_created_transcript(self, languages):
                if 'en' in languages:
                    return SimpleNamespace(fetch=lambda: [snippet('Hello there.', 0), snippet('How are you?', 1)])
                if 'zh-TW' in languages:
                    return SimpleNamespace(fetch=lambda: [snippet('你好。', 0), snippet('你好嗎？', 1)])
                raise LookupError(languages)
        class Api:
            def list(self, video):
                self.video = video
                return Listing()
        api = Api()
        result = youtube_transcript('https://youtu.be/arj7oStGLkU', api=api, title=lambda video: 'A talk')
        self.assertEqual(api.video, 'arj7oStGLkU')
        self.assertEqual(result, {'title': 'A talk', 'text': 'Hello there. How are you?', 'sourceUrl': 'https://www.youtube.com/watch?v=arj7oStGLkU',
                                  'sentenceTranslations': {'zh': {'Hello there.': '你好。', 'How are you?': '你好嗎？'}}})
        class NoEnglish:
            def list(self, video):
                return SimpleNamespace(find_manually_created_transcript=lambda l: (_ for _ in ()).throw(LookupError()), find_generated_transcript=lambda l: (_ for _ in ()).throw(LookupError()))
        with self.assertRaises(ValueError): youtube_transcript('https://youtu.be/arj7oStGLkU', api=NoEnglish(), title=lambda video: '')

    def test_youtube_requests_have_timeouts_and_close_on_failure(self):
        calls = []
        class Session:
            def __enter__(self): return self
            def __exit__(self, *args): calls.append('closed')
            def request(self, method, url, **kwargs):
                calls.append(kwargs['timeout'])
                raise TimeoutError('stalled')
        class Api:
            def __init__(self, http_client): self.session = http_client
            def list(self, video): self.session.request('GET', 'https://www.youtube.com/')
        modules = {'requests': SimpleNamespace(Session=Session), 'youtube_transcript_api': SimpleNamespace(YouTubeTranscriptApi=Api)}
        with patch.dict(sys.modules, modules):
            with self.assertRaisesRegex(ValueError, '稍後重試'):
                youtube_transcript('https://youtu.be/arj7oStGLkU')
        self.assertEqual(calls, [(5, 15), 'closed'])



class ServerRouteTests(unittest.TestCase):
    def test_extract_and_import_routes(self):
        from public_library import PublicLibrary
        from server import Handler
        with tempfile.TemporaryDirectory() as folder:
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=folder))
            server.library = PublicLibrary(Path(folder) / 'books.db')
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Uploaded words.</w:t></w:r></w:p></w:body></w:document>'
            try:
                upload = Request(base + '/api/extract?name=' + quote('My essay.docx'), data=zipped({'word/document.xml': document}), headers={'Content-Type': 'application/octet-stream', 'Origin': base})
                self.assertEqual(json.load(urlopen(upload)), {'title': 'My essay', 'text': 'Uploaded words.'})
                class TooLong:
                    def __init__(self, data): self.pages = [None] * 2001
                with patch('pypdf.PdfReader', TooLong):
                    pdf = Request(base + '/api/extract?name=book.pdf', data=b'%PDF', headers={'Content-Type':'application/octet-stream', 'Origin':base})
                    with self.assertRaises(HTTPError) as limit:
                        urlopen(pdf)
                    self.assertEqual(limit.exception.code, 400)
                    self.assertEqual(json.load(limit.exception)['code'], 'pdf_page_limit')
                    limit.exception.close()
                epub = zipped({'META-INF/container.xml':'<container><rootfile full-path="OPS/book.opf"/></container>', 'OPS/book.opf':'<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="missing.xhtml"/></manifest><spine><itemref idref="a"/></spine></package>'})
                with self.assertRaises(HTTPError) as missing:
                    urlopen(Request(base + '/api/extract?name=broken.epub', data=epub, headers={'Content-Type':'application/octet-stream', 'Origin':base}))
                self.assertEqual(missing.exception.code, 400)
                self.assertEqual(json.load(missing.exception)['code'], 'epub_spine_invalid')
                missing.exception.close()
                with self.assertRaises(HTTPError) as refused:
                    urlopen(base + '/api/import?url=' + quote(base + '/'))
                self.assertEqual(refused.exception.code, 400)
                self.assertIn('內部網路', json.load(refused.exception)['error'])
                refused.exception.close()
                with self.assertRaises(HTTPError) as foreign:
                    urlopen(Request(base + '/api/extract?name=a.txt', data=b'Hello there.', headers={'Origin': 'https://other.example'}))
                self.assertEqual(foreign.exception.code, 403)
                foreign.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
