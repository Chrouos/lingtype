// An unsuccessful restore must not discard typing waiting in the save debounce.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(base);
  for (let i = 0; i < 200; i++) {
    if (await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false)) break;
    await pause(100);
  }
  await page.eval(() => document.getElementById('preview-start').click());
  await page.eval(() => {
    // Hold the debounce so this covers input that is not yet saved.
    const timer = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => timer(callback, delay === 400 ? 60000 : delay, ...args);
    const put = IDBObjectStore.prototype.put;
    window.stageAttempts = 0;
    IDBObjectStore.prototype.put = function(value, key) {
      if (key === 'pending-restore') { window.stageAttempts++; throw new DOMException('quota', 'QuotaExceededError'); }
      return put.call(this, value, key);
    };
    window.confirm = () => true;
    const typing = document.getElementById('typing');
    typing.value = 'T'; typing.dispatchEvent(new Event('input', {bubbles:true}));
    const backup = JSON.stringify({format:'lingtype-backup', version:1, data:{'lingtype-language':'ja'}});
    const input = document.getElementById('backup-file'), files = new DataTransfer();
    files.items.add(new File([backup], 'backup.json', {type:'application/json'}));
    input.files = files.files; input.dispatchEvent(new Event('change', {bubbles:true}));
  });
  for (let i = 0; i < 200; i++) {
    if (await page.eval(() => document.getElementById('backup-message')?.textContent.includes('還原失敗'))) break;
    await pause(100);
  }
  assert.match(await page.eval(() => document.getElementById('backup-message').textContent), /還原失敗/);
  const saved = await page.eval(() => JSON.parse(localStorage.getItem('lingtype-progress')));
  assert.equal(Object.values(saved)[0].input, 'T');
  await page.eval(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'lingtype-progress') throw new DOMException('quota', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
    document.getElementById('backup-message').textContent = '';
    const typing = document.getElementById('typing');
    typing.value = 'Th'; typing.dispatchEvent(new Event('input', {bubbles:true}));
    const input = document.getElementById('backup-file'), files = new DataTransfer();
    files.items.add(new File([JSON.stringify({format:'lingtype-backup', version:1, data:{'lingtype-language':'ja'}})], 'backup.json'));
    input.files = files.files; input.dispatchEvent(new Event('change', {bubbles:true}));
  });
  for (let i = 0; i < 200; i++) {
    if (await page.eval(() => document.getElementById('backup-message')?.textContent.includes('還原失敗'))) break;
    await pause(100);
  }
  assert.match(await page.eval(() => document.getElementById('backup-message').textContent), /還原失敗/);
  assert.equal(await page.eval(() => window.stageAttempts), 1, 'restore is not staged when saving current typing fails');
  assert.equal(await page.eval(() => document.getElementById('typing').value), 'Th');
  await page.eval(() => {
    window.exportClicks = 0;
    HTMLAnchorElement.prototype.click = function() { window.exportClicks++; };
    document.getElementById('backup-message').textContent = '';
    document.getElementById('backup-export').click();
  });
  assert.match(await page.eval(() => document.getElementById('backup-message').textContent), /無法匯出備份/);
  assert.equal(await page.eval(() => window.exportClicks), 0, 'a stale backup must not be downloaded');
  await page.close();
  process.stdout.write('Failed restore retains typing and failed saving prevents stale export\n');
} finally { await browser.close(); }
