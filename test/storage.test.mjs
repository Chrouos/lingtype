import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLargeStorage } from '../site/storage.mjs';

test('migrates large values once and persists subsequent writes in the database', async () => {
  const local = new Map([['lingtype-custom-lessons', 'old']]);
  const storage = { getItem:k => local.get(k) ?? null, setItem:(k,v) => local.set(k,v) };
  const db = new Map();
  const backend = { read:async k => db.get(k), write:async (k,v) => { db.set(k,v); } };
  const large = await createLargeStorage(storage, backend);
  assert.equal(large.getItem('lingtype-custom-lessons'), 'old');
  large.setItem('lingtype-custom-lessons', 'new');
  await large.flush();
  assert.equal(db.get('lingtype-custom-lessons'), 'new');
  const reopened = await createLargeStorage(storage, backend);
  assert.equal(reopened.getItem('lingtype-custom-lessons'), 'new');
});

test('reports database write failure and retains current in-memory data', async () => {
  const errors = [];
  const large = await createLargeStorage(null, { read:async () => undefined, write:async () => { throw Error('quota'); } }, e => errors.push(e));
  large.setItem('lingtype-translations', 'current');
  await assert.rejects(large.flush(), /quota/);
  assert.equal(large.getItem('lingtype-translations'), 'current');
  assert.equal(errors.length, 1);
});
