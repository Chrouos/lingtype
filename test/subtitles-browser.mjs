// Upload a subtitle through the same file input used by readers.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

const browser = await Browser.launch();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const page = await browser.newPage();
  await page.goto(new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href);
  for (let i = 0; i < 100 && !(await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false)); i++) await pause(100);
  await page.eval(() => {
    window.confirm = () => true;
    document.getElementById('shelf-import').click();
    const transfer = new DataTransfer();
    transfer.items.add(new File(['WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<i>(Perhaps) &#89;ou &amp; I [both] know &lt;img src=x onerror=alert(1)&gt; &mdash; &#x1F30A;.</i>'], 'clip.vtt'));
    const input = document.getElementById('document-file');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  });
  let preview = '';
  for (let i = 0; i < 100; i++) {
    preview = await page.eval(() => document.getElementById('lesson-preview')?.textContent || '');
    if (preview.includes('(Perhaps)')) break;
    await pause(100);
  }
  // The contents show the text as it is typed, with keyboard punctuation.
  assert.ok(/\(Perhaps\) You & I \[both\] know <img src=x onerror=alert\(1\)> [—-] 🌊\./.test(preview), preview);
  assert.equal(await page.eval(() => document.querySelector('#lesson-preview img')), null);
  await page.eval(() => document.getElementById('preview-start').click());
  assert.ok((await page.eval(() => document.getElementById('article-text').textContent)).includes('<img src=x onerror=alert(1)>'));
  assert.equal(await page.eval(() => document.querySelector('#article-text img')), null);
  await page.eval(() => {
    document.getElementById('shelf-import').click();
    const text = '1\n00:00:01,000 --> 00:00:03,000\n“That’s right.”';
    const bytes = new Uint8Array(2 + text.length * 2); bytes.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) { bytes[2 + i * 2] = text.charCodeAt(i) & 255; bytes[3 + i * 2] = text.charCodeAt(i) >> 8; }
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'utf16.srt'));
    const input = document.getElementById('document-file'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  });
  for (let i = 0; i < 100; i++) {
    preview = await page.eval(() => document.getElementById('lesson-preview')?.textContent || '');
    if (preview.includes('That’s right')) break;
    await pause(100);
  }
  assert.ok(/That['’]s right\./.test(preview), preview);
  assert.ok(!preview.includes('�'), preview);
  await page.eval(() => {
    document.getElementById('preview-start').click();
    document.getElementById('shelf-import').click();
    const text = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello.\n\n00:00:02.000 --> 00:00:03.000\nHello.\n\n00:00:03.100 --> 00:00:04.000\nHello.';
    const transfer = new DataTransfer(); transfer.items.add(new File([text], 'repeated.vtt'));
    const input = document.getElementById('document-file'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  });
  for (let i = 0; i < 100; i++) {
    preview = await page.eval(() => document.getElementById('lesson-preview')?.textContent || '');
    if ((preview.match(/Hello\./g) || []).length === 3) break;
    await pause(100);
  }
  assert.equal((preview.match(/Hello\./g) || []).length, 3, preview);
  await page.close();
  console.log('subtitle upload preserves text and does not create markup');
} finally { await browser.close(); }
