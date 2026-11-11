// Run against a local server with an isolated Chrome profile.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  let navigation = 0;
  const open = async () => {
    const url = new URL(base); url.searchParams.set('notebook-priority-test', String(++navigation));
    await page.goto(url.href);
    for (let i = 0; i < 100 && !await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false); i++) await sleep(100);
    assert.equal(await page.eval(() => document.getElementById('lesson-chooser').hidden), false);
  };
  await open();
  await page.eval(() => {
    localStorage.setItem('lingtype-notebook', JSON.stringify(['alpha', 'bravo'].map((word, i) => ({word,translations:{zh:'譯文'},sentences:[],added:i+1,practiced:0,missed:0}))));
  });
  await open();
  await page.eval(() => { document.getElementById('preview-start').click(); document.getElementById('nav-notebook').click(); document.getElementById('notebook-words').click(); });
  assert.equal(await page.eval(() => document.querySelector('#word-text .current').textContent), 'alpha');
  await page.send('Input.insertText', {text:'alpha'});
  await page.send('Input.insertText', {text:'x'});
  await page.send('Input.insertText', {text:'bravo'});
  assert.equal(await page.eval(() => document.getElementById('result').hidden), false);
  const notes = await page.eval(() => JSON.parse(localStorage.getItem('lingtype-notebook')));
  assert.equal(notes.find(entry => entry.word === 'bravo').missed, 1);
  await page.eval(() => { document.getElementById('nav-notebook').click(); document.getElementById('notebook-words').click(); });
  assert.equal(await page.eval(() => document.querySelector('#word-text .current').textContent), 'bravo', 'the next run prioritizes the missed word');
  assert.deepEqual(page.consoleErrors, []);
  await page.close();
  console.log('notebook priority updates between runs');
} finally { await browser.close(); }
