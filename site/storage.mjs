const LARGE_KEYS = ['lingtype-custom-lessons', 'lingtype-translations'];
const pdfRevision = () => `${Date.now()}-${Math.random()}-${Math.random()}`;

// Browsers can throw even when reading the localStorage property (for example
// when storage is blocked). Keep the current session usable in memory.
export function availableLocalStorage(scope, onError = () => {}) {
  try {
    const local = scope.localStorage;
    if (local) return local;
  } catch { /* use volatile storage below */ }
  onError();
  const values = new Map();
  return {
    volatile:true,
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }
  };
}

export async function openLargeDatabase(indexedDB) {
  if (!indexedDB) return null;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('lingtype-data', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('values');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database blocked'));
  });
  return {
    read(key) { return new Promise((resolve, reject) => { const tx = db.transaction('values'); const req = tx.objectStore('values').get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); },
    write(key, value) { return new Promise((resolve, reject) => { const tx = db.transaction('values', 'readwrite'), store = tx.objectStore('values'); store.put(value, key); if (key.startsWith('pdf:')) store.put(pdfRevision(), 'pdf-revision'); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error || new Error('Database write aborted')); }); },
    compareAndSet(key, expected, value) { return new Promise((resolve, reject) => {
      const tx = db.transaction('values', 'readwrite'), store = tx.objectStore('values');
      let matched = false;
      const request = store.get(key);
      request.onsuccess = () => {
        if ((request.result ?? null) !== expected) return;
        matched = true;
        if (value === null) store.delete(key); else store.put(value, key);
      };
      tx.oncomplete = () => resolve(matched);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Conditional write aborted'));
    }); },
    keys(prefix) { return new Promise((resolve, reject) => { const tx = db.transaction('values'); const req = tx.objectStore('values').getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)); req.onsuccess = () => resolve(req.result.map(String)); req.onerror = () => reject(req.error); }); },
    remove(key) { return new Promise((resolve, reject) => { const tx = db.transaction('values', 'readwrite'), store = tx.objectStore('values'); store.delete(key); if (key.startsWith('pdf:')) store.put(pdfRevision(), 'pdf-revision'); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error || new Error('Database removal aborted')); }); },
    replacePrefix(prefix, entries) { return new Promise((resolve, reject) => {
      const tx = db.transaction('values', 'readwrite'), store = tx.objectStore('values');
      if (prefix === 'pdf:') store.put(pdfRevision(), 'pdf-revision');
      const cursor = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      cursor.onsuccess = () => { const item = cursor.result; if (item) { item.delete(); item.continue(); } else { for (const [key, value] of entries) store.put(value, key); } };
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('PDF transaction aborted'));
    }); },
    // Publishing new PDFs and retiring the recovery journal must be atomic.
    commitRestore(entries, preserveExisting = false, expectedRevision) { return new Promise((resolve, reject) => {
      const tx = db.transaction('values', 'readwrite'), store = tx.objectStore('values');
      let conflict = false;
      if (entries === null) store.delete('pending-restore');
      else if (preserveExisting) {
        const revision = store.get('pdf-revision');
        revision.onsuccess = () => {
          if (revision.result !== expectedRevision) { conflict = true; tx.abort(); return; }
          for (const [key, value] of entries) {
            const request = store.getKey(key);
            request.onsuccess = () => { if (request.result === undefined) store.put(value, key); };
          }
          store.put(pdfRevision(), 'pdf-revision'); store.delete('pending-restore');
        };
      }
      else {
        store.put(pdfRevision(), 'pdf-revision');
        const cursor = store.openCursor(IDBKeyRange.bound('pdf:', 'pdf:\uffff'));
        cursor.onsuccess = () => { const item = cursor.result; if (item) { item.delete(); item.continue(); } else { for (const [key, value] of entries) store.put(value, key); store.delete('pending-restore'); } };
      }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(conflict ? Object.assign(new Error('Legacy PDF conflict'), {code:'legacy_pdf_conflict'}) : tx.error || new Error('Restore transaction aborted'));
    }); },
    mergeMissing(entries, expectedRevision) { return new Promise((resolve, reject) => {
      const tx = db.transaction('values', 'readwrite'), store = tx.objectStore('values');
      let conflict = false;
      const revision = store.get('pdf-revision');
      revision.onsuccess = () => {
        if (revision.result !== expectedRevision) { conflict = true; tx.abort(); return; }
        for (const [key, value] of entries) {
          const request = store.getKey(key);
          request.onsuccess = () => { if (request.result === undefined) store.put(value, key); };
        }
        store.put(pdfRevision(), 'pdf-revision');
      };
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(conflict ? Object.assign(new Error('Legacy PDF conflict'), {code:'legacy_pdf_conflict'}) : tx.error || new Error('PDF transaction aborted'));
    }); }
  };
}

export async function createLargeStorage(local, backend, onError = () => {}) {
  if (!backend) return local;
  const values = new Map();
  for (const key of LARGE_KEYS) {
    let value = await backend.read(key);
    if (value === undefined) {
      value = local?.getItem(key) ?? null;
      if (value !== null) await backend.write(key, value);
    }
    if (value !== null && value !== undefined) values.set(key, value);
  }
  let pending = Promise.resolve();
  let failure = null;
  return {
    volatile:local?.volatile === true,
    getItem(key) { return LARGE_KEYS.includes(key) ? values.get(key) ?? null : local?.getItem(key) ?? null; },
    setItem(key, value) {
      if (!LARGE_KEYS.includes(key)) return local?.setItem(key, value);
      values.set(key, String(value));
      pending = pending.then(() => backend.write(key, String(value))).catch(error => { failure = error ?? new Error('Database write failed'); onError(error); });
    },
    removeItem(key) {
      if (!LARGE_KEYS.includes(key)) return local?.removeItem(key);
      values.delete(key);
      pending = pending.then(() => backend.write(key, null)).catch(error => { failure = error ?? new Error('Database write failed'); onError(error); });
    },
    async flush() { await pending; if (failure !== null) { const error = failure; failure = null; throw error; } },
    async readDurable(key) {
      if (!LARGE_KEYS.includes(key) || typeof backend.compareAndSet !== 'function') throw new Error('Durable conditional storage unavailable');
      return (await backend.read(key)) ?? null;
    },
    replaceCachedIfUnchanged(key, expected, value) {
      if (!LARGE_KEYS.includes(key) || (values.get(key) ?? null) !== expected) return false;
      if (value === null) values.delete(key); else values.set(key, value);
      return true;
    },
    async compareAndSetDurable(key, expected, value, { requireCache = true } = {}) {
      if (!LARGE_KEYS.includes(key) || typeof backend.compareAndSet !== 'function') throw new Error('Durable conditional storage unavailable');
      const operation = pending.then(async () => {
        if (failure !== null) throw failure;
        if (requireCache && (values.get(key) ?? null) !== expected) return false;
        const matched = await backend.compareAndSet(key, expected, value);
        if (matched && (values.get(key) ?? null) === expected) {
          if (value === null) values.delete(key); else values.set(key, value);
        }
        return matched;
      });
      pending = operation.catch(() => {});
      return operation;
    }
  };
}
