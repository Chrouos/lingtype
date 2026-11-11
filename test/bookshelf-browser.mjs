// Run against a server that has the bundled library (python server.py); set LINGTYPE_URL to change the address.
// The home page is the library; a book added from it goes on My bookshelf, opens
// to its contents, and can be read from any paragraph; the bookmark follows.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { Browser } from './helpers/browser.mjs';

const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const shots = process.env.LINGTYPE_SHOTS || '.taste-skill/bookshelf';
await mkdir(shots, { recursive:true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.setViewport({ width:1280, height:900 });
  const wait = async (check, label) => {
    for (let i = 0; i < 100; i++) { if (await page.eval(check)) return; await sleep(100); }
    throw new Error(`Timed out: ${label} ${JSON.stringify(page.consoleErrors)}`);
  };
  async function type(text) {
    for (const char of text) {
      await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:char, text:char });
      await page.send('Input.dispatchKeyEvent', { type:'keyUp', key:char });
    }
  }
  await page.goto(`${base}?bookshelf=${Date.now()}`, { settleMs:300 });
  await page.eval('localStorage.clear(); indexedDB.deleteDatabase("lingtype")');
  await page.goto(`${base}?bookshelf=${Date.now()}`, { settleMs:300 });

  // Home: the library with the bundled novels and papers.
  await wait(() => document.querySelectorAll('#public-books .shelf-book').length >= 2, 'library');
  assert.equal(await page.eval(() => document.getElementById('view-public').hidden), false);
  assert.equal(await page.eval(() => document.getElementById('nav-public').getAttribute('aria-current')), 'page');
  const filters = await page.eval(() => document.getElementById('public-filters').textContent);
  assert.match(filters, /小說/); assert.match(filters, /論文/);
  await page.screenshot({ path:`${shots}/1-library.jpg` });

  // Open a novel and put it on the shelf; its page lists the chapters.
  await page.eval(() => [...document.querySelectorAll('#public-books .book')].find(node => /Alice/.test(node.textContent)).click());
  await wait(() => document.getElementById('add-public-book'), 'book detail');
  assert.equal(await page.eval(() => document.getElementById('add-public-book').textContent), '加入書櫃');
  await page.eval(() => document.getElementById('add-public-book').click());
  await wait(() => document.getElementById('lesson-chooser')?.hidden === false, 'book page');
  assert.equal(await page.eval(() => document.getElementById('choose-heading').textContent), "Alice's Adventures in Wonderland");
  assert.equal(await page.eval(() => document.getElementById('preview-start').textContent), '開始閱讀');
  assert.equal(await page.eval(() => document.getElementById('nav-shelf').getAttribute('aria-current')), 'page');
  assert.ok(await page.eval(() => document.querySelectorAll('#lesson-preview .toc-section').length > 10));
  assert.match(await page.eval(() => document.querySelector('#lesson-preview .toc-section[open] summary').textContent), /Chapter I\. Down the Rabbit-Hole/);
  await page.screenshot({ path:`${shots}/2-book.jpg` });

  // Open the second chapter and start from its third paragraph.
  await page.eval(() => { const section = document.querySelectorAll('#lesson-preview .toc-section')[2]; section.open = true; });
  await wait(() => document.querySelectorAll('#lesson-preview .toc-section')[2].querySelector('.toc-part'), 'lazy chapter');
  const third = await page.eval(() => document.querySelectorAll('#lesson-preview .toc-section')[2].querySelectorAll('.toc-part')[2].querySelector('.toc-text').textContent);
  await page.eval(() => document.querySelectorAll('#lesson-preview .toc-section')[2].querySelectorAll('.toc-part')[2].click());
  await wait(() => document.getElementById('practice-content')?.hidden === false && document.getElementById('typing'), 'reader');
  const reading = await page.eval(() => ({ crumb:document.getElementById('reader-crumb').textContent, title:document.getElementById('reader-title').textContent, text:document.getElementById('article-text').textContent }));
  assert.equal(reading.title, "Alice's Adventures in Wonderland");
  assert.match(reading.crumb, /第 3／\d+ 段/);
  assert.ok(reading.text.replace(/\s+/g, ' ').startsWith(third.replace(/\s+/g, ' ').slice(0, 40)), 'the reader starts at the chosen paragraph');
  await page.eval(() => document.getElementById('typing-stage').click());
  await type(third.slice(0, 12));
  await sleep(600);
  await page.screenshot({ path:`${shots}/3-reader.jpg` });

  // The shelf shows the book being read and where to continue.
  await page.eval(() => document.getElementById('nav-shelf').click());
  await wait(() => document.getElementById('view-shelf')?.hidden === false, 'shelf');
  const shelf = await page.eval(() => ({ books:[...document.querySelectorAll('#shelf-books .book')].map(node => node.textContent), continue:document.getElementById('shelf-continue').textContent }));
  assert.equal(shelf.books[0], "Alice's Adventures in Wonderland");
  assert.match(shelf.continue, /接著讀/);
  assert.match(shelf.continue, /第 3 段/);
  await page.screenshot({ path:`${shots}/4-shelf.jpg` });

  // Continue returns to the unfinished passage with its typing kept.
  await page.eval(() => document.querySelector('#shelf-continue [data-continue]').click());
  await wait(() => document.getElementById('practice-content')?.hidden === false, 'continue');
  assert.equal(await page.eval(() => document.getElementById('typing').value), third.slice(0, 12));

  // Finishing a short book marks it read and returns to its page.
  await page.eval(() => document.getElementById('nav-shelf').click());
  await page.eval(() => [...document.querySelectorAll('#shelf-books .book')].find(node => node.textContent === 'At the coffee shop').click());
  await wait(() => document.getElementById('lesson-chooser')?.hidden === false && document.getElementById('choose-heading').textContent === 'At the coffee shop', 'sample page');
  await page.eval(() => { window.confirm = () => true; document.getElementById('preview-start').click(); });
  await wait(() => document.getElementById('practice-content')?.hidden === false && /coffee/.test(document.getElementById('article-text')?.textContent || ''), 'sample reader');
  const sample = 'Could I have a cup of coffee, please? I would like it with milk. Thank you for your help.';
  await page.eval(() => document.getElementById('typing-stage').click());
  await type(sample);
  await wait(() => document.getElementById('result')?.hidden === false, 'result');
  assert.match(await page.eval(() => document.getElementById('next-action').textContent), /讀完了，回到目錄/);
  await page.eval(() => document.getElementById('next-action').click());
  await wait(() => document.getElementById('lesson-chooser')?.hidden === false, 'back to book');
  assert.equal(await page.eval(() => document.getElementById('preview-start').textContent), '再讀一次');
  assert.match(await page.eval(() => document.getElementById('book-progress-text').textContent), /100%/);

  // The import page is reached from the shelf, and the library offers uploads with a category.
  await page.eval(() => document.getElementById('nav-shelf').click());
  await page.eval(() => document.getElementById('shelf-import').click());
  assert.equal(await page.eval(() => document.getElementById('view-import').hidden), false);
  // Uploading opens a dialog over the library; the new book opens in the library and is on the shelf.
  await page.eval(() => document.getElementById('nav-public').click());
  await page.eval(() => document.getElementById('public-share').click());
  assert.equal(await page.eval(() => document.getElementById('share-dialog').open), true);
  assert.equal(await page.eval(() => document.getElementById('public-share-file-field').hidden), false, 'a file is uploaded by default');
  assert.match(await page.eval(() => document.getElementById('public-share-category').textContent), /小說/);
  await page.screenshot({ path:`${shots}/7-share.jpg` });
  await page.eval(() => { const shelf = document.querySelector('[name="share-source"][value="shelf"]'); shelf.checked = true; shelf.dispatchEvent(new Event('change', { bubbles:true })); });
  assert.equal(await page.eval(() => document.getElementById('public-share-lesson-field').hidden), false);
  assert.ok(await page.eval(() => ![...document.getElementById('public-share-lesson').options].some(option => /Alice/.test(option.textContent))), 'books from the library are not shared again');
  assert.equal(await page.eval(() => document.getElementById('public-share-lesson').selectedOptions[0].textContent), 'A quieter morning', 'the latest own book is chosen');
  await page.eval(() => {
    const file = document.querySelector('[name="share-source"][value="file"]'); file.checked = true; file.dispatchEvent(new Event('change', { bubbles:true }));
    const transfer = new DataTransfer(); transfer.items.add(new File(['A lighthouse stood on the cliff.\n\nIts keeper wrote every night.'], 'Lighthouse.txt', { type:'text/plain' }));
    const input = document.getElementById('public-share-file'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles:true }));
    document.querySelector('[name="share-category"][value="novel"]').checked = true;
  });
  assert.equal(await page.eval(() => document.getElementById('public-share-file-name').textContent), 'Lighthouse.txt');
  await page.eval(() => document.getElementById('public-share-form').requestSubmit());
  assert.equal(await page.eval(() => document.getElementById('share-dialog').open), true, 'the rights confirmation is required');
  await page.eval(() => { document.getElementById('public-share-rights').checked = true; document.getElementById('public-share-form').requestSubmit(); });
  await wait(() => !document.getElementById('share-dialog').open && /Lighthouse/.test(document.querySelector('#public-detail h2')?.textContent || ''), 'shared book');
  assert.match(await page.eval(() => document.querySelector('#public-detail .eyebrow').textContent), /小說/);
  await page.eval(() => document.getElementById('nav-shelf').click());
  assert.ok(await page.eval(() => [...document.querySelectorAll('#shelf-books .book')].some(node => node.textContent === 'Lighthouse')));

  // Phone width.
  await page.setViewport({ width:390, height:844, mobile:true, dsf:2 });
  await page.eval(() => document.getElementById('nav-shelf').click());
  await sleep(200);
  assert.ok(await page.eval(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling on a phone');
  await page.screenshot({ path:`${shots}/5-shelf-phone.jpg` });
  await page.eval(() => document.querySelector('#shelf-books .book').click());
  await sleep(300);
  assert.ok(await page.eval(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path:`${shots}/6-book-phone.jpg` });
  assert.deepEqual(page.consoleErrors, []);
  console.log('library, bookshelf, contents and reading from a paragraph passed');
} finally { await browser.close(); }
