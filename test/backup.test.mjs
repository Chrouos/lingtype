import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, createBackupWithPdfs, readBackup, verifyBackup, hasUnverifiedPdfs, restoreBackup, stageBackupRestore, applyStagedBackup } from '../site/backup.mjs';
import { readCustomLessons } from '../site/library.mjs';
import { readSnapshot, snapshotKey } from '../site/practice.mjs';

function memory(initial = {}) {
  const values = {...initial};
  return { values, getItem:k => values[k] ?? null, setItem(k,v) { values[k] = v; }, removeItem(k) { delete values[k]; } };
}

test('backup and restore include lessons, translations, notebook and progress', async () => {
  const source = memory({'lingtype-custom-lessons':'[{"id":"a","custom":true,"title":"Hello","text":"Hello.","words":[],"translations":{}}]', 'lingtype-translations':'{"zh\\u0000Hello.":"你好。"}', 'lingtype-notebook':'[]', 'lingtype-progress':'{"one":{"input":"H"}}'});
  const data = readBackup(JSON.stringify(createBackup(source)));
  const destination = memory({'lingtype-notebook':'[{"word":"old"}]'});
  await restoreBackup(destination, data);
  for (const [key, value] of Object.entries(source.values)) assert.equal(destination.getItem(key), value);
});

test('reading positions are backed up and malformed ones are rejected', async () => {
  const reading = JSON.stringify({ a:{ section:'all', at:2, time:'2026-11-11T00:00:00.000Z', read:{ all:[0, 1] } } });
  const source = memory({'lingtype-reading':reading});
  const destination = memory();
  await restoreBackup(destination, readBackup(JSON.stringify(createBackup(source))));
  assert.equal(destination.getItem('lingtype-reading'), reading);
  assert.throws(() => readBackup(JSON.stringify({format:'lingtype-backup', version:1, data:{'lingtype-reading':'{"a":{"section":"x","at":0}}'}})));
});

test('older backups preserve independent copies and progress for two publications', async () => {
  const a = {id:'copy-a', custom:true, title:'A story', text:'A story.', words:[], publicId:'a'.repeat(32)};
  const b = {id:'copy-b', custom:true, title:'A story', text:'A story.', words:[], publicId:'b'.repeat(32)};
  const keyA = snapshotKey(a.id, 'article', 'all', 'full'), keyB = snapshotKey(b.id, 'article', 'all', 'full');
  const source = memory({
    'lingtype-custom-lessons':JSON.stringify([a, b]),
    'lingtype-progress':JSON.stringify({[keyA]:{input:'A'}, [keyB]:{input:'A s'}})
  });
  const oldBackup = JSON.stringify(createBackup(source)); // Version 1, before PDF backups.
  const restored = memory();
  await restoreBackup(restored, readBackup(oldBackup));
  assert.deepEqual(readCustomLessons(restored).map(item => [item.id, item.publicId]), [[a.id, a.publicId], [b.id, b.publicId]]);
  assert.equal(readSnapshot(restored, keyA).input, 'A');
  assert.equal(readSnapshot(restored, keyB).input, 'A s');
});

test('restoring retains the community reader identity and name on a new browser', async () => {
  const source = memory({ 'lingtype-visitor':'a'.repeat(32), 'lingtype-reader-name':'讀者', 'lingtype-published-keys':JSON.stringify({ ['b'.repeat(32)]:'owner-key' }) });
  const destination = memory({ 'lingtype-visitor':'c'.repeat(32), 'lingtype-reader-name':'Old name' });
  await restoreBackup(destination, readBackup(JSON.stringify(createBackup(source))));
  assert.equal(destination.getItem('lingtype-visitor'), 'a'.repeat(32));
  assert.equal(destination.getItem('lingtype-reader-name'), '讀者');
  assert.equal(destination.getItem('lingtype-published-keys'), source.getItem('lingtype-published-keys'));
});

