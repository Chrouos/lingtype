import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotKey, saveSnapshot, readSnapshot, clearSnapshot, clearModeSnapshots, hasModeSnapshots, lastArticleScope, wrongWordAt, comparison, bestResult, saveBest, passageId } from '../site/practice.mjs';
import { wordPage } from '../site/vocabulary.mjs';

test('last unfinished article scope is remembered separately for each lesson', () => {
  const storage = { data:{}, getItem(k) { return this.data[k] ?? null; }, setItem(k,v) { this.data[k] = v; } };
  const first = snapshotKey('a', 'article', '0', 'full');
  const second = snapshotKey('a', 'article', '1', 'random');
  saveSnapshot(storage, first, { input:'one' });
  saveSnapshot(storage, second, { input:'two' });
  saveSnapshot(storage, snapshotKey('b', 'article', 'all', 'full'), { input:'other' });
  assert.deepEqual(lastArticleScope(storage, 'a'), { section:'1', passage:'random' });
  saveSnapshot(storage, first, { input:'again' });
  assert.deepEqual(lastArticleScope(storage, 'a'), { section:'0', passage:'full' });
  clearSnapshot(storage, first);
  assert.deepEqual(lastArticleScope(storage, 'a'), { section:'1', passage:'random' });
  assert.equal(lastArticleScope(storage, 'missing'), null);
  saveSnapshot(storage, snapshotKey('a', 'article', '2', 'from', 'from:7'), { input:'reading on' });
  assert.deepEqual(lastArticleScope(storage, 'a'), { section:'2', passage:'from', index:7 });
});

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

test('a failed progress read never replaces or clears other saved practices', () => {
  const first = snapshotKey('lesson', 'article', 'all', 'full');
  const other = snapshotKey('other', 'word', 'all', 'full');
  const original = JSON.stringify({[first]:{input:'First'}, [other]:{input:'kept'}});
  let stored = original, failRead = true;
  const storage = { getItem() { if (failRead) throw new Error('temporary read failure'); return stored; }, setItem(_key, value) { stored = value; } };
  assert.equal(saveSnapshot(storage, first, {input:'new'}), false);
  assert.equal(clearSnapshot(storage, first), false);
  assert.equal(clearModeSnapshots(storage, 'lesson', 'article'), false);
  assert.equal(stored, original);
  failRead = false;
  assert.equal(readSnapshot(storage, other).input, 'kept');
  assert.equal(saveSnapshot(storage, first, {input:'new'}), true);
  assert.equal(readSnapshot(storage, other).input, 'kept');
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

test('a temporary best-result read error does not replace other records', () => {
  const record = {lessonId:'one', mode:'article', passage:'same', wpm:40};
  let value = null, failing = false;
  const storage = {getItem() { if (failing) throw new Error('read error'); return value; }, setItem(_key, next) { value = next; }};
  assert.equal(saveBest(storage, record), true);
  const original = value;
  failing = true;
  assert.equal(saveBest(storage, {...record, passage:'another'}), false);
  assert.equal(value, original);
  failing = false;
  assert.equal(bestResult(storage, record), 40);
});

test('a malformed best-result container or value does not silently drop a new result', () => {
  const record = {lessonId:'one', mode:'article', passage:'same', wpm:40};
  let value = '[]';
  const storage = {getItem() { return value; }, setItem(_key, next) { value = next; }};
  assert.equal(saveBest(storage, record), true);
  assert.equal(bestResult(storage, record), 40);
  const damaged = JSON.parse(value);
  damaged[Object.keys(damaged)[0]] = 'invalid';
  value = JSON.stringify(damaged);
  assert.equal(saveBest(storage, record), true);
  assert.equal(bestResult(storage, record), 40);
});

test('partial practices are recorded without comparing or changing the completed best', () => {
  const storage = { data:{}, getItem(k) { return this.data[k] ?? null; }, setItem(k,v) { this.data[k] = v; } };
  const full = { lessonId:'one', mode:'article', passage:'same', wpm:40 };
  const partial = { ...full, partial:true, wpm:100 };
  saveBest(storage, full); saveBest(storage, partial);
  assert.equal(bestResult(storage, full), 40);
  assert.equal(bestResult(storage, partial), null);
  assert.deepEqual(comparison([partial, { ...full, wpm:35 }], full), { previous:35, best:35, delta:5 });
  assert.equal(comparison([full, { ...partial, wpm:90 }], partial), null);
});
