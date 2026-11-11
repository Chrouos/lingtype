import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
// The reader opens at #practice; the home page is the library.
const base = new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  async function type(text) {
    for (const char of text) {
      const code = char === ' ' ? 'Space' : `Key${char.toUpperCase()}`;
      const windowsVirtualKeyCode = char === ' ' ? 32 : char.toUpperCase().charCodeAt(0);
      await page.send('Input.dispatchKeyEvent', {type:'keyDown', key:char, code, text:char, windowsVirtualKeyCode});
      await page.send('Input.dispatchKeyEvent', {type:'keyUp', key:char, code, windowsVirtualKeyCode});
    }
  }
  let navigation = 0;
  async function open() {
    const url = new URL(base); url.searchParams.set('core-practice-test', String(++navigation));
    await page.goto(url.href);
    for (let i = 0; i < 100; i++) {
      try { if (await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false)) return; } catch {}
      await sleep(100);
    }
    throw new Error(`Practice did not initialize: ${JSON.stringify(page.consoleErrors)}`);
  }
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); document.getElementById('typing-stage').click(); });
  await type('The ');
  await page.eval(() => document.getElementById('finish-now').click());
  assert.equal(await page.eval(() => document.getElementById('result').hidden), false);
  await page.eval(() => document.getElementById('resume-early').click());
  await type('city');
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'The city');
  await page.eval(() => document.getElementById('pause').click());
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'The city');
  assert.equal(await page.eval(() => document.getElementById('typing').disabled), true);
  await page.eval(() => document.getElementById('word-mode').click());
  await page.eval(() => document.getElementById('typing-stage').click());
  await type('gentle');
  await type('br');
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'br');
  await page.eval(() => { document.getElementById('finish-now').click(); document.getElementById('resume-early').click(); });
  await type('e');
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'bre');
  await page.eval(() => document.getElementById('pause').click());
  await open();
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'bre');
  assert.equal(await page.eval(() => document.getElementById('typing').disabled), true);
  await page.eval(() => { document.getElementById('typing-stage').click(); });
  await type('eze');
  assert.equal(await page.eval(() => document.getElementById('typing').value), '');
  assert.match(await page.eval(() => document.getElementById('word-text').textContent), /scent/);
  await type('scent');
  await type('unfold');
  assert.equal(await page.eval(() => document.getElementById('result').hidden), false);
  await page.eval(() => { document.getElementById('article-mode').click(); document.getElementById('typing-stage').click(); });
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'The city');
  await page.send('Input.insertText', {text:' was still quiet when Mia opened her window. A gentle breeze carried the scent of rain, and for a moment she simply watched the morning unfold.'});
  assert.equal(await page.eval(() => document.getElementById('result').hidden), false);
  assert.deepEqual(page.consoleErrors, []);
  await page.close();
  console.log('article and word keyboard practice, early resume and reload passed');
} finally { await browser.close(); }
