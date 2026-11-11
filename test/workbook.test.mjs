import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbook, readWorkbook, selectedArticleWords } from '../site/workbook.mjs';
import { readBuiltinWords, saveBuiltinWords } from '../site/library.mjs';
import { createTranslationCache } from '../site/translation-cache.mjs';
import { importedSections, MAX_WORKBOOK_SECTIONS } from '../site/data.mjs';

test('a 2,000-page PDF with a split page exports and reopens within the workbook limit', () => {
  const pages = Array.from({length:2000}, (_, index) => ({title:`p. ${index + 1}`, text:`Page ${index + 1}.`, page:index + 1}));
  pages[5].text = 'A long page sentence. '.repeat(600);
  const text = pages.map(page => page.text).join('\n\n');
  const sections = importedSections(text, pages);
  assert.ok(sections.length > 2000);
  const json = JSON.stringify(createWorkbook({title:'Long PDF', text, sections, words:[], translations:{}}));
  assert.ok(new Blob([json]).size < 2_000_000);
  const restored = readWorkbook(json);
  assert.equal(restored.sections.length, sections.length);
  assert.deepEqual(restored.sections.map(section => section.text), sections.map(section => section.text));
  assert.equal(restored.text, text);
  const excessive = createWorkbook({title:'Too many',text:'Text',words:[],sections:Array.from({length:MAX_WORKBOOK_SECTIONS + 1}, () => ({title:'Page',text:'Text'}))});
  const maxSections = {...excessive, lesson:{...excessive.lesson, sections:excessive.lesson.sections.slice(0, MAX_WORKBOOK_SECTIONS)}};
  assert.equal(readWorkbook(JSON.stringify(maxSections)).sections.length, MAX_WORKBOOK_SECTIONS);
  assert.throws(() => readWorkbook(JSON.stringify(excessive)), /章節/);
  const tooManyBytes = JSON.stringify(createWorkbook({title:'Big',text:'Text',words:[],translations:{zh:'中'.repeat(700_000)}}));
  assert.ok(tooManyBytes.length < 2_000_000);
  assert.throws(() => readWorkbook(tooManyBytes), /2 MB/);
});

test('an edited sentence translation is included in a shared workbook', () => {
  const cache = {}, service = createTranslationCache(null, async () => [], cache);
  service.set('First.', 'zh', '修正後的翻譯');
  const file = createWorkbook({title:'Example',text:'First.',words:[],translations:{}}, cache);
  assert.equal(readWorkbook(JSON.stringify(file)).sentenceTranslations.zh['First.'], '修正後的翻譯');
  service.set('First.', 'zh', 'First.');
  const same = createWorkbook({title:'Example',text:'First.',words:[],translations:{}}, cache);
  assert.equal(readWorkbook(JSON.stringify(same)).sentenceTranslations.zh['First.'], 'First.');
});

test('workbook round trips sentence translations belonging to the lesson', () => {
  const lesson = { title:'Example', text:'First. Second.', words:[], translations:{} };
  const cache = { 'zh\u0000First.':'first translated', 'ja\u0000Second.':'second translated', 'zh\u0000Other.':'private' };
  const file = createWorkbook(lesson, cache);
  const restored = readWorkbook(JSON.stringify(file));
  assert.deepEqual(restored.sentenceTranslations, { zh:{'First.':'first translated'}, ja:{'Second.':'second translated'} });
});

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

test('a shared novel keeps its category unless it was edited', () => {
  const novel = {title:'Novel', text:'Once.', words:[], translations:{}, category:'novel', sections:[{title:'Chapter I', text:'Once.'}]};
  assert.equal(readWorkbook(JSON.stringify(createWorkbook(novel))).category, 'novel');
  assert.equal(readWorkbook(JSON.stringify(createWorkbook({...novel, edited:true}))).category, '分享教材');
  assert.equal(readWorkbook(JSON.stringify(createWorkbook({...novel, category:'web'}))).category, '分享教材');
});

test('shared arXiv workbooks retain their authors, source and attribution category', () => {
  const lesson = {title:'Paper', text:'A paper.', words:[], translations:{}, category:'arxiv', authors:['A. Writer', 'B. Reader'], sourceUrl:'https://arxiv.org/html/2610.12345v1', license:'CC BY'};
  const file = createWorkbook(lesson);
  const restored = readWorkbook(JSON.stringify(file));
  assert.deepEqual(restored.authors, lesson.authors);
  assert.equal(restored.category, 'arxiv');
  assert.equal(restored.sourceUrl, lesson.sourceUrl);
  assert.equal(restored.license, lesson.license);
  const many = {...lesson, authors:Array.from({length:120}, (_, i) => `Author ${i}`)};
  assert.deepEqual(readWorkbook(JSON.stringify(createWorkbook(many))).authors, many.authors);
  const supplementaryName = '𠮷'.repeat(150);
  assert.deepEqual(readWorkbook(JSON.stringify(createWorkbook({...lesson, authors:[supplementaryName]}))).authors, [supplementaryName]);
  const invalid = {...file, lesson:{...file.lesson, authors:['x'.repeat(201)]}};
  assert.equal(readWorkbook(JSON.stringify(invalid)).authors, undefined, 'legacy invalid metadata does not prevent reading');
  const old = {...file, lesson:{...file.lesson}};
  delete old.lesson.authors;
  assert.equal(readWorkbook(JSON.stringify(old)).authors, undefined);
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
