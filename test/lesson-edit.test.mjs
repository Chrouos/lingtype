import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editableLessonText, createEditedLessonCopy} from '../site/lesson-edit.mjs';
import {snapshotKey, saveSnapshot, readSnapshot} from '../site/practice.mjs';
import {createWorkbook, readWorkbook} from '../site/workbook.mjs';
import {createBackup, readBackup} from '../site/backup.mjs';

const original = {id:'old',custom:true,title:'Original',text:'Value \uE000.\n\nNext.',
  sections:[{title:'Old section',text:'wrong',page:4}], formulas:[{tex:'x^2'}],
  figures:[{kind:'page',page:4}], translations:{zh:'old'},sentenceTranslations:{zh:{}},
  words:[['value','old','','']], publicId:'publication',sourceUrl:'https://example.com/paper',authors:['A. Writer'],source:'Original source',license:'CC BY',knownWords:['old']};

test('edited copy expands formulas and isolates all source-dependent data and progress', () => {
  const before = structuredClone(original);
  assert.equal(editableLessonText(original), 'Value $x^2$.\n\nNext.');
  const copy = createEditedLessonCopy({original,id:'new',title:' Edited ',text:'Value \uE000 changed.\n\nNext.'});
  assert.deepEqual(copy, {id:'new',custom:true,category:'custom',edited:true,title:'Edited',text:'Value $x^2$ changed.\n\nNext.',sourceUrl:'https://example.com/paper',authors:['A. Writer'],source:'Original source',license:'CC BY',translations:{zh:'',ja:'',ko:''},words:[]});
  assert.deepEqual(original, before);
  const storage = {data:{},getItem(k){return this.data[k] ?? null;},setItem(k,v){this.data[k]=v;}};
  const oldKey = snapshotKey('old','article','all','full'), newKey = snapshotKey('new','article','all','full');
  assert.equal(saveSnapshot(storage, oldKey, {input:'Value'}), true);
  assert.equal(readSnapshot(storage, newKey), null);
  assert.equal(readSnapshot(storage, oldKey).input, 'Value');
  storage.setItem('lingtype-custom-lessons', JSON.stringify([original,copy]));
  const backup = readBackup(JSON.stringify(createBackup(storage)));
  assert.equal(JSON.parse(backup['lingtype-custom-lessons'])[1].edited, true);
  const shared = readWorkbook(JSON.stringify(createWorkbook(copy)));
  assert.equal(shared.edited, true);
  assert.equal(shared.sourceUrl, copy.sourceUrl);
  assert.deepEqual(shared.authors, copy.authors);
  assert.equal(shared.license, copy.license);
  assert.notEqual(shared.category, 'arxiv');
});

test('edited copies discard untrusted source links and bound attribution', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'https://user:pass@example.com/', 'https://example.com/ space']) {
    const copy = createEditedLessonCopy({original:{...original,sourceUrl,authors:['valid','x'.repeat(201)],license:'x'.repeat(501)},id:'new',title:'Title',text:'Text'});
    assert.equal(copy.sourceUrl, undefined);
    assert.deepEqual(copy.authors, ['valid']);
    assert.equal(copy.license, undefined);
  }
});

test('edited workbooks retain an arXiv source without claiming to be the original paper', () => {
  const copy = createEditedLessonCopy({original:{...original,category:'arxiv',sourceUrl:'https://arxiv.org/html/2610.12345v1'},id:'new',title:'Edited',text:'Text'});
  const shared = createWorkbook(copy);
  shared.lesson.category = 'arxiv';
  const restored = readWorkbook(JSON.stringify(shared));
  assert.equal(restored.edited, true);
  assert.equal(restored.sourceUrl, 'https://arxiv.org/html/2610.12345v1');
  assert.notEqual(restored.category, 'arxiv');
});

test('long edited copies rebuild chapters without carrying old page numbers', () => {
  const text = 'A sentence. '.repeat(1300);
  const copy = createEditedLessonCopy({original,id:'new',title:'Long',text});
  assert.ok(copy.sections.length > 1);
  assert.equal(copy.sections.map(section => section.text).join(''), text.trim());
  assert.ok(copy.sections.every(section => !Object.hasOwn(section, 'page')));
});

test('invalid edits never silently erase unknown formulas or reuse the original ID', () => {
  const args = {original,id:'new',title:'Title',text:'Safe'};
  for (const [change, code] of [[{id:'old'},'invalid_id'],[{id:''},'invalid_id'],[{title:' '},'invalid_title'],[{title:'x'.repeat(101)},'invalid_title'],[{text:' '},'invalid_text'],[{text:'x'.repeat(1_000_001)},'invalid_text'],[{text:'Unknown \uE001'},'missing_formula']]) {
    assert.throws(() => createEditedLessonCopy({...args,...change}), error => error.code === code);
  }
  assert.throws(() => editableLessonText({...original,formulas:[]}), error => error.code === 'missing_formula');
});
