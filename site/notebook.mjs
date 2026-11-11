import { splitSentences } from './data.mjs';

// A personal word notebook: each word keeps the sentences it was met in and how its practice has gone.
const key = 'lingtype-notebook';
// DateTimeFormat rejects finite timestamps outside the ECMAScript Date range.
const validReviewTime = value => Number.isFinite(value) && Math.abs(value) <= 8_640_000_000_000_000;

export function readNotebook(storage) {
  try {
    const data = JSON.parse(storage?.getItem(key) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(entry => entry && typeof entry.word === 'string' && entry.word && Array.isArray(entry.sentences)).map(entry => ({
      ...entry,
      translations:entry.translations && typeof entry.translations === 'object' && !Array.isArray(entry.translations)
        ? Object.fromEntries(Object.entries(entry.translations).filter(([, value]) => typeof value === 'string')) : {},
      sentences:entry.sentences.filter(item => item && typeof item.text === 'string').map(item => ({ ...item, source:typeof item.source === 'string' ? item.source : '' })),
      added:Number.isFinite(entry.added) ? entry.added : 0,
      practiced:Number.isFinite(entry.practiced) && entry.practiced >= 0 ? entry.practiced : 0,
      missed:Number.isFinite(entry.missed) && entry.missed >= 0 ? entry.missed : 0,
      reviewDue:validReviewTime(entry.reviewDue) ? entry.reviewDue : undefined,
    }));
  } catch { return []; }
}

export function saveNotebook(storage, entries) {
  try { storage?.setItem(key, JSON.stringify(entries)); return true; } catch { return false; }
}

function wholeWordOffset(sentence, word) {
  if (!word) return -1;
  const pattern = new RegExp(word.replace(/’/g, "'").replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const normalized = sentence.replace(/’/g, "'");
  for (const match of normalized.matchAll(pattern)) {
    const start = match.index, end = start + match[0].length;
    const before = normalized[start - 1], after = normalized[end];
    if (/[A-Za-z]/.test(before || '') || /[A-Za-z]/.test(after || '')) continue;
    if (before === "'" && /[A-Za-z]/.test(normalized[start - 2] || '')) continue;
    if (after === "'" && /[A-Za-z]/.test(normalized[end + 1] || '')) continue;
    return start;
  }
  return -1;
}

// The first sentence of the text that uses the word as a whole word.
export function sentenceWith(text, word) {
  return splitSentences(text).map(sentence => sentence.trim()).find(sentence => wholeWordOffset(sentence, word) >= 0) || '';
}

export function addWord(entries, { word, sentence = '', source = '', translations = {} }, now = Date.now()) {
  const lower = word.toLowerCase(), existing = entries.find(entry => entry.word === lower);
  const clean = Object.fromEntries(Object.entries(translations).filter(([, text]) => typeof text === 'string' && text));
  const position = wholeWordOffset(sentence, word);
  const width = Math.max(400, word.length);
  let start = position >= 0 && position + word.length > width ? Math.max(0, position - Math.floor((width - word.length) / 2)) : 0;
  let end = Math.min(sentence.length, start + width);
  // Never leave half of a supplementary character at either edge. The word
  // itself is ASCII, so trimming these boundary halves cannot remove it.
  const high = code => code >= 0xD800 && code <= 0xDBFF;
  const low = code => code >= 0xDC00 && code <= 0xDFFF;
  if (start > 0 && low(sentence.charCodeAt(start)) && high(sentence.charCodeAt(start - 1))) start++;
  if (end < sentence.length && low(sentence.charCodeAt(end)) && high(sentence.charCodeAt(end - 1))) end--;
  const excerpt = sentence.slice(start, end);
  if (!existing) return [...entries, { word:lower, translations:clean, sentences:excerpt ? [{ text:excerpt, source }] : [], added:now, practiced:0, missed:0 }];
  return entries.map(entry => entry !== existing ? entry : {
    ...entry,
    translations:{ ...clean, ...entry.translations },
    sentences:excerpt && !entry.sentences.some(item => item.text === excerpt) ? [...entry.sentences, { text:excerpt, source }].slice(-3) : entry.sentences,
  });
}

export function removeWord(entries, word) {
  return entries.filter(entry => entry.word !== word.toLowerCase());
}

export function recordPractice(entries, practiced, missed, now = Date.now(), previousMisses = new Set()) {
  return entries.map(entry => practiced.has(entry.word) || missed.has(entry.word)
    ? previousMisses.has(entry.word) && !missed.has(entry.word)
      ? { ...entry, practiced:entry.practiced + (practiced.has(entry.word) ? 1 : 0) }
      : { ...entry, practiced:entry.practiced + (practiced.has(entry.word) ? 1 : 0), missed:entry.missed + (missed.has(entry.word) ? 1 : 0), last:now,
      reviewIntervalDays:missed.has(entry.word) ? 1 : ([1, 3, 7, 14, 30].find(days => days > (entry.reviewIntervalDays || 0)) || 30),
      reviewDue:now + (missed.has(entry.word) ? 1 : ([1, 3, 7, 14, 30].find(days => days > (entry.reviewIntervalDays || 0)) || 30)) * 86400000 }
    : entry);
}

export function dueWords(entries, now = Date.now()) {
  return entries.filter(entry => !validReviewTime(entry.reviewDue) || entry.reviewDue <= now);
}

export function nextReviewTime(entries, now = Date.now()) {
  const future = entries.map(entry => entry.reviewDue).filter(value => validReviewTime(value) && value > now);
  return future.length ? Math.min(...future) : null;
}

export function updateWordTranslation(entries, word, language, text) {
  return entries.map(entry => entry.word === word ? {...entry, translations:{...entry.translations, [language]:text}} : entry);
}

// Words missed most often, relative to how often they were practised, come first; then the oldest.
export function practiceOrder(entries) {
  const need = entry => (entry.missed + 1) / (entry.practiced + 1);
  return [...entries].sort((a, b) => need(b) - need(a) || a.added - b.added);
}

// The notebook practised like any lesson: its words for word mode, their sentences as the text.
export function notebookLesson(entries, title) {
  const ordered = practiceOrder(entries);
  const sentences = [...new Set(ordered.flatMap(entry => entry.sentences.map(item => item.text)))];
  return {
    id:'notebook', notebook:true, title, category:'notebook', translations:{},
    text:sentences.length ? sentences.join('\n\n') : ordered.map(entry => entry.word).join(' '),
    words:ordered.map(entry => [entry.word, entry.translations.zh || '', entry.translations.ja || '', entry.translations.ko || '']),
  };
}
