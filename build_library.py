"""Build the books every Lingtype server starts with.

Public-domain novels come from Project Gutenberg; papers are arXiv papers
whose authors chose a Creative Commons license. Run this file to download
them again and rewrite the workbooks in `library/`:

    PYTHONPATH=.deps python3 build_library.py

The server publishes every workbook in `library/` to its public shelf
when it starts (see `PublicLibrary.seed`).
"""
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

from arxiv_import import canonical_url, parse_article
from public_library import validate_workbook

LIBRARY = Path(__file__).resolve().parent / 'library'
USER_AGENT = 'Lingtype/1.0 (library builder)'
# The same bound the browser uses when it divides an imported section.
SECTION_LIMIT = 12000
PART_SIZE = 6000

ROMAN = r'[IVXL]+'
NOVELS = [
    # slug, Gutenberg id, title, author, chapter heading, whether the line after a heading names the chapter
    ('alice', 11, "Alice's Adventures in Wonderland", 'Lewis Carroll', rf'CHAPTER {ROMAN}\.', True),
    ('sherlock-holmes', 1661, 'The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', rf'{ROMAN}\. [A-Z][A-Z’\'\- ]+', False),
    ('time-machine', 35, 'The Time Machine', 'H. G. Wells', rf'\s*{ROMAN}\.\s*|\s*Epilogue\s*', True),
    ('peter-pan', 16, 'Peter Pan', 'J. M. Barrie', rf'Chapter {ROMAN}\.', True),
    ('wizard-of-oz', 55, 'The Wonderful Wizard of Oz', 'L. Frank Baum', rf'Chapter {ROMAN}', True),
    ('grimm', 2591, "Grimms' Fairy Tales", 'Jacob Grimm and Wilhelm Grimm', None, False),
]
# Every paper here carries CC BY 4.0 on arXiv; check the license before adding another.
PAPERS = [
    ('chain-of-thought', '2201.11903'),
    ('mistral-7b', '2310.06825'),
    ('llama', '2302.13971'),
    ('direct-preference-optimization', '2305.18290'),
    ('constitutional-ai', '2212.08073'),
]


def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': USER_AGENT}), timeout=60) as response:
        return response.read().decode('utf-8', errors='replace')


def gutenberg_body(raw):
    raw = raw.replace('\r\n', '\n')
    start = re.search(r'^\*\*\* START OF .*$', raw, re.M)
    end = re.search(r'^\*\*\* END OF .*$', raw, re.M)
    return raw[start.end():end.start() if end else None]


def paragraph(lines):
    text = ' '.join(line.strip() for line in lines)
    text = text.replace('_', '')
    return re.sub(r'\s+', ' ', text).strip()


def is_noise(text):
    return (not text or re.fullmatch(r'(?:\*\s*)+|THE END\.?|' + ROMAN + r'\.', text, re.I) is not None
            or text.startswith('[Illustration'))


SMALL_WORDS = {'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with'}


def heading_case(title):
    """'CHAPTER I. PETER BREAKS THROUGH' reads as 'Chapter I. Peter Breaks Through'; Roman numerals stay capitals."""
    words = []
    for index, word in enumerate(title.split(' ')):
        if re.fullmatch(ROMAN + r'\.?', word): words.append(word)
        elif not word.isupper(): words.append(word)
        elif index and word.lower() in SMALL_WORDS and not re.fullmatch(ROMAN + r'\.?', words[-1]): words.append(word.lower())
        else: words.append(word[0] + word[1:].lower())
    return ' '.join(words)


