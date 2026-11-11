import { importedSections } from './data.mjs';
import { plainText } from './paper.mjs';
import { safeSourceUrl } from './source-url.mjs';

const MAX_TEXT_LENGTH = 1_000_000;
const MAX_TITLE_LENGTH = 100;
const FORMULA_MARKERS = /[\uE000-\uF8FF]/g;
const invalid = code => Object.assign(new Error(code), {code});

// Formula placeholders cannot be retained after removing the formula mapping.
// Expand them before editing, and refuse to silently erase a missing formula.
export function editableLessonText(original) {
  if (!original || typeof original !== 'object' || typeof original.text !== 'string') throw invalid('invalid_original');
  return expandFormulas(original.text, original.formulas);
}

function expandFormulas(text, formulas) {
  for (const marker of text.match(FORMULA_MARKERS) || []) {
    const formula = formulas?.[marker.charCodeAt(0) - 0xE000];
    if (typeof formula?.tex !== 'string' || !formula.tex) throw invalid('missing_formula');
  }
  return plainText(text, formulas);
}

// A new ID intentionally keeps old practice snapshots and publication identity
// attached to the original. Never copy text-dependent annotations or PDF pages.
export function createEditedLessonCopy({ original, id, title, text }) {
  if (!original || typeof original !== 'object' || typeof original.text !== 'string') throw invalid('invalid_original');
  if (typeof id !== 'string' || !id.trim() || id === original.id) throw invalid('invalid_id');
  if (typeof title !== 'string' || !title.trim() || title.trim().length > MAX_TITLE_LENGTH) throw invalid('invalid_title');
  if (typeof text !== 'string') throw invalid('invalid_text');
  const cleaned = expandFormulas(text, original.formulas).trim();
  if (!cleaned || cleaned.length > MAX_TEXT_LENGTH) throw invalid('invalid_text');
  const sections = importedSections(cleaned);
  const sourceUrl = safeSourceUrl(original.sourceUrl);
  const authors = Array.isArray(original.authors) ? original.authors.filter(author => typeof author === 'string' && author.trim() && [...author].length <= 200).slice(0, 5000).map(author => author.trim()) : [];
  const source = typeof original.source === 'string' && original.source.length <= 500 ? original.source : '';
  const license = typeof original.license === 'string' && original.license.length <= 500 ? original.license : '';
  return { id, custom:true, category:'custom', edited:true, title:title.trim(), text:cleaned,
    ...(sourceUrl ? {sourceUrl} : {}), ...(authors.length ? {authors} : {}), ...(source ? {source} : {}), ...(license ? {license} : {}),
    ...(sections ? {sections} : {}), translations:{zh:'', ja:'', ko:''}, words:[] };
}
