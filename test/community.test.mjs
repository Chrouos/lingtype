import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanShelf, shelfBooks, categories, typingMinutes, coverColors, readVisitor } from '../site/community.mjs';

const id = n => String(n).repeat(32);
const { books } = cleanShelf({ books:[
  { id:id(1), title:'Old favourite', createdAt:'2026-01-01', likes:9, reads:20, starts:10, completionRate:30, category:'旅行', summary:'A train at night' },
  { id:id(2), title:'New and unread', createdAt:'2026-03-01', likes:0, reads:0, starts:0, completionRate:null, category:'科普' },
  { id:id(3), title:'Finished by all', createdAt:'2026-02-01', likes:2, reads:5, starts:4, completionRate:100, category:'旅行' },
  { id:'bad', title:'Not a book' }, { id:id(4) },
] });

test('the shelf keeps only real books and fills missing numbers', () => {
  assert.deepEqual(books.map(book => book.title), ['Old favourite', 'New and unread', 'Finished by all']);
  const old = cleanShelf({ books:[{ id:id(5), title:'From an older server', createdAt:'2026-01-01' }] }).books[0];
  assert.equal(old.likes, 0); assert.equal(old.completionRate, null); assert.equal(old.hasCover, false);
  const name = '𠮷'.repeat(150);
  assert.deepEqual(cleanShelf({books:[{id:id(6), title:'Unicode', authors:[name]}]}).books[0].authors, [name]);
});

test('books sort by likes, readers, completion rate or date, and filter by category and words', () => {
  const titles = options => shelfBooks(books, options).map(book => book.title);
  assert.deepEqual(titles({ sort:'likes' }), ['Old favourite', 'Finished by all', 'New and unread']);
  assert.deepEqual(titles({ sort:'completion' }), ['Finished by all', 'Old favourite', 'New and unread']);
  assert.deepEqual(titles({ sort:'new' }), ['New and unread', 'Finished by all', 'Old favourite']);
  assert.deepEqual(titles({ category:'旅行', sort:'reads' }), ['Old favourite', 'Finished by all']);
  assert.deepEqual(titles({ query:'NIGHT train' }), ['Old favourite']);
  assert.deepEqual(categories(books), ['旅行', '科普'].sort((a, b) => a.localeCompare(b)));
});

test('ranking and comments must point at a book', () => {
  const shelf = cleanShelf({ ranking:[{ author:'A', wpm:50, accuracy:99, bookId:id(1), title:'T' }, { author:'B', wpm:'fast', accuracy:1, bookId:id(1), title:'T' }, { author:'C', wpm:1, accuracy:1, bookId:'x', title:'T' }], comments:[{ author:'A', text:'Hi', bookId:id(1), title:'T' }, { author:'A', bookId:id(1), title:'T' }] });
  assert.deepEqual(shelf.ranking.map(row => row.author), ['A']);
  assert.equal(shelf.comments.length, 1);
});

test('reading time, cover colours and the reader id are stable', () => {
  assert.equal(typingMinutes(0), 1); assert.equal(typingMinutes(300), 10);
  assert.deepEqual(coverColors(id(1)), coverColors(id(1)));
  const saved = {}, storage = { getItem:key => saved[key] ?? null, setItem:(key, value) => { saved[key] = value; } };
  const first = readVisitor(storage);
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.equal(readVisitor(storage), first);
  assert.match(readVisitor({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }), /^[0-9a-f]{32}$/);
});
