import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquireEditorLock } from '../site/editor-lock.mjs';

test('only one tab obtains the editor lock and another can acquire it after release', async () => {
  let held = false;
  const locks = { async request(name, options, callback) {
    if (held) return callback(null);
    held = true;
    try { return await callback({name}); } finally { held = false; }
  } };
  const first = await acquireEditorLock(locks);
  assert.equal(first.acquired, true);
  assert.equal((await acquireEditorLock(locks)).acquired, false);
  await first.release();
  const next = await acquireEditorLock(locks);
  assert.equal(next.acquired, true);
  await next.release();
});
