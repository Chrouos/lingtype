import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestTranslation } from '../site/translation-request.mjs';
import { createTranslationCache } from '../site/translation-cache.mjs';

test('a stalled fetch times out, aborts, and can be retried', async () => {
  let signal, calls = 0;
  const fetcher = async (_url, options) => {
    signal = options.signal;
    if (++calls === 1) return new Promise(() => {});
    return {ok:true, json:async () => ({translations:['譯文']})};
  };
  const service = createTranslationCache(null, (sentences, language) => requestTranslation(sentences, language, {fetcher, timeoutMs:10}));
  assert.deepEqual(await service.translate(['Hello.'], 'zh'), ['']);
  assert.equal(signal.aborted, true);
  assert.deepEqual(await service.translate(['Hello.'], 'zh'), ['譯文']);
  assert.equal(calls, 2);
});

test('a stalled response body does not block later batches or overwrite manual edits', async () => {
  let release, calls = 0;
  const fetcher = async (_url, options) => {
    const {sentences} = JSON.parse(options.body);
    if (++calls === 1) return {ok:true, json:() => new Promise(resolve => { release = resolve; })};
    return {ok:true, json:async () => ({translations:sentences.map(sentence => `譯 ${sentence}`)})};
  };
  const service = createTranslationCache(null, (sentences, language) => requestTranslation(sentences, language, {fetcher, timeoutMs:10}));
  const sentences = Array.from({length:9}, (_, i) => `Sentence ${i}.`);
  assert.equal(await service.prefetch(sentences, 'zh'), false);
  assert.equal(calls, 2, 'the next batch continues after a stalled response');
  assert.equal(service.get(sentences[8], 'zh'), `譯 ${sentences[8]}`);
  assert.deepEqual(await service.translate([sentences[0]], 'zh'), [`譯 ${sentences[0]}`]);
  service.set(sentences[0], 'zh', '手動譯文');
  release({translations:Array(8).fill('過期譯文')});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(service.get(sentences[0], 'zh'), '手動譯文');
});
