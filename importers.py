"""Turn documents, web articles and YouTube subtitles into plain English text for practice."""
import ipaddress
import io
import posixpath
import re
import socket
import zipfile
from html import unescape
from html.parser import HTMLParser
from urllib.parse import parse_qs, unquote, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree

MAX_TEXT = 1_000_000
MAX_UNZIPPED = 50_000_000
MAX_PAGE = 5_000_000
MAX_PDF_PAGES = 2000


class PdfPageLimitError(ValueError):
    pass


class EpubSpineError(ValueError):
    pass


SKIPPED_TAGS = {'script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'form', 'svg', 'figure', 'button', 'template', 'iframe', 'select'}
EPUB_SKIPPED_TAGS = {'script', 'style', 'noscript', 'nav', 'form', 'button', 'template', 'iframe', 'select'}
# Citation marks such as [1] or [citation needed] are not prose, and nothing after "References" is either.
CITATION = re.compile(r'\[\s*(?:\d+|[a-z]|[a-z]? ?\d+|[^\]]*needed|note[^\]]*|edit)\s*\]', re.IGNORECASE)
END_HEADINGS = {'see also', 'references', 'notes', 'external links', 'bibliography', 'further reading', 'sources', 'footnotes', 'citations', 'notes and references'}
BLOCK_TAGS = {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'dd', 'dt', 'figcaption', 'td'}


def tidy(text):
    text = text.replace('\r\n', '\n').replace('\r', '\n').replace(' ', ' ')
    paragraphs = [re.sub(r'\s+', ' ', part).strip() for part in re.split(r'\n\s*\n', text)]
    return '\n\n'.join(part for part in paragraphs if part)


def checked(result):
    if not result['text'].strip():
        raise ValueError('找不到可以練習的英文文字。')
    if len(result['text']) > MAX_TEXT:
        raise ValueError('文字超過 100 萬字元，請先刪減後再匯入。')
    return result


class ReadableParser(HTMLParser):
    """Collects the paragraphs of a page, preferring its <article> or <main> over menus and footers."""

    def __init__(self, preserve_book_text=False):
        super().__init__(convert_charrefs=True)
        self.preserve_book_text = preserve_book_text
        self.skipped_tags = EPUB_SKIPPED_TAGS if preserve_book_text else SKIPPED_TAGS
        self.in_body = False
        self.loose = []
        self.skip = 0
        self.depth = {'article': 0, 'main': 0}
        self.block = None
        self.parts = {'article': [], 'main': [], 'body': []}
        self.headings = []
        self.title = ''
        self.meta_title = ''
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in BLOCK_TAGS or tag in ('body', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'figure', 'br') or tag in self.skipped_tags:
            self.flush_loose()
        if tag == 'body':
            self.in_body = True
        if tag == 'meta' and attrs.get('property') == 'og:title':
            self.meta_title = attrs.get('content') or ''
        if tag == 'title':
            self.in_title = True
        if tag in self.skipped_tags:
            self.skip += 1
        if tag in self.depth:
            self.depth[tag] += 1
        if tag in BLOCK_TAGS and not self.skip:
            self.flush()
            self.block = (tag, [])
        if tag == 'br' and self.block:
            self.block[1].append(' ')

    def handle_endtag(self, tag):
        if tag in ('body', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'figure'):
            self.flush_loose()
        if tag == 'title':
            self.in_title = False
        if tag in BLOCK_TAGS:
            self.flush()
        if tag in self.skipped_tags and self.skip:
            self.skip -= 1
        if tag in self.depth and self.depth[tag]:
            self.depth[tag] -= 1
        if tag == 'body':
            self.in_body = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif self.block and not self.skip:
            self.block[1].append(data)
        elif (self.in_body or (not self.preserve_book_text and any(self.depth.values()))) and not self.skip:
            self.loose.append(data)

    def flush_loose(self):
        text = re.sub(r'\s+', ' ', ''.join(self.loose)).strip()
        self.loose.clear()
        if not text:
            return
        for scope in ('article', 'main'):
            if self.depth[scope]:
                self.parts[scope].append(text)
        self.parts['body'].append(text)

    def flush(self):
        if not self.block:
            return
        tag, chunks = self.block
        self.block = None
        text = re.sub(r'\s+', ' ', ''.join(chunks)).strip()
        if not text:
            return
        if tag in ('h1', 'h2', 'h3'):
            self.headings.append(text)
        for scope in ('article', 'main'):
            if self.depth[scope]:
                self.parts[scope].append(text)
        self.parts['body'].append(text)

    def result(self, *, preserve_book_text=False):
        self.flush()
        self.flush_loose()
        # EPUB spine documents are already selected in reading order; prose
        # outside an inner article/main is still part of that book page.
        paragraphs = self.parts['body']
        selected_scope = False
        if not preserve_book_text:
            # For general web pages, prefer a substantial article over menus.
            body_size = sum(len(part) for part in paragraphs)
            for scope in ('article', 'main'):
                scope_size = sum(len(part) for part in self.parts[scope])
                if scope_size and scope_size >= body_size * 0.3:
                    paragraphs = self.parts[scope]
                    selected_scope = True
                    break
        if not preserve_book_text:
            for index, part in enumerate(paragraphs):
                if part in self.headings and part.lower().strip(' :') in END_HEADINGS:
                    paragraphs = paragraphs[:index]
                    break
            # Short dialogue and captions inside an explicit article are prose,
            # even when they contain fewer than four words.
            paragraphs = [CITATION.sub('', part).strip() for part in paragraphs if selected_scope or len(part.split()) >= 4 or part in self.headings]
        title = (self.meta_title or self.title or (self.headings[0] if self.headings else '')).strip()
        return {'title': re.sub(r'\s+', ' ', title)[:100], 'text': tidy('\n\n'.join(paragraphs))}


def html_to_text(html, *, preserve_book_text=False):
    parser = ReadableParser(preserve_book_text=preserve_book_text)
    parser.feed(html)
    parser.close()
    return parser.result(preserve_book_text=preserve_book_text)


def decode(data):
    # An arbitrary even-length byte stream can decode as native-endian UTF-16
    # without raising, producing unrelated characters. Require a byte-order
    # mark or a strong zero-byte pattern before trying UTF-16.
    has_bom = data.startswith((b'\xff\xfe', b'\xfe\xff'))
    encodings = ('utf-16',) if has_bom else ('utf-8-sig', 'cp1252')
    if not has_bom and len(data) >= 4 and len(data) % 2 == 0:
        # Common BOM-less UTF-16 English text has zeros on one byte lane.
        # Require a strong asymmetric signal before attempting to decode it.
        sample = data[:4096]
        even, odd = sample[::2], sample[1::2]
        even_ratio, odd_ratio = even.count(0) / len(even), odd.count(0) / len(odd)
        encoding = 'utf-16-le' if odd_ratio >= 0.3 and even_ratio <= 0.05 else 'utf-16-be' if even_ratio >= 0.3 and odd_ratio <= 0.05 else None
        if encoding:
            try:
                return data.decode(encoding)
            except UnicodeDecodeError:
                pass
    for encoding in encodings:
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode('latin-1')


def open_zip(data):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        raise ValueError('檔案格式無法讀取。') from error
    if sum(info.file_size for info in archive.infolist()) > MAX_UNZIPPED:
        raise ValueError('檔案解壓縮後過大，無法匯入。')
    return archive


def docx_to_text(data):
    archive = open_zip(data)
    try:
        root = ElementTree.fromstring(archive.read('word/document.xml'))
    except (KeyError, ElementTree.ParseError) as error:
        raise ValueError('Word 檔案內容無法讀取。') from error
    word = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    paragraphs, chunks = [], []
    special = {f'{word}tab': ' ', f'{word}br': ' ', f'{word}cr': ' ', f'{word}noBreakHyphen': '-'}
    markup = '{http://schemas.openxmlformats.org/markup-compatibility/2006}'

    def flush():
        text = ''.join(chunks)
        chunks.clear()
        if text.strip():
            paragraphs.append(text)

    # Text boxes can contain paragraphs nested inside another paragraph. Walk
    # in document order and flush at each boundary so they are not copied into
    # the parent and then emitted a second time.
    stack, depth = [(root, False)], 0
    while stack:
        node, closing = stack.pop()
        if closing:
            if node.tag == f'{word}p':
                flush()
                depth -= 1
            continue
        if node.tag == f'{word}p':
            flush()
            depth += 1
        elif depth and node.tag == f'{word}t':
            chunks.append(node.text or '')
        elif depth and node.tag in special:
            chunks.append(special[node.tag])
        stack.append((node, True))
        children = list(node)
        if node.tag == f'{markup}AlternateContent':
            choices = [child for child in children if child.tag == f'{markup}Choice']
            fallback = next((child for child in children if child.tag == f'{markup}Fallback'), None)
            # Choice and Fallback are alternative renderings of the same content.
            # Prefer a choice containing text, then a fallback when available.
            selected = next((choice for choice in choices if any((text.text or '').strip() for text in choice.iter(f'{word}t'))), None)
            selected = selected if selected is not None else fallback if fallback is not None else next(iter(choices), None)
            children = [selected] if selected is not None else []
        stack.extend((child, False) for child in reversed(children))
    return {'title': '', 'text': tidy('\n\n'.join(paragraphs))}


def epub_to_text(data):
    """Each chapter of the book's reading order becomes a section; covers and contents pages are skipped."""
    archive = open_zip(data)
    try:
        container = ElementTree.fromstring(archive.read('META-INF/container.xml'))
        opf_path = next(node.get('full-path') for node in container.iter() if node.tag.endswith('rootfile'))
        if not isinstance(opf_path, str) or not opf_path:
            raise ValueError('EPUB 檔案內容無法讀取。')
        if urlsplit(opf_path).scheme or urlsplit(opf_path).netloc:
            raise EpubSpineError('EPUB 書籍路徑無效。')
        opf_path = unquote(opf_path)
        if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*://', opf_path) or opf_path.startswith('/') or '\\' in opf_path or '\0' in opf_path or posixpath.normpath(opf_path) == '..' or posixpath.normpath(opf_path).startswith('../'):
            raise EpubSpineError('EPUB 書籍路徑無效。')
        opf = ElementTree.fromstring(archive.read(opf_path))
    except (KeyError, StopIteration, ElementTree.ParseError) as error:
        raise ValueError('EPUB 檔案內容無法讀取。') from error
    base = posixpath.dirname(opf_path)
    manifest = {node.get('id'): node for node in opf.iter() if node.tag.endswith('}item')}
    def local_path(href):
        if not isinstance(href, str):
            return None
        parsed = urlsplit(href)
        if parsed.scheme or parsed.netloc or not parsed.path:
            return None
        path = unquote(parsed.path)
        if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*://', path) or path.startswith('/') or '\\' in path or '\0' in path:
            return None
        resolved = posixpath.normpath(posixpath.join(base, path))
        return None if resolved == '..' or resolved.startswith('../') else resolved
    covers = {path for node in opf.iter() if node.tag.endswith('}reference') and 'cover' in node.get('type', '').lower().split() if (path := local_path(node.get('href')))}
    book_title = next((node.text for node in opf.iter() if node.tag.endswith('}title') and node.text), '')
    sections = []
    for ref in (node.get('idref') for node in opf.iter() if node.tag.endswith('}itemref')):
        item = manifest.get(ref)
        if item is None:
            raise EpubSpineError('EPUB 閱讀順序引用了不存在的章節。')
        path = local_path(item.get('href'))
        if 'nav' in (item.get('properties') or '').split():
            continue
        if not path:
            raise EpubSpineError('EPUB 章節路徑無效。')
        if path in covers:
            continue
        try:
            page = html_to_text(decode(archive.read(path)), preserve_book_text=True)
        except KeyError as error:
            raise EpubSpineError('EPUB 閱讀順序中的章節檔案不存在。') from error
        if not page['text'].strip():
            continue
        title = page['title'] if page['title'] and page['title'] != book_title else f'{len(sections) + 1}'
        sections.append({'title': title[:100], 'text': page['text']})
    return {'title': book_title.strip()[:100], 'text': '\n\n'.join(section['text'] for section in sections), 'sections': sections}


def pdf_page_text(page):
    """Omit explicitly marked artifacts only when extraction can be aligned exactly.

    Repeated lines and sequential numbers alone are not proof of headers or
    page numbers. Preserve all text when marked-content boundaries are unclear.
    """
    stack, chunks = [], []
    state = {'in_text':False, 'artifact':False, 'operator':None, 'unsafe':False}

    def before(operator, operands, _cm, _tm):
        state['operator'] = operator
        if operator in (b'BMC', b'BDC'):
            if state['in_text'] or len(stack) >= 100:
                state['unsafe'] = True
            stack.append((stack[-1] if stack else False) or bool(operands and str(operands[0]) == '/Artifact'))
        elif operator == b'EMC':
            if state['in_text'] or not stack:
                state['unsafe'] = True
            if stack:
                stack.pop()
        elif operator == b'BT':
            if state['in_text']:
                state['unsafe'] = True
            state['in_text'] = True
            state['artifact'] = bool(stack and stack[-1])
        elif operator == b'ET' and not state['in_text']:
            state['unsafe'] = True
        elif operator == b'Do':
            # Nested form content can interleave visitor callbacks.
            state['unsafe'] = True

    def after(operator, _operands, _cm, _tm):
        if operator == b'ET':
            state['in_text'] = False
            state['artifact'] = False

    def visit(text, _cm, _tm, _font, _size):
        if len(chunks) >= 100000:
            state['unsafe'] = True
            return
        # BT can flush text preceding the current marked-content section.
        marked = state['in_text'] and state['artifact'] and state['operator'] != b'BT'
        chunks.append((text, marked))

    text = page.extract_text(visitor_operand_before=before, visitor_operand_after=after, visitor_text=visit) or ''
    if state['unsafe'] or state['in_text'] or stack or ''.join(part for part, _ in chunks) != text:
        return text
    return ''.join(part for part, marked in chunks if not marked)


def pdf_to_text(data):
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        if len(reader.pages) > MAX_PDF_PAGES:
            raise PdfPageLimitError(f'PDF 超過 {MAX_PDF_PAGES} 頁，請先拆分後再匯入。')
        pages = [pdf_page_text(page) for page in reader.pages]
    except ImportError as error:
        raise RuntimeError('尚未安裝 pypdf，請執行 python -m pip install --target .deps -r requirements.txt。') from error
    except PdfPageLimitError:
        raise
    except Exception as error:
        raise ValueError('PDF 內容無法讀取，可能是掃描圖片或受密碼保護。') from error
    # Each page with text becomes a section that remembers its page number, so the reader can show the page beside it.
    sections = []
    for number, page in enumerate(pages, 1):
        # A line-ending hyphen may be part of a real compound such as
        # "well-known". The extracted text alone cannot tell it apart from
        # discretionary hyphenation, so preserve the original character.
        page = re.sub(r'(\w)-\n(\w)', r'\1-\2', page)
        # Some paper fonts draw the colon after a figure or table number as an unrelated symbol.
        page = re.sub(r'\b((?:Figure|Fig\.|Table)\s*\d+)\s*\u22c3[\ufe00-\ufe0f]?', r'\1:', page)
        # A line that ends a sentence and is shorter than the page measure usually ends a paragraph.
        page = tidy(re.sub(r'([.!?"”])\n(?=[A-Z“"])', r'\1\n\n', page))
        if page:
            sections.append({'title': f'p. {number}', 'text': page, 'page': number})
    title = ''
    try:
        title = str((reader.metadata or {}).get('/Title') or '')
    except Exception:
        pass
    return {'title': title.strip()[:100], 'text': '\n\n'.join(section['text'] for section in sections),
            **({'sections': sections} if len(sections) > 1 else {}), **({'pages': [s['page'] for s in sections]} if sections else {})}


SUBTITLE_MARKUP = re.compile(r'</?(?:i|b|u|s|font|span|c|v|lang|ruby|rt)(?:\s[^<>]*|\.[^<>]*)?\s*>|<\d{2}:\d{2}(?::\d{2})?\.\d{3}>', re.IGNORECASE)


def subtitle_to_text(data):
    blocks = re.split(r'\n\s*\n', decode(data).replace('\r\n', '\n').replace('\r', '\n'))
    lines = []
    last_cue = None
    def seconds(stamp):
        total = 0
        for part in stamp.replace(',', '.').split(':'):
            total = total * 60 + float(part)
        return total
    for block in blocks:
        rows = block.strip().split('\n')
        timing = next((i for i, row in enumerate(rows) if '-->' in row), None)
        if timing is None:
            continue
        text = re.sub(r'\s+', ' ', unescape(SUBTITLE_MARKUP.sub('', ' '.join(rows[timing + 1:])))).strip()
        if text:
            times = re.match(r'^((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})', rows[timing].strip())
            start, end = (seconds(times.group(1)), seconds(times.group(2))) if times else (None, None)
            cue = (text, start, end)
            if not times or cue != last_cue:
                lines.append(text)
            last_cue = cue if times else None
    return {'title': '', 'text': captions_to_text([{'text': line, 'start': i * 3.0, 'duration': 3.0} for i, line in enumerate(lines)], preserve_text=True)}


def extract_file(name, data):
    suffix = posixpath.splitext(name.lower())[1]
    if suffix in ('.txt', '.md', '.markdown', '.text'):
        result = {'title': '', 'text': tidy(decode(data))}
    elif suffix in ('.html', '.htm', '.xhtml'):
        result = html_to_text(decode(data))
    elif suffix == '.docx':
        result = docx_to_text(data)
    elif suffix == '.epub':
        result = epub_to_text(data)
    elif suffix == '.pdf':
        result = pdf_to_text(data)
    elif suffix in ('.srt', '.vtt'):
        result = subtitle_to_text(data)
    else:
        raise ValueError('不支援這種檔案，請選擇 TXT、MD、PDF、DOCX、EPUB、HTML、SRT 或 VTT。')
    result['title'] = result['title'] or posixpath.splitext(posixpath.basename(name))[0][:100]
    return checked(result)


# Web pages: only public addresses, so the server cannot be pointed at the local network.
def resolve_public_url(url):
    parts = urlsplit(url.strip())
    if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password:
        raise ValueError('請輸入 http 或 https 網址。')
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == 'https' else 80))}
    except socket.gaierror as error:
        raise ValueError('找不到這個網址的伺服器。') from error
    if not addresses or not all(ipaddress.ip_address(address.split('%')[0]).is_global for address in addresses):
        raise ValueError('不能匯入本機或內部網路的網址。')
    return url.strip(), sorted(addresses)[0]


