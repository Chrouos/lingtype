import { splitSentences } from './data.mjs';

// A personal word notebook: each word keeps the sentences it was met in and how its practice has gone.
const key = 'lingtype-notebook';

export function readNotebook(storage) {
  try {
    const data = JSON.parse(storage?.getItem(key) || '[]');
    return Array.isArray(data) ? data.filter(entry => entry && typeof entry.word === 'string' && entry.word && Array.isArray(entry.sentences)) : [];
  } catch { return []; }
}

export function saveNotebook(storage, entries) {
  try { storage?.setItem(key, JSON.stringify(entries)); return true; } catch { return false; }
}

// The first sentence of the text that uses the word as a whole word.
export function sentenceWith(text, word) {
  const pattern = new RegExp(`(^|[^A-Za-z'])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i');
  return splitSentences(text).map(sentence => sentence.trim()).find(sentence => pattern.test(sentence.replace(/’/g, "'"))) || '';
}

export function addWord(entries, { word, sentence = '', source = '', translations = {} }, now = Date.now()) {
  const lower = word.toLowerCase(), existing = entries.find(entry => entry.word === lower);
  const clean = Object.fromEntries(Object.entries(translations).filter(([, text]) => typeof text === 'string' && text));
  if (!existing) return [...entries, { word:lower, translations:clean, sentences:sentence ? [{ text:sentence.slice(0, 400), source }] : [], added:now, practiced:0, missed:0 }];
  return entries.map(entry => entry !== existing ? entry : {
    ...entry,
    translations:{ ...clean, ...entry.translations },
    sentences:sentence && !entry.sentences.some(item => item.text === sentence) ? [...entry.sentences, { text:sentence.slice(0, 400), source }].slice(-3) : entry.sentences,
  });
}

export function removeWord(entries, word) {
  return entries.filter(entry => entry.word !== word.toLowerCase());
}

export function recordPractice(entries, practiced, missed, now = Date.now()) {
  return entries.map(entry => practiced.has(entry.word) || missed.has(entry.word)
    ? { ...entry, practiced:entry.practiced + (practiced.has(entry.word) ? 1 : 0), missed:entry.missed + (missed.has(entry.word) ? 1 : 0), last:now }
    : entry);
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
