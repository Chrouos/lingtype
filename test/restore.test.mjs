import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveSnapshot, snapshotKey } from '../site/practice.mjs';

test('reload restores an unfinished error review even when the lesson has no selected words', async () => {
  const elements = new Map();
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.classList = { toggle() {} }; }
    append() {}
    focus() {}
    querySelector() { return new Element(); }
    set innerHTML(html) {
      this.html = html;
      for (const id of ['typing', 'typing-stage', 'article-text', 'article-translation', 'word-text']) if (html.includes(`id="${id}"`)) elements.set(id, new Element());
      const value = html.match(/id="typing"[^>]*value="([^"]*)"/);
      if (value) elements.get('typing').value = value[1];
    }
    get innerHTML() { return this.html || ''; }
  }
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  const storage = { data:{}, getItem(k) { return this.data[k] ?? null; }, setItem(k,v) { this.data[k] = v; } };
  const item = { id:'custom-restore', custom:true, title:'My text', category:'我的教材', text:'A difficult word.', translations:{zh:'',ja:'',ko:''}, words:[] };
  storage.setItem('lingtype-custom-lessons', JSON.stringify([item]));
  storage.setItem('lingtype-last-practice', JSON.stringify({ id:item.id, mode:'word', section:'all', passage:'full' }));
  saveSnapshot(storage, snapshotKey(item.id, 'word', 'all', 'full'), { input:'di', wordIndex:0, errors:1, elapsed:4000, articleText:item.text, wrongWords:['difficult'], retryWords:[['difficult','','','']] });
  globalThis.localStorage = storage;
  globalThis.document = { getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text };
  globalThis.fetch = async () => { throw new Error('offline'); };
  globalThis.confirm = () => true;
  await import('../site/app.mjs');
  assert.match(elements.get('exercise').innerHTML, />difficult</);
  assert.equal(elements.get('typing').value, 'di');
  assert.equal(elements.get('typing').disabled, true);
  elements.get('typing-stage').dispatchEvent(new Event('click'));
  assert.equal(elements.get('typing').disabled, false);
  elements.get('restart').dispatchEvent(new Event('click'));
  assert.match(elements.get('exercise').innerHTML, />difficult</);
  assert.equal(elements.get('typing').value, '');
});
