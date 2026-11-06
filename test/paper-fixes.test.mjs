import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeable } from '../site/sentences.mjs';
import { safeImage, figureHtml } from '../site/paper.mjs';
import { readCustomLessons } from '../site/library.mjs';
import { readWorkbook } from '../site/workbook.mjs';

test('characters a PDF uses for math letters, ligatures and arrows become keyboard characters', () => {
  assert.equal(typeable('Figure 2︀ \u{1D440}\u{1D44A} ﬁne ∼3 • a→b ≤ ≥ 3.6×'), 'Figure 2 MW fine ~3 a->b <= >= 3.6x');
});

test('a workbook saved before those characters were converted still opens with its translations', () => {
  const file = { format:'lingtype-workbook', version:1, lesson:{ title:'Old', text:'Costs ∼5 more. Done here.', words:[], translations:{}, sentenceTranslations:{ zh:{ 'Costs ∼5 more.':'成本多 5 倍。', 'Gone sentence.':'x' } } } };
  const lesson = readWorkbook(JSON.stringify(file));
  assert.deepEqual(lesson.sentenceTranslations, { zh:{ 'Costs ~5 more.':'成本多 5 倍。' } });
});

test('only plain arXiv HTML image addresses are used', () => {
  assert.equal(safeImage('https://arxiv.org/html/2611.05306v1/a.png'), 'https://arxiv.org/html/2611.05306v1/a.png');
  for (const url of ['https://arxiv.org/html/../../evil.png', 'https://evil.test/a.png', 'javascript:alert(1)', 42, undefined]) assert.equal(safeImage(url), '');
});

test('figure markup survives malformed images and rows', () => {
  assert.doesNotThrow(() => figureHtml({ kind:'figure', images:'not a list', rows:'nope', caption:'c' }, []));
});

test('lessons read back from storage have their figures and formulas checked again', () => {
  const stored = [{ id:'a', title:'P', text:'Text.', words:[], figures:[{ label:'Figure 1', images:['https://evil.test/x.png', 'https://arxiv.org/html/1/a.png'] }, { label:'Figure 2', images:['https://evil.test/y.png'] }], formulas:'broken' }];
  const storage = { getItem:key => key === 'lingtype-custom-lessons' ? JSON.stringify(stored) : null };
  const [lesson] = readCustomLessons(storage);
  assert.deepEqual(lesson.figures.map(figure => figure.images), [['https://arxiv.org/html/1/a.png']]);
  assert.equal(lesson.formulas, undefined);
});
