import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { messages, languages, translate, pickLanguage } from '../site/i18n.mjs';

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('every interface string exists in each language with the same placeholders', () => {
  const keys = Object.keys(messages.zh);
  for (const language of languages) {
    assert.deepEqual(Object.keys(messages[language]).sort(), [...keys].sort(), `${language} keys`);
    for (const key of keys) {
      assert.ok(messages[language][key].trim(), `${language} ${key} is empty`);
      assert.deepEqual(placeholders(messages[language][key]), placeholders(messages.zh[key]), `${language} ${key} placeholders`);
    }
  }
});

test('keys used by the page and the app are all defined', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../site/app.mjs', import.meta.url), 'utf8');
  const used = [
    ...[...html.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g)].map(match => match[1]),
    ...[...app.matchAll(/\b(?:t|setHint|localError\([^,]+,)\s*\(?\s*'([a-z]+\.[A-Za-z.]+|[a-z]+)'/g)].map(match => match[1]),
    ...[...app.matchAll(/'((?:hint|result|metric|mode|action|picker|import|public|history|notice|confirm|alert|progress|word|article|typing|source|section|passage)\.[A-Za-z.]+)'/g)].map(match => match[1]),
  ];
  assert.ok(used.length > 80);
  for (const key of new Set(used)) assert.ok(key in messages.zh, `missing ${key}`);
});

test('translation fills placeholders and language choice falls back sensibly', () => {
  assert.equal(translate('ja', 'result.pickAdded', { n:3 }), '3 語を追加しました。');
  assert.equal(translate('ko', 'progress.sentence', { i:2, n:5 }), '2 / 5 문장');
  assert.equal(pickLanguage('ko', 'ja-JP'), 'ko');
  assert.equal(pickLanguage(null, 'ja-JP'), 'ja');
  assert.equal(pickLanguage('fr', 'en-US'), 'zh');
});
