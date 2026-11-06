const LARGE_KEYS = ['lingtype-custom-lessons', 'lingtype-translations'];

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
    write(key, value) { return new Promise((resolve, reject) => { const tx = db.transaction('values', 'readwrite'); tx.objectStore('values').put(value, key); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); },
    keys(prefix) { return new Promise((resolve, reject) => { const tx = db.transaction('values'); const req = tx.objectStore('values').getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)); req.onsuccess = () => resolve(req.result.map(String)); req.onerror = () => reject(req.error); }); },
    remove(key) { return new Promise((resolve, reject) => { const tx = db.transaction('values', 'readwrite'); tx.objectStore('values').delete(key); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); }
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
    getItem(key) { return LARGE_KEYS.includes(key) ? values.get(key) ?? null : local?.getItem(key) ?? null; },
    setItem(key, value) {
      if (!LARGE_KEYS.includes(key)) return local?.setItem(key, value);
      values.set(key, String(value));
      pending = pending.then(() => backend.write(key, String(value))).catch(error => { failure = error; onError(error); });
    },
    removeItem(key) {
      if (!LARGE_KEYS.includes(key)) return local?.removeItem(key);
      values.delete(key);
      pending = pending.then(() => backend.write(key, null)).catch(error => { failure = error; onError(error); });
    },
    async flush() { await pending; if (failure) { const error = failure; failure = null; throw error; } }
  };
}
