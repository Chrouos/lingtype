// Run against an isolated test server with LINGTYPE_URL set to its address.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/');
  const result = await page.eval(async () => {
    const {openLargeDatabase, createLargeStorage} = await import('/storage.mjs');
    const {persistEditedCopy} = await import('/library.mjs');
    const key = 'lingtype-custom-lessons';
    const original = {id:'original', custom:true, title:'Original', text:'Old'};
    const copy = {id:'copy', custom:true, title:'Copy', text:'Edited'};
    const extra = {id:'other', custom:true, title:'Other', text:'More'};
    const db = await openLargeDatabase(indexedDB);
    await db.write(key, JSON.stringify([original]));
    const storage = await createLargeStorage(localStorage, db);
    await persistEditedCopy(storage, copy);
    const stored = JSON.parse(await db.read(key));
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, id) {
      const result = put.call(this, value, id);
      if (id === key && typeof value === 'string' && value.includes('bad-copy')) this.transaction.abort();
      return result;
    };
    let aborted = false;
    try { await persistEditedCopy(storage, {...copy, id:'bad-copy'}); } catch { aborted = true; }
    IDBObjectStore.prototype.put = put;
    const afterAbort = JSON.parse(await db.read(key));
    const readDurable = storage.readDurable;
    let reads = 0, conflicted = false;
    const conflict = {...copy, id:'conflict'};
    storage.readDurable = async id => {
      if (++reads === 2) await db.write(key, JSON.stringify([...stored, conflict, extra]));
      return readDurable(id);
    };
    try { await persistEditedCopy(storage, conflict); } catch { conflicted = true; }
    storage.readDurable = readDurable;
    const afterConflict = JSON.parse(await db.read(key));
    const next = {id:'external', custom:true, title:'External', text:'More'};
    await db.write(key, JSON.stringify([...afterConflict, next]));
    let rejected = false;
    try { await persistEditedCopy(storage, {...copy, id:'stale'}); } catch { rejected = true; }
    return {stored, aborted, afterAbort, conflicted, afterConflict, rejected, final:JSON.parse(await db.read(key))};
  });
  assert.deepEqual(result.stored.map(item => item.id), ['original', 'copy']);
  assert.equal(result.aborted, true);
  assert.deepEqual(result.afterAbort, result.stored);
  assert.equal(result.conflicted, true);
  assert.deepEqual(result.afterConflict.map(item => item.id), ['original', 'copy', 'other']);
  assert.equal(result.rejected, true);
  assert.deepEqual(result.final.map(item => item.id), ['original', 'copy', 'other', 'external']);
  console.log('Edited copy is durable and stale data does not overwrite another change');
} finally { await browser.close(); }
