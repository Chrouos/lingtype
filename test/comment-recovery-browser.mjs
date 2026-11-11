// Run against an isolated test server with LINGTYPE_URL set to its address.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source:`
    window.confirm = () => true;
    const originalFetch = window.fetch;
    window.fetch = async (url, options = {}) => {
      const response = await originalFetch(url, options);
      if (String(url).endsWith('/community/comments') && options.method === 'POST') {
        const ids = JSON.parse(sessionStorage.getItem('test-comment-ids') || '[]');
        ids.push(JSON.parse(options.body).commentId);
        sessionStorage.setItem('test-comment-ids', JSON.stringify(ids));
        if (ids.length === 1) throw new Error('simulated lost response');
      }
      return response;
    };
  `});
  await page.goto(base);
  const wait = async (condition, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await page.eval(condition)) return; await pause(100); }
    throw new Error(`Timed out waiting for ${label}`);
  };
  await wait(() => document.getElementById('lesson-chooser')?.hidden === false, 'initial preview');
  await page.eval(() => { document.getElementById('preview-start').click(); document.getElementById('publish-workbook').click(); document.getElementById('public-share-rights').checked = true; document.getElementById('public-share-form').requestSubmit(); });
  await wait(() => Object.keys(JSON.parse(localStorage.getItem('lingtype-published-keys') || '{}')).length === 1 && !document.getElementById('publish-workbook').disabled && !document.getElementById('share-dialog').open, 'publication');
  const book = await page.eval(() => Object.keys(JSON.parse(localStorage.getItem('lingtype-published-keys')))[0]);
  await page.eval(id => { location.hash = `book-${id}`; }, book);
  await wait(() => !!document.getElementById('public-comment-form'), 'comment form');
  await page.eval(() => {
    document.getElementById('public-name').value = 'Test reader';
    document.getElementById('public-comment').value = 'A comment with a lost response.';
    document.getElementById('public-comment-form').requestSubmit();
  });
  await wait(() => document.getElementById('public-pending-comments').textContent.includes('A comment with a lost response.'), 'pending comment');
  await wait(() => JSON.parse(sessionStorage.getItem('test-comment-ids') || '[]').length === 1, 'lost response');
  await wait(() => document.getElementById('public-detail-message').textContent.includes('無法確認留言是否送出'), 'uncertain result notice');
  await page.goto(`${base}?reload=${Date.now()}#book-${book}`, {settleMs:300});
  await wait(() => document.getElementById('public-pending-comments')?.textContent.includes('A comment with a lost response.'), 'pending comment after reload');
  assert.equal(await page.eval(() => document.getElementById('public-comment').value), '', 'reopening does not automatically post or overwrite a draft');
  await page.eval(() => document.querySelector('[data-pending-comment]').click());
  assert.equal(await page.eval(() => document.getElementById('public-comment').value), 'A comment with a lost response.');
  assert.equal(await page.eval(() => document.getElementById('public-name').value), 'Test reader');
  await page.eval(() => document.getElementById('public-comment-form').requestSubmit());
  await wait(() => JSON.parse(sessionStorage.getItem('test-comment-ids') || '[]').length === 2, 'manual retry');
  await wait(() => !document.getElementById('public-pending-comments').textContent.includes('A comment with a lost response.'), 'confirmed comment removed from pending');
  const ids = await page.eval(() => JSON.parse(sessionStorage.getItem('test-comment-ids')));
  assert.equal(ids[0], ids[1], 'the retry uses the same comment identity');
  const comments = await page.eval(async id => (await (await fetch(`/api/workbooks/${id}/community`)).json()).comments, book);
  assert.equal(comments.filter(comment => comment.text === 'A comment with a lost response.').length, 1);
  console.log('Comment recovery after lost response and reload passed');
} finally { await browser.close(); }
