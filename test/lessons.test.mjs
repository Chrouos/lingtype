import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessons, selectPassage, splitSentences, articleWindow, nextPassage } from '../site/data.mjs';

test('choose full text or a random contiguous passage', () => {
  const text = 'First sentence. Second sentence! Third sentence?';
  assert.equal(selectPassage(text, 'full'), text);
  assert.equal(selectPassage(text, 'random', () => 0.99), 'Third sentence?');
  assert.equal(selectPassage('A single sentence.', 'random', () => 0), 'A single sentence.');
  assert.equal(selectPassage('First paragraph. More here.\n\nSecond paragraph. More there.', 'random', () => 0.99), 'Second paragraph. More there.');
});

test('long articles show a bounded window around the current position', () => {
  const text = 'a'.repeat(5000);
  const [piece] = articleWindow([text], 3000);
  assert.equal(piece.start, 2700);
  assert.equal(piece.text.length, 1000);
  assert.equal(piece.end, 3700);
});

test('next passage advances and wraps through paragraphs', () => {
  const text = 'First paragraph.\n\nSecond paragraph.';
  assert.equal(nextPassage(text, 'First paragraph.'), 'Second paragraph.');
  assert.equal(nextPassage(text, 'Second paragraph.'), 'First paragraph.');
});

test('sentence segments preserve the original text and sentence boundaries', () => {
  const text = 'First sentence. Second sentence!\n\nThird sentence?';
  const result = splitSentences(text);
  assert.equal(result.join(''), text);
  assert.equal(result.length, 3);
  assert.match(result[1], /Second sentence!/);
  assert.deepEqual(splitSentences(''), []);
});
