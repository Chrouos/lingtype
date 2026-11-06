"""Load readable prose, figures and formulas from arXiv HTML without copying it into the repository."""
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

# A formula that cannot be typed sits in the text as one private-use character; the reader draws it and the caret skips it.
FORMULA_BASE = 0xE000
MAX_FORMULAS = 6000
MATH_TAGS = {'math', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'mrow', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'mpadded',
             'mphantom', 'menclose', 'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mmultiscripts',
             'mprescripts', 'none', 'mtable', 'mtr', 'mtd', 'semantics'}
MATH_ATTRS = {'mathvariant', 'display', 'stretchy', 'fence', 'separator', 'lspace', 'rspace', 'accent', 'accentunder',
              'movablelimits', 'largeop', 'symmetric', 'linethickness', 'columnalign', 'rowspacing', 'columnspacing',
              'width', 'height', 'depth', 'scriptlevel', 'displaystyle', 'minsize', 'maxsize', 'notation', 'columnspan', 'rowspan'}
SAFE_VALUE = re.compile(r'[\w.%#+ -]{1,40}')
SKIP_TAGS = {'script', 'style', 'nav', 'cite', 'button', 'svg', 'header', 'footer', 'annotation', 'annotation-xml'}
SKIP_CLASSES = {'ltx_bibliography', 'ltx_note', 'ltx_authors', 'ltx_dates', 'ltx_pagination', 'ltx_eqn_eqno', 'ltx_tag_equation'}
IMAGE_URL = re.compile(r'https://arxiv\.org/html/(?!.*\.\.)[\w./-]+\.(?:png|jpe?g|gif|svg|webp)', re.I)
CAPTION_LABEL = re.compile(r'((?:Figure|Fig\.|Table|Algorithm|Listing)\s*[A-Za-z]?\d+(?:\.\d+)?)\s*[:.]?\s*')
VOID = {'br', 'img', 'meta', 'link', 'input', 'hr', 'wbr', 'source', 'col', 'area', 'base', 'param', 'track', 'embed'}


def canonical_url(url):
    parsed = urlparse(url.strip())
    match = re.fullmatch(r'/(?:abs|html|pdf)/(\d{4}\.\d{4,5}(?:v[1-9]\d*)?)(?:\.pdf)?/?', parsed.path)
    if parsed.scheme != 'https' or parsed.hostname != 'arxiv.org' or parsed.port not in (None, 443) or parsed.username or parsed.password or not match:
        raise ValueError('請輸入 arxiv.org 的論文網址（abs、html 或 pdf）。')
    return 'https://arxiv.org/html/' + match.group(1)


def inline_math(tex):
    """A formula that is only a number or a short word (3.6x, $3.85, 256K) is typed as ordinary text."""
    value = tex.strip()
    for old, new in (('\\$', '$'), ('\\%', '%'), ('\\times', 'x'), ('\\,', ' '), ('\\;', ' '), ('\\:', ' '), ('\\!', ''), ('\\ ', ' '), ('~', ' '), ('\\approx', '~'), ('\\sim', '~')):
        value = value.replace(old, new)
    value = re.sub(r'\\(?:text|mathrm|mathbf|mathit|textbf|textit|texttt|mathsf|mathtt|operatorname)\b\s*', '', value)
    value = re.sub(r'\s+', ' ', value.replace('{', '').replace('}', '')).strip()
    return value if re.fullmatch(r"[A-Za-z0-9.,%$+\-/()=<>:~' ]{1,24}", value) else None


def tidy(text):
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'\s+([.,;:!?)\]])', r'\1', text)
    text = re.sub(r'([(\[])\s+', r'\1', text)
    return re.sub(r'\(\s*\)|\[\s*\]', '', text).strip()


