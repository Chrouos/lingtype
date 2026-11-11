import { test } from 'node:test';
import assert from 'node:assert/strict';

test('deleting the last character after an idle pause clears only the active snapshot in both modes', async () => {
  const originalPerformance = globalThis.performance;
  let clock = 1000;
  globalThis.performance = { now:() => clock };
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
      for (const id of ['typing', 'typing-stage', 'article-text', 'article-translation', 'word-text', 'retry-errors']) if (html.includes(`id="${id}"`)) elements.set(id, new Element());
    }
    get innerHTML() { return this.html || ''; }
  }
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson','finish-now'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  const saved = {};
  globalThis.localStorage = { getItem:key => saved[key] ?? null, setItem(key, value) { saved[key] = value; } };
  globalThis.document = { getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text };
  try {
    await import('../site/app.mjs');
    const typing = elements.get('typing');
    typing.value = 'T'; typing.dispatchEvent(new Event('input'));
    clock = 9000;
    elements.get('pause').click();
    const snapshot = Object.values(JSON.parse(saved['lingtype-progress']))[0];
    assert.equal(snapshot.input, 'T');
    assert.equal(snapshot.elapsed, 0);
    elements.get('pause').click();
    typing.value = ''; typing.dispatchEvent(new Event('input'));
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.deepEqual(JSON.parse(saved['lingtype-progress']), {});

    const unrelated = JSON.stringify(['another', 'article', 'all', 'full']);
    saved['lingtype-progress'] = JSON.stringify({[unrelated]:{input:'kept'}});
    elements.get('word-mode').click();
    const wordInput = elements.get('typing');
    clock = 10000;
    wordInput.value = 'g'; wordInput.dispatchEvent(new Event('input'));
    clock = 18000; elements.get('pause').click();
    assert.equal(Object.values(JSON.parse(saved['lingtype-progress'])).find(value => value.input === 'g').elapsed, 0);
    elements.get('pause').click();
    wordInput.value = ''; wordInput.dispatchEvent(new Event('input'));
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.deepEqual(JSON.parse(saved['lingtype-progress']), {[unrelated]:{input:'kept'}});

    // Starting an error review and leaving it untouched must not erase the
    // existing unfinished word practice for the same scope.
    wordInput.value = 'x'; wordInput.dispatchEvent(new Event('input'));
    elements.get('finish-now').click();
    const previous = JSON.parse(saved['lingtype-progress']);
    elements.get('retry-errors').click();
    elements.get('article-mode').click();
    assert.deepEqual(JSON.parse(saved['lingtype-progress']), previous);
  } finally { globalThis.performance = originalPerformance; }
});
