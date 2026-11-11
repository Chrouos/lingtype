const key = 'lingtype-practice-history';
function historyForUpdate(storage) {
  let raw;
  try { raw = storage?.getItem(key); } catch { return null; }
  try {
    const data = JSON.parse(raw || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(item => item && typeof item.title === 'string' && ['word', 'article'].includes(item.mode)).slice(0, 10).map(item => {
      const result = {...item};
      for (const field of ['wpm', 'accuracy', 'errors', 'elapsed']) if (result[field] && typeof result[field] === 'object') result[field] = 0;
      if (result.date && typeof result.date === 'object') result.date = '';
      return result;
    });
  } catch { return []; }
}
export function readHistory(storage) { return historyForUpdate(storage) || []; }
export function saveResult(storage, result) {
  const previous = historyForUpdate(storage);
  if (!previous) return false;
  const history = [result, ...previous].slice(0, 10);
  try { storage?.setItem(key, JSON.stringify(history)); return true; } catch { return false; }
}
