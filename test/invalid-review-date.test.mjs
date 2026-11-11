import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBackup } from '../site/backup.mjs';

test('an out-of-range review date in a backup does not break notebook navigation', async () => {
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
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson','notebook-list','notebook-count','notebook-due','notebook-review-note','nav-practice','nav-import','nav-history','nav-notebook','view-practice','view-import','view-history','view-notebook'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  const backup = {format:'lingtype-backup', version:1, data:{'lingtype-notebook':JSON.stringify([{word:'harbour',translations:{zh:'港口'},sentences:[],added:1,practiced:0,missed:0,reviewDue:8_640_000_000_000_001}])}};
  const data = readBackup(JSON.stringify(backup));
  globalThis.localStorage = {getItem:key => data[key] ?? null, setItem(key,value) { data[key] = value; }};
  globalThis.document = {getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text};
  await import('../site/app.mjs');
  elements.get('nav-notebook').click();
  assert.equal(elements.get('view-notebook').hidden, false);
  assert.match(elements.get('notebook-list').innerHTML, /待複習/);
});
