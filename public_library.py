"""Persistent, explicitly published Lingtype workbooks."""
import json
import hashlib
import math
import re
import secrets
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path


MAX_WORKBOOK_SECTIONS = 4000


class CoverConflictError(Exception):
    """A cover changed after the client read its version."""


def seed_id(name):
    """The shelf ID of a book bundled with the server, the same on every server."""
    return hashlib.sha256(f'lingtype-library:{name}'.encode()).hexdigest()[:32]


def validate_workbook(workbook):
    if not isinstance(workbook, dict) or workbook.get('format') != 'lingtype-workbook' or type(workbook.get('version')) is not int or workbook['version'] != 1:
        raise ValueError('練習冊格式不支援。')
    raw = json.dumps(workbook, ensure_ascii=False, allow_nan=False)
    if len(raw.encode('utf-8')) > 2_000_000:
        raise ValueError('練習冊超過 2 MB。')
    item = workbook.get('lesson')
    if not isinstance(item, dict) or not isinstance(item.get('title'), str) or not item['title'].strip() or len(item['title']) > 200:
        raise ValueError('練習冊名稱無效。')
    if not isinstance(item.get('text'), str) or not item['text'].strip() or len(item['text']) > 1_000_000:
        raise ValueError('練習冊文章無效。')
    words = item.get('words')
    if not isinstance(words, list) or len(words) > 5000:
        raise ValueError('練習冊單字格式無效。')
    authors = item.get('authors', [])
    if not isinstance(authors, list) or len(authors) > 5000 or any(not isinstance(author, str) or len(author) > 200 for author in authors):
        raise ValueError('練習冊作者格式無效。')
    for word in words:
        if not isinstance(word, list) or len(word) != 4 or any(not isinstance(v, str) or len(v) > 500 for v in word) or not re.fullmatch(r"[A-Za-z]+(?:['’][A-Za-z]+)*", word[0]):
            raise ValueError('練習冊單字格式無效。')
    translations = item.get('translations', {})
    if not isinstance(translations, dict) or any(not isinstance(translations.get(k, ''), str) or len(translations.get(k, '')) > 1_000_000 for k in ('zh', 'ja', 'ko')):
        raise ValueError('練習冊翻譯格式無效。')
    sections = item.get('sections', [])
    if not isinstance(sections, list) or len(sections) > MAX_WORKBOOK_SECTIONS or any(not isinstance(s, dict) or not isinstance(s.get('title'), str) or len(s['title']) > 200 or not isinstance(s.get('text'), str) or not s['text'].strip() or len(s['text']) > 1_000_000 for s in sections):
        raise ValueError('練習冊章節格式無效。')
    for key, limit in (('formulas', 6000), ('figures', 500)):
        values = item.get(key, [])
        if not isinstance(values, list) or len(values) > limit or any(not isinstance(v, dict) for v in values):
            raise ValueError('練習冊圖表或公式格式無效。')
    return raw


VISITOR = re.compile(r'[0-9a-f]{32}')
# Faster than any sustained human typing: such a run was pasted or scripted and is kept out of rankings.
MAX_WPM = 250


def summarize(lesson):
    """What a shelf shows without loading the whole text: an opening excerpt, the category and the length."""
    text = lesson.get('text', '') if isinstance(lesson, dict) else ''
    excerpt = ' '.join(text.split())[:240]
    category = lesson.get('category') if isinstance(lesson, dict) and isinstance(lesson.get('category'), str) else ''
    return excerpt, category.strip()[:40], len(re.findall(r"[A-Za-z]+(?:['’][A-Za-z]+)*", text))


def completion_rate(starts, completions):
    return min(100, round(completions / starts * 100)) if starts else None


def _search_terms(query):
    # Every term is an AND condition, so repeats do not change the result.
    # Preserve first occurrence order for short-circuiting and predictable work.
    return list(dict.fromkeys(query.lower().split()))


# Count UTF-8 payloads and a conservative per-record allowance for community
# metadata. SQLite's file also has page/index overhead; this is a content quota.
def _bytes(value):
    return len(value.encode('utf-8'))


