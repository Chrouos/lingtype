export function parseSubtitles(source) {
  const blocks = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const captions = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timing = lines.findIndex(line => /^(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}/.test(line.trim()));
    if (timing < 0) continue;
    const text = lines.slice(timing + 1).join(' ').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|nbsp);/g, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&nbsp;':' '})[entity]).replace(/\s+/g, ' ').trim();
    if (text && text !== captions.at(-1)) captions.push(text);
  }
  if (!captions.length) throw new Error('找不到有效字幕，請選擇 SRT 或 VTT 檔案。');
  return captions.join('\n\n');
}
