export function readCustomLessons(storage) {
  try {
    const saved = JSON.parse(storage?.getItem('lingtype-custom-lessons') || 'null');
    if (Array.isArray(saved)) return saved.filter(item => item && typeof item.text === 'string' && item.text.trim());
    const legacy = JSON.parse(storage?.getItem('lingtype-custom-lesson') || 'null');
    return legacy && typeof legacy.text === 'string' && legacy.text.trim() ? [legacy] : [];
  } catch { return []; }
}

export function addCustomLesson(existing, item) {
  return [...existing.filter(entry => entry.id !== item.id), item];
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
