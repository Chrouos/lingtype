import { test } from 'node:test';
import assert from 'node:assert/strict';

test('publishing creates a share link and public books can be added to the local library', async () => {
  const elements = new Map(), saved = {}, calls = [], id = 'a'.repeat(32);
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.dataset = {}; this.children = []; this.classList = { toggle() {}, add() {} }; }
    append(...children) { this.children.push(...children); }
    click() { this.dispatchEvent(new Event('click')); }
    setAttribute() {}
    focus() {}
    querySelector() { return new Element(); }
    set innerHTML(value) {
      this.html = value;
      for (const name of ['typing','article-text','article-translation','word-text','add-public-book','public-back','public-detail-message']) if (value.includes(`id="${name}"`)) elements.set(name, new Element());
    }
    get innerHTML() { return this.html || ''; }
  }
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson','workspace-notice','publish-workbook','nav-practice','nav-import','nav-history','nav-public','view-practice','view-import','view-history','view-public','public-books','public-detail','public-message'];
  for (const name of ids) elements.set(name, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full'; elements.get('lesson').value = '0';
  globalThis.document = { getElementById:name => elements.get(name), createElement:() => new Element(), createTextNode:text => text };
  globalThis.localStorage = { getItem:key => saved[key] ?? null, setItem(key,value) { saved[key] = value; } };
  globalThis.location = { href:'http://localhost:8765/', hash:'' };
  globalThis.history = { replaceState() {} };
  globalThis.confirm = () => true;
  const workbook = {format:'lingtype-workbook',version:1,lesson:{title:'Shared practice',text:'A gentle breeze.',words:[],translations:{}}};
  globalThis.fetch = async (url, options = {}) => {
    calls.push([url, options.method || 'GET']);
    if (options.method === 'POST' && url === '/api/workbooks') return {ok:true,json:async () => ({id,ownerKey:'owner-secret'})};
    if (url === '/api/workbooks') return {ok:true,json:async () => ({books:[{id,title:'Shared practice',createdAt:'2026-10-29T00:00:00Z'}]})};
    if (url === `/api/workbooks/${id}`) return {ok:true,json:async () => workbook};
    return {ok:false,json:async () => ({error:'offline'})};
  };
  await import('../site/app.mjs');
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(saved['lingtype-published-keys'])[id], 'owner-secret');
  assert.match(elements.get('workspace-notice').children[0].href, new RegExp(`#book-${id}$`));
  elements.get('nav-public').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-books').innerHTML, /Shared practice/);
  elements.get('public-books').dataset.bookId = id;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-detail').innerHTML, /A gentle breeze/);
  elements.get('add-public-book').click();
  assert.equal(JSON.parse(saved['lingtype-custom-lessons'])[0].title, 'Shared practice');
  assert.ok(calls.some(([url, method]) => url === '/api/workbooks' && method === 'POST'));
});
