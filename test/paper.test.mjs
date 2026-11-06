import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSentenceInput, separatorPositions } from '../site/sentences.mjs';
import { splitSentences } from '../site/data.mjs';
import { typedCounts } from '../site/typing.mjs';
import { richText, plainText, formulaHtml, figureEvents, figureAt, figureHtml, figuresInText, cleanFormulas, cleanFigures } from '../site/paper.mjs';
import { createWorkbook, readWorkbook } from '../site/workbook.mjs';
import { createPageRenderer, pageFigures } from '../site/pdf-pages.mjs';

const F0 = '', F1 = '';
const type = (sentences, keys) => { const step = createSentenceInput(sentences); let input = ''; for (const key of keys) input = step(input, input + key); return input; };

test('the caret passes over a formula by itself and the formula is not scored', () => {
  const text = `Let ${F0} be small.`, sentences = splitSentences(text);
  assert.equal(type(sentences, 'Let '), `Let ${F0}`);
  assert.equal(type(sentences, 'Let  be small.'), text);
  const skipped = separatorPositions(sentences);
  assert.ok(skipped.has(4));
  assert.deepEqual(typedCounts(text, text, skipped), { correct:text.length - 1, total:text.length - 1 });
});

test('a displayed equation on its own line is skipped together with the break after it', () => {
  const text = `First line.\n\n${F0}\n\nThen more.`, sentences = splitSentences(text);
  assert.equal(type(sentences, 'First line. '), `First line.\n\n${F0}\n\n`);
  assert.equal(type(sentences, 'First line. Then more.'), text);
});

test('backspace after a formula removes the formula so the next backspace reaches a letter', () => {
  const sentences = splitSentences(`Let ${F0} be.`), step = createSentenceInput(sentences);
  const typed = `Let ${F0}`;
  assert.equal(step(typed, typed.slice(0, -1)), 'Let ');
});

test('formulas are drawn as MathML and nothing else gets through', () => {
  const formulas = [{ tex:'a<b', display:false, tree:['math', {}, ['mi', { mathvariant:'bold', onclick:'x()' }, 'a'], ['script', {}, '<img src=x onerror=alert(1)>']] }];
  const html = richText(`x ${F0} & y`, formulas);
  assert.match(html, /<math><mi mathvariant="bold">a<\/mi><mrow>&lt;img src=x onerror=alert\(1\)&gt;<\/mrow><\/math>/);
  assert.doesNotMatch(html, /onclick|<script|<img/);
  assert.match(html, /title="a&lt;b"/);
  assert.match(html, /&amp; y$/);
  assert.equal(plainText(`x ${F0} ${F1}`, formulas), 'x $a<b$ ');
  assert.match(formulaHtml({ tex:'E', display:true, tree:['math', {}, ['mi', {}, 'E']] }), /class="formula display".*display="block"/);
});

test('the figure shown follows mentions in the text and where figures stood in the paper', () => {
  const text = 'Intro text. As Figure 2 shows, it works.\n\nNext part. See Table 1 here.';
  const figures = [{ label:'Figure 1', anchor:'Intro text.', where:'start', images:[] }, { label:'Figure 2', images:[] }, { label:'Table 1', anchor:'Next part.', where:'end', images:[] }];
  const events = figureEvents(text, figures);
  assert.equal(figureAt(events, 5), 0);
  assert.equal(figureAt(events, text.indexOf('Figure 2') + 1), 1);
  assert.equal(figureAt(events, text.indexOf('See')), 2);
  assert.equal(figureAt(figureEvents('No figures here.', figures), 10), null);
});

test('only arXiv images and plain table cells are kept from imported figures', () => {
  const [figure] = cleanFigures([{ label:'Figure 1', images:['https://arxiv.org/html/2611.05306v1/a.svg', 'javascript:alert(1)', 'https://evil.test/a.png'], caption:'c', rows:[['a', 5]], anchor:'x', where:'sideways' }]);
  assert.deepEqual(figure, { label:'Figure 1', kind:'figure', images:['https://arxiv.org/html/2611.05306v1/a.svg'], caption:'c', rows:[['a', '']], anchor:'x', where:'start' });
  assert.match(figureHtml(figure, []), /<img src="https:\/\/arxiv\.org\/html\/2611\.05306v1\/a\.svg"/);
  assert.throws(() => cleanFormulas([{ tex:5 }]));
  assert.deepEqual(cleanFormulas([{ tex:'x', tree:['div', { style:'x' }, 'x'] }]), [{ tex:'x', display:false, tree:['math', {}, ['mtext', {}, 'x']] }]);
});

test('a shared workbook keeps a paper\'s formulas and figures', () => {
  const item = { title:'Paper', text:`Let ${F0} be.`, words:[], translations:{}, formulas:[{ tex:'x^2', display:false, tree:['math', {}, ['msup', {}, ['mi', {}, 'x'], ['mn', {}, '2']]] }], figures:[{ label:'Figure 1', kind:'figure', images:['https://arxiv.org/html/1/a.png'], caption:'' }] };
  const back = readWorkbook(JSON.stringify(createWorkbook(item)));
  assert.deepEqual(back.formulas, item.formulas);
  assert.deepEqual(back.figures, item.figures);
});

test('each page of an imported PDF shows beside its own text, even when pages start alike', () => {
  const data = { text:'Header. One.\n\nHeader. Two.', sections:[{ title:'p. 1', text:'Header. One.', page:1 }, { title:'p. 2', text:'Header. Two.', page:2 }], pages:[1, 2] };
  const figures = pageFigures(data);
  assert.deepEqual(figures.map(figure => [figure.kind, figure.page, figure.anchor]), [['page', 1, 'Header. One.'], ['page', 2, 'Header. Two.']]);
  const events = figureEvents(data.text, cleanFigures(figures));
  assert.equal(figureAt(events, 0), 0);
  assert.equal(figureAt(events, data.text.indexOf('Two')), 1);
  assert.deepEqual(pageFigures({ text:'Only page.', pages:[4] }).map(figure => figure.page), [4]);
  assert.match(figureHtml(figures[0], []), /class="pdf-page"/);
});

test('page figures stay out of a shared workbook', () => {
  const item = { title:'Book', text:'Words here.', words:[], translations:{}, figures:pageFigures({ text:'Words here.', pages:[1] }) };
  assert.equal(createWorkbook(item).lesson.figures, undefined);
});

test('a page whose PDF is not in this browser draws nothing and loads no library', async () => {
  let loaded = false;
  const pages = createPageRenderer(async () => undefined, { load:async () => { loaded = true; } });
  assert.equal(await pages.page('missing', 1), null);
  assert.equal(loaded, false);
  pages.forget('missing');
});

test('the strip lists each figure in the text once, in paper order', () => {
  const figures = [{ label:'Figure 1', anchor:'Late part.', images:[] }, { label:'Figure 2', images:[] }, { label:'Figure 3', images:[] }];
  const events = figureEvents('See Figure 2 first. Then Figure 2 again. Late part.', figures);
  assert.deepEqual(figuresInText(events), [0, 1]);
  assert.deepEqual(figuresInText([]), []);
});
