import { test } from 'node:test';
import assert from 'node:assert/strict';

test('article input blocks paste and drop while allowing typing and deletion', async () => {
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
  for (const id of ['lesson', 'language', 'exercise', 'result', 'word-mode', 'article-mode', 'restart', 'pause', 'category', 'progress', 'hint', 'passage-label', 'passage-mode', 'section-label', 'section-mode', 'source-info', 'import-form', 'import-title', 'import-text', 'import-translation', 'import-message', 'arxiv-form', 'arxiv-submit', 'arxiv-message', 'arxiv-url', 'word-picker', 'word-search', 'word-candidates', 'selected-words', 'picker-start', 'live-time', 'live-wpm', 'live-accuracy', 'live-accuracy-label', 'live-progress', 'progress-bar', 'history-list', 'delete-lesson', 'nav-practice', 'nav-import', 'nav-history', 'view-practice', 'view-import', 'view-history', 'finish-now']) elements.set(id, new Element());
  elements.get('lesson').value = '0';
  elements.get('language').value = 'zh';
  elements.get('passage-mode').value = 'full';
  const saved = {};
  globalThis.localStorage = { setItem(key, value) { saved[key] = value; }, getItem(key) { return saved[key] ?? null; } };
  globalThis.document = { getElementById: id => elements.get(id), createElement: () => new Element(), createTextNode: text => text };
  await import('../site/app.mjs');
  elements.get('article-mode').dispatchEvent(new Event('click'));
  const typing = elements.get('typing');
  assert.match(elements.get('exercise').innerHTML, /class="typing-stage/);
  assert.match(elements.get('exercise').innerHTML, /class="typing-overlay/);
  // Every paragraph shows its translation; the current sentence's translation is highlighted.
  assert.match(elements.get('article-text').innerHTML, /class="now">城市仍然安靜時/);
  assert.match(elements.get('article-text').innerHTML, /微風帶來雨的氣息/);
  assert.doesNotMatch(elements.get('article-text').innerHTML, /class="now">微風/);
  typing.value = 'The city was still quiet when Mia opened her window.';
  typing.dispatchEvent(new Event('input'));
  assert.equal(typing.value, 'The city was still quiet when Mia opened her window.');
  assert.match(elements.get('article-text').innerHTML, /class="sep cursor"/);
  typing.value += ' ';
  typing.dispatchEvent(new Event('input'));
  assert.match(elements.get('article-text').innerHTML, /class="now">微風帶來雨的氣息/);
  assert.match(elements.get('article-text').innerHTML, /class="s done-sentence">The city/);
  assert.match(typing.value, /window\. $/);
  typing.value = ''; typing.dispatchEvent(new Event('input'));
  for (const type of ['paste', 'drop']) {
    const event = new Event(type, { cancelable: true });
    typing.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, `${type} should be blocked`);
  }
  typing.value = 'T';
  typing.dispatchEvent(new Event('input'));
  assert.equal(typing.value, 'T');
  assert.equal(elements.get('live-accuracy').textContent, '100%');
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
  elements.get('picker-start').dispatchEvent(new Event('click'));
  assert.match(elements.get('exercise').innerHTML, /sentence/);
  assert.match(elements.get('exercise').innerHTML, /class="typing-stage/);
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
  // Finishing a text moves straight on, so the result screen comes from stopping with the finish button.
  paperInput.value = 'Ax introduction'; paperInput.dispatchEvent(new Event('input'));
  elements.get('finish-now').click();
  assert.match(elements.get('result').innerHTML, /已停止/);
  assert.match(elements.get('result').innerHTML, /重練打錯過的字（1）/);
  elements.get('review-text').contains = () => true;
  globalThis.getSelection = () => ({anchorNode:{}, focusNode:{}, toString:() => 'introduction'});
  elements.get('save-selected-words').click();
  assert.equal(JSON.parse(saved['lingtype-custom-lessons'])[1].words[0][0], 'introduction');
  assert.match(elements.get('selection-message').textContent, /已加入/);
  elements.get('retry-errors').dispatchEvent(new Event('click'));
  assert.match(elements.get('exercise').innerHTML, />an</);
  globalThis.confirm = () => true;
  elements.get('restart').dispatchEvent(new Event('click'));
  assert.match(elements.get('exercise').innerHTML, />an</);
  elements.get('delete-lesson').dispatchEvent(new Event('click'));
  assert.equal(elements.get('lesson').value, '0');
  assert.match(elements.get('exercise').innerHTML, /gentle/);
});
