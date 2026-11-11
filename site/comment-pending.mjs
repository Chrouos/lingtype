// Keep each uncertain submission so editing a draft cannot discard the ID of
// a previously accepted comment whose response was lost. A confirmed comment
// is removed, allowing the reader to post the same text again intentionally.
const KEY = 'lingtype-pending-comments';
const ID = /^[0-9a-f]{32}$/;

export function createCommentTracker(storage) {
  let fallback = {}, persistent = !!storage;
  function read() {
    if (!persistent) return fallback;
    try {
      const value = JSON.parse(storage?.getItem(KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { persistent = false; return fallback; }
  }
  function write(value) {
    fallback = value;
    if (!persistent) return;
    try {
      const json = JSON.stringify(value);
      storage.setItem(KEY, json);
      if (storage.getItem(KEY) !== json) persistent = false;
    } catch { persistent = false; /* retained for this session */ }
  }
  function randomId() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return {
    isPersistent() { return persistent && storage?.volatile !== true; },
    pending(bookId) {
      const value = read()[bookId];
      return (Array.isArray(value) ? value : value ? [value] : [])
        .filter(item => item && ID.test(item.id) && typeof item.author === 'string' && item.author.length <= 40 && typeof item.text === 'string' && item.text.length <= 1000)
        .map(({id, author, text}) => ({id, author, text}));
    },
    begin(bookId, author, text) {
      const pending = read(), value = pending[bookId];
      // Accept the previous one-record format from browsers already using it.
      const records = (Array.isArray(value) ? value : value ? [value] : [])
        .filter(item => item && ID.test(item.id) && typeof item.author === 'string' && typeof item.text === 'string');
      const old = records.find(item => item.author === author && item.text === text);
      if (old) return old.id;
      const id = randomId();
      records.push({ id, author, text });
      pending[bookId] = records;
      write(pending);
      return id;
    },
    confirm(bookId, id) {
      const pending = read(), value = pending[bookId];
      const records = Array.isArray(value) ? value : value ? [value] : [];
      if (!records.some(item => item?.id === id)) return;
      const remaining = records.filter(item => item?.id !== id);
      if (remaining.length) pending[bookId] = remaining;
      else delete pending[bookId];
      write(pending);
    }
  };
}
