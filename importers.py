"""Turn documents, web articles and YouTube subtitles into plain English text for practice."""
import ipaddress
import io
import posixpath
import re
import socket
import zipfile
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree

MAX_TEXT = 1_000_000
MAX_UNZIPPED = 50_000_000
MAX_PAGE = 5_000_000
SKIPPED_TAGS = {'script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'form', 'svg', 'figure', 'button', 'template', 'iframe', 'select'}
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

    def __init__(self):
        super().__init__(convert_charrefs=True)
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
        if tag == 'meta' and attrs.get('property') == 'og:title':
            self.meta_title = attrs.get('content') or ''
        if tag == 'title':
            self.in_title = True
        if tag in SKIPPED_TAGS:
            self.skip += 1
        if tag in self.depth:
            self.depth[tag] += 1
        if tag in BLOCK_TAGS and not self.skip:
            self.flush()
            self.block = (tag, [])
        if tag == 'br' and self.block:
            self.block[1].append(' ')

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        if tag in BLOCK_TAGS:
            self.flush()
        if tag in SKIPPED_TAGS and self.skip:
            self.skip -= 1
        if tag in self.depth and self.depth[tag]:
            self.depth[tag] -= 1

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif self.block and not self.skip:
            self.block[1].append(data)

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

    def result(self):
        self.flush()
        # A page's own article wins when it holds most of the prose; otherwise use every paragraph.
        body_size = sum(len(part) for part in self.parts['body'])
        for scope in ('article', 'main'):
            if sum(len(part) for part in self.parts[scope]) >= max(400, body_size * 0.3):
                paragraphs = self.parts[scope]
                break
        else:
            paragraphs = self.parts['body']
        for index, part in enumerate(paragraphs):
            if part in self.headings and part.lower().strip(' :') in END_HEADINGS:
                paragraphs = paragraphs[:index]
                break
        paragraphs = [CITATION.sub('', part).strip() for part in paragraphs if len(part.split()) >= 4 or part in self.headings]
        title = (self.meta_title or self.title or (self.headings[0] if self.headings else '')).strip()
        return {'title': re.sub(r'\s+', ' ', title)[:100], 'text': tidy('\n\n'.join(paragraphs))}


def html_to_text(html):
    parser = ReadableParser()
    parser.feed(html)
    parser.close()
    return parser.result()


def decode(data):
    for encoding in ('utf-8-sig', 'utf-16'):
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
    paragraphs = []
    for paragraph in root.iter(f'{word}p'):
        text = ''.join((node.text or '') if node.tag == f'{word}t' else ' ' for node in paragraph.iter() if node.tag in (f'{word}t', f'{word}tab', f'{word}br'))
        if text.strip():
            paragraphs.append(text)
    return {'title': '', 'text': tidy('\n\n'.join(paragraphs))}


def epub_to_text(data):
    """Each chapter of the book's reading order becomes a section; covers and contents pages are skipped."""
    archive = open_zip(data)
    try:
        container = ElementTree.fromstring(archive.read('META-INF/container.xml'))
        opf_path = next(node.get('full-path') for node in container.iter() if node.tag.endswith('rootfile'))
        opf = ElementTree.fromstring(archive.read(opf_path))
    except (KeyError, StopIteration, ElementTree.ParseError) as error:
        raise ValueError('EPUB 檔案內容無法讀取。') from error
    base = posixpath.dirname(opf_path)
    manifest = {node.get('id'): node.get('href') for node in opf.iter() if node.tag.endswith('}item')}
    book_title = next((node.text for node in opf.iter() if node.tag.endswith('}title') and node.text), '')
    sections = []
    for ref in (node.get('idref') for node in opf.iter() if node.tag.endswith('}itemref')):
        href = manifest.get(ref)
        if not href:
            continue
        try:
            page = html_to_text(decode(archive.read(posixpath.normpath(posixpath.join(base, href)))))
        except KeyError:
            continue
        if len(page['text']) < 300:
            continue
        title = page['title'] if page['title'] and page['title'] != book_title else f'{len(sections) + 1}'
        sections.append({'title': title[:100], 'text': page['text']})
    return {'title': book_title.strip()[:100], 'text': '\n\n'.join(section['text'] for section in sections), 'sections': sections}


def pdf_to_text(data):
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or '' for page in reader.pages[:2000]]
    except ImportError as error:
        raise RuntimeError('尚未安裝 pypdf，請執行 python -m pip install --target .deps -r requirements.txt。') from error
    except Exception as error:
        raise ValueError('PDF 內容無法讀取，可能是掃描圖片或受密碼保護。') from error
    text = '\n\n'.join(pages)
    text = re.sub(r'(\w)-\n(\w)', r'\1\2', text)
    # A line that ends a sentence and is shorter than the page measure usually ends a paragraph.
    text = re.sub(r'([.!?"”])\n(?=[A-Z“"])', r'\1\n\n', text)
    title = ''
    try:
        title = str((reader.metadata or {}).get('/Title') or '')
    except Exception:
        pass
    return {'title': title.strip()[:100], 'text': tidy(text)}


def subtitle_to_text(data):
    blocks = re.split(r'\n\s*\n', decode(data).replace('\r\n', '\n'))
    lines = []
    for block in blocks:
        rows = block.strip().split('\n')
        timing = next((i for i, row in enumerate(rows) if '-->' in row), None)
        if timing is None:
            continue
        text = re.sub(r'<[^>]+>', '', ' '.join(rows[timing + 1:])).strip()
        if text and (not lines or text != lines[-1]):
            lines.append(text)
    return {'title': '', 'text': captions_to_text([{'text': line, 'start': i * 3.0, 'duration': 3.0} for i, line in enumerate(lines)])}


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
def public_url(url):
    parts = urlsplit(url.strip())
    if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password:
        raise ValueError('請輸入 http 或 https 網址。')
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == 'https' else 80))}
    except socket.gaierror as error:
        raise ValueError('找不到這個網址的伺服器。') from error
    if not addresses or not all(ipaddress.ip_address(address.split('%')[0]).is_global for address in addresses):
        raise ValueError('不能匯入本機或內部網路的網址。')
    return url.strip()


class PublicRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, public_url(urljoin(req.full_url, newurl)))


def fetch_article(url, opener=None):
    request = Request(public_url(url), headers={'User-Agent': 'Mozilla/5.0 (Lingtype personal reading tool)', 'Accept': 'text/html,application/xhtml+xml'})
    with (opener or build_opener(PublicRedirect)).open(request, timeout=20) as response:
        kind = response.headers.get('Content-Type', '')
        if 'html' not in kind:
            raise ValueError('這個網址不是網頁文章。')
        content = response.read(MAX_PAGE + 1)
        if len(content) > MAX_PAGE:
            raise ValueError('網頁超過 5 MB，無法匯入。')
        charset = response.headers.get_content_charset() or 'utf-8'
    result = html_to_text(content.decode(charset, errors='replace'))
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


def captions_to_text(snippets):
    """Join caption pieces into paragraphs; unpunctuated automatic captions are broken into short lines."""
    cleaned = clean_captions(snippets)
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
    try:
        if api is None:
            from youtube_transcript_api import YouTubeTranscriptApi
            api = YouTubeTranscriptApi()
        listing = api.list(video)
    except ImportError as error:
        raise RuntimeError('尚未安裝 youtube-transcript-api，請執行 python -m pip install --target .deps -r requirements.txt。') from error
    except Exception as error:
        raise ValueError('無法取得這部影片的字幕；影片可能不存在、不公開或沒有字幕。') from error
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
