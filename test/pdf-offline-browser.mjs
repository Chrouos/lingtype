// Start the local server, then run with Node 22+ and Chrome/Chromium.
// All HTTPS requests are blocked to verify that PDF.js and its worker are local.
import assert from 'node:assert/strict';
import { Browser } from './helpers/browser.mjs';

const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.send('Network.enable');
  await page.send('Network.setBlockedURLs', { urls:['https://*'] });
  await page.goto(process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/', {settleMs:1000});
  assert.ok(await page.eval(async () => (await document.fonts.load('14px "Geist Variable"', 'Hello')).length > 0), 'local interface font loads without HTTPS');
  const rendered = await page.eval(async () => {
    const stream = 'BT /F1 18 Tf 30 200 Td (Hello) Tj ET\n';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
    const xref = pdf.length;
    pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const { createPageRenderer } = await import('/pdf-pages.mjs');
    const renderer = createPageRenderer(async () => new Blob([pdf], {type:'application/pdf'}));
    const url = await renderer.page('offline', 1);
    if (!url) return null;
    const image = new Image(); image.src = url;
    await image.decode();
    const result = { width:image.naturalWidth, height:image.naturalHeight };
    renderer.forget('offline');
    return result;
  });
  assert.deepEqual(rendered, { width:1200, height:1200 });
  console.log('offline PDF rendering passed');
  await page.close();
} finally { await browser.close(); }
