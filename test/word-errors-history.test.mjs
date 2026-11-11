import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a word attempt with only mistakes is recorded, but an untouched attempt is not', async () => {
  const elements = new Map();
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.classList = { toggle() {} }; }
    append() {}
    focus() {}
    setAttribute() {}
    click() { this.dispatchEvent(new Event('click')); }
    querySelector() { return new Element(); }
    set innerHTML(html) {
      this.html = html;
      for (const id of ['typing','typing-stage','article-text','article-translation','word-text']) if (html.includes(`id="${id}"`)) elements.set(id, new Element());
    }
    get innerHTML() { return this.html || ''; }
  }
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson','finish-now'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  const saved = {};
  globalThis.localStorage = { getItem:key => saved[key] ?? null, setItem(key, value) { saved[key] = value; } };
  globalThis.document = { getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text };
  await import('../site/app.mjs');
  elements.get('word-mode').click();
  elements.get('finish-now').click();
  assert.equal(saved['lingtype-practice-history'], undefined);
  elements.get('restart').click();
  const input = elements.get('typing'); input.value = 'x'; input.dispatchEvent(new Event('input'));
  assert.equal(input.value, '');
  elements.get('finish-now').click();
  const history = JSON.parse(saved['lingtype-practice-history']);
  assert.equal(history.length, 1);
  assert.equal(history[0].mode, 'word');
  assert.equal(history[0].partial, true);
  assert.equal(history[0].errors, 1);
});
