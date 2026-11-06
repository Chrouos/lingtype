// Papers: formulas sit in the text as private-use characters (drawn, never typed), and figures follow the reading position.
import { typeable } from './sentences.mjs';

export const FORMULA_BASE = 0xE000;
const FORMULA_LAST = 0xF8FF;
const MATH_TAGS = new Set(['mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'mrow', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'mpadded', 'mphantom', 'menclose', 'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr', 'mtd', 'semantics']);
const MATH_ATTRS = new Set(['mathvariant', 'display', 'stretchy', 'fence', 'separator', 'lspace', 'rspace', 'accent', 'accentunder', 'movablelimits', 'largeop', 'symmetric', 'linethickness', 'columnalign', 'rowspacing', 'columnspacing', 'width', 'height', 'depth', 'scriptlevel', 'displaystyle', 'minsize', 'maxsize', 'notation', 'columnspan', 'rowspan']);
const SAFE_VALUE = /^[\w.%#+ -]{1,40}$/;
const IMAGE_URL = /^https:\/\/arxiv\.org\/html\/(?!.*\.\.)[\w./-]+\.(?:png|jpe?g|gif|svg|webp)$/i;
export const safeImage = url => typeof url === 'string' && IMAGE_URL.test(url) ? url : '';
const FORMULA_CHARS = /[-]/g;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function isFormula(char) {
  const code = char?.charCodeAt?.(0);
  return code >= FORMULA_BASE && code <= FORMULA_LAST;
}
const formulaAt = (formulas, char) => formulas?.[char.charCodeAt(0) - FORMULA_BASE];

// Only MathML elements and presentation attributes are written out, so a shared workbook cannot carry markup of its own.
function mathml(node, depth) {
  if (typeof node === 'string') return escapeHtml(node);
  if (!Array.isArray(node) || depth > 60) return '';
  const [tag, attrs, ...children] = node;
  const name = MATH_TAGS.has(tag) ? tag : 'mrow';
  const attributes = attrs && typeof attrs === 'object' && !Array.isArray(attrs)
    ? Object.entries(attrs).filter(([key, value]) => MATH_ATTRS.has(key) && typeof value === 'string' && SAFE_VALUE.test(value)).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('')
    : '';
  return `<${name}${attributes}>${children.map(child => mathml(child, depth + 1)).join('')}</${name}>`;
}

export function formulaHtml(formula) {
  if (!formula) return '<span class="formula">▢</span>';
  const children = Array.isArray(formula.tree) ? formula.tree.slice(2) : [['mtext', {}, formula.tex || '']];
  return `<span class="formula${formula.display ? ' display' : ''}" title="${escapeHtml(formula.tex || '')}"><math${formula.display ? ' display="block"' : ''}>${children.map(child => mathml(child, 1)).join('')}</math></span>`;
}

// Text for HTML, with each formula drawn in place.
export function richText(text, formulas) {
  return String(text).split(/([-])/).map(part => isFormula(part) ? formulaHtml(formulaAt(formulas, part)) : escapeHtml(part)).join('');
}

// Text for places that cannot draw formulas (the notebook, plain previews): each formula becomes its TeX.
export function plainText(text, formulas) {
  return String(text).replace(FORMULA_CHARS, char => { const tex = formulaAt(formulas, char)?.tex; return tex ? `$${tex}$` : ''; });
}

function cleanNode(node, budget, depth = 0) {
  if (typeof node === 'string') return node.slice(0, 500);
  if (!Array.isArray(node) || depth > 60 || --budget.left < 0) return null;
  const [tag, attrs, ...children] = node;
  const kept = {};
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) for (const [key, value] of Object.entries(attrs)) if (MATH_ATTRS.has(key) && typeof value === 'string' && SAFE_VALUE.test(value)) kept[key] = value;
  return [tag === 'math' || MATH_TAGS.has(tag) ? tag : 'mrow', kept, ...children.map(child => cleanNode(child, budget, depth + 1)).filter(child => child !== null)];
}

export function cleanFormulas(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 6000) throw new Error('formulas');
  return value.map(formula => {
    if (!formula || typeof formula !== 'object' || typeof formula.tex !== 'string' || formula.tex.length > 2000) throw new Error('formulas');
    const tree = cleanNode(formula.tree, { left:5000 });
    return { tex:formula.tex, display:formula.display === true, tree:tree?.[0] === 'math' ? tree : ['math', {}, ['mtext', {}, formula.tex]] };
  });
}

const shortText = (value, limit) => typeof value === 'string' && value.length <= limit ? value : '';
export function cleanFigures(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 500) throw new Error('figures');
  return value.map(figure => {
    if (!figure || typeof figure !== 'object') throw new Error('figures');
    const images = Array.isArray(figure.images) ? figure.images.filter(url => typeof url === 'string' && IMAGE_URL.test(url)).slice(0, 12) : [];
    const rows = Array.isArray(figure.rows) ? figure.rows.slice(0, 200).filter(Array.isArray).map(row => row.slice(0, 30).map(cell => shortText(cell, 300))) : [];
    const page = figure.kind === 'page' && Number.isInteger(figure.page) && figure.page > 0 ? figure.page : 0;
    return { label:shortText(figure.label, 40), kind:page ? 'page' : figure.kind === 'table' ? 'table' : 'figure', ...(page ? { page } : {}), images:page ? [] : images, caption:shortText(figure.caption, 3000), ...(rows.length && !page ? { rows } : {}), ...(shortText(figure.anchor, 200) ? { anchor:figure.anchor, where:figure.where === 'end' ? 'end' : 'start' } : {}) };
  }).filter(figure => figure.page || figure.images.length || figure.rows);
}

