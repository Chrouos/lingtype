import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotKey } from '../site/practice.mjs';

test('invalid error-review progress with no selected words falls back to the saved random passage', async () => {
  const elements = new Map();
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.classList = { toggle() {} }; }
    append() {}
    focus() {}
    setAttribute() {}
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
  const item = {id:'broken-review', custom:true, title:'My article', text:'A difficult word.\n\nAnother passage.', words:[], translations:{}};
  const wordKey = snapshotKey(item.id, 'word', 'all', 'random');
  const articleKey = snapshotKey(item.id, 'article', 'all', 'random', 'part:1');
  const data = {
    'lingtype-custom-lessons':JSON.stringify([item]),
    'lingtype-last-practice':JSON.stringify({id:item.id, mode:'word', section:'all', passage:'random'}),
    'lingtype-progress':JSON.stringify({
      [wordKey]:{input:'', wordIndex:1, retryWords:[['difficult','','','']]},
      [articleKey]:{input:'An', articleText:'Another passage.', articlePassageIndex:1, elapsed:4000},
    }),
  };
  globalThis.localStorage = {getItem:key => data[key] ?? null, setItem(key,value) { data[key] = value; }};
  globalThis.document = {getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text};
  globalThis.fetch = async () => { throw new Error('offline'); };
  await import('../site/app.mjs');
  assert.ok(elements.get('article-text'));
  assert.equal(elements.get('typing').value, 'An');
  assert.equal(elements.get('typing').disabled, true);
  assert.equal(elements.get('word-mode').disabled, true);
  assert.ok(JSON.parse(data['lingtype-progress'])[wordKey], 'invalid data is not silently deleted');
  elements.get('pause').dispatchEvent(new Event('click'));
  elements.get('typing').value = 'Ano';
  elements.get('typing').dispatchEvent(new Event('input'));
  elements.get('pause').dispatchEvent(new Event('click'));
  const progress = JSON.parse(data['lingtype-progress']);
  assert.equal(progress[articleKey].input, 'Ano');
  assert.equal(progress[snapshotKey(item.id, 'article', 'all', 'random')], undefined);
});
