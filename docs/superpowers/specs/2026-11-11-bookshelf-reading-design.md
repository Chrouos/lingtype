# Bookshelf reading flow

## Problem

Lingtype opened on a typing workspace. A book was an entry in a drop-down,
choosing where to start meant switching the range to "random passage" and
paging through paragraph numbers, and finishing a text moved on to the next
lesson in the list. It felt like a typing drill rather than reading a book.

## Flow

1. **Library (home, `#public`).** The community shelf becomes the home page.
   It always has books: the server publishes the bundled novels and papers in
   `library/` at start-up. Readers can also upload a file straight from the
   library and choose its category (novel, paper, web article, document).
2. **Book detail → "加入書櫃".** Adding a shared book puts a copy on the
   reader's shelf and opens its book page. A book already on the shelf offers
   "已在書櫃，打開" instead.
3. **My bookshelf (`#shelf`).** Every book in this browser (bundled samples,
   imports, books from the library). Books being read come first, then the
   reader's own books, then the samples. A "最近在讀" card continues the
   latest one. "加入自己的書" opens the import page.
4. **Book page.** Cover, source, progress ("已讀 120／789 段"), where reading
   continues, and the contents: one entry per section, each listing its
   paragraphs. A section's paragraphs are drawn when it is opened. Clicking a
   paragraph starts reading there.
5. **Reader (`#practice`).** The heading shows the book, section and
   paragraph ("Chapter III · 第 3／48 段"); "目錄" returns to the book page.
   Reading from a paragraph runs to the end of its section; Enter then reads
   the next section; the end of the book returns to the book page.

The navigation is 書庫｜我的書櫃｜單字本｜紀錄. The reader and the import page
have no navigation item of their own and mark 我的書櫃 as current.

## Reading position

- A new passage mode `from` types a section from paragraph *n* to its end.
  Its progress is saved like other passages, under
  `[lesson, 'article', section, 'from', 'from:n']`.
- `lingtype-reading` (in backups) keeps, per book, the paragraph reached
  (`section`, `at`), the passage in progress (`scope`), and the paragraphs
  typed to their end (`read`). Paragraphs are `passageParts` of a section, so
  a text without blank lines is read sentence by sentence, as before.
- "繼續閱讀" resumes an unfinished passage with its typing; otherwise it starts
  at the next unread paragraph after the bookmark, wrapping to earlier unread
  ones. A finished book offers "再讀一次".
- Books with sections are not tracked while typed as one whole text (the
  legacy "全部章節" scope).

## Bundled library

`build_library.py` downloads public-domain novels from Project Gutenberg and
CC BY 4.0 arXiv papers and writes workbooks to `library/`. Chapters over 12,000
characters are divided between paragraphs, as imports are. The server seeds
them with fixed IDs and no owner key: an operator can remove one with
`moderate.py`, and a removed book is not restored. A changed file replaces the
text and keeps likes, comments and rankings. Books over 100,000 characters only
prefetch translations for their first section.

## Not changed

Per-passage results, word picking, the notebook, sharing snapshots and the
public statistics work as before. The old section and passage selectors stay
in the page, hidden, and continue to hold the reader's scope.
