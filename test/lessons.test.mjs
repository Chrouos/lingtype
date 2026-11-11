import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessons, selectPassage, selectPassageSelection, splitSentences, nextPassage, nextPassageSelection, importedSections } from '../site/data.mjs';

test('choose full text or a random contiguous passage', () => {
  const text = 'First sentence. Second sentence! Third sentence?';
  assert.equal(selectPassage(text, 'full'), text);
  assert.equal(selectPassage(text, 'random', () => 0.99), 'Third sentence?');
  assert.equal(selectPassage('A single sentence.', 'random', () => 0), 'A single sentence.');
  assert.equal(selectPassage('First paragraph. More here.\n\nSecond paragraph. More there.', 'random', () => 0.99), 'Second paragraph. More there.');
});

test('next passage advances and wraps through paragraphs', () => {
  const text = 'First paragraph.\n\nSecond paragraph.';
  assert.equal(nextPassage(text, 'First paragraph.'), 'Second paragraph.');
  assert.equal(nextPassage(text, 'Second paragraph.'), 'First paragraph.');
});

test('identical passages advance from the chosen occurrence', () => {
  const text = 'Same.\n\nSame.\n\nNext.';
  const chosen = selectPassageSelection(text, 'random', () => 0.5);
  assert.deepEqual(chosen, {text:'Same.', index:1});
  assert.deepEqual(nextPassageSelection(text, chosen.text, chosen.index), {text:'Next.', index:2});
  assert.deepEqual(nextPassageSelection(text, chosen.text, 99), {text:'Same.', index:1});
});

test('sentence segments preserve the original text and sentence boundaries', () => {
  const text = 'First sentence. Second sentence!\n\nThird sentence?';
  const result = splitSentences(text);
  assert.equal(result.join(''), text);
  assert.equal(result.length, 3);
  assert.match(result[1], /Second sentence!/);
  assert.deepEqual(splitSentences(''), []);
});

test('long imports are divided without losing text or PDF page associations', () => {
  const text = ('A long sentence has no blank lines. ').repeat(500);
  const parts = importedSections(text);
  assert.ok(parts.length > 1);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.ok(parts.every(part => part.text.length <= 6000));
  const chapter = {title:'Page 7', text, page:7};
  const pages = importedSections(text, [chapter]);
  assert.ok(pages.length > 1);
  assert.equal(pages.map(part => part.text).join(''), text);
  assert.ok(pages.every(part => part.page === 7));
  assert.deepEqual(importedSections('short', [{title:'Chapter',text:'short'}]), [{title:'Chapter',text:'short'}]);
});

test('a long unbroken string splits without breaking surrogate pairs', () => {
  const text = 'x'.repeat(5999) + '😀'.repeat(4000);
  const parts = importedSections(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.ok(parts.every(part => !/[\uD800-\uDBFF]$/.test(part.text) && !/^[\uDC00-\uDFFF]/.test(part.text)));
});

test('long paper sections keep figure anchors, references and formula markers intact', () => {
  const anchor = 'Anchor text locating the original figure';
  const text = 'a'.repeat(5990) + anchor + '\uE000' + 'b'.repeat(5990) + 'Figure 12' + 'c'.repeat(1000);
  const figures = [{anchor, where:'start'}];
  const parts = importedSections(text, [{title:'Paper', text}], figures);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.ok(parts.some(part => part.text.includes(anchor)));
  assert.ok(parts.some(part => part.text.includes('Figure 12')));
  assert.ok(parts.some(part => part.text.includes('\uE000')));
});

test('repeated short figure anchors do not create an unbounded list of occurrences', () => {
  const text = 'a'.repeat(100000);
  const figures = Array.from({length:100}, () => ({anchor:'a'}));
  const parts = importedSections(text, [{title:'Repeated', text}], figures);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.ok(parts.length > 1);
});
