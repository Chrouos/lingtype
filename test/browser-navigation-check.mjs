// Run against a local server to check the shared Chrome navigation helper.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';
const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(base);
  await page.eval(() => { document.documentElement.dataset.oldDocument = 'present'; });
  await page.goto(base);
  assert.equal(await page.eval(() => document.documentElement.dataset.oldDocument), undefined, 'same-URL navigation reaches the new document');
  const hash = new URL(base); hash.hash = 'practice';
  await page.goto(hash.href);
  assert.equal(await page.eval(() => location.href), hash.href, 'same-document hash navigation completes');
  await page.close();
  console.log('browser navigation checks passed');
} finally { await browser.close(); }
