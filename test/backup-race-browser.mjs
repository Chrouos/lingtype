// Verify the real IndexedDB commit rejects a PDF changed after legacy byte comparison.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(new URL('style.css', base).href);
  const result = await page.eval(async () => {
    const {openLargeDatabase, createLargeStorage} = await import('/storage.mjs');
    const {stageBackupRestore, applyStagedBackup} = await import('/backup.mjs');
    const database = await openLargeDatabase(indexedDB);
    const storage = await createLargeStorage(localStorage, database);
    storage.setItem('lingtype-language', 'zh');
    await database.write('pdf:paper', new Blob(['original']));
    const lesson = {id:'paper',title:'Paper',text:'Text',words:[],figures:[{kind:'page',page:1}]};
    const json = JSON.stringify({format:'lingtype-backup',version:2,data:{'lingtype-language':'ja','lingtype-custom-lessons':JSON.stringify([lesson])},pdfs:[{id:'paper',data:btoa('original')}]});
    await stageBackupRestore(storage, database, json);
    const originalCommit = database.commitRestore;
    database.commitRestore = async (...args) => {
      await database.write('pdf:paper', new Blob(['changed by another tab']));
      return originalCommit(...args);
    };
    let code;
    try { await applyStagedBackup(storage, database, await database.read('pending-restore')); }
    catch (error) { code = error.code; }
    return {code, language:storage.getItem('lingtype-language'), pdf:await (await database.read('pdf:paper')).text(), pending:await database.read('pending-restore') !== undefined};
  });
  assert.deepEqual(result, {code:'legacy_pdf_conflict', language:'zh', pdf:'changed by another tab', pending:false});
  await page.close();
  process.stdout.write('Legacy PDF revision race rolls back without overwriting the concurrent change\n');
} finally { await browser.close(); }
