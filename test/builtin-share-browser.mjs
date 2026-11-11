// Run against an isolated test server: LINGTYPE_URL=http://127.0.0.1:18776/ node test/builtin-share-browser.mjs
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const browser = await Browser.launch();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const page = await browser.newPage();
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source:'window.confirm = () => true;'});
  await page.goto(base, {settleMs:500});
  const wait = async (expression, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try { if (await (typeof expression === 'function' ? expression() : page.eval(expression))) return; } catch { /* navigation in progress */ }
      await pause(50);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const custom = () => page.eval(async () => {
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open('lingtype-data', 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    try {
      const value = await new Promise((resolve, reject) => { const req = db.transaction('values').objectStore('values').get('lingtype-custom-lessons'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      return JSON.parse(value || '[]');
    } finally { db.close(); }
  });
  const keys = () => page.eval(() => Object.keys(JSON.parse(localStorage.getItem('lingtype-published-keys') || '{}')));
  const openCopy = async id => {
    await page.eval(id => { location.hash = `book-${id}`; }, id);
    await wait(`document.getElementById('public-detail') && !document.getElementById('public-detail').hidden && !!document.getElementById('add-public-book')`, 'public detail');
    await page.eval(() => document.getElementById('add-public-book').click());
    await wait(`document.getElementById('lesson-chooser') && !document.getElementById('lesson-chooser').hidden`, 'lesson preview');
    await page.eval(() => document.getElementById('preview-start').click());
    await wait(`!!document.getElementById('typing')`, 'typing input');
  };
  await wait(`document.getElementById('lesson-chooser') && !document.getElementById('lesson-chooser').hidden`, 'initial preview');
  await page.eval(() => document.getElementById('preview-start').click());
  for (let count = 1; count <= 2; count++) {
    await page.eval(() => { document.getElementById('publish-workbook').click(); document.getElementById('public-share-rights').checked = true; document.getElementById('public-share-form').requestSubmit(); });
    await wait(`Object.keys(JSON.parse(localStorage.getItem('lingtype-published-keys') || '{}')).length === ${count} && !document.getElementById('publish-workbook').disabled && !document.getElementById('share-dialog').open`, 'publication');
  }
  const [a, b] = await keys();
  assert.notEqual(a, b);
  // Practising the original built-in lesson is not silently assigned to A or B.
  await page.eval(() => document.getElementById('typing').focus());
  await page.send('Input.insertText', {text:'T'});
  await page.eval(() => document.getElementById('pause').click());
  for (const id of [a, b]) {
    const stats = await page.eval(async id => (await (await fetch(`/api/workbooks/${id}/community`)).json()), id);
    assert.equal(stats.starts, 0);
  }
  await openCopy(a);
  await page.eval(() => document.getElementById('typing').focus());
  await page.send('Input.insertText', {text:'T'});
  await page.eval(() => document.getElementById('pause').click());
  await openCopy(b);
  assert.equal(await page.eval(() => document.getElementById('typing').value), '');
  await page.eval(() => document.getElementById('typing').focus());
  await page.send('Input.insertText', {text:'Th'});
  await page.eval(() => document.getElementById('pause').click());
  await wait(async () => (await custom()).length === 2, 'both saved copies');
  const before = await custom();
  assert.deepEqual(new Set(before.map(item => item.publicId)), new Set([a, b]));
  await openCopy(a);
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'T');
  await openCopy(b);
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Th');
  assert.equal((await custom()).length, 2);

  // Export and restore through the actual UI, then confirm both old copies and
  // their unfinished progress remain independently addressable.
  await page.eval(() => {
    URL.createObjectURL = blob => { window.testBackup = blob; return 'blob:test-backup'; };
    HTMLAnchorElement.prototype.click = () => {};
    document.getElementById('backup-export').click();
  });
  await wait(`!!window.testBackup`, 'backup export');
  await page.eval(() => {
    const input = document.getElementById('backup-file'), transfer = new DataTransfer();
    transfer.items.add(new File([window.testBackup], 'backup.json', {type:'application/json'}));
    input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
  });
  await wait(`!window.testBackup && !!document.getElementById('lesson-chooser')`, 'restore reload');
  assert.deepEqual(new Set((await custom()).map(item => item.publicId)), new Set([a, b]));
  await openCopy(a);
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'T');
  await openCopy(b);
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Th');

  await openCopy(a);
  await page.eval(() => document.getElementById('delete-lesson').click());
  await wait(async () => (await custom()).length === 1, 'copy deletion');
  await openCopy(a);
  assert.equal(await page.eval(() => document.getElementById('typing').value), '');
  const after = await custom();
  assert.equal(after.length, 2);
  assert.notEqual(after.find(item => item.publicId === a).id, before.find(item => item.publicId === a).id);
  assert.equal(after.find(item => item.publicId === b).id, before.find(item => item.publicId === b).id);
  console.log('built-in publications and separate progress: ok');
  await page.close();
} finally { await browser.close(); }
