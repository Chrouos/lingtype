// Manual check of the paper reader: start `python server.py`, then run `node test/paper-browser.mjs [screenshot-dir]`.
// Needs network access to arxiv.org.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { Browser } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const out = process.argv[2] || '.taste-skill/paper';
mkdirSync(out, { recursive:true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  const shot = name => page.screenshot({ path:`${out}/${name}.jpg` });
  const until = async (expr, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.eval(expr)) return; await pause(150); } throw new Error(`timed out: ${expr}`); };
  await page.goto(base, { settleMs:400 });
  await page.eval(() => { localStorage.clear(); indexedDB.deleteDatabase('lingtype-data'); });
  await page.goto(base, { settleMs:600 });
  await until(`document.getElementById('lesson-chooser')?.hidden === false`);
  await page.eval(`document.getElementById('preview-start').click()`);

  // A PDF link imports the HTML version with its formulas and figures.
  await page.eval(`(() => { window.confirm = () => true; document.getElementById('nav-import').click(); document.getElementById('arxiv-url').value = ${JSON.stringify(process.env.LINGTYPE_ARXIV || 'https://arxiv.org/pdf/2611.05306')}; document.getElementById('arxiv-form').requestSubmit(); })()`);
  await until(`/25/.test(document.getElementById('arxiv-message').textContent)`);
  await page.eval(`document.getElementById('nav-practice').click()`);
  // An import opens the chooser with the new lesson; start it.
  await until(`document.getElementById('lesson-chooser')?.hidden === false`);
  await page.eval(`document.getElementById('preview-start').click()`);
  await until(`document.getElementById('section-mode')?.options.length > 2`);
  await page.eval(`(() => { const s = document.getElementById('section-mode'); s.value = '1'; s.dispatchEvent(new Event('change')); })()`);
  await until(`document.getElementById('figure-panel') && !document.getElementById('figure-panel').hidden`);
  assert.equal(await page.eval(`document.querySelector('#figure-panel summary').textContent`), 'Figure 1');
  await until(`document.querySelector('#figure-panel .figure-content img')?.complete`, 20000);
  await shot('paper-figure-1');
  const size = await page.eval(`(() => { const i = document.querySelector('#figure-panel .figure-content img'); return { w:i.naturalWidth, h:i.naturalHeight, box:i.getBoundingClientRect().height, details:document.querySelector('#figure-panel details').open }; })()`);
  assert.ok(size.box > 50, `figure image did not load: ${JSON.stringify(size)}`);

  // Typing up to "Figure 2 shows" brings Figure 2 up.
  const lesson = await page.eval(`(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('lingtype-data', 1); q.onsuccess = () => r(q.result); });
    const raw = await new Promise(r => { const q = db.transaction('values').objectStore('values').get('lingtype-custom-lessons'); q.onsuccess = () => r(q.result); });
    const item = JSON.parse(raw).find(entry => entry.category === 'arxiv');
    return { text:item.sections[1].text, formulas:item.formulas.length, figures:item.figures.length };
  })()`);
  assert.equal(lesson.formulas, 16);
  assert.equal(lesson.figures, 25);
  const target = 'Figure 2 shows';
  const upto = lesson.text.slice(0, lesson.text.indexOf(target) + target.length).replace(/[‘’]/g, "'").replace(/\s*\n\n/g, ' ');
  await page.eval(`document.getElementById('typing').focus()`);
  await page.send('Input.insertText', { text:upto });
  await until(`document.querySelector('#figure-panel summary')?.textContent === 'Figure 2'`);
  // The strip lists the section's figures; picking one shows it until the text reaches another figure.
  const chips = await page.eval(`[...document.querySelectorAll('#figure-panel .figure-chip')].map(chip => chip.textContent)`);
  assert.deepEqual(chips, ['Figure 1', 'Figure 2', 'Table 1']);
  await page.eval(`document.querySelector('#figure-panel .figure-chip[data-figure="2"]').click()`);
  await until(`document.querySelector('#figure-panel summary')?.textContent === 'Table 1'`);
  assert.ok(await page.eval(`document.querySelector('#figure-panel .figure-table td') !== null`), 'table not shown');
  assert.equal(await page.eval(`document.activeElement?.id`), 'typing');
  await page.send('Input.insertText', { text:' ' });
  assert.equal(await page.eval(`document.querySelector('#figure-panel summary').textContent`), 'Table 1');
  // A table opens large too.
  await page.eval(`document.querySelector('#figure-panel .figure-table td').click()`);
  await until(`document.getElementById('figure-dialog').open`);
  assert.ok(await page.eval(`document.querySelector('#figure-dialog-body .figure-table td') !== null`), 'table not enlarged');
  assert.equal(await page.eval(`document.getElementById('figure-original').hidden`), true);
  await page.eval(`document.getElementById('figure-close').click()`);
  await until(`!document.getElementById('figure-dialog').open`);
  await page.eval(`document.querySelector('#figure-panel .figure-chip[data-figure="1"]').click()`);
  await until(`document.querySelector('#figure-panel summary')?.textContent === 'Figure 2'`);
  // A click on the figure opens it large; Esc closes it without ending the practice.
  await until(`document.querySelector('#figure-panel .figure-content img')?.complete`, 20000);
  await page.eval(`document.querySelector('#figure-panel .figure-content a').click()`);
  await until(`document.getElementById('figure-dialog').open`);
  assert.equal(await page.eval(`document.getElementById('figure-dialog-title').textContent`), 'Figure 2');
  assert.ok(await page.eval(`document.querySelector('#figure-dialog-body img').getBoundingClientRect().width > 600`), 'figure not enlarged');
  assert.equal(await page.eval(`document.querySelector('#figure-dialog-body a')`), null);
  await shot('paper-figure-dialog');
  await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
  await page.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
  await until(`!document.getElementById('figure-dialog').open`);
  assert.equal(await page.eval(`document.getElementById('result').hidden`), true);
  assert.equal(await page.eval(`document.activeElement?.id`), 'typing');
  await until(`document.querySelector('#figure-panel .figure-content img')?.complete`, 20000);
  await shot('paper-figure-2');

  // A formula is drawn in the sentence and the caret passes over it.
  await page.eval(`(() => { window.confirm = () => true; const s = document.getElementById('section-mode'); s.value = [...s.options].find(o => o.textContent.startsWith('Appendix B')).value; s.dispatchEvent(new Event('change')); })()`);
  await until(`document.getElementById('typing')?.value === ''`);
  const appendix = await page.eval(`(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('lingtype-data', 1); q.onsuccess = () => r(q.result); });
    const raw = await new Promise(r => { const q = db.transaction('values').objectStore('values').get('lingtype-custom-lessons'); q.onsuccess = () => r(q.result); });
    return JSON.parse(raw).find(entry => entry.category === 'arxiv').sections.find(s => s.title.startsWith('Appendix B')).text;
  })()`);
  const formulaAt = appendix.search(/[\uE000-\uF8FF]/);
  assert.ok(formulaAt > 0);
  await page.eval(`document.getElementById('typing').focus()`);
  await page.send('Input.insertText', { text:appendix.slice(0, formulaAt).replace(/[\u2018\u2019]/g, "'").replace(/\s*\n\n/g, ' ') });
  await until(`document.getElementById('typing').value.length > ${formulaAt}`);
  assert.ok(await page.eval(`document.querySelector('#article-text .formula math') !== null`), 'formula not drawn');
  await shot('paper-formula');

  // An uploaded PDF shows each page beside its text (set LINGTYPE_PDF to a PDF file with at least three pages of text).
  if (process.env.LINGTYPE_PDF) {
    await page.eval(`(() => { window.confirm = () => true; document.getElementById('nav-import').click(); })()`);
    const { result } = await page.send('Runtime.evaluate', { expression:`document.getElementById('document-file')` });
    await page.send('DOM.getDocument', {});
    await page.send('DOM.setFileInputFiles', { objectId:result.objectId, files:[process.env.LINGTYPE_PDF] });
    await until(`/已匯入/.test(document.getElementById('workbook-message').textContent)`);
    await page.eval(`document.getElementById('nav-practice').click()`);
    await until(`document.getElementById('lesson-chooser')?.hidden === false`);
    await page.eval(`document.getElementById('preview-start').click()`);
    await until(`[...document.getElementById('section-mode').options].some(o => o.textContent === 'p. 3')`);
    await page.eval(`(() => { const s = document.getElementById('section-mode'); s.value = [...s.options].find(o => o.textContent === 'p. 3').value; s.dispatchEvent(new Event('change')); })()`);
    await until(`document.querySelector('#figure-panel summary')?.textContent === '第 3 頁'`);
    await until(`document.querySelector('#figure-panel .pdf-page')?.naturalWidth > 0`, 60000);
    await shot('pdf-page-3');
    assert.equal(await page.eval(`document.querySelectorAll('#figure-panel .figure-chip').length`), 0);
    const id = await page.eval(`(async () => {
      const db = await new Promise(r => { const q = indexedDB.open('lingtype-data', 1); q.onsuccess = () => r(q.result); });
      const keys = await new Promise(r => { const q = db.transaction('values').objectStore('values').getAllKeys(); q.onsuccess = () => r(q.result); });
      return keys.find(key => String(key).startsWith('pdf:'));
    })()`);
    assert.ok(id, 'PDF not stored');
    // Deleting the lesson removes its stored PDF.
    await page.eval(`(() => { window.confirm = () => true; document.getElementById('delete-lesson').click(); })()`);
    await until(`(async () => {
      const db = await new Promise(r => { const q = indexedDB.open('lingtype-data', 1); q.onsuccess = () => r(q.result); });
      const value = await new Promise(r => { const q = db.transaction('values').objectStore('values').get(${JSON.stringify(id)}); q.onsuccess = () => r(q.result); });
      return value === undefined;
    })()`, 10000);
  }
  console.log('paper reader ok');
} finally {
  await browser.close();
}
