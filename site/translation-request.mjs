// Bound the whole request, including JSON parsing: a stalled server should not
// block later batches or leave a word's retry button waiting forever.
export async function requestTranslation(sentences, language, { fetcher = globalThis.fetch, timeoutMs = 60000 } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller?.abort(); reject(new Error('Translation timed out')); }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetcher('/api/translate', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ language, sentences }), ...(controller ? {signal:controller.signal} : {}),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.translations) || data.translations.length !== sentences.length) throw new Error(data.error || 'translate');
      return data.translations;
    })()]);
  } finally { clearTimeout(timer); }
}
