// Run against an isolated test server with LINGTYPE_URL set to its address.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

const browser = await Browser.launch();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const page = await browser.newPage();
  await page.goto(process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/');
  const wait = async (condition, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await page.eval(condition)) return; await pause(100); }
    throw new Error(`Timed out waiting for ${label}`);
  };
  await wait(() => document.getElementById('lesson-chooser')?.hidden === false, 'initial preview');
  await page.eval(() => {
    const bookId = 'a'.repeat(32), visitor = 'b'.repeat(32), original = window.fetch;
    localStorage.setItem('lingtype-public-progress', JSON.stringify({progress:{}, outbox:[], starts:[], reads:[{bookId, visitor}]}));
    window.readRequests = 0;
    window.fetch = (url, options) => {
      if (String(url).endsWith('/community/read')) {
        window.readRequests++;
        if (window.readRequests === 1) return new Promise(resolve => { window.releaseRead = resolve; });
        return Promise.resolve({ok:true, status:200});
      }
      return original(url, options);
    };
    window.dispatchEvent(new Event('online'));
  });
  await wait(() => !!window.releaseRead, 'pending read');
  await page.eval(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (key === 'pending-restore') {
        window.releaseRead({ok:true, status:200});
        const transaction = this.transaction, deadline = Date.now() + 300;
        const hold = () => {
          const request = this.get('test-hold');
          request.onsuccess = () => { if (Date.now() < deadline) hold(); else transaction.abort(); };
        };
        hold();
      }
      return put.call(this, value, key);
    };
    window.confirm = () => true;
    const backup = JSON.stringify({format:'lingtype-backup', version:1, data:{'lingtype-language':'ja'}});
    const input = document.getElementById('backup-file'), files = new DataTransfer();
    files.items.add(new File([backup], 'backup.json', {type:'application/json'}));
    input.files = files.files; input.dispatchEvent(new Event('change', {bubbles:true}));
  });
  await wait(() => document.getElementById('backup-message').textContent.includes('還原失敗'), 'failed restore');
  await wait(() => window.readRequests >= 2, 'read retried after restore');
  await wait(() => JSON.parse(localStorage.getItem('lingtype-public-progress')).reads.length === 0, 'read acknowledged');
  assert.equal(await page.eval(() => window.readRequests), 2);
  console.log('Pending community read resumes after failed restore');
} finally { await browser.close(); }
