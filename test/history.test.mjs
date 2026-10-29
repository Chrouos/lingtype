import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHistory, saveResult } from '../site/history.mjs';

test('history retains the newest ten results and ignores invalid storage', () => {
  const storage = { value: 'bad json', getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
  assert.deepEqual(readHistory(storage), []);
  for (let i = 0; i < 12; i++) saveResult(storage, { title: `Lesson ${i}`, mode:'article', wpm:i, accuracy:100, elapsed:60000, date:'2026-10-29T00:00:00.000Z' });
  const history = readHistory(storage);
  assert.equal(history.length, 10);
  assert.equal(history[0].title, 'Lesson 11');
  assert.equal(history.at(-1).title, 'Lesson 2');
});