class StorageFullError(ValueError):
    """Capacity may become available after existing content is removed."""


class CommentRemovedError(ValueError):
    """A previously accepted comment was removed; its ID cannot be reused."""


def _usage_expression(table, row):
    columns = {
        'books': ('payload',), 'covers': ('data',), 'retired_books': ('id',),
        'likes': ('book_id', 'visitor'), 'reads': ('book_id', 'visitor', 'created'),
        'starts': ('book_id', 'visitor', 'created'),
        'comments': ('id', 'book_id', 'author', 'text', 'created'),
        'retired_comments': ('id', 'book_id'),
        'attempts': ('id', 'book_id', 'author', 'created', 'visitor'),
    }[table]
    lengths = [f'LENGTH(CAST({row}.{column} AS BLOB))' for column in columns]
    if table not in ('books', 'covers'): lengths.append('64')
    return ' + '.join(lengths)


def _check_capacity(db, maximum, additional):
    if additional > 0 and db.execute('SELECT bytes FROM content_usage WHERE id = 1').fetchone()[0] + additional > maximum:
        raise StorageFullError('公開練習冊儲存空間已滿。')


def _delete_book_dependents(db, identifier):
    for table in ('likes', 'comments', 'attempts', 'covers', 'reads', 'starts'):
        db.execute(f'DELETE FROM {table} WHERE book_id = ?', (identifier,))
    # The retired book ID already prevents any delayed comment being reposted
    # through a later reuse of that ID. Its individual comment tombstones can go.
    db.execute('DELETE FROM retired_comments WHERE book_id = ?', (identifier,))


