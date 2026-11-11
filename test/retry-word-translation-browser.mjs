// Run against a local server with a disposable Chrome profile.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.setViewport({width:390,height:700,mobile:true});
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source:`(() => {
    const original = window.fetch;
    window.fetch = (url, options) => url === '/api/translate'
      ? Promise.resolve(new Response(JSON.stringify(window.translationAvailable ? {translations:['困難']} : {error:'offline'}), {status:window.translationAvailable ? 200 : 503, headers:{'Content-Type':'application/json'}}))
      : original(url, options);
  })()`});
  let navigation = 0;
  const open = async () => {
    const url = new URL(base); url.searchParams.set('retry-test', String(++navigation));
    await page.goto(url.href);
    for (let i = 0; i < 100 && !await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false); i++) await sleep(100);
    assert.equal(await page.eval(() => document.getElementById('lesson-chooser').hidden), false);
  };
  await open();
  await page.eval(async () => {
    const item = {id:'review-only', custom:true, title:'Example', text:'A difficult word.', words:[], translations:{}};
    const key = JSON.stringify([item.id, 'word', 'all', 'full']);
    localStorage.setItem('lingtype-last-practice', JSON.stringify({id:item.id, mode:'word', section:'all', passage:'full'}));
    localStorage.setItem('lingtype-progress', JSON.stringify({[key]:{input:'di',wordIndex:0,errors:1,elapsed:1000,articleText:item.text,wrongWords:['difficult'],retryWords:[['difficult','','','']]}}));
    await new Promise((resolve,reject) => {
      const request = indexedDB.open('lingtype-data');
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('values', 'readwrite');
        tx.objectStore('values').put(JSON.stringify([item]), 'lingtype-custom-lessons');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await open();
  await page.eval(() => document.getElementById('preview-start').click());
  for (let i = 0; i < 100 && await page.eval(() => document.getElementById('retry-current-translation')?.hidden !== false); i++) await sleep(100);
  assert.equal(await page.eval(() => document.getElementById('retry-current-translation').hidden), false);
  await page.eval(() => { window.translationAvailable = true; document.getElementById('retry-current-translation').click(); });
  for (let i = 0; i < 100 && await page.eval(() => document.querySelector('#exercise .translation')?.textContent !== '困難'); i++) await sleep(100);
  assert.equal(await page.eval(() => document.querySelector('#exercise .translation').textContent), '困難');
  assert.equal(await page.eval(() => document.getElementById('retry-current-translation').hidden), true);
  assert.ok(await page.eval(() => document.documentElement.scrollWidth <= 390));
  assert.deepEqual(page.consoleErrors, []);
  await page.close();
  console.log('error-review word translation retry passed');
} finally { await browser.close(); }
