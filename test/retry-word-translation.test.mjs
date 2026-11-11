import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotKey } from '../site/practice.mjs';

test('an unselected error-review word offers a retry after translation failure', async () => {
  const elements = new Map();
  const translation = {textContent:''};
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.classList = {toggle() {}}; }
    append() {}
    focus() {}
    setAttribute() {}
    click() { this.dispatchEvent(new Event('click')); }
    querySelector(selector) { return selector === '.translation' ? translation : new Element(); }
    set innerHTML(html) {
      this.html = html;
      for (const id of ['typing','typing-stage','article-text','article-translation','word-text','retry-current-translation']) if (html.includes(`id="${id}"`)) {
        const child = new Element(); if (id === 'retry-current-translation') child.hidden = true; elements.set(id, child);
      }
    }
    get innerHTML() { return this.html || ''; }
  }
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  const item = {id:'review-only', custom:true, title:'Example', text:'A difficult word.', words:[], translations:{}};
  const key = snapshotKey(item.id, 'word', 'all', 'full');
  const data = {
    'lingtype-custom-lessons':JSON.stringify([item]),
    'lingtype-last-practice':JSON.stringify({id:item.id,mode:'word',section:'all',passage:'full'}),
    'lingtype-progress':JSON.stringify({[key]:{input:'di',wordIndex:0,errors:1,elapsed:1000,articleText:item.text,wrongWords:['difficult'],retryWords:[['difficult','','','']]}}),
  };
  globalThis.localStorage = {getItem:key => data[key] ?? null, setItem(key,value) { data[key] = value; }};
  globalThis.document = {getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text};
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? {ok:false,json:async () => ({error:'offline'})} : {ok:true,json:async () => ({translations:['困難']})};
  await import('../site/app.mjs');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.get('retry-current-translation').hidden, false);
  assert.equal(translation.textContent, '');
  elements.get('retry-current-translation').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  assert.equal(translation.textContent, '困難');
  assert.equal(elements.get('retry-current-translation').hidden, true);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(JSON.parse(data['lingtype-progress'])[key].retryWords[0][1], '困難');
});
