import { test } from 'node:test';
import assert from 'node:assert/strict';

test('publishing creates a share link and public books can be added to the local library', async () => {
  const elements = new Map(), saved = {}, calls = [], id = 'a'.repeat(32), other = 'b'.repeat(32);
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
  const ids = ['public-ranking','public-comments','lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson','workspace-notice','publish-workbook','nav-practice','nav-import','nav-history','nav-public','view-practice','view-import','view-history','view-public','public-books','public-detail','public-message'];
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
    if (url === '/api/workbooks') return {ok:true,json:async () => ({books:[{id,title:'Shared practice',createdAt:'2026-10-29T00:00:00Z'},{id:other,title:'Someone else <b>',createdAt:'2026-10-30T00:00:00Z',likes:3,reads:9,starts:4,completions:1,completionRate:25,category:'arxiv',words:300}],ranking:[{author:'Fast',wpm:61.4,accuracy:98,bookId:other,title:'Someone else <b>'}],comments:[]})};
    if (url === `/api/workbooks/${id}` || url === `/api/workbooks/${other}`) return {ok:true,json:async () => workbook};
    return {ok:false,json:async () => ({error:'offline'})};
  };
  await import('../site/app.mjs');
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(saved['lingtype-published-keys'])[id], 'owner-secret');
  assert.match(elements.get('workspace-notice').children[0].href, new RegExp(`#book-${id}$`));
  elements.get('nav-public').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const shelf = elements.get('public-books').innerHTML;
  assert.match(shelf, /Shared practice/);
  assert.ok(shelf.indexOf('Someone else') < shelf.indexOf('Shared practice'), 'the most liked book comes first');
  assert.match(shelf, /Someone else &lt;b&gt;/);
  assert.match(shelf, /9 人閱讀/);
  assert.match(shelf, /完成率 25%/);
  assert.match(shelf, /論文 · 約 10 分鐘/);
  assert.match(shelf, /還沒有人開始/);
  assert.match(elements.get('public-ranking').innerHTML, /Fast[\s\S]*61 WPM/);
  // The publisher already has the book: practising it opens their lesson rather than adding a copy.
  elements.get('public-books').dataset.bookId = id;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-detail').innerHTML, /A gentle breeze/);
  elements.get('add-public-book').click();
  assert.equal(saved['lingtype-custom-lessons'], undefined);
  // Someone else's book is added once, remembering where it came from.
  elements.get('public-books').dataset.bookId = other;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(calls.some(([url, method]) => url === `/api/workbooks/${other}/community/read` && method === 'POST'));
  elements.get('add-public-book').click();
  const added = JSON.parse(saved['lingtype-custom-lessons']);
  assert.equal(added.length, 1);
  assert.equal(added[0].title, 'Shared practice');
  assert.equal(added[0].publicId, other);
  assert.ok(calls.some(([url, method]) => url === '/api/workbooks' && method === 'POST'));
});