def public_url(url):
    return resolve_public_url(url)[0]


class PublicRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, urljoin(req.full_url, newurl))


def public_opener():
    # Validate each request, including redirects, and connect to the validated IP.
    import http.client
    from urllib.request import HTTPHandler, HTTPSHandler, ProxyHandler

    class CheckedHTTP(HTTPHandler):
        def http_open(self, req):
            _, address = resolve_public_url(req.full_url)
            port = urlsplit(req.full_url).port or 80
            return self.do_open(lambda host, **kw: http.client.HTTPConnection(address, port, **kw), req)

    class CheckedHTTPS(HTTPSHandler):
        def https_open(self, req):
            parts = urlsplit(req.full_url)
            _, address = resolve_public_url(req.full_url)
            class Connection(http.client.HTTPSConnection):
                def connect(self):
                    sock = socket.socket(socket.AF_INET6 if ':' in address else socket.AF_INET, socket.SOCK_STREAM)
                    try:
                        sock.settimeout(self.timeout)
                        sock.connect((address, parts.port or 443))
                        self.sock = self._context.wrap_socket(sock, server_hostname=parts.hostname)
                    except BaseException:
                        sock.close()
                        raise
            return self.do_open(Connection, req, context=self._context)

    return build_opener(ProxyHandler({}), CheckedHTTP(), CheckedHTTPS(), PublicRedirect())


