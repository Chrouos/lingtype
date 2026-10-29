import io
import json
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

    def test_html_prefers_the_article_over_menus(self):
        page = '<title>Ignored</title><meta property="og:title" content="The Harbour"><nav><p>Home About Contact Login Register</p></nav><article><h1>The Harbour</h1><p>Boats returned before dusk, one by one.</p><p>The lights flickered across the water all night.</p></article><footer><p>Copyright 2026 all rights reserved here.</p></footer>'
        result = html_to_text(page)
        self.assertEqual(result['title'], 'The Harbour')
        wiki = '<main><p>Touch typing is a style of typing.[1] It is fast.[citation needed]</p><h2>See also</h2><ul><li>Typewriter keyboard layouts and more</li></ul></main>'
        self.assertEqual(html_to_text(wiki)['text'], 'Touch typing is a style of typing. It is fast.')
        self.assertEqual(result['text'], 'The Harbour\n\nBoats returned before dusk, one by one.\n\nThe lights flickered across the water all night.')

    def test_docx_paragraphs(self):
        document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world.</w:t></w:r></w:p><w:p><w:r><w:t>Second one.</w:t></w:r></w:p></w:body></w:document>'
        result = extract_file('Essay.docx', zipped({'word/document.xml': document}))
        self.assertEqual(result, {'title': 'Essay', 'text': 'Hello world.\n\nSecond one.'})

    def test_epub_chapters_become_sections_in_reading_order(self):
        chapter = lambda title, body: f'<html><body><h1>{title}</h1><p>{body}</p></body></html>'
        long = 'The quiet morning stretched across the hills and valleys. ' * 8
        book = zipped({
            'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
            'OEBPS/book.opf': '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>A Small Book</dc:title></metadata><manifest><item id="c" href="cover.xhtml"/><item id="b" href="two.xhtml"/><item id="a" href="one.xhtml"/></manifest><spine><itemref idref="c"/><itemref idref="a"/><itemref idref="b"/></spine></package>',
            'OEBPS/cover.xhtml': '<html><body><p>Cover</p></body></html>',
            'OEBPS/one.xhtml': chapter('Chapter One', long),
            'OEBPS/two.xhtml': chapter('Chapter Two', long),
        })
        result = extract_file('book.epub', book)
        self.assertEqual(result['title'], 'A Small Book')
        self.assertEqual([section['title'] for section in result['sections']], ['Chapter One', 'Chapter Two'])
        self.assertTrue(result['text'].startswith('Chapter One\n\nThe quiet morning'))

    def test_pdf_text(self):
        result = extract_file('paper.pdf', tiny_pdf('Typing builds reading fluency.'))
        self.assertEqual(result['text'], 'Typing builds reading fluency.')
        self.assertEqual(result['title'], 'paper')

    def test_subtitles_and_rejections(self):
        srt = '1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:02,000 --> 00:00:03,000\n<i>General Kenobi.</i>\n'
        self.assertEqual(extract_file('clip.srt', srt.encode())['text'], 'Hello there. General Kenobi.')
        with self.assertRaises(ValueError): extract_file('virus.exe', b'MZ')
        with self.assertRaises(ValueError): extract_file('empty.txt', b'   ')
        with self.assertRaises(ValueError): extract_file('broken.docx', b'not a zip')
        bomb = zipped({'word/document.xml': 'x'})
        with patch.object(importers, 'MAX_UNZIPPED', 0):
            with self.assertRaises(ValueError): extract_file('big.docx', bomb)


class WebAndYoutubeTests(unittest.TestCase):
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
