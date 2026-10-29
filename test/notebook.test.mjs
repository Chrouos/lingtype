import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNotebook, saveNotebook, sentenceWith, addWord, removeWord, recordPractice, practiceOrder, notebookLesson } from '../site/notebook.mjs';

const text = 'Boats returned before dusk. The harbour lights flickered across the water. Harbours are busy places.';

test('a word keeps the sentence it was met in, once per sentence and at most three', () => {
  assert.equal(sentenceWith(text, 'harbour'), 'The harbour lights flickered across the water.');
  assert.equal(sentenceWith(text, 'dusk'), 'Boats returned before dusk.');
  assert.equal(sentenceWith('It isn’t here.', "isn't"), 'It isn’t here.');
  assert.equal(sentenceWith(text, 'missing'), '');
  let entries = addWord([], { word:'Harbour', sentence:'The harbour lights flickered across the water.', source:'Notes', translations:{ zh:'港口', ja:'' } }, 1);
  entries = addWord(entries, { word:'harbour', sentence:'The harbour lights flickered across the water.', source:'Notes' }, 2);
  assert.deepEqual(entries, [{ word:'harbour', translations:{ zh:'港口' }, sentences:[{ text:'The harbour lights flickered across the water.', source:'Notes' }], added:1, practiced:0, missed:0 }]);
  for (const sentence of ['One harbour.', 'Two harbour.', 'Three harbour.']) entries = addWord(entries, { word:'harbour', sentence, source:'Other', translations:{ zh:'不覆蓋' } });
  assert.deepEqual(entries[0].sentences.map(item => item.text), ['One harbour.', 'Two harbour.', 'Three harbour.']);
  assert.equal(entries[0].translations.zh, '港口');
  assert.deepEqual(removeWord(entries, 'HARBOUR'), []);
});

test('practice puts the most missed words first and the notebook becomes a lesson', () => {
  let entries = [];
  entries = addWord(entries, { word:'dusk', sentence:'Boats returned before dusk.' }, 1);
  entries = addWord(entries, { word:'harbour', sentence:'The harbour lights flickered across the water.', translations:{ ko:'항구' } }, 2);
  entries = addWord(entries, { word:'water', sentence:'The harbour lights flickered across the water.' }, 3);
  entries = recordPractice(entries, new Set(['dusk', 'harbour', 'water']), new Set(['water']), 9);
  assert.deepEqual(entries.map(entry => [entry.word, entry.practiced, entry.missed]), [['dusk', 1, 0], ['harbour', 1, 0], ['water', 1, 1]]);
  assert.deepEqual(practiceOrder(entries).map(entry => entry.word), ['water', 'dusk', 'harbour']);
  const lesson = notebookLesson(entries, 'My notebook');
  assert.equal(lesson.text, 'The harbour lights flickered across the water.\n\nBoats returned before dusk.');
  assert.deepEqual(lesson.words[2], ['harbour', '', '', '항구']);
  assert.equal(notebookLesson([{ word:'alone', translations:{}, sentences:[], added:0, practiced:0, missed:0 }], 'N').text, 'alone');
});

test('the notebook survives storage and ignores damaged data', () => {
  const data = {};
  const storage = { getItem:key => data[key] ?? null, setItem(key, value) { data[key] = value; } };
  assert.deepEqual(readNotebook(storage), []);
  assert.equal(saveNotebook(storage, addWord([], { word:'dusk' }, 1)), true);
  assert.equal(readNotebook(storage)[0].word, 'dusk');
  data['lingtype-notebook'] = '{broken';
  assert.deepEqual(readNotebook(storage), []);
  data['lingtype-notebook'] = JSON.stringify([{ word:'' }, null, { word:'ok', sentences:[] }]);
  assert.deepEqual(readNotebook(storage).map(entry => entry.word), ['ok']);
});