class PublicLibrary:
    def __init__(self, path, max_bytes=100_000_000):
        self.path = Path(path)
        self.max_bytes = max_bytes
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL, owner_hash TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS retired_books (id TEXT PRIMARY KEY)')
            columns = {row[1] for row in db.execute('PRAGMA table_info(books)')}
            if 'owner_hash' not in columns: db.execute('ALTER TABLE books ADD COLUMN owner_hash TEXT')
            db.execute('CREATE TABLE IF NOT EXISTS likes (book_id TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY (book_id, visitor))')
            db.execute('CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS retired_comments (id TEXT PRIMARY KEY, book_id TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, author TEXT NOT NULL, wpm REAL NOT NULL, accuracy REAL NOT NULL, created TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS covers (book_id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL)')
            cover_columns = {row[1] for row in db.execute('PRAGMA table_info(covers)')}
            if 'revision' not in cover_columns: db.execute('ALTER TABLE covers ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
            if 'protected' not in cover_columns: db.execute('ALTER TABLE covers ADD COLUMN protected INTEGER NOT NULL DEFAULT 0')
            # A reader is counted once per book when they open it, and once more when they start typing it.
            db.execute('CREATE TABLE IF NOT EXISTS reads (book_id TEXT NOT NULL, visitor TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY (book_id, visitor))')
            db.execute('CREATE TABLE IF NOT EXISTS starts (book_id TEXT NOT NULL, visitor TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY (book_id, visitor))')
            if 'visitor' not in {row[1] for row in db.execute('PRAGMA table_info(attempts)')}: db.execute("ALTER TABLE attempts ADD COLUMN visitor TEXT NOT NULL DEFAULT ''")
            if 'ranked' not in {row[1] for row in db.execute('PRAGMA table_info(attempts)')}: db.execute('ALTER TABLE attempts ADD COLUMN ranked INTEGER NOT NULL DEFAULT 1')
            db.execute('CREATE INDEX IF NOT EXISTS comments_book_created ON comments (book_id, created DESC)')
            # The shelf's latest comments span all books; the per-book index
            # cannot provide that order and otherwise requires a full sort.
            db.execute('CREATE INDEX IF NOT EXISTS comments_created ON comments (created DESC)')
            db.execute('CREATE INDEX IF NOT EXISTS attempts_book_visitor ON attempts (book_id, visitor)')
            # Match the ranking's reader grouping so SQLite can group in index
            # order; unranked completion-only records need not occupy this index.
            db.execute("CREATE INDEX IF NOT EXISTS attempts_ranked_reader ON attempts (book_id, (CASE WHEN visitor != '' THEN visitor ELSE id END), wpm DESC, created ASC) WHERE ranked = 1")
            for column, kind in (('summary', 'TEXT'), ('category', 'TEXT'), ('words', 'INTEGER'), ('authors', 'TEXT')):
                if column not in columns: db.execute(f'ALTER TABLE books ADD COLUMN {column} {kind}')
            for identifier, payload in db.execute('SELECT id, payload FROM books WHERE summary IS NULL').fetchall():
                db.execute('UPDATE books SET summary = ?, category = ?, words = ? WHERE id = ?', (*summarize(json.loads(payload).get('lesson', {})), identifier))
            for identifier, payload in db.execute('SELECT id, payload FROM books WHERE authors IS NULL').fetchall():
                authors = json.loads(payload).get('lesson', {}).get('authors', [])
                if not isinstance(authors, list): authors = []
                authors = [author.strip() for author in authors if isinstance(author, str) and 0 < len(author.strip()) <= 200][:4]
                db.execute('UPDATE books SET authors = ? WHERE id = ?', (json.dumps(authors, ensure_ascii=False), identifier))
            # Triggers keep accounting correct across inserts, updates, deletions,
            # retries and multiple server processes, without scanning every table
            # on each community request. Existing databases are counted once.
            tables = ('books', 'retired_books', 'covers', 'likes', 'reads', 'starts', 'comments', 'retired_comments', 'attempts')
            db.execute('CREATE TABLE IF NOT EXISTS content_usage (id INTEGER PRIMARY KEY CHECK(id = 1), bytes INTEGER NOT NULL)')
            if not db.execute('SELECT 1 FROM content_usage WHERE id = 1').fetchone():
                used = sum(db.execute(f'SELECT COALESCE(SUM({_usage_expression(table, table)}), 0) FROM {table}').fetchone()[0] for table in tables)
                db.execute('INSERT INTO content_usage VALUES (1, ?)', (used,))
            for table in tables:
                old, new = _usage_expression(table, 'OLD'), _usage_expression(table, 'NEW')
                db.execute(f'CREATE TRIGGER IF NOT EXISTS usage_{table}_insert AFTER INSERT ON {table} BEGIN UPDATE content_usage SET bytes = bytes + {new} WHERE id = 1; END')
                db.execute(f'CREATE TRIGGER IF NOT EXISTS usage_{table}_delete AFTER DELETE ON {table} BEGIN UPDATE content_usage SET bytes = bytes - ({old}) WHERE id = 1; END')
                db.execute(f'CREATE TRIGGER IF NOT EXISTS usage_{table}_update AFTER UPDATE ON {table} BEGIN UPDATE content_usage SET bytes = bytes + {new} - ({old}) WHERE id = 1; END')
            # Keep the decision even if a timed-out POST arrives after an owner
            # or operator deletes the comment, including on book deletion.
            db.execute('CREATE TRIGGER IF NOT EXISTS comments_retire AFTER DELETE ON comments BEGIN INSERT OR IGNORE INTO retired_comments (id, book_id) VALUES (OLD.id, OLD.book_id); END')
            db.execute('CREATE TRIGGER IF NOT EXISTS books_retire AFTER DELETE ON books BEGIN INSERT OR IGNORE INTO retired_books (id) VALUES (OLD.id); END')

    def publish(self, workbook, identifier=None, owner_key=None):
        raw = validate_workbook(workbook)
        if identifier is None and owner_key is None:
            identifier = uuid.uuid4().hex
            owner_key = secrets.token_urlsafe(32)
        elif not isinstance(identifier, str) or not VISITOR.fullmatch(identifier) or not isinstance(owner_key, str) or not re.fullmatch(r'[0-9a-f]{64}', owner_key):
            raise ValueError('公開練習冊識別資料無效。')
        owner_hash = hashlib.sha256(owner_key.encode()).hexdigest()
        created = datetime.now(timezone.utc).isoformat()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM retired_books WHERE id = ?', (identifier,)).fetchone():
                raise ValueError('這本公開練習冊已下架，請使用新的分享連結。')
            existing = db.execute('SELECT payload, owner_hash FROM books WHERE id = ?', (identifier,)).fetchone()
            if existing:
                if existing != (raw, owner_hash): raise ValueError('公開練習冊識別資料已使用。')
                return identifier, owner_key
            _check_capacity(db, self.max_bytes, _bytes(raw))
            authors = [author.strip() for author in workbook['lesson'].get('authors', []) if author.strip()][:4]
            db.execute('INSERT INTO books (id, title, created, payload, owner_hash, summary, category, words, authors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', (identifier, workbook['lesson']['title'].strip(), created, raw, owner_hash, *summarize(workbook['lesson']), json.dumps(authors, ensure_ascii=False)))
        return identifier, owner_key

    def seed(self, directory):
        """Publish the books that come with the server (see build_library.py).

        Each file keeps the same ID on every server. A book has no owner key, so
        only an operator can remove it, and a removed book is not restored. A
        changed file replaces the earlier text while keeping readers' likes,
        comments and rankings. Returns the IDs of the books on the shelf."""
        directory = Path(directory)
        published = []
        for path in sorted(directory.glob('*.json')) if directory.is_dir() else []:
            workbook = json.loads(path.read_text(encoding='utf-8'))
            raw = validate_workbook(workbook)
            identifier = seed_id(path.stem)
            lesson = workbook['lesson']
            authors = json.dumps([author.strip() for author in lesson.get('authors', []) if author.strip()][:4], ensure_ascii=False)
            with closing(sqlite3.connect(self.path)) as db, db:
                db.execute('BEGIN IMMEDIATE')
                if db.execute('SELECT 1 FROM retired_books WHERE id = ?', (identifier,)).fetchone(): continue
                existing = db.execute('SELECT payload, owner_hash FROM books WHERE id = ?', (identifier,)).fetchone()
                if existing and existing[1] is not None: continue
                if not existing or existing[0] != raw:
                    _check_capacity(db, self.max_bytes, _bytes(raw) - (_bytes(existing[0]) if existing else 0))
                if not existing:
                    db.execute('INSERT INTO books (id, title, created, payload, owner_hash, summary, category, words, authors) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)', (identifier, lesson['title'].strip(), datetime.now(timezone.utc).isoformat(), raw, *summarize(lesson), authors))
                elif existing[0] != raw:
                    db.execute('UPDATE books SET title = ?, payload = ?, summary = ?, category = ?, words = ?, authors = ? WHERE id = ?', (lesson['title'].strip(), raw, *summarize(lesson), authors, identifier))
            published.append(identifier)
        return published

    def _page_books(self, query='', category='', sort='likes', page=1, page_size=24):
        """Filter and sort the whole library before returning a bounded page."""
        if (not isinstance(query, str) or len(query) > 200 or not isinstance(category, str) or len(category) > 40
                or sort not in ('likes', 'reads', 'completion', 'new') or type(page) is not int or not 1 <= page <= 1_000_000
                or type(page_size) is not int or not 1 <= page_size <= 100):
            raise ValueError('書架查詢無效。')
        words = _search_terms(query)
        filters, args = [], []
        if category:
            filters.append('b.category = ?')
            args.append(category)
        if words:
            filters.append('book_matches(b.title, b.summary, b.category, b.payload)')
        where = ' WHERE ' + ' AND '.join(filters) if filters else ''
        order = {
            'likes':'likes DESC, reads DESC, created DESC, id DESC',
            'reads':'reads DESC, likes DESC, created DESC, id DESC',
            'completion':'COALESCE(rate, -1) DESC, starts DESC, created DESC, id DESC',
            'new':'created DESC, id DESC',
        }[sort]
        with closing(sqlite3.connect(self.path)) as db:
            def book_matches(title, summary, category, payload):
                # Most matches can be decided from the already-stored excerpt;
                # parse the workbook only when a term may occur later in it.
                head = f'{title} {summary or ""} {category or ""}'.lower()
                missing = [word for word in words if word not in head]
                if not missing: return True
                text = json.loads(payload)['lesson']['text'].lower()
                return all(word in text for word in missing)
            db.create_function('book_matches', 4, book_matches)
            db.create_function('completion_rate', 2, completion_rate)
            total = db.execute('SELECT COUNT(*) FROM books b' + where, args).fetchone()[0]
            all_categories = [row[0] for row in db.execute("SELECT DISTINCT category FROM books WHERE category IS NOT NULL AND category != '' ORDER BY category")]
            rows = db.execute("""WITH stats AS (SELECT b.id, b.title, b.created, b.summary, b.category, b.words,
                (SELECT COUNT(*) FROM likes WHERE book_id = b.id) AS likes,
                (SELECT COUNT(*) FROM reads WHERE book_id = b.id) AS reads,
                (SELECT COUNT(*) FROM starts WHERE book_id = b.id) AS starts,
                (SELECT COUNT(DISTINCT visitor) FROM attempts WHERE book_id = b.id AND visitor != '') AS completions,
                (SELECT COUNT(*) FROM attempts WHERE book_id = b.id) AS practice_count,
                (SELECT COUNT(*) FROM comments WHERE book_id = b.id) AS comments,
                EXISTS (SELECT 1 FROM covers WHERE book_id = b.id) AS has_cover, b.authors
                FROM books b""" + where + """), rated AS (SELECT *, completion_rate(starts, completions) AS rate FROM stats)
                SELECT * FROM rated ORDER BY """ + order + ' LIMIT ? OFFSET ?', [*args, page_size, (page - 1) * page_size]).fetchall()
        books = [{'id':r[0], 'title':r[1], 'createdAt':r[2], 'summary':r[3] or '', 'category':r[4] or '', 'words':r[5] or 0, 'likes':r[6], 'reads':r[7], 'starts':r[8], 'completions':r[9], 'practiceCount':r[10], 'comments':r[11], 'hasCover':bool(r[12]), 'authors':json.loads(r[13] or '[]'), 'completionRate':r[14]} for r in rows]
        return books, total, all_categories

    def list_books(self):
        return self._page_books()[0]

    def shelf(self, query='', category='', sort='likes', page=1):
        """A page of books plus the global ranking, recent comments, and categories."""
        books, total, all_categories = self._page_books(query, category, sort, page)
        with closing(sqlite3.connect(self.path)) as db:
            ranking = db.execute("""SELECT a.author, MAX(a.wpm), a.accuracy, a.book_id, b.title FROM attempts a JOIN books b ON b.id = a.book_id WHERE a.ranked = 1
                GROUP BY a.book_id, CASE WHEN a.visitor != '' THEN a.visitor ELSE a.id END ORDER BY MAX(a.wpm) DESC, a.created ASC LIMIT 10""").fetchall()
            comments = db.execute('SELECT c.author, c.text, c.created, c.book_id, b.title FROM comments c JOIN books b ON b.id = c.book_id ORDER BY c.created DESC LIMIT 5').fetchall()
        return {'books':books, 'total':total, 'page':page, 'pageSize':24, 'categories':all_categories,
                'ranking':[{'author':r[0], 'wpm':r[1], 'accuracy':r[2], 'bookId':r[3], 'title':r[4]} for r in ranking],
                'comments':[{'author':r[0], 'text':r[1], 'createdAt':r[2], 'bookId':r[3], 'title':r[4]} for r in comments]}

    def record_visit(self, identifier, visitor, kind):
        """Remember that a reader opened (reads) or began typing (starts) a book; repeats by the same reader count once."""
        if kind not in ('reads', 'starts') or not isinstance(visitor, str) or not VISITOR.fullmatch(visitor):
            raise ValueError('閱讀資料無效。')
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone(): raise ValueError('找不到文章。')
            if not db.execute(f'SELECT 1 FROM {kind} WHERE book_id = ? AND visitor = ?', (identifier, visitor)).fetchone():
                created = datetime.now(timezone.utc).isoformat()
                _check_capacity(db, self.max_bytes, _bytes(identifier) + _bytes(visitor) + _bytes(created) + 64)
                db.execute(f'INSERT INTO {kind} (book_id, visitor, created) VALUES (?, ?, ?)', (identifier, visitor, created))
            return db.execute(f'SELECT COUNT(*) FROM {kind} WHERE book_id = ?', (identifier,)).fetchone()[0]

    def get(self, identifier):
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute('SELECT payload FROM books WHERE id = ?', (identifier,)).fetchone()
        return json.loads(row[0]) if row else None

    def unpublish(self, identifier, owner_key):
        if not isinstance(owner_key, str) or len(owner_key) > 200:
            return False
        owner_hash = hashlib.sha256(owner_key.encode()).hexdigest()
        with closing(sqlite3.connect(self.path)) as db, db:
            cursor = db.execute('DELETE FROM books WHERE id = ? AND owner_hash = ?', (identifier, owner_hash))
            if cursor.rowcount == 1:
                _delete_book_dependents(db, identifier)
                return True
            return False

    def moderation_book(self, identifier):
        if not isinstance(identifier, str) or not VISITOR.fullmatch(identifier): raise ValueError('文章 ID 無效。')
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute('SELECT created, payload FROM books WHERE id = ?', (identifier,)).fetchone()
        return {'id':identifier, 'created':row[0], 'workbook':json.loads(row[1])} if row else None

    def moderation_comment(self, identifier):
        if not isinstance(identifier, str) or not VISITOR.fullmatch(identifier): raise ValueError('留言 ID 無效。')
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute('SELECT book_id, author, text, created FROM comments WHERE id = ?', (identifier,)).fetchone()
        return {'id':identifier, 'bookId':row[0], 'author':row[1], 'text':row[2], 'created':row[3]} if row else None

    def moderation_comments(self, identifier):
        if not isinstance(identifier, str) or not VISITOR.fullmatch(identifier): raise ValueError('文章 ID 無效。')
        with closing(sqlite3.connect(self.path)) as db:
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone(): return None
            rows = db.execute('SELECT id, author, text, created FROM comments WHERE book_id = ? ORDER BY created DESC, id DESC', (identifier,)).fetchall()
        return [{'id':row[0], 'bookId':identifier, 'author':row[1], 'text':row[2], 'created':row[3]} for row in rows]

    def moderation_remove_book(self, record):
        # Confirm the exact record displayed to the operator, within the write
        # transaction, before removing it and all associated community data.
        identifier = record['id']
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT created, payload FROM books WHERE id = ?', (identifier,)).fetchone()
            if not row or row[0] != record['created'] or json.loads(row[1]) != record['workbook']: return False
            db.execute('DELETE FROM books WHERE id = ?', (identifier,))
            _delete_book_dependents(db, identifier)
            return True

    def moderation_remove_comment(self, record):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            cursor = db.execute('DELETE FROM comments WHERE id = ? AND book_id = ? AND author = ? AND text = ? AND created = ?',
                                (record['id'], record['bookId'], record['author'], record['text'], record['created']))
            return cursor.rowcount == 1

    def set_like(self, identifier, visitor, liked):
        if not isinstance(visitor, str) or not re.fullmatch(r'[0-9a-f]{32}', visitor) or type(liked) is not bool:
            raise ValueError('按讚資料無效。')
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone():
                raise ValueError('找不到文章。')
            if liked:
                if not db.execute('SELECT 1 FROM likes WHERE book_id = ? AND visitor = ?', (identifier, visitor)).fetchone():
                    _check_capacity(db, self.max_bytes, _bytes(identifier) + _bytes(visitor) + 64)
                    db.execute('INSERT INTO likes (book_id, visitor) VALUES (?, ?)', (identifier, visitor))
            else: db.execute('DELETE FROM likes WHERE book_id = ? AND visitor = ?', (identifier, visitor))
            return db.execute('SELECT COUNT(*) FROM likes WHERE book_id = ?', (identifier,)).fetchone()[0]

    def add_comment(self, identifier, author, text, comment_id=None):
        if not isinstance(author, str) or len(author) > 40 or not isinstance(text, str) or not text.strip() or len(text) > 1000:
            raise ValueError('留言內容無效。')
        if comment_id is not None and (not isinstance(comment_id, str) or not VISITOR.fullmatch(comment_id)):
            raise ValueError('留言識別資料無效。')
        comment_id = comment_id or uuid.uuid4().hex
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone():
                raise ValueError('找不到文章。')
            author, text = author.strip() or '匿名讀者', text.strip()
            if db.execute('SELECT 1 FROM retired_comments WHERE id = ?', (comment_id,)).fetchone():
                raise CommentRemovedError('這則留言已被移除。')
            previous = db.execute('SELECT book_id, author, text FROM comments WHERE id = ?', (comment_id,)).fetchone()
            if previous:
                if previous != (identifier, author, text): raise ValueError('留言識別資料已使用。')
                return comment_id
            created = datetime.now(timezone.utc).isoformat()
            _check_capacity(db, self.max_bytes, sum(map(_bytes, (comment_id, identifier, author, text, created))) + 64)
            db.execute('INSERT INTO comments VALUES (?, ?, ?, ?, ?)', (comment_id, identifier, author, text, created))
        return comment_id

    def community(self, identifier, visitor=''):
        with closing(sqlite3.connect(self.path)) as db:
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone():
                raise ValueError('找不到文章。')
            likes = db.execute('SELECT COUNT(*) FROM likes WHERE book_id = ?', (identifier,)).fetchone()[0]
            liked = bool(db.execute('SELECT 1 FROM likes WHERE book_id = ? AND visitor = ?', (identifier, visitor)).fetchone())
            rows = db.execute('SELECT id, author, text, created FROM comments WHERE book_id = ? ORDER BY created DESC LIMIT 100', (identifier,)).fetchall()
            count = db.execute('SELECT COUNT(*) FROM attempts WHERE book_id = ?', (identifier,)).fetchone()[0]
            # Each reader's best run only, so one person practising many times does not fill the table.
            ranking = db.execute("""SELECT author, MAX(wpm), accuracy FROM attempts WHERE book_id = ? AND ranked = 1
                GROUP BY CASE WHEN visitor != '' THEN visitor ELSE id END ORDER BY MAX(wpm) DESC, created ASC LIMIT 10""", (identifier,)).fetchall()
            reads = db.execute('SELECT COUNT(*) FROM reads WHERE book_id = ?', (identifier,)).fetchone()[0]
            starts = db.execute('SELECT COUNT(*) FROM starts WHERE book_id = ?', (identifier,)).fetchone()[0]
            completions = db.execute("SELECT COUNT(DISTINCT visitor) FROM attempts WHERE book_id = ? AND visitor != ''", (identifier,)).fetchone()[0]
            has_cover = bool(db.execute('SELECT 1 FROM covers WHERE book_id = ?', (identifier,)).fetchone())
        return {'likes':likes, 'liked':liked, 'comments':[{'id':r[0], 'author':r[1], 'text':r[2], 'createdAt':r[3]} for r in rows], 'practiceCount':count, 'ranking':[{'author':r[0], 'wpm':r[1], 'accuracy':r[2]} for r in ranking],
                'reads':reads, 'starts':starts, 'completions':completions, 'completionRate':completion_rate(starts, completions), 'hasCover':has_cover}

    def record_attempt(self, identifier, author, wpm, accuracy, visitor='', attempt_id=None, completion_only=False):
        if not isinstance(visitor, str) or (visitor and not VISITOR.fullmatch(visitor)): raise ValueError('練習成績無效。')
        if attempt_id is not None and (not isinstance(attempt_id, str) or not VISITOR.fullmatch(attempt_id)): raise ValueError('練習成績無效。')
        if type(completion_only) is not bool: raise ValueError('練習成績無效。')
        if not isinstance(author, str) or len(author) > 40 or any(type(value) not in (int, float) or not math.isfinite(value) for value in (wpm, accuracy)) or not 0 <= wpm <= MAX_WPM or not 0 <= accuracy <= 100:
            raise ValueError('練習成績無效。')
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone(): raise ValueError('找不到文章。')
            if attempt_id:
                previous = db.execute('SELECT book_id, visitor, author, wpm, accuracy, ranked FROM attempts WHERE id = ?', (attempt_id,)).fetchone()
                if previous:
                    if previous != (identifier, visitor, author.strip() or '匿名讀者', wpm, accuracy, int(not completion_only)): raise ValueError('練習成績無效。')
                    return
            now = datetime.now(timezone.utc).isoformat()
            attempt_id, author = attempt_id or uuid.uuid4().hex, author.strip() or '匿名讀者'
            start_needed = bool(visitor and not db.execute('SELECT 1 FROM starts WHERE book_id = ? AND visitor = ?', (identifier, visitor)).fetchone())
            extra = sum(map(_bytes, (attempt_id, identifier, author, now, visitor))) + 64
            if start_needed: extra += sum(map(_bytes, (identifier, visitor, now))) + 64
            _check_capacity(db, self.max_bytes, extra)
            db.execute('INSERT INTO attempts (id, book_id, author, wpm, accuracy, created, visitor, ranked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', (attempt_id, identifier, author, wpm, accuracy, now, visitor, int(not completion_only)))
            # Finishing counts as having started, even when the start was not recorded (an older page, a lost request).
            if start_needed: db.execute('INSERT INTO starts (book_id, visitor, created) VALUES (?, ?, ?)', (identifier, visitor, now))

    def remove_comment(self, identifier, comment_id, owner_key):
        if not isinstance(owner_key, str) or len(owner_key) > 200: return False
        owner_hash = hashlib.sha256(owner_key.encode()).hexdigest()
        with closing(sqlite3.connect(self.path)) as db, db:
            cursor = db.execute('DELETE FROM comments WHERE id = ? AND book_id = ? AND EXISTS (SELECT 1 FROM books WHERE id = ? AND owner_hash = ?)', (comment_id, identifier, identifier, owner_hash))
            return cursor.rowcount == 1

    def set_cover(self, identifier, owner_key, data, revision=None):
        if not isinstance(owner_key, str) or len(owner_key) > 200: return False
        owner_hash = hashlib.sha256(owner_key.encode()).hexdigest()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM books WHERE id = ? AND owner_hash = ?', (identifier, owner_hash)).fetchone(): return False
            current = db.execute('SELECT revision, protected FROM covers WHERE book_id = ?', (identifier,)).fetchone()
            actual, protected = current or (0, 0)
            if revision is None:
                if protected: raise CoverConflictError('封面已使用新版更新，請重新整理頁面後再試。')
            elif type(revision) is not int or revision < 0:
                raise ValueError('封面版本無效。')
            elif revision != actual:
                raise CoverConflictError('封面已變更，請重新嘗試。')
            if not isinstance(data, bytes) or not 0 < len(data) <= 2_000_000: raise ValueError('封面必須小於 2 MB。')
            from PIL import Image
            try:
                with Image.open(BytesIO(data)) as image:
                    mime = {'PNG':'image/png', 'JPEG':'image/jpeg', 'WEBP':'image/webp'}.get(image.format)
                    if not mime or image.width * image.height > 16_000_000: raise ValueError('封面格式或尺寸不支援。')
                    image.verify()
            except Image.DecompressionBombError as error:
                raise ValueError('封面格式或尺寸不支援。') from error
            except (OSError, SyntaxError) as error:
                raise ValueError('封面圖片無法讀取。') from error
            previous = db.execute('SELECT LENGTH(data) FROM covers WHERE book_id = ?', (identifier,)).fetchone()
            _check_capacity(db, self.max_bytes, len(data) - (previous[0] if previous else 0))
            db.execute('INSERT INTO covers (book_id, mime, data, revision, protected) VALUES (?, ?, ?, ?, ?) ON CONFLICT(book_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, revision = excluded.revision, protected = excluded.protected', (identifier, mime, data, actual + 1, int(protected or revision is not None)))
            return True

    def cover_revision(self, identifier):
        with closing(sqlite3.connect(self.path)) as db:
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone(): return None
            row = db.execute('SELECT revision FROM covers WHERE book_id = ?', (identifier,)).fetchone()
            return row[0] if row else 0

    def get_cover(self, identifier):
        with closing(sqlite3.connect(self.path)) as db:
            return db.execute('SELECT mime, data FROM covers WHERE book_id = ?', (identifier,)).fetchone()
