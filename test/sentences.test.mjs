import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceAt, advanceSentenceInput, alignedTranslations, passageTranslations, separatorPositions, MISSED } from '../site/sentences.mjs';
import { articleResult, liveArticleStats } from '../site/typing.mjs';

test('the space after a sentence is typed, and one space covers a paragraph break', () => {
  const sentences = ['The city was quiet. ', 'A gentle breeze.\n\n', 'Rain fell.'];
  const done = advanceSentenceInput(sentences, 'The city was quie', 'The city was quiet.');
  assert.equal(done, 'The city was quiet.');
  assert.equal(sentenceAt(sentences, done.length).text, 'The city was quiet.');
  const spaced = advanceSentenceInput(sentences, done, done + ' ');
  assert.equal(spaced, 'The city was quiet. ');
  assert.equal(sentenceAt(sentences, spaced.length).text, 'A gentle breeze.');
  const paragraph = advanceSentenceInput(sentences, spaced + 'A gentle breeze.', spaced + 'A gentle breeze. ');
  assert.equal(paragraph, 'The city was quiet. A gentle breeze.\n\n');
  assert.equal(advanceSentenceInput(sentences, paragraph, paragraph.slice(0, -1)), 'The city was quiet. A gentle breeze.');
});

test('a skipped space counts as one mistake without shifting the rest', () => {
  const sentences = ['Hi. ', 'Bye.'];
  const typed = advanceSentenceInput(sentences, 'Hi.', 'Hi.B');
  assert.equal(typed, `Hi.${MISSED}B`);
  const ignored = separatorPositions(sentences);
  assert.equal(liveArticleStats('Hi. Bye.', typed, 60000, ignored).accuracy, 80);
  assert.equal(articleResult('Hi. Bye.', 'Hi. Bye.', 60000, ignored).accuracy, 100);
});

test('translations align by sentence only when the counts match', () => {
  const sentences = ['First. ', 'Second.'];
  assert.deepEqual(alignedTranslations(sentences, '第一句。第二句。', 'zh'), ['第一句。', '第二句。']);
  assert.equal(alignedTranslations(sentences, '只有一句。', 'zh'), null);
});

test('a selected passage uses its own corresponding translation', () => {
  const full = ['First. ', 'Second.'];
  assert.deepEqual(passageTranslations(full, ['Second.'], '第一句。第二句。', 'zh'), ['第二句。']);
  assert.equal(passageTranslations(['Same. ', 'Same.'], ['Same.'], '一。二。', 'zh'), null);
});

test('a long separator counts as a single typed character', () => {
  const sentences = ['Hi.\n\n', 'Bye.'];
  const ignored = separatorPositions(sentences);
  assert.deepEqual([...ignored], [4]);
  assert.equal(articleResult('Hi.\n\nBye.', 'Hi.\n\nBye.', 60000, ignored).wpm, 1.6);
});

test('typographic punctuation becomes what a keyboard types', async () => {
  const { typeable } = await import('../site/sentences.mjs');
  assert.equal(typeable('\u201cDon\u2019t stop\u2014ever\u2026\u201d she said\u00a0softly.'), '"Don\'t stop-ever..." she said softly.');
  assert.equal(typeable('plain text'), 'plain text');
});
