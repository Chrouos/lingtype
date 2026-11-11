import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoverUploadQueue } from '../site/cover-upload.mjs';

test('later cover selections cannot finish before earlier ones for the same book', async () => {
  const calls = [], gates = [];
  const upload = createCoverUploadQueue((id, file) => {
    calls.push([id, file]);
    return new Promise((resolve, reject) => gates.push({ resolve, reject }));
  });
  const first = upload('book', 'first');
  const second = upload('book', 'second');
  const other = upload('other', 'parallel');
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls, [['book', 'first'], ['other', 'parallel']]);
  gates[0].resolve();
  await first;
  await Promise.resolve();
  assert.deepEqual(calls, [['book', 'first'], ['other', 'parallel'], ['book', 'second']]);
  gates[1].resolve(); gates[2].resolve();
  await Promise.all([second, other]);
});

test('a failed cover upload does not block the next selection', async () => {
  const calls = [];
  const upload = createCoverUploadQueue(async (_id, file) => {
    calls.push(file);
    if (file === 'first') throw new Error('failed');
    return 'saved';
  });
  const first = upload('book', 'first');
  const second = upload('book', 'second');
  await assert.rejects(first, /failed/);
  assert.equal(await second, 'saved');
  assert.deepEqual(calls, ['first', 'second']);
});
