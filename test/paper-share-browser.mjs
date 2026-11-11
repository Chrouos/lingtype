// Run against an isolated test server with LINGTYPE_URL set to its address.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

// The reader opens at #practice; the home page is the library.
const base = new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source:`
    window.confirm = () => true;
    const original = window.fetch;
    window.fetch = (url, options) => String(url).startsWith('/api/import?')
      ? Promise.resolve(new Response(JSON.stringify({title:'Attribution test', text:'A simple paper. More text.', sections:[{title:'One', text:'A simple paper.'}, {title:'Two', text:'More text.'}], authors:['Test Author', 'Second Author', '𠮷'.repeat(101)], sourceUrl:'https://arxiv.org/html/2610.12345v1', license:'CC BY'}), {status:200, headers:{'Content-Type':'application/json'}}))
      : original(url, options);
  `});
  await page.goto(base);
  const wait = async (condition, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await page.eval(condition)) return; await pause(100); }
    throw new Error(`Timed out waiting for ${label}`);
  };
  await wait(() => document.getElementById('lesson-chooser')?.hidden === false, 'initial preview');
  await page.eval(() => {
    document.getElementById('preview-start').click(); document.getElementById('shelf-import').click();
    document.getElementById('arxiv-url').value = 'https://arxiv.org/abs/2610.12345v1';
    document.getElementById('arxiv-form').requestSubmit();
  });
  await wait(() => document.getElementById('lesson-chooser')?.hidden === false && document.getElementById('lesson-preview')?.textContent.includes('A simple paper.'), 'import preview');
  await page.eval(() => document.getElementById('preview-start').click());
  await wait(() => document.getElementById('source-info')?.textContent.includes('Test Author'), 'original attribution');
  await page.eval(() => { document.getElementById('publish-workbook').click(); document.getElementById('public-share-rights').checked = true; document.getElementById('public-share-form').requestSubmit(); });
  await wait(() => Object.keys(JSON.parse(localStorage.getItem('lingtype-published-keys') || '{}')).length === 1 && !document.getElementById('publish-workbook').disabled && !document.getElementById('share-dialog').open, 'publication');
  const id = await page.eval(() => Object.keys(JSON.parse(localStorage.getItem('lingtype-published-keys')))[0]);
  await page.eval(() => document.getElementById('nav-public').click());
  await wait(() => document.getElementById('public-books').textContent.includes('Test Author'), 'author on shelf');
  await page.eval(id => { location.hash = `book-${id}`; }, id);
  await wait(() => document.getElementById('public-detail')?.textContent.includes('Test Author'), 'author on detail');
  await page.eval(() => document.getElementById('add-public-book').click());
  await wait(() => document.getElementById('lesson-chooser')?.hidden === false, 'public copy preview');
  await page.eval(() => document.getElementById('preview-start').click());
  await wait(() => document.getElementById('source-info')?.textContent.includes('Test Author'), 'copied attribution');
  const source = await page.eval(() => ({text:document.getElementById('source-info').textContent, href:document.querySelector('#source-info a')?.href}));
  assert.match(source.text, /Second Author/);
  assert.ok(source.text.includes('𠮷'.repeat(101)), 'supplementary Unicode author survives sharing');
  assert.match(source.text, /CC BY/);
  assert.equal(source.href, 'https://arxiv.org/html/2610.12345v1');
  console.log('Public paper preserves source authors and license');
} finally { await browser.close(); }
