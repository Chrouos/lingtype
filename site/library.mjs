import { cleanFigures, cleanFormulas } from './paper.mjs';

// Figures and formulas are checked again on reading, since a restored backup may carry anything.
function cleanPaper(item) {
  for (const [key, clean] of [['figures', cleanFigures], ['formulas', cleanFormulas]]) {
    if (item[key] === undefined) continue;
    try { item[key] = key === 'figures' ? clean(item[key], {allowPdfPages:true}) : clean(item[key]); } catch { delete item[key]; }
  }
  return item;
}

export function readCustomLessons(storage) {
  try {
    const saved = JSON.parse(storage?.getItem('lingtype-custom-lessons') || 'null');
    if (Array.isArray(saved)) return saved.filter(item => item && typeof item.text === 'string' && item.text.trim()).map(cleanPaper);
    const legacy = JSON.parse(storage?.getItem('lingtype-custom-lesson') || 'null');
    return legacy && typeof legacy.text === 'string' && legacy.text.trim() ? [legacy] : [];
  } catch { return []; }
}

export function addCustomLesson(existing, item) {
  return [...existing.filter(entry => entry.id !== item.id), item];
}

// Save a new independent copy without replacing an existing lesson. IndexedDB
// writes use a conditional transaction; plain localStorage is synchronous and
// relies on the application's existing single-editor lock.
export async function persistEditedCopy(storage, copy) {
  const key = 'lingtype-custom-lessons';
  if (!storage || storage.volatile || !copy || copy.custom !== true || typeof copy.id !== 'string' || !copy.id || Object.hasOwn(copy, 'publicId')) throw new Error('Cannot save an edited copy');
  const serializedCopy = JSON.stringify(copy);
  const savedCopy = JSON.parse(serializedCopy);
  if (!savedCopy || savedCopy.custom !== true || typeof savedCopy.id !== 'string' || !savedCopy.id || Object.hasOwn(savedCopy, 'publicId')) throw new Error('Cannot save an edited copy');
  const parse = value => {
    if (value === null) return [];
    const result = JSON.parse(value);
    if (!Array.isArray(result)) throw new Error('Invalid lesson storage');
    return result;
  };
  await storage.flush?.();
  const before = storage.getItem(key), lessons = parse(before);
  if (lessons.some(item => item?.id === savedCopy.id)) throw new Error('Lesson already exists');
  const next = JSON.stringify([...lessons, savedCopy]);
  const conditional = typeof storage.readDurable === 'function' && typeof storage.compareAndSetDurable === 'function' && typeof storage.replaceCachedIfUnchanged === 'function';
  if (conditional && await storage.readDurable(key) !== before) throw new Error('Lesson storage is out of sync');
  let committed = false;
  try {
    if (conditional) {
      committed = await storage.compareAndSetDurable(key, before, next);
      if (!committed) throw new Error('Lesson storage changed');
    } else {
      if (storage.flush) throw new Error('Durable conditional storage unavailable');
      storage.setItem(key, next);
      committed = true;
    }
    let flushError;
    try { await storage.flush?.(); } catch (error) { flushError = error; }
    const current = storage.getItem(key);
    const durable = conditional ? await storage.readDurable(key) : current;
    const saved = current === durable && storage.getItem(key) === current && parse(current).some(item => item?.id === savedCopy.id && JSON.stringify(item) === serializedCopy);
    if (flushError) throw flushError;
    if (saved) return savedCopy;
    throw new Error('Edited copy was not saved');
  } catch (error) {
    let cleanupFailed = false;
    if (committed) {
      const withoutCopy = value => {
        const items = parse(value), own = items.find(item => item?.id === savedCopy.id);
        if (!own || JSON.stringify(own) !== serializedCopy) return value;
        return value === next ? before : JSON.stringify(items.filter(item => item?.id !== savedCopy.id));
      };
      if (conditional) {
        // Compare against the latest durable value; a concurrent writer's
        // other lessons must never be replaced by the old snapshot.
        let cleaned = false, cleanedValue;
        try {
          for (let attempt = 0; attempt < 3; attempt++) {
            const durable = await storage.readDurable(key), reduced = withoutCopy(durable);
            if (durable === reduced || await storage.compareAndSetDurable(key, durable, reduced, {requireCache:false})) { cleaned = true; cleanedValue = reduced; break; }
          }
          if (cleaned) {
            const current = storage.getItem(key), reduced = current === next ? cleanedValue : withoutCopy(current);
            if (current !== reduced) storage.replaceCachedIfUnchanged(key, current, reduced);
          }
        } catch { cleanupFailed = true; }
        if (!cleaned) cleanupFailed = true;
      } else {
        try {
          const current = storage.getItem(key), reduced = withoutCopy(current);
          if (current !== reduced) {
            if (reduced === null) storage.removeItem(key); else storage.setItem(key, reduced);
            if (storage.getItem(key) !== reduced) cleanupFailed = true;
          }
        } catch { cleanupFailed = true; }
      }
    }
    if (cleanupFailed) throw Object.assign(new Error('Edited copy cleanup could not be confirmed', {cause:error}), {code:'cleanup_failed'});
    throw error;
  }
}

// Do not remove a PDF until the corresponding lesson deletion is durable.
export async function persistLessonRemoval(storage, lessons, id) {
  const key = 'lingtype-custom-lessons', before = storage.getItem(key);
  const next = JSON.stringify(lessons.filter(item => item.custom && item.id !== id));
  try {
    storage.setItem(key, next);
    await storage.flush?.();
    if (storage.getItem(key) !== next) throw new Error('Lessons changed during deletion');
  } catch (error) {
    // Do not overwrite another change that arrived while the write was pending.
    if (storage.getItem(key) === next) {
      try {
        if (before === null) storage.removeItem(key); else storage.setItem(key, before);
        await storage.flush?.();
      } catch { throw new Error('Lesson deletion rollback failed', {cause:error}); }
    }
    throw error;
  }
}

function builtinMap(storage) {
  try { const data = JSON.parse(storage?.getItem('lingtype-builtin-words') || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; }
}
export function readBuiltinWords(storage, id) {
  const words = builtinMap(storage)[id];
  return Array.isArray(words) && words.every(word => Array.isArray(word) && word.length === 4 && word.every(value => typeof value === 'string')) ? words : null;
}
export function saveBuiltinWords(storage, id, words) {
  const data = builtinMap(storage); data[id] = words;
  try { storage?.setItem('lingtype-builtin-words', JSON.stringify(data)); return true; } catch { return false; }
}
