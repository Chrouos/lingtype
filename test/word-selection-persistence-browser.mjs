// Run against a local server with an isolated Chrome profile.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
// The reader opens at #practice; the home page is the library.
const base = new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      if (await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false)) return;
      await sleep(100);
    }
    throw new Error('Practice did not initialize');
  };
  let navigation = 0;
  const open = async () => { const url = new URL(base); url.searchParams.set('word-selection-test', String(++navigation)); await page.goto(url.href); await ready(); };
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); document.getElementById('finish-now').click(); document.querySelector('[data-pick="city"]').click(); });
  assert.ok(await page.eval(() => JSON.parse(localStorage.getItem('lingtype-builtin-words')).morning.some(word => word[0] === 'city')));
  await open();
  await page.eval(() => document.getElementById('preview-start').click());
  assert.match(await page.eval(() => document.getElementById('vocab-list').textContent), /city/);

  await page.eval(() => {
    window.confirm = () => true;
    document.getElementById('shelf-import').click();
    document.getElementById('import-title').value = 'Custom test';
    document.getElementById('import-text').value = 'The harbour is quiet.';
    document.getElementById('import-form').requestSubmit();
  });
  await ready();
  await page.eval(() => { document.getElementById('preview-start').click(); document.querySelector('#word-candidates input[value="harbour"]').click(); });
  for (let i = 0; i < 100; i++) {
    const persisted = await page.eval(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('lingtype-data');
      open.onsuccess = () => {
        const db = open.result, get = db.transaction('values').objectStore('values').get('lingtype-custom-lessons');
        get.onsuccess = () => { db.close(); resolve(JSON.parse(get.result || '[]').some(item => item.title === 'Custom test' && item.words.some(word => word[0] === 'harbour'))); };
        get.onerror = () => reject(get.error);
      };
      open.onerror = () => reject(open.error);
    }));
    if (persisted) break;
    if (i === 99) throw new Error('Custom selected word was not saved');
    await sleep(100);
  }
  await open();
  await page.eval(() => {
    const select = document.getElementById('preview-lesson');
    select.value = [...select.options].find(option => option.textContent === 'Custom test').value;
    select.dispatchEvent(new Event('change'));
    document.getElementById('preview-start').click();
  });
  assert.equal(await page.eval(() => document.querySelector('#word-candidates input[value="harbour"]')?.checked), true);
  assert.deepEqual(page.consoleErrors, []);
  await page.close();
  console.log('built-in and custom word selections survive reload');
} finally { await browser.close(); }
