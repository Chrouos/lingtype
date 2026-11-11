import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNotebook, saveNotebook, sentenceWith, addWord, removeWord, recordPractice, practiceOrder, notebookLesson, dueWords, nextReviewTime, updateWordTranslation } from '../site/notebook.mjs';

test('next review time identifies the earliest future review', () => {
  const entries = [{reviewDue:5000}, {reviewDue:3000}, {reviewDue:1000}];
  assert.equal(nextReviewTime(entries, 2000), 3000);
  assert.equal(nextReviewTime(entries, 6000), null);
});

test('out-of-range review timestamps are treated as due rather than formatted', () => {
  const invalid = 8_640_000_000_000_001;
  const storage = {getItem:() => JSON.stringify([{word:'harbour', translations:{}, sentences:[], reviewDue:invalid}])};
  const entries = readNotebook(storage);
  assert.equal(entries[0].reviewDue, undefined);
  assert.equal(dueWords(entries, 0).length, 1);
  assert.equal(nextReviewTime([{reviewDue:invalid}], 0), null);
});

test('review schedule includes new and due words and advances or resets after practice', () => {
  const day = 86400000;
  let items = addWord([], {word:'harbour'}, 100);
  assert.equal(dueWords(items, 100).length, 1);
  items = recordPractice(items, new Set(['harbour']), new Set(), 100);
  assert.equal(dueWords(items, 100 + day - 1).length, 0);
  assert.equal(dueWords(items, 100 + day).length, 1);
  items = recordPractice(items, new Set(['harbour']), new Set(), 100 + day);
  assert.equal(items[0].reviewIntervalDays, 3);
  items = recordPractice(items, new Set(['harbour']), new Set(['harbour']), 100 + 4 * day);
  assert.equal(items[0].reviewIntervalDays, 1);
});

test('finishing a previously missed word after resuming preserves its review schedule', () => {
  let entries = addWord([], {word:'harbour'}, 1);
  entries = recordPractice(entries, new Set(), new Set(['harbour']), 100);
  const due = entries[0].reviewDue;
  entries = recordPractice(entries, new Set(['harbour']), new Set(), 200, new Set(['harbour']));
  assert.equal(entries[0].practiced, 1);
  assert.equal(entries[0].missed, 1);
  assert.equal(entries[0].reviewIntervalDays, 1);
  assert.equal(entries[0].reviewDue, due);
});

test('editing a word translation preserves other languages and review history', () => {
  const items = addWord([], {word:'harbour',translations:{zh:'港口',ja:'港'}}, 1);
  const changed = updateWordTranslation(items, 'harbour', 'zh', '海港');
  assert.deepEqual(changed[0].translations, {zh:'海港',ja:'港'});
  assert.equal(changed[0].added, 1);
  assert.equal(items[0].translations.zh, '港口');
});

const text = 'Boats returned before dusk. The harbour lights flickered across the water. Harbours are busy places.';

test('a word keeps the sentence it was met in, once per sentence and at most three', () => {
  assert.equal(sentenceWith(text, 'harbour'), 'The harbour lights flickered across the water.');
  assert.equal(sentenceWith(text, 'dusk'), 'Boats returned before dusk.');
  assert.equal(sentenceWith('It isn’t here.', "isn't"), 'It isn’t here.');
  assert.equal(sentenceWith("Don't stop. Don returned.", 'don'), 'Don returned.');
  assert.equal(sentenceWith("He said 'hello' to James' friends.", 'hello'), "He said 'hello' to James' friends.");
  assert.equal(sentenceWith("He said 'hello' to James' friends.", 'james'), "He said 'hello' to James' friends.");
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

test('revisiting a long sentence does not replace other saved examples', () => {
  const long = `The harbour ${'water '.repeat(90)}is calm.`;
  let entries = addWord([], { word:'harbour', sentence:long });
  entries = addWord(entries, { word:'harbour', sentence:'Another harbour.' });
  entries = addWord(entries, { word:'harbour', sentence:long });
  assert.deepEqual(entries[0].sentences.map(item => item.text), [long.slice(0, 400), 'Another harbour.']);
});

test('long sentence excerpts include the selected word even near the end', () => {
  const long = `${'Water '.repeat(90)}The harbour is calm.`;
  let entries = addWord([], { word:'harbour', sentence:long });
  assert.ok(entries[0].sentences[0].text.includes('harbour'));
  assert.ok(entries[0].sentences[0].text.length <= 400);
  entries = addWord(entries, { word:'harbour', sentence:long });
  assert.equal(entries[0].sentences.length, 1);
});

test('long excerpts do not split emoji at either boundary', () => {
  const prefix = `${'a'.repeat(303)}😀${'a'.repeat(194)} `;
  const sentence = `${prefix}harbour${'😀'.repeat(200)}`;
  const excerpt = addWord([], { word:'harbour', sentence })[0].sentences[0].text;
  assert.ok(excerpt.includes('harbour'));
  assert.ok(excerpt.length <= 400);
  assert.ok(Array.from(excerpt).every(char => { const code = char.codePointAt(0); return code < 0xD800 || code > 0xDFFF; }));
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
  const repaired = readNotebook(storage);
  assert.deepEqual(notebookLesson(repaired, 'Notebook').words, [['ok', '', '', '']]);
  assert.equal(recordPractice(repaired, new Set(['ok']), new Set(), 1)[0].practiced, 1);
});
