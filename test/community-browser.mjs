// Run against a server with a few shared books, e.g. LINGTYPE_PORT=8766 python server.py; set LINGTYPE_URL to change the address.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { Browser } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8766/';
await mkdir('.taste-skill', { recursive:true });
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(base, { settleMs:300 });
  await page.eval('localStorage.clear()');
  await page.goto(`${base}?shelf=${Date.now()}#public`, { settleMs:800 });
  const shelf = await page.eval(() => ({ books:[...document.querySelectorAll('#public-books .shelf-book h3')].map(node => node.textContent), ranking:document.getElementById('public-ranking').textContent, filters:document.getElementById('public-filters').textContent }));
  assert.ok(shelf.books.length >= 2, 'the shelf lists shared books');
  assert.match(shelf.ranking, /WPM/);
  await page.screenshot({ path:'.taste-skill/community-shelf.jpg', fullPage:true });

  // Open the shortest book, like it, comment, then type it to the end.
  const before = await page.eval(async () => (await (await fetch('/api/workbooks')).json()).books);
  const target = before.reduce((a, b) => a.words <= b.words ? a : b);
  await page.eval(id => document.querySelector(`#public-books [data-book-id="${id}"].book`).click(), target.id);
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(await page.eval(() => document.getElementById('public-detail').hidden), false);
  await page.eval(() => document.getElementById('public-like').click());
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.match(await page.eval(() => document.getElementById('public-like').textContent), /♥/);
  await page.eval(() => { document.getElementById('public-name').value = 'Browser test'; document.getElementById('public-comment').value = 'Typed it all.'; document.getElementById('public-comment-form').requestSubmit(); });
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.match(await page.eval(() => document.getElementById('public-comment-list').textContent), /Typed it all/);
  await page.screenshot({ path:'.taste-skill/community-detail.jpg', fullPage:true });

  await page.eval(() => document.getElementById('add-public-book').click());
  await new Promise(resolve => setTimeout(resolve, 400));
  await page.eval(() => document.getElementById('preview-start')?.click());
  await new Promise(resolve => setTimeout(resolve, 400));
  const text = await page.eval(async id => (await (await fetch(`/api/workbooks/${id}`)).json()).lesson.text.trim(), target.id);
  // The page's clock is moved on 4 seconds per 40 characters, about 120 WPM, so the run looks typed rather than pasted.
  await page.eval(() => { let offset = 0; const real = performance.now.bind(performance); performance.now = () => real() + offset; window.advanceClock = ms => { offset += ms; }; document.getElementById('typing').focus(); });
  for (let i = 0; i < text.length; i += 40) { if (i) await page.eval(() => window.advanceClock(4000)); await page.send('Input.insertText', { text:text.slice(i, i + 40) }); }
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(await page.eval(() => document.getElementById('result').hidden), false, 'the article was typed to its end');
  const after = await page.eval(async id => (await (await fetch(`/api/workbooks/${id}/community`)).json()), target.id);
  assert.equal(after.practiceCount, target.practiceCount + 1, 'the finished run is recorded');
  assert.ok(after.ranking.some(row => row.author === 'Browser test'), 'the run appears in the ranking under the chosen name');
  assert.ok(after.reads > target.reads || target.reads > 0);

  await page.setViewport({ width:390, height:844, mobile:true });
  await page.goto(`${base}?shelf=${Date.now()}#public`, { settleMs:800 });
  await page.screenshot({ path:'.taste-skill/community-mobile.jpg', fullPage:true });
  assert.ok(await page.eval('document.documentElement.scrollWidth <= 390'), 'no sideways scrolling on a phone');
  await page.eval(id => document.querySelector(`#public-books [data-book-id="${id}"].book`).click(), target.id);
  await new Promise(resolve => setTimeout(resolve, 600));
  await page.screenshot({ path:'.taste-skill/community-mobile-detail.jpg', fullPage:true });
  assert.ok(await page.eval('document.documentElement.scrollWidth <= 390'));
  console.log('community browser checks passed');
  await page.close();
} finally { await browser.close(); }
