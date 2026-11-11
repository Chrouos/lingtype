// Start Lingtype, then run with Node 22+, Python 3 and Chrome/Chromium.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Browser } from './helpers/browser.mjs';

const dir = await mkdtemp(join(tmpdir(), 'lingtype-epub-'));
const path = join(dir, 'short.epub');
let browser;
try {
  execFileSync('python3', ['-c', `import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
 z.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book/package.opf"/></rootfiles></container>')
 z.writestr('book/package.opf', '<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Short book</dc:title></metadata><manifest><item id="one" href="short%20chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>')
 z.writestr('book/short chapter.xhtml', '<html><head><title>Short chapter</title></head><body><header>Opening</header><article><p>Hello there.</p></article><div>Final words.</div><aside>A note.</aside></body></html>')`, path]);
  browser = await Browser.launch();
  const page = await browser.newPage();
  await page.goto(new URL('#practice', process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/').href, {settleMs:500});
  for (let i = 0; i < 100 && !(await page.eval(() => document.getElementById('lesson-chooser')?.hidden === false)); i++) await new Promise(resolve => setTimeout(resolve, 100));
  await page.eval(() => { window.confirm = () => true; document.getElementById('shelf-import').click(); });
  const { root } = await page.send('DOM.getDocument');
  const { nodeId } = await page.send('DOM.querySelector', {nodeId:root.nodeId, selector:'#document-file'});
  await page.send('DOM.setFileInputFiles', {nodeId, files:[path]});
  let preview = '';
  for (let i = 0; i < 100; i++) {
    preview = await page.eval(() => document.getElementById('lesson-preview')?.textContent || '');
    if (preview.includes('Final words.')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const text of ['Opening', 'Hello there.', 'Final words.', 'A note.']) assert.ok(preview.includes(text), `${text} is present in the imported lesson`);
  await page.close();
  console.log('short EPUB import passed');
} finally {
  if (browser) await browser.close();
  await rm(dir, {recursive:true, force:true});
}
