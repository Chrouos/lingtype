import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articleWords, suggestWords, searchWords } from '../site/vocabulary.mjs';
import { readCustomLessons, addCustomLesson } from '../site/library.mjs';

test('article words are unique case-insensitively and preserve contractions', () => {
  assert.deepEqual(articleWords("The garden, garden! Don't stop."), ['the', 'garden', "don't", 'stop']);
});

test('suggestions exclude common words, stay bounded and search finds other article words', () => {
  const text = `the and ${Array.from({length: 25}, (_, i) => `unusual${String.fromCharCode(97+i)}`).join(' ')}`;
  assert.equal(suggestWords(text).length, 20);
  assert.ok(!suggestWords(text).includes('the'));
  assert.deepEqual(searchWords(text, 'unusualy'), ['unusualy']);
});

test('legacy custom lesson migrates and new imports do not replace it', () => {
  const legacy = { id:'custom', custom:true, title:'Old', text:'Old article', words:[] };
  const storage = { values: { 'lingtype-custom-lesson': JSON.stringify(legacy) }, getItem(k) { return this.values[k] ?? null; }, setItem(k,v) { this.values[k] = v; } };
  const existing = readCustomLessons(storage);
  const updated = addCustomLesson(existing, { id:'new', custom:true, title:'New', text:'New article', words:[] });
  assert.deepEqual(updated.map(item => item.title), ['Old', 'New']);
  assert.equal(existing.length, 1);
});
