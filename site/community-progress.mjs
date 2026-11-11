import { sessionStats } from './typing.mjs';
import { MAX_WORKBOOK_SECTIONS } from './data.mjs';

// An attempt stays in the outbox until the server acknowledges its stable ID.
const KEY = 'lingtype-public-progress';
const ID = /^[0-9a-f]{32}$/;
const blank = () => ({ progress:{}, outbox:[], starts:[], reads:[] });
function read(storage) {
  try {
    const data = JSON.parse(storage?.getItem(KEY) || 'null');
    if (!data || typeof data.progress !== 'object' || Array.isArray(data.progress) || !data.progress || !Array.isArray(data.outbox)) return blank();
    if (!Array.isArray(data.starts)) data.starts = [];
    if (!Array.isArray(data.reads)) data.reads = [];
    return data;
  } catch { return blank(); }
}
function write(storage, data) {
  try {
    const value = JSON.stringify(data);
    storage.setItem(KEY, value);
    return storage.getItem(KEY) === value;
  } catch { return false; }
}
function newId() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
}

// The caller supplies only a completely typed section. Repeating one replaces its
// score; it never fills another section. A changed book invalidates old parts.
export function recordPublicPart(storage, { bookId, signature, index, size, counts, elapsed, author, visitor }) {
  if (!ID.test(bookId) || !ID.test(visitor) || typeof signature !== 'string' || !Number.isInteger(size) || size < 1 || size > MAX_WORKBOOK_SECTIONS || !Number.isInteger(index) || index < 0 || index >= size || !Number.isFinite(counts?.correct) || !Number.isFinite(counts?.total) || counts.correct < 0 || counts.total <= 0 || counts.correct > counts.total || !Number.isFinite(elapsed) || elapsed < 0) return false;
  const data = read(storage);
  let progress = data.progress[bookId];
  if (!progress || progress.signature !== signature || progress.size !== size || !progress.parts || typeof progress.parts !== 'object') progress = { signature, size, parts:{} };
  progress.parts[index] = { correct:counts.correct, total:counts.total, elapsed };
  data.progress[bookId] = progress;
  const parts = Array.from({ length:size }, (_, i) => progress.parts[i]);
  if (parts.every(part => part && Number.isFinite(part.correct) && Number.isFinite(part.total) && Number.isFinite(part.elapsed) && part.total > 0 && part.correct >= 0 && part.correct <= part.total && part.elapsed >= 0)) {
    const totals = parts.reduce((acc, part) => ({ correct:acc.correct + part.correct, total:acc.total + part.total, elapsed:acc.elapsed + part.elapsed }), { correct:0, total:0, elapsed:0 });
    const { wpm, accuracy } = sessionStats(totals, totals.elapsed);
    // Timer resolution can make a short section take zero milliseconds. It
    // still counts as completed, but its speed cannot be reliably ranked.
    const completionOnly = wpm > 250 || parts.some(part => part.elapsed === 0);
    data.outbox.push({ bookId, attemptId:newId(), visitor, author:typeof author === 'string' ? author.slice(0, 40) : '', wpm:completionOnly ? 0 : wpm, accuracy, ...(completionOnly ? { completionOnly:true } : {}) });
    delete data.progress[bookId];
  }
  return write(storage, data);
}

export function pendingPublicAttempts(storage) {
  return read(storage).outbox.filter(item => item && ID.test(item.bookId) && ID.test(item.attemptId) && ID.test(item.visitor) && typeof item.author === 'string' && item.author.length <= 40 && Number.isFinite(item.wpm) && item.wpm >= 0 && item.wpm <= 250 && Number.isFinite(item.accuracy) && item.accuracy >= 0 && item.accuracy <= 100 && (item.completionOnly === undefined || typeof item.completionOnly === 'boolean'));
}
export function acknowledgePublicAttempt(storage, attemptId) {
  const data = read(storage);
  data.outbox = data.outbox.filter(item => item?.attemptId !== attemptId);
  return write(storage, data);
}

function queueVisit(storage, kind, bookId, visitor) {
  if (!ID.test(bookId) || !ID.test(visitor)) return false;
  const data = read(storage);
  if (data[kind].some(item => item?.bookId === bookId && item?.visitor === visitor)) return true;
  data[kind].push({ bookId, visitor });
  return write(storage, data);
}

function pendingVisits(storage, kind) {
  return read(storage)[kind].filter(item => item && ID.test(item.bookId) && ID.test(item.visitor));
}

function acknowledgeVisit(storage, kind, bookId, visitor) {
  const data = read(storage);
  data[kind] = data[kind].filter(item => item?.bookId !== bookId || item?.visitor !== visitor);
  return write(storage, data);
}
export const queuePublicStart = (storage, bookId, visitor) => queueVisit(storage, 'starts', bookId, visitor);
export const pendingPublicStarts = storage => pendingVisits(storage, 'starts');
export const acknowledgePublicStart = (storage, bookId, visitor) => acknowledgeVisit(storage, 'starts', bookId, visitor);
export const queuePublicRead = (storage, bookId, visitor) => queueVisit(storage, 'reads', bookId, visitor);
export const pendingPublicReads = storage => pendingVisits(storage, 'reads');

// A connection can remain pending indefinitely behind a broken proxy. Keep the
// stable attempt ID in the outbox and let the normal retry policy try again.
export async function withPublicAttemptTimeout(send, timeoutMs = 20000) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer, expired = false;
  try {
    return await Promise.race([
      Promise.resolve().then(() => send(controller?.signal, () => expired)),
      new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error('Community request timed out')); controller?.abort(); }, timeoutMs);
      })
    ]);
  } finally { clearTimeout(timer); }
}

// Validation errors and a removed resource cannot be fixed by resending this
// payload. Network failures, rate limits and server errors may be transient.
async function drain(records, send, acknowledge, shouldStop) {
  let retry = false, discarded = 0, capacity = false;
  for (const { bookId, ...payload } of records) {
    if (shouldStop()) break;
    try {
      const response = await send(bookId, payload);
      if (shouldStop()) break;
      if (response.status === 507) capacity = true;
      const permanent = [400, 404, 410, 422].includes(response.status);
      if (response.ok || permanent) {
        if (!acknowledge(bookId, payload)) retry = true;
        else if (permanent) discarded++;
      } else retry = true;
    } catch { retry = true; }
  }
  return { retry, discarded, ...(capacity ? { capacity:true } : {}) };
}

export function drainPublicAttempts(storage, send, shouldStop = () => false) {
  return drain(pendingPublicAttempts(storage), send, (_id, payload) => acknowledgePublicAttempt(storage, payload.attemptId), shouldStop);
}

export function drainPublicStarts(storage, send, shouldStop = () => false) {
  return drain(pendingPublicStarts(storage), send, (bookId, payload) => acknowledgePublicStart(storage, bookId, payload.visitor), shouldStop);
}

export function drainPublicReads(storage, send, shouldStop = () => false) {
  return drain(pendingPublicReads(storage), send, (bookId, payload) => acknowledgeVisit(storage, 'reads', bookId, payload.visitor), shouldStop);
}
