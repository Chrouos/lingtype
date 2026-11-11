import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the app opens for practice when localStorage access throws', async () => {
  const elements = new Map();
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.attributes = {}; this.classList = { toggle() {} }; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append() {}
    focus() {}
    querySelector() { return new Element(); }
    set innerHTML(html) {
      this.html = html;
      for (const id of ['typing', 'typing-stage', 'article-text', 'article-translation', 'word-text']) if (html.includes(`id="${id}"`)) elements.set(id, new Element());
    }
    get innerHTML() { return this.html || ''; }
  }
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson','workspace-notice','publish-workbook'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
  globalThis.document = { getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text };
  let publicationRequests = 0;
  globalThis.fetch = async (url, options) => { if (url === '/api/workbooks' && options?.method === 'POST') publicationRequests++; throw new Error('offline'); };
  globalThis.confirm = () => true;
  try {
    await import('../site/app.mjs');
    assert.ok(elements.get('typing'), 'the practice input is rendered');
    assert.equal(elements.get('workspace-notice').hidden, false);
    assert.match(elements.get('workspace-notice').textContent, /儲存/);
    elements.get('publish-workbook').dispatchEvent(new Event('click'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(publicationRequests, 0, 'volatile storage cannot protect the unpublish key');
  } finally { delete globalThis.localStorage; }
});
