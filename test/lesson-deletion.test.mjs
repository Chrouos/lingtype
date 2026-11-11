import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistLessonRemoval } from '../site/library.mjs';
import { createLargeStorage } from '../site/storage.mjs';

const lessons = [{id:'paper', custom:true, title:'Paper'}, {id:'other', custom:true, title:'Other'}];

test('a failed database deletion restores the in-memory and persisted lesson list', async () => {
  const original = JSON.stringify(lessons), values = new Map([['lingtype-custom-lessons', original]]);
  let fail = true;
  const backend = {read:async key => values.get(key), write:async (key, value) => {
    if (key === 'lingtype-custom-lessons' && fail) { fail = false; throw Error('quota'); }
    values.set(key, value);
  }};
  const storage = await createLargeStorage(null, backend);
  await assert.rejects(persistLessonRemoval(storage, lessons, 'paper'), /quota/);
  assert.equal(storage.getItem('lingtype-custom-lessons'), original);
  assert.equal(values.get('lingtype-custom-lessons'), original);
});

test('a concurrent lesson update is not overwritten by deletion rollback', async () => {
  const original = JSON.stringify(lessons), values = new Map([['lingtype-custom-lessons', original]]);
  let release;
  const backend = {read:async key => values.get(key), write:async (key, value) => {
    if (!release) await new Promise(resolve => { release = resolve; });
    values.set(key, value);
  }};
  const storage = await createLargeStorage(null, backend);
  const deleting = persistLessonRemoval(storage, lessons, 'paper');
  while (!release) await Promise.resolve();
  const changed = JSON.stringify([...lessons, {id:'new', custom:true, title:'New'}]);
  storage.setItem('lingtype-custom-lessons', changed);
  release();
  await assert.rejects(deleting, /changed during deletion/);
  await storage.flush();
  assert.equal(storage.getItem('lingtype-custom-lessons'), changed);
  assert.equal(values.get('lingtype-custom-lessons'), changed);
});