const figureKey = label => {
  const match = /^(fig(?:ure)?s?\.?|tab(?:le)?s?\.?)\s*([a-z]?\d+(?:\.\d+)?)/i.exec(label.trim());
  return match ? `${/^fig/i.test(match[1]) ? 'figure' : 'table'} ${match[2].toLowerCase()}` : '';
};

// Where in the text each figure becomes the one to look at: where the text mentions it, and where it stood in the paper.
export function figureEvents(text, figures) {
  if (!figures?.length) return [];
  const byKey = new Map(figures.map((figure, index) => [figureKey(figure.label || ''), index]).filter(([key]) => key));
  const events = [];
  for (const match of text.matchAll(/\b(?:Fig(?:ure)?s?\.?|Tables?|Tab\.)\s*[A-Z]?\d+(?:\.\d+)?/g)) {
    const index = byKey.get(figureKey(match[0]));
    if (index !== undefined) events.push({ at:match.index, index });
  }
  // Figures stand in the paper in order, so each place is searched for after the previous one (page headers repeat).
  let from = 0;
  figures.forEach((figure, index) => {
    if (!figure.anchor) return;
    const anchor = typeable(figure.anchor).trim();
    if (!anchor) return;
    let found = text.indexOf(anchor, from);
    if (found < 0) found = text.indexOf(anchor);
    if (found < 0) return;
    from = Math.max(from, found + 1);
    events.push({ at:figure.where === 'end' ? found + anchor.length : found, index });
  });
  return events.sort((a, b) => a.at - b.at);
}

// The figures that appear in a text, in the order they stand in the paper.
export function figuresInText(events) {
  return [...new Set(events.map(event => event.index))].sort((a, b) => a - b);
}

// The figure for a reading position: the last one mentioned or placed before it.
export function figureAt(events, position) {
  let found = null;
  for (const event of events) { if (event.at > position) break; found = event.index; }
  return found;
}

export function figureHtml(figure, formulas) {
  // A PDF page is drawn later by the reader; this only leaves its place.
  if (figure.kind === 'page') return `<a class="pdf-page-link" target="_blank" rel="noopener noreferrer"><img class="pdf-page" alt=""></a><p class="figure-caption" id="page-status"></p>`;
  const images = (Array.isArray(figure.images) ? figure.images : []).filter(url => IMAGE_URL.test(url)).map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(url)}" alt="${escapeHtml(figure.label || '')}" referrerpolicy="no-referrer"></a>`).join('');
  const table = Array.isArray(figure.rows) && figure.rows.length ? `<div class="figure-table"><table>${figure.rows.map(row => `<tr>${row.map(cell => `<td>${richText(cell, formulas)}</td>`).join('')}</tr>`).join('')}</table></div>` : '';
  return `${images}${table}<p class="figure-caption">${figure.label ? `<strong>${escapeHtml(figure.label)}</strong> ` : ''}${richText(figure.caption || '', formulas)}</p>`;
}
