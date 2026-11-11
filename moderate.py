"""Review and remove public content from the server's local database.

This command is intended for an operator with filesystem access to the data
directory. It does not expose a network administration endpoint.
"""
import argparse
import json
import os
import sqlite3
import sys
import unicodedata
from pathlib import Path

from public_library import PublicLibrary


def main(argv=None):
    default_dir = Path(os.environ.get('LINGTYPE_DATA_DIR', Path(__file__).resolve().parent / '.lingtype'))
    parser = argparse.ArgumentParser(description='檢視或移除公開教材與留言（僅限本機管理者）。')
    parser.add_argument('--data-dir', type=Path, default=default_dir, help='伺服器資料目錄，預設與 LINGTYPE_DATA_DIR 相同')
    parser.add_argument('action', choices=('show-book', 'show-comment', 'list-comments', 'remove-book', 'remove-comment'))
    parser.add_argument('id', help='完整的 32 字元公開教材或留言 ID')
    args = parser.parse_args(argv)
    path = args.data_dir / 'public.db'
    if not path.is_file():
        print(f'找不到資料庫：{path}', file=sys.stderr)
        return 1
    try:
        library = PublicLibrary(path)
        is_book = args.action.endswith('book')
        record = library.moderation_comments(args.id) if args.action == 'list-comments' else library.moderation_book(args.id) if is_book else library.moderation_comment(args.id)
        if record is None:
            print('找不到指定資料。', file=sys.stderr)
            return 1
        # Preserve readable multilingual text while escaping terminal controls
        # and direction-changing format characters from untrusted content.
        rendered = json.dumps(record, ensure_ascii=False, indent=2)
        print(''.join(char.encode('unicode_escape').decode('ascii') if char != '\n' and unicodedata.category(char) in ('Cc', 'Cf', 'Zl', 'Zp') else char for char in rendered))
        if args.action.startswith('show-') or args.action == 'list-comments': return 0
        print('移除文章會同時刪除封面、留言、按讚、閱讀及練習紀錄。' if is_book else '即將移除這則留言。')
        try:
            confirmed = input('輸入上方完整 ID 確認移除：').strip()
        except EOFError:
            confirmed = ''
        if confirmed != args.id:
            print('未確認，沒有移除。', file=sys.stderr)
            return 1
        removed = library.moderation_remove_book(record) if is_book else library.moderation_remove_comment(record)
        if not removed:
            print('資料已改變或不存在，請重新檢視。', file=sys.stderr)
            return 1
        print('已移除。')
        return 0
    except (ValueError, OSError, sqlite3.Error) as error:
        print(f'無法完成操作：{error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
