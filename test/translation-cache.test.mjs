import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationCache } from '../site/translation-cache.mjs';

test('overlapping translations share requests and reuse saved translations by language', async () => {
  const saved = {}, calls = [];
  const storage = { getItem:k => saved[k], setItem:(k, v) => { saved[k] = v; } };
  let release;
  const request = async (sentences, language) => { calls.push([sentences, language]); await new Promise(resolve => { release = resolve; }); return sentences.map(s => `譯 ${s}`); };
  const service = createTranslationCache(storage, request);
  const first = service.translate(['One.', 'Two.'], 'zh');
  const second = service.translate(['Two.'], 'zh');
  assert.equal(calls.length, 1);
  release();
  assert.deepEqual(await first, ['譯 One.', '譯 Two.']);
  assert.deepEqual(await second, ['譯 Two.']);
  const again = createTranslationCache(storage, () => { throw new Error('should use cache'); });
  assert.deepEqual(await again.translate(['Two.'], 'zh'), ['譯 Two.']);
});

test('failed or empty translations can be retried', async () => {
  let calls = 0;
  const service = createTranslationCache(null, async () => ++calls === 1 ? [''] : ['譯文']);
  assert.deepEqual(await service.translate(['Hello'], 'zh'), ['']);
  assert.deepEqual(await service.translate(['Hello'], 'zh'), ['譯文']);
});

test('prefetch prepares all sentences once in bounded batches', async () => {
  const calls = [];
  const service = createTranslationCache(null, async sentences => { calls.push(sentences); return sentences.map(s => `譯 ${s}`); });
  const sentences = Array.from({length:18}, (_, i) => `Sentence ${i}.`);
  assert.equal(await service.prefetch(sentences, 'zh'), true);
  assert.deepEqual(calls.map(batch => batch.length), [8, 8, 2]);
  assert.deepEqual(await service.translate(sentences, 'zh'), sentences.map(s => `譯 ${s}`));
  assert.equal(calls.length, 3);
});
