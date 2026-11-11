// Decode text only: never parse subtitle markup as HTML, which could execute
// embedded elements. Unknown entities are kept for the reader to see.
const namedEntities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', lrm:'\u200e', rlm:'\u200f',
  ndash:'–', mdash:'—', hellip:'…', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”', copy:'©', reg:'®', trade:'™'};
function decodeEntities(text) {
  return text.replace(/&(#(?:[xX][\da-fA-F]+|\d+)|[a-zA-Z][a-zA-Z0-9]+);/g, (entity, name) => {
    if (name[0] !== '#') return Object.hasOwn(namedEntities, name) ? namedEntities[name] : entity;
    const number = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '\ufffd';
  });
}

export function decodeSubtitleFile(buffer) {
  const bytes = new Uint8Array(buffer);
  const decoder = (encoding, options) => {
    try { return new TextDecoder(encoding, options); }
    catch { throw new Error('瀏覽器不支援此字幕編碼，請先將檔案儲存為 UTF-8。'); }
  };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decoder('utf-16le', {fatal:true}).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decoder('utf-16be', {fatal:true}).decode(bytes);
  // Many SRT files have no BOM; English UTF-16 has a strong zero-byte pattern.
  if (bytes.length >= 4 && bytes.length % 2 === 0) {
    let evenZeros = 0, oddZeros = 0;
    const length = Math.min(bytes.length, 4096);
    for (let i = 0; i < length; i += 2) { evenZeros += bytes[i] === 0; oddZeros += bytes[i + 1] === 0; }
    const half = length / 2;
    const encoding = oddZeros / half >= 0.3 && evenZeros / half <= 0.05 ? 'utf-16le'
      : evenZeros / half >= 0.3 && oddZeros / half <= 0.05 ? 'utf-16be' : null;
    if (encoding) {
      const utf16 = decoder(encoding, {fatal:true});
      try { return utf16.decode(bytes); } catch {}
    }
  }
  const utf8 = decoder('utf-8', {fatal:true});
  try { return utf8.decode(bytes); }
  catch {
    // Some runtimes implement this label as ISO-8859-1 rather than mapping
    // the Windows punctuation range; normalize only that remaining range.
    const punctuation = ['€','\x81','‚','ƒ','„','…','†','‡','ˆ','‰','Š','‹','Œ','\x8d','Ž','\x8f',
      '\x90','‘','’','“','”','•','–','—','˜','™','š','›','œ','\x9d','ž','Ÿ'];
    return decoder('windows-1252').decode(bytes).replace(/[\x80-\x9f]/g, char => punctuation[char.charCodeAt(0) - 0x80]);
  }
}

export function parseSubtitles(source) {
  const blocks = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const captions = [];
  let lastCue = null;
  const seconds = stamp => stamp.replace(',', '.').split(':').reduce((total, part) => total * 60 + Number(part), 0);
  for (const block of blocks) {
    const lines = block.split('\n');
    const timing = lines.findIndex(line => /^(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}/.test(line.trim()));
    if (timing < 0) continue;
    const raw = lines.slice(timing + 1).join(' ')
      .replace(/<\/?(?:i|b|u|s|font|span|c|v|lang|ruby|rt)(?:\s[^<>]*|\.[^<>]*)?\s*>|<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/gi, '');
    const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
    const times = lines[timing].trim().match(/^((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})/);
    if (text) {
      const start = seconds(times[1]), end = seconds(times[2]);
      // Different timings may be a real repeated utterance, even when the
      // cues touch or overlap. Only merge an identical cue at the same time.
      if (!lastCue || text !== lastCue.text || start !== lastCue.start || end !== lastCue.end) captions.push(text);
      lastCue = {text, start, end};
    }
  }
  if (!captions.length) throw new Error('找不到有效字幕，請選擇 SRT 或 VTT 檔案。');
  return captions.join('\n\n');
}
