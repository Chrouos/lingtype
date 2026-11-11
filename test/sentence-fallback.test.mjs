import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences } from '../site/data.mjs';
import { alignedTranslations } from '../site/sentences.mjs';

test('without Intl.Segmenter the app preserves text and aligns common CJK punctuation', async () => {
  const original = Intl.Segmenter;
  Intl.Segmenter = undefined;
  try {
    const text = 'He said "Hi." Next. \n\n3.14 is pi.😀';
    const parts = splitSentences(text);
    assert.equal(parts.join(''), text);
    assert.deepEqual(parts, ['He said "Hi." ', 'Next. \n\n', '3.14 is pi.😀']);
    assert.deepEqual(alignedTranslations(['One. ', 'Two.', 'Three.'], '第一句。第二句！「第三句？」', 'zh'), ['第一句。', '第二句！', '「第三句？」']);
    assert.equal(splitSentences('  Hello\n\nworld.  ').join(''), '  Hello\n\nworld.  ');

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
    const ids = ['lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson'];
    for (const id of ids) elements.set(id, new Element());
    elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full';
    globalThis.localStorage = {getItem:() => null, setItem() {}};
    globalThis.document = {getElementById:id => elements.get(id), createElement:() => new Element(), createTextNode:text => text};
    await import('../site/app.mjs');
    assert.ok(elements.get('typing'), 'the article practice input is rendered');
    assert.match(elements.get('article-text').innerHTML, /城市仍然安靜時/);
  } finally { Intl.Segmenter = original; }
});
