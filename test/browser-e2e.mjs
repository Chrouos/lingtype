// Manual end-to-end check: start `python server.py`, then run `node test/browser-e2e.mjs [screenshot-dir]`.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Browser } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const out = process.argv[2] || '.taste-skill/e2e';
mkdirSync(out, { recursive:true });
const browser = await Browser.launch();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const page = await browser.newPage();
  const shot = name => page.screenshot({ path:`${out}/${name}.jpg`, fullPage:true });
  const text = id => page.eval(`document.getElementById(${JSON.stringify(id)})?.textContent ?? null`);
  const click = async selector => {
    const point = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left + 10, y:r.top + 10}; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...point, button:'left', clickCount:1 });
  };
  const type = value => page.send('Input.insertText', { text:value });
  const setLanguage = value => page.eval(`(() => { const s = document.getElementById('language'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); })()`);

  await page.goto(base, { settleMs:400 });
  await page.eval(() => { localStorage.clear(); });
  await page.goto(base, { settleMs:600 });
  assert.equal(await page.eval('document.documentElement.lang'), 'zh-Hant');
  assert.equal(await text('nav-import'), '匯入');
  assert.equal(await page.eval(`getComputedStyle(document.body).fontFamily.includes('Geist')`), true);

  // The whole article is shown; only the current sentence's translation appears.
  // The whole text reads like a book: English then its translation, the current sentence's translation in full ink.
  assert.match(await page.eval(`document.querySelector('#article-text .s.up')?.textContent || ''`), /^A gentle breeze/);
  assert.match(await page.eval(`document.querySelector('#article-text .tr .now').textContent`), /^城市仍然安靜時/);
  assert.match(await page.eval(`document.querySelector('#article-text .tr').textContent`), /微風帶來雨的氣息/);
  await shot('desktop-article-start');
  // Away from the text it dims with a prompt; typing fades everything around it.
  const look = () => page.eval(`({ veil:getComputedStyle(document.querySelector('.focus-veil')).opacity, bar:getComputedStyle(document.querySelector('.bar')).opacity, head:getComputedStyle(document.querySelector('.workspace-head')).opacity, text:getComputedStyle(document.getElementById('article-text')).opacity })`);
  assert.deepEqual(await look(), { veil:'1', bar:'1', head:'1', text:'0.55' });
  assert.equal(await text('focus-veil'), '點這裡或按任意鍵開始打字');
  await click('#article-text');
  await pause(400);
  assert.deepEqual(await look(), { veil:'0', bar:'0.18', head:'0.18', text:'1' });
  await shot('desktop-focus-mode');
  await page.eval(`document.activeElement.blur()`);
  await pause(400);
  assert.deepEqual(await look(), { veil:'1', bar:'1', head:'1', text:'0.55' });
  await shot('desktop-unfocused');
  // A printable key typed while a button has focus goes into the card.
  await page.eval(`document.getElementById('nav-practice').focus()`);
  await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:'T', text:'T', code:'KeyT', windowsVirtualKeyCode:84 });
  await page.send('Input.dispatchKeyEvent', { type:'keyUp', key:'T', code:'KeyT', windowsVirtualKeyCode:84 });
  assert.equal(await page.eval(`document.activeElement.id`), 'typing');
  assert.equal(await page.eval(`document.getElementById('typing').value`), 'T');
  await type('he city was still quiet when Mia opened her window.');
  // The caret waits on the space after the period until it is typed.
  assert.equal(await text('progress'), '第 1 / 2 句');
  assert.equal(await page.eval(`!!document.querySelector('#article-text .sep.cursor')`), true);
  await shot('desktop-article-space');
  await type(' ');
  assert.match(await text('article-text'), /微風帶來雨的氣息/);
  assert.equal(await text('progress'), '第 2 / 2 句');
  assert.match(await page.eval(`document.querySelector('#article-text .done-sentence').textContent`), /^The city was still quiet/);
  assert.match(await page.eval(`document.querySelector('#article-text .current-sentence').textContent`), /^A gentle breeze/);
  assert.match(await page.eval(`document.querySelector('#article-text .tr .now').textContent`), /^微風帶來雨的氣息/);
  await shot('desktop-article-second');
  await type('A gentle breeze carried the scent of rain, and for a moment she simply watched the morning unfold.');
  await pause(300);
  // Finishing a text goes straight on to the next one: no result screen, the cursor is ready.
  assert.equal(await page.eval(`document.getElementById('result').hidden`), true);
  assert.equal(await page.eval(`document.getElementById('lesson').selectedOptions[0].textContent`), 'A small garden');
  assert.equal(await text('session-toast'), '接著：A small garden');
  assert.equal(await page.eval(`document.activeElement.id`), 'typing');
  await shot('desktop-session-next');
  await type('Every weekend, Noah');

  // Esc stops the session: its totals cover both texts.
  await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
  await page.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
  await pause(900);
  assert.equal(await page.eval(`document.getElementById('result').hidden`), false);
  assert.match(await text('result'), /已停止/);
  assert.match(await text('result'), /連續練習了 2 篇/);
  assert.match(await text('result'), /100%/);
  const wpm = Number(await page.eval(`document.querySelector('#result .stats strong').textContent`));
  assert.ok(wpm > 0, 'result WPM is positive');
  await shot('desktop-result-zh');

  // Tapping a word adds it to word practice; built-in words start picked.
  assert.equal(await page.eval(`document.querySelector('.pick[data-pick="seedlings"]').classList.contains('picked')`), true);
  await click('.pick[data-pick="garden"]');
  assert.equal(await page.eval(`document.querySelector('.pick[data-pick="garden"]').classList.contains('picked')`), true);
  assert.equal(await text('pick-count'), '6');
  assert.match(await text('vocab-list'), /garden/);
  await click('.pick[data-pick="garden"]');
  assert.equal(await text('pick-count'), '5');
  // A drag selection shows a floating button that adds every word in it.
  await page.eval(`(() => { const nodes = [...document.querySelectorAll('#review-text .pick')]; const range = document.createRange(); range.setStartBefore(nodes.find(n => n.dataset.pick === 'small')); range.setEndAfter(nodes.find(n => n.dataset.pick === 'behind')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); })()`);
  await pause(150);
  assert.equal(await page.eval(`document.getElementById('save-selected-words').hidden`), false);
  assert.equal(await text('save-selected-words'), '加入 3 個單字');
  await shot('desktop-result-selection');
  await page.eval(`document.getElementById('save-selected-words').click()`);
  assert.match(await text('selection-message'), /已加入 3 個單字/);
  assert.equal(await page.eval(`['small','garden','behind'].every(w => document.querySelector('.pick[data-pick="' + w + '"]').classList.contains('picked'))`), true);
  assert.equal(await text('pick-count'), '8');
  await shot('desktop-result-picked');

  // Each text is recorded on its own: the finished one and the stopped one.
  await page.eval(`document.getElementById('nav-history').click()`);
  assert.equal(await page.eval(`document.querySelectorAll('#history-list tr').length`), 2);
  assert.match(await text('history-list'), /A small garden.*A quieter morning.*100%/s);
  await shot('desktop-history-zh');

  // Switching language changes the interface, the stopped result and the history in place.
  await setLanguage('ja');
  assert.equal(await page.eval('document.documentElement.lang'), 'ja');
  assert.equal(await text('nav-import'), '追加');
  assert.equal(await text('history-heading'), '練習記録');
  assert.match(await text('history-list'), /文章/);
  await page.eval(`document.getElementById('nav-practice').click()`);
  assert.match(await text('result'), /中断しました/);
  assert.match(await text('result'), /2 本を続けて練習/);
  await shot('desktop-result-ja');
  await setLanguage('ko');
  assert.equal(await text('nav-import'), '가져오기');
  assert.match(await text('result'), /중단됨/);
  // Enter continues where the session stopped.
  await page.eval(`document.activeElement.blur()`);
  await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  await page.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  await pause(100);
  assert.equal(await page.eval(`document.getElementById('lesson').selectedOptions[0].textContent`), 'A small garden');
  assert.equal(await page.eval(`document.activeElement.id`), 'typing');
  await type(' tends');
  assert.equal(await page.eval(`document.getElementById('typing').value`), 'Every weekend, Noah tends');
  await pause(500);
  await page.goto(base, { settleMs:600 });
  assert.equal(await page.eval(`document.getElementById('language').value`), 'ko', 'language choice persists');
  assert.equal(await text('nav-history'), '기록');
  // The unfinished lesson comes back paused where it was left.
  assert.equal(await page.eval(`document.getElementById('lesson').selectedOptions[0].textContent`), 'A small garden');
  assert.equal(await page.eval(`document.getElementById('typing').value`), 'Every weekend, Noah tends');
  assert.equal(await text('pause'), '계속하기');
  assert.match(await text('vocab-list'), /seedlings\s*모종/);
  await page.eval(`(() => { window.confirm = () => true; const s = document.getElementById('lesson'); s.value = '0'; s.dispatchEvent(new Event('change')); })()`);
  assert.match(await text('vocab-list'), /gentle\s*부드러운/);
  await shot('desktop-practice-ko');

  // The notebook holds the words picked earlier, each with the sentence it came from.
  await setLanguage('zh');
  await page.eval(`document.getElementById('nav-notebook').click()`);
  const noted = await page.eval(`[...document.querySelectorAll('#notebook-list li')].map(li => li.querySelector('strong').textContent)`);
  assert.deepEqual(noted.sort(), ['behind', 'garden', 'small']);
  assert.match(await page.eval(`document.querySelector('#notebook-list .note-sentence').innerHTML`), /<mark>(small|garden|behind)<\/mark>/);
  assert.match(await text('notebook-list'), /出自 A small garden/);
  await shot('desktop-notebook');
  await page.eval(`document.getElementById('notebook-words').click()`);
  assert.equal(await page.eval(`document.getElementById('lesson').selectedOptions[0].textContent`), '我的單字本');
  assert.match(await text('word-text'), /small|garden|behind/);
  await page.eval(`document.getElementById('nav-notebook').click()`);
  await page.eval(`document.getElementById('notebook-sentences').click()`);
  assert.equal(await page.eval(`document.getElementById('article-mode').classList.contains('active')`), true);
  assert.match(await text('article-text'), /^Every weekend, Noah tends a small garden behind his home\./);

  // The clock holds while focus is away from the text, and after six seconds without typing.
  await click('#article-text');
  await type('Every');
  await page.eval(`document.activeElement.blur()`);
  const heldAt = await text('live-time');
  await pause(2200);
  assert.equal(await text('live-time'), heldAt, 'time holds when focus leaves the text');
  await click('#article-text');
  await type(' week');
  await pause(8200);
  const idle = await text('live-time');
  await pause(2200);
  assert.equal(await text('live-time'), idle, 'time holds after a pause in typing');
  assert.ok(Number(idle.split(':')[1]) <= 7, `idle seconds are not counted: ${idle}`);
  await setLanguage('ko');
  await page.eval(`(() => { window.confirm = () => true; const s = document.getElementById('lesson'); s.value = '0'; s.dispatchEvent(new Event('change')); })()`);

  // Word mode: a wrong letter resets the word and shows a localized note.
  await page.eval(`document.getElementById('word-mode').click()`);
  await click('#word-text');
  await type('gx');
  assert.equal(await page.eval(`document.getElementById('typing').value`), '');
  assert.match(await page.eval(`document.querySelector('.error-note').textContent`), /틀렸습니다/);
  assert.equal(await text('live-accuracy-label'), '오류');
  assert.equal(await text('live-accuracy'), '1');
  await type('gentle');
  assert.match(await text('progress'), /^2 \/ 4/);
  await shot('desktop-word-ko');

  // Import a pasted text in Chinese UI; practice starts on it with the word picker.
  await setLanguage('zh');
  await page.eval(`(() => { window.confirm = () => true; document.getElementById('nav-import').click(); })()`);
  await shot('desktop-import-zh');
  // One page holds every way in: a link, a file, or pasted text.
  assert.equal(await page.eval(`['arxiv-url', 'dropzone', 'import-text'].every(id => document.getElementById(id).getBoundingClientRect().height > 0)`), true);
  await page.eval(`(() => { document.getElementById('import-title').value = 'Harbour notes'; document.getElementById('import-text').value = 'Boats returned before dusk. The harbour lights flickered across the water.'; document.getElementById('import-form').requestSubmit(); })()`);
  await pause(300);
  assert.equal(await page.eval(`document.getElementById('view-practice').hidden`), false);
  assert.equal(await page.eval(`document.getElementById('lesson').selectedOptions[0].textContent`), 'Harbour notes');
  assert.equal(await page.eval(`document.getElementById('word-picker').hidden`), false);
  assert.equal(await page.eval(`document.getElementById('lesson-vocab').hidden`), true);
  await page.eval(`document.getElementById('word-picker').open = true`);
  for (let i = 0; i < 160 && await text('hint') === '正在準備翻譯…'; i++) await pause(250);
  // Either a real translation appears, or the page says plainly that none is available.
  const shown = await page.eval(`document.querySelector('#article-text .tr')?.textContent || ''`);
  if (shown) assert.match(shown, /[㐀-鿿]/, 'a shown translation is in Chinese');
  else {
    assert.equal(await text('hint'), '翻譯暫時無法使用，仍可繼續練習');
    assert.equal(await text('article-translation'), '尚無此語言的翻譯');
  }
  console.log(shown ? `translation: ${shown}` : 'translation service unavailable; fallback shown');
  await shot('desktop-imported-zh');

  // A long text is shown whole, in paragraphs, and the page follows the caret.
  await page.eval(`(() => { document.getElementById('nav-import').click(); document.getElementById('import-title').value = 'Long text'; document.getElementById('import-text').value = Array.from({length:30}, (_, i) => 'Sentence number ' + (i + 1) + ' is here.').join(' '); document.getElementById('import-form').requestSubmit(); })()`);
  await pause(300);
  assert.match(await text('article-text'), /Sentence number 30 is here\./);
  assert.equal(await page.eval(`document.querySelectorAll('#article-text .para').length`), 4);
  await click('#article-text');
  for (let i = 1; i <= 20; i++) await type(`Sentence number ${i} is here. `);
  await pause(700);
  assert.equal(await text('progress'), '第 21 / 30 句');
  const caret = await page.eval(`(() => { const c = document.querySelector('#article-text .cursor').getBoundingClientRect(), f = document.getElementById('typing').getBoundingClientRect(); return { top:c.top, near:Math.abs(c.top - f.top) < 4 && Math.abs(c.left - f.left) < 4, height:innerHeight }; })()`);
  assert.ok(caret.near, 'the input sits at the caret');
  assert.ok(caret.top > 0 && caret.top < caret.height, 'the page follows the caret');
  await shot('desktop-article-long');
  // Esc ends early: only typed text is scored, and Enter continues from the same place.
  await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
  await page.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
  await pause(900);
  assert.match(await text('result'), /已停止/);
  assert.match(await text('result'), /完成了 \d+%/);
  assert.match(await text('result'), /100%/);
  await shot('desktop-article-stopped');
  await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  await page.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  await pause(100);
  assert.equal(await page.eval(`document.activeElement.id`), 'typing');
  await type('Sentence number 21 is here. ');
  assert.equal(await text('progress'), '第 22 / 30 句');
  // Skipping the space marks it as one mistake, and the next sentence still lines up.
  await type('Sentence number 22 is here.Sentence');
  assert.equal(await page.eval(`!!document.querySelector('#article-text .sep.incorrect')`), true);
  assert.equal(await page.eval(`document.querySelectorAll('#article-text .current-sentence .incorrect').length`), 0);
  assert.equal(await page.eval(`document.getElementById('typing').value.split('\u0000').length - 1`), 1, 'one missed space is recorded');
  await shot('desktop-article-missed-space');

  // Files: a long text is split into parts and only the first part is drawn; subtitles become prose.
  const upload = async path => {
    await page.eval(`(() => { window.confirm = () => true; document.getElementById('nav-import').click(); })()`);
    const { root } = await page.send('DOM.getDocument', { depth:1 });
    const { nodeId } = await page.send('DOM.querySelector', { nodeId:root.nodeId, selector:'#document-file' });
    await page.send('DOM.setFileInputFiles', { nodeId, files:[resolve(path)] });
    for (let i = 0; i < 40 && await page.eval(`document.getElementById('view-practice').hidden`); i++) await pause(250);
  };
  await page.eval(`(() => { window.confirm = () => true; document.getElementById('nav-import').click(); })()`);
  await shot('desktop-import-page');
  const story = Array.from({ length:120 }, (_, i) => `Paragraph ${i + 1} begins here. It carries a few calm sentences about the sea, the harbour and the boats that come home before the evening light fades away.`).join('\n\n');
  writeFileSync(`${out}/long story.txt`, story);
  await upload(`${out}/long story.txt`);
  assert.equal(await page.eval(`document.getElementById('lesson').selectedOptions[0].textContent`), 'long story');
  assert.equal(await page.eval(`document.getElementById('section-label').hidden`), false);
  assert.equal(await page.eval(`document.getElementById('section-mode').value`), '0');
  assert.equal(await page.eval(`[...document.getElementById('section-mode').options].some(o => o.value === 'all')`), false);
  const drawn = await text('article-text');
  assert.match(drawn, /^Paragraph 1 begins here/);
  assert.doesNotMatch(drawn, /Paragraph 120 begins/);
  await shot('desktop-import-long');
  writeFileSync(`${out}/clip.srt`, '1\n00:00:01,000 --> 00:00:03,000\nThe tide came in slowly.\n\n2\n00:00:03,000 --> 00:00:05,000\nNobody noticed at first.\n');
  await upload(`${out}/clip.srt`);
  assert.equal(await page.eval(`document.getElementById('lesson').selectedOptions[0].textContent`), 'clip');
  assert.match(await text('article-text'), /The tide came in slowly\. Nobody noticed at first\./);

  // A YouTube link brings its English subtitles, titled after the video, with a link back to it.
  if (process.env.LINGTYPE_SKIP_NETWORK !== '1') {
    await page.eval(`(() => { document.getElementById('nav-import').click(); document.getElementById('arxiv-url').value = 'https://www.youtube.com/watch?v=arj7oStGLkU'; document.getElementById('arxiv-form').requestSubmit(); })()`);
    for (let i = 0; i < 120 && await page.eval(`document.getElementById('view-practice').hidden`); i++) await pause(250);
    const title = await page.eval(`document.getElementById('lesson').selectedOptions[0].textContent`);
    assert.match(title, /Procrastinator/, `YouTube import: ${await text('arxiv-message')}`);
    assert.match(await text('article-text'), /^So in college, I was a government major/);
    // The video's own human subtitles arrive as translations, shown at once.
    assert.match(await page.eval(`document.querySelector('#article-text .tr').textContent`), /^大學的時候，我主修政治學/);
    assert.equal(await page.eval(`document.querySelector('#source-info a').href`), 'https://www.youtube.com/watch?v=arj7oStGLkU');
    await shot('desktop-import-youtube');
    console.log(`youtube: ${title}`);
  }

  // Phone layout has no horizontal scroll.
  await page.setViewport({ width:390, height:844, mobile:true });
  await pause(200);
  const overflow = () => page.eval(`[...document.querySelectorAll('body *')].filter(n => n.getBoundingClientRect().right > 391 && getComputedStyle(n).position !== 'fixed').slice(0, 5).map(n => n.tagName + '#' + n.id + '.' + n.className + ' ' + Math.round(n.getBoundingClientRect().right)).join(', ')`);
  assert.ok(await page.eval(`document.documentElement.scrollWidth <= 390`), `no horizontal scroll on a phone: ${await overflow()}`);
  await shot('mobile-imported-zh');
  await page.eval(`document.getElementById('nav-history').click()`);
  assert.ok(await page.eval(`document.documentElement.scrollWidth <= 390`));
  await shot('mobile-history-zh');

  const errors = page.consoleErrors || [];
  assert.deepEqual(errors.filter(line => !/favicon/.test(String(line))), [], 'no console errors');
  console.log(`e2e ok · result ${wpm} WPM · screenshots in ${out}`);
  await page.close();
} finally { await browser.close(); }
