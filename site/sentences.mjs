export function sentenceAt(sentences, cursor) {
  let start = 0;
  for (let index = 0; index < sentences.length; index++) {
    const sentence = sentences[index], end = start + sentence.length;
    if (cursor < end || index === sentences.length - 1) return { index, start, end, text:sentence.trimEnd() };
    start = end;
  }
  return { index:0, start:0, end:0, text:'' };
}

// Stands in for a space the typist skipped, so the rest of the input stays aligned with the text.
export const MISSED = '\u0000';

function separatorRuns(sentences) {
  const runs = []; let start = 0;
  for (const sentence of sentences) {
    const body = start + sentence.trimEnd().length, end = start + sentence.length;
    if (end > body) runs.push({ start:body, end });
    start = end;
  }
  return runs;
}

// Formulas in a paper are drawn but not typed: each sits in the text as one private-use character.
const FORMULA = /[\uE000-\uF8FF]/;

// Positions the caret passes over by itself: formulas, and a sentence made only of formulas together with the space after it.
function autoPositions(sentences) {
  const auto = new Set(); let start = 0;
  for (const sentence of sentences) {
    const body = sentence.trimEnd();
    for (let i = 0; i < body.length; i++) if (FORMULA.test(body[i])) auto.add(start + i);
    if (FORMULA.test(body) && /^[\uE000-\uF8FF\s]*$/.test(body)) for (let i = 0; i < sentence.length; i++) auto.add(start + i);
    start += sentence.length;
  }
  return auto;
}

// The whitespace between sentences is typed with one space (or Enter), which fills the whole run, line breaks included.
// Typing a letter there instead marks the space as missed and keeps the letter as the start of the next sentence.
export function createSentenceInput(sentences) {
  const text = sentences.join(''), runs = separatorRuns(sentences), auto = autoPositions(sentences);
  const runAt = position => {
    let low = 0, high = runs.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1, run = runs[mid];
      if (position < run.start) high = mid - 1;
      else if (position >= run.end) low = mid + 1;
      else return run;
    }
  };
  const skip = out => { while (out.length < text.length && auto.has(out.length)) out += text[out.length]; return out; };
  return (previous, input) => {
  if (input.length <= previous.length) {
    const run = runAt(input.length);
    let out = run && input.length > run.start ? input.slice(0, run.start) : input;
    // Deleting past a formula takes the formula away too, so the next backspace reaches a typed letter.
    if (input.length < previous.length) while (out.length && auto.has(out.length - 1)) out = out.slice(0, -1);
    return out;
  }
  let out = input.slice(0, previous.length);
  for (const char of input.slice(previous.length)) {
    out = skip(out);
    if (out.length >= text.length) break;
    const run = runAt(out.length);
    if (!run) out += char;
    else if (/\s/.test(char)) out += text.slice(out.length, run.end);
    else out += MISSED + text.slice(out.length + 1, run.end) + char;
  }
  return skip(out);
  };
}

export function advanceSentenceInput(sentences, previous, input) {
  return createSentenceInput(sentences)(previous, input);
}

// A separator counts as one typed character however long its whitespace is; the rest is not scored, and neither are formulas.
export function separatorPositions(sentences) {
  const runs = separatorRuns(sentences), indices = autoPositions(sentences);
  for (const run of runs) for (let i = run.start + 1; i < run.end; i++) indices.add(i);
  return indices;
}

export function alignedTranslations(sentences, text, language) {
  if (!text?.trim()) return null;
  const translated = [...new Intl.Segmenter(language, { granularity:'sentence' }).segment(text)].map(part => part.segment.trim()).filter(Boolean);
  return translated.length === sentences.length ? translated : null;
}

export function passageTranslations(full, passage, text, language) {
  const translations = alignedTranslations(full, text, language);
  if (!translations || !passage.length || passage.length > full.length) return null;
  const matches = [];
  for (let start = 0; start <= full.length - passage.length; start++) {
    if (passage.every((sentence, i) => sentence.trim() === full[start + i].trim())) matches.push(start);
  }
  return matches.length === 1 ? translations.slice(matches[0], matches[0] + passage.length) : null;
}

// Typographic marks that a keyboard cannot type become their keyboard equivalents.
const KEYBOARD = [[/[\u2018\u2019\u201a\u201b\u2032]/g, "'"], [/[\u201c\u201d\u201e\u201f\u2033]/g, '"'], [/[\u2012\u2013\u2014\u2015\u2212]/g, '-'], [/\u2026/g, '...'], [/[\u00a0\u2007\u202f\u2009\u200a]/g, ' '], [/[\u200b\u200c\u200d\ufeff\u00ad\ufe00-\ufe0f]/g, ''],
  // PDFs often carry math-font letters and ligatures; they become the plain letters they look like.
  [/[\u{1d400}-\u{1d7ff}\ufb00-\ufb06]/gu, char => char.normalize('NFKC')], [/\u223c/g, '~'], [/\u2022/g, '-'], [/\u2192/g, '->'], [/\u2264/g, '<='], [/\u2265/g, '>=']];
export function typeable(text) {
  return KEYBOARD.reduce((value, [pattern, plain]) => value.replace(pattern, plain), text);
}
