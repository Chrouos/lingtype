import { test } from 'node:test';
import assert from 'node:assert/strict';

test('practice blocks paste and drop while allowing typing and deletion', async () => {
  const originalPerformance = globalThis.performance;
  let clock = 1000;
  globalThis.performance = { now:() => clock };
  const elements = new Map();
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.classList = { toggle() {} }; }
    append() {}
    focus() {}
    click() { this.dispatchEvent(new Event('click')); }
    setAttribute() {}
    querySelector() { return new Element(); }
    set innerHTML(value) {
      this.html = value;
      if (value.includes('id="typing"')) elements.set('typing', new Element());
      if (value.includes('id="article-text"')) elements.set('article-text', new Element());
      if (value.includes('id="article-translation"')) elements.set('article-translation', new Element());
      if (value.includes('id="word-text"')) elements.set('word-text', new Element());
      for (const id of ['next-action', 'retry-errors', 'replay-word', 'next-passage', 'review-text', 'save-selected-words', 'selection-message']) if (value.includes(`id="${id}"`)) elements.set(id, new Element());
    }
    get innerHTML() { return this.html; }
  }
  for (const id of ['lesson', 'language', 'exercise', 'result', 'word-mode', 'article-mode', 'restart', 'pause', 'category', 'progress', 'hint', 'passage-label', 'passage-mode', 'section-label', 'section-mode', 'source-info', 'import-form', 'import-title', 'import-text', 'import-translation', 'import-message', 'arxiv-form', 'arxiv-submit', 'arxiv-message', 'arxiv-url', 'word-picker', 'word-search', 'word-candidates', 'selected-words', 'picker-start', 'word-translation-retry', 'word-translation-status', 'live-time', 'live-wpm', 'live-accuracy', 'live-accuracy-label', 'live-progress', 'progress-bar', 'history-list', 'delete-lesson', 'nav-practice', 'nav-import', 'nav-history', 'view-practice', 'view-import', 'view-history', 'finish-now']) elements.set(id, new Element());
  for (const id of ['document-file', 'workbook-message', 'workspace-notice']) elements.set(id, new Element());
  elements.get('lesson').value = '0';
  elements.get('language').value = 'zh';
  elements.get('passage-mode').value = 'full';
  const saved = {};
  let failNotebookSave = false;
  let failProgressSave = false;
  globalThis.localStorage = { setItem(key, value) { if ((failNotebookSave && key === 'lingtype-notebook') || (failProgressSave && key === 'lingtype-progress')) throw new Error('storage full'); saved[key] = value; }, getItem(key) { return saved[key] ?? null; } };
  globalThis.document = { getElementById: id => elements.get(id), createElement: () => new Element(), createTextNode: text => text };
  await import('../site/app.mjs');
  elements.get('article-mode').dispatchEvent(new Event('click'));
  elements.get('finish-now').click();
  assert.equal(elements.get('result').hidden, false, 'an article can be stopped before typing');
  assert.match(elements.get('result').innerHTML, /data-pick="city"/);
  assert.equal(saved['lingtype-practice-history'], undefined, 'an empty attempt does not create a result');
  elements.get('restart').click();
  const typing = elements.get('typing');
  assert.match(elements.get('exercise').innerHTML, /class="typing-stage/);
  assert.match(elements.get('exercise').innerHTML, /class="typing-overlay/);
  // Only the current sentence and its translation are shown.
  assert.match(elements.get('article-text').innerHTML, /class="now">城市仍然安靜時/);
  assert.doesNotMatch(elements.get('article-text').innerHTML, /微風帶來雨的氣息/);
  typing.value = 'The city was still quiet when Mia opened her window.';
  typing.dispatchEvent(new Event('input'));
  assert.equal(typing.value, 'The city was still quiet when Mia opened her window.');
  assert.match(elements.get('article-text').innerHTML, /class="sep cursor"/);
  typing.value += ' ';
  typing.dispatchEvent(new Event('input'));
  assert.match(elements.get('article-text').innerHTML, /class="now">微風帶來雨的氣息/);
  assert.doesNotMatch(elements.get('article-text').innerHTML, /The city/);
  assert.match(typing.value, /window\. $/);
  typing.value = ''; typing.dispatchEvent(new Event('input'));
  for (const type of ['paste', 'drop']) {
    const event = new Event(type, { cancelable: true });
    typing.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, `${type} should be blocked`);
  }
  clock = 2000;
  typing.value = 'T';
  typing.dispatchEvent(new Event('input'));
  assert.equal(typing.value, 'T');
  assert.equal(elements.get('live-accuracy').textContent, '100%');
  assert.equal(elements.get('live-progress').textContent, '1%');
  // Simulate a throttled timer: the next input arrives after the idle deadline
  // before the interval callback had a chance to run.
  clock = 10000;
  typing.value = 'Th'; typing.dispatchEvent(new Event('input'));
  elements.get('pause').click();
  assert.equal(Object.values(JSON.parse(saved['lingtype-progress']))[0].elapsed, 1000);
  elements.get('pause').click();
  clock = 11000;
  typing.value = 'The'; typing.dispatchEvent(new Event('input'));
  elements.get('nav-import').click();
  assert.equal(typing.disabled, true);
  assert.equal(elements.get('view-import').hidden, false);
  elements.get('nav-practice').click();
  elements.get('pause').click();
  assert.equal(typing.disabled, false);
  typing.value = '';
  typing.dispatchEvent(new Event('input'));
  assert.equal(typing.value, '');
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(Object.values(JSON.parse(saved['lingtype-progress']))[0].input, '');
  let translateCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (url === '/api/translate') {
      translateCalls++;
      const data = JSON.parse(options.body);
      return { ok: true, json: async () => ({ translations: data.sentences.map(s => `翻譯 ${s}`) }) };
    }
    return { ok: true, json: async () => ({ title: 'Paper', authors: ['Author'], sourceUrl: 'https://arxiv.org/html/2610.32770v1', license: 'CC BY 4.0', sections: [{ title: 'Abstract', text: 'A research abstract.' }, { title: 'Introduction', text: 'An introduction.' }] }) };
  };
  elements.get('import-title').value = 'My lesson';
  elements.get('import-text').value = 'First sentence. Second sentence.';
  elements.get('import-form').dispatchEvent(new Event('submit', { cancelable: true }));
  assert.notEqual(elements.get('typing').disabled, true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('article-text').innerHTML.replace(/<[^>]+>/g, ''), /First sentence/);
  assert.match(elements.get('article-text').innerHTML, /翻譯 First sentence/);
  assert.equal(elements.get('article-translation').hidden, true);
  elements.get('typing').value = 'First sentence. Second sentence.';
  elements.get('typing').dispatchEvent(new Event('input'));
  assert.equal(elements.get('result').hidden, false, 'the completed article opens its result');
  assert.match(elements.get('result').innerHTML, /First/);
  assert.equal(JSON.parse(saved['lingtype-practice-history'])[0].partial, undefined);
  elements.get('restart').dispatchEvent(new Event('click'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(translateCalls, 1);
  assert.equal(elements.get('word-mode').disabled, true);
  const candidates = elements.get('word-candidates');
  candidates.type = 'checkbox'; candidates.value = 'sentence'; candidates.checked = true;
  candidates.dispatchEvent(new Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.get('word-mode').disabled, false);
  assert.equal(JSON.parse(saved['lingtype-custom-lessons'])[0].words[0][0], 'sentence');
  assert.equal(JSON.parse(saved['lingtype-notebook']).find(entry => entry.word === 'sentence').translations.zh, '翻譯 sentence');
  const retryButton = elements.get('word-translation-retry'), wordStatus = elements.get('word-translation-status');
  const workingFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  candidates.value = 'second'; candidates.checked = true; candidates.dispatchEvent(new Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(wordStatus.textContent, /翻譯.*無法/);
  assert.equal(retryButton.hidden, false);
  globalThis.fetch = workingFetch;
  retryButton.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(saved['lingtype-notebook']).find(entry => entry.word === 'second').translations.zh, '翻譯 second');
  assert.equal(retryButton.hidden, true);
  failNotebookSave = true;
  candidates.value = 'first'; candidates.checked = true; candidates.dispatchEvent(new Event('change'));
  assert.match(elements.get('hint').textContent, /無法儲存/);
  failNotebookSave = false;
  elements.get('picker-start').dispatchEvent(new Event('click'));
  assert.match(elements.get('exercise').innerHTML, /sentence/);
  assert.match(elements.get('exercise').innerHTML, /class="typing-stage/);
  for (const type of ['paste', 'drop']) {
    const event = new Event(type, { cancelable:true });
    elements.get('typing').dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, `word practice should block ${type}`);
  }
  for (const inputType of ['insertFromPaste', 'insertFromDrop']) {
    const event = new Event('beforeinput', { cancelable:true });
    Object.defineProperty(event, 'inputType', { value:inputType });
    elements.get('typing').dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, `word practice should block ${inputType}`);
  }
  elements.get('typing').value = 's'; elements.get('typing').dispatchEvent(new Event('input'));
  assert.match(elements.get('word-text').innerHTML, /class="correct"/);
  globalThis.confirm = () => true;
  elements.get('article-mode').dispatchEvent(new Event('click'));
  globalThis.confirm = () => false;
  candidates.checked = false; candidates.dispatchEvent(new Event('change'));
  assert.equal(candidates.checked, true);
  assert.equal(JSON.parse(saved['lingtype-custom-lessons'])[0].words[0][0], 'sentence');
  assert.ok(Object.keys(JSON.parse(saved['lingtype-progress'])).some(key => JSON.parse(key)[1] === 'word'));
  globalThis.confirm = () => true;
  const wordsBeforeFailedClear = JSON.parse(saved['lingtype-custom-lessons'])[0].words;
  failProgressSave = true;
  candidates.checked = false; candidates.dispatchEvent(new Event('change'));
  assert.equal(candidates.checked, true, 'a failed progress clear restores the checkbox');
  assert.deepEqual(JSON.parse(saved['lingtype-custom-lessons'])[0].words, wordsBeforeFailedClear);
  assert.match(elements.get('hint').textContent, /無法儲存/);
  failProgressSave = false;
  elements.get('arxiv-url').value = 'https://arxiv.org/html/2610.32770v1';
  elements.get('arxiv-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(saved['lingtype-custom-lessons']).map(item => item.title), ['My lesson', 'Paper']);
  assert.match(elements.get('arxiv-message').textContent, /2 個章節/);
  assert.equal(elements.get('section-label').hidden, false);
  elements.get('section-mode').value = '1';
  elements.get('section-mode').dispatchEvent(new Event('change'));
  assert.match(elements.get('article-text').innerHTML.replace(/<[^>]+>/g, ''), /^An introduction\./);
  const paperInput = elements.get('typing');
  paperInput.value = 'Ax'; paperInput.dispatchEvent(new Event('input'));
  elements.get('pause').dispatchEvent(new Event('click'));
  assert.equal(paperInput.disabled, true);
  assert.equal(elements.get('pause').textContent, '繼續練習');
  globalThis.confirm = () => false;
  assert.equal(elements.get('import-text').value, '', 'a saved import empties the form');
  elements.get('import-text').value = 'Another text.';
  elements.get('import-form').dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(elements.get('import-text').value, 'Another text.', 'a cancelled import keeps the text');
  assert.equal(elements.get('import-message').textContent, '已取消匯入。');
  assert.equal(JSON.parse(saved['lingtype-custom-lessons']).length, 2);
  elements.get('lesson').value = '0'; elements.get('lesson').dispatchEvent(new Event('change'));
  // Picking words created the notebook lesson, which sits before imported lessons, so the paper is ninth.
  assert.equal(elements.get('lesson').value, '9');
  elements.get('pause').dispatchEvent(new Event('click'));
  assert.equal(paperInput.disabled, false);
  globalThis.confirm = () => true;
  elements.get('lesson').value = '0'; elements.get('lesson').dispatchEvent(new Event('change'));
  elements.get('lesson').value = '9'; elements.get('lesson').dispatchEvent(new Event('change'));
  assert.equal(elements.get('section-mode').value, '1');
  assert.equal(elements.get('typing').value, 'Ax');
  elements.get('pause').dispatchEvent(new Event('click'));
  // Finishing a text moves straight on, so the result screen comes from stopping with the finish button.
  elements.get('typing').value = 'Ax introduction'; elements.get('typing').dispatchEvent(new Event('input'));
  elements.get('finish-now').click();
  assert.match(elements.get('result').innerHTML, /已停止/);
  assert.match(elements.get('result').innerHTML, /重練打錯過的字（1）/);
  elements.get('review-text').contains = () => true;
  globalThis.getSelection = () => ({anchorNode:{}, focusNode:{}, toString:() => 'introduction'});
  elements.get('save-selected-words').click();
  assert.equal(JSON.parse(saved['lingtype-custom-lessons'])[1].words[0][0], 'introduction');
  assert.match(elements.get('selection-message').textContent, /已加入/);
  failNotebookSave = true;
  globalThis.getSelection = () => ({anchorNode:{}, focusNode:{}, toString:() => 'an'});
  elements.get('save-selected-words').click();
  assert.match(elements.get('selection-message').textContent, /無法儲存/);
  assert.equal(JSON.parse(saved['lingtype-notebook']).some(entry => entry.word === 'an'), false);
  globalThis.getSelection = () => ({toString:() => ''});
  elements.get('result').dataset = {pick:'an'};
  elements.get('result').click();
  assert.match(elements.get('selection-message').textContent, /無法儲存/);
  failNotebookSave = false;
  elements.get('retry-errors').dispatchEvent(new Event('click'));
  assert.match(elements.get('exercise').innerHTML, />an</);
  globalThis.confirm = () => true;
  elements.get('restart').dispatchEvent(new Event('click'));
  assert.match(elements.get('exercise').innerHTML, />an</);
  elements.get('delete-lesson').dispatchEvent(new Event('click'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.get('lesson').value, '0');
  assert.match(elements.get('exercise').innerHTML, /gentle/);

  // A failed first batch must not prevent later sentence translations appearing in the reader.
  let batches = 0;
  globalThis.fetch = async (url, options) => {
    const sentences = JSON.parse(options.body).sentences;
    batches++;
    return batches === 1 ? {ok:false, json:async () => ({error:'temporary'})} :
      {ok:true, json:async () => ({translations:sentences.map(s => `譯文 ${s}`)})};
  };
  const parts = Array.from({length:9}, (_, i) => `Number ${i}.`);
  for (const id of ['translation-progress','translation-progress-text','translation-retry']) elements.set(id, new Element());
  elements.get('import-title').value = 'Batch recovery';
  elements.get('import-text').value = parts.join(' ');
  elements.get('import-form').dispatchEvent(new Event('submit', {cancelable:true}));
  await new Promise(resolve => setTimeout(resolve, 20));
  elements.get('typing').value = parts.slice(0, 8).join(' ') + ' ';
  elements.get('typing').dispatchEvent(new Event('input'));
  assert.match(elements.get('article-text').innerHTML, /譯文 Number 8/);
  elements.get('typing').value = '';
  elements.get('typing').dispatchEvent(new Event('input'));
  elements.get('translation-retry').onclick();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(elements.get('article-text').innerHTML, /譯文 Number 0/);
  const longSingleParagraph = 'A sentence without paragraph breaks. '.repeat(400);
  elements.get('import-title').value = 'Long single paragraph';
  elements.get('import-text').value = longSingleParagraph;
  elements.get('import-form').dispatchEvent(new Event('submit', {cancelable:true}));
  const imported = JSON.parse(saved['lingtype-custom-lessons']).find(item => item.title === 'Long single paragraph');
  assert.ok(imported.sections.length > 1);
  assert.equal(imported.sections.map(section => section.text).join(''), longSingleParagraph.trim());
  assert.ok(imported.sections.every(section => section.text.length <= 6000));
  const anchor = 'A figure anchor spanning the split';
  const paperText = 'z'.repeat(5990) + anchor + '\uE000' + 'z'.repeat(7000);
  globalThis.fetch = async url => url.startsWith('/api/import?')
    ? {ok:true, json:async () => ({title:'Long paper', sourceUrl:'https://arxiv.org/html/2610.32770v1', sections:[{title:'Abstract', text:paperText}], figures:[{kind:'figure', label:'Figure 1', anchor, images:['https://arxiv.org/html/2610.32770v1/fig.png']}], formulas:[{tex:'x'}]})}
    : {ok:true, json:async () => ({translations:[]})};
  elements.get('arxiv-url').value = 'https://arxiv.org/html/2610.32770v1';
  elements.get('arxiv-form').dispatchEvent(new Event('submit', {cancelable:true}));
  await new Promise(resolve => setTimeout(resolve, 20));
  const paper = JSON.parse(saved['lingtype-custom-lessons']).find(item => item.title === 'Long paper');
  assert.ok(paper.sections.length > 1);
  assert.equal(paper.sections.map(section => section.text).join(''), paperText);
  assert.ok(paper.sections.some(section => section.text.includes(anchor)));
  assert.equal(paper.figures[0].anchor, anchor);
  elements.get('typing').value = 'z'; elements.get('typing').dispatchEvent(new Event('input'));
  globalThis.fetch = async url => url.startsWith('/api/import?')
    ? {ok:true, json:async () => ({title:'Subtitles', sourceUrl:'https://www.youtube.com/watch?v=example', text:'Unique sentence.', sentenceTranslations:{zh:{'Unique sentence.':'字幕譯文'}}})}
    : {ok:true, json:async () => ({translations:[]})};
  globalThis.confirm = () => false;
  elements.get('arxiv-url').value = 'https://www.youtube.com/watch?v=example';
  elements.get('arxiv-form').dispatchEvent(new Event('submit', {cancelable:true}));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(JSON.parse(saved['lingtype-translations'] || '{}')['zh\u0000Unique sentence.'], undefined, 'cancelled import does not alter the translation cache');
  globalThis.confirm = () => true;
  elements.get('arxiv-form').dispatchEvent(new Event('submit', {cancelable:true}));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(JSON.parse(saved['lingtype-translations'])['zh\u0000Unique sentence.'], '字幕譯文');
  globalThis.fetch = async () => ({ok:false, json:async () => ({error:'PDF 超過 2000 頁', code:'pdf_page_limit'})});
  for (const [code, expected] of [['zh', /2,000 頁/], ['ja', /2,000 ページ/], ['ko', /2,000페이지/]]) {
    elements.get('language').value = code;
    const file = elements.get('document-file'); file.files = [{name:'long.pdf', size:100}];
    file.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(elements.get('workbook-message').textContent, expected);
  }
  globalThis.fetch = async () => ({ok:false, json:async () => ({error:'EPUB 章節遺失', code:'epub_spine_invalid'})});
  for (const [code, expected] of [['zh', /章節路徑無效或檔案遺失/], ['ja', /章のパスが無効/], ['ko', /장의 경로가 잘못/]]) {
    elements.get('language').value = code;
    const file = elements.get('document-file'); file.files = [{name:'broken.epub', size:100}];
    file.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(elements.get('workbook-message').textContent, expected);
  }
  elements.get('language').value = 'zh';
  globalThis.fetch = async url => url.startsWith('/api/extract?')
    ? {ok:true, json:async () => ({title:'PDF text only', text:'Text extracted from the PDF.', pages:[1]})}
    : {ok:true, json:async () => ({translations:[]})};
  const pdf = elements.get('document-file'); pdf.files = [{name:'sample.pdf', size:100}];
  pdf.dispatchEvent(new Event('change'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(JSON.parse(saved['lingtype-custom-lessons']).some(item => item.title === 'PDF text only'));
  assert.equal(elements.get('workspace-notice').hidden, false);
  assert.match(elements.get('workspace-notice').textContent, /無法儲存 PDF 原檔/);
  elements.get('typing').dispatchEvent(new Event('blur'));
  globalThis.performance = originalPerformance;
});
