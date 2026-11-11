// Run against a local server with an isolated Chrome profile.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
// The reader opens at #practice; the home page is the library.
const base = new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(base);
  for (let i = 0; i < 100 && !await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false); i++) await sleep(100);
  assert.equal(await page.eval(() => document.getElementById('lesson-chooser').hidden), false);
  await page.eval(() => { document.getElementById('preview-start').click(); document.getElementById('nav-shelf').focus(); });
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', {type, key:'T', code:'KeyT', ...(type === 'keyDown' ? {text:'T'} : {}), windowsVirtualKeyCode:84});
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'T', 'a letter still starts practice');
  const space = async () => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', {type, key:' ', code:'Space', ...(type === 'keyDown' ? {text:' '} : {}), windowsVirtualKeyCode:32}); };
  await page.eval(() => document.getElementById('pause').focus());
  await space();
  assert.equal(await page.eval(() => document.getElementById('typing').disabled), true, 'Space activates pause');
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'T');
  await page.eval(() => document.getElementById('pause').focus());
  await space();
  assert.equal(await page.eval(() => document.getElementById('typing').disabled), false, 'Space activates resume');
  await page.eval(() => document.querySelector('#more-menu summary').focus());
  await space();
  assert.equal(await page.eval(() => document.getElementById('more-menu').open), true, 'Space opens a disclosure');
  await page.eval(() => document.getElementById('nav-shelf').focus());
  await space();
  assert.equal(await page.eval(() => document.getElementById('view-shelf').hidden), false, 'Space activates navigation');
  assert.deepEqual(page.consoleErrors, []);
  await page.close();
  console.log('keyboard controls and quick typing passed');
} finally { await browser.close(); }
