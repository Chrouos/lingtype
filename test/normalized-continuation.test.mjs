import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessons } from '../site/data.mjs';

test('normalized imported text advances to the next paragraph or section, and ends with the book', async () => {
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
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  const item = {id:'curly', custom:true, title:'Curly', text:'First’s line.\n\nSecond’s line.', sections:[{title:'First',text:'First’s line.'},{title:'Second',text:'Second’s line.'}], words:[], translations:{}};
  const data = {'lingtype-custom-lessons':JSON.stringify([item]), 'lingtype-last-practice':JSON.stringify({id:'curly', mode:'article', section:'all', passage:'full'})};
  globalThis.localStorage = {getItem:key => data[key] ?? null, setItem(key, value) { data[key] = value; }};
  globalThis.document = {getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text};
  globalThis.fetch = async () => { throw new Error('offline'); };
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    await import('../site/app.mjs');
    let typing = elements.get('typing');
    typing.value = "First's line. Second's line.";
    typing.dispatchEvent(new Event('input'));
    assert.equal(elements.get('result').hidden, false);
    // Finishing a whole book returns to its page instead of starting another book.
    assert.match(elements.get('result').innerHTML, /讀完了，回到目錄/);
    const finishedBook = elements.get('lesson').value;
    elements.get('next-action').click();
    assert.equal(elements.get('lesson').value, finishedBook);

    elements.get('lesson').value = String(lessons.length - 1);
    elements.get('lesson').dispatchEvent(new Event('change'));
    elements.get('passage-mode').value = 'random';
    elements.get('passage-mode').dispatchEvent(new Event('change'));
    typing = elements.get('typing'); typing.value = "First's line."; typing.dispatchEvent(new Event('input'));
    assert.match(elements.get('result').innerHTML, /下一段/);
    elements.get('next-action').click();
    assert.match(elements.get('article-text').innerHTML.replace(/<[^>]+>/g, ''), /Second&#39;s line/);

    elements.get('passage-mode').value = 'full'; elements.get('passage-mode').dispatchEvent(new Event('change'));
    elements.get('section-mode').value = '0'; elements.get('section-mode').dispatchEvent(new Event('change'));
    typing = elements.get('typing'); typing.value = "First's line."; typing.dispatchEvent(new Event('input'));
    elements.get('next-action').click();
    assert.equal(elements.get('section-mode').value, '1');
    assert.match(elements.get('article-text').innerHTML.replace(/<[^>]+>/g, ''), /Second&#39;s line/);
  } finally { Math.random = originalRandom; }
});
