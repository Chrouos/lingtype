import { validReadingData } from './reading.mjs';

export const BACKUP_KEYS = ['lingtype-custom-lessons','lingtype-custom-lesson','lingtype-translations','lingtype-notebook','lingtype-builtin-words','lingtype-progress','lingtype-practice-history','lingtype-best-results','lingtype-last-practice','lingtype-language','lingtype-published-keys','lingtype-public-progress','lingtype-visitor','lingtype-reader-name','lingtype-pending-comments','lingtype-reading'];
const arrays = new Set(['lingtype-custom-lessons','lingtype-notebook','lingtype-practice-history']);
const legacyOptional = new Set(['lingtype-visitor', 'lingtype-reader-name', 'lingtype-pending-comments']);
export const MAX_BACKUP_BYTES = 200_000_000;
const MAX_PDF_BYTES = 20_000_000;
const pdfsSymbol = Symbol('backup PDFs');
const checksumsSymbol = Symbol('PDF checksums');
const legacyPdfsSymbol = Symbol('legacy PDFs without checksums');

async function pdfDigest(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('PDF checksum unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createBackup(storage) {
  const data = {};
  for (const key of BACKUP_KEYS) {
    const value = storage?.getItem(key);
    if (value !== null && value !== undefined) data[key] = value;
  }
  return {format:'lingtype-backup', version:1, data};
}

function pageLessons(data) {
  const saved = JSON.parse(data['lingtype-custom-lessons'] || 'null');
  const legacy = JSON.parse(data['lingtype-custom-lesson'] || 'null');
  const lessons = Array.isArray(saved) ? saved : legacy ? [legacy] : [];
  return lessons.filter(item => item?.figures?.some(figure => figure?.kind === 'page'));
}

// Version 3 adds a checksum for every original PDF.
export async function createBackupWithPdfs(storage, database) {
  const file = createBackup(storage), pdfs = [];
  for (const lesson of pageLessons(file.data)) {
    if (!database) throw new Error('PDF storage unavailable');
    const blob = await database.read(`pdf:${lesson.id}`);
    if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_PDF_BYTES) throw new Error('Missing PDF');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    pdfs.push({id:lesson.id, data:btoa(binary), sha256:await pdfDigest(bytes)});
  }
  return {...file, version:3, pdfs};
}