def fetch_article(url, opener=None):
    if urlsplit(url.strip()).scheme not in ('http', 'https'):
        raise ValueError('請輸入 http 或 https 網址。')
    request = Request(url.strip(), headers={'User-Agent': 'Mozilla/5.0 (Lingtype personal reading tool)', 'Accept': 'text/html,application/xhtml+xml'})
    with (opener or public_opener()).open(request, timeout=20) as response:
        kind = response.headers.get('Content-Type', '')
        if 'html' not in kind:
            raise ValueError('這個網址不是網頁文章。')
        content = response.read(MAX_PAGE + 1)
        if len(content) > MAX_PAGE:
            raise ValueError('網頁超過 5 MB，無法匯入。')
        charset = response.headers.get_content_charset()
    # Many pages omit an HTTP charset but declare one in a meta tag; others
    # are legacy Windows text with no declaration at all. Avoid silently
    # replacing every non-UTF-8 byte in those pages.
    if not charset:
        for meta in re.findall(br'<meta\b[^>]*>', content[:4096], re.IGNORECASE):
            match = re.search(br'\bcharset\s*=\s*["\']?\s*([\w.-]+)', meta, re.IGNORECASE)
            if match:
                charset = match.group(1).decode('ascii')
                break
    if content.startswith((b'\xff\xfe', b'\xfe\xff', b'\xef\xbb\xbf')):
        text = decode(content)
    elif charset:
        try:
            text = content.decode(charset, errors='replace')
        except LookupError:
            text = decode(content)
    else:
        text = decode(content)
    result = html_to_text(text)
    result['sourceUrl'] = url.strip()
    return checked(result)


