import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommentTracker } from '../site/comment-pending.mjs';
import { createBackup, readBackup, restoreBackup } from '../site/backup.mjs';

test('uncertain comment retries survive reload, but confirmed or edited comments get new IDs', () => {
  const data = new Map();
  const storage = { getItem:key => data.get(key) ?? null, setItem:(key, value) => data.set(key, value) };
  let tracker = createCommentTracker(storage);
  const first = tracker.begin('a'.repeat(32), 'Reader', 'Hello');
  tracker = createCommentTracker(storage);
  assert.equal(tracker.begin('a'.repeat(32), 'Reader', 'Hello'), first);
  const changed = tracker.begin('a'.repeat(32), 'Reader', 'Hello again');
  assert.notEqual(changed, first);
  const other = tracker.begin('b'.repeat(32), 'Reader', 'Hello again');
  assert.notEqual(other, changed);
  tracker.confirm('a'.repeat(32), first);
  assert.equal(tracker.begin('a'.repeat(32), 'Reader', 'Hello again'), changed, 'a stale success cannot clear a newer draft');
  tracker.confirm('a'.repeat(32), changed);
  assert.notEqual(tracker.begin('a'.repeat(32), 'Reader', 'Hello again'), changed, 'the same text after success is a new comment');
});

test('retries remain idempotent in the current session when storage silently fails', () => {
  const tracker = createCommentTracker({getItem:() => null, setItem() {}});
  assert.equal(tracker.isPersistent(), true);
  const first = tracker.begin('a'.repeat(32), '', 'Hi');
  assert.equal(tracker.isPersistent(), false, 'silently dropped writes are reported');
  assert.equal(tracker.begin('a'.repeat(32), '', 'Hi'), first);
  tracker.confirm('a'.repeat(32), first);
  assert.notEqual(tracker.begin('a'.repeat(32), '', 'Hi'), first);
});

test('volatile memory storage is not reported as persistent even when writes read back', () => {
  const data = new Map();
  const tracker = createCommentTracker({volatile:true, getItem:key => data.get(key) ?? null, setItem:(key, value) => data.set(key, value)});
  const first = tracker.begin('a'.repeat(32), 'Reader', 'Hello');
  assert.equal(tracker.isPersistent(), false);
  assert.equal(tracker.begin('a'.repeat(32), 'Reader', 'Hello'), first);
  assert.deepEqual(tracker.pending('a'.repeat(32)), [{id:first, author:'Reader', text:'Hello'}]);
});

test('several uncertain drafts for one book survive editing, reload and backup', async () => {
  const storage = () => {
    const data = new Map();
    return {getItem:key => data.get(key) ?? null, setItem:(key, value) => data.set(key, value), removeItem:key => data.delete(key)};
  };
  const firstStore = storage();
  const book = 'a'.repeat(32), first = createCommentTracker(firstStore);
  const idA = first.begin(book, 'Reader', 'First draft');
  const idB = first.begin(book, 'Reader', 'Edited draft');
  assert.notEqual(idA, idB);
  const secondStore = storage();
  await restoreBackup(secondStore, readBackup(JSON.stringify(createBackup(firstStore))));
  const restored = createCommentTracker(secondStore);
  assert.deepEqual(restored.pending(book), [
    {id:idA, author:'Reader', text:'First draft'},
    {id:idB, author:'Reader', text:'Edited draft'},
  ]);
  assert.deepEqual(restored.pending('b'.repeat(32)), []);
  assert.equal(restored.begin(book, 'Reader', 'First draft'), idA);
  assert.equal(restored.begin(book, 'Reader', 'Edited draft'), idB);
  restored.confirm(book, idB);
  assert.deepEqual(restored.pending(book), [{id:idA, author:'Reader', text:'First draft'}]);
  assert.equal(restored.begin(book, 'Reader', 'First draft'), idA, 'confirming B must not forget uncertain A');
  assert.notEqual(restored.begin(book, 'Reader', 'Edited draft'), idB, 'confirmed B may be posted again deliberately');
});

test('the previous one-record format keeps its retry ID when another draft is sent', () => {
  const book = 'a'.repeat(32), old = 'b'.repeat(32);
  const values = { 'lingtype-pending-comments':JSON.stringify({[book]:{id:old, author:'Reader', text:'Old'}}) };
  const tracker = createCommentTracker({ getItem:key => values[key] ?? null, setItem:(key, value) => { values[key] = value; } });
  assert.deepEqual(tracker.pending(book), [{id:old, author:'Reader', text:'Old'}]);
  assert.equal(tracker.begin(book, 'Reader', 'Old'), old);
  tracker.begin(book, 'Reader', 'New');
  assert.equal(tracker.begin(book, 'Reader', 'Old'), old);
});
