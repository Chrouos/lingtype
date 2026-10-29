import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbook, readWorkbook, selectedArticleWords } from '../site/workbook.mjs';
import { readBuiltinWords, saveBuiltinWords } from '../site/library.mjs';

test('workbook preserves a lesson and chosen word translations without exposing local ids', () => {
  const lesson = { id:'private-id', title:'Practice', text:'A gentle breeze.', translations:{zh:'溫柔的微風。'}, words:[['gentle','溫和的','','']], sections:[{title:'One',text:'A gentle breeze.'}] };
  const file = createWorkbook(lesson);
  assert.equal(file.version, 1);
  assert.equal(file.lesson.id, undefined);
  const restored = readWorkbook(JSON.stringify(file));
  assert.equal(restored.text, lesson.text);
  assert.deepEqual(restored.words, lesson.words);
  assert.equal(restored.sections[0].title, 'One');
});

test('invalid or oversized workbook content is rejected', () => {
  assert.throws(() => readWorkbook('{invalid'), /練習冊/);
  assert.throws(() => readWorkbook(JSON.stringify({format:'lingtype-workbook', version:1, lesson:{title:'x',text:' ',words:[]}})), /文章/);
  assert.throws(() => readWorkbook('x'.repeat(2_000_001)), /過大/);
});

test('selected words must occur in the practiced passage and are deduplicated', () => {
  assert.deepEqual(selectedArticleWords('A gentle breeze and gentle rain.', 'gentle breeze GENTLE ghost'), ['gentle','breeze']);
});

test('words selected for built-in lessons persist separately by lesson', () => {
  const storage = { data:{}, getItem(k) { return this.data[k] ?? null; }, setItem(k,v) { this.data[k] = v; } };
  saveBuiltinWords(storage, 'one', [['breeze','微風','','']]);
  saveBuiltinWords(storage, 'two', [['rain','雨','','']]);
  assert.deepEqual(readBuiltinWords(storage, 'one'), [['breeze','微風','','']]);
  assert.equal(readBuiltinWords(storage, 'missing'), null);
});
