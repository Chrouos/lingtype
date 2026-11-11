import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordPublicPart, pendingPublicAttempts, acknowledgePublicAttempt, drainPublicAttempts, queuePublicStart, pendingPublicStarts, drainPublicStarts, queuePublicRead, pendingPublicReads, drainPublicReads, withPublicAttemptTimeout } from '../site/community-progress.mjs';
import { createBackup, readBackup, restoreBackup } from '../site/backup.mjs';

const bookId = 'a'.repeat(32), visitor = 'b'.repeat(32);
function storage() {
  const data = {};
  return { getItem:key => data[key] ?? null, setItem:(key, value) => { data[key] = String(value); }, removeItem:key => { delete data[key]; } };
}
const part = (index, overrides = {}) => ({ bookId, visitor, signature:'book-v1', size:3, index, counts:{ correct:50, total:50 }, elapsed:60000, author:'Reader', ...overrides });

test('large shared workbooks can save progress for sections beyond 1,000', () => {
  const data = storage();
  assert.equal(recordPublicPart(data, part(2001, {size:2002})), true);
  assert.equal(pendingPublicAttempts(data).length, 0);
  assert.equal(recordPublicPart(data, part(4000, {size:4001})), false);
});

test('all full sections are required; repeats replace one section and restored progress remains usable', async () => {
  const first = storage();
  assert.equal(recordPublicPart(first, part(2)), true);
  assert.equal(recordPublicPart(first, part(2)), true);
  assert.equal(pendingPublicAttempts(first).length, 0);
  assert.equal(recordPublicPart(first, part(0)), true);
  const second = storage();
  await restoreBackup(second, readBackup(JSON.stringify(createBackup(first))));
  assert.equal(pendingPublicAttempts(second).length, 0);
  assert.equal(recordPublicPart(second, part(1, { counts:{ correct:40, total:50 } })), true);
  const [attempt] = pendingPublicAttempts(second);
  assert.deepEqual({ wpm:attempt.wpm, accuracy:attempt.accuracy, visitor:attempt.visitor }, { wpm:9.3, accuracy:93, visitor });
  assert.match(attempt.attemptId, /^[a-f0-9]{32}$/);
  assert.equal(acknowledgePublicAttempt(second, attempt.attemptId), true);
  assert.equal(pendingPublicAttempts(second).length, 0);
  recordPublicPart(second, part(2));
  assert.equal(pendingPublicAttempts(second).length, 0, 'a later run starts afresh');
});

test('changed books do not reuse old section progress and storage failure does not report success', () => {
  const store = storage();
  recordPublicPart(store, part(0));
  recordPublicPart(store, part(1, { signature:'book-v2' }));
  recordPublicPart(store, part(2, { signature:'book-v2' }));
  assert.equal(pendingPublicAttempts(store).length, 0);
  recordPublicPart(store, part(0, { signature:'book-v2' }));
  assert.equal(pendingPublicAttempts(store).length, 1);
  assert.equal(recordPublicPart({ getItem:() => null, setItem() { throw Error('full'); } }, part(0)), false);
});

test('a completed zero-WPM run is retained for the completion count', () => {
  const store = storage();
  recordPublicPart(store, part(0, { size:1, counts:{ correct:0, total:50 } }));
  assert.equal(pendingPublicAttempts(store)[0].wpm, 0);
  assert.equal(pendingPublicAttempts(store)[0].accuracy, 0);
});

test('a completed zero-millisecond section is counted without an unmeasurable ranking', () => {
  const store = storage();
  assert.equal(recordPublicPart(store, part(0, { size:1, counts:{ correct:1, total:1 }, elapsed:0 })), true);
  const {wpm, accuracy, completionOnly} = pendingPublicAttempts(store)[0];
  assert.deepEqual({wpm, accuracy, completionOnly}, {wpm:0, accuracy:100, completionOnly:true});
});

test('a zero-millisecond section can be saved and combined with later sections', () => {
  const store = storage();
  assert.equal(recordPublicPart(store, part(0, {size:2, elapsed:0})), true);
  assert.equal(pendingPublicAttempts(store).length, 0);
  assert.equal(recordPublicPart(store, part(1, {size:2})), true);
  const [attempt] = pendingPublicAttempts(store);
  assert.equal(attempt.completionOnly, true);
  assert.equal(attempt.accuracy, 100);
  assert.equal(recordPublicPart(store, part(0, {size:1, elapsed:-1})), false);
});

test('a run over the ranking speed limit is still sent as a completion', () => {
  const store = storage();
  recordPublicPart(store, part(0, { size:1, elapsed:100 }));
  const [attempt] = pendingPublicAttempts(store);
  assert.equal(attempt.completionOnly, true);
  assert.equal(attempt.wpm, 0);
  assert.equal(attempt.accuracy, 100);
});

test('permanent rejection is dropped, while rate limits, server and network failures are retried', async () => {
  const store = storage();
  for (const char of ['a', 'b', 'c', 'd', 'e']) recordPublicPart(store, part(0, { bookId:char.repeat(32), size:1 }));
  const result = await drainPublicAttempts(store, async bookId => {
    if (bookId[0] === 'a') return { ok:false, status:400 };
    if (bookId[0] === 'b') return { ok:false, status:429 };
    if (bookId[0] === 'c') return { ok:false, status:503 };
    if (bookId[0] === 'd') throw Error('offline');
    return { ok:true, status:201 };
  });
  assert.deepEqual(result, { retry:true, discarded:1 });
  assert.deepEqual(pendingPublicAttempts(store).map(item => item.bookId[0]), ['b', 'c', 'd']);
  const again = await drainPublicAttempts(store, async () => ({ ok:true, status:201 }));
  assert.deepEqual(again, { retry:false, discarded:0 });
  assert.deepEqual(pendingPublicAttempts(store), []);
});

