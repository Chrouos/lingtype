import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationCache } from '../site/translation-cache.mjs';

test('manual sentence translation survives a pending machine translation and storage reload', async () => {
  const saved = {}, storage = {getItem:k => saved[k], setItem:(k,v) => { saved[k]=v; }};
  let release;
  const service = createTranslationCache(storage, async () => { await new Promise(resolve => { release=resolve; }); return ['machine']; });
  const pending = service.translate(['Hello.'], 'zh');
  service.set('Hello.', 'zh', 'manual');
  release();
  assert.deepEqual(await pending, ['manual']);
  assert.equal(createTranslationCache(storage, () => []).get('Hello.', 'zh'), 'manual');
});

test('a manually confirmed unchanged sentence remains usable', () => {
  const saved = {}, storage = {getItem:k => saved[k], setItem:(k,v) => {saved[k]=v;}};
  createTranslationCache(storage, () => []).set('Paris.', 'zh', 'Paris.');
  assert.equal(createTranslationCache(storage, () => []).get('Paris.', 'zh'), 'Paris.');
});

test('damaged translation cache does not prevent translations from loading', async () => {
  const storage = {getItem:() => 'null', setItem() {}};
  const service = createTranslationCache(storage, async sentences => sentences.map(s => `translated ${s}`));
  assert.deepEqual(await service.translate(['Hello.'], 'zh'), ['translated Hello.']);
});

test('a sentence over the server limit does not prevent valid sentences in its batch from being translated', async () => {
  const calls = [];
  const service = createTranslationCache(null, async sentences => {
    calls.push(sentences);
    if (sentences.some(sentence => sentence.length > 15000)) throw new Error('server rejected batch');
    return sentences.map(sentence => `translated ${sentence}`);
  });
  const long = 'x'.repeat(15001);
  assert.deepEqual(await service.translate([long, 'Valid.'], 'zh'), ['', 'translated Valid.']);
  assert.deepEqual(calls, [['Valid.']]);
});

test('prefetch continues after failures and retries only missing sentences', async () => {
  const calls = [];
  const service = createTranslationCache(null, async sentences => {
    calls.push(sentences);
    return sentences.map(s => s === 'S0' && calls.length === 1 ? '' : `translated ${s}`);
  });
  const sentences = Array.from({length:17}, (_, i) => `S${i}`);
  const progress = [];
  assert.equal(await service.prefetch(sentences, 'zh', state => progress.push(state)), false);
  assert.deepEqual(calls.map(batch => batch.length), [8, 8, 1]);
  assert.deepEqual(progress.at(-1), { done:17, total:17, failed:1 });
  assert.equal(await service.prefetch(sentences, 'zh'), true);
  assert.deepEqual(calls.at(-1), ['S0']);
});

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
