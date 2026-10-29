"""Persistent, explicitly published Lingtype workbooks."""
import json
import hashlib
import re
import secrets
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
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
    return raw


class PublicLibrary:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL, owner_hash TEXT)')
            columns = {row[1] for row in db.execute('PRAGMA table_info(books)')}
            if 'owner_hash' not in columns: db.execute('ALTER TABLE books ADD COLUMN owner_hash TEXT')

    def publish(self, workbook):
        raw = validate_workbook(workbook)
        identifier = uuid.uuid4().hex
        owner_key = secrets.token_urlsafe(32)
        owner_hash = hashlib.sha256(owner_key.encode()).hexdigest()
        created = datetime.now(timezone.utc).isoformat()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('INSERT INTO books (id, title, created, payload, owner_hash) VALUES (?, ?, ?, ?, ?)', (identifier, workbook['lesson']['title'].strip(), created, raw, owner_hash))
        return identifier, owner_key

    def list_books(self):
        with closing(sqlite3.connect(self.path)) as db:
            rows = db.execute('SELECT id, title, created FROM books ORDER BY created DESC LIMIT 100').fetchall()
        return [{'id':row[0], 'title':row[1], 'createdAt':row[2]} for row in rows]

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
            return cursor.rowcount == 1
