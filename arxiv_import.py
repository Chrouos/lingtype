"""Load readable prose from arXiv HTML without copying it into the repository."""
import re
from html.parser import HTMLParser
from urllib.parse import urlparse


def canonical_url(url):
    parsed = urlparse(url.strip())
    match = re.fullmatch(r'/(?:abs|html)/(\d{4}\.\d{4,5}(?:v[1-9]\d*)?)/?', parsed.path)
    if parsed.scheme != 'https' or parsed.hostname != 'arxiv.org' or parsed.port not in (None, 443) or parsed.username or parsed.password or not match:
        raise ValueError('請輸入 arxiv.org 的論文摘要或 HTML 網址。')
    return 'https://arxiv.org/html/' + match.group(1)


class ArticleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.capture = None
        self.parts = []
        self.title = ''
        self.sections = []
        self.current = None
        self.license = ''
        self.authors = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set(attrs.get('class', '').split())
        if tag == 'meta' and attrs.get('name') == 'citation_author':
            self.authors.append(attrs.get('content', ''))
        if tag in ('br', 'img', 'meta', 'link', 'input', 'hr', 'wbr'):
            if tag == 'br' and self.capture:
                self.parts.append(' ')
            return
        self.stack.append((tag, classes))
        blocked = any(t in ('math', 'script', 'style', 'table', 'figure', 'nav') or bool(c & {'ltx_bibliography', 'ltx_note', 'ltx_ref'}) for t, c in self.stack)
        if blocked or self.capture:
            return
        if tag == 'a' and 'license' in attrs.get('href', '').lower():
            self.capture, self.parts = 'license', []
        elif tag == 'h1' and 'ltx_title_document' in classes:
            self.capture, self.parts = 'title', []
        elif classes & {'ltx_abstract'}:
            self.current = {'title': 'Abstract', 'text': ''}
            self.sections.append(self.current)
        elif tag in ('h2', 'h3', 'h4') and any(c.startswith('ltx_title_section') or c.startswith('ltx_title_subsection') for c in classes):
            self.capture, self.parts = 'section', []
        elif tag == 'p' and 'ltx_p' in classes and self.current is not None:
            self.capture, self.parts = 'paragraph', []

    def handle_data(self, data):
        if self.capture and not any(t in ('math', 'script', 'style', 'table', 'figure') or bool(c & {'ltx_note', 'ltx_ref'}) for t, c in self.stack):
            self.parts.append(data)

    def handle_endtag(self, tag):
        if not self.stack:
            return
        capture_tags = {'license': 'a', 'title': 'h1', 'section': ('h2', 'h3', 'h4'), 'paragraph': 'p'}
        expected = capture_tags.get(self.capture)
        if expected and (tag == expected or isinstance(expected, tuple) and tag in expected):
            value = re.sub(r'\s+', ' ', ''.join(self.parts)).strip()
            if self.capture == 'title': self.title = value
            elif self.capture == 'section' and value:
                self.current = {'title': value, 'text': ''}
                self.sections.append(self.current)
            elif self.capture == 'paragraph' and value:
                self.current['text'] = '\n\n'.join(filter(None, (self.current['text'], value)))
            elif self.capture == 'license': self.license = value
            self.capture = None
            self.parts = []
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


def parse_article(html, url):
    parser = ArticleParser()
    parser.feed(html)
    sections = [section for section in parser.sections if section['text']]
    if not sections:
        raise ValueError('找不到可匯入的 HTML 段落；這篇論文可能沒有可用的 HTML 版本。')
    return {'title': parser.title or 'arXiv 論文', 'authors': parser.authors, 'sourceUrl': url,
            'license': parser.license or '請參考原文的授權標示', 'sections': sections}
