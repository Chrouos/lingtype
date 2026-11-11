import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessons } from '../site/data.mjs';

test('results report notebook and progress failures while still saving possible history', async () => {
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
      for (const id of ['typing','typing-stage','article-text','article-translation','word-text','resume-early','next-action','retry-errors']) if (html.includes(`id="${id}"`)) elements.set(id, new Element());
    }
    get innerHTML() { return this.html || ''; }
  }
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson','finish-now'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  const saved = {'lingtype-notebook':JSON.stringify([{word:'the', translations:{}, sentences:[], added:0, practiced:0, missed:0}])};
  let failNotebook = true, failProgress = false, failBest = false;
  globalThis.localStorage = {
    getItem:key => saved[key] ?? null,
    setItem(key, value) {
      if ((key === 'lingtype-notebook' && failNotebook) || (key === 'lingtype-progress' && failProgress) || (key === 'lingtype-best-results' && failBest)) throw new Error('storage failure');
      saved[key] = value;
    }
  };
  globalThis.document = {getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text};
  await import('../site/app.mjs');
  let typing = elements.get('typing');
  typing.value = 'The '; typing.dispatchEvent(new Event('input'));
  elements.get('finish-now').click();
  assert.match(elements.get('result').innerHTML, /無法儲存單字本複習紀錄/);
  assert.equal(JSON.parse(saved['lingtype-practice-history']).length, 1);
  assert.equal(JSON.parse(saved['lingtype-notebook'])[0].practiced, 0);

  failNotebook = false; failProgress = true;
  elements.get('resume-early').click();
  typing.value = 'The xity'; typing.dispatchEvent(new Event('input'));
  elements.get('finish-now').click();
  assert.match(elements.get('result').innerHTML, /無法儲存練習進度/);
  assert.equal(JSON.parse(saved['lingtype-notebook'])[0].practiced, 1);
  assert.equal(JSON.parse(saved['lingtype-practice-history']).length, 2);
  elements.get('retry-errors').click();
  assert.equal(elements.get('result').hidden, false, 'failed save keeps the unfinished result available');
  elements.get('next-action').click();
  assert.equal(elements.get('result').hidden, false, 'continuing also waits for the failed save');
  failProgress = false;
  elements.get('retry-errors').click();
  assert.equal(elements.get('result').hidden, true, 'retry starts once the unfinished progress can be saved');
  assert.equal(JSON.parse(saved['lingtype-progress'])[JSON.stringify(['morning','article','all','full'])].input, 'The xity');
  elements.get('article-mode').click();
  elements.get('pause').click();
  typing = elements.get('typing');

  failBest = true; failProgress = true;
  typing.value = lessons[0].text; typing.dispatchEvent(new Event('input'));
  assert.match(elements.get('result').innerHTML, /無法清除舊進度/);
  assert.match(elements.get('result').innerHTML, /結果可能未保存/);
  assert.equal(JSON.parse(saved['lingtype-practice-history']).length, 3, 'history is attempted even if best storage fails');
});
