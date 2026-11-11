import { test } from 'node:test';
import assert from 'node:assert/strict';

test('an older word request cannot overwrite a reselected word’s newer translation', async () => {
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
  const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson'];
  for (const id of ids) elements.set(id, new Element());
  elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
  const item = {id:'custom-race', custom:true, title:'Example', text:'A harbour.', words:[], translations:{}};
  const data = {'lingtype-custom-lessons':JSON.stringify([item]), 'lingtype-last-practice':JSON.stringify({id:item.id,mode:'article',section:'all',passage:'full'})};
  globalThis.localStorage = {getItem:key => data[key] ?? null, setItem(key,value) { data[key] = value; }};
  globalThis.document = {getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text};
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const {sentences} = JSON.parse(options.body);
    if (sentences[0] === 'harbour') return new Promise(resolve => requests.push(text => resolve({ok:true, json:async () => ({translations:[text]})})));
    return {ok:true, json:async () => ({translations:sentences.map(() => '')})};
  };
  globalThis.confirm = () => true;
  await import('../site/app.mjs');
  const checkbox = elements.get('word-candidates'); checkbox.type = 'checkbox'; checkbox.value = 'harbour';
  const change = checked => { checkbox.checked = checked; checkbox.dispatchEvent(new Event('change')); };
  change(true); change(false); change(true);
  assert.equal(requests.length, 2);
  requests[1]('新譯文');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(data['lingtype-custom-lessons'])[0].words[0][1], '新譯文');
  requests[0]('舊譯文');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(data['lingtype-custom-lessons'])[0].words[0][1], '新譯文');
  assert.equal(JSON.parse(data['lingtype-notebook'])[0].translations.zh, '新譯文');
});
