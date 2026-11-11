// Check PDF deletion ordering, switching lessons, and backup while deletion is pending.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(new URL('style.css', base).href);
  await page.eval(async () => {
    const paper = {id:'paper',custom:true,title:'Paper',text:'Text here.',words:[],translations:{},figures:[{kind:'page',page:1,anchor:'Text here.'}]};
    const other = {id:'other',custom:true,title:'Other',text:'Other text.',words:[],translations:{}};
    localStorage.setItem('lingtype-language','zh');
    localStorage.setItem('lingtype-last-practice',JSON.stringify({id:'paper',mode:'article',section:'all',passage:'full'}));
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('lingtype-data', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('values');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('values','readwrite'), store = tx.objectStore('values');
        store.put(JSON.stringify([paper, other]), 'lingtype-custom-lessons');
        store.put(new Blob(['original PDF']), 'pdf:paper');
        tx.oncomplete = () => {db.close(); resolve();}; tx.onabort = () => reject(tx.error);
      };
    });
  });
  await page.goto(base);
  for (let i=0; i<200; i++) { if (await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false)) break; await pause(100); }
  await page.eval(() => document.getElementById('preview-start').click());
  assert.equal(await page.eval(() => document.getElementById('lesson').selectedOptions[0].textContent), 'Paper');
  await page.eval(() => {
    window.confirm = () => true; window.alert = text => { window.deletionError = text; };
    const put = IDBObjectStore.prototype.put; window.originalDeleteTestPut = put;
    let fail = true;
    IDBObjectStore.prototype.put = function(value, key) {
      if (key === 'lingtype-custom-lessons' && fail) { fail = false; throw new DOMException('quota', 'QuotaExceededError'); }
      return put.call(this, value, key);
    };
    document.getElementById('delete-lesson').click();
  });
  for (let i=0; i<200; i++) { if (await page.eval(() => Boolean(window.deletionError))) break; await pause(100); }
  assert.ok(await page.eval(() => Boolean(window.deletionError)));
  assert.equal(await page.eval(() => document.getElementById('lesson').selectedOptions[0].textContent), 'Paper');
  const original = await page.eval(async () => {
    const {openLargeDatabase} = await import('/storage.mjs'), db = await openLargeDatabase(indexedDB);
    return {lessons:JSON.parse(await db.read('lingtype-custom-lessons')).map(item => item.id), pdf:await (await db.read('pdf:paper')).text()};
  });
  assert.deepEqual(original, {lessons:['paper','other'], pdf:'original PDF'});
  await page.eval(() => {
    IDBObjectStore.prototype.put = window.originalDeleteTestPut;
    document.getElementById('delete-lesson').click();
    document.getElementById('backup-export').click();
    const input = document.getElementById('backup-file'), files = new DataTransfer();
    files.items.add(new File([JSON.stringify({format:'lingtype-backup',version:1,data:{'lingtype-language':'ja'}})], 'backup.json'));
    input.files = files.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    const selector = document.getElementById('lesson'); selector.value = '0'; selector.dispatchEvent(new Event('change'));
  });
  assert.match(await page.eval(() => document.getElementById('backup-message').textContent), /教材正在刪除/);
  for (let i=0; i<200; i++) { if (await page.eval(() => !document.getElementById('delete-lesson').disabled)) break; await pause(100); }
  assert.notEqual(await page.eval(() => document.getElementById('lesson').selectedOptions[0].textContent), 'Paper');
  const after = await page.eval(async () => {
    const {openLargeDatabase} = await import('/storage.mjs'), db = await openLargeDatabase(indexedDB);
    return {lessons:JSON.parse(await db.read('lingtype-custom-lessons')).map(item => item.id), pdf:await db.read('pdf:paper') !== undefined};
  });
  assert.deepEqual(after, {lessons:['other'], pdf:false});
  await page.close();
  process.stdout.write('PDF deletion preserves data on failure and respects concurrent navigation and backup\n');
} finally { await browser.close(); }
