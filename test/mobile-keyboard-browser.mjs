// Start the server, then run this with Node 22+ and Chrome/Chromium installed.
// Simulate a phone keyboard shrinking the visual viewport, as on mobile Safari.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.setViewport({ width:390, height:844, mobile:true });
  await page.send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'reduce' }] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source:`(() => {
    const viewport = new EventTarget(); viewport.offsetTop = 0; viewport.height = 844;
    Object.defineProperty(window, 'visualViewport', { value:viewport, configurable:true });
  })()` });
  await page.goto(new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href, { settleMs:1000 });
  await page.eval(`document.getElementById('preview-start').click()`);
  await page.eval(`document.getElementById('typing-stage').click()`);
  await page.eval(`visualViewport.height = 400; visualViewport.dispatchEvent(new Event('resize'))`);
  const bounds = await page.eval(`(() => {
    const caret = document.querySelector('.cursor').getBoundingClientRect();
    const header = document.querySelector('.workspace-head').getBoundingClientRect();
    return { top:caret.top, bottom:caret.bottom, headerBottom:header.bottom, focus:document.activeElement.id };
  })()`);
  assert.equal(bounds.focus, 'typing');
  assert.ok(bounds.top >= bounds.headerBottom, 'caret is below the sticky controls');
  assert.ok(bounds.bottom <= 384, 'caret is above the simulated keyboard');
  assert.ok(await page.eval('document.documentElement.scrollWidth <= 390'), 'page does not scroll horizontally');
  console.log('mobile keyboard viewport: ok');
  await page.close();
} finally { await browser.close(); }
