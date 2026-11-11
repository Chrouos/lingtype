import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSentenceInput, separatorPositions } from '../site/sentences.mjs';
import { splitSentences, importedSections } from '../site/data.mjs';
import { typedCounts } from '../site/typing.mjs';
import { richText, plainText, formulaHtml, figureEvents, figureAt, figureHtml, figuresInText, cleanFormulas, cleanFigures } from '../site/paper.mjs';
import { createWorkbook, readWorkbook } from '../site/workbook.mjs';
import { createPageRenderer, pageFigures } from '../site/pdf-pages.mjs';
import { readCustomLessons } from '../site/library.mjs';

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

test('split PDF pages retain their page number in each reading segment', () => {
  const text = Array.from({length:500}, (_, i) => `Sentence ${i} about the page. `).join('');
  const sections = importedSections(text, [{title:'p. 4', text, page:4}]);
  const figures = cleanFigures(pageFigures({text, sections}));
  assert.ok(sections.length > 1);
  for (const section of sections) {
    const events = figureEvents(section.text, figures);
    assert.equal(figures[figureAt(events, section.text.length)]?.page, 4);
  }
});

test('a split PDF with only one nonempty page keeps its original page number', () => {
  const text = 'One long page sentence. '.repeat(600);
  const sections = importedSections(text, undefined, [], [7]);
  const figures = pageFigures({text, sections, pages:[7]});
  assert.ok(sections.length > 1);
  assert.equal(sections.map(section => section.text).join(''), text);
  assert.equal(figures.length, sections.length);
  assert.ok(figures.every(figure => figure.page === 7));
});

test('identical page anchors cannot select a different PDF page for a selected section', () => {
  const repeated = 'Shared page heading. '.repeat(20);
  const first = repeated + 'First page.', second = repeated + 'Second page.';
  const sections = importedSections(first + second, [{title:'p. 1', text:first, page:1}, {title:'p. 2', text:second, page:2}]);
  const figures = cleanFigures(pageFigures({sections}));
  const events = figureEvents(sections[0].text, figures, sections[0].page);
  assert.equal(figures[figureAt(events, sections[0].text.length)]?.page, 1);
  const longPage = repeated.repeat(40) + 'Long page.';
  const split = importedSections(longPage + second, [{title:'p. 1', text:longPage, page:1}, {title:'p. 2', text:second, page:2}]);
  const splitFigures = cleanFigures(pageFigures({sections:split}));
  for (const section of split.filter(value => value.page === 1)) {
    const matches = figureEvents(section.text, splitFigures, section.page);
    assert.equal(splitFigures[figureAt(matches, section.text.length)]?.page, 1);
  }
});

test('reloading a long PDF keeps page figures past 500, including split pages', () => {
  const pages = Array.from({length:2000}, (_, index) => ({title:`p. ${index + 1}`, text:`Page ${index + 1}.`, page:index + 1}));
  pages[500].text = 'Long page content. '.repeat(800);
  const sections = importedSections(pages.map(page => page.text).join('\n\n'), pages);
  const figures = pageFigures({sections});
  assert.ok(figures.length > 2000);
  const item = {id:'large-pdf', title:'Large PDF', text:'PDF text', words:[], sections, figures};
  const storage = {getItem:key => key === 'lingtype-custom-lessons' ? JSON.stringify([item]) : null};
  const [reloaded] = readCustomLessons(storage);
  assert.equal(reloaded.figures.length, figures.length);
  assert.equal(reloaded.figures.at(-1).page, 2000);
  assert.equal(reloaded.figures.filter(figure => figure.page === 501).length, sections.filter(section => section.page === 501).length);
  assert.throws(() => cleanFigures(figures), /figures/); // shared workbook limit stays bounded
  assert.throws(() => cleanFigures(Array.from({length:501}, () => ({kind:'figure'})), {allowPdfPages:true}), /figures/);
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

test('a PDF missing on the first read can be opened after it becomes available', async () => {
  let available = false, reads = 0, loads = 0;
  const pages = createPageRenderer(async () => { reads++; return available ? new Blob(['pdf']) : null; }, {
    load:async () => { loads++; return {getDocument:() => ({promise:Promise.resolve({numPages:0})})}; }
  });
  assert.equal(await pages.page('later', 1), null);
  available = true;
  assert.equal(await pages.page('later', 1), null); // The mock document has no pages.
  assert.equal(reads, 2);
  assert.equal(loads, 1);
});

test('a rejected evicted PDF request cannot remove a newer request for the same page', async () => {
  let rejectOld, resolveNew, reads = 0;
  const pages = createPageRenderer(id => {
    if (id !== 'a') return Promise.resolve(null);
    reads++;
    return reads === 1 ? new Promise((_, reject) => { rejectOld = reject; }) : new Promise(resolve => { resolveNew = resolve; });
  });
  const old = pages.page('a', 1).catch(() => null);
  await Promise.all(['b', 'c', 'd'].map(id => pages.page(id, 1)));
  const current = pages.page('a', 1);
  rejectOld(new Error('old request failed'));
  await old;
  assert.equal(pages.page('a', 1), current, 'old page rejection must not evict the new drawing');
  const anotherPage = pages.page('a', 2);
  assert.equal(reads, 2, 'old document rejection must not evict the new open');
  resolveNew(null);
  assert.deepEqual(await Promise.all([current, anotherPage]), [null, null]);
});

test('an evicted missing page cannot remove a newer drawing for the same key', async () => {
  let resolveOld, resolveNew, reads = 0;
  const pages = createPageRenderer(id => {
    if (id !== 'a') return Promise.resolve(null);
    reads++;
    return new Promise(resolve => { if (reads === 1) resolveOld = resolve; else resolveNew = resolve; });
  });
  const old = pages.page('a', 1);
  await Promise.all(['b', 'c', 'd'].map(id => pages.page(id, 1)));
  const current = pages.page('a', 1);
  resolveOld(null);
  await old;
  assert.equal(pages.page('a', 1), current);
  const anotherPage = pages.page('a', 2);
  assert.equal(reads, 2, 'old missing document must not evict the new open');
  resolveNew(null);
  assert.deepEqual(await Promise.all([current, anotherPage]), [null, null]);
});

test('the strip lists each figure in the text once, in paper order', () => {
  const figures = [{ label:'Figure 1', anchor:'Late part.', images:[] }, { label:'Figure 2', images:[] }, { label:'Figure 3', images:[] }];
  const events = figureEvents('See Figure 2 first. Then Figure 2 again. Late part.', figures);
  assert.deepEqual(figuresInText(events), [0, 1]);
  assert.deepEqual(figuresInText([]), []);
});