# YouTube subtitles.
def youtube_id(url):
    parts = urlsplit(url.strip())
    host = (parts.hostname or '').lower()
    if host == 'youtu.be':
        candidate = parts.path.strip('/').split('/')[0]
    elif host in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'):
        candidate = parse_qs(parts.query).get('v', [''])[0]
        match = re.match(r'/(?:shorts|embed|live)/([^/?#]+)', parts.path)
        if match:
            candidate = match.group(1)
    else:
        return None
    return candidate if re.fullmatch(r'[A-Za-z0-9_-]{11}', candidate or '') else None


SENTENCE = re.compile(r'[^.!?]+(?:[.!?]+["\u201d\u2019)]*|$)')
# The same keyboard equivalents as typeable() in site/sentences.mjs, so sentence keys match the browser's.
KEYBOARD = [('[\u2018\u2019\u201a\u201b\u2032]', "'"), ('[\u201c\u201d\u201e\u201f\u2033]', '"'), ('[\u2012\u2013\u2014\u2015\u2212]', '-'), ('\u2026', '...'), ('[\u00a0\u2007\u202f\u2009\u200a]', ' '), ('[\u200b\u200c\u200d\ufeff\u00ad]', '')]
# Human subtitles in the reader's languages, used as sentence translations when a video has them.
TRANSLATION_CAPTIONS = {'zh': ['zh-TW', 'zh-Hant', 'zh-HK'], 'ja': ['ja'], 'ko': ['ko']}


