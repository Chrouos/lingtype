// An imported PDF is kept in this browser and its pages are drawn on demand with pdf.js, loaded only when a page is first shown.
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const KEEP = 24, OPEN = 3;

export const pdfKey = id => `pdf:${id}`;

let library = null;
function loadLibrary() {
  // A worker must come from this page's origin, so the worker code is fetched and started from a blob address.
  library ??= (async () => {
    const lib = await import(PDFJS);
    const code = await (await fetch(WORKER)).text();
    lib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([code], { type:'text/javascript' })), { type:'module' });
    return lib;
  })().catch(error => { library = null; throw error; });
  return library;
}

// readFile(id) returns the stored PDF (a Blob) or nothing; the renderer returns an image address for a page, or null.
export function createPageRenderer(readFile, { width = 1200, load = loadLibrary } = {}) {
  const documents = new Map(), pages = new Map();
  const open = id => {
    if (!documents.has(id)) {
      const opening = (async () => {
        const file = await readFile(id);
        if (!file) return null;
        const lib = await load();
        return lib.getDocument({ data:new Uint8Array(await file.arrayBuffer()), isEvalSupported:false }).promise;
      })();
      documents.set(id, opening);
      opening.catch(() => documents.delete(id));
      // Only the few most recently used PDFs stay open.
      while (documents.size > OPEN) {
        const [oldest, doc] = documents.entries().next().value;
        documents.delete(oldest);
        doc.then(value => value?.destroy(), () => {});
        for (const [key, url] of pages) if (key.startsWith(`${oldest}/`)) { pages.delete(key); url.then(value => value && URL.revokeObjectURL(value), () => {}); }
      }
    } else { const doc = documents.get(id); documents.delete(id); documents.set(id, doc); }
    return documents.get(id);
  };
  const draw = async (id, number) => {
    const doc = await open(id);
    if (!doc || number < 1 || number > doc.numPages) return null;
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale:width / page.getViewport({ scale:1 }).width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext:context, viewport }).promise;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return blob ? URL.createObjectURL(blob) : null;
  };
  return {
    page(id, number) {
      const key = `${id}/${number}`;
      if (pages.has(key)) { const kept = pages.get(key); pages.delete(key); pages.set(key, kept); return kept; }
      const drawing = draw(id, number);
      pages.set(key, drawing);
      drawing.then(url => { if (!url) pages.delete(key); }, () => pages.delete(key));
      // Only the most recently shown pages stay drawn.
      while (pages.size > KEEP) {
        const [oldest, url] = pages.entries().next().value;
        pages.delete(oldest);
        url.then(value => value && URL.revokeObjectURL(value), () => {});
      }
      return drawing;
    },
    forget(id) {
      documents.get(id)?.then(doc => doc?.destroy(), () => {});
      documents.delete(id);
      for (const [key, url] of pages) if (key.startsWith(`${id}/`)) { pages.delete(key); url.then(value => value && URL.revokeObjectURL(value), () => {}); }
    }
  };
}

// Page figures for an imported PDF: each page section shows its own page once the reader reaches its first words.
export function pageFigures(data) {
  const parts = data.sections?.length ? data.sections : [{ text:data.text, page:data.pages?.[0] }];
  return parts.filter(part => Number.isInteger(part.page) && part.page > 0 && part.text?.trim())
    .map(part => ({ label:'', kind:'page', page:part.page, images:[], caption:'', anchor:part.text.trim().slice(0, 120), where:'start' }));
}
