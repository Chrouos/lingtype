// Run against a local server with a disposable browser profile.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
// The reader opens at #practice; the home page is the library.
const base = new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  let navigation = 0;
  const openPractice = async () => {
    // Vary the query so navigation from #notebook is a reload, not a hash-only change.
    const url = new URL(base); url.searchParams.set('notebook-test', String(++navigation));
    await page.goto(url.href);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if (await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false)) return;
      } catch { /* document navigation is still in progress */ }
      await sleep(100);
    }
    throw new Error('Practice did not finish initialization');
  };
  await openPractice();
  await page.eval(() => {
    localStorage.clear();
    localStorage.setItem('lingtype-notebook', JSON.stringify(['alpha', 'bravo'].map((word, i) => ({ word, translations:{}, sentences:[], added:i, practiced:0, missed:0 }))));
  });
  await openPractice();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); document.getElementById('nav-notebook').click(); document.getElementById('notebook-words').click(); });
  await page.send('Input.insertText', {text:'alpha'});
  await page.send('Input.insertText', {text:'br'});
  await page.eval(() => { document.getElementById('nav-notebook').click(); document.querySelector('[data-remove-note="alpha"]').click(); });
  await openPractice();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); document.getElementById('typing-stage').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'br');
  await page.send('Input.insertText', {text:'avo'});
  assert.equal(await page.eval(() => document.getElementById('result').hidden), false);
  assert.equal(await page.eval(() => JSON.parse(localStorage.getItem('lingtype-practice-history'))[0].lessonId), 'notebook');

  await page.eval(() => { document.getElementById('nav-notebook').click(); document.getElementById('notebook-words').click(); });
  await page.send('Input.insertText', {text:'b'});
  await page.eval(() => {
    const progress = JSON.parse(localStorage.getItem('lingtype-progress') || '{}');
    progress[JSON.stringify(['morning', 'article', 'all', 'full'])] = {input:'Existing'};
    localStorage.setItem('lingtype-progress', JSON.stringify(progress));
    document.getElementById('nav-notebook').click(); document.querySelector('[data-remove-note="bravo"]').click();
  });
  await sleep(500);
  const state = await page.eval(() => ({
    notebook:JSON.parse(localStorage.getItem('lingtype-notebook')),
    last:JSON.parse(localStorage.getItem('lingtype-last-practice')),
    progress:JSON.parse(localStorage.getItem('lingtype-progress')),
    lesson:document.getElementById('lesson').selectedOptions[0].textContent,
  }));
  assert.deepEqual(state.notebook, []);
  assert.equal(state.last.id, 'notebook');
  const saved = Object.entries(state.progress).find(([key]) => JSON.parse(key)[0] === 'notebook');
  assert.equal(saved[1].input, 'b');
  assert.equal(state.progress[JSON.stringify(['morning', 'article', 'all', 'full'])].input, 'Existing');
  assert.notEqual(state.lesson, '單字本');

  // Legacy snapshots lack a frozen list. If the notebook has since shrunk,
  // an out-of-range index starts a safe fresh practice instead of crashing.
  await page.eval(() => {
    document.getElementById('finish-now').click(); // prevent pagehide from saving over the fixture
    localStorage.setItem('lingtype-notebook', JSON.stringify([{word:'bravo', translations:{}, sentences:[], added:1, practiced:0, missed:0}]));
    localStorage.setItem('lingtype-last-practice', JSON.stringify({id:'notebook', mode:'word', section:'all', passage:'full'}));
    localStorage.setItem('lingtype-progress', JSON.stringify({[JSON.stringify(['notebook', 'word', 'all', 'full'])]:{input:'', wordIndex:1, errors:0, elapsed:1000, articleText:'bravo', wrongWords:[]}}));
  });
  await openPractice();
  await page.eval(() => document.getElementById('preview-start').click());
  assert.match(await page.eval(() => document.getElementById('word-text').textContent), /bravo/);
  assert.equal(await page.eval(() => document.getElementById('typing').value), '');
  assert.deepEqual(page.consoleErrors, []);
  await page.close();
  console.log('notebook practice remains stable after removal and reload');
} finally { await browser.close(); }
