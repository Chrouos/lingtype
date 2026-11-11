export function readTranslationCache(storage) {
  try {
    const value = JSON.parse(storage?.getItem('lingtype-translations') || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function createTranslationCache(storage, request, existing) {
  const cache = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : readTranslationCache(storage);
  const pending = new Map();
  const revisions = new Map();
  const key = (sentence, language) => `${language}\u0000${sentence}`;
  const get = (sentence, language) => {
    const value = cache[key(sentence, language)];
    return typeof value === 'string' && value.trim() && (value.trim() !== sentence || cache[`manual\u0000${key(sentence, language)}`]) ? value : '';
  };
  function set(sentence, language, value) {
    if (!sentence || !['zh', 'ja', 'ko'].includes(language) || typeof value !== 'string' || !value.trim()) return false;
    const id = key(sentence, language);
    revisions.set(id, (revisions.get(id) || 0) + 1);
    cache[id] = value.trim();
    cache[`manual\u0000${id}`] = '1';
    try { storage?.setItem('lingtype-translations', JSON.stringify(cache)); return true; } catch { return false; }
  }
  function remember(byLanguage) {
    if (!byLanguage || typeof byLanguage !== 'object') return;
    let changed = false;
    for (const language of ['zh', 'ja', 'ko']) {
      const entries = byLanguage[language];
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
      for (const [sentence, text] of Object.entries(entries)) {
        const id = key(sentence, language);
        if (!sentence || typeof text !== 'string' || !text.trim() || cache[`manual\u0000${id}`]) continue;
        revisions.set(id, (revisions.get(id) || 0) + 1);
        cache[id] = text;
        if (text.trim() === sentence) cache[`manual\u0000${id}`] = '1';
        changed = true;
      }
    }
    if (changed) try { storage?.setItem('lingtype-translations', JSON.stringify(cache)); } catch { /* kept for this visit */ }
  }
  async function translate(sentences, language) {
    // Python counts Unicode code points; avoid rejecting valid neighbours of an oversized sentence.
    const missing = [...new Set(sentences.filter(sentence => sentence && [...sentence].length <= 15000 && !get(sentence, language) && !pending.has(key(sentence, language))))];
    const resolvers = new Map();
    const started = new Map(missing.map(sentence => [sentence, revisions.get(key(sentence, language)) || 0]));
    for (const sentence of missing) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      pending.set(key(sentence, language), promise);
      resolvers.set(sentence, resolve);
    }
    if (missing.length) {
      (async () => {
        let values = [];
        try { values = await request(missing, language); } catch { /* leave missing translations retryable */ }
        missing.forEach((sentence, i) => {
          const value = values?.[i];
          if ((revisions.get(key(sentence, language)) || 0) === started.get(sentence) && typeof value === 'string' && value.trim() && value.trim() !== sentence) cache[key(sentence, language)] = value;
          pending.delete(key(sentence, language));
          resolvers.get(sentence)(get(sentence, language));
        });
        try { storage?.setItem('lingtype-translations', JSON.stringify(cache)); } catch { /* keep in memory */ }
      })();
    }
    return Promise.all(sentences.map(sentence => get(sentence, language) || pending.get(key(sentence, language)) || ''));
  }
  async function prefetch(sentences, language, onProgress = () => {}) {
    const unique = [...new Set(sentences.filter(Boolean))];
    let failed = 0;
    for (let i = 0; i < unique.length; i += 8) {
      const result = await translate(unique.slice(i, i + 8), language);
      failed += result.filter(value => !value).length;
      onProgress({ done:Math.min(i + 8, unique.length), total:unique.length, failed });
    }
    return failed === 0;
  }
  return { get, set, remember, translate, prefetch };
}