test('legacy backup preserves the existing reader identity and invalid identities are rejected', async () => {
  const destination = memory({ 'lingtype-visitor':'a'.repeat(32), 'lingtype-reader-name':'Reader' });
  await restoreBackup(destination, readBackup(JSON.stringify({ format:'lingtype-backup', version:1, data:{ 'lingtype-notebook':'[]' } })));
  assert.equal(destination.getItem('lingtype-visitor'), 'a'.repeat(32));
  assert.equal(destination.getItem('lingtype-reader-name'), 'Reader');
  assert.throws(() => readBackup(JSON.stringify({ format:'lingtype-backup', version:1, data:{ 'lingtype-visitor':'not-an-id' } })));
  assert.throws(() => readBackup(JSON.stringify({ format:'lingtype-backup', version:1, data:{ 'lingtype-reader-name':'x'.repeat(41) } })));
});

test('rejects invalid backups before changing any data', async () => {
  const destination = memory({'lingtype-notebook':'[]'});
  assert.throws(() => readBackup(JSON.stringify({format:'lingtype-backup', version:1, data:{'lingtype-notebook':'not json'}})));
  assert.throws(() => readBackup(JSON.stringify({format:'lingtype-backup', version:1, data:{'foreign-key':'[]'}})));
  assert.throws(() => readBackup(JSON.stringify({format:'lingtype-backup', version:1, data:{'lingtype-custom-lessons':'[{"text":"hello"}]'}})));
  assert.deepEqual(destination.values, {'lingtype-notebook':'[]'});
});

test('restore rolls back previous values if a write fails', async () => {
  const destination = memory({'lingtype-language':'zh', 'lingtype-notebook':'[]'});
  const set = destination.setItem;
  let failed = false;
  destination.setItem = (key,value) => { if (key === 'lingtype-notebook' && !failed) { failed = true; throw Error('quota'); } set(key,value); };
  const data = readBackup(JSON.stringify({format:'lingtype-backup',version:1,data:{'lingtype-language':'ja','lingtype-notebook':'[{"word":"new","sentences":[],"translations":{}}]'}}));
  await assert.rejects(restoreBackup(destination, data));
  assert.deepEqual(destination.values, {'lingtype-language':'zh', 'lingtype-notebook':'[]'});
});

test('rollback removes a newly restored identity if a later identity write fails', async () => {
  const destination = memory();
  const set = destination.setItem;
  let failed = false;
  destination.setItem = (key, value) => { if (key === 'lingtype-reader-name' && !failed) { failed = true; throw Error('quota'); } set(key, value); };
  await assert.rejects(restoreBackup(destination, { 'lingtype-visitor':'a'.repeat(32), 'lingtype-reader-name':'Reader' }));
  assert.deepEqual(destination.values, {});
});

test('PDF bytes round-trip with their lessons and replace the previous PDF set', async () => {
  const lesson = {id:'paper', title:'Paper', text:'Text', words:[], figures:[{kind:'page', page:1}]};
  const source = memory({'lingtype-custom-lessons':JSON.stringify([lesson])});
  const original = new Blob(['%PDF-1.7\nexample\n%%EOF'], {type:'application/pdf'});
  const backup = await createBackupWithPdfs(source, {read:async key => key === 'pdf:paper' ? original : null});
  const data = readBackup(JSON.stringify(backup));
  const destination = memory({'lingtype-language':'ja'});
  const files = new Map([['pdf:old', new Blob(['old'])]]);
  const database = {replacePrefix:async (prefix, entries) => { for (const key of files.keys()) if (key.startsWith(prefix)) files.delete(key); for (const [key, value] of entries) files.set(key, value); }};
  await restoreBackup(destination, data, database);
  assert.equal(await files.get('pdf:paper').text(), await original.text());
  assert.equal(files.has('pdf:old'), false);
  assert.equal(destination.getItem('lingtype-custom-lessons'), source.getItem('lingtype-custom-lessons'));
});