test('a full public library keeps the result and reports that it will retry', async () => {
  const store = storage();
  recordPublicPart(store, part(0, { size:1 }));
  const result = await drainPublicAttempts(store, async () => ({ ok:false, status:507 }));
  assert.deepEqual(result, { retry:true, discarded:0, capacity:true });
  assert.equal(pendingPublicAttempts(store).length, 1);
  await drainPublicAttempts(store, async () => ({ ok:true, status:201 }));
  assert.equal(pendingPublicAttempts(store).length, 0);
});

test('a stalled attempt times out, retains its ID and does not block later attempts', async () => {
  const store = storage();
  recordPublicPart(store, part(0, { bookId:'a'.repeat(32), size:1 }));
  recordPublicPart(store, part(0, { bookId:'b'.repeat(32), size:1 }));
  const originalId = pendingPublicAttempts(store)[0].attemptId;
  let aborted = false, sentB = false;
  const result = await drainPublicAttempts(store, (id, attempt) => withPublicAttemptTimeout(signal => {
    if (id[0] === 'a') {
      signal?.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => {}); // Even a non-cooperative fetch must not stall the queue.
    }
    sentB = true;
    return Promise.resolve({ ok:true, status:201 });
  }, 15));
  assert.equal(aborted, true);
  assert.equal(sentB, true);
  assert.deepEqual(result, { retry:true, discarded:0 });
  assert.equal(pendingPublicAttempts(store).length, 1);
  assert.equal(pendingPublicAttempts(store)[0].attemptId, originalId);
  await drainPublicAttempts(store, (_id, attempt) => {
    assert.equal(attempt.attemptId, originalId);
    return Promise.resolve({ ok:true, status:201 });
  });
  assert.equal(pendingPublicAttempts(store).length, 0);
});

test('a successful attempt clears its deadline without aborting later', async () => {
  let aborted = false;
  const response = await withPublicAttemptTimeout(signal => {
    signal?.addEventListener('abort', () => { aborted = true; });
    return Promise.resolve({ok:true});
  }, 15);
  assert.equal(response.ok, true);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(aborted, false);
});

test('start is queued once per reader and book, survives backup and retries after timeout', async () => {
  const first = storage();
  assert.equal(queuePublicStart(first, bookId, visitor), true);
  assert.equal(queuePublicStart(first, bookId, visitor), true);
  assert.equal(pendingPublicStarts(first).length, 1);
  assert.equal(queuePublicStart(first, 'invalid', visitor), false);
  assert.equal(queuePublicStart({getItem:() => null, setItem() {}}, bookId, visitor), false, 'a silently dropped write is not accepted');
  const second = storage();
  await restoreBackup(second, readBackup(JSON.stringify(createBackup(first))));
  let aborted = false;
  const failed = await drainPublicStarts(second, () => withPublicAttemptTimeout(signal => {
    signal?.addEventListener('abort', () => { aborted = true; });
    return new Promise(() => {});
  }, 15));
  assert.equal(aborted, true);
  assert.deepEqual(failed, {retry:true, discarded:0});
  assert.deepEqual(pendingPublicStarts(second), [{bookId, visitor}]);
  const delivered = await drainPublicStarts(second, (id, start) => {
    assert.equal(id, bookId);
    assert.deepEqual(start, {visitor});
    return Promise.resolve({ok:true, status:200});
  });
  assert.deepEqual(delivered, {retry:false, discarded:0});
  assert.deepEqual(pendingPublicStarts(second), []);
});

test('start queue keeps temporary capacity failures and discards removed books', async () => {
  const store = storage();
  queuePublicStart(store, 'a'.repeat(32), visitor);
  queuePublicStart(store, 'b'.repeat(32), visitor);
  const result = await drainPublicStarts(store, id => Promise.resolve({ok:false, status:id[0] === 'a' ? 507 : 400}));
  assert.deepEqual(result, {retry:true, discarded:1, capacity:true});
  assert.deepEqual(pendingPublicStarts(store), [{bookId:'a'.repeat(32), visitor}]);
});

test('reading visits survive failed delivery and backup without duplicating a reader', async () => {
  const first = storage();
  assert.equal(queuePublicRead(first, bookId, visitor), true);
  assert.equal(queuePublicRead(first, bookId, visitor), true);
  assert.deepEqual(pendingPublicReads(first), [{bookId, visitor}]);
  const restored = storage();
  await restoreBackup(restored, readBackup(JSON.stringify(createBackup(first))));
  const failed = await drainPublicReads(restored, () => withPublicAttemptTimeout(() => new Promise(() => {}), 10));
  assert.equal(failed.retry, true);
  assert.deepEqual(pendingPublicReads(restored), [{bookId, visitor}]);
  const sent = await drainPublicReads(restored, (id, payload) => {
    assert.equal(id, bookId);
    assert.deepEqual(payload, {visitor});
    return Promise.resolve({ok:true, status:200});
  });
  assert.equal(sent.retry, false);
  assert.deepEqual(pendingPublicReads(restored), []);
});
