// Run against a local server with a disposable Chrome profile.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
// The reader opens at #practice; the home page is the library.
const base = new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  let navigation = 0;
  const open = async () => {
    const url = new URL(base); url.searchParams.set('notebook-result-test', String(++navigation));
    await page.goto(url.href);
    for (let i = 0; i < 100 && !await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false); i++) await sleep(100);
    assert.equal(await page.eval(() => document.getElementById('lesson-chooser').hidden), false);
  };
  await open();
  await page.eval(() => {
    localStorage.setItem('lingtype-notebook', JSON.stringify([{word:'harbour',translations:{zh:'港口'},sentences:[{text:'A harbour.',source:'Original'}],added:1,practiced:0,missed:0}]));
    localStorage.setItem('lingtype-last-practice', JSON.stringify({id:'notebook',mode:'article',section:'all',passage:'full'}));
  });
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); document.getElementById('typing-stage').click(); });
  await page.send('Input.insertText', {text:'A harbour.'});
  assert.equal(await page.eval(() => document.getElementById('result').hidden), false);
  const remove = async () => page.eval(() => document.querySelector('#review-text [data-pick="harbour"]').click());
  await remove();
  assert.deepEqual(await page.eval(() => JSON.parse(localStorage.getItem('lingtype-notebook'))), []);
  assert.equal(await page.eval(() => document.getElementById('result').hidden), false);
  assert.equal(await page.eval(() => document.getElementById('lesson').selectedOptions[0].textContent), '我的單字本');
  assert.equal(await page.eval(() => document.getElementById('word-mode').disabled), true);
  await page.eval(() => document.getElementById('again-article').click());
  assert.equal(await page.eval(() => document.getElementById('result').hidden), false, 'an empty notebook is not restarted');
  assert.match(await page.eval(() => document.getElementById('hint').textContent), /單字本已空/);
  await remove();
  assert.equal(await page.eval(() => JSON.parse(localStorage.getItem('lingtype-notebook'))[0].word), 'harbour', 'the word can be restored from the result');
  await remove();
  await page.eval(() => document.getElementById('next-action').click());
  assert.notEqual(await page.eval(() => document.getElementById('lesson').selectedOptions[0].textContent), '我的單字本');
  assert.equal(await page.eval(() => [...document.getElementById('lesson').options].some(option => option.textContent === '我的單字本')), false, 'the empty notebook is removed after leaving the result');
  assert.equal(await page.eval(() => localStorage.getItem('lingtype-builtin-words')), null, 'the built-in lesson was not modified');

  for (const route of ['select', 'preview']) {
    await page.eval(() => {
      localStorage.setItem('lingtype-notebook', JSON.stringify([{word:'harbour',translations:{zh:'港口'},sentences:[{text:'A harbour.',source:'Original'}],added:1,practiced:0,missed:0}]));
      localStorage.setItem('lingtype-last-practice', JSON.stringify({id:'notebook',mode:'article',section:'all',passage:'full'}));
    });
    await open();
    await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); document.getElementById('typing-stage').click(); });
    await page.send('Input.insertText', {text:'A harbour.'});
    await remove();
    if (route === 'select') {
      await page.eval(() => { const select = document.getElementById('lesson'); select.value = '0'; select.dispatchEvent(new Event('change')); });
    } else {
      await page.eval(() => { document.getElementById('choose-lesson').click(); const select = document.getElementById('preview-lesson'); select.value = '0'; select.dispatchEvent(new Event('change')); document.getElementById('preview-start').click(); });
    }
    assert.equal(await page.eval(() => document.getElementById('lesson').selectedOptions[0].textContent), 'A quieter morning');
    assert.equal(await page.eval(() => [...document.getElementById('lesson').options].some(option => option.textContent === '我的單字本')), false, `empty notebook removed via ${route}`);
  }
  assert.deepEqual(page.consoleErrors, []);
  await page.close();
  console.log('empty notebook result keeps its lesson until leaving');
} finally { await browser.close(); }
