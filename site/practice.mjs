const key = 'lingtype-progress';
export const snapshotKey = (id, mode, section, passage) => JSON.stringify([id, mode, section, passage]);
function readAll(storage) {
  try { const value = JSON.parse(storage?.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
export function readSnapshot(storage, id) { return readAll(storage)[id] || null; }
export function saveSnapshot(storage, id, value) {
  const data = readAll(storage); data[id] = value;
  try { storage?.setItem(key, JSON.stringify(data)); return true; } catch { return false; }
}
export function clearSnapshot(storage, id) {
  const data = readAll(storage); delete data[id];
  try { storage?.setItem(key, JSON.stringify(data)); return true; } catch { return false; }
}
export function clearModeSnapshots(storage, lessonId, mode) {
  const data = readAll(storage);
  for (const id of Object.keys(data)) {
    try { const parts = JSON.parse(id); if (parts[0] === lessonId && parts[1] === mode) delete data[id]; } catch { /* ignore unrelated keys */ }
  }
  try { storage?.setItem(key, JSON.stringify(data)); return true; } catch { return false; }
}
export function hasModeSnapshots(storage, lessonId, mode) {
  return Object.keys(readAll(storage)).some(id => {
    try { const parts = JSON.parse(id); return parts[0] === lessonId && parts[1] === mode; } catch { return false; }
  });
}
export function passageId(text) {
  let a = 2166136261, b = 5381;
  for (const char of text) { const code = char.codePointAt(0); a = Math.imul(a ^ code, 16777619); b = Math.imul(b, 33) ^ code; }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export function wrongWordAt(text, position) {
  if (!/[A-Za-z'’]/.test(text[position] || '')) return null;
  let start = position, end = position + 1;
  while (start > 0 && /[A-Za-z'’]/.test(text[start - 1])) start--;
  while (end < text.length && /[A-Za-z'’]/.test(text[end])) end++;
  return text.slice(start, end).toLowerCase().replace('’', "'");
}
export function comparison(history, current) {
  const prior = history.filter(item => item.lessonId === current.lessonId && item.mode === current.mode && item.passage === current.passage && Number.isFinite(item.wpm));
  if (!prior.length) return null;
  return { previous:prior[0].wpm, best:Math.max(...prior.map(item => item.wpm)), delta:Math.round((current.wpm - prior[0].wpm) * 10) / 10 };
}
function bestKey(record) {
  let hash = 2166136261;
  for (const char of record.passage) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return JSON.stringify([record.lessonId, record.mode, record.passage.length, hash >>> 0]);
}
function readBests(storage) {
  try { const value = JSON.parse(storage?.getItem('lingtype-best-results') || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
export function bestResult(storage, record) {
  const value = readBests(storage)[bestKey(record)];
  return Number.isFinite(value) ? value : null;
}
export function saveBest(storage, record) {
  const values = readBests(storage), id = bestKey(record);
  values[id] = Math.max(values[id] ?? 0, record.wpm);
  try { storage?.setItem('lingtype-best-results', JSON.stringify(values)); return true; } catch { return false; }
}
