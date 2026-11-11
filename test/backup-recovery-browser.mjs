// Simulate a process interruption after text writes and an IndexedDB quota failure on retry.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(new URL('style.css', base).href);
  await page.eval(async () => {
    const oldLesson = {id:'old', custom:true, title:'Old lesson', text:'Old text.', words:[]};
    const newLesson = {id:'new', custom:true, title:'New lesson', text:'New text.', words:[], figures:[{kind:'page',page:1}]};
    const before = {'lingtype-custom-lessons':JSON.stringify([oldLesson]), 'lingtype-notebook':'[]', 'lingtype-language':'zh'};
    const incoming = {'lingtype-custom-lessons':JSON.stringify([newLesson]), 'lingtype-notebook':'[{"word":"new","sentences":[],"translations":{}}]', 'lingtype-language':'zh'};
    const json = JSON.stringify({format:'lingtype-backup', version:2, data:incoming, pdfs:[{id:'new', data:btoa('%PDF-1.7\nnew\n%%EOF')}]});
    localStorage.setItem('lingtype-notebook', incoming['lingtype-notebook']);
    localStorage.setItem('lingtype-language', 'zh');
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('lingtype-data', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('values');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('values', 'readwrite'), store = tx.objectStore('values');
        store.put(incoming['lingtype-custom-lessons'], 'lingtype-custom-lessons');
        store.put(new Blob(['old PDF']), 'pdf:old');
        store.put({version:1, json, before}, 'pending-restore');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
    });
  });
  // Abort only the PDF replacement transaction; the old PDF must survive it.
  const {identifier} = await page.send('Page.addScriptToEvaluateOnNewDocument', {source:`(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(value, key) { if (key === 'pdf:new') throw new DOMException('quota', 'QuotaExceededError'); return put.call(this, value, key); }; })()`});
  await page.goto(base);
  for (let i = 0; i < 200; i++) {
    if (await page.eval(() => document.getElementById('backup-message')?.textContent.includes('還原失敗'))) break;
    await pause(100);
  }
  assert.match(await page.eval(() => document.getElementById('backup-message')?.textContent || ''), /還原失敗/);
  assert.equal(await page.eval(() => JSON.parse(localStorage.getItem('lingtype-notebook')).length), 0);
  const state = await page.eval(async () => new Promise((resolve, reject) => {
    const open = indexedDB.open('lingtype-data');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, store = db.transaction('values').objectStore('values');
      const keys = ['lingtype-custom-lessons', 'pdf:old', 'pdf:new', 'pending-restore'];
      Promise.all(keys.map(key => new Promise((done, fail) => { const req = store.get(key); req.onsuccess = () => done(req.result); req.onerror = () => fail(req.error); }))).then(async values => {
        const result = {lessons:JSON.parse(values[0]), old:await values[1]?.text(), newPresent:values[2] !== undefined, pending:values[3] !== undefined};
        db.close(); resolve(result);
      }, reject);
    };
  }));
  assert.equal(state.lessons[0].title, 'Old lesson');
  assert.equal(state.old, 'old PDF');
  assert.equal(state.newPresent, false);
  assert.equal(state.pending, false);
  await page.send('Page.removeScriptToEvaluateOnNewDocument', {identifier});
  await page.close();
  process.stdout.write('Interrupted backup restore rolls back after an IndexedDB abort\n');
} finally { await browser.close(); }
