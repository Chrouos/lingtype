import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
// The reader opens at #practice; the home page is the library.
const base = new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  async function open(query) {
    const url = new URL(base); url.searchParams.set('large-passage-test', query);
    await page.goto(url.href);
    for (let i = 0; i < 100; i++) { try { if (await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false)) return; } catch {} await sleep(100); }
    throw new Error(`Practice did not initialize: ${JSON.stringify(page.consoleErrors)}`);
  }
  await open('setup');
  await page.eval(async () => {
    const item = {id:'large-passage',custom:true,title:'Many paragraphs',text:Array.from({length:50000},(_,i)=>`Part ${i}.`).join('\n\n'),words:[],translations:{}};
    const key = index => JSON.stringify([item.id,'article','all','random',`part:${index}`]);
    localStorage.setItem('lingtype-last-practice', JSON.stringify({id:item.id,mode:'article',section:'all',passage:'random',passageIndex:0}));
    localStorage.setItem('lingtype-progress', JSON.stringify({[key(0)]:{input:'Pa',articleText:'Part 0.',articlePassageIndex:0,elapsed:1000},[key(49999)]:{input:'Par',articleText:'Part 49999.',articlePassageIndex:49999,elapsed:1000},[key(4)]:{input:'P',articleText:42,articlePassageIndex:4,elapsed:1000},[JSON.stringify([item.id,'article','all','random'])]:{input:'Par',articleText:'Part 10.',articlePassageIndex:999999,elapsed:1000}}));
    await new Promise((resolve,reject) => { const request = indexedDB.open('lingtype-data'); request.onsuccess = () => { const db = request.result, tx = db.transaction('values','readwrite'); tx.objectStore('values').put(JSON.stringify([item]), 'lingtype-custom-lessons'); tx.oncomplete = () => {db.close();resolve();}; tx.onabort = () => reject(tx.error); }; request.onerror = () => reject(request.error); });
  });
  await open('large');
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); });
  await page.setViewport({ width:320, height:720, mobile:true });
  // The paragraph pager is kept for its scope only; the book's contents list a page of paragraphs at a time.
  await page.eval(() => document.getElementById('choose-lesson').click());
  assert.equal(await page.eval(() => document.querySelectorAll('#lesson-preview .toc-part').length), 200);
  await page.eval(() => document.querySelector('#lesson-preview [data-toc-from]').click());
  assert.equal(await page.eval(() => document.querySelector('#lesson-preview .toc-part .toc-n').textContent), '201');
  await page.eval(() => document.getElementById('preview-start').click());
  assert.equal(await page.eval(() => document.documentElement.scrollWidth), 320);
  await page.eval(() => document.getElementById('passage-next').click());
  assert.match(await page.eval(() => document.getElementById('passage-page').textContent), /^101–200/);
  await page.eval(() => document.getElementById('passage-prev').click());
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Pa');
  assert.ok(await page.eval(() => document.getElementById('passage-choice').options.length <= 101));
  await page.eval(() => { const filter = document.getElementById('passage-saved-only'); filter.checked = true; filter.dispatchEvent(new Event('change')); });
  assert.deepEqual(await page.eval(() => [...document.getElementById('passage-choice').options].map(option => option.value)), ['0','10','49999']);
  await page.eval(() => { const select = document.getElementById('passage-choice'); select.value = '10'; select.dispatchEvent(new Event('change')); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Par');
  await page.eval(() => { const select = document.getElementById('passage-choice'); select.value = '49999'; select.dispatchEvent(new Event('change')); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Par');
  await page.eval(() => { const filter = document.getElementById('passage-saved-only'); filter.checked = false; filter.dispatchEvent(new Event('change')); });
  await page.eval(() => { document.getElementById('passage-number').value = '50000'; document.getElementById('passage-go').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Par');
  assert.match(await page.eval(() => document.querySelector('#passage-choice option[value="49999"]').textContent), /進度/);
  await page.eval(() => document.getElementById('passage-prev').click());
  assert.ok(await page.eval(() => document.getElementById('passage-choice').options.length <= 101));
  assert.match(await page.eval(() => document.getElementById('passage-page').textContent), /49801–49900/);
  await page.eval(() => { const select = document.getElementById('passage-choice'); select.value = '49800'; select.dispatchEvent(new Event('change')); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), '');
  await page.eval(() => { document.getElementById('passage-number').value = '1'; document.getElementById('passage-go').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Pa');
  assert.deepEqual(page.consoleErrors, []);
  await page.close();
  console.log('50,000 passages remain bounded and saved passages are reachable');
} finally { await browser.close(); }
