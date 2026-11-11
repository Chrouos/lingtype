import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
// The reader opens at #practice; the home page is the library.
const base = new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  let navigation = 0;
  async function open() {
    const url = new URL(base); url.searchParams.set('passage-test', String(++navigation));
    await page.goto(url.href);
    for (let i = 0; i < 100; i++) {
      try { if (await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false)) return; } catch {}
      await sleep(100);
    }
    throw new Error('Practice did not initialize');
  }
  await open();
  await page.eval(async () => {
    const item = {id:'passage-progress', custom:true, title:'Passages', text:'First “sentence”.\n\nSecond sentence.\n\nThird sentence.', words:[], translations:{}};
    const key = JSON.stringify([item.id,'article','all','random']);
    localStorage.setItem('lingtype-last-practice', JSON.stringify({id:item.id,mode:'article',section:'all',passage:'random'}));
    localStorage.setItem('lingtype-progress', JSON.stringify({[key]:{input:'Fir',articleText:'First “sentence”.',articlePassageIndex:0,elapsed:1000}}));
    await new Promise((resolve,reject) => {
      const request = indexedDB.open('lingtype-data');
      request.onsuccess = () => { const db = request.result, tx = db.transaction('values','readwrite'); tx.objectStore('values').put(JSON.stringify([item]), 'lingtype-custom-lessons'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
      request.onerror = () => reject(request.error);
    });
  });
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Fir');
  assert.equal(await page.eval(() => document.getElementById('passage-choice').value), '0');
  await page.eval(() => { document.getElementById('finish-now').click(); document.getElementById('next-action').click(); document.getElementById('typing-stage').click(); });
  await page.send('Input.insertText', {text:'Sec'});
  await page.eval(() => document.getElementById('pause').click());
  const progress = await page.eval(() => JSON.parse(localStorage.getItem('lingtype-progress')));
  assert.equal(progress[JSON.stringify(['passage-progress','article','all','random'])].input, 'Fir');
  assert.equal(progress[JSON.stringify(['passage-progress','article','all','random','part:1'])].input, 'Sec');
  assert.match(await page.eval(() => document.querySelector('#passage-choice option[value="0"]').textContent), /進度/);
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Sec');
  await page.eval(() => { const select = document.getElementById('passage-choice'); select.value = '0'; select.dispatchEvent(new Event('change')); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Fir');
  await page.eval(() => { const select = document.getElementById('passage-choice'); select.value = '1'; select.dispatchEvent(new Event('change')); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Sec');
  assert.deepEqual(page.consoleErrors, []);
  await page.close();
  console.log('legacy and multiple random-passage progress are accessible after reload');
} finally { await browser.close(); }
