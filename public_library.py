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
    for word in words:
        if not isinstance(word, list) or len(word) != 4 or any(not isinstance(v, str) or len(v) > 500 for v in word) or not re.fullmatch(r"[A-Za-z]+(?:['’][A-Za-z]+)*", word[0]):
            raise ValueError('練習冊單字格式無效。')
    translations = item.get('translations', {})
    if not isinstance(translations, dict) or any(not isinstance(translations.get(k, ''), str) or len(translations.get(k, '')) > 1_000_000 for k in ('zh', 'ja', 'ko')):
        raise ValueError('練習冊翻譯格式無效。')
    sections = item.get('sections', [])
    if not isinstance(sections, list) or len(sections) > 1000 or any(not isinstance(s, dict) or not isinstance(s.get('title'), str) or len(s['title']) > 200 or not isinstance(s.get('text'), str) or not s['text'].strip() or len(s['text']) > 1_000_000 for s in sections):
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


class PublicLibrary:
    def __init__(self, path, max_bytes=100_000_000):
        self.path = Path(path)
        self.max_bytes = max_bytes
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL, owner_hash TEXT)')
            columns = {row[1] for row in db.execute('PRAGMA table_info(books)')}
            if 'owner_hash' not in columns: db.execute('ALTER TABLE books ADD COLUMN owner_hash TEXT')
            db.execute('CREATE TABLE IF NOT EXISTS likes (book_id TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY (book_id, visitor))')
            db.execute('CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, author TEXT NOT NULL, wpm REAL NOT NULL, accuracy REAL NOT NULL, created TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS covers (book_id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL)')
            # A reader is counted once per book when they open it, and once more when they start typing it.
            db.execute('CREATE TABLE IF NOT EXISTS reads (book_id TEXT NOT NULL, visitor TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY (book_id, visitor))')
            db.execute('CREATE TABLE IF NOT EXISTS starts (book_id TEXT NOT NULL, visitor TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY (book_id, visitor))')
            if 'visitor' not in {row[1] for row in db.execute('PRAGMA table_info(attempts)')}: db.execute("ALTER TABLE attempts ADD COLUMN visitor TEXT NOT NULL DEFAULT ''")
            for column, kind in (('summary', 'TEXT'), ('category', 'TEXT'), ('words', 'INTEGER')):
                if column not in columns: db.execute(f'ALTER TABLE books ADD COLUMN {column} {kind}')
            for identifier, payload in db.execute('SELECT id, payload FROM books WHERE summary IS NULL').fetchall():
                db.execute('UPDATE books SET summary = ?, category = ?, words = ? WHERE id = ?', (*summarize(json.loads(payload).get('lesson', {})), identifier))

    def publish(self, workbook):
        raw = validate_workbook(workbook)
        identifier = uuid.uuid4().hex
        owner_key = secrets.token_urlsafe(32)
        owner_hash = hashlib.sha256(owner_key.encode()).hexdigest()
        created = datetime.now(timezone.utc).isoformat()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            used = db.execute('SELECT COALESCE(SUM(LENGTH(CAST(payload AS BLOB))), 0) FROM books').fetchone()[0]
            if used + len(raw.encode('utf-8')) > self.max_bytes:
                raise ValueError('公開練習冊儲存空間已滿。')
            db.execute('INSERT INTO books (id, title, created, payload, owner_hash, summary, category, words) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', (identifier, workbook['lesson']['title'].strip(), created, raw, owner_hash, *summarize(workbook['lesson'])))
        return identifier, owner_key

    def list_books(self):
        with closing(sqlite3.connect(self.path)) as db:
            rows = db.execute("""SELECT b.id, b.title, b.created, b.summary, b.category, b.words,
                (SELECT COUNT(*) FROM likes WHERE book_id = b.id),
                (SELECT COUNT(*) FROM reads WHERE book_id = b.id),
                (SELECT COUNT(*) FROM starts WHERE book_id = b.id),
                (SELECT COUNT(DISTINCT visitor) FROM attempts WHERE book_id = b.id AND visitor != ''),
                (SELECT COUNT(*) FROM attempts WHERE book_id = b.id),
                (SELECT COUNT(*) FROM comments WHERE book_id = b.id),
                EXISTS (SELECT 1 FROM covers WHERE book_id = b.id)
                FROM books b ORDER BY b.created DESC LIMIT 100""").fetchall()
        return [{'id':r[0], 'title':r[1], 'createdAt':r[2], 'summary':r[3] or '', 'category':r[4] or '', 'words':r[5] or 0, 'likes':r[6], 'reads':r[7], 'starts':r[8], 'completions':r[9], 'practiceCount':r[10], 'comments':r[11], 'completionRate':completion_rate(r[8], r[9]), 'hasCover':bool(r[12])} for r in rows]

    def shelf(self):
        """The bookshelf page: every book with its numbers, the fastest typists across books and the latest comments."""
        with closing(sqlite3.connect(self.path)) as db:
            ranking = db.execute("""SELECT a.author, MAX(a.wpm), a.accuracy, a.book_id, b.title FROM attempts a JOIN books b ON b.id = a.book_id
                GROUP BY a.book_id, CASE WHEN a.visitor != '' THEN a.visitor ELSE a.id END ORDER BY MAX(a.wpm) DESC, a.created ASC LIMIT 10""").fetchall()
            comments = db.execute('SELECT c.author, c.text, c.created, c.book_id, b.title FROM comments c JOIN books b ON b.id = c.book_id ORDER BY c.created DESC LIMIT 5').fetchall()
        return {'books':self.list_books(),
                'ranking':[{'author':r[0], 'wpm':r[1], 'accuracy':r[2], 'bookId':r[3], 'title':r[4]} for r in ranking],
                'comments':[{'author':r[0], 'text':r[1], 'createdAt':r[2], 'bookId':r[3], 'title':r[4]} for r in comments]}

    def record_visit(self, identifier, visitor, kind):
        """Remember that a reader opened (reads) or began typing (starts) a book; repeats by the same reader count once."""
        if kind not in ('reads', 'starts') or not isinstance(visitor, str) or not VISITOR.fullmatch(visitor):
            raise ValueError('閱讀資料無效。')
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone(): raise ValueError('找不到文章。')
            db.execute(f'INSERT OR IGNORE INTO {kind} (book_id, visitor, created) VALUES (?, ?, ?)', (identifier, visitor, datetime.now(timezone.utc).isoformat()))
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
                db.execute('DELETE FROM likes WHERE book_id = ?', (identifier,))
                db.execute('DELETE FROM comments WHERE book_id = ?', (identifier,))
                db.execute('DELETE FROM attempts WHERE book_id = ?', (identifier,))
                db.execute('DELETE FROM covers WHERE book_id = ?', (identifier,))
                db.execute('DELETE FROM reads WHERE book_id = ?', (identifier,))
                db.execute('DELETE FROM starts WHERE book_id = ?', (identifier,))
                return True
            return False

    def set_like(self, identifier, visitor, liked):
        if not isinstance(visitor, str) or not re.fullmatch(r'[0-9a-f]{32}', visitor) or type(liked) is not bool:
            raise ValueError('按讚資料無效。')
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone():
                raise ValueError('找不到文章。')
            if liked: db.execute('INSERT OR IGNORE INTO likes (book_id, visitor) VALUES (?, ?)', (identifier, visitor))
            else: db.execute('DELETE FROM likes WHERE book_id = ? AND visitor = ?', (identifier, visitor))
            return db.execute('SELECT COUNT(*) FROM likes WHERE book_id = ?', (identifier,)).fetchone()[0]

    def add_comment(self, identifier, author, text):
        if not isinstance(author, str) or len(author) > 40 or not isinstance(text, str) or not text.strip() or len(text) > 1000:
            raise ValueError('留言內容無效。')
        comment_id = uuid.uuid4().hex
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone():
                raise ValueError('找不到文章。')
            db.execute('INSERT INTO comments VALUES (?, ?, ?, ?, ?)', (comment_id, identifier, author.strip() or '匿名讀者', text.strip(), datetime.now(timezone.utc).isoformat()))
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
            ranking = db.execute("""SELECT author, MAX(wpm), accuracy FROM attempts WHERE book_id = ?
                GROUP BY CASE WHEN visitor != '' THEN visitor ELSE id END ORDER BY MAX(wpm) DESC, created ASC LIMIT 10""", (identifier,)).fetchall()
            reads = db.execute('SELECT COUNT(*) FROM reads WHERE book_id = ?', (identifier,)).fetchone()[0]
            starts = db.execute('SELECT COUNT(*) FROM starts WHERE book_id = ?', (identifier,)).fetchone()[0]
            completions = db.execute("SELECT COUNT(DISTINCT visitor) FROM attempts WHERE book_id = ? AND visitor != ''", (identifier,)).fetchone()[0]
            has_cover = bool(db.execute('SELECT 1 FROM covers WHERE book_id = ?', (identifier,)).fetchone())
        return {'likes':likes, 'liked':liked, 'comments':[{'id':r[0], 'author':r[1], 'text':r[2], 'createdAt':r[3]} for r in rows], 'practiceCount':count, 'ranking':[{'author':r[0], 'wpm':r[1], 'accuracy':r[2]} for r in ranking],
                'reads':reads, 'starts':starts, 'completions':completions, 'completionRate':completion_rate(starts, completions), 'hasCover':has_cover}

    def record_attempt(self, identifier, author, wpm, accuracy, visitor=''):
        if not isinstance(visitor, str) or (visitor and not VISITOR.fullmatch(visitor)): raise ValueError('練習成績無效。')
        if not isinstance(author, str) or len(author) > 40 or any(type(value) not in (int, float) or not math.isfinite(value) for value in (wpm, accuracy)) or not 0 <= wpm <= MAX_WPM or not 0 <= accuracy <= 100:
            raise ValueError('練習成績無效。')
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM books WHERE id = ?', (identifier,)).fetchone(): raise ValueError('找不到文章。')
            now = datetime.now(timezone.utc).isoformat()
            db.execute('INSERT INTO attempts (id, book_id, author, wpm, accuracy, created, visitor) VALUES (?, ?, ?, ?, ?, ?, ?)', (uuid.uuid4().hex, identifier, author.strip() or '匿名讀者', wpm, accuracy, now, visitor))
            # Finishing counts as having started, even when the start was not recorded (an older page, a lost request).
            if visitor: db.execute('INSERT OR IGNORE INTO starts (book_id, visitor, created) VALUES (?, ?, ?)', (identifier, visitor, now))

    def remove_comment(self, identifier, comment_id, owner_key):
        if not isinstance(owner_key, str) or len(owner_key) > 200: return False
        owner_hash = hashlib.sha256(owner_key.encode()).hexdigest()
        with closing(sqlite3.connect(self.path)) as db, db:
            cursor = db.execute('DELETE FROM comments WHERE id = ? AND book_id = ? AND EXISTS (SELECT 1 FROM books WHERE id = ? AND owner_hash = ?)', (comment_id, identifier, identifier, owner_hash))
            return cursor.rowcount == 1

    def set_cover(self, identifier, owner_key, data):
        if not isinstance(owner_key, str) or len(owner_key) > 200: return False
        owner_hash = hashlib.sha256(owner_key.encode()).hexdigest()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM books WHERE id = ? AND owner_hash = ?', (identifier, owner_hash)).fetchone(): return False
            if not isinstance(data, bytes) or not 0 < len(data) <= 2_000_000: raise ValueError('封面必須小於 2 MB。')
            try:
                from PIL import Image
                with Image.open(BytesIO(data)) as image:
                    mime = {'PNG':'image/png', 'JPEG':'image/jpeg', 'WEBP':'image/webp'}.get(image.format)
                    if not mime or image.width * image.height > 16_000_000: raise ValueError('封面格式或尺寸不支援。')
                    image.verify()
            except (OSError, SyntaxError) as error:
                raise ValueError('封面圖片無法讀取。') from error
            used = db.execute('SELECT COALESCE(SUM(LENGTH(CAST(payload AS BLOB))), 0) FROM books').fetchone()[0]
            used += db.execute('SELECT COALESCE(SUM(LENGTH(data)), 0) FROM covers WHERE book_id != ?', (identifier,)).fetchone()[0]
            if used + len(data) > self.max_bytes: raise ValueError('公開練習冊儲存空間已滿。')
            db.execute('INSERT OR REPLACE INTO covers VALUES (?, ?, ?)', (identifier, mime, data))
            return True

    def get_cover(self, identifier):
        with closing(sqlite3.connect(self.path)) as db:
            return db.execute('SELECT mime, data FROM covers WHERE book_id = ?', (identifier,)).fetchone()
