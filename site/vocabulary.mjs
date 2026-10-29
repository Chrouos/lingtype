// A deliberately small list of frequent function words, not a proficiency rating.
const common = new Set(`a an the and or but if then than so because as at by for from in into of on onto out over to up with without about after again all also am an any are be been being before between both can could did do does doing down each few had has have having he her here hers him his how i i'm i've is it its itself just me more most my no nor not now off once only other our ours she should some such that their theirs them themselves there these they this those through too under until very was we were what when where which while who whom why will would you your yours`.split(/\s+/));

export function articleWords(text) {
  return [...new Set((text.toLowerCase().match(/[a-z]+(?:['’][a-z]+)*/g) || []).map(word => word.replace('’', "'")))];
}

export function suggestWords(text, limit = 20) {
  return articleWords(text).filter(word => word.length > 2 && !common.has(word)).slice(0, Math.max(0, limit));
}

export function searchWords(text, query, limit = 20) {
  const term = query.trim().toLowerCase();
  return term ? articleWords(text).filter(word => word.includes(term)).slice(0, limit) : suggestWords(text, limit);
}

export function wordPage(text, query, known = [], page = 0, limit = 20) {
  const term = query.trim().toLowerCase();
  const hidden = new Set(known);
  const words = articleWords(text).filter(word => !hidden.has(word) && (term ? word.includes(term) : word.length > 2 && !common.has(word)));
  const pages = Math.max(1, Math.ceil(words.length / limit));
  const current = Math.max(0, Math.min(page, pages - 1));
  return { words:words.slice(current * limit, (current + 1) * limit), page:current, pages };
}
