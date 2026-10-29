import { lessons, selectPassage, splitSentences, nextPassage } from './data.mjs';
import { wordEdit, articleResult, liveArticleStats, typedCounts, sessionStats } from './typing.mjs';
import { wordPage, articleWords } from './vocabulary.mjs';
import { readNotebook, saveNotebook, sentenceWith, addWord, removeWord, recordPractice, notebookLesson } from './notebook.mjs';
import { readCustomLessons, addCustomLesson, readBuiltinWords, saveBuiltinWords } from './library.mjs';
import { readHistory, saveResult } from './history.mjs';
import { snapshotKey, saveSnapshot, readSnapshot, clearSnapshot, clearModeSnapshots, hasModeSnapshots, wrongWordAt, comparison, bestResult, saveBest, passageId } from './practice.mjs';
import { setupViews } from './views.mjs';
import { sentenceAt, advanceSentenceInput, passageTranslations, separatorPositions, typeable } from './sentences.mjs';
import { createWorkbook, readWorkbook, selectedArticleWords } from './workbook.mjs';
import { parseSubtitles } from './subtitles.mjs';
import { translate, applyStatic, pickLanguage, dateLocale, languages } from './i18n.mjs';

const $ = (id) => document.getElementById(id);
const lessonSelect = $('lesson'), language = $('language'), exercise = $('exercise'), result = $('result');
try { language.value = pickLanguage(globalThis.localStorage?.getItem('lingtype-language'), globalThis.navigator?.language); } catch { language.value = pickLanguage(null, globalThis.navigator?.language); }
const t = (key, vars) => translate(language.value, key, vars);
// Server and parser messages are written in Chinese; other languages get a translated summary.
const localError = (message, key) => language.value === 'zh' && message ? message : t(key);
applyStatic(globalThis.document, language.value);
const initialHash = globalThis.location?.hash.slice(1) || 'practice';
const initialView = /^book-[0-9a-f]{32}$/.test(initialHash) ? 'public' : initialHash;
let currentView = initialView;
const showView = setupViews($, name => {
  currentView = name;
  if (name !== 'practice' && started !== null && !paused && !finished) $('pause')?.click();
  if (name === 'notebook') renderNotebook();
  if (name === 'public') { if ($('public-detail')) $('public-detail').hidden = true; if ($('public-books')) $('public-books').hidden = false; loadPublicBooks(); }
  if (globalThis.location && globalThis.history) globalThis.history.replaceState(null, '', `#${name}`);
}, initialView);
let mode = 'article', wordIndex = 0, errors = 0, started = null, finished = false, input = '', articleText = '', sentenceTranslations = null, translationRun = 0;
let timer = null, saveTimer = null;
let publicRun = 0;
let articleSentences = [], articleBlocks = [], sentenceStarts = [];
let autoSeparators = new Set();
let elapsedBase = 0, paused = false, activeKey = '', activeSettings = null, retryWords = null, pickerPage = 0;
let wrongWords = new Set();
let paintResult = null, hintKey = null, resultKeys = null;
// Texts finished one after another form a session; its totals are shown when the typist stops.
const newSession = () => ({ pieces:0, correct:0, total:0, time:0, wrong:new Set() });
let session = newSession(), keepSession = false, toastTimer = null;
const translationCache = (() => { try { return JSON.parse(globalThis.localStorage?.getItem('lingtype-translations') || '{}'); } catch { return {}; } })();
for (const item of lessons) { const words = readBuiltinWords(globalThis.localStorage, item.id); if (words) item.words = words; }
lessons.push(...readCustomLessons(globalThis.localStorage));
function persistLibrary() { try { globalThis.localStorage?.setItem('lingtype-custom-lessons', JSON.stringify(lessons.filter(item => item.custom))); return true; } catch { return false; } }
function persistWords(item) {
  if (item.notebook) { notebook = notebook.map(entry => { const found = item.words.find(word => word[0] === entry.word); return found ? { ...entry, translations:{ ...entry.translations, ...Object.fromEntries(['zh', 'ja', 'ko'].map((code, i) => [code, found[i + 1] || entry.translations[code] || ''])) } } : entry; }); return saveNotebook(globalThis.localStorage, notebook); }
  return item.custom ? persistLibrary() : saveBuiltinWords(globalThis.localStorage, item.id, item.words);
}
let notebook = readNotebook(globalThis.localStorage);
const translatable = item => item.custom || item.notebook;
function syncNotebookLesson() {
  const currentId = lessons[Number(lessonSelect.value)]?.id, at = lessons.findIndex(item => item.notebook);
  if (at >= 0) lessons.splice(at, 1);
  const firstImport = lessons.findIndex(item => item.custom);
  if (notebook.length) lessons.splice(firstImport < 0 ? lessons.length : firstImport, 0, notebookLesson(notebook, t('notebook.lesson')));
  updateLessonOptions();
  lessonSelect.value = String(Math.max(0, lessons.findIndex(item => item.id === currentId)));
}
// Picking a word anywhere keeps it in the notebook with the sentence it came from; unpicking takes it out.
function noteWords({ add = [], remove = [], text = articleText } = {}) {
  const item = lesson();
  for (const word of add) {
    const known = item.words?.find(entry => entry[0].toLowerCase() === word.toLowerCase());
    notebook = addWord(notebook, { word, sentence:sentenceWith(text, word), source:item.notebook ? '' : item.title, translations:known ? { zh:known[1], ja:known[2], ko:known[3] } : {} });
  }
  for (const word of remove) notebook = removeWord(notebook, word);
  saveNotebook(globalThis.localStorage, notebook);
  syncNotebookLesson();
  renderNotebook();
}
function updateLessonOptions() { lessonSelect.innerHTML = ''; lessons.forEach((item, i) => { const option = document.createElement('option'); option.value = i; option.textContent = item.title; lessonSelect.append(option); }); }
updateLessonOptions();
syncNotebookLesson();
const lesson = () => lessons[Number(lessonSelect.value)];
function updateSections() {
  const sectionSelect = $('section-mode'), current = sectionSelect.value; sectionSelect.innerHTML = '';
  // A long document is practised one part at a time; drawing all of it at once would slow typing.
  const long = lesson().sections?.length && lesson().text.length > LONG_TEXT;
  if (!long) { const all = document.createElement('option'); all.value = 'all'; all.textContent = t('section.all'); sectionSelect.append(all); }
  (lesson().sections || []).forEach((section, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = section.title; sectionSelect.append(option); });
  sectionSelect.value = long ? '0' : 'all';
  return current;
}
const LONG_TEXT = 12000;
const languageIndex = () => ({ zh: 1, ja: 2, ko: 3 })[language.value];
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const elapsed = () => elapsedBase + (started === null ? 0 : performance.now() - started);
const formatTime = (ms) => { const sec = Math.floor(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const currentWords = () => retryWords || lesson().words;
// A hint remembers its key so it can be shown again in another language.
function setHint(key, vars) { hintKey = key ? [key, vars] : null; $('hint').textContent = key ? t(key, vars) : ''; }
const baseHint = () => paused ? 'hint.paused' : mode === 'word' ? 'hint.word' : 'hint.article';
function saveProgress() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!activeKey || finished || (!input && !wordIndex && !errors && started === null && !elapsedBase)) return;
  const ok = saveSnapshot(globalThis.localStorage, activeKey, { input, wordIndex, errors, elapsed:elapsed(), articleText, wrongWords:[...wrongWords], retryWords });
  try { globalThis.localStorage?.setItem('lingtype-last-practice', JSON.stringify(activeSettings)); } catch { /* keep the current session */ }
  if (!ok) setHint('hint.saveFail');
}
function scheduleProgress() { clearTimeout(saveTimer); saveTimer = setTimeout(saveProgress, 400); }
function mayLeave() { return finished || (!input && !wordIndex && !errors) || typeof globalThis.confirm !== 'function' || globalThis.confirm(t('confirm.leave')); }
function resetClock() { clearInterval(timer); clearTimeout(saveTimer); timer = null; saveTimer = null; started = null; elapsedBase = 0; paused = false; }
function loadPractice(restore = true, initialRetry = null, initialArticle = null) {
  if (!keepSession) session = newSession();
  resetClock(); wordIndex = 0; errors = 0; finished = false; input = ''; retryWords = initialRetry; wrongWords = new Set(); sentenceTranslations = null; paintResult = null; ++translationRun;
  const item = lesson(), sectionValue = $('section-mode').value || 'all', passageValue = $('passage-mode').value || 'full';
  activeSettings = { id:item.id, mode, section:sectionValue, passage:passageValue };
  activeKey = snapshotKey(item.id, mode, sectionValue, passageValue);
  const section = item.sections && sectionValue !== 'all' ? item.sections[Number(sectionValue)] : null;
  const saved = restore ? readSnapshot(globalThis.localStorage, activeKey) : null;
  articleText = typeable(saved?.articleText || initialArticle || selectPassage(section?.text || item.text, item.custom ? passageValue : 'full')).trimEnd();
  if (saved) { input = typeof saved.input === 'string' ? saved.input.slice(0, articleText.length) : ''; wordIndex = Number(saved.wordIndex) || 0; errors = Number(saved.errors) || 0; elapsedBase = Number(saved.elapsed) || 0; wrongWords = new Set(saved.wrongWords || []); retryWords = Array.isArray(saved.retryWords) ? saved.retryWords : null; paused = true; }
  articleSentences = splitSentences(articleText); autoSeparators = separatorPositions(articleSentences);
  articleBlocks = paragraphBlocks(articleSentences);
  sentenceStarts = []; let offset = 0; for (const sentence of articleSentences) { sentenceStarts.push(offset); offset += sentence.length; }
  sentenceTranslations = passageTranslations(splitSentences(typeable(item.text)), articleSentences, item.translations?.[language.value], language.value);
  result.hidden = true; exercise.hidden = false;
  $('word-mode').classList.toggle('active', mode === 'word'); $('article-mode').classList.toggle('active', mode === 'article');
  render(); updateMetrics(); updatePause();
  if (mode === 'article' && translatable(item) && !sentenceTranslations) prepareTranslation();
  if (mode === 'word' && (translatable(item) || retryWords) && currentWords()[wordIndex]) translateWord(item, currentWords()[wordIndex][0], language.value);
  if (saved) setHint('hint.restored');
}
function restart() { if (!finished && (input || wordIndex || errors || elapsedBase || started !== null) && typeof globalThis.confirm === 'function' && !globalThis.confirm(t('confirm.restart'))) return; const repeat = retryWords, sameArticle = mode === 'article' ? articleText : null; clearSnapshot(globalThis.localStorage, activeKey); loadPractice(false, repeat, sameArticle); }
function setMode(value) { if (value === mode && !finished) return; if (!mayLeave()) return; saveProgress(); mode = value; loadPractice(); }
function updatePause() { if (!$('pause')) return; $('pause').textContent = t(paused ? 'action.resume' : 'action.pause'); $('pause').disabled = finished; if ($('finish-now')) $('finish-now').disabled = finished; if ($('typing')) $('typing').disabled = paused; if ($('focus-veil')) $('focus-veil').textContent = t(paused ? 'hint.paused' : 'focus.click'); }
function render() {
  const item = lesson();
  if ($('delete-lesson')) $('delete-lesson').hidden = !item.custom;
  $('word-mode').disabled = !item.words?.length && !(mode === 'word' && retryWords?.length);
  renderPicker(); renderVocabulary();
  $('passage-label').hidden = !item.custom || mode !== 'article';
  $('section-label').hidden = !item.sections?.length || mode !== 'article';
  const source = $('source-info'); const validSource = /^https?:\/\/[^\s]+$/.test(item.sourceUrl || ''); source.hidden = !validSource; source.textContent = '';
  if (validSource) {
    const link = document.createElement('a'); link.href = item.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = t('source.link');
    source.append(link, ...(item.category === 'arxiv' ? [document.createTextNode(` · ${(item.authors || []).join(', ')} · ${item.license || t('source.license')}`)] : []));
  }
  $('progress').textContent = mode === 'word' ? t('progress.word', { i:wordIndex + 1, n:currentWords().length }) : '';
  setHint(baseHint());
  if (mode === 'word') {
    const word = currentWords()[wordIndex];
    exercise.innerHTML = `<div class="typing-stage word-stage" id="typing-stage"><h2 class="word-text" id="word-text">${escapeHtml(word[0])}</h2><div class="focus-veil" aria-hidden="true"><span id="focus-veil">${escapeHtml(t(paused ? 'hint.paused' : 'focus.click'))}</span></div><input class="typing-overlay word-input" id="typing" aria-label="${escapeHtml(t('typing.word'))}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${escapeHtml(input)}"></div><p class="translation">${escapeHtml(word[languageIndex()] || t('word.noTranslation'))}</p><div class="error-note" aria-live="polite"></div>`;
    $('typing').addEventListener('input', onWord); paintWord();
  } else {
    const translation = item.translations?.[language.value] || t('article.noTranslation');
    exercise.innerHTML = `<div class="typing-stage article-stage" id="typing-stage"><div class="article-text reader" id="article-text"></div><div class="focus-veil" aria-hidden="true"><span id="focus-veil">${escapeHtml(t(paused ? 'hint.paused' : 'focus.click'))}</span></div><textarea id="typing" class="typing-overlay caret-input" aria-label="${escapeHtml(t('typing.article'))}" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea></div><div id="article-translation" class="article-translation">${escapeHtml(translation)}</div>`;
    $('typing').value = input;
    for (const type of ['paste', 'drop']) $('typing').addEventListener(type, blockArticlePaste);
    $('typing').addEventListener('beforeinput', event => {
      if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') blockArticlePaste(event);
    });
    if (item.custom && !sentenceTranslations) $('article-translation').textContent = '';
    $('typing').addEventListener('input', onArticle); paintArticle();
  }
  $('typing').addEventListener('blur', () => { if (!finished) holdClock(); });
  $('typing').addEventListener('focus', event => { const field = event.target; field.setSelectionRange?.(field.value.length, field.value.length); keepCaretInView(); });
  // In article mode the input is a small field at the caret, so clicking anywhere on the text focuses it.
  $('typing-stage')?.addEventListener('click', () => { if (finished) return; if (paused) resumePractice(); else $('typing').focus({ preventScroll:true }); });
}
async function prepareTranslation() {
  const run = ++translationRun, currentLanguage = language.value;
  const sentences = articleSentences.map(sentence => sentence.trim());
  const keyOf = sentence => `${currentLanguage}\u0000${sentence}`;
  const usable = sentence => typeof translationCache[keyOf(sentence)] === 'string' && translationCache[keyOf(sentence)].trim() && translationCache[keyOf(sentence)].trim() !== sentence;
  const fill = () => { sentenceTranslations = sentences.map(sentence => usable(sentence) ? translationCache[keyOf(sentence)] : ''); };
  // Translate from the current sentence onward in small batches, so the text being typed fills in first.
  const current = sentenceAt(articleSentences, input.length).index;
  const order = [...sentences.slice(current), ...sentences.slice(0, current)];
  const missing = [...new Set(order.filter(sentence => sentence && !usable(sentence)))];
  // Show what is already known at once (a video's subtitles, earlier sessions); the rest fills in as it arrives.
  fill(); paintArticle();
  if (!missing.length) { setHint(baseHint()); return; }
  setHint('hint.translating');
  let failed = false;
  for (let offset = 0; offset < missing.length; offset += 8) {
    const batch = missing.slice(offset, offset + 8);
    try {
      const response = await fetch('/api/translate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ language:currentLanguage, sentences:batch }) });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.translations) || data.translations.length !== batch.length) throw new Error(data.error || 'translate');
      batch.forEach((sentence, i) => { const value = data.translations[i]; if (typeof value === 'string' && value.trim() && value.trim() !== sentence) translationCache[keyOf(sentence)] = value; });
      try { globalThis.localStorage?.setItem('lingtype-translations', JSON.stringify(translationCache)); } catch { /* keep in memory */ }
    } catch { failed = true; }
    if (run !== translationRun || mode !== 'article' || finished) return;
    fill(); paintArticle();
    if (failed) break;
  }
  if (!sentenceTranslations.some(Boolean)) { sentenceTranslations = null; if (!lesson().translations?.[language.value]) $('article-translation').textContent = t('article.noTranslation'); paintArticle(); }
  setHint(failed ? 'hint.translateFail' : baseHint());
}
function blockArticlePaste(event) {
  event.preventDefault();
  setHint('hint.noPaste');
}
// The clock runs only while typing: it holds at the last keystroke after a pause or when focus leaves the text,
// and the next key starts it again.
const IDLE_MS = 6000;
let lastKeyAt = 0;
function startTimer() {
  lastKeyAt = performance.now();
  if (started !== null) return;
  started = lastKeyAt;
  timer = setInterval(() => { if (performance.now() - lastKeyAt > IDLE_MS) holdClock(lastKeyAt); else updateMetrics(); }, 1000);
}
function holdClock(at = performance.now()) {
  if (started === null) return;
  elapsedBase += Math.max(0, at - started); started = null; clearInterval(timer); timer = null;
  updateMetrics();
}
function updateMetrics() {
  if (!$('live-time')) return;
  const time = elapsed();
  let wpm, accuracy, progress;
  let shownTime = time;
  if (mode === 'article') {
    const live = typedCounts(articleText, input, autoSeparators);
    shownTime = session.time + time;
    ({ wpm, accuracy } = sessionStats({ correct:session.correct + live.correct, total:session.total + live.total }, shownTime));
    progress = liveArticleStats(articleText, input, time, autoSeparators).progress;
  }
  else {
    const words = currentWords() || [];
    const correct = words.slice(0, wordIndex).reduce((sum, word) => sum + word[0].length, 0) + input.length;
    wpm = time > 0 ? Math.round(correct / 5 / (time / 60000) * 10) / 10 : 0;
    accuracy = null; progress = words.length ? Math.round(wordIndex / words.length * 100) : 0;
  }
  $('live-time').textContent = formatTime(shownTime);
  $('live-wpm').textContent = String(wpm);
  $('live-accuracy').textContent = accuracy === null ? String(errors) : `${accuracy}%`;
  $('live-accuracy-label').textContent = t(accuracy === null ? 'metric.errors' : 'metric.accuracy');
  $('live-progress').textContent = `${progress}%`;
  $('progress-bar').value = progress;
}
function onWord(e) {
  if (finished) return;
  const next = e.target.value;
  if (next.trim()) startTimer();
  const state = wordEdit(currentWords()[wordIndex][0], next);
  input = state.input;
  if (state.error) { errors++; wrongWords.add(currentWords()[wordIndex][0]); e.target.value = ''; exercise.querySelector('.error-note').textContent = t('word.wrong'); paintWord(); updateMetrics(); scheduleProgress(); return; }
  if (state.complete) { wordIndex++; input = ''; if (wordIndex === currentWords().length) return finish(); render(); updateMetrics(); scheduleProgress(); if (translatable(lesson()) || retryWords) translateWord(lesson(), currentWords()[wordIndex][0], language.value); $('typing').focus(); return; }
  e.target.value = input; exercise.querySelector('.error-note').textContent = ''; paintWord(); updateMetrics(); scheduleProgress();
}
function paintWord() {
  const display = $('word-text'); if (!display) return;
  const words = currentWords();
  const start = Math.max(0, wordIndex - 4), end = Math.min(words.length, wordIndex + 16);
  display.innerHTML = words.slice(start, end).map((word, offset) => {
    const position = start + offset;
    if (position < wordIndex) return `<span class="correct">${escapeHtml(word[0])}</span>`;
    if (position > wordIndex) return escapeHtml(word[0]);
    return `<span class="current">${[...word[0]].map((char, index) => `<span class="${index < input.length ? 'correct' : index === input.length ? 'pending cursor' : 'pending'}">${escapeHtml(char)}</span>`).join('')}</span>`;
  }).join(' ');
}
// Paragraphs follow the text's blank lines; a very long paragraph is split so its translation stays near.
function paragraphBlocks(sentences) {
  const blocks = []; let block = [];
  sentences.forEach((sentence, index) => {
    block.push(index);
    if (/\n/.test(sentence.slice(sentence.trimEnd().length)) || block.length >= 8 || index === sentences.length - 1) { blocks.push(block); block = []; }
  });
  return blocks;
}
function sentenceHtml(index, current) {
  const sentence = articleSentences[index], body = sentence.trimEnd(), gap = sentenceStarts[index] + body.length;
  // The space after a sentence is typed too: the caret waits on it, and a skipped one shows as a mistake.
  const waiting = input.length === gap, skipped = input.length > gap && !/\s/.test(input[gap]);
  const space = sentence.length === body.length ? '' : waiting || skipped ? `<span class="sep${skipped ? ' incorrect' : ''}${waiting ? ' cursor' : ''}"> </span>` : ' ';
  if (index > current) return `<span class="s up">${escapeHtml(body)}</span>${space}`;
  // Typed sentences stay plain text except for mistakes; only the current sentence is drawn per character.
  let html = '', position = sentenceStarts[index];
  for (const char of body) {
    const typed = position < input.length, wrong = typed && input.slice(position, position + char.length) !== char, here = position === input.length;
    html += index === current || wrong ? `<span class="${typed ? (wrong ? 'incorrect' : 'correct') : ''}${here ? ' cursor' : ''}">${escapeHtml(char)}</span>` : escapeHtml(char);
    position += char.length;
  }
  return `<span class="s ${index === current ? 'current-sentence' : 'done-sentence'}">${html}</span>${space}`;
}
// The whole text reads like a book: each English paragraph followed by its translation.
function paintArticle() {
  const piece = sentenceAt(articleSentences, input.length), joiner = language.value === 'ko' ? ' ' : '';
  $('article-text').innerHTML = articleBlocks.map(block => {
    const state = piece.index < block[0] ? 'upcoming' : piece.index > block[block.length - 1] ? 'done' : 'current';
    const translated = block.map(index => sentenceTranslations?.[index] ? `<span${index === piece.index ? ' class="now"' : ''}>${escapeHtml(sentenceTranslations[index])}</span>` : '').filter(Boolean).join(joiner);
    return `<section class="para ${state}"><p class="en">${block.map(index => sentenceHtml(index, piece.index)).join('')}</p>${translated ? `<p class="tr">${translated}</p>` : ''}</section>`;
  }).join('');
  const whole = $('article-translation');
  whole.hidden = Boolean(sentenceTranslations?.some(Boolean)) || !whole.textContent;
  $('progress').textContent = t('progress.sentence', { i:piece.index + 1, n:articleSentences.length });
  placeCaret();
}
// Keep the hidden input at the caret so the browser and phone keyboards follow the text being typed.
function placeCaret() {
  const field = $('typing'), caret = $('article-text')?.querySelector?.('.cursor');
  if (!field?.style || !caret || typeof caret.offsetTop !== 'number') return;
  field.style.left = `${caret.offsetLeft}px`; field.style.top = `${caret.offsetTop}px`;
  if (globalThis.document?.activeElement === field) keepCaretInView();
}
function keepCaretInView() {
  const box = $('article-text')?.querySelector?.('.cursor')?.getBoundingClientRect?.(), height = globalThis.innerHeight;
  if (!box || !height || (box.top >= height * 0.28 && box.bottom <= height * 0.62)) return;
  const smooth = !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  globalThis.scrollBy?.({ top:box.top - height * 0.42, behavior:smooth ? 'smooth' : 'auto' });
}
function onArticle(e) {
  if (finished) return;
  const previousInput = input;
  input = advanceSentenceInput(articleSentences, previousInput, e.target.value.slice(0, articleText.length)); e.target.value = input;
  for (let i = 0; i < input.length; i++) if (input[i] !== previousInput[i] && input[i] !== articleText[i]) { const word = wrongWordAt(articleText, i); if (word) wrongWords.add(word); }
  if (input.length) startTimer();
  paintArticle(); updateMetrics();
  if (input.length >= articleText.length) completeArticle(); else scheduleProgress();
}
// An early finish scores only what was typed and keeps the place, so practice can continue from it.
function finish(early = false) {
  if (early) saveProgress();
  finished = true; const time = elapsed(); elapsedBase = time; started = null; clearInterval(timer); clearTimeout(saveTimer); timer = null; saveTimer = null; if (!early) clearSnapshot(globalThis.localStorage, activeKey); updateMetrics(); updatePause(); exercise.hidden = true; result.hidden = false;
  const wordChars = early ? currentWords().slice(0, wordIndex).reduce((sum, word) => sum + word[0].length, 0) + input.length : currentWords().reduce((sum, word) => sum + word[0].length, 0);
  const wordWpm = time > 0 ? Math.round(wordChars / 5 / (time / 60000) * 10) / 10 : 0;
  const resultStats = mode === 'article' ? articleResult(early ? articleText.slice(0, input.length) : articleText, input, time, autoSeparators) : null;
  const reached = mode === 'article' ? Math.round(input.length / articleText.length * 100) : Math.round(wordIndex / currentWords().length * 100);
  const record = { lessonId:lesson().id, title:lesson().title, mode, passage:passageId(mode === 'article' ? articleText : currentWords().map(w => w[0]).join(' ')), wpm:resultStats?.wpm ?? wordWpm, accuracy:resultStats?.accuracy ?? null, errors:mode === 'word' ? errors : resultStats.errors, elapsed:time, date:new Date().toISOString(), ...(early ? { partial:true } : {}) };
  const previous = comparison(readHistory(globalThis.localStorage), record);
  const best = Math.max(bestResult(globalThis.localStorage, record) ?? 0, record.wpm);
  const stored = saveBest(globalThis.localStorage, record) && saveResult(globalThis.localStorage, record);
  notePractice(mode === 'word' ? currentWords().slice(0, early ? wordIndex : undefined).map(word => word[0]) : articleWords(early ? articleText.slice(0, input.length) : articleText));
  const wordCount = currentWords().length, practicedText = articleText;
  const multi = mode === 'article' && session.pieces > 0;
  const counts = mode === 'article' ? typedCounts(early ? articleText.slice(0, input.length) : articleText, input, autoSeparators) : null;
  const totalTime = multi ? session.time + time : time;
  const shown = multi ? sessionStats({ correct:session.correct + counts.correct, total:session.total + counts.total }, totalTime) : resultStats;
  const missed = mode === 'article' ? new Set([...session.wrong, ...wrongWords]) : wrongWords;
  const texts = session.pieces + (input.length ? 1 : 0);
  renderHistory();
  paintResult = () => {
    const stats = mode === 'word' ? [[t('metric.wpm'), wordWpm], [t('metric.time'), formatTime(time)], [t('mode.word'), wordCount], [t('metric.errors'), errors]] : [[t('metric.wpm'), shown.wpm], [t('metric.accuracy'), `${shown.accuracy}%`], [t('metric.time'), formatTime(totalTime)], [t('metric.errors'), shown.errors]];
    const met = mode === 'word' || shown.accuracy >= 90;
    const goal = early ? t('result.partial', { p:reached }) : t(mode === 'word' ? 'result.wordDone' : met ? 'result.goalMet' : 'result.goalMiss');
    const compare = multi ? t('result.session', { n:texts }) : [previous ? t('result.prev', { wpm:previous.previous, delta:`${previous.delta >= 0 ? '+' : ''}${previous.delta}` }) : t('result.noPrev'), t('result.best', { wpm:best }), ...(stored ? [] : [t('result.storageFail')])].join(' · ');
    const nextLabel = mode === 'word' ? t('result.toArticle') : t(articleContinuation().kind === 'lesson' ? 'result.nextLesson' : 'result.nextPassage');
    const buttons = early ? [
      `<button class="btn primary" id="resume-early" type="button">${escapeHtml(t('result.resume'))}<kbd>Enter</kbd></button>`,
      `<button class="btn" id="again-article" type="button">${escapeHtml(t('action.restart'))}<kbd>Shift Enter</kbd></button>`,
      mode === 'article' ? `<button class="btn" id="next-action" type="button">${escapeHtml(nextLabel)}</button>` : '',
      missed.size ? `<button class="btn" id="retry-errors" type="button">${escapeHtml(t('result.retry', { n:missed.size }))}</button>` : '',
    ].join('') : [
      `<button class="btn primary" id="next-action" type="button">${escapeHtml(nextLabel)}<kbd>Enter</kbd></button>`,
      `<button class="btn" id="${mode === 'word' ? 'replay-word' : 'again-article'}" type="button">${escapeHtml(t(mode === 'word' ? 'result.againWords' : 'result.again'))}<kbd>Shift Enter</kbd></button>`,
      missed.size ? `<button class="btn" id="retry-errors" type="button">${escapeHtml(t('result.retry', { n:missed.size }))}</button>` : '',
    ].join('');
    const pick = word => `<button type="button" class="pick-chip" data-pick="${escapeHtml(word)}">${escapeHtml(word)}</button>`;
    // Every English word in the finished passage can be tapped to add or remove it.
    const tokens = practicedText.split(/([A-Za-z]+(?:['’][A-Za-z]+)*)/).map((part, index) => index % 2 ? `<span class="pick" data-pick="${escapeHtml(part.toLowerCase().replace('’', "'"))}">${escapeHtml(part)}</span>` : escapeHtml(part)).join('');
    const review = mode === 'article' ? `<section class="review-words" style="--i:4"><div class="review-head"><h2>${escapeHtml(t('result.pickTitle'))}</h2><span class="count" id="pick-count"></span></div><p>${escapeHtml(t('result.pickHelp'))}</p>${missed.size ? `<div class="mistyped"><span>${escapeHtml(t('result.mistyped'))}</span>${[...missed].map(pick).join('')}</div>` : ''}<p class="review-text" id="review-text">${tokens}</p><button type="button" class="btn primary float-add" id="save-selected-words" hidden>${escapeHtml(t('result.pickAdd'))}</button><p id="selection-message" class="message" role="status"></p></section>` : '';
    result.innerHTML = `<div class="result-head" style="--i:0"><h2 class="result-title">${escapeHtml(t(early ? 'result.stopped' : 'result.title'))}</h2><span class="result-goal${met && !early ? ' met' : ''}">${escapeHtml(goal)}</span></div><div class="stats" style="--i:1">${stats.map(([label, value], index) => `<div><strong${index === 0 ? ' class="headline" id="result-wpm"' : ''}>${value}</strong><span>${escapeHtml(label)}</span></div>`).join('')}</div><p class="result-comparison" style="--i:2">${escapeHtml(compare)}</p><div class="result-actions" style="--i:3">${buttons}</div>${review}`;
    $('progress').textContent = t(early ? 'result.stopped' : 'progress.done');
    const forward = mode === 'word' ? () => setMode('article') : continueArticle;
    resultKeys = early ? { next:resumeEarly, again:restart } : { next:forward, again:restart };
    $('next-action')?.addEventListener('click', forward);
    $('resume-early')?.addEventListener('click', resumeEarly);
    $('replay-word')?.addEventListener('click', restart);
    $('again-article')?.addEventListener('click', restart);
    $('retry-errors')?.addEventListener('click', () => {
      const chosen = [...missed].map(word => lesson().words.find(entry => entry[0] === word) || [word, '', '', '']);
      mode = 'word'; loadPractice(false, chosen); $('typing')?.focus();
    });
    $('save-selected-words')?.addEventListener('click', () => {
      const selection = globalThis.getSelection?.(), reviewText = $('review-text'), message = $('selection-message');
      if (!selection || !reviewText?.contains(selection.anchorNode) || !reviewText.contains(selection.focusNode)) { message.textContent = t('result.pickNone'); return; }
      const words = selectedArticleWords(articleText, selection.toString());
      if (!words.length) { message.textContent = t('result.pickNone'); return; }
      const item = lesson(), additions = words.filter(word => !item.words.some(entry => entry[0].toLowerCase() === word));
      if (!additions.length) { message.textContent = t('result.pickExists'); return; }
      if (!prepareWordListChange()) return;
      additions.forEach(word => item.words.push([word, '', '', '']));
      $('word-mode').disabled = false;
      message.textContent = persistWords(item) ? t('result.pickAdded', { n:additions.length }) : t('result.pickStorage');
      noteWords({ add:additions });
      additions.forEach(word => translateWord(item, word, language.value));
      selection.removeAllRanges?.(); $('save-selected-words').hidden = true;
      markPicked(additions);
    });
    markPicked();
    countUp($('result-wpm'), mode === 'word' ? wordWpm : shown.wpm);
  };
  paintResult();
  setHint(null);
  $('typing')?.blur?.(); result.tabIndex = -1; result.focus?.({ preventScroll:true });
  // The result opens at the top of the practice area, above the sticky row.
  globalThis.scrollTo?.({ top:0, behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
// What Enter does after an article: the next passage or section, otherwise the next lesson.
function articleContinuation() {
  const item = lesson(), sectionValue = $('section-mode').value || 'all';
  const section = item.sections && sectionValue !== 'all' ? item.sections[Number(sectionValue)] : null;
  const source = section?.text || item.text;
  if (articleText.trim() !== source.trim()) return { kind:'passage', run:() => { $('passage-mode').value = 'random'; loadPractice(false, null, nextPassage(source, articleText)); } };
  if (section && Number(sectionValue) + 1 < item.sections.length) return { kind:'passage', run:() => { $('section-mode').value = String(Number(sectionValue) + 1); pickerPage = 0; loadPractice(); } };
  return { kind:'lesson', run:() => { lessonSelect.value = String((Number(lessonSelect.value) + 1) % lessons.length); updateSections(); pickerPage = 0; loadPractice(); } };
}
// A finished text is recorded on its own, then the next one opens at once and the session keeps adding up.
function completeArticle() {
  const time = elapsed(), stats = articleResult(articleText, input, time, autoSeparators), counts = typedCounts(articleText, input, autoSeparators);
  const record = { lessonId:lesson().id, title:lesson().title, mode:'article', passage:passageId(articleText), wpm:stats.wpm, accuracy:stats.accuracy, errors:stats.errors, elapsed:time, date:new Date().toISOString() };
  saveBest(globalThis.localStorage, record); saveResult(globalThis.localStorage, record); renderHistory();
  notePractice(articleWords(articleText));
  clearSnapshot(globalThis.localStorage, activeKey);
  session.pieces++; session.correct += counts.correct; session.total += counts.total; session.time += time;
  wrongWords.forEach(word => session.wrong.add(word));
  const next = articleContinuation();
  keepSession = true;
  try { next.run(); } finally { keepSession = false; }
  announce(next.kind === 'lesson' ? t('session.next', { title:lesson().title }) : t('session.nextPassage'));
  if (paused) resumePractice(); else $('typing')?.focus();
  updateMetrics();
}
function notePractice(words) {
  if (!notebook.length) return;
  notebook = recordPractice(notebook, new Set(words.map(word => word.toLowerCase())), new Set([...wrongWords].map(word => word.toLowerCase())));
  saveNotebook(globalThis.localStorage, notebook);
}
function announce(text) {
  const toast = $('session-toast'); if (!toast) return;
  toast.textContent = text; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}
function finishEarly() {
  if (finished || !$('typing') || (mode === 'article' ? !input.length : !wordIndex && !input)) return;
  finish(true);
}
function resumeEarly() {
  finished = false; paintResult = null; resultKeys = null; result.hidden = true; exercise.hidden = false;
  paused = false;
  updatePause(); setHint(baseHint());
  if (mode === 'article') paintArticle(); else paintWord();
  $('typing')?.focus();
}
function continueArticle() {
  articleContinuation().run();
  if (paused) resumePractice(); else $('typing')?.focus();
}
function markPicked(popped = []) {
  const item = lesson(), picked = new Set((item.words || []).map(entry => entry[0].toLowerCase()));
  for (const node of result.querySelectorAll?.('[data-pick]') || []) {
    node.classList.toggle('picked', picked.has(node.dataset.pick));
    if (popped.includes(node.dataset.pick)) { node.classList.remove('pop'); void node.offsetWidth; node.classList.add('pop'); }
  }
  const count = $('pick-count');
  if (count) { count.textContent = String(picked.size); if (popped.length) { count.classList.remove('bump'); void count.offsetWidth; count.classList.add('bump'); } }
  renderPicker(); renderVocabulary();
}
function togglePick(word) {
  const item = lesson(), message = $('selection-message'), had = item.words.some(entry => entry[0].toLowerCase() === word);
  if (!prepareWordListChange()) return;
  if (had) item.words = item.words.filter(entry => entry[0].toLowerCase() !== word); else item.words.push([word, '', '', '']);
  const ok = persistWords(item);
  noteWords(had ? { remove:[word] } : { add:[word] });
  $('word-mode').disabled = !item.words.length;
  if (message) message.textContent = !ok ? t('result.pickStorage') : had ? t('result.pickRemoved', { word }) : t('result.pickAdded', { n:1 });
  if (!had) translateWord(item, word, language.value);
  markPicked(had ? [] : [word]);
}
function countUp(node, target) {
  if (!node || !globalThis.requestAnimationFrame || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !(target > 0)) return;
  const begin = performance.now(), decimals = Number.isInteger(target) ? 0 : 1;
  const step = now => { const k = Math.min(1, (now - begin) / 700), eased = 1 - (1 - k) ** 3; node.textContent = (target * eased).toFixed(decimals); if (k < 1) globalThis.requestAnimationFrame(step); else node.textContent = String(target); };
  globalThis.requestAnimationFrame(step);
}
result.addEventListener('click', event => {
  const word = event.target.dataset?.pick;
  if (word && finished && !globalThis.getSelection?.()?.toString().trim()) togglePick(word);
});
// A drag selection in the finished article offers a floating "add" button beside it.
globalThis.document?.addEventListener?.('selectionchange', () => {
  const button = $('save-selected-words'), review = $('review-text');
  if (!finished || !button || !review) return;
  const selection = globalThis.getSelection?.();
  const inside = selection && !selection.isCollapsed && review.contains(selection.anchorNode) && review.contains(selection.focusNode);
  const words = inside ? selectedArticleWords(articleText, selection.toString()) : [];
  button.hidden = !words.length;
  if (!words.length) return;
  button.textContent = t('result.pickAddN', { n:words.length });
  const box = selection.getRangeAt(0).getBoundingClientRect(), frame = (button.offsetParent || result).getBoundingClientRect();
  button.style.left = `${Math.max(0, Math.min(box.left - frame.left + box.width / 2 - 60, frame.width - 140))}px`;
  button.style.top = `${box.top - frame.top - 46}px`;
});
$('word-mode').addEventListener('click', () => setMode('word'));
$('article-mode').addEventListener('click', () => setMode('article'));
$('restart').addEventListener('click', restart);
$('finish-now')?.addEventListener('click', finishEarly);
function resumePractice() {
  paused = false;
  setHint(baseHint()); updatePause(); $('typing')?.focus();
}
$('pause')?.addEventListener('click', () => {
  if (finished) return;
  if (!paused) { elapsedBase = elapsed(); started = null; clearInterval(timer); timer = null; paused = true; saveProgress(); setHint('hint.paused'); }
  else { resumePractice(); return; }
  updatePause();
});
lessonSelect.addEventListener('change', () => {
  if (!mayLeave()) { lessonSelect.value = String(lessons.findIndex(item => item.id === activeSettings.id)); return; }
  saveProgress(); updateSections(); if (lesson().custom) mode = 'article'; pickerPage = 0; loadPractice();
});
language.addEventListener('change', () => {
  try { globalThis.localStorage?.setItem('lingtype-language', language.value); } catch { /* the choice lasts for this visit */ }
  applyStatic(globalThis.document, language.value);
  const section = $('section-mode').value; updateSections(); $('section-mode').value = section;
  syncNotebookLesson(); renderNotebook(); renderHistory(); updatePause(); updateMetrics();
  if (currentView === 'public' && $('public-detail')?.hidden) loadPublicBooks();
  if (finished) { paintResult?.(); if (hintKey) setHint(...hintKey); return; }
  ++translationRun; sentenceTranslations = passageTranslations(splitSentences(typeable(lesson().text)), articleSentences, lesson().translations?.[language.value], language.value);
  render(); updatePause(); if (paused) setHint('hint.paused');
  if (mode === 'article' && translatable(lesson()) && !sentenceTranslations) prepareTranslation();
  else if (mode === 'word' && (translatable(lesson()) || retryWords)) translateWord(lesson(), currentWords()[wordIndex][0], language.value);
});
$('passage-mode').addEventListener('change', () => { if (!mayLeave()) { $('passage-mode').value = activeSettings.passage; return; } saveProgress(); loadPractice(); });
$('section-mode').addEventListener('change', () => { if (!mayLeave()) { $('section-mode').value = activeSettings.section; return; } saveProgress(); pickerPage = 0; loadPractice(); });
globalThis.addEventListener?.('pagehide', saveProgress);
globalThis.addEventListener?.('resize', () => { if (mode === 'article' && !finished) placeCaret(); });
// Any printable key brings focus back to the typing card, unless another text field is in use.
globalThis.document?.addEventListener?.('keydown', event => {
  if (event.key === 'Escape' && currentView === 'practice' && !finished && $('typing')) { event.preventDefault(); finishEarly(); return; }
  if (finished && currentView === 'practice' && event.key === 'Enter' && resultKeys && !globalThis.document.activeElement?.matches?.('input,textarea,select,button,summary,a,[contenteditable]')) {
    event.preventDefault(); (event.shiftKey ? resultKeys.again : resultKeys.next)(); return;
  }
  const field = $('typing');
  if (!field || finished || currentView !== 'practice' || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
  const active = globalThis.document.activeElement;
  if (active === field || active?.matches?.('input,textarea,select,[contenteditable]')) return;
  closeMenu();
  if (paused) resumePractice(); else field.focus();
});
function renderHistory() {
  const container = $('history-list'); if (!container) return;
  const items = readHistory(globalThis.localStorage);
  const locale = dateLocale[language.value];
  container.innerHTML = items.length ? items.map(item => `<tr><td>${escapeHtml(item.title)}</td><td class="meta">${escapeHtml(t(item.mode === 'word' ? 'mode.word' : 'mode.article'))}</td><td class="meta">${escapeHtml(new Date(item.date).toLocaleDateString(locale))}</td><td class="num">${Number(item.wpm) || 0}</td><td class="num">${item.mode === 'article' ? `${Number(item.accuracy) || 0}%` : escapeHtml(t('history.errors', { n:Number(item.errors) || 0 }))}</td><td class="num">${formatTime(Number(item.elapsed) || 0)}</td></tr>`).join('') : `<tr class="history-empty"><td colspan="6"><strong>${escapeHtml(t('history.empty'))}</strong><span>${escapeHtml(t('history.emptyNote'))}</span><button id="history-start" class="btn primary" type="button">${escapeHtml(t('history.start'))}</button></td></tr>`;
  $('history-start')?.addEventListener('click', () => { showView('practice'); currentView = 'practice'; if (globalThis.location && globalThis.history) globalThis.history.replaceState(null, '', '#practice'); });
}
function renderNotebook() {
  const list = $('notebook-list'); if (!list) return;
  const item = lessons.find(entry => entry.notebook);
  if ($('notebook-count')) $('notebook-count').textContent = notebook.length ? String(notebook.length) : '';
  if ($('notebook-words')) $('notebook-words').disabled = !notebook.length;
  if ($('notebook-sentences')) $('notebook-sentences').disabled = !notebook.some(entry => entry.sentences.length);
  const mark = (sentence, word) => escapeHtml(sentence).replace(new RegExp(`(^|[^A-Za-z&#;])(${escapeHtml(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![A-Za-z])`, 'gi'), '$1<mark>$2</mark>');
  list.innerHTML = item ? item.words.map(([word]) => {
    const entry = notebook.find(note => note.word === word), example = entry.sentences.at(-1);
    const meta = [example?.source ? t('notebook.from', { title:example.source }) : '', t('notebook.stats', { p:entry.practiced, m:entry.missed })].filter(Boolean).join(' · ');
    return `<li><div class="note-word"><strong>${escapeHtml(word)}</strong><span>${escapeHtml(entry.translations[language.value] || '—')}</span></div><div class="note-body">${example ? `<p class="note-sentence">${mark(example.text, word)}</p>` : ''}<span class="note-meta">${escapeHtml(meta)}</span></div><button type="button" class="btn-quiet note-remove" data-remove-note="${escapeHtml(word)}" aria-label="${escapeHtml(t('notebook.remove', { word }))}">×</button></li>`;
  }).join('') : `<li class="notebook-empty"><strong>${escapeHtml(t('notebook.empty'))}</strong><span>${escapeHtml(t('notebook.emptyNote'))}</span></li>`;
  if (item) fillWordTranslations(item);
}
$('notebook-list')?.addEventListener('click', event => {
  const word = event.target.dataset?.removeNote;
  if (!word) return;
  for (const item of lessons) if (item.words?.some(entry => entry[0].toLowerCase() === word)) { item.words = item.words.filter(entry => entry[0].toLowerCase() !== word); persistWords(item); }
  noteWords({ remove:[word] });
});
// Practise the notebook: its words, or the sentences they came from.
function practiceNotebook(practiceMode) {
  const index = lessons.findIndex(item => item.notebook);
  if (index < 0 || !mayLeave()) return;
  saveProgress(); lessonSelect.value = String(index); updateSections(); pickerPage = 0; mode = practiceMode; loadPractice(false);
  showView('practice'); currentView = 'practice'; globalThis.history?.replaceState?.(null, '', '#practice');
  $('typing')?.focus();
}
$('notebook-words')?.addEventListener('click', () => practiceNotebook('word'));
$('notebook-sentences')?.addEventListener('click', () => practiceNotebook('article'));
function closeMenu() { if ($('more-menu')) $('more-menu').open = false; }
$('delete-lesson')?.addEventListener('click', () => {
  closeMenu();
  const item = lesson();
  if (!item.custom || !globalThis.confirm(t('confirm.delete', { title:item.title }))) return;
  lessons.splice(lessons.indexOf(item), 1);
  if (!persistLibrary()) { lessons.push(item); globalThis.alert?.(t('alert.deleteFail')); return; }
  clearSnapshot(globalThis.localStorage, activeKey);
  updateLessonOptions(); lessonSelect.value = '0'; updateSections(); mode = 'word'; loadPractice();
});
function saveCustom(item, message) {
  if (!mayLeave()) return false;
  saveProgress();
  const custom = addCustomLesson(lessons.filter(entry => entry.custom), item);
  const builtIn = lessons.filter(entry => !entry.custom);
  lessons.splice(0, lessons.length, ...builtIn, ...custom);
  const stored = persistLibrary();
  if (!stored) $(message).textContent = t('notice.storageFail');
  updateLessonOptions(); lessonSelect.value = String(lessons.length - 1); updateSections(); mode = 'article'; loadPractice();
  showView('practice'); currentView = 'practice';
  if ($('workspace-notice')) { $('workspace-notice').textContent = stored ? '' : t('notice.storageFail'); $('workspace-notice').hidden = stored; }
  if (globalThis.location && globalThis.history) globalThis.history.replaceState(null, '', '#practice');
  return true;
}
const newId = () => `custom-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
function renderVocabulary() {
  const panel = $('lesson-vocab'), list = $('vocab-list'); if (!panel || !list) return;
  const item = lesson(), words = item.words || [];
  panel.hidden = !words.length;
  if ($('vocab-count')) $('vocab-count').textContent = words.length ? String(words.length) : '';
  list.innerHTML = words.map(word => `<div><dt>${escapeHtml(word[0])}</dt><dd>${escapeHtml(word[languageIndex()] || '—')}</dd></div>`).join('');
  fillWordTranslations(item);
}
// Words added by hand get their translation later; a failed attempt is retried on the next visit.
const wordAttempts = new Set();
function fillWordTranslations(item) {
  const index = languageIndex();
  for (const entry of (item.words || []).filter(word => !word[index]).slice(0, 12)) {
    const key = `${item.id}\u0000${language.value}\u0000${entry[0]}`;
    if (wordAttempts.has(key)) continue;
    wordAttempts.add(key); translateWord(item, entry[0], language.value);
  }
}
function renderPicker() {
  const panel = $('word-picker');
  if (!panel) return;
  const item = lesson(); panel.hidden = !item.custom;
  if (!item.custom) return;
  const section = item.sections && $('section-mode').value !== 'all' ? item.sections[Number($('section-mode').value)] : null;
  const text = section?.text || item.text;
  const selected = new Set((item.words || []).map(word => word[0]));
  const page = wordPage(text, $('word-search').value, item.knownWords || [], pickerPage);
  pickerPage = page.page;
  $('word-candidates').innerHTML = page.words.length ? page.words.map(word => `<div class="candidate"><label><input type="checkbox" value="${escapeHtml(word)}" ${selected.has(word) ? 'checked' : ''}><span>${escapeHtml(word)}</span></label><button type="button" class="known-word" data-word="${escapeHtml(word)}" aria-label="${escapeHtml(t('picker.knownAria', { word }))}">${escapeHtml(t('picker.known'))}</button></div>`).join('') : `<p class="picker-empty">${escapeHtml(t('picker.empty'))}</p>`;
  if ($('candidate-page')) $('candidate-page').textContent = `${page.page + 1} / ${page.pages}`;
  if ($('candidate-prev')) $('candidate-prev').disabled = page.page === 0;
  if ($('candidate-next')) $('candidate-next').disabled = page.page + 1 >= page.pages;
  if ($('picker-count')) $('picker-count').textContent = selected.size ? String(selected.size) : '';
  $('selected-words').innerHTML = selected.size ? `<span>${escapeHtml(t('picker.selected', { n:selected.size }))}</span> ${[...selected].map(word => `<button type="button" class="selected-word" data-remove-word="${escapeHtml(word)}" aria-label="${escapeHtml(t('picker.removeAria', { word }))}">${escapeHtml(word)} ×</button>`).join(' ')}` : escapeHtml(t('picker.none'));
  $('picker-start').disabled = !selected.size;
}
$('word-search')?.addEventListener('input', () => { pickerPage = 0; renderPicker(); });
$('candidate-prev')?.addEventListener('click', () => { pickerPage--; renderPicker(); });
$('candidate-next')?.addEventListener('click', () => { pickerPage++; renderPicker(); });
$('known-reset')?.addEventListener('click', () => { lesson().knownWords = []; persistLibrary(); pickerPage = 0; renderPicker(); });
function prepareWordListChange() {
  const hasProgress = (mode === 'word' && !finished && (input || wordIndex || errors)) || hasModeSnapshots(globalThis.localStorage, lesson().id, 'word');
  if (hasProgress && typeof globalThis.confirm === 'function' && !globalThis.confirm(t('confirm.words'))) return false;
  clearModeSnapshots(globalThis.localStorage, lesson().id, 'word');
  if (mode === 'word') { clearSnapshot(globalThis.localStorage, activeKey); mode = 'article'; loadPractice(); }
  return true;
}
$('selected-words')?.addEventListener('click', event => {
  const word = event.target.dataset?.removeWord;
  if (!word || !prepareWordListChange()) return;
  const item = lesson(); item.words = item.words.filter(entry => entry[0] !== word);
  persistLibrary(); noteWords({ remove:[word] }); renderPicker(); $('word-mode').disabled = !item.words.length;
});
$('word-candidates')?.addEventListener('click', event => {
  const word = event.target.dataset?.word;
  if (!word) return;
  if (!prepareWordListChange()) return;
  const item = lesson(); item.knownWords ||= [];
  if (!item.knownWords.includes(word)) item.knownWords.push(word);
  item.words = item.words.filter(entry => entry[0] !== word);
  persistLibrary(); noteWords({ remove:[word] });
  renderPicker();
  $('word-mode').disabled = !item.words.length;
});
$('word-candidates')?.addEventListener('change', async event => {
  const target = event.target;
  if (target.type !== 'checkbox') return;
  if (!prepareWordListChange()) { target.checked = !target.checked; return; }
  const item = lesson(), word = target.value;
  item.words ||= [];
  if (target.checked && !item.words.some(entry => entry[0] === word)) item.words.push([word, '', '', '']);
  if (!target.checked) item.words = item.words.filter(entry => entry[0] !== word);
  persistLibrary();
  noteWords(target.checked ? { add:[word], text:item.text } : { remove:[word] });
  renderPicker();
  $('word-mode').disabled = !item.words.length;
  if (!target.checked) return;
  translateWord(item, word, language.value);
});
async function translateWord(item, word, selectedLanguage) {
  const index = ({zh:1, ja:2, ko:3})[selectedLanguage];
  const selectedEntry = item.words.find(entry => entry[0] === word);
  const retryEntry = lesson() === item ? retryWords?.find(entry => entry[0] === word) : null;
  if ((retryEntry || selectedEntry)?.[index]) return;
  try {
    const response = await fetch('/api/translate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ language:selectedLanguage, sentences:[word] }) });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.translations)) return;
    const translation = typeof data.translations[0] === 'string' && data.translations[0].trim().toLowerCase() !== word.toLowerCase() ? data.translations[0] : '';
    if (!translation) return;
    const entry = item.words.find(value => value[0] === word);
    if (entry) { entry[index] = translation; persistWords(item); if (lesson() === item) renderVocabulary(); }
    if (retryEntry && retryWords?.includes(retryEntry)) { retryEntry[index] = translation; scheduleProgress(); }
    if (!finished && mode === 'word' && lesson() === item && currentWords()[wordIndex]?.[0] === word && language.value === selectedLanguage) exercise.querySelector('.translation').textContent = translation || t('word.noTranslation');
  } catch { /* Word practice remains available without a translation. */ }
}
$('picker-start')?.addEventListener('click', () => setMode('word'));
$('publish-workbook')?.addEventListener('click', async () => {
  closeMenu();
  if (!globalThis.confirm(t('confirm.publish'))) return;
  const button = $('publish-workbook'); button.disabled = true;
  try {
    const workbook = createWorkbook(lesson());
    const body = JSON.stringify(workbook); readWorkbook(body);
    const response = await fetch('/api/workbooks', {method:'POST', headers:{'Content-Type':'application/json'}, body});
    const data = await response.json();
    if (!response.ok || !/^[0-9a-f]{32}$/.test(data.id || '') || typeof data.ownerKey !== 'string') throw new Error(data.error || '');
    const ownerKeys = readOwnerKeys(); ownerKeys[data.id] = data.ownerKey;
    let canUnpublish = true;
    try { globalThis.localStorage.setItem('lingtype-published-keys', JSON.stringify(ownerKeys)); } catch { canUnpublish = false; }
    const notice = $('workspace-notice');
    const url = new URL(globalThis.location.href); url.hash = `book-${data.id}`;
    notice.textContent = t(['localhost','127.0.0.1'].includes(url.hostname) ? 'notice.local' : 'notice.shared') + ' ';
    const link = document.createElement('a'); link.href = url.href; link.textContent = url.href; notice.append(link); notice.hidden = false;
    if (!canUnpublish) notice.append(document.createTextNode(` ${t('notice.keyFail', { key:data.ownerKey })}`));
  } catch (error) { setHint('hint.publishFail', { error:localError(error.message, 'public.loadFail') }); }
  finally { button.disabled = false; }
});
$('export-workbook')?.addEventListener('click', () => {
  closeMenu();
  try {
    const json = JSON.stringify(createWorkbook(lesson()), null, 2);
    readWorkbook(json);
    const blob = new Blob([json], {type:'application/json'});
    if (blob.size > 2_000_000) throw new Error(t('import.workbookBig'));
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${lesson().title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'lingtype'}.lingtype.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setHint('hint.exported');
  } catch { setHint('hint.exportFail'); }
});
// Translations that came with an import (a video's human subtitles) are stored as if already translated.
function rememberTranslations(byLanguage) {
  if (!byLanguage || typeof byLanguage !== 'object') return;
  for (const code of languages) {
    for (const [sentence, text] of Object.entries(byLanguage[code] || {})) if (typeof text === 'string' && text.trim() && text.trim() !== sentence) translationCache[`${code}\u0000${sentence}`] = text;
  }
  try { globalThis.localStorage?.setItem('lingtype-translations', JSON.stringify(translationCache)); } catch { /* kept for this visit */ }
}
// A long text is split at paragraph ends into parts of a few thousand characters, so each part is one sitting.
function autoSections(text) {
  if (text.length <= LONG_TEXT) return null;
  const sections = []; let current = [];
  const close = () => { const body = current.join('\n\n'); sections.push({ title:`${sections.length + 1}. ${body.split(/\s+/).slice(0, 6).join(' ')}…`, text:body }); current = []; };
  for (const paragraph of text.split(/\n\s*\n/)) { current.push(paragraph); if (current.join('\n\n').length >= 5000) close(); }
  if (current.length) close();
  return sections;
}
function importedLesson(data, category) {
  const sections = data.sections?.length ? data.sections : autoSections(data.text);
  const sourceUrl = /^https?:\/\/[^\s]+$/.test(data.sourceUrl || '') ? data.sourceUrl : '';
  return { id:newId(), custom:true, title:(data.title || t('import.defaultTitle')).slice(0, 100), category, text:data.text, ...(sections ? { sections } : {}), ...(sourceUrl ? { sourceUrl } : {}), ...(data.authors ? { authors:data.authors } : {}), ...(data.license ? { license:data.license } : {}), translations:{ zh:'', ja:'', ko:'' }, words:[] };
}
// Files: practice books and subtitles are read here; documents go to the server to have their text pulled out.
async function importFile(file) {
  const message = $('workbook-message');
  if (!file || !message) return;
  if (file.size > 20_000_000) { message.textContent = t('import.fileBig'); return; }
  const name = file.name.toLowerCase();
  message.textContent = t('import.reading');
  try {
    let item;
    if (name.endsWith('.json')) { item = readWorkbook(await file.text()); item.id = newId(); }
    else if (/\.(srt|vtt)$/.test(name)) item = importedLesson({ title:file.name.replace(/\.(srt|vtt)$/i, ''), text:parseSubtitles(await file.text()) }, 'subtitles');
    else {
      const response = await fetch(`/api/extract?name=${encodeURIComponent(file.name)}`, { method:'POST', headers:{ 'Content-Type':'application/octet-stream' }, body:file });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '');
      item = importedLesson(data, 'document');
    }
    message.textContent = '';
    if (!saveCustom(item, 'workbook-message')) message.textContent = t('import.cancelled');
    else if (!message.textContent) message.textContent = t('import.done', { title:item.title });
  } catch (error) { message.textContent = error instanceof SyntaxError ? t('import.needServer') : t('import.fileFail', { error:localError(error.message, 'import.fileBad') }); }
}
$('document-file')?.addEventListener('change', event => { importFile(event.target.files?.[0]); event.target.value = ''; });
const dropzone = $('dropzone');
for (const type of ['dragenter', 'dragover']) dropzone?.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('dragging'); });
for (const type of ['dragleave', 'drop']) dropzone?.addEventListener(type, () => dropzone.classList.remove('dragging'));
dropzone?.addEventListener('drop', event => { event.preventDefault(); importFile(event.dataTransfer?.files?.[0]); });
$('import-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('import-text').value.trim();
  if (!text) return;
  const item = importedLesson({ title:$('import-title').value.trim(), text }, 'custom');
  item.translations[language.value] = $('import-translation').value.trim();
  $('import-message').textContent = '';
  if (!saveCustom(item, 'import-message')) { $('import-message').textContent = t('import.cancelled'); return; }
  for (const id of ['import-title', 'import-text', 'import-translation']) $(id).value = '';
  if (!$('import-message').textContent) $('import-message').textContent = t('import.added');
});
// One address box: YouTube subtitles, a web article, or an arXiv paper with its sections.
$('arxiv-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('arxiv-submit'); const message = $('arxiv-message'); button.disabled = true; message.textContent = t('import.loading');
  try {
    const response = await fetch(`/api/import?url=${encodeURIComponent($('arxiv-url').value.trim())}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '');
    if (Array.isArray(data.sections) && data.sections.length && !data.text) data.text = data.sections.map(section => section.text).join('\n\n');
    rememberTranslations(data.sentenceTranslations);
    const host = (() => { try { return new URL(data.sourceUrl).hostname; } catch { return ''; } })();
    const item = importedLesson(data, host === 'arxiv.org' ? 'arxiv' : /youtube\.com$/.test(host) ? 'youtube' : 'web');
    message.textContent = '';
    if (!saveCustom(item, 'arxiv-message')) message.textContent = t('import.cancelled');
    else {
      $('arxiv-url').value = '';
      if (!message.textContent) message.textContent = item.category === 'arxiv' ? t('import.arxivDone', { n:item.sections.length }) : t('import.done', { title:item.title });
    }
  } catch (error) { message.textContent = error instanceof SyntaxError ? t('import.needServer') : t('import.arxivFail', { error:localError(error.message, 'import.urlBad') }); }
  finally { button.disabled = false; }
});
async function loadPublicBooks() {
  const list = $('public-books'), message = $('public-message'); if (!list || !message) return;
  const run = ++publicRun;
  message.textContent = t('public.loading'); list.innerHTML = '';
  try {
    const response = await fetch('/api/workbooks'); const data = await response.json();
    if (run !== publicRun) return;
    if (!response.ok || !Array.isArray(data.books)) throw new Error(data.error || '');
    message.textContent = data.books.length ? '' : t('public.empty');
    const ownerKeys = readOwnerKeys(), locale = dateLocale[language.value];
    list.innerHTML = data.books.filter(item => /^[0-9a-f]{32}$/.test(item.id) && typeof item.title === 'string').map(item => `<li><button class="book" type="button" data-book-id="${item.id}">${escapeHtml(item.title)}</button><span class="date">${escapeHtml(new Date(item.createdAt).toLocaleDateString(locale))}</span>${ownerKeys[item.id] ? `<button class="btn-quiet" type="button" data-remove-book="${item.id}">${escapeHtml(t('public.remove'))}</button>` : ''}</li>`).join('');
  } catch (error) { if (run === publicRun) message.textContent = localError(error.message, 'public.loadFail'); }
}
async function openPublicBook(id) {
  const detail = $('public-detail'), message = $('public-message');
  if (!detail || !message || !/^[0-9a-f]{32}$/.test(id)) return;
  if (started !== null && !paused && !finished) $('pause')?.click();
  const run = ++publicRun;
  showView('public'); currentView = 'public'; detail.hidden = true; $('public-books').hidden = false; message.textContent = t('public.loading');
  try {
    const response = await fetch(`/api/workbooks/${id}`); const data = await response.json();
    if (run !== publicRun) return;
    if (!response.ok) throw new Error(data.error || t('public.notFound'));
    const item = readWorkbook(JSON.stringify(data));
    detail.innerHTML = `<h2>${escapeHtml(item.title)}</h2><p class="public-detail-text">${escapeHtml(item.text)}</p><div class="public-detail-actions"><button id="add-public-book" class="btn primary" type="button">${escapeHtml(t('public.add'))}</button><button id="public-back" class="btn" type="button">${escapeHtml(t('public.back'))}</button><span id="public-detail-message" class="message" role="status"></span></div>`;
    detail.hidden = false; $('public-books').hidden = true; message.textContent = '';
    $('add-public-book').addEventListener('click', () => { item.id = newId(); if (!saveCustom(item, 'public-detail-message')) $('public-detail-message').textContent = t('public.cancelled'); });
    $('public-back').addEventListener('click', () => { detail.hidden = true; $('public-books').hidden = false; globalThis.history?.replaceState(null, '', '#public'); loadPublicBooks(); });
  } catch (error) { if (run === publicRun) message.textContent = localError(error.message, 'public.notFound'); }
}
$('public-books')?.addEventListener('click', async event => {
  const removeId = event.target.dataset?.removeBook;
  if (removeId && /^[0-9a-f]{32}$/.test(removeId)) {
    if (!globalThis.confirm(t('public.removeConfirm'))) return;
    const ownerKeys = readOwnerKeys();
    try {
      const response = await fetch(`/api/workbooks/${removeId}`, {method:'DELETE', headers:{'X-Owner-Key':ownerKeys[removeId] || ''}});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '');
      delete ownerKeys[removeId]; try { globalThis.localStorage.setItem('lingtype-published-keys', JSON.stringify(ownerKeys)); } catch { /* the server has already removed the book */ }
      loadPublicBooks();
    } catch (error) { $('public-message').textContent = localError(error.message, 'public.removeFail'); }
    return;
  }
  const id = event.target.dataset?.bookId;
  if (!id || !/^[0-9a-f]{32}$/.test(id)) return;
  globalThis.history?.replaceState(null, '', `#book-${id}`); openPublicBook(id);
});
function readOwnerKeys() {
  try { const value = JSON.parse(globalThis.localStorage?.getItem('lingtype-published-keys') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
$('unpublish-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('unpublish-message');
  const match = $('unpublish-id').value.trim().match(/(?:^|#book-)([0-9a-f]{32})$/);
  if (!match) { message.textContent = t('public.invalidId'); return; }
  if (!globalThis.confirm(t('public.removeConfirm'))) return;
  try {
    const response = await fetch(`/api/workbooks/${match[1]}`, { method:'DELETE', headers:{'X-Owner-Key':$('unpublish-key').value.trim()} });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '');
    $('unpublish-key').value = ''; message.textContent = t('public.removed'); loadPublicBooks();
  } catch (error) { message.textContent = localError(error.message, 'public.removeFail'); }
});
globalThis.addEventListener?.('hashchange', () => {
  const match = /^#book-([0-9a-f]{32})$/.exec(globalThis.location?.hash || '');
  if (match) openPublicBook(match[1]);
});
$('brand')?.addEventListener('click', event => { event.preventDefault(); $('nav-practice')?.click(); });
let lastPractice;
try { lastPractice = JSON.parse(globalThis.localStorage?.getItem('lingtype-last-practice') || 'null'); } catch { lastPractice = null; }
const lastIndex = lastPractice ? lessons.findIndex(item => item.id === lastPractice.id) : -1;
if (lastIndex >= 0) {
  lessonSelect.value = String(lastIndex);
  const lastKey = snapshotKey(lastPractice.id, 'word', lastPractice.section || 'all', lastPractice.passage || 'full');
  const savedWords = readSnapshot(globalThis.localStorage, lastKey)?.retryWords;
  mode = lastPractice.mode === 'word' && (lessons[lastIndex].words?.length || savedWords?.length) ? 'word' : 'article';
}
updateSections();
if (lastIndex >= 0) { $('section-mode').value = lastPractice.section || 'all'; $('passage-mode').value = lastPractice.passage || 'full'; }
loadPractice();
renderHistory();
if (initialView === 'public') {
  const match = /^book-([0-9a-f]{32})$/.exec(initialHash);
  if (match) openPublicBook(match[1]); else loadPublicBooks();
}
