// Start the local server before running this browser check.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
// The reader opens at #practice; the home page is the library.
const base = new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.setViewport({width:320,height:720,mobile:true});
  await page.goto(base);
  for (let i=0; i<100 && await page.eval(() => document.getElementById('lesson-chooser')?.hidden !== false); i++) await pause(100);
  await page.eval(() => { window.confirm = () => true; const fetchOriginal = window.fetch; window.publications = 0; window.fetch = (...args) => { if (String(args[0]).includes('/api/workbooks') && args[1]?.method === 'POST') window.publications++; return fetchOriginal(...args); }; document.getElementById('preview-start').click(); document.getElementById('typing').focus(); });
  await page.send('Input.insertText', {text:'The'});
  await page.eval(() => { document.getElementById('more-menu').open = true; document.getElementById('edit-lesson').click(); });
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-dialog').open), true);
  assert.match(await page.eval(() => document.getElementById('lesson-edit-note').textContent), /TeX/);
  assert.equal(await page.eval(() => document.activeElement.id), 'lesson-edit-name');
  assert.ok(await page.eval(() => document.getElementById('lesson-edit-dialog').getBoundingClientRect().right <= innerWidth));
  await page.screenshot({path:'.taste-skill/lesson-edit-mobile.png'});
  await page.setViewport({width:1440,height:900});
  assert.ok(await page.eval(() => document.getElementById('lesson-edit-dialog').getBoundingClientRect().right <= innerWidth));
  await page.screenshot({path:'.taste-skill/lesson-edit-desktop.png'});
  await page.setViewport({width:320,height:720,mobile:true});
  await page.eval(() => { document.getElementById('lesson-edit-text').value='Cancelled change.'; document.getElementById('lesson-edit-cancel').click(); });
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-dialog').open), false);
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'The');
  await page.eval(() => { document.getElementById('more-menu').open = true; document.getElementById('edit-lesson').click(); document.getElementById('lesson-edit-name').value='Edited copy'; document.getElementById('lesson-edit-text').value='A revised sentence.'; document.getElementById('lesson-edit-form').requestSubmit(); document.getElementById('lesson-edit-form').requestSubmit(); });
  for (let i=0; i<100 && await page.eval(() => document.getElementById('lesson-edit-dialog').open); i++) await pause(50);
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-dialog').open), false);
  assert.match(await page.eval(() => document.getElementById('lesson-preview').textContent), /A revised sentence/);
  const data = await page.eval(async () => { const req=indexedDB.open('lingtype-data'); return await new Promise((resolve,reject)=>{req.onsuccess=()=>{const db=req.result, r=db.transaction('values').objectStore('values').get('lingtype-custom-lessons');r.onsuccess=()=>{db.close();resolve(JSON.parse(r.result))};r.onerror=()=>reject(r.error)};req.onerror=()=>reject(req.error)}); });
  const copy = data.find(item => item.title === 'Edited copy');
  assert.ok(copy?.edited && copy.text === 'A revised sentence.' && !('publicId' in copy));
  assert.equal(data.filter(item => item.title === 'Edited copy').length, 1, 'repeated submissions create one copy');
  assert.equal(await page.eval(() => window.publications), 0, 'editing never publishes a copy');
  assert.ok(await page.eval(() => JSON.stringify(JSON.parse(localStorage.getItem('lingtype-progress'))).includes('The')), 'original practice remains saved');
  await page.eval(() => { document.getElementById('preview-start').click(); document.getElementById('more-menu').open = true; document.getElementById('edit-lesson').click(); document.getElementById('lesson-edit-text').value='Preserve on failure.'; const original=IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction=function(...args){ const tx=original.apply(this,args); if(args[1] === 'readwrite') queueMicrotask(() => { try { tx.abort(); } catch {} }); return tx; }; document.getElementById('lesson-edit-form').requestSubmit(); });
  for (let i=0; i<100 && !await page.eval(() => document.getElementById('lesson-edit-error').textContent); i++) await pause(50);
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-dialog').open), true);
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-text').value), 'Preserve on failure.');
  assert.match(await page.eval(() => document.getElementById('lesson-edit-error').textContent), /無法另存/);
  // A failure after durable commit must not offer a retry that creates a duplicate.
  await page.goto(base);
  for (let i=0; i<100 && await page.eval(() => document.getElementById('lesson-chooser')?.hidden !== false); i++) await pause(100);
  await page.eval(() => {
    window.confirm = () => true;
    document.getElementById('preview-start').click();
    document.getElementById('more-menu').open = true;
    document.getElementById('edit-lesson').click();
    document.getElementById('lesson-edit-name').value = 'Committed despite UI failure';
    document.getElementById('lesson-edit-text').value = 'Keep this text.';
    const append = Element.prototype.append;
    Element.prototype.append = function (...args) { if (this.id === 'lesson') throw new Error('simulated UI failure'); return append.apply(this, args); };
    document.getElementById('lesson-edit-form').requestSubmit();
  });
  for (let i=0; i<100 && !await page.eval(() => document.getElementById('lesson-edit-error').textContent); i++) await pause(50);
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-dialog').open), true);
  assert.match(await page.eval(() => document.getElementById('lesson-edit-error').textContent), /無法確認/);
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-save').disabled), true);
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-text').value), 'Keep this text.');
  const committed = await page.eval(async () => { const req=indexedDB.open('lingtype-data'); return await new Promise((resolve,reject)=>{req.onsuccess=()=>{const db=req.result,r=db.transaction('values').objectStore('values').get('lingtype-custom-lessons');r.onsuccess=()=>{db.close();resolve(JSON.parse(r.result))};r.onerror=()=>reject(r.error)};req.onerror=()=>reject(req.error)}); });
  assert.equal(committed.filter(item => item.title === 'Committed despite UI failure').length, 1);
  // A later failure after closing the editor also reopens it with the warning.
  await page.goto(base);
  for (let i=0; i<100 && await page.eval(() => document.getElementById('lesson-chooser')?.hidden !== false); i++) await pause(100);
  await page.eval(() => {
    window.confirm = () => true;
    document.getElementById('preview-start').click();
    document.getElementById('more-menu').open = true;
    document.getElementById('edit-lesson').click();
    document.getElementById('lesson-edit-name').value = 'Committed before preview failure';
    document.getElementById('lesson-edit-text').value = 'Keep this too.';
    const append = Element.prototype.append;
    Element.prototype.append = function (...args) { if (this.id === 'preview-lesson') throw new Error('simulated preview failure'); return append.apply(this, args); };
    document.getElementById('lesson-edit-form').requestSubmit();
  });
  for (let i=0; i<100 && !await page.eval(() => document.getElementById('lesson-edit-error').textContent); i++) await pause(50);
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-dialog').open), true);
  assert.match(await page.eval(() => document.getElementById('lesson-edit-error').textContent), /無法確認/);
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-save').disabled), true);
  assert.equal(await page.eval(() => document.getElementById('lesson-edit-text').value), 'Keep this too.');
  await page.close();
  console.log('Lesson editing preserves the original, cancellation and failed input in browser');
} finally { await browser.close(); }
