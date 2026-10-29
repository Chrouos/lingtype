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

// The whitespace between sentences is typed with one space (or Enter), which fills the whole run, line breaks included.
// Typing a letter there instead marks the space as missed and keeps the letter as the start of the next sentence.
export function advanceSentenceInput(sentences, previous, input) {
  const text = sentences.join(''), runs = separatorRuns(sentences);
  const runAt = position => runs.find(run => position >= run.start && position < run.end);
  if (input.length <= previous.length) {
    const run = runAt(input.length);
    return run && input.length > run.start ? input.slice(0, run.start) : input;
  }
  let out = input.slice(0, previous.length);
  for (const char of input.slice(previous.length)) {
    const run = runAt(out.length);
    if (!run) out += char;
    else if (/\s/.test(char)) out += text.slice(out.length, run.end);
    else out += MISSED + text.slice(out.length + 1, run.end) + char;
  }
  return out;
}

// A separator counts as one typed character however long its whitespace is; the rest is not scored.
export function separatorPositions(sentences) {
  const indices = new Set();
  for (const run of separatorRuns(sentences)) for (let i = run.start + 1; i < run.end; i++) indices.add(i);
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
const KEYBOARD = [[/[\u2018\u2019\u201a\u201b\u2032]/g, "'"], [/[\u201c\u201d\u201e\u201f\u2033]/g, '"'], [/[\u2012\u2013\u2014\u2015\u2212]/g, '-'], [/\u2026/g, '...'], [/[\u00a0\u2007\u202f\u2009\u200a]/g, ' '], [/[\u200b\u200c\u200d\ufeff\u00ad]/g, '']];
export function typeable(text) {
  return KEYBOARD.reduce((value, [pattern, plain]) => value.replace(pattern, plain), text);
}
