import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotKey } from '../site/practice.mjs';

test('backgrounding saves pending input immediately and excludes background time', async () => {
  const originalPerformance = globalThis.performance;
  let clock = 1000;
  globalThis.performance = {now:() => clock};
  const elements = new Map();
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.classList = {toggle() {}}; }
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
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  const saved = {};
  globalThis.localStorage = {getItem:key => saved[key] ?? null, setItem(key,value) { saved[key] = value; }};
  const document = new EventTarget();
  Object.assign(document, {visibilityState:'visible', getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text});
  globalThis.document = document;
  try {
    await import('../site/app.mjs');
    const typing = elements.get('typing');
    typing.value = 'T'; typing.dispatchEvent(new Event('input'));
    clock = 2000; typing.value = 'Th'; typing.dispatchEvent(new Event('input'));
    clock = 2500; document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(Object.values(JSON.parse(saved['lingtype-progress']))[0].input, 'Th');
    assert.equal(Object.values(JSON.parse(saved['lingtype-progress']))[0].elapsed, 1500);
    clock = 100000; document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    clock = 100001; typing.value = 'The'; typing.dispatchEvent(new Event('input'));
    clock = 101001; elements.get('pause').click();
    assert.equal(Object.values(JSON.parse(saved['lingtype-progress']))[0].elapsed, 2500);

    elements.get('word-mode').click();
    const wordInput = elements.get('typing');
    clock = 200000; wordInput.value = 'g'; wordInput.dispatchEvent(new Event('input'));
    clock = 200500; document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
    const word = JSON.parse(saved['lingtype-progress'])[snapshotKey('morning', 'word', 'all', 'full')];
    assert.equal(word.input, 'g');
    assert.equal(word.elapsed, 500);
  } finally { globalThis.performance = originalPerformance; }
});
