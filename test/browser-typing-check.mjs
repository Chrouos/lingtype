import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
// The reader opens at #practice; the home page is the library.
const base = new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function startPractice(page) {
  for (let i = 0; i < 200; i++) {
    if (await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false && !!document.getElementById('article-text'))) {
      await page.eval(() => document.getElementById('preview-start').click());
      return;
    }
    await pause(100);
  }
  throw new Error('Practice preview did not become ready');
}

const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(base, {settleMs:500});
  await startPractice(page);
  const point = await page.eval(() => { const r = document.querySelector('#article-text').getBoundingClientRect(); return {x:r.left+20,y:r.top+15}; });
  await page.send('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
  await page.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
  await page.send('Input.insertText', {text:'T'});
  const initial = await page.eval(() => ({active:document.activeElement?.id, disabled:document.querySelector('#typing').disabled, value:document.querySelector('#typing').value}));
  assert.deepEqual(initial, {active:'typing', disabled:false, value:'T'});
  await new Promise(resolve => setTimeout(resolve, 700));
  await page.goto(base, {settleMs:500});
  await startPractice(page);
  const resumed = await page.eval(() => { const r = document.querySelector('#article-text').getBoundingClientRect(); return {x:r.left+20,y:r.top+15}; });
  await page.send('Input.dispatchMouseEvent', {type:'mousePressed', ...resumed, button:'left', clickCount:1});
  await page.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...resumed, button:'left', clickCount:1});
  await page.send('Input.insertText', {text:'h'});
  const restored = await page.eval(() => ({active:document.activeElement?.id, disabled:document.querySelector('#typing').disabled, value:document.querySelector('#typing').value, hint:document.querySelector('#hint').textContent}));
  assert.equal(restored.active, 'typing');
  assert.equal(restored.disabled, false);
  assert.equal(restored.value, 'Th', 'clicking restored practice should allow typing');
  await page.send('Input.insertText', {text:'e city was still quiet when Mia opened her window. '});
  const next = await page.eval(() => document.querySelector('#article-text').textContent);
  assert.match(next, /A gentle breeze/);
  assert.match(next, /微風帶來雨的氣息/);
  assert.equal(await page.eval(() => !!document.querySelector('#speak-current')), false);
  await page.setViewport({width:390,height:844,mobile:true,dsf:1});
  await page.eval(() => { window.confirm = () => true; document.querySelector('#word-mode').click(); });
  const wordPoint = await page.eval(() => { const r = document.querySelector('#word-text').getBoundingClientRect(); return {x:r.left+20,y:r.top+15}; });
  await page.send('Input.dispatchMouseEvent', {type:'mousePressed', ...wordPoint, button:'left', clickCount:1});
  await page.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...wordPoint, button:'left', clickCount:1});
  await page.send('Input.insertText', {text:'ge'});
  assert.equal(await page.eval(() => document.querySelector('#typing').value), 'ge');
  await page.eval(() => document.querySelector('#pause').click());
  await page.send('Input.dispatchMouseEvent', {type:'mousePressed', ...wordPoint, button:'left', clickCount:1});
  await page.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...wordPoint, button:'left', clickCount:1});
  await page.send('Input.insertText', {text:'n'});
  assert.equal(await page.eval(() => document.querySelector('#typing').value), 'gen');
  console.log(JSON.stringify(page.consoleErrors));
  await page.close();
} finally { await browser.close(); }
