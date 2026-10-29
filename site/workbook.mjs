import { articleWords } from './vocabulary.mjs';

const maxSize = 2_000_000;
export function createWorkbook(item) {
  return { format:'lingtype-workbook', version:1, lesson:{
    title:item.title, text:item.text, category:item.category || '分享教材',
    translations:item.translations || {}, words:item.words || [],
    ...(item.sections?.length ? { sections:item.sections.map(({title,text}) => ({title,text})) } : {}),
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
  let sections;
  if (source.sections !== undefined) {
    if (!Array.isArray(source.sections) || source.sections.length > 1000 || source.sections.some(section => !section || typeof section.title !== 'string' || section.title.length > 200 || typeof section.text !== 'string' || !section.text.trim() || section.text.length > 1_000_000)) throw new Error('練習冊章節格式無效。');
    sections = source.sections.map(section => ({title:section.title, text:section.text}));
  }
  const optionalText = value => typeof value === 'string' && value.length <= 500 ? value : '';
  const sourceUrl = /^https:\/\/arxiv\.org\/html\/\d{4}\.\d{4,5}(?:v\d+)?$/.test(source.sourceUrl || '') ? source.sourceUrl : '';
  return { custom:true, title:source.title.trim(), category:'分享教材', text:source.text, translations, words:source.words.map(word => [...word]), ...(sections?.length ? {sections} : {}), ...(sourceUrl ? {sourceUrl} : {}), ...(optionalText(source.source) ? {source:source.source} : {}), ...(optionalText(source.license) ? {license:source.license} : {}) };
}

export function selectedArticleWords(article, selection) {
  const available = new Set(articleWords(article));
  return articleWords(selection).filter(word => available.has(word));
}
