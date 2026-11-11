import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistEditedCopy } from '../site/library.mjs';
import { createLargeStorage } from '../site/storage.mjs';

const key = 'lingtype-custom-lessons';
const original = {id:'original', custom:true, title:'Original', text:'Old text'};
const copy = {id:'copy', custom:true, title:'Edited', text:'New text'};
const other = {id:'other', custom:true, title:'Other', text:'Other text'};
const raw = value => JSON.stringify(value);
function local(initial = raw([original])) {
  const values = new Map(initial === null ? [] : [[key, initial]]);
  return {getItem:k => values.get(k) ?? null, setItem:(k,v) => values.set(k,String(v)), removeItem:k => values.delete(k)};
}
function backend(initial = raw([original])) {
  const values = new Map(initial === null ? [] : [[key, initial]]);
  return {
    read:async k => values.get(k),
    write:async (k,v) => { if (v === null) values.delete(k); else values.set(k,v); },
    compareAndSet:async (k,expected,value) => {
      if ((values.get(k) ?? null) !== expected) return false;
      if (value === null) values.delete(k); else values.set(k,value);
      return true;
    }, values
  };
}

test('plain durable local storage saves a new copy and rejects invalid identities or dropped writes', async () => {
  const store = local();
  assert.deepEqual(await persistEditedCopy(store, copy), copy);
  assert.deepEqual(JSON.parse(store.getItem(key)), [original, copy]);
  await assert.rejects(persistEditedCopy(store, copy), /exists/);
  await assert.rejects(persistEditedCopy(store, {...copy, id:'public', publicId:'a'.repeat(32)}));
  await assert.rejects(persistEditedCopy({...store, volatile:true}, {...copy, id:'volatile'}));
  const drop = local(); drop.setItem = () => {};
  await assert.rejects(persistEditedCopy(drop, copy), /not saved/);
  assert.deepEqual(JSON.parse(drop.getItem(key)), [original]);
});

test('database copy is verified against durable storage and a stale cache cannot overwrite it', async () => {
  const db = backend(), store = await createLargeStorage(local(), db);
  await persistEditedCopy(store, copy);
  assert.deepEqual(JSON.parse(await db.read(key)), [original, copy]);
  const staleDb = backend(), stale = await createLargeStorage(local(), staleDb);
  staleDb.values.set(key, raw([original, other]));
  await assert.rejects(persistEditedCopy(stale, copy), /out of sync/);
  assert.deepEqual(JSON.parse(await staleDb.read(key)), [original, other]);
});