test('missing or invalid PDF data is rejected before any replacement', async () => {
  const lesson = {id:'paper', title:'Paper', text:'Text', words:[], figures:[{kind:'page', page:1}]};
  const source = memory({'lingtype-custom-lessons':JSON.stringify([lesson])});
  await assert.rejects(createBackupWithPdfs(source, {read:async () => undefined}), /Missing PDF/);
  const file = await createBackupWithPdfs(source, {read:async () => new Blob(['%PDF-1.7\ntest\n%%EOF'])});
  for (const pdfs of [[], [{id:'paper',data:'@@@@'}], [{id:'other',data:'YWJj'}], [file.pdfs[0], file.pdfs[0]]]) {
    assert.throws(() => readBackup(JSON.stringify({...file, pdfs})), /Invalid backup/);
  }
});

test('PDF checksum rejects changed but still well-formed bytes before touching data', async () => {
  const lesson = {id:'paper', title:'Paper', text:'Text', words:[], figures:[{kind:'page', page:1}]};
  const source = memory({'lingtype-custom-lessons':JSON.stringify([lesson])});
  const backup = await createBackupWithPdfs(source, {read:async () => new Blob(['%PDF-1.7\noriginal\n%%EOF'])});
  assert.equal(backup.version, 3);
  const parsed = readBackup(JSON.stringify(backup));
  await verifyBackup(parsed);
  backup.pdfs[0].data = btoa('%PDF-1.7\ncorrupted\n%%EOF');
  const damaged = readBackup(JSON.stringify(backup)), destination = memory({'lingtype-language':'zh'});
  let replaced = false;
  await assert.rejects(restoreBackup(destination, damaged, {replacePrefix:async () => { replaced = true; }}), /checksum mismatch/);
  assert.deepEqual(destination.values, {'lingtype-language':'zh'});
  assert.equal(replaced, false);
  await assert.rejects(stageBackupRestore(destination, {write:async () => { throw Error('must not stage'); }}, JSON.stringify(backup)), /checksum mismatch/);
});

test('older PDF backups remain readable but are marked unverified', async () => {
  const lesson = {id:'paper', title:'Paper', text:'Text', words:[], figures:[{kind:'page', page:1}]};
  const data = {'lingtype-custom-lessons':JSON.stringify([lesson])};
  const bytes = 'leading data\n%PDF-1.7\nbody\n%%EOF\ntrailing data';
  const legacy = {format:'lingtype-backup', version:2, data, pdfs:[{id:'paper', data:btoa(bytes)}]};
  const parsed = readBackup(JSON.stringify(legacy));
  assert.equal(hasUnverifiedPdfs(parsed), true);
  await verifyBackup(parsed);
  const destination = memory(), files = new Map();
  const db = {read:async key => files.get(key), mergeMissing:async entries => { for (const [key, value] of entries) if (!files.has(key)) files.set(key, value); }};
  await restoreBackup(destination, parsed, db);
  assert.equal(await files.get('pdf:paper').text(), bytes);
  const damaged = readBackup(JSON.stringify({...legacy, pdfs:[{id:'paper',data:btoa('not a PDF')}]}));
  await assert.rejects(restoreBackup(destination, damaged, db), error => error.code === 'legacy_pdf_conflict');
  assert.equal(await files.get('pdf:paper').text(), bytes, 'unverified old backups must not overwrite an existing original');
});

test('a PDF backup cannot be exported or restored without WebCrypto', async () => {
  const lesson = {id:'paper', title:'Paper', text:'Text', words:[], figures:[{kind:'page', page:1}]};
  const source = memory({'lingtype-custom-lessons':JSON.stringify([lesson])});
  const valid = await createBackupWithPdfs(source, {read:async () => new Blob(['%PDF-1.7\nbody\n%%EOF'])});
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', {configurable:true, value:undefined});
    await assert.rejects(createBackupWithPdfs(source, {read:async () => new Blob(['%PDF-1.7\nbody\n%%EOF'])}), /checksum unavailable/);
    await assert.rejects(verifyBackup(readBackup(JSON.stringify(valid))), /checksum unavailable/);
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});