def typeable(text):
    for pattern, plain in KEYBOARD:
        text = re.sub(pattern, plain, text)
    return text


def clean_captions(snippets):
    cleaned = []
    for snippet in snippets:
        text = re.sub(r'\[[^\]]*\]|\([^)]*\)|\uff08[^\uff09]*\uff09|\u266a+|^>>\s*', ' ', snippet['text'].replace('\n', ' '))
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            cleaned.append({**snippet, 'text': text})
    return cleaned


def is_punctuated(cleaned):
    return bool(cleaned) and sum(bool(re.search(r'[.!?]', item['text'])) for item in cleaned) >= len(cleaned) * 0.15


def captions_to_text(snippets, *, preserve_text=False):
    """Join caption pieces into paragraphs; unpunctuated automatic captions are broken into short lines."""
    # Uploaded subtitles can contain spoken parentheticals and bracketed text;
    # the YouTube cleanup removes these as presumed sound descriptions.
    cleaned = snippets if preserve_text else clean_captions(snippets)
    if not cleaned:
        return ''
    paragraphs, current = [], []
    if is_punctuated(cleaned):
        # Whole sentences, about eighty words to a paragraph, so no paragraph starts mid-sentence.
        for sentence in SENTENCE.findall(' '.join(item['text'] for item in cleaned)):
            if sentence.strip():
                current.append(sentence.strip())
            if current and len(' '.join(current).split()) >= 80:
                paragraphs.append(' '.join(current))
                current = []
        if current:
            paragraphs.append(' '.join(current))
        return '\n\n'.join(paragraphs)
    words = 0
    for index, item in enumerate(cleaned):
        current.append(item['text'])
        words += len(item['text'].split())
        following = cleaned[index + 1] if index + 1 < len(cleaned) else None
        pause = following and following['start'] - (item['start'] + item['duration']) > 1.5
        if not following or (pause and words >= 25) or words >= 90:
            line_words = ' '.join(current).split()
            paragraphs.append('\n'.join(' '.join(line_words[i:i + 12]) for i in range(0, len(line_words), 12)))
            current, words = [], 0
    return '\n\n'.join(paragraphs)


