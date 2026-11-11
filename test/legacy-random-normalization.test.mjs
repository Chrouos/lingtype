import { test } from 'node:test';
import assert from 'node:assert/strict';

test('legacy random passage normalizes typographic punctuation before matching', async () => {
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
      for (const id of ['typing', 'typing-stage', 'article-text', 'article-translation', 'word-text', 'next-action']) if (html.includes(`id="${id}"`)) elements.set(id, new Element());
    }
    get innerHTML() { return this.html || ''; }
  }
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'random';
  const item = {id:'duplicate', custom:true, title:'Duplicate', text:'He said “hello”.\n\nNext.', words:[], translations:{}};
  const key = JSON.stringify(['duplicate','article','all','random']);
  const data = {
    'lingtype-custom-lessons':JSON.stringify([item]),
    'lingtype-last-practice':JSON.stringify({id:'duplicate', mode:'article', section:'all', passage:'random'}),
    'lingtype-progress':JSON.stringify({[key]:{input:'He said “he', articleText:'He said “hello”.', articlePassageIndex:0, elapsed:1000}}),
  };
  globalThis.localStorage = {getItem:key => data[key] ?? null, setItem(key, value) { data[key] = value; }};
  globalThis.document = {getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text};
  globalThis.fetch = async () => { throw new Error('offline'); };
  await import('../site/app.mjs');
  assert.equal(elements.get('typing').value, 'He said "he');
  elements.get('pause').click();
  elements.get('typing').value = 'He said \"hello\".';
  elements.get('typing').dispatchEvent(new Event('input'));
  // A finished passage of a book reads straight on to the next one.
  assert.match(elements.get('article-text').innerHTML.replace(/<[^>]+>/g, ''), /Next\./);
  elements.get('typing').value = 'N'; elements.get('typing').dispatchEvent(new Event('input'));
  elements.get('pause').click();
  assert.equal(JSON.parse(data['lingtype-progress'])[JSON.stringify(['duplicate','article','all','random','part:1'])].articlePassageIndex, 1);
});
