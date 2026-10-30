import assert from 'node:assert/strict';
import { Browser } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8765/', { settleMs:500 });
  await page.eval('localStorage.clear()');
  await page.goto('http://127.0.0.1:8765/', { settleMs:500 });
  assert.equal(await page.eval("document.getElementById('lesson-chooser').hidden"), false);
  assert.equal(await page.eval("document.getElementById('practice-content').hidden"), true);
  assert.ok(await page.eval("document.getElementById('lesson-preview').textContent.length > 20"));
  await page.screenshot({ path:'.taste-skill/preview-desktop.jpg', fullPage:true });
  await page.eval("document.getElementById('preview-start').click()");
  assert.equal(await page.eval("document.getElementById('practice-content').hidden"), false);
  await page.eval("document.getElementById('choose-lesson').click()");
  await page.eval("document.getElementById('preview-back').click()");
  await page.eval("document.getElementById('nav-import').click(); document.getElementById('import-title').value='Test'; document.getElementById('import-text').value='A fresh article for practice.'; document.getElementById('import-form').requestSubmit()");
  assert.equal(await page.eval("document.getElementById('lesson-chooser').hidden"), false);
  assert.match(await page.eval("document.getElementById('lesson-preview').textContent"), /A fresh article/);
  await page.setViewport({ width:390, height:844, mobile:true });
  await page.screenshot({ path:'.taste-skill/preview-mobile.jpg', fullPage:true });
  assert.ok(await page.eval('document.documentElement.scrollWidth <= 390'));
  console.log('preview browser checks passed');
  await page.close();
} finally { await browser.close(); }
