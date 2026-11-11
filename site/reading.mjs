// Where each book was left and which of its paragraphs have been read.
// A book is read section by section (or as one text when it has none);
// paragraphs are the parts passageParts gives for that section's text.
import { passageParts } from './data.mjs';
import { typeable } from './sentences.mjs';

const KEY = 'lingtype-reading';
const SECTION = /^(?:all|\d+)$/;

function clean(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.section !== 'string' || !SECTION.test(entry.section) || !Number.isInteger(entry.at) || entry.at < 0) return null;
  const read = {};
  if (entry.read && typeof entry.read === 'object' && !Array.isArray(entry.read)) {
    for (const [section, indices] of Object.entries(entry.read)) {
      if (!SECTION.test(section) || !Array.isArray(indices)) continue;
      const valid = [...new Set(indices.filter(index => Number.isInteger(index) && index >= 0))].sort((a, b) => a - b);
      if (valid.length) read[section] = valid;
    }
  }
  const scope = entry.scope && typeof entry.scope === 'object' && SECTION.test(entry.scope.section) && ['full', 'random', 'from'].includes(entry.scope.passage) && (entry.scope.start === null || (Number.isInteger(entry.scope.start) && entry.scope.start >= 0)) ? { section:entry.scope.section, passage:entry.scope.passage, start:entry.scope.start } : null;
  return { section:entry.section, at:entry.at, time:typeof entry.time === 'string' ? entry.time : '', read, ...(scope ? { scope } : {}) };
}

export function readReading(storage) {
  let value;
  try { value = JSON.parse(storage?.getItem(KEY) || '{}'); } catch { return {}; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [id, entry] of Object.entries(value)) { const valid = clean(entry); if (valid) result[id] = valid; }
  return result;
}

export function validReadingData(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(entry => clean(entry) !== null);
}

function write(storage, data) {
  try { storage?.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}

// The sections a reader moves through, each with its typeable text.
export function readingSections(item) {
  if (item?.sections?.length) return item.sections.map((section, index) => ({ value:String(index), title:section.title, source:typeable(section.text) }));
  return [{ value:'all', title:item?.title || '', source:typeable(item?.text || '') }];
}

// Where each paragraph of a section's text starts and ends in that text.
export function partOffsets(source) {
  const offsets = []; let from = 0;
  for (const part of passageParts(source)) {
    const start = source.indexOf(part, from);
    const at = start < 0 ? from : start;
    offsets.push({ start:at, end:at + part.length });
    from = at + part.length;
  }
  return offsets;
}

// The paragraph reached at a position in a section, and the paragraphs typed to their end since `base`.
export function readingSpan(offsets, base, position) {
  let at = 0;
  const read = [];
  offsets.forEach((part, index) => {
    if (part.start <= position) at = index;
    if (part.start >= base && part.end <= position) read.push(index);
  });
  return { at, read };
}

export function noteReading(storage, lessonId, { section, at, read = [], scope = null, time = new Date().toISOString() }) {
  const data = readReading(storage);
  const previous = data[lessonId]?.read || {};
  const merged = { ...previous };
  if (read.length) merged[section] = [...new Set([...(previous[section] || []), ...read])].sort((a, b) => a - b);
  const entry = clean({ section, at, time, read:merged, scope });
  if (!entry) return false;
  delete data[lessonId]; data[lessonId] = entry;
  return write(storage, data);
}

export function forgetReading(storage, lessonId) {
  const data = readReading(storage);
  if (!(lessonId in data)) return true;
  delete data[lessonId];
  return write(storage, data);
}

// How much of a book has been read, counted in paragraphs.
export function bookProgress(item, entry) {
  let total = 0, read = 0;
  for (const section of readingSections(item)) {
    const count = passageParts(section.source).length;
    total += count;
    read += (entry?.read?.[section.value] || []).filter(index => index < count).length;
  }
  return { read, total, percent:total ? Math.floor(read / total * 100) : 0 };
}

// The paragraph to continue from: the bookmark if it is unread, otherwise the
// next unread paragraph after it, then the first unread one. Null when the book is finished.
export function nextUnread(item, entry) {
  const sections = readingSections(item).map(section => ({ ...section, count:passageParts(section.source).length }));
  const start = Math.max(0, sections.findIndex(section => section.value === entry?.section));
  const at = entry?.section === sections[start].value ? Math.min(entry.at, sections[start].count) : 0;
  // Forward from the bookmark to the end of the book, then from the beginning back to it.
  const ranges = [[start, at, sections[start].count], ...sections.slice(start + 1).map((section, i) => [start + 1 + i, 0, section.count]),
    ...sections.slice(0, start).map((section, i) => [i, 0, section.count]), [start, 0, at]];
  for (const [position, from, to] of ranges) {
    const section = sections[position], read = new Set(entry?.read?.[section.value] || []);
    for (let index = from; index < to; index++) if (!read.has(index)) return { section:section.value, index };
  }
  return null;
}

// A text without blank lines between paragraphs is read sentence by sentence.
export const partUnit = source => source.split(/\n\s*\n/).filter(part => part.trim()).length > 1 ? 'paragraph' : 'sentence';
export const bookUnit = item => readingSections(item).every(section => partUnit(section.source) === 'sentence') ? 'sentence' : 'paragraph';

// Long chapters are kept in parts titled "Chapter (1)", "Chapter (2)", …;
// the reader sees one chapter, numbered through all its parts.
export function readingChapters(item) {
  const chapters = [];
  for (const section of readingSections(item)) {
    const count = passageParts(section.source).length, match = /^(.*) \((\d+)\)$/.exec(section.title), last = chapters.at(-1);
    if (match && last?.base === match[1] && Number(match[2]) === last.parts.length + 1) {
      last.parts.push({ ...section, count, first:last.count }); last.count += count;
      continue;
    }
    const base = match?.[2] === '1' ? match[1] : null;
    chapters.push({ title:base ?? section.title, base, count, parts:[{ ...section, count, first:0 }] });
  }
  return chapters;
}

// Where a paragraph of a section is in its chapter.
export function chapterPlace(item, section, index) {
  for (const chapter of readingChapters(item)) {
    const part = chapter.parts.find(candidate => candidate.value === section);
    if (part) return { title:chapter.title, n:part.first + index + 1, total:chapter.count, unit:partUnit(part.source), last:part === chapter.parts.at(-1), single:readingSections(item).length === 1 };
  }
  return null;
}