def align_translations(english, translated, joiner=''):
    """Give each English sentence the translated captions shown while it is spoken, keyed by the typed sentence."""
    english, translated = clean_captions(english), clean_captions(translated)
    if not english or not translated or not is_punctuated(english):
        return {}
    text, spans = '', []
    for cue in english:
        text += ' ' if text else ''
        spans.append((len(text) + len(cue['text']), cue))
        text += cue['text']
    cue_at = lambda offset: next((cue for end, cue in spans if offset < end), spans[-1][1])
    sentences = []
    for match in SENTENCE.finditer(text):
        body = match.group().strip()
        if not body:
            continue
        first = cue_at(match.start() + len(match.group()) - len(match.group().lstrip()))
        last = cue_at(match.start() + len(match.group().rstrip()) - 1)
        # "Now ... here's my brain." is one sentence to the browser: a lowercase start continues the one before.
        if sentences and re.match(r'[a-z]', body):
            sentences[-1].update(text=sentences[-1]['text'] + ' ' + body, end=last['start'] + last['duration'])
            continue
        sentences.append({'text': body, 'start': first['start'], 'end': last['start'] + last['duration'], 'parts': []})
    opening = english[0]['start']
    for cue in translated:
        middle = cue['start'] + cue['duration'] / 2
        if middle < opening:
            continue  # translator credits shown before the talk begins
        target = next((sentence for sentence in sentences if sentence['start'] <= middle < sentence['end']), None)
        target = target or next((sentence for sentence in reversed(sentences) if sentence['start'] <= middle), sentences[0])
        target['parts'].append(cue['text'])
    return {typeable(sentence['text']): joiner.join(sentence['parts']) for sentence in sentences if sentence['parts']}


