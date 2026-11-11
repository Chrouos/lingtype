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
    const url = new URL(base); url.searchParams.set('scope-test', String(++navigation));
    await page.goto(url.href);
    for (let i = 0; i < 100; i++) {
      try { if (await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false)) return; } catch {}
      await sleep(100);
    }
    throw new Error('Practice did not initialize');
  }
  await open();
  await page.eval(() => {
    localStorage.clear();
    localStorage.setItem('lingtype-notebook', JSON.stringify([
      {word:'alpha', translations:{}, sentences:[], added:0, practiced:0, missed:0, reviewDue:Date.now() + 86400000},
      {word:'bravo', translations:{}, sentences:[], added:1, practiced:0, missed:0, reviewDue:Date.now() - 1000},
    ]));
  });
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); document.getElementById('nav-notebook').click(); document.getElementById('notebook-words').click(); });
  await page.send('Input.insertText', {text:'al'});
  await page.eval(() => { document.getElementById('nav-notebook').click(); document.getElementById('notebook-due').click(); });
  assert.equal(await page.eval(() => document.getElementById('word-text').textContent), 'bravo');
  await page.send('Input.insertText', {text:'br'});
  await page.eval(() => document.getElementById('pause').click());
  let state = await page.eval(() => ({progress:JSON.parse(localStorage.getItem('lingtype-progress')), last:JSON.parse(localStorage.getItem('lingtype-last-practice'))}));
  assert.equal(state.progress[JSON.stringify(['notebook','word','all','full'])].input, 'al');
  assert.match(state.last.wordScope, /^due:/);
  assert.equal(state.progress[JSON.stringify(['notebook','word','all','full',state.last.wordScope])].input, 'br');
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'br');
  await page.eval(() => { document.getElementById('nav-notebook').click(); document.getElementById('notebook-words').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'al');
  assert.equal(await page.eval(() => document.getElementById('typing').disabled), false);
  await page.eval(() => {
    document.getElementById('finish-now').click();
    localStorage.setItem('lingtype-last-practice', JSON.stringify({id:'morning', mode:'article', section:'all', passage:'full'}));
    const progress = JSON.parse(localStorage.getItem('lingtype-progress'));
    progress[JSON.stringify(['morning','word','all','full'])] = {input:'ge', wordIndex:0, errors:0, elapsed:1000, articleText:'The city was still quiet when Mia opened her window.', wrongWords:[]};
    localStorage.setItem('lingtype-progress', JSON.stringify(progress));
  });
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); document.getElementById('typing-stage').click(); });
  await page.send('Input.insertText', {text:'X'});
  await page.eval(() => { document.getElementById('finish-now').click(); document.getElementById('retry-errors').click(); });
  assert.equal(await page.eval(() => document.getElementById('word-text').textContent), 'the');
  await page.send('Input.insertText', {text:'t'});
  await page.eval(() => document.getElementById('pause').click());
  state = await page.eval(() => ({progress:JSON.parse(localStorage.getItem('lingtype-progress')), last:JSON.parse(localStorage.getItem('lingtype-last-practice'))}));
  assert.equal(state.progress[JSON.stringify(['morning','word','all','full'])].input, 'ge');
  assert.match(state.last.wordScope, /^retry:/);
  assert.equal(state.progress[JSON.stringify(['morning','word','all','full',state.last.wordScope])].input, 't');
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 't');
  await page.eval(() => { document.getElementById('article-mode').click(); document.getElementById('word-mode').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'ge');
  assert.deepEqual(page.consoleErrors, []);
  await page.close();
  console.log('notebook review and ordinary practice preserve separate progress across reload');
} finally { await browser.close(); }