test('a failed atomic PDF replacement rolls back text and legacy backups leave PDFs untouched', async () => {
  const lesson = {id:'paper', title:'Paper', text:'Text', words:[], figures:[{kind:'page', page:1}]};
  const source = memory({'lingtype-custom-lessons':JSON.stringify([lesson])});
  const backup = await createBackupWithPdfs(source, {read:async () => new Blob(['%PDF-1.7\ntest\n%%EOF'])});
  const destination = memory({'lingtype-language':'zh', 'lingtype-notebook':'[]'});
  const before = {...destination.values};
  await assert.rejects(restoreBackup(destination, readBackup(JSON.stringify(backup)), {replacePrefix:async () => { throw Error('quota'); }}), /quota/);
  assert.deepEqual(destination.values, before);
  let changed = false;
  await restoreBackup(destination, readBackup(JSON.stringify(createBackup(source))), {replacePrefix:async () => { changed = true; }});
  assert.equal(changed, false);
});

function journalDatabase() {
  const values = new Map();
  return {
    values,
    async read(key) { return values.get(key); },
    async write(key, value) { values.set(key, structuredClone(value)); },
    async remove(key) { values.delete(key); },
    async commitRestore(pdfs, preserveExisting = false) {
      if (pdfs !== null) {
        if (!preserveExisting) for (const key of values.keys()) if (key.startsWith('pdf:')) values.delete(key);
        for (const [key, value] of pdfs) if (!preserveExisting || !values.has(key)) values.set(key, value);
      }
      values.delete('pending-restore');
    }
  };
}

test('volatile session storage cannot stage a restore that would be lost on reload', async () => {
  const storage = {...memory({'lingtype-language':'zh'}), volatile:true}, db = journalDatabase();
  const json = JSON.stringify({format:'lingtype-backup',version:1,data:{'lingtype-language':'ja'}});
  await assert.rejects(stageBackupRestore(storage, db, json), /persistent storage/);
  assert.equal(db.values.has('pending-restore'), false);
  assert.equal(storage.getItem('lingtype-language'), 'zh');
});

test('interrupted restore retains its original snapshot and rolls back after a later quota failure', async () => {
  const old = {'lingtype-language':'zh', 'lingtype-notebook':'[]'};
  const storage = memory(old), db = journalDatabase();
  const oldPdf = new Blob(['old PDF']); db.values.set('pdf:old', oldPdf);
  const lesson = {id:'paper', title:'Paper', text:'Text', words:[], figures:[{kind:'page',page:1}]};
  const source = memory({'lingtype-language':'ja', 'lingtype-custom-lessons':JSON.stringify([lesson])});
  const backup = await createBackupWithPdfs(source, {read:async () => new Blob(['%PDF-1.7\nnew\n%%EOF'])});
  await stageBackupRestore(storage, db, JSON.stringify(backup));
  // The old process died after applying part of the text, before the PDF transaction.
  storage.setItem('lingtype-language', 'ja');
  storage.setItem('lingtype-custom-lessons', source.getItem('lingtype-custom-lessons'));
  db.commitRestore = async () => { throw Error('quota'); };
  await assert.rejects(applyStagedBackup(storage, db, await db.read('pending-restore')), /quota/);
  assert.deepEqual(storage.values, old);
  assert.equal(await db.values.get('pdf:old').text(), 'old PDF');
  assert.equal(db.values.has('pdf:paper'), false);
  assert.equal(db.values.has('pending-restore'), false);
});