def youtube_title(video, opener=None):
    import json
    try:
        request = Request(f'https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v={video}', headers={'User-Agent': 'Mozilla/5.0'})
        with (opener or build_opener()).open(request, timeout=10) as response:
            return str(json.load(response).get('title', ''))[:100]
    except Exception:
        return ''


def youtube_transcript(url, api=None, title=youtube_title):
    video = youtube_id(url)
    if not video:
        raise ValueError('無法辨識這個 YouTube 網址。')
    if api is not None:
        return _youtube_transcript(video, api, title)
    try:
        from requests import Session
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError as error:
        raise RuntimeError('尚未安裝 youtube-transcript-api，請執行 python3 -m pip install --target .deps -r requirements.txt。') from error

    class TimedSession(Session):
        def request(self, method, url, **kwargs):
            kwargs.setdefault('timeout', (5, 15))
            return super().request(method, url, **kwargs)

    with TimedSession() as session:
        return _youtube_transcript(video, YouTubeTranscriptApi(http_client=session), title)


def _youtube_transcript(video, api, title):
    try:
        listing = api.list(video)
    except Exception as error:
        raise ValueError('無法取得這部影片的字幕。請確認影片公開且有字幕，或稍後重試；YouTube 也可能暫時限制連線。') from error
    preferred = ['en', 'en-US', 'en-GB', 'en-CA', 'en-AU']
    transcript = None
    for finder in ('find_manually_created_transcript', 'find_generated_transcript'):
        try:
            transcript = getattr(listing, finder)(preferred)
            break
        except Exception:
            continue
    if transcript is None:
        raise ValueError('這部影片沒有英文字幕。')
    as_cues = lambda fetched: [{'text': item.text, 'start': float(item.start), 'duration': float(item.duration)} for item in fetched]
    try:
        snippets = as_cues(transcript.fetch())
    except Exception as error:
        raise ValueError('YouTube 暫時拒絕提供字幕，請稍後再試。') from error
    result = checked({'title': title(video) or f'YouTube {video}', 'text': captions_to_text(snippets), 'sourceUrl': f'https://www.youtube.com/watch?v={video}'})
    translations = {}
    for language, codes in TRANSLATION_CAPTIONS.items():
        try:
            aligned = align_translations(snippets, as_cues(listing.find_manually_created_transcript(codes).fetch()), ' ' if language == 'ko' else '')
        except Exception:
            continue  # this language has no human subtitles; the page translates it another way
        if aligned:
            translations[language] = aligned
    if translations:
        result['sentenceTranslations'] = translations
    return result
