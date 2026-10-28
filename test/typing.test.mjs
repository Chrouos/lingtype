import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordInput, wordEdit, articleResult } from '../site/typing.mjs';

test('wrong letter resets the whole word and records an error', () => {
  assert.deepEqual(wordInput('wonder', 'wo', 'x'), { input: '', error: true, complete: false });
});
test('completing a word advances', () => {
  assert.deepEqual(wordInput('wonder', 'wonde', 'r'), { input: 'wonder', error: false, complete: true });
});
test('replacing selected letters with an incorrect letter resets the word', () => {
  assert.deepEqual(wordEdit('wonder', 'wx'), { input: '', error: true, complete: false });
});
test('article result uses final corrected text and safe elapsed time', () => {
  assert.deepEqual(articleResult('hello', 'hello', 60000), { accuracy: 100, wpm: 1, errors: 0 });
  assert.deepEqual(articleResult('hello', 'hallo', 60000), { accuracy: 80, wpm: 0.8, errors: 1 });
  assert.equal(articleResult('hello', 'hello', 0).wpm, 0);
});