def novel_chapters(body, heading, titled):
    """Chapters as (title, paragraphs); everything before the first heading (title page, contents) is left out."""
    lines = body.split('\n')
    if heading is None:
        # Grimm: the contents list names each tale; a tale starts at a line that is exactly its name.
        contents = re.search(r'CONTENTS:\n(.*?)\n\n\n', body, re.S)
        names = {line.strip() for line in contents.group(1).split('\n') if line.strip()}
        start = body[:contents.end()].count('\n')
        is_heading = lambda index: index >= start and lines[index].strip() in names and lines[index] == lines[index].strip()
    else:
        pattern = re.compile(heading)
        is_heading = lambda index: pattern.fullmatch(lines[index]) is not None
    chapters, block, index = [], [], 0
    while index < len(lines):
        if is_heading(index):
            title = lines[index].strip()
            index += 1
            if titled and title.lower() != 'epilogue':
                while index < len(lines) and not lines[index].strip(): index += 1
                if index < len(lines):
                    title = f'{title} {lines[index].strip()}'
                    index += 1
            chapters.append((heading_case(re.sub(r'\s+', ' ', title)), []))
            block = []
            continue
        if chapters:
            if lines[index].strip():
                block.append(lines[index])
            elif block:
                text = paragraph(block)
                if not is_noise(text): chapters[-1][1].append(text)
                block = []
        index += 1
    if block and chapters:
        text = paragraph(block)
        if not is_noise(text): chapters[-1][1].append(text)
    return [(title, paragraphs) for title, paragraphs in chapters if paragraphs]


def split_section(title, paragraphs):
    """A long chapter is read in parts of about PART_SIZE characters, divided between paragraphs."""
    text = '\n\n'.join(paragraphs)
    if len(text) <= SECTION_LIMIT:
        return [{'title': title, 'text': text}]
    parts, current = [], []
    for item in paragraphs:
        if current and len('\n\n'.join(current + [item])) > PART_SIZE:
            parts.append(current)
            current = []
        current.append(item)
    if current: parts.append(current)
    return [{'title': f'{title} ({number})', 'text': '\n\n'.join(part)} for number, part in enumerate(parts, 1)]


def workbook(lesson):
    book = {'format': 'lingtype-workbook', 'version': 1, 'lesson': {'translations': {}, 'words': [], **lesson}}
    book['lesson']['text'] = '\n\n'.join(section['text'] for section in lesson['sections'])
    validate_workbook(book)
    return book


def build_novel(slug, number, title, author, heading, titled):
    chapters = novel_chapters(gutenberg_body(fetch(f'https://www.gutenberg.org/cache/epub/{number}/pg{number}.txt')), heading, titled)
    if len(chapters) < 3:
        raise ValueError(f'{title}: found only {len(chapters)} chapters')
    sections = [part for chapter in chapters for part in split_section(*chapter)]
    return workbook({'title': title, 'category': 'novel', 'authors': [author], 'sections': sections,
                     'license': 'Public domain in the USA',
                     'sourceUrl': f'https://www.gutenberg.org/ebooks/{number}'})


def build_paper(number):
    url = canonical_url(f'https://arxiv.org/abs/{number}')
    abstract = fetch(f'https://arxiv.org/abs/{number}')
    if 'creativecommons.org/licenses/by/' not in abstract and 'creativecommons.org/publicdomain/zero/' not in abstract:
        raise ValueError(f'{number} is not under a CC BY or CC0 license')
    article = parse_article(fetch(url), url)
    sections = [part for section in article['sections'] for part in split_section(section['title'], section['text'].split('\n\n'))]
    return workbook({'title': article['title'], 'category': 'arxiv', 'authors': article['authors'][:20], 'sections': sections,
                     'source': 'arXiv', 'license': article['license'], 'sourceUrl': url,
                     **({'formulas': article['formulas']} if article.get('formulas') else {}),
                     **({'figures': article['figures']} if article.get('figures') else {})})


def main(only=()):
    LIBRARY.mkdir(exist_ok=True)
    jobs = [(slug, lambda args=args: build_novel(*args)) for args in NOVELS for slug in [args[0]]]
    jobs += [(slug, lambda number=number: build_paper(number)) for slug, number in PAPERS]
    for slug, build in jobs:
        if only and slug not in only: continue
        book = build()
        path = LIBRARY / f'{slug}.json'
        path.write_text(json.dumps(book, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        lesson = book['lesson']
        print(f'{slug}: {len(lesson["sections"])} sections, {len(lesson["text"]):,} characters')


if __name__ == '__main__':
    main(set(sys.argv[1:]))