export function readBackup(json) {
  if (typeof json !== 'string' || json.length > MAX_BACKUP_BYTES) throw new Error('Invalid backup');
  const file = JSON.parse(json);
  if (!file || file.format !== 'lingtype-backup' || ![1, 2, 3].includes(file.version) || !file.data || typeof file.data !== 'object' || Array.isArray(file.data)) throw new Error('Invalid backup');
  for (const [key, value] of Object.entries(file.data)) {
    if (!BACKUP_KEYS.includes(key) || typeof value !== 'string') throw new Error('Invalid backup');
    if (key === 'lingtype-language') { if (!['zh','ja','ko'].includes(value)) throw new Error('Invalid backup'); continue; }
    if (key === 'lingtype-visitor') { if (!/^[0-9a-f]{32}$/.test(value)) throw new Error('Invalid backup'); continue; }
    if (key === 'lingtype-reader-name') { if (value.length > 40) throw new Error('Invalid backup'); continue; }
    const parsed = JSON.parse(value);
    if (arrays.has(key) ? !Array.isArray(parsed) : (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('Invalid backup');
    if (key === 'lingtype-custom-lessons' && parsed.some(item => !item || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.text !== 'string' || !Array.isArray(item.words))) throw new Error('Invalid backup');
    if (key === 'lingtype-reading' && !validReadingData(parsed)) throw new Error('Invalid backup');
    if (key === 'lingtype-notebook' && parsed.some(item => !item || typeof item.word !== 'string' || !Array.isArray(item.sentences) || !item.translations || typeof item.translations !== 'object')) throw new Error('Invalid backup');
  }
  if (file.version >= 2) {
    if (!Array.isArray(file.pdfs)) throw new Error('Invalid backup');
    const expected = new Set(pageLessons(file.data).map(lesson => lesson.id)), pdfs = new Map(), checksums = new Map();
    for (const item of file.pdfs) {
      if (!item || typeof item.id !== 'string' || !expected.has(item.id) || pdfs.has(`pdf:${item.id}`) || typeof item.data !== 'string' || item.data.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 || item.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error('Invalid backup');
      const binary = atob(item.data);
      if (!binary.length || binary.length > MAX_PDF_BYTES || (file.version === 3 && (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)))) throw new Error('Invalid backup');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      pdfs.set(`pdf:${item.id}`, new Blob([bytes], {type:'application/pdf'}));
      if (file.version === 3) checksums.set(`pdf:${item.id}`, item.sha256);
    }
    if (pdfs.size !== expected.size) throw new Error('Invalid backup');
    Object.defineProperty(file.data, pdfsSymbol, {value:pdfs});
    if (file.version === 3) Object.defineProperty(file.data, checksumsSymbol, {value:checksums});
    else Object.defineProperty(file.data, legacyPdfsSymbol, {value:true});
  }
  return file.data;
}

const isLegacyPdfBackup = data => data?.[legacyPdfsSymbol] === true;
export const hasUnverifiedPdfs = data => isLegacyPdfBackup(data) && data[pdfsSymbol].size > 0;

// Parsing checks structure synchronously; verify every checksum before writes.
export async function verifyBackup(data) {
  const checksums = data?.[checksumsSymbol];
  if (!checksums) return;
  for (const [key, expected] of checksums) {
    const actual = await pdfDigest(await data[pdfsSymbol].get(key).arrayBuffer());
    if (actual !== expected) throw new Error('PDF checksum mismatch');
  }
}

// A v2 PDF has no checksum. Never pair its text with different bytes already
// stored under the same lesson ID, or overwrite the existing original.
export async function verifyLegacyPdfCompatibility(data, database) {
  if (!isLegacyPdfBackup(data)) return;
  if (!database?.read) throw new Error('PDF storage unavailable');
  const revision = await database.read('pdf-revision');
  for (const [key, incoming] of data[pdfsSymbol]) {
    const existing = await database.read(key);
    if (existing === undefined || existing === null) continue;
    if (!(existing instanceof Blob) || existing.size !== incoming.size) throw Object.assign(new Error('Legacy PDF conflict'), {code:'legacy_pdf_conflict'});
    const a = new Uint8Array(await existing.arrayBuffer()), b = new Uint8Array(await incoming.arrayBuffer());
    if (a.some((value, index) => value !== b[index])) throw Object.assign(new Error('Legacy PDF conflict'), {code:'legacy_pdf_conflict'});
  }
  if (await database.read('pdf-revision') !== revision) throw Object.assign(new Error('Legacy PDF conflict'), {code:'legacy_pdf_conflict'});
  return revision;
}

function writeSnapshot(storage, values, preserveLegacyIdentity = false) {
  for (const key of BACKUP_KEYS) {
    if (Object.hasOwn(values, key)) storage.setItem(key, values[key]);
    else if (preserveLegacyIdentity && legacyOptional.has(key)) continue;
    else storage.removeItem(key);
  }
}

export async function restoreBackup(storage, data, database, before = createBackup(storage).data, journal = false) {
  await verifyBackup(data);
  const pdfRevision = await verifyLegacyPdfCompatibility(data, database);
  try {
    writeSnapshot(storage, data, true);
    await storage.flush?.();
    if (journal) {
      if (!database?.commitRestore) throw new Error('Restore journal unavailable');
      await database.commitRestore(data[pdfsSymbol] ?? null, isLegacyPdfBackup(data), pdfRevision);
    } else if (data[pdfsSymbol]) {
      if (isLegacyPdfBackup(data)) {
        if (!database?.mergeMissing) throw new Error('PDF storage unavailable');
        await database.mergeMissing(data[pdfsSymbol], pdfRevision);
      } else {
        if (!database?.replacePrefix) throw new Error('PDF storage unavailable');
        await database.replacePrefix('pdf:', data[pdfsSymbol]);
      }
    }
  } catch (error) {
    try { writeSnapshot(storage, before); await storage.flush?.(); } catch { throw Object.assign(new Error('Restore failed; rollback also failed', {cause:error}), {recoveryPending:true}); }
    throw error;
  }
}

// The journal survives reloads, so an interruption cannot replace the only
// copy of the previous data with a half-restored state.
export async function stageBackupRestore(storage, database, json) {
  if (storage?.volatile) throw new Error('Restore requires persistent storage');
  const data = readBackup(json);
  await verifyBackup(data);
  await verifyLegacyPdfCompatibility(data, database);
  await storage.flush?.();
  await database.write('pending-restore', {version:1, json, before:createBackup(storage).data});
}

export async function applyStagedBackup(storage, database, staged) {
  let journal = staged;
  // Accept the old staged-string format from a previous release.
  if (typeof staged === 'string') {
    journal = {version:1, json:staged, before:createBackup(storage).data};
    try { await database.write('pending-restore', journal); }
    catch (error) { throw Object.assign(error, {recoveryPending:true}); }
  }
  if (!journal || journal.version !== 1 || typeof journal.json !== 'string' || !journal.before || typeof journal.before !== 'object' || Array.isArray(journal.before) || Object.entries(journal.before).some(([key, value]) => !BACKUP_KEYS.includes(key) || typeof value !== 'string')) throw Object.assign(new Error('Invalid restore journal'), {recoveryPending:true});
  let data;
  try {
    // Repeat this first after any interruption, even if the prior run had
    // already written only part of the new backup.
    writeSnapshot(storage, journal.before);
    await storage.flush?.();
    data = readBackup(journal.json);
    await verifyBackup(data);
  } catch (error) { throw Object.assign(error, {recoveryPending:true}); }
  try { await restoreBackup(storage, data, database, journal.before, true); }
  catch (error) {
    if (error.recoveryPending) throw error;
    try { await database.remove('pending-restore'); }
    catch (removeError) { throw Object.assign(removeError, {recoveryPending:true}); }
    throw error;
  }
}
