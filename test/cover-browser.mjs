// Run against an isolated test server with LINGTYPE_URL set to its address.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Browser } from './helpers/browser.mjs';

const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:18766/';
const dir = await mkdtemp(join(tmpdir(), 'lingtype-cover-test-'));
const images = ['iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAKElEQVR4nGP8z0AdwEQlcxhGDSIMRg0iDEYNIgxGDSIMRg0iDAafQQB7qgEvsm2eqgAAAABJRU5ErkJggg==', 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAKklEQVR4nGNkYPjPQA3ARBVTGEYNIgaMGkQYjBpEGIwaRBiMGkQYDD6DAHmsAS8I3QDlAAAAAElFTkSuQmCC'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
try {
  await Promise.all(['red', 'blue'].map((color, index) => writeFile(join(dir, `${color}.png`), Buffer.from(images[index], 'base64'))));
  console.log('Launching isolated browser');
  browser = await Browser.launch();
  const page = await browser.newPage();
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source:'window.confirm = () => true;'});
  await page.goto(base, {settleMs:500});
  const wait = async (condition, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await pause(500);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  console.log('Waiting for initial practice preview');
  await wait(() => page.eval(() => !!document.getElementById('lesson-chooser') && !document.getElementById('lesson-chooser').hidden), 'initial preview');
  await page.eval(() => { document.getElementById('preview-start').click(); document.getElementById('publish-workbook').click(); document.getElementById('public-share-rights').checked = true; document.getElementById('public-share-form').requestSubmit(); });
  console.log('Publishing test workbook');
  await wait(() => page.eval(() => Object.keys(JSON.parse(localStorage.getItem('lingtype-published-keys') || '{}')).length === 1 && !document.getElementById('publish-workbook').disabled && !document.getElementById('share-dialog').open), 'publication');
  const id = await page.eval(() => Object.keys(JSON.parse(localStorage.getItem('lingtype-published-keys')))[0]);
  await page.eval(id => { location.hash = `book-${id}`; }, id);
  await wait(() => page.eval(() => !!document.getElementById('public-cover-file') && !document.getElementById('public-detail').hidden), 'owner detail');
  for (const [index, color] of ['red', 'blue'].entries()) {
    console.log(`Uploading ${color} cover`);
    const {root} = await page.send('DOM.getDocument');
    const {nodeId} = await page.send('DOM.querySelector', {nodeId:root.nodeId, selector:'#public-cover-file'});
    assert.ok(nodeId, 'owner cover input exists');
    await page.send('DOM.setFileInputFiles', {nodeId, files:[join(dir, `${color}.png`)]});
    await wait(() => page.eval(async id => (await (await fetch(`/api/workbooks/${id}/cover-revision`)).json()).revision, id).then(n => n === index + 1), `${color} revision`);
    await wait(() => page.eval(() => document.getElementById('public-detail-message').textContent.includes('封面已更新')), `${color} confirmation`);
    const bytes = await page.eval(async id => [...new Uint8Array(await (await fetch(`/api/workbooks/${id}/cover`)).arrayBuffer())], id);
    assert.deepEqual(Buffer.from(bytes), await readFile(join(dir, `${color}.png`)));
    const titles = await page.eval(() => ({cover:document.querySelector('#public-cover-box .cover-title').textContent, detail:document.querySelector('#public-detail h2').textContent}));
    assert.equal(titles.cover, titles.detail, 'updating a directly opened cover preserves the book title');
  }
  console.log('Opening the share link directly');
  await page.goto(`${base}?direct=${Date.now()}#book-${id}`, {settleMs:500});
  const deadline = Date.now() + 15000;
  let loaded = false;
  while (Date.now() < deadline) {
    loaded = await page.eval(() => { const image = document.querySelector('#public-cover-box img'); return !!image && image.complete && image.naturalWidth > 0; });
    if (loaded) break;
    await pause(500);
  }
  assert.ok(loaded, 'the shared link displays its cover without a preloaded shelf');
  console.log('Cover upload and replacement passed');
} finally { if (browser) await browser.close(); await rm(dir, {recursive:true, force:true}); }
