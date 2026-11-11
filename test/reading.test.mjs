import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReading, noteReading, forgetReading, readingSections, partOffsets, readingSpan, bookProgress, nextUnread, validReadingData, readingChapters, chapterPlace, partUnit, bookUnit } from '../site/reading.mjs';

const memory = () => { const data = {}; return { getItem:key => data[key] ?? null, setItem:(key, value) => { data[key] = String(value); }, data }; };
const book = { id:'b', title:'Book', text:'One.\n\nTwo.\n\nThree.\n\nFour.', sections:[{ title:'I', text:'One.\n\nTwo.' }, { title:'II', text:'Three.\n\nFour.' }] };

test('paragraph offsets locate each part of a section and what a position has read', () => {
  const source = 'First part.\n\nSecond part.\n\n  Third.';
  const offsets = partOffsets(source);
  assert.deepEqual(offsets.map(({ start, end }) => source.slice(start, end)), ['First part.', 'Second part.', 'Third.']);
  assert.deepEqual(readingSpan(offsets, 0, 0), { at:0, read:[] });
  assert.deepEqual(readingSpan(offsets, 0, offsets[1].end), { at:1, read:[0, 1] });
  // Starting from the second paragraph does not mark the first as read.
  assert.deepEqual(readingSpan(offsets, offsets[1].start, offsets[2].start + 2), { at:2, read:[1] });
});

test('a single paragraph is read sentence by sentence, as passages are chosen', () => {
  const offsets = partOffsets('One sentence. Another one.');
  assert.equal(offsets.length, 2);
  assert.deepEqual(readingSections({ title:'Short', text:'One sentence. Another one.' }).map(section => section.value), ['all']);
});

test('reading progress is merged, bounded and can be forgotten', () => {
  const storage = memory();
  assert.deepEqual(readReading(storage), {});
  assert.equal(noteReading(storage, 'b', { section:'0', at:1, read:[0], scope:{ section:'0', passage:'full', start:null }, time:'2026-01-01T00:00:00.000Z' }), true);
  assert.equal(noteReading(storage, 'b', { section:'0', at:2, read:[1, 0] }), true);
  const entry = readReading(storage).b;
  assert.deepEqual(entry.read, { 0:[0, 1] });
  assert.equal(entry.at, 2);
  assert.equal(entry.scope, undefined, 'a later note without a scope replaces it');
  assert.deepEqual(bookProgress(book, entry), { read:2, total:4, percent:50 });
  assert.equal(noteReading(storage, 'b', { section:'x', at:0 }), false);
  storage.setItem('lingtype-reading', JSON.stringify({ b:entry, broken:{ section:'0', at:-1 } }));
  assert.deepEqual(Object.keys(readReading(storage)), ['b']);
  assert.equal(validReadingData({ b:entry }), true);
  assert.equal(validReadingData({ b:{ section:'0' } }), false);
  assert.equal(forgetReading(storage, 'b'), true);
  assert.deepEqual(readReading(storage), {});
});

test('continuing finds the next unread paragraph after the bookmark, then earlier ones', () => {
  assert.deepEqual(nextUnread(book, null), { section:'0', index:0 });
  assert.deepEqual(nextUnread(book, { section:'0', at:2, read:{ 0:[0, 1] } }), { section:'1', index:0 });
  assert.deepEqual(nextUnread(book, { section:'1', at:1, read:{ 1:[1] } }), { section:'0', index:0 });
  assert.deepEqual(nextUnread(book, { section:'1', at:0, read:{ 0:[0, 1], 1:[1] } }), { section:'1', index:0 });
  assert.equal(nextUnread(book, { section:'1', at:2, read:{ 0:[0, 1], 1:[0, 1] } }), null);
  const plain = { title:'Plain', text:'A.\n\nB.' };
  assert.deepEqual(nextUnread(plain, { section:'all', at:1, read:{ all:[1] } }), { section:'all', index:0 });
});

test('a chapter kept in parts reads as one chapter, numbered through its parts', () => {
  const novel = { title:'Novel', text:'x', sections:[{ title:'Chapter I (1)', text:'A.\n\nB.' }, { title:'Chapter I (2)', text:'C.\n\nD.\n\nE.' }, { title:'Chapter II', text:'F.\n\nG.' }, { title:'Notes (2)', text:'H.\n\nI.' }] };
  const chapters = readingChapters(novel);
  assert.deepEqual(chapters.map(chapter => [chapter.title, chapter.count, chapter.parts.map(part => [part.value, part.first])]), [['Chapter I', 5, [['0', 0], ['1', 2]]], ['Chapter II', 2, [['2', 0]]], ['Notes (2)', 2, [['3', 0]]]]);
  assert.deepEqual(chapterPlace(novel, '1', 1), { title:'Chapter I', n:4, total:5, unit:'paragraph', last:true, single:false });
  assert.equal(chapterPlace(novel, '0', 0).last, false);
  assert.equal(partUnit('One. Two.'), 'sentence');
  assert.equal(bookUnit({ title:'Short', text:'One. Two.' }), 'sentence');
  assert.equal(bookUnit(novel), 'paragraph');
});
