import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordInput, wordEdit, articleResult, liveArticleStats } from '../site/typing.mjs';

test('wrong letter resets the whole word and records an error', () => {
  assert.deepEqual(wordInput('wonder', 'wo', 'x'), { input: '', error: true, complete: false });
});

test('live article statistics measure typed characters and reflect corrections', () => {
  assert.deepEqual(liveArticleStats('hello world', 'hallo', 60000), { accuracy: 80, wpm: 0.8, progress: 45 });
  assert.deepEqual(liveArticleStats('hello world', 'hello', 60000), { accuracy: 100, wpm: 1, progress: 45 });
  assert.deepEqual(liveArticleStats('hello', '', 0), { accuracy: 0, wpm: 0, progress: 0 });
});
test('completing a word advances', () => {
  assert.deepEqual(wordInput('wonder', 'wonde', 'r'), { input: 'wonder', error: false, complete: true });
});
test('replacing selected letters with an incorrect letter resets the word', () => {
  assert.deepEqual(wordEdit('wonder', 'wx'), { input: '', error: true, complete: false });
});

test('word practice tolerates a separating space before the next word', () => {
  assert.deepEqual(wordEdit('garden', ' g'), { input:'g', error:false, complete:false });
  assert.deepEqual(wordEdit('garden', ' '), { input:'', error:false, complete:false });
});
test('article result uses final corrected text and safe elapsed time', () => {
  assert.deepEqual(articleResult('hello', 'hello', 60000), { accuracy: 100, wpm: 1, errors: 0 });
  assert.deepEqual(articleResult('hello', 'hallo', 60000), { accuracy: 80, wpm: 0.8, errors: 1 });
  assert.equal(articleResult('hello', 'hello', 0).wpm, 0);
  assert.equal(articleResult('Hi 🙂!', 'Hi 🙂!', 60000).accuracy, 100);
});

test('session totals add the counts of several texts before scoring', async () => {
  const { typedCounts, sessionStats } = await import('../site/typing.mjs');
  const first = typedCounts('hello', 'hallo'), second = typedCounts('world wide', 'world');
  assert.deepEqual(first, { correct:4, total:5 });
  assert.deepEqual(second, { correct:5, total:5 });
  assert.deepEqual(sessionStats({ correct:first.correct + second.correct, total:first.total + second.total }, 60000), { accuracy:90, wpm:1.8, errors:1 });
  assert.deepEqual(sessionStats({ correct:0, total:0 }, 0), { accuracy:0, wpm:0, errors:0 });
});
