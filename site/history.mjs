const key = 'lingtype-practice-history';
export function readHistory(storage) {
  try {
    const data = JSON.parse(storage?.getItem(key) || '[]');
    return Array.isArray(data) ? data.filter(item => item && typeof item.title === 'string' && ['word', 'article'].includes(item.mode)).slice(0, 10) : [];
  } catch { return []; }
}
export function saveResult(storage, result) {
  const history = [result, ...readHistory(storage)].slice(0, 10);
  try { storage?.setItem(key, JSON.stringify(history)); return true; } catch { return false; }
}
