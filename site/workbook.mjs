import { articleWords } from './vocabulary.mjs';
import { splitSentences } from './data.mjs';
import { typeable } from './sentences.mjs';
import { cleanFigures, cleanFormulas } from './paper.mjs';

const maxSize = 2_000_000;
export function createWorkbook(item, cache = {}) {
  const sentenceTranslations = {};
  for (const sentence of splitSentences(typeable(item.text)).map(s => s.trim()).filter(Boolean)) {
    for (const language of ['zh', 'ja', 'ko']) {
      const value = cache[`${language}\u0000${sentence}`];
      if (typeof value === 'string' && value.trim() && (value.trim() !== sentence || cache[`manual\u0000${language}\u0000${sentence}`])) (sentenceTranslations[language] ??= {})[sentence] = value;
    }
  }
  return { format:'lingtype-workbook', version:1, lesson:{
    title:item.title, text:item.text, category:item.category || '分享教材',
    translations:item.translations || {}, words:item.words || [],
    ...(Object.keys(sentenceTranslations).length ? { sentenceTranslations } : {}),
    ...(item.sections?.length ? { sections:item.sections.map(({title,text}) => ({title,text})) } : {}),
    // A PDF's pages stay in this browser; only figures that link to their source travel with a workbook.
    ...(item.formulas?.length ? { formulas:item.formulas } : {}), ...(item.figures?.some(figure => figure.kind !== 'page') ? { figures:item.figures.filter(figure => figure.kind !== 'page') } : {}),
    ...(item.sourceUrl ? { sourceUrl:item.sourceUrl } : {}),
    ...(item.source ? { source:item.source } : {}), ...(item.license ? { license:item.license } : {})
  } };
}

export function readWorkbook(json) {
  if (typeof json !== 'string' || json.length > maxSize) throw new Error('練習冊過大，請使用 2 MB 以內的檔案。');
  let file; try { file = JSON.parse(json); } catch { throw new Error('練習冊格式無法讀取。'); }
  if (!file || file.format !== 'lingtype-workbook' || file.version !== 1 || !file.lesson || typeof file.lesson !== 'object') throw new Error('練習冊格式不支援。');
  const source = file.lesson;
  if (typeof source.text !== 'string' || !source.text.trim() || source.text.length > 1_000_000) throw new Error('練習冊文章為空或過長。');
  if (typeof source.title !== 'string' || !source.title.trim() || source.title.length > 200) throw new Error('練習冊名稱無效。');
  if (!Array.isArray(source.words) || source.words.length > 5000 || source.words.some(word => !Array.isArray(word) || word.length !== 4 || word.some(value => typeof value !== 'string' || value.length > 500) || !/^[a-z]+(?:['’][a-z]+)*$/i.test(word[0]))) throw new Error('練習冊單字格式無效。');
  const translations = {};
  for (const language of ['zh','ja','ko']) {
    const value = source.translations?.[language] ?? '';
    if (typeof value !== 'string' || value.length > 1_000_000) throw new Error('練習冊翻譯格式無效。');
    translations[language] = value;
  }
  const sentenceTranslations = {};
  if (source.sentenceTranslations !== undefined) {
    if (!source.sentenceTranslations || typeof source.sentenceTranslations !== 'object' || Array.isArray(source.sentenceTranslations)) throw new Error('練習冊翻譯格式無效。');
    const sentences = new Set(splitSentences(typeable(source.text)).map(s => s.trim()));
    for (const language of ['zh', 'ja', 'ko']) {
      const entries = source.sentenceTranslations[language];
      if (entries === undefined) continue;
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('練習冊翻譯格式無效。');
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value !== 'string' || value.length > 100_000) throw new Error('練習冊翻譯格式無效。');
        // Workbooks from earlier versions may key sentences with characters that are now turned into keyboard ones.
        const sentence = typeable(key).trim();
        if (!sentences.has(sentence)) continue;
        (sentenceTranslations[language] ??= {})[sentence] = value;
      }
    }
  }
  let sections;
  if (source.sections !== undefined) {
    if (!Array.isArray(source.sections) || source.sections.length > 1000 || source.sections.some(section => !section || typeof section.title !== 'string' || section.title.length > 200 || typeof section.text !== 'string' || !section.text.trim() || section.text.length > 1_000_000)) throw new Error('練習冊章節格式無效。');
    sections = source.sections.map(section => ({title:section.title, text:section.text}));
  }
  let formulas, figures;
  try { formulas = cleanFormulas(source.formulas); figures = cleanFigures(source.figures); } catch { throw new Error('練習冊圖表或公式格式無效。'); }
  const optionalText = value => typeof value === 'string' && value.length <= 500 ? value : '';
  const sourceUrl = /^https:\/\/arxiv\.org\/html\/\d{4}\.\d{4,5}(?:v\d+)?$/.test(source.sourceUrl || '') ? source.sourceUrl : '';
  return { custom:true, title:source.title.trim(), category:'分享教材', text:source.text, translations, words:source.words.map(word => [...word]), ...(Object.keys(sentenceTranslations).length ? {sentenceTranslations} : {}), ...(sections?.length ? {sections} : {}), ...(formulas?.length ? {formulas} : {}), ...(figures?.length ? {figures} : {}), ...(sourceUrl ? {sourceUrl} : {}), ...(optionalText(source.source) ? {source:source.source} : {}), ...(optionalText(source.license) ? {license:source.license} : {}) };
}

export function selectedArticleWords(article, selection) {
  const available = new Set(articleWords(article));
  return articleWords(selection).filter(word => available.has(word));
}
