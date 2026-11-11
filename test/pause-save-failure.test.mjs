import { test } from 'node:test';
import assert from 'node:assert/strict';

test('pausing reports a failed progress save and can retry on the next pause', async () => {
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
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson','notebook-words','choose-lesson','preview-start','preview-back','preview-lesson','lesson-preview','lesson-chooser','practice-content'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  const saved = {'lingtype-notebook':JSON.stringify([{word:'harbour',translations:{},sentences:[],added:1,practiced:0,missed:0}])}; let failProgress = true, failRead = false;
  globalThis.localStorage = {getItem(key) { if (key === 'lingtype-progress' && failRead) throw new Error('read failed'); return saved[key] ?? null; }, setItem(key,value) { if (key === 'lingtype-progress' && failProgress) throw new Error('quota'); saved[key] = value; }};
  globalThis.document = {getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text};
  await import('../site/app.mjs');
  elements.get('preview-start').click();
  let typing = elements.get('typing'); typing.value = 'T'; typing.dispatchEvent(new Event('input'));
  elements.get('restart').click();
  typing = elements.get('typing');
  assert.equal(typing.value, '', 'restart is possible when no snapshot exists');
  typing.value = 'T'; typing.dispatchEvent(new Event('input'));
  elements.get('pause').click();
  assert.equal(typing.disabled, true);
  assert.equal(typing.value, 'T');
  assert.match(elements.get('hint').textContent, /無法儲存/);
  const key = JSON.stringify(['morning', 'article', 'all', 'full']);
  saved['lingtype-progress'] = JSON.stringify({[key]:{input:'T'}});
  elements.get('restart').click();
  assert.equal(elements.get('typing'), typing, 'failed snapshot removal keeps the current practice');
  assert.equal(typing.value, 'T');
  assert.equal(JSON.parse(saved['lingtype-progress'])[key].input, 'T');
  assert.match(elements.get('hint').textContent, /無法儲存/);
  elements.get('word-mode').click();
  assert.equal(elements.get('typing'), typing, 'mode change keeps the unsaved input');
  elements.get('lesson').value = '1'; elements.get('lesson').dispatchEvent(new Event('change'));
  assert.equal(elements.get('lesson').value, '0', 'failed lesson switch restores the selection');
  elements.get('passage-mode').value = 'random'; elements.get('passage-mode').dispatchEvent(new Event('change'));
  assert.equal(elements.get('passage-mode').value, 'full');
  elements.get('section-mode').value = '1'; elements.get('section-mode').dispatchEvent(new Event('change'));
  assert.equal(elements.get('section-mode').value, 'all');
  elements.get('notebook-words').click();
  assert.equal(elements.get('lesson').value, '0', 'notebook practice does not replace unsaved input');
  elements.get('choose-lesson').click();
  assert.equal(elements.get('lesson-chooser').hidden, true, 'preview does not open when saving fails');
  assert.equal(typing.value, 'T');
  assert.match(elements.get('hint').textContent, /無法儲存/);
  failRead = true;
  elements.get('restart').click();
  assert.equal(elements.get('typing'), typing, 'failed read cannot be mistaken for an absent snapshot');
  assert.equal(typing.value, 'T');
  failRead = false;
  failProgress = false;
  elements.get('pause').click();
  elements.get('pause').click();
  assert.equal(Object.values(JSON.parse(saved['lingtype-progress']))[0].input, 'T');
  assert.match(elements.get('hint').textContent, /暫停/);
});