class ArticleParser(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url = url
        self.stack = []
        self.frames = []
        self.title = ''
        self.license = ''
        self.authors = []
        self.sections = []
        self.current = None
        self.paragraphs = []
        self.formulas = []
        self.figures = []
        self.lead = ''

    def frame(self, kind):
        return next((f for f in reversed(self.frames) if f['kind'] == kind), None)

    def sink(self):
        # Text inside a figure or a displayed equation belongs only to its caption or cells, never to the paragraph around it.
        for frame in reversed(self.frames):
            if 'parts' in frame: return frame
            if frame['kind'] in ('figure', 'equation'): return None
        return None

    def open(self, kind, **values):
        self.frames.append({'kind': kind, 'depth': len(self.stack), **values})

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set((attrs.get('class') or '').split())
        if tag == 'meta' and attrs.get('name') == 'citation_author':
            self.authors.append(attrs.get('content', ''))
        if self.frame('skip'):
            if tag not in VOID: self.stack.append(tag)
            return
        math = self.frame('math')
        if tag in VOID:
            if tag == 'br' and self.sink() and not math: self.sink()['parts'].append(' ')
            if tag == 'img' and self.frame('figure') and attrs.get('src'): self.add_image(attrs['src'])
            return
        self.stack.append(tag)
        if tag in SKIP_TAGS or classes & SKIP_CLASSES:
            return self.open('skip')
        if math:
            node = [tag if tag in MATH_TAGS else 'mrow', {k: v for k, v in attrs.items() if k in MATH_ATTRS and v and SAFE_VALUE.fullmatch(v)}]
            math['nodes'][-1].append(node)
            math['nodes'].append(node)
            return
        if tag == 'math':
            tree = ['math', {}]
            return self.open('math', alttext=attrs.get('alttext', ''), display=attrs.get('display') == 'block', tree=tree, nodes=[tree])
        figure = self.frame('figure')
        if tag == 'figure' and classes & {'ltx_figure', 'ltx_table'} and not figure:
            return self.open('figure', table='ltx_table' in classes, images=[], rows=[], caption='', at=(len(self.sections) - 1, self.paragraph_count()))
        if figure:
            if tag == 'object' and attrs.get('data'): self.add_image(attrs['data'])
            elif tag == 'figcaption' and not self.frame('caption'): self.open('caption', parts=[])
            elif (tag == 'tr' or 'ltx_tr' in classes) and not self.frame('caption') and not self.frame('cell'): figure['rows'].append([])
            elif (tag in ('td', 'th') or 'ltx_td' in classes) and figure['rows'] and not self.frame('caption') and not self.frame('cell'):
                spans = [int(c[12:]) for c in classes if c.startswith('ltx_colspan_') and c[12:].isdigit()]
                span = int(attrs['colspan']) if (attrs.get('colspan') or '').isdigit() else spans[0] if spans else 1
                self.open('cell', parts=[], span=max(1, min(span, 30)))
            return
        if tag == 'table' or 'ltx_listing' in classes:
            self.lead = ''
        if 'ltx_listing' in classes:
            return self.open('skip')
        if tag == 'table':
            return self.open('equation', tokens=[]) if classes & {'ltx_equation', 'ltx_equationgroup'} and not self.frame('equation') else self.open('skip')
        if self.frame('equation') or self.sink():
            return
        if tag == 'a' and 'license' in (attrs.get('href') or '').lower():
            self.open('license', parts=[])
        elif tag == 'h1' and 'ltx_title_document' in classes:
            self.open('title', parts=[])
        elif 'ltx_abstract' in classes:
            self.start_section('Abstract')
            self.open('abstract')
        elif tag in ('h2', 'h3', 'h4') and any(c.startswith(('ltx_title_section', 'ltx_title_subsection', 'ltx_title_appendix')) for c in classes):
            self.open('heading', parts=[])
        elif tag in ('h5', 'h6') and 'ltx_title_paragraph' in classes and self.current is not None:
            self.open('lead', parts=[])
        elif 'ltx_tag_item' in classes and self.current is not None:
            self.open('lead', parts=[])
        elif tag == 'p' and 'ltx_p' in classes and self.current is not None:
            self.open('paragraph', parts=[])

    def add_image(self, src):
        url = urljoin(self.url, src)
        figure = self.frame('figure')
        if IMAGE_URL.fullmatch(url) and url not in figure['images'] and len(figure['images']) < 12:
            figure['images'].append(url)

    def handle_data(self, data):
        if self.frame('skip'):
            return
        math = self.frame('math')
        if math:
            if math['nodes'] and data.strip(): math['nodes'][-1].append(data.strip())
            return
        sink = self.sink()
        if sink: sink['parts'].append(data)

    def handle_endtag(self, tag):
        if tag in VOID or tag not in self.stack:
            return
        del self.stack[len(self.stack) - 1 - self.stack[::-1].index(tag):]
        while self.frames and self.frames[-1]['depth'] > len(self.stack):
            self.close_frame(self.frames.pop())
        math = self.frame('math')
        if math:
            del math['nodes'][max(1, len(self.stack) - math['depth'] + 1):]

    def close_frame(self, frame):
        kind = frame['kind']
        if kind == 'math':
            return self.close_math(frame)
        if kind == 'figure':
            return self.close_figure(frame)
        if kind == 'equation':
            if frame['tokens'] and self.current is not None:
                self.add_paragraph(' '.join(frame['tokens']))
            return
        if kind == 'abstract':
            self.current = None
            return
        if 'parts' not in frame:
            return
        text = tidy(''.join(frame['parts']))
        if kind == 'title': self.title = text
        elif kind == 'license': self.license = text
        elif kind == 'heading' and text: self.start_section(text)
        elif kind == 'lead':
            self.lead = text
        elif kind == 'paragraph' and text:
            if self.current['title'] == 'Abstract' and not self.current['paragraphs']:
                text = re.sub(r'^Abstract[.:]\s*', '', text)
            if text and self.lead: text = f'{self.lead} {text}'
            self.lead = ''
            if text: self.add_paragraph(text)
        elif kind == 'caption':
            # A table made of several parts may carry a caption for each; the first numbered one names the whole.
            figure = self.frame('figure')
            if figure and (not figure['caption'] or (CAPTION_LABEL.match(text) and not CAPTION_LABEL.match(figure['caption']))): figure['caption'] = text
        elif kind == 'cell':
            figure = self.frame('figure')
            if figure and figure['rows'] and len(figure['rows'][-1]) < 30:
                figure['rows'][-1].extend([text[:300]] + [''] * (frame.get('span', 1) - 1))
                del figure['rows'][-1][30:]

    def close_math(self, frame):
        tree = frame['tree']
        tex = frame['alttext'] or plain(tree)
        target = self.frame('equation') or self.sink()
        if not target:
            return
        if target['kind'] in ('title', 'heading', 'license'):
            target['parts'].append(inline_math(tex) or tex)
            return
        text = None if frame['display'] else inline_math(tex)
        if text is None:
            if len(self.formulas) >= MAX_FORMULAS or not tree[2:]:
                return
            text = chr(FORMULA_BASE + len(self.formulas))
            self.formulas.append({'tex': tex[:2000], 'display': frame['display'], 'tree': tree})
        if target['kind'] == 'equation': target['tokens'].append(text)
        else: target['parts'].append(text)

    def close_figure(self, frame):
        rows = [row for row in frame['rows'] if any(row)][:200]
        if not frame['images'] and not rows:
            return
        caption = frame['caption']
        match = CAPTION_LABEL.match(caption)
        label = match.group(1) if match else ''
        self.figures.append({'label': label, 'kind': 'table' if frame['table'] else 'figure', 'images': frame['images'],
                             'caption': caption[match.end():] if match else caption, **({'rows': rows} if rows else {}),
                             'at': frame['at']})

    def start_section(self, title):
        self.lead = ''
        self.current = {'title': title, 'paragraphs': []}
        self.sections.append(self.current)

    def paragraph_count(self):
        return len(self.current['paragraphs']) if self.current else 0

    def add_paragraph(self, text):
        self.current['paragraphs'].append(text)


def plain(node):
    if isinstance(node, str):
        return node
    return ''.join(plain(child) for child in node[2:])


def parse_article(html, url):
    parser = ArticleParser(url)
    parser.feed(html)
    parser.close()
    figures = []
    for figure in parser.figures:
        section, after = figure.pop('at')
        paragraphs = parser.sections[section]['paragraphs'] if 0 <= section < len(parser.sections) else []
        if after < len(paragraphs): figure['anchor'], figure['where'] = paragraphs[after][:80], 'start'
        elif paragraphs: figure['anchor'], figure['where'] = paragraphs[-1][-80:], 'end'
        figures.append(figure)
    sections = [{'title': s['title'], 'text': '\n\n'.join(s['paragraphs'])} for s in parser.sections if s['paragraphs']]
    if not sections:
        raise ValueError('找不到可匯入的 HTML 段落；這篇論文可能沒有可用的 HTML 版本。')
    return {'title': parser.title or 'arXiv 論文', 'authors': parser.authors, 'sourceUrl': url,
            'license': parser.license or '請參考原文的授權標示', 'sections': sections,
            **({'formulas': parser.formulas} if parser.formulas else {}), **({'figures': figures} if figures else {})}
