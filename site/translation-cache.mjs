export function createTranslationCache(storage, request, existing) {
  let cache = existing;
  if (!cache) { try { cache = JSON.parse(storage?.getItem('lingtype-translations') || '{}'); } catch { cache = {}; } }
  const pending = new Map();
  const key = (sentence, language) => `${language}\u0000${sentence}`;
  const get = (sentence, language) => {
    const value = cache[key(sentence, language)];
    return typeof value === 'string' && value.trim() && value.trim() !== sentence ? value : '';
  };
  async function translate(sentences, language) {
    const missing = [...new Set(sentences.filter(sentence => sentence && !get(sentence, language) && !pending.has(key(sentence, language))))];
    const resolvers = new Map();
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
          if (typeof value === 'string' && value.trim() && value.trim() !== sentence) cache[key(sentence, language)] = value;
          pending.delete(key(sentence, language));
          resolvers.get(sentence)(get(sentence, language));
        });
        try { storage?.setItem('lingtype-translations', JSON.stringify(cache)); } catch { /* keep in memory */ }
      })();
    }
    return Promise.all(sentences.map(sentence => get(sentence, language) || pending.get(key(sentence, language)) || ''));
  }
  async function prefetch(sentences, language) {
    const unique = [...new Set(sentences.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 8) {
      const result = await translate(unique.slice(i, i + 8), language);
      if (result.some(value => !value)) return false;
    }
    return true;
  }
  return { get, translate, prefetch };
}