test('two database-backed editors cannot overwrite one another from the same snapshot', async () => {
  const db = backend(), first = await createLargeStorage(local(), db), second = await createLargeStorage(local(), db);
  const outcomes = await Promise.allSettled([persistEditedCopy(first, copy), persistEditedCopy(second, {...copy, id:'copy-two'})]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
  const stored = JSON.parse(await db.read(key));
  assert.equal(stored.length, 2);
  assert.deepEqual(stored[0], original);
  assert.ok(['copy', 'copy-two'].includes(stored[1].id));
});

test('the returned copy is the durable snapshot even if its input is later mutated', async () => {
  const db = backend(), store = await createLargeStorage(local(), db), mutable = {...copy};
  const compare = db.compareAndSet;
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  db.compareAndSet = async (...args) => { entered(); await new Promise(resolve => { release = resolve; }); return compare(...args); };
  const saving = persistEditedCopy(store, mutable);
  await waiting;
  mutable.text = 'Mutated while waiting';
  release();
  const saved = await saving;
  assert.equal(saved.text, 'New text');
  assert.deepEqual(JSON.parse(await db.read(key))[1], saved);
});

test('a failed previous write is not mistaken for a durable edited copy', async () => {
  const db = backend(), store = await createLargeStorage(local(), db);
  db.write = async () => { throw Error('quota'); };
  store.setItem(key, raw([original, other]));
  await assert.rejects(persistEditedCopy(store, copy), /quota/);
  assert.deepEqual(JSON.parse(store.getItem(key)), [original, other]);
  await assert.rejects(persistEditedCopy(store, copy), /out of sync/);
  assert.deepEqual(JSON.parse(await db.read(key)), [original]);
});

test('a concurrent lesson update survives while an edited copy is being committed', async () => {
  const db = backend(), store = await createLargeStorage(local(), db);
  const compare = db.compareAndSet;
  let release, entered, calls = 0;
  const waiting = new Promise(resolve => { entered = resolve; });
  db.compareAndSet = async (...args) => { if (!calls++) { entered(); await new Promise(resolve => { release = resolve; }); } return compare(...args); };
  const saving = persistEditedCopy(store, copy);
  await waiting;
  store.setItem(key, raw([original, other]));
  release();
  await assert.rejects(saving, /not saved/);
  assert.deepEqual(JSON.parse(store.getItem(key)), [original, other]);
  assert.deepEqual(JSON.parse(await db.read(key)), [original, other]);
});

test('a failed concurrent write does not leave a durable half-copy or discard the other change', async () => {
  const db = backend(), store = await createLargeStorage(local(), db);
  const compare = db.compareAndSet;
  let release, entered, calls = 0;
  const waiting = new Promise(resolve => { entered = resolve; });
  db.compareAndSet = async (...args) => { if (!calls++) { entered(); await new Promise(resolve => { release = resolve; }); } return compare(...args); };
  db.write = async () => { throw Error('quota'); };
  const saving = persistEditedCopy(store, copy);
  await waiting;
  store.setItem(key, raw([original, other]));
  release();
  await assert.rejects(saving, /quota/);
  assert.deepEqual(JSON.parse(store.getItem(key)), [original, other]);
  assert.deepEqual(JSON.parse(await db.read(key)), [original]);
});

test('rollback preserves an external writer that adds another lesson after our commit', async () => {
  const db = backend(), store = await createLargeStorage(local(), db);
  const read = store.readDurable;
  let reads = 0;
  store.readDurable = async k => {
    if (++reads === 2) db.values.set(key, raw([original, copy, other]));
    return read(k);
  };
  await assert.rejects(persistEditedCopy(store, copy), /not saved/);
  assert.deepEqual(JSON.parse(await db.read(key)), [original, other]);
  assert.deepEqual(JSON.parse(store.getItem(key)), [original, other]);
});

test('unconfirmed cleanup is reported when concurrent writes prevent safe rollback', async () => {
  const db = backend(), store = await createLargeStorage(local(), db);
  const read = store.readDurable, compare = db.compareAndSet;
  let reads = 0, writes = 0;
  store.readDurable = async k => {
    if (++reads === 2) db.values.set(key, raw([original, copy, other]));
    return read(k);
  };
  db.compareAndSet = async (...args) => ++writes === 1 ? compare(...args) : false;
  await assert.rejects(persistEditedCopy(store, copy), error => error.code === 'cleanup_failed');
  assert.deepEqual(JSON.parse(await db.read(key)), [original, copy, other]);
});

test('a flush failure cannot report success even when the copy itself reached the database', async () => {
  const db = backend(), store = await createLargeStorage(local(), db);
  const compare = db.compareAndSet, write = db.write;
  let release, entered, calls = 0;
  const waiting = new Promise(resolve => { entered = resolve; });
  db.compareAndSet = async (...args) => { if (!calls++) { entered(); await new Promise(resolve => { release = resolve; }); } return compare(...args); };
  db.write = async (k, v) => { if (k === 'lingtype-translations') throw Error('translation write failed'); return write(k, v); };
  const saving = persistEditedCopy(store, copy);
  await waiting;
  store.setItem('lingtype-translations', 'unsaved');
  release();
  await assert.rejects(saving, /translation write failed/);
  assert.equal(store.getItem('lingtype-translations'), 'unsaved');
  assert.deepEqual(JSON.parse(store.getItem(key)), [original]);
  assert.deepEqual(JSON.parse(await db.read(key)), [original]);
});
