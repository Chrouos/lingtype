import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotKey, saveSnapshot, readSnapshot, clearSnapshot, clearModeSnapshots, hasModeSnapshots, wrongWordAt, comparison, bestResult, saveBest, passageId } from '../site/practice.mjs';
import { wordPage } from '../site/vocabulary.mjs';

test('separate practice scopes survive saving and removal', () => {
  const storage = { data:{}, getItem(k) { return this.data[k] ?? null; }, setItem(k,v) { this.data[k] = v; } };
  const a = snapshotKey('lesson', 'article', 'all', 'full');
  const b = snapshotKey('lesson', 'word', 'all', 'full');
  saveSnapshot(storage, a, { input:'hi', elapsed:1000 });
  saveSnapshot(storage, b, { input:'wo', elapsed:2000 });
  assert.equal(readSnapshot(storage, a).input, 'hi');
  clearSnapshot(storage, b);
  assert.equal(readSnapshot(storage, b), null);
  assert.equal(readSnapshot(storage, a).elapsed, 1000);
  saveSnapshot(storage, b, { input:'again' });
  assert.equal(hasModeSnapshots(storage, 'lesson', 'word'), true);
  clearModeSnapshots(storage, 'lesson', 'word');
  assert.equal(hasModeSnapshots(storage, 'lesson', 'word'), false);
  assert.equal(readSnapshot(storage, b), null);
  assert.equal(readSnapshot(storage, a).input, 'hi');
});

test('passage identity is compact and changes with its content', () => {
  assert.ok(passageId('x'.repeat(10000)).length < 40);
  assert.notEqual(passageId('hello'), passageId('world'));
});

test('mistakes identify the whole word and ignore punctuation', () => {
  assert.equal(wrongWordAt('Hello, garden!', 8), 'garden');
  assert.equal(wrongWordAt('Hello, garden!', 5), null);
});

test('comparison only uses the same lesson and exact passage', () => {
  const current = { lessonId:'x', mode:'article', passage:'Hello.', wpm:30, accuracy:90 };
  const history = [{ ...current, passage:'Other.', wpm:50 }, { ...current, wpm:25, accuracy:80 }];
  assert.deepEqual(comparison(history, current), { previous:25, best:25, delta:5 });
});

test('candidate pages omit known words and reach later article words', () => {
  const text = Array.from({ length:25 }, (_,i) => `term${String.fromCharCode(97+i)}`).join(' ');
  const first = wordPage(text, '', ['terma'], 0, 20);
  assert.equal(first.words.length, 20);
  assert.ok(!first.words.includes('terma'));
  assert.equal(wordPage(text, '', ['terma'], 1, 20).words.length, 4);
});

test('personal best survives history trimming and is scoped to a passage', () => {
  const storage = { data:{}, getItem(k) { return this.data[k] ?? null; }, setItem(k,v) { this.data[k] = v; } };
  const record = { lessonId:'one', mode:'article', passage:'same', wpm:40 };
  saveBest(storage, record);
  saveBest(storage, { ...record, wpm:20 });
  assert.equal(bestResult(storage, record), 40);
  assert.equal(bestResult(storage, { ...record, passage:'different' }), null);
});
