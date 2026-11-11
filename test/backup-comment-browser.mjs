// Run against an isolated test server with LINGTYPE_URL set to its address.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source:'window.confirm = () => true;'});
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
    const originalFetch = window.fetch;
    window.commentRequests = 0;
    window.fetch = (url, options = {}) => {
      if (String(url).endsWith('/community/comments') && options.method === 'POST') {
        window.commentRequests++;
        const response = {ok:true, status:201, json:async () => ({id:JSON.parse(options.body).commentId})};
        if (window.commentRequests === 1) return new Promise(resolve => { window.releaseComment = () => resolve(response); });
        return Promise.resolve(response);
      }
      return originalFetch(url, options);
    };
    window.tryRestore = () => {
      const input = document.getElementById('backup-file'), files = new DataTransfer();
      files.items.add(new File([JSON.stringify({format:'lingtype-backup', version:1, data:{'lingtype-language':'ja'}})], 'backup.json'));
      input.files = files.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    };
    document.getElementById('public-comment').value = 'First';
    document.getElementById('public-comment-form').requestSubmit();
  });
  await wait(() => !!window.releaseComment, 'pending comment');
  await page.eval(() => window.tryRestore());
  await wait(() => document.getElementById('backup-message').textContent.includes('留言正在送出'), 'restore blocked by pending comment');
  await page.eval(() => window.releaseComment());
  await wait(() => !document.querySelector('#public-comment-form button[type=submit]').disabled, 'comment finished');
  await page.eval(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (key === 'pending-restore') {
        window.restoreStaging = true;
        const tx = this.transaction, deadline = Date.now() + 500;
        const hold = () => { const request = this.get('test-hold'); request.onsuccess = () => { if (Date.now() < deadline) hold(); else tx.abort(); }; };
        hold();
      }
      return put.call(this, value, key);
    };
    window.tryRestore();
  });
  await wait(() => window.restoreStaging, 'restore staging');
  await page.eval(() => { document.getElementById('public-comment').value = 'Second'; document.getElementById('public-comment-form').requestSubmit(); });
  assert.equal(await page.eval(() => window.commentRequests), 1);
  assert.match(await page.eval(() => document.getElementById('public-detail-message').textContent), /正在還原備份/);
  await wait(() => document.getElementById('backup-message').textContent.includes('還原失敗'), 'restore failure');
  assert.equal(await page.eval(() => document.getElementById('public-comment').value), 'Second');
  await page.eval(() => document.getElementById('public-comment-form').requestSubmit());
  await wait(() => window.commentRequests === 2, 'comment available after failed restore');
  console.log('Comment submission and failed backup restore are safely coordinated');
} finally { await browser.close(); }
