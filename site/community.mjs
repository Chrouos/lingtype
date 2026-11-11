// The community bookshelf: ordering and filtering shared books, their default covers and the anonymous reader id.
const ID = /^[0-9a-f]{32}$/;
const number = value => Number.isFinite(value) && value >= 0 ? value : 0;

// The server's list, kept to what the page can show safely; older servers send only id, title and date.
export function cleanBooks(books) {
  if (!Array.isArray(books)) return [];
  return books.filter(book => book && ID.test(book.id) && typeof book.title === 'string').map(book => ({
    id:book.id, title:book.title, createdAt:typeof book.createdAt === 'string' ? book.createdAt : '',
    summary:typeof book.summary === 'string' ? book.summary : '', category:typeof book.category === 'string' ? book.category : '',
    words:number(book.words), likes:number(book.likes), reads:number(book.reads), starts:number(book.starts),
    authors:Array.isArray(book.authors) ? book.authors.filter(author => typeof author === 'string' && author.trim() && [...author].length <= 200).slice(0, 4) : [],
    completions:number(book.completions), practiceCount:number(book.practiceCount), comments:number(book.comments),
    completionRate:Number.isFinite(book.completionRate) ? Math.min(100, Math.max(0, book.completionRate)) : null,
    hasCover:book.hasCover === true,
  }));
}

// The bookshelf response: books, the fastest typists across books and the latest comments, each pointing at a book.
export function cleanShelf(data) {
  const pointsAtBook = row => row && ID.test(row.bookId) && typeof row.author === 'string' && typeof row.title === 'string';
  return {
    books:cleanBooks(data?.books),
    ranking:(Array.isArray(data?.ranking) ? data.ranking : []).filter(row => pointsAtBook(row) && Number.isFinite(row.wpm) && Number.isFinite(row.accuracy)),
    comments:(Array.isArray(data?.comments) ? data.comments : []).filter(row => pointsAtBook(row) && typeof row.text === 'string'),
  };
}

export const sorts =['likes', 'reads', 'completion', 'new'];
export function shelfBooks(books, { query = '', category = '', sort = 'likes' } = {}) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const chosen = books.filter(book => (!category || book.category === category) && words.every(word => `${book.title} ${book.summary} ${book.category}`.toLowerCase().includes(word)));
  const newest = (a, b) => b.createdAt.localeCompare(a.createdAt);
  const by = {
    likes:(a, b) => b.likes - a.likes || b.reads - a.reads || newest(a, b),
    reads:(a, b) => b.reads - a.reads || b.likes - a.likes || newest(a, b),
    // A book nobody has started has no rate yet and goes after the ones that do.
    completion:(a, b) => (b.completionRate ?? -1) - (a.completionRate ?? -1) || b.starts - a.starts || newest(a, b),
    new:newest,
  }[sort] || newest;
  return [...chosen].sort(by);
}
export function categories(books) {
  return [...new Set(books.map(book => book.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// About how long typing the whole text takes at an easy 30 words a minute.
export const typingMinutes = words => Math.max(1, Math.round(number(words) / 30));

const palettes = [['#2f4a43', '#e8dcc0'], ['#5a3e36', '#f1e3cf'], ['#273b52', '#e6d6a8'], ['#4b5236', '#efe6c8'], ['#5b3a52', '#f0dfe6'], ['#3d3d46', '#e9e4d6'], ['#6b4b2a', '#f3e6cf'], ['#2c4f5f', '#dcecef']];
export function coverColors(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palettes[hash % palettes.length];
}

export function readVisitor(storage) {
  try { const saved = storage?.getItem('lingtype-visitor'); if (ID.test(saved || '')) return saved; } catch { /* a fresh id is used for this visit */ }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const id = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  try { storage?.setItem('lingtype-visitor', id); } catch { /* counted again on another visit */ }
  return id;
}

// These credentials must be stored before publishing, so a lost response does
// not also lose the only authority to remove the newly published workbook.
export function createPublicationIdentity(crypto = globalThis.crypto) {
  if (!crypto?.getRandomValues) throw new Error('Secure random numbers unavailable');
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { id:hex.slice(0, 32), ownerKey:hex.slice(32) };
}