test('failed rollback retains its journal and can recover on the next launch', async () => {
  const old = {'lingtype-language':'zh', 'lingtype-notebook':'[]'};
  const storage = memory(old), db = journalDatabase();
  const backup = JSON.stringify({format:'lingtype-backup', version:1, data:{'lingtype-language':'ja'}});
  await stageBackupRestore(storage, db, backup);
  storage.setItem('lingtype-language', 'ja');
  const set = storage.setItem;
  storage.setItem = (key, value) => { if (key === 'lingtype-notebook') throw Error('quota'); set(key, value); };
  await assert.rejects(applyStagedBackup(storage, db, await db.read('pending-restore')), error => error.recoveryPending === true);
  assert.equal(db.values.has('pending-restore'), true);
  storage.setItem = set;
  await applyStagedBackup(storage, db, await db.read('pending-restore'));
  assert.equal(storage.getItem('lingtype-language'), 'ja');
  assert.equal(db.values.has('pending-restore'), false);
});

test('staged legacy PDF restore preserves existing originals and adds missing files', async () => {
  const db = journalDatabase(), storage = memory();
  const lesson = id => ({id, title:id, text:'Text', words:[], figures:[{kind:'page',page:1}]});
  db.values.set('pdf:keep', new Blob(['original']));
  db.values.set('pdf:unrelated', new Blob(['unrelated']));
  const backup = {format:'lingtype-backup', version:2, data:{'lingtype-custom-lessons':JSON.stringify([lesson('keep'), lesson('new')])}, pdfs:[{id:'keep', data:btoa('original')}, {id:'new',data:btoa('old backup bytes')}]};
  await stageBackupRestore(storage, db, JSON.stringify(backup));
  await applyStagedBackup(storage, db, await db.read('pending-restore'));
  assert.equal(await db.values.get('pdf:keep').text(), 'original');
  assert.equal(await db.values.get('pdf:new').text(), 'old backup bytes');
  assert.equal(await db.values.get('pdf:unrelated').text(), 'unrelated');
  assert.equal(db.values.has('pending-restore'), false);
});

test('legacy PDF conflict before staging keeps the current text and PDF intact', async () => {
  const db = journalDatabase(), storage = memory({'lingtype-language':'zh'});
  db.values.set('pdf:paper', new Blob(['original']));
  const lesson = {id:'paper', title:'Paper', text:'New text', words:[], figures:[{kind:'page',page:1}]};
  const backup = {format:'lingtype-backup', version:2, data:{'lingtype-custom-lessons':JSON.stringify([lesson]), 'lingtype-language':'ja'}, pdfs:[{id:'paper', data:btoa('changed!')}]};
  await assert.rejects(stageBackupRestore(storage, db, JSON.stringify(backup)), error => error.code === 'legacy_pdf_conflict');
  assert.deepEqual(storage.values, {'lingtype-language':'zh'});
  assert.equal(await db.values.get('pdf:paper').text(), 'original');
  assert.equal(db.values.has('pending-restore'), false);
});

test('legacy PDF changes between byte comparison and commit roll text back', async () => {
  const db = journalDatabase(), storage = memory({'lingtype-language':'zh'});
  db.values.set('pdf:paper', new Blob(['same']));
  db.values.set('pdf-revision', 'first');
  const lesson = {id:'paper', title:'Paper', text:'New text', words:[], figures:[{kind:'page',page:1}]};
  const backup = {format:'lingtype-backup', version:2, data:{'lingtype-custom-lessons':JSON.stringify([lesson]), 'lingtype-language':'ja'}, pdfs:[{id:'paper', data:btoa('same')}]};
  await stageBackupRestore(storage, db, JSON.stringify(backup));
  db.commitRestore = async (_entries, _preserve, expected) => {
    db.values.set('pdf-revision', 'second');
    if (db.values.get('pdf-revision') !== expected) throw Object.assign(Error('conflict'), {code:'legacy_pdf_conflict'});
  };
  await assert.rejects(applyStagedBackup(storage, db, await db.read('pending-restore')), error => error.code === 'legacy_pdf_conflict');
  assert.deepEqual(storage.values, {'lingtype-language':'zh'});
  assert.equal(await db.values.get('pdf:paper').text(), 'same');
  assert.equal(db.values.has('pending-restore'), false);
});
