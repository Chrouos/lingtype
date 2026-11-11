import { lessons, selectPassageSelection, passageParts, splitSentences, nextPassageSelection, importedSections } from './data.mjs';
import { wordEdit, articleResult, typedCounts, sessionStats, activeTypingEnd } from './typing.mjs';
import { wordPage, articleWords, practicedArticleWords, nextWordFocus } from './vocabulary.mjs';
import { readNotebook, saveNotebook, sentenceWith, addWord, removeWord, recordPractice, notebookLesson, dueWords, nextReviewTime, updateWordTranslation } from './notebook.mjs';
import { readCustomLessons, addCustomLesson, persistLessonRemoval, persistEditedCopy, readBuiltinWords, saveBuiltinWords } from './library.mjs';
import { editableLessonText, createEditedLessonCopy } from './lesson-edit.mjs';
import { readHistory, saveResult } from './history.mjs';
import { snapshotKey, saveSnapshot, readSnapshot, hasSnapshot, clearSnapshot, clearModeSnapshots, hasModeSnapshots, lastArticleScope, randomPassageSnapshots, wrongWordAt, comparison, bestResult, saveBest, passageId } from './practice.mjs';
import { setupViews } from './views.mjs';
import { sentenceAt, createSentenceInput, passageTranslations, separatorPositions, typeable } from './sentences.mjs';
import { createWorkbook, readWorkbook, selectedArticleWords } from './workbook.mjs';
import { decodeSubtitleFile, parseSubtitles } from './subtitles.mjs';
import { translate, applyStatic, pickLanguage, dateLocale, languages } from './i18n.mjs';
import { setupLessonPreview } from './lesson-preview.mjs';
import { richText, plainText, formulaHtml, isFormula, figureEvents, figureAt, figureHtml, figuresInText, safeImage, cleanFormulas, cleanFigures } from './paper.mjs';
import { createPageRenderer, pageFigures, pdfKey } from './pdf-pages.mjs';
import { createTranslationCache, readTranslationCache } from './translation-cache.mjs';
import { requestTranslation } from './translation-request.mjs';
import { availableLocalStorage, openLargeDatabase, createLargeStorage } from './storage.mjs';
import { acquireEditorLock } from './editor-lock.mjs';
import { createBackup, createBackupWithPdfs, readBackup, verifyBackup, verifyLegacyPdfCompatibility, hasUnverifiedPdfs, stageBackupRestore, applyStagedBackup, MAX_BACKUP_BYTES } from './backup.mjs';
import { cleanShelf, typingMinutes, coverColors, readVisitor, createPublicationIdentity } from './community.mjs';
import { recordPublicPart, pendingPublicAttempts, drainPublicAttempts, queuePublicStart, pendingPublicStarts, drainPublicStarts, queuePublicRead, pendingPublicReads, drainPublicReads, withPublicAttemptTimeout } from './community-progress.mjs';
import { caretScrollOffset } from './caret-viewport.mjs';
import { createCommentTracker } from './comment-pending.mjs';
import { createCoverUploadQueue } from './cover-upload.mjs';
import { mountIcons } from './icons.mjs';
import { readReading, noteReading, forgetReading, readingSections, partOffsets, readingSpan, bookProgress, nextUnread } from './reading.mjs';

const $ = (id) => document.getElementById(id);
const editorLock = await acquireEditorLock(globalThis.navigator?.locks);
if (!editorLock.acquired) {
  const code = pickLanguage(null, globalThis.navigator?.language);
  document.body.innerHTML = '';
  const main = document.createElement('main'), message = document.createElement('p'), retry = document.createElement('button');
  message.textContent = translate(code, 'lock.busy');
  retry.className = 'btn primary'; retry.type = 'button'; retry.textContent = translate(code, 'lock.retry');
  retry.addEventListener('click', () => globalThis.location.reload());
  main.append(message, retry); document.body.append(main);
  await new Promise(() => {});
}
let storageError = false;
let reportStorageError = () => { storageError = true; };
let storage, database, restoreStatus = '';
const local = availableLocalStorage(globalThis, () => reportStorageError());
try {
  database = await openLargeDatabase(globalThis.indexedDB);
  storage = await createLargeStorage(local, database, () => reportStorageError());
} catch { storage = local; storageError = true; }
if (database && storage) {
  try {
    const staged = await database.read('pending-restore');
    if (staged !== null && staged !== undefined) {
      if (storage?.volatile || !storage?.flush) throw Object.assign(new Error('Storage unavailable'), {recoveryPending:true});
      await applyStagedBackup(storage, database, staged);
      restoreStatus = 'backup.done';
    }
  } catch (error) {
    if (error.recoveryPending) {
      const code = pickLanguage(null, globalThis.navigator?.language);
      document.body.innerHTML = '';
      const main = document.createElement('main'), message = document.createElement('p'), retry = document.createElement('button');
      message.textContent = translate(code, 'backup.recoveryBlocked');
      retry.className = 'btn primary'; retry.type = 'button'; retry.textContent = translate(code, 'lock.retry');
      retry.addEventListener('click', () => globalThis.location.reload());
      main.append(message, retry); document.body.append(main);
      await new Promise(() => {});
    }
    restoreStatus = 'backup.failed';
  }
}
const lessonSelect = $('lesson'), language = $('language'), exercise = $('exercise'), result = $('result');
try { language.value = pickLanguage(storage?.getItem('lingtype-language'), globalThis.navigator?.language); } catch { language.value = pickLanguage(null, globalThis.navigator?.language); }
const t = (key, vars) => translate(language.value, key, vars);
reportStorageError = () => {
  storageError = true;
  const notice = $('workspace-notice');
  if (notice) { notice.textContent = t('notice.storageFail'); notice.hidden = false; }
};
// Server and parser messages are written in Chinese; other languages get a translated summary.
const localError = (message, key) => language.value === 'zh' && message ? message : t(key);
applyStatic(globalThis.document, language.value);
mountIcons(globalThis.document);
if (!editorLock.protected && $('lock-warning')) { $('lock-warning').textContent = t('lock.unsupported'); $('lock-warning').hidden = false; }
if (restoreStatus && $('backup-message')) $('backup-message').textContent = t(restoreStatus);
if (storageError && $('workspace-notice')) { $('workspace-notice').textContent = t('notice.storageFail'); $('workspace-notice').hidden = false; }
// The library is the home page; a book being read opens from the shelf.
const initialHash = globalThis.location?.hash.slice(1) || 'public';
const initialView = /^book-[0-9a-f]{32}$/.test(initialHash) ? 'public' : initialHash;
let currentView = initialView;
function enterView(name) {
  currentView = name;
  if (name !== 'practice' && started !== null && !paused && !finished) $('pause')?.click();
  if (name === 'notebook') renderNotebook();
  if (name === 'public') { showShelf(true); loadPublicBooks(); }
  if (name === 'shelf') renderMyShelf();
  if (globalThis.location && globalThis.history) globalThis.history.replaceState(null, '', `#${name}`);
}
const showView = setupViews($, enterView, initialView, { practice:'shelf', import:'shelf' });
let mode = 'article', wordIndex = 0, errors = 0, started = null, finished = false, input = '', articleText = '', articlePassageIndex = null, sentenceTranslations = null, translationRun = 0;
let timer = null, saveTimer = null;
let publicRun = 0;
let articleSentences = [], sentenceStarts = [];
// Where the text being typed starts in its section, the section's paragraphs,
// and whether typing it moves the book's bookmark.
let articleBase = 0, articleOffsets = [], readingTracked = false;
// A paper's formulas (drawn, not typed) and the positions where each of its figures becomes the one shown.
let articleFormulas = [], paperFigures = [], shownFigure, figureOpen = true, pinnedFigure = null, figurePosition = 0;
const pdfPages = createPageRenderer(id => database?.read(pdfKey(id)));
let advanceArticleInput = () => '';
let autoSeparators = new Set();
let elapsedBase = 0, paused = false, activeKey = '', activeSettings = null, retryWords = null, pickerPage = 0, unfinishedSavePending = false;
const PASSAGE_PAGE_SIZE = 100;
let passageChoicePage = 0;
let passageOnlySaved = false;
let progressEdited = false;
let wrongWords = new Set();
// A stopped practice can be resumed repeatedly. Remember what it already credited.
let creditedWords = new Set(), creditedMistakes = new Set();
let paintResult = null, hintKey = null, resultKeys = null;
// Texts finished one after another form a session; its totals are shown when the typist stops.
const newSession = () => ({ pieces:0, correct:0, total:0, time:0, wrong:new Set() });
let session = newSession(), keepSession = false, toastTimer = null;
let restoringBackup = false;
let deletingLesson = false;
let lessonEditSaving = false;
let publishingCount = 0;
let postingCommentCount = 0;
const translationCache = readTranslationCache(storage);
const cacheStorage = { getItem:key => storage?.getItem(key), setItem:(key, value) => { if (!restoringBackup) storage?.setItem(key, value); } };
const translationService = createTranslationCache(cacheStorage, requestTranslation, translationCache);
function passageWithEdits(item) {
  const base = passageTranslations(splitSentences(typeable(item.text)), articleSentences, item.translations?.[language.value], language.value);
  return base ? base.map((value, i) => translationService.get(articleSentences[i].trim(), language.value) || value) : null;
}
for (const item of lessons) { const words = readBuiltinWords(storage, item.id); if (words) item.words = words; }
lessons.push(...readCustomLessons(storage));
function persistLibrary() { if (restoringBackup || lessonEditSaving) return false; try { storage?.setItem('lingtype-custom-lessons', JSON.stringify(lessons.filter(item => item.custom))); return true; } catch { return false; } }
function persistWords(item) {
  if (item.notebook) { notebook = notebook.map(entry => { const found = item.words.find(word => word[0] === entry.word); return found ? { ...entry, translations:{ ...entry.translations, ...Object.fromEntries(['zh', 'ja', 'ko'].map((code, i) => [code, found[i + 1] || entry.translations[code] || ''])) } } : entry; }); return saveNotebook(storage, notebook); }
  return item.custom ? persistLibrary() : saveBuiltinWords(storage, item.id, item.words);
}
let notebook = readNotebook(storage);
const translatable = item => item.custom || item.notebook;
function syncNotebookLesson() {
  const currentId = lessons[Number(lessonSelect.value)]?.id, at = lessons.findIndex(item => item.notebook);
  const previous = at >= 0 ? lessons[at] : null;
  // Keep the result's source lesson until the reader leaves it, even if their
  // last notebook word is removed from that result. They may add it back.
  const keepResult = !notebook.length && previous && currentId === 'notebook' && activeSettings?.id === 'notebook' && finished && currentView === 'practice' && result.hidden === false;
  if (at >= 0) lessons.splice(at, 1);
  const firstImport = lessons.findIndex(item => item.custom);
  if (notebook.length || keepResult) lessons.splice(firstImport < 0 ? lessons.length : firstImport, 0, keepResult ? previous : notebookLesson(notebook, t('notebook.lesson')));
  updateLessonOptions();
  lessonSelect.value = String(Math.max(0, lessons.findIndex(item => item.id === currentId)));
}
// Picking a word anywhere keeps it in the notebook with the sentence it came from; unpicking takes it out.
function noteWords({ add = [], remove = [], text = articleText } = {}) {
  const item = lesson();
  for (const word of add) {
    const known = item.words?.find(entry => entry[0].toLowerCase() === word.toLowerCase());
    notebook = addWord(notebook, { word, sentence:plainText(sentenceWith(text, word), item.formulas), source:item.notebook ? '' : item.title, translations:known ? { zh:known[1], ja:known[2], ko:known[3] } : {} });
  }
  for (const word of remove) notebook = removeWord(notebook, word);
  const saved = saveNotebook(storage, notebook);
  if (!saved) setHint('result.pickStorage');
  syncNotebookLesson();
  renderNotebook();
  return saved;
}
function lessonLabel(item) {
  return item.custom && /^[0-9a-f]{32}$/.test(item.publicId || '')
    ? `${item.title} · ${t('public.copyLabel', { id:item.publicId.slice(0, 8) })}` : item.title;
}
function updateLessonOptions() { lessonSelect.innerHTML = ''; lessons.forEach((item, i) => { const option = document.createElement('option'); option.value = i; option.textContent = lessonLabel(item); lessonSelect.append(option); }); }
updateLessonOptions();
syncNotebookLesson();
const lesson = () => lessons[Number(lessonSelect.value)];
let lessonPreview = null;
function updateSections() {
  const sectionSelect = $('section-mode'), current = sectionSelect.value; sectionSelect.innerHTML = '';
  // A long document is practised one part at a time; drawing all of it at once would slow typing.
  const long = lesson().sections?.length && lesson().text.length > LONG_TEXT;
  if (!long) { const all = document.createElement('option'); all.value = 'all'; all.textContent = t('section.all'); sectionSelect.append(all); }
  (lesson().sections || []).forEach((section, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = section.title; sectionSelect.append(option); });
  sectionSelect.value = long ? '0' : 'all';
  return current;
}
function restoreArticleScope(item) {
  const scope = lastArticleScope(storage, item.id);
  if (!scope) return;
  const section = scope.section;
  if ((section === 'all' && !(item.sections?.length && item.text.length > LONG_TEXT)) || (/^\d+$/.test(section) && Number(section) < (item.sections?.length || 0))) $('section-mode').value = section;
  $('passage-mode').value = item.custom || scope.passage === 'from' ? scope.passage : 'full';
}
const LONG_TEXT = 12000;
const languageIndex = () => ({ zh: 1, ja: 2, ko: 3 })[language.value];
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const IDLE_MS = 6000;
const elapsed = () => elapsedBase + (started === null ? 0 : Math.max(0, activeTypingEnd(lastKeyAt, performance.now(), IDLE_MS) - started));
const formatTime = (ms) => { const sec = Math.floor(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const currentWords = () => retryWords || lesson().words;
// A hint remembers its key so it can be shown again in another language.
function setHint(key, vars) { hintKey = key ? [key, vars] : null; $('hint').textContent = key ? t(key, vars) : ''; }
const baseHint = () => paused ? 'hint.paused' : mode === 'word' ? 'hint.word' : 'hint.article';
function saveProgress() {
  clearTimeout(saveTimer); saveTimer = null;
  if (restoringBackup) return false;
  if (!activeKey || (finished && !unfinishedSavePending)) return true;
  // Deleting all input can leave an older snapshot behind when no time was
  // accumulated (for example, one key followed by a long idle period).
  if (!input && !wordIndex && !errors && started === null && !elapsedBase) {
    if (!progressEdited) { unfinishedSavePending = false; return true; }
    const exists = hasSnapshot(storage, activeKey);
    const ok = exists !== null && (!exists || clearSnapshot(storage, activeKey));
    if (!ok) setHint('hint.saveFail');
    else unfinishedSavePending = false;
    return ok;
  }
  let ok = saveSnapshot(storage, activeKey, { input, wordIndex, errors, elapsed:elapsed(), articleText, articlePassageIndex, wrongWords:[...wrongWords], creditedWords:[...creditedWords], creditedMistakes:[...creditedMistakes], retryWords });
  if (ok) try { storage?.setItem('lingtype-last-practice', JSON.stringify(activeSettings)); } catch { ok = false; }
  if (ok && !noteCurrentReading()) ok = false;
  if (!ok) setHint('hint.saveFail');
  else unfinishedSavePending = false;
  return ok;
}
function noteCurrentReading(complete = false) {
  if (!readingTracked || !activeSettings) return true;
  const span = readingSpan(articleOffsets, articleBase, articleBase + (complete ? articleText.length : input.length));
  // After a finished passage the bookmark moves to the paragraph that follows it.
  const scope = complete ? null : { section:activeSettings.section, passage:activeSettings.passage, start:activeSettings.passageIndex ?? null };
  return noteReading(storage, activeSettings.id, { section:activeSettings.section, at:complete ? span.at + 1 : span.at, read:span.read, scope });
}
function readerPart() { return readingTracked ? readingSpan(articleOffsets, articleBase, articleBase + input.length).at : null; }
function renderReaderHeading() {
  const item = lesson();
  if ($('reader-title')) $('reader-title').textContent = item?.title || '';
  const crumb = $('reader-crumb'); if (!crumb || !item) return;
  const part = mode === 'article' ? readerPart() : null;
  const section = item.sections && activeSettings?.section !== 'all' ? item.sections[Number(activeSettings?.section)] : null;
  crumb.textContent = mode === 'word' ? t('mode.word') : [section?.title, part === null ? '' : t('book.partOf', { n:part + 1, total:articleOffsets.length })].filter(Boolean).join(' · ');
}
function scheduleProgress() { clearTimeout(saveTimer); saveTimer = setTimeout(saveProgress, 400); }
function mayLeave() { return finished || (!input && !wordIndex && !errors) || typeof globalThis.confirm !== 'function' || globalThis.confirm(t('confirm.leave')); }
function resetClock() { clearInterval(timer); clearTimeout(saveTimer); timer = null; saveTimer = null; started = null; elapsedBase = 0; paused = false; }
function loadPractice(restore = true, initialRetry = null, initialArticle = null, initialPassageIndex = null, wordScope = null) {
  if (!keepSession) session = newSession();
  unfinishedSavePending = false;
  resetClock(); progressEdited = false; wordIndex = 0; errors = 0; finished = false; input = ''; retryWords = initialRetry; wrongWords = new Set(); creditedWords = new Set(); creditedMistakes = new Set(); sentenceTranslations = null; paintResult = null; ++translationRun;
  const item = lesson(), sectionValue = $('section-mode').value || 'all', passageValue = $('passage-mode').value || 'full';
  activeSettings = { id:item.id, mode, section:sectionValue, passage:passageValue, ...(mode === 'word' && wordScope ? { wordScope } : {}) };
  activeKey = snapshotKey(item.id, mode, sectionValue, passageValue, mode === 'word' ? wordScope : null);
  const section = item.sections && sectionValue !== 'all' ? item.sections[Number(sectionValue)] : null;
  const source = typeable(section?.text || item.text);
  const parts = passageParts(source);
  let fromIndex = null;
  if (mode === 'article' && passageValue === 'from') {
    const scope = lastArticleScope(storage, item.id);
    fromIndex = Number.isInteger(initialPassageIndex) && initialPassageIndex >= 0 && initialPassageIndex < parts.length ? initialPassageIndex
      : scope?.passage === 'from' && scope.section === sectionValue && scope.index < parts.length ? scope.index : null;
    if (!fromIndex) { $('passage-mode').value = 'full'; return loadPractice(restore, initialRetry, initialArticle, null, wordScope); }
    activeKey = snapshotKey(item.id, mode, sectionValue, 'from', `from:${fromIndex}`);
    activeSettings.passageIndex = fromIndex;
  }
  const offsets = partOffsets(source);
  const randomArticle = mode === 'article' && item.custom && passageValue === 'random';
  let randomIndex = null, randomSaved = null;
  if (randomArticle) {
    const validSnapshots = randomPassageSnapshots(storage, item.id, sectionValue).map(entry => {
      const text = typeof entry.value?.articleText === 'string' ? typeable(entry.value.articleText).trim() : '';
      const index = Number.isInteger(entry.index) && parts[entry.index] === text ? entry.index : entry.key === snapshotKey(item.id, 'article', sectionValue, 'random') ? parts.indexOf(text) : -1;
      return {...entry, index};
    }).filter(entry => entry.index >= 0 && entry.index < parts.length);
    if (Number.isInteger(initialPassageIndex) && initialPassageIndex >= 0 && initialPassageIndex < parts.length) randomIndex = initialPassageIndex;
    else if (restore && validSnapshots.length) randomIndex = validSnapshots[validSnapshots.length - 1].index;
    else randomIndex = selectPassageSelection(source, 'random').index;
    randomSaved = restore ? [...validSnapshots].reverse().find(entry => entry.index === randomIndex) : null;
    activeKey = randomSaved?.key || snapshotKey(item.id, mode, sectionValue, passageValue, `part:${randomIndex}`);
    activeSettings.passageIndex = randomIndex;
    if (!passageOnlySaved) passageChoicePage = Math.floor(randomIndex / PASSAGE_PAGE_SIZE);
  }
  let saved = restore ? (randomArticle ? randomSaved?.value || null : readSnapshot(storage, activeKey)) : null;
  if (saved && mode === 'word') {
    const words = Array.isArray(saved.retryWords) ? saved.retryWords : item.words;
    const index = saved.wordIndex ?? 0;
    if (!Array.isArray(words) || words.some(word => !Array.isArray(word) || word.length !== 4 || word.some(value => typeof value !== 'string') || !word[0]) || !Number.isInteger(index) || index < 0 || index >= words.length || typeof saved.input !== 'string' || !words[index][0].startsWith(saved.input) || saved.input === words[index][0]) saved = null;
  }
  // An error-review snapshot can be the only word list for a lesson. If that
  // snapshot is invalid, do not try to render an empty word list; restore the
  // article scope instead, retaining any separate article progress.
  if (mode === 'word' && !saved && !initialRetry?.length && !item.words?.length) {
    mode = 'article';
    return loadPractice(restore, null, initialArticle, initialPassageIndex);
  }
  const chosen = randomArticle ? {text:parts[randomIndex], index:randomIndex} : fromIndex !== null ? {text:source.slice(offsets[fromIndex].start), index:null} : !saved && initialArticle === null ? selectPassageSelection(source, item.custom ? passageValue : 'full') : null;
  articleText = typeable((typeof saved?.articleText === 'string' && saved.articleText) || initialArticle || chosen?.text || source).trimEnd();
  const position = randomArticle ? randomIndex : saved ? saved.articlePassageIndex : initialArticle !== null ? initialPassageIndex : chosen?.index;
  articlePassageIndex = Number.isInteger(position) && position >= 0 && position < parts.length && parts[position] === articleText.trim() ? position : null;
  articleOffsets = offsets;
  articleBase = fromIndex !== null ? offsets[fromIndex].start : articlePassageIndex !== null ? offsets[articlePassageIndex].start : 0;
  // A whole text without its sections, or a passage saved from an older text, is not placed in the book.
  readingTracked = mode === 'article' && !item.notebook && !(item.sections?.length && sectionValue === 'all') && source.startsWith(articleText, articleBase);
  const savedSet = value => new Set(Array.isArray(value) ? value.filter(word => typeof word === 'string') : []);
  if (saved) {
    const oldText = typeof saved.articleText === 'string' ? saved.articleText : '';
    const oldInput = typeof saved.input === 'string' ? saved.input : '';
    input = mode === 'article' && oldText && typeable(oldText) !== oldText ? typeable(oldInput).slice(0, articleText.length) : oldInput.slice(0, mode === 'word' ? oldInput.length : articleText.length);
    wordIndex = Number.isInteger(saved.wordIndex) && saved.wordIndex >= 0 ? saved.wordIndex : 0; errors = Number.isFinite(saved.errors) && saved.errors >= 0 ? saved.errors : 0; elapsedBase = Number.isFinite(saved.elapsed) && saved.elapsed >= 0 ? saved.elapsed : 0; wrongWords = savedSet(saved.wrongWords); creditedWords = savedSet(saved.creditedWords); creditedMistakes = savedSet(saved.creditedMistakes); retryWords = Array.isArray(saved.retryWords) ? saved.retryWords : null; paused = true;
  }
  // A notebook is regenerated as words and review scores change. Keep this
  // practice's order stable across edits and reloads.
  if (mode === 'word' && item.notebook && !retryWords) retryWords = item.words.map(word => [...word]);
  articleSentences = splitSentences(articleText); autoSeparators = separatorPositions(articleSentences);
  advanceArticleInput = createSentenceInput(articleSentences);
  articleFormulas = item.formulas || []; paperFigures = figureEvents(articleText, item.figures, section?.page ?? null); shownFigure = undefined; pinnedFigure = null; figurePosition = 0;
  sentenceStarts = []; let offset = 0; for (const sentence of articleSentences) { sentenceStarts.push(offset); offset += sentence.length; }
  sentenceTranslations = passageWithEdits(item);
  result.hidden = true; exercise.hidden = false;
  $('word-mode').classList.toggle('active', mode === 'word'); $('article-mode').classList.toggle('active', mode === 'article');
  $('word-mode').setAttribute('aria-pressed', String(mode === 'word')); $('article-mode').setAttribute('aria-pressed', String(mode === 'article'));
  render(); updateMetrics(); updatePause();
  if (mode === 'article' && translatable(item) && !sentenceTranslations) prepareTranslation();
  if (mode === 'word' && (translatable(item) || retryWords) && currentWords()[wordIndex]) translateWord(item, currentWords()[wordIndex][0], language.value);
  if (saved) setHint('hint.restored');
}
function restart() {
  if (!canResumeNotebook()) return;
  if (!finished && (input || wordIndex || errors || elapsedBase || started !== null) && typeof globalThis.confirm === 'function' && !globalThis.confirm(t('confirm.restart'))) return;
  const exists = hasSnapshot(storage, activeKey);
  if (exists === null || (exists && !clearSnapshot(storage, activeKey))) { setHint('hint.saveFail'); return; }
  const repeat = retryWords, sameArticle = mode === 'article' ? articleText : null, samePosition = articlePassageIndex;
  loadPractice(false, repeat, sameArticle, samePosition, activeSettings.wordScope);
}
function setMode(value) { if (value === mode && !finished) return; if (!mayLeave() || !saveProgress()) return; mode = value; if (mode === 'article') restoreArticleScope(lesson()); loadPractice(); }
function updatePause() { if (!$('pause')) return; $('pause').textContent = t(paused ? 'action.resume' : 'action.pause'); $('pause').disabled = finished; if ($('finish-now')) $('finish-now').disabled = finished; if ($('edit-translation')) $('edit-translation').disabled = finished || (mode === 'word' && !currentWords()?.[wordIndex]); if ($('typing')) $('typing').disabled = paused; if ($('focus-veil')) $('focus-veil').textContent = t(paused ? 'hint.paused' : 'focus.click'); }
function renderPassageChoices() {
  const select = $('passage-choice'), label = $('passage-choice-label'), navigation = $('passage-navigation');
  if (!select || !label || !navigation) return;
  const item = lesson(), visible = item.custom && mode === 'article' && activeSettings.passage === 'random';
  label.hidden = !visible; navigation.hidden = !visible;
  if (!visible) return;
  const section = item.sections && activeSettings.section !== 'all' ? item.sections[Number(activeSettings.section)] : null;
  const pieces = passageParts(typeable(section?.text || item.text));
  const snapshots = randomPassageSnapshots(storage, item.id, activeSettings.section), saved = new Set();
  const legacyKey = snapshotKey(item.id, 'article', activeSettings.section, 'random');
  for (const entry of snapshots) {
    const text = typeof entry.value?.articleText === 'string' ? typeable(entry.value.articleText).trim() : '';
    if (!text) continue;
    const index = Number.isInteger(entry.index) && pieces[entry.index] === text ? entry.index : entry.key === legacyKey ? pieces.indexOf(text) : -1;
    if (index >= 0) saved.add(index);
  }
  const savedIndices = passageOnlySaved ? [...saved].sort((a, b) => a - b) : null;
  const count = savedIndices ? savedIndices.length : pieces.length;
  const pages = Math.max(1, Math.ceil(count / PASSAGE_PAGE_SIZE));
  passageChoicePage = Math.max(0, Math.min(passageChoicePage, pages - 1));
  const start = passageChoicePage * PASSAGE_PAGE_SIZE, end = Math.min(start + PASSAGE_PAGE_SIZE, count);
  const pageIndices = savedIndices ? savedIndices.slice(start, end) : Array.from({length:end - start}, (_, index) => start + index);
  select.innerHTML = '';
  if (!pageIndices.includes(articlePassageIndex)) {
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = t('passage.choose'); select.append(placeholder);
  }
  for (const index of pageIndices) {
    const option = document.createElement('option'); option.value = String(index);
    option.textContent = t(saved.has(index) ? 'passage.savedPart' : 'passage.part', { n:index + 1 }); select.append(option);
  }
  select.value = pageIndices.includes(articlePassageIndex) ? String(articlePassageIndex) : '';
  $('passage-prev').disabled = passageChoicePage === 0; $('passage-next').disabled = passageChoicePage === pages - 1;
  $('passage-page').textContent = `${count ? start + 1 : 0}–${end} / ${count}`;
  $('passage-number').max = String(pieces.length); $('passage-number').value = String((articlePassageIndex ?? 0) + 1);
}
function render() {
  const item = lesson();
  if ($('delete-lesson')) $('delete-lesson').hidden = !item.custom;
  if ($('edit-lesson')) $('edit-lesson').hidden = !!item.notebook;
  $('word-mode').disabled = !item.words?.length && !(mode === 'word' && retryWords?.length);
  renderPicker(); renderVocabulary();
  $('passage-label').hidden = !item.custom || mode !== 'article';
  renderPassageChoices();
  $('section-label').hidden = !item.sections?.length || mode !== 'article';
  const source = $('source-info'); const validSource = /^https?:\/\/[^\s]+$/.test(item.sourceUrl || ''); source.hidden = !validSource && !item.edited; source.textContent = '';
  if (item.edited) source.append(document.createTextNode(t('lessonEdit.edited')));
  if (validSource) {
    const link = document.createElement('a'); link.href = item.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = t('source.link');
    const attribution = (item.category === 'arxiv' || item.edited) ? [item.edited ? item.source : '', (item.authors || []).filter(Boolean).join(', '), item.license || (item.category === 'arxiv' ? t('source.license') : '')].filter(Boolean).join(' · ') : '';
    source.append(...(item.edited ? [document.createTextNode(' · ')] : []), link, ...(attribution ? [document.createTextNode(` · ${attribution}`)] : []));
  } else if (item.edited) {
    const attribution = [item.source, (item.authors || []).filter(Boolean).join(', '), item.license || ''].filter(Boolean).join(' · ');
    if (attribution) source.append(document.createTextNode(` · ${attribution}`));
  }
  $('progress').textContent = mode === 'word' ? t('progress.word', { i:wordIndex + 1, n:currentWords().length }) : '';
  setHint(baseHint());
  if (mode === 'word') {
    const word = currentWords()[wordIndex];
    exercise.innerHTML = `<div class="typing-stage word-stage" id="typing-stage"><h2 class="word-text" id="word-text">${escapeHtml(word[0])}</h2><div class="focus-veil" aria-hidden="true"><span id="focus-veil">${escapeHtml(t(paused ? 'hint.paused' : 'focus.click'))}</span></div><input class="typing-overlay word-input" id="typing" aria-label="${escapeHtml(t('typing.word'))}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="${escapeHtml(input)}"></div><p class="translation">${escapeHtml(word[languageIndex()] || t('word.noTranslation'))}</p><button class="btn-quiet translation-edit" id="edit-translation" type="button">${escapeHtml(t('translation.edit'))}</button><button class="btn-quiet translation-edit" id="retry-current-translation" type="button" hidden>${escapeHtml(t('picker.retryTranslation'))}</button><div class="error-note" aria-live="polite"></div>`;
    $('typing').addEventListener('input', onWord); paintWord();
    $('retry-current-translation')?.addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      try { await translateWord(item, word[0], language.value); } finally { button.disabled = false; }
    });
    updateCurrentWordTranslationStatus(item, word[0], language.value);
  } else {
    const translation = item.translations?.[language.value] || t('article.noTranslation');
    exercise.innerHTML = `<div class="typing-stage article-stage" id="typing-stage"><div class="article-text reader" id="article-text"></div><div class="focus-veil" aria-hidden="true"><span id="focus-veil">${escapeHtml(t(paused ? 'hint.paused' : 'focus.click'))}</span></div><textarea id="typing" class="typing-overlay caret-input" aria-label="${escapeHtml(t('typing.article'))}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea></div><div id="article-translation" class="article-translation">${escapeHtml(translation)}</div><button class="btn-quiet translation-edit" id="edit-translation" type="button">${escapeHtml(t('translation.edit'))}</button><aside class="figure-panel" id="figure-panel" aria-label="${escapeHtml(t('figure.panel'))}" hidden></aside>`;
    shownFigure = undefined;
    $('figure-panel')?.addEventListener?.('click', onFigurePanel);
    $('typing').value = input;
    if (item.custom && !sentenceTranslations) $('article-translation').textContent = '';
    $('typing').addEventListener('input', onArticle); paintArticle();
  }
  for (const type of ['paste', 'drop']) $('typing').addEventListener(type, blockPracticePaste);
  $('typing').addEventListener('beforeinput', event => {
    if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') blockPracticePaste(event);
  });
  $('typing').addEventListener('blur', () => { if (!finished) holdClock(); });
  $('typing').addEventListener('focus', event => { const field = event.target; field.setSelectionRange?.(field.value.length, field.value.length); keepCaretInView(); });
  // In article mode the input is a small field at the caret, so clicking anywhere on the text focuses it.
  $('typing-stage')?.addEventListener('click', () => { if (finished) return; if (paused) resumePractice(); else $('typing').focus({ preventScroll:true }); });
}
async function prepareTranslation() {
  const run = ++translationRun, currentLanguage = language.value;
  const sentences = articleSentences.map(sentence => sentence.trim());
  const usable = sentence => translationService.get(sentence, currentLanguage);
  const fill = () => { sentenceTranslations = sentences.map(sentence => usable(sentence)); };
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
    const values = await translationService.translate(batch, currentLanguage);
    if (values.some(value => !value)) failed = true;
    if (run !== translationRun || mode !== 'article' || finished) return;
    fill(); paintArticle();
  }
  if (!sentenceTranslations.some(Boolean)) { sentenceTranslations = null; if (!lesson().translations?.[language.value]) $('article-translation').textContent = t('article.noTranslation'); paintArticle(); }
  setHint(failed ? 'hint.translateFail' : baseHint());
}
function blockPracticePaste(event) {
  event.preventDefault();
  setHint('hint.noPaste');
}
// The clock runs only while typing: it holds at the last keystroke after a pause or when focus leaves the text,
// and the next key starts it again.
let lastKeyAt = 0;
function startTimer() {
  const now = performance.now();
  if (started !== null && now - lastKeyAt > IDLE_MS) holdClock(lastKeyAt);
  lastKeyAt = now;
  if (started !== null) return;
  started = lastKeyAt;
  notePublicStart();
  timer = setInterval(() => { if (performance.now() - lastKeyAt > IDLE_MS) holdClock(lastKeyAt); else updateMetrics(); }, 1000);
}
function holdClock(at = performance.now()) {
  if (started === null) return;
  elapsedBase += Math.max(0, activeTypingEnd(lastKeyAt, at, IDLE_MS) - started); started = null; clearInterval(timer); timer = null;
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
    progress = articleText.length ? Math.round(Math.min(input.length, articleText.length) / articleText.length * 100) : 0;
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
  renderReaderHeading();
}
function onWord(e) {
  if (finished) return;
  progressEdited = true;
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
function sentenceHtml(index, current) {
  const sentence = articleSentences[index], body = sentence.trimEnd(), gap = sentenceStarts[index] + body.length;
  // The space after a sentence is typed too: the caret waits on it, and a skipped one shows as a mistake.
  const waiting = input.length === gap, skipped = input.length > gap && !/\s/.test(input[gap]);
  const space = sentence.length === body.length ? '' : waiting || skipped ? `<span class="sep${skipped ? ' incorrect' : ''}${waiting ? ' cursor' : ''}"> </span>` : ' ';
  if (index > current) return `<span class="s up">${richText(body, articleFormulas)}</span>${space}`;
  // Typed sentences stay plain text except for mistakes; only the current sentence is drawn per character.
  let html = '', position = sentenceStarts[index];
  for (const char of body) {
    const typed = position < input.length, wrong = typed && input.slice(position, position + char.length) !== char, here = position === input.length;
    const shown = isFormula(char) ? formulaHtml(articleFormulas[char.charCodeAt(0) - 0xE000]) : escapeHtml(char);
    html += index === current || wrong ? `<span class="${typed ? (wrong && !isFormula(char) ? 'incorrect' : 'correct') : ''}${here ? ' cursor' : ''}">${shown}</span>` : shown;
    position += char.length;
  }
  return `<span class="s ${index === current ? 'current-sentence' : 'done-sentence'}">${html}</span>${space}`;
}
// Show the current sentence and its translation as the reader advances.
function paintArticle() {
  const piece = sentenceAt(articleSentences, input.length);
  const translated = sentenceTranslations?.[piece.index];
  $('article-text').innerHTML = `<section class="para current"><p class="en">${sentenceHtml(piece.index, piece.index)}</p>${translated ? `<p class="tr"><span class="now">${richText(translated, articleFormulas)}</span></p>` : ''}</section>`;
  paintFigure(piece.start + piece.text.length);
  const whole = $('article-translation');
  whole.hidden = Boolean(sentenceTranslations?.some(Boolean)) || !whole.textContent;
  $('progress').textContent = t('progress.sentence', { i:piece.index + 1, n:articleSentences.length });
  placeCaret();
}
// A paper shows the figure or table that the text being typed refers to, or the last one placed before it.
// A figure picked from the strip stays up until the text being typed reaches another figure.
function paintFigure(position, force = false) {
  const panel = $('figure-panel');
  if (!panel) return;
  figurePosition = position;
  const automatic = figureAt(paperFigures, position);
  if (pinnedFigure && pinnedFigure.base !== automatic) pinnedFigure = null;
  const index = pinnedFigure ? pinnedFigure.index : automatic;
  if (!force && index === shownFigure) return;
  shownFigure = index;
  const item = lesson(), listed = figuresInText(paperFigures), figure = index === null ? null : item.figures?.[index];
  panel.hidden = !listed.length;
  if (!listed.length) return;
  const strip = listed.length > 1 || !figure ? `<div class="figure-strip" aria-label="${escapeHtml(t('figure.strip'))}">${listed.map(i => {
    const entry = item.figures[i], thumb = safeImage(entry.images?.[0]);
    return `<button type="button" class="figure-chip${i === index ? ' current' : ''}" data-figure="${i}" aria-pressed="${i === index}">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" referrerpolicy="no-referrer">` : ''}<span>${escapeHtml(figureTitle(entry))}</span></button>`;
  }).join('')}</div>` : '';
  const content = figure ? `<div class="figure-content" title="${escapeHtml(t('figure.enlarge'))}">${figureHtml(figure, articleFormulas)}</div>` : '';
  panel.innerHTML = `<details${figureOpen ? ' open' : ''}><summary>${escapeHtml(figure ? figureTitle(figure) : t('figure.strip'))}</summary><div class="figure-body">${strip}${content}</div></details>`;
  panel.querySelector('details').addEventListener('toggle', event => { figureOpen = event.target.open; });
  panel.querySelector('.figure-chip.current')?.scrollIntoView?.({ block:'nearest', inline:'nearest' });
  if (figure?.kind === 'page') paintPage(item, figure.page, index);
}
const figureTitle = figure => figure.kind === 'page' ? t('figure.page', { n:figure.page }) : figure.label || t(figure.kind === 'table' ? 'figure.table' : 'figure.figure');
function onFigurePanel(event) {
  const chip = event.target.closest?.('.figure-chip');
  if (chip) {
    pinnedFigure = { index:Number(chip.dataset.figure), base:figureAt(paperFigures, figurePosition) };
    paintFigure(figurePosition, true);
    if (!finished && !paused) $('typing')?.focus({ preventScroll:true });
    return;
  }
  if (event.target.closest?.('.figure-content')) { event.preventDefault(); openFigureDialog(); }
}
// The figure opens large over the page; Esc or the close button returns to typing.
function openFigureDialog() {
  const dialog = $('figure-dialog'), content = document.querySelector('#figure-panel .figure-content');
  if (!dialog || !content || dialog.open) return;
  const figure = lesson().figures?.[shownFigure];
  $('figure-dialog-title').textContent = figure ? figureTitle(figure) : '';
  $('figure-dialog-body').innerHTML = content.innerHTML.replace(/ id="page-status"/g, '');
  $('figure-dialog-body').querySelectorAll('a').forEach(link => link.replaceWith(...link.childNodes));
  const original = content.querySelector('img')?.getAttribute('src') || '';
  $('figure-original').hidden = !original;
  if (original) $('figure-original').href = original; else $('figure-original').removeAttribute('href');
  dialog.showModal();
}
// A PDF page is drawn from the file kept in this browser; a newer figure may be shown before it is ready.
function paintPage(item, page, index) {
  const status = $('page-status');
  if (status) status.textContent = t('figure.pageLoading');
  pdfPages.page(item.id, page).then(url => {
    if (shownFigure !== index || lesson() !== item) return;
    const image = document.querySelector('#figure-panel .pdf-page'), link = document.querySelector('#figure-panel .pdf-page-link');
    if (!url) { $('page-status').textContent = t('figure.pageMissing'); return; }
    image.src = url; image.alt = t('figure.page', { n:page }); link.href = url; $('page-status').textContent = '';
  }, () => { if (shownFigure === index && $('page-status')) $('page-status').textContent = t('figure.pageFail'); });
}
// Keep the hidden input at the caret so the browser and phone keyboards follow the text being typed.
function placeCaret() {
  const field = $('typing'), caret = $('article-text')?.querySelector?.('.cursor');
  if (!field?.style || !caret || typeof caret.offsetTop !== 'number') return;
  field.style.left = `${caret.offsetLeft}px`; field.style.top = `${caret.offsetTop}px`;
  if (globalThis.document?.activeElement === field) keepCaretInView();
}
function keepCaretInView() {
  const box = $('article-text')?.querySelector?.('.cursor')?.getBoundingClientRect?.();
  const viewport = globalThis.visualViewport || { offsetTop:0, height:globalThis.innerHeight };
  const headerHeight = document.querySelector('.workspace-head')?.getBoundingClientRect().height || 0;
  const offset = caretScrollOffset(box, viewport, headerHeight);
  if (!offset) return;
  const smooth = !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  globalThis.scrollBy?.({ top:offset, behavior:smooth ? 'smooth' : 'auto' });
}
function onArticle(e) {
  if (finished) return;
  progressEdited = true;
  const previousInput = input;
  input = advanceArticleInput(previousInput, e.target.value.slice(0, articleText.length)); e.target.value = input;
  const changedFrom = input.startsWith(previousInput) ? previousInput.length : 0;
  for (let i = changedFrom; i < input.length; i++) if (input[i] !== previousInput[i] && input[i] !== articleText[i]) { const word = wrongWordAt(articleText, i); if (word) wrongWords.add(word); }
  if (input.length) startTimer();
  paintArticle(); updateMetrics();
  if (input.length >= articleText.length) completeArticle(); else scheduleProgress();
}
// An early finish scores only what was typed and keeps the place, so practice can continue from it.
function finish(early = false) {
  const notebookStored = notePractice(mode === 'word' ? currentWords().slice(0, early ? wordIndex : undefined).map(word => word[0]) : practicedArticleWords(articleText, early ? input.length : articleText.length));
  const progressStored = early ? saveProgress() : clearSnapshot(storage, activeKey);
  unfinishedSavePending = early && !progressStored;
  finished = true; const time = elapsed(); elapsedBase = time; started = null; clearInterval(timer); clearTimeout(saveTimer); timer = null; saveTimer = null; updateMetrics(); updatePause(); exercise.hidden = true; result.hidden = false;
  const wordChars = early ? currentWords().slice(0, wordIndex).reduce((sum, word) => sum + word[0].length, 0) + input.length : currentWords().reduce((sum, word) => sum + word[0].length, 0);
  const wordWpm = time > 0 ? Math.round(wordChars / 5 / (time / 60000) * 10) / 10 : 0;
  const resultStats = mode === 'article' ? articleResult(early ? articleText.slice(0, input.length) : articleText, input, time, autoSeparators) : null;
  const reached = mode === 'article' ? Math.round(input.length / articleText.length * 100) : Math.round(wordIndex / currentWords().length * 100);
  const record = { lessonId:lesson().id, title:lesson().title, mode, passage:passageId(mode === 'article' ? articleText : currentWords().map(w => w[0]).join(' ')), wpm:resultStats?.wpm ?? wordWpm, accuracy:resultStats?.accuracy ?? null, errors:mode === 'word' ? errors : resultStats.errors, elapsed:time, date:new Date().toISOString(), ...(early ? { partial:true } : {}) };
  if (!early) { notePublicFinish(record); if (!noteCurrentReading(true)) reportStorageError(); }
  const previous = comparison(readHistory(storage), record);
  const best = Math.max(bestResult(storage, record) ?? 0, record.wpm);
  const hasProgress = mode === 'article' ? input.length > 0 : wordIndex > 0 || input.length > 0 || errors > 0;
  const bestStored = !hasProgress || saveBest(storage, record);
  const historyStored = !hasProgress || saveResult(storage, record);
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
    const compare = [
      ...(early ? [] : multi ? [t('result.session', { n:texts })] : [previous ? t('result.prev', { wpm:previous.previous, delta:`${previous.delta >= 0 ? '+' : ''}${previous.delta}` }) : t('result.noPrev'), t('result.best', { wpm:best })]),
      ...(!bestStored || !historyStored ? [t('result.storageFail')] : []),
      ...(!progressStored ? [t(early ? 'result.progressSaveFail' : 'result.progressClearFail')] : []),
      ...(!notebookStored ? [t('result.notebookStorageFail')] : []),
    ].join(' · ');
    const nextLabel = mode === 'word' ? t('result.toArticle') : t({ lesson:'result.nextLesson', book:'result.bookDone' }[articleContinuation().kind] || 'result.nextPassage');
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
    const tokens = practicedText.split(/([A-Za-z]+(?:['’][A-Za-z]+)*)/).map((part, index) => index % 2 ? `<button type="button" class="pick" tabindex="${index === 1 ? 0 : -1}" aria-pressed="false" data-pick="${escapeHtml(part.toLowerCase().replace('’', "'"))}">${escapeHtml(part)}</button>` : richText(part, articleFormulas)).join('');
    const review = mode === 'article' ? `<section class="review-words" style="--i:4"><div class="review-head"><h2>${escapeHtml(t('result.pickTitle'))}</h2><span class="count" id="pick-count"></span></div><p>${escapeHtml(t('result.pickHelp'))} ${escapeHtml(t('result.keyboardHelp'))}</p>${missed.size ? `<div class="mistyped"><span>${escapeHtml(t('result.mistyped'))}</span>${[...missed].map(pick).join('')}</div>` : ''}<p class="review-text" id="review-text">${tokens}</p><button type="button" class="btn primary float-add" id="save-selected-words" hidden>${escapeHtml(t('result.pickAdd'))}</button><p id="selection-message" class="message" role="status"></p></section>` : '';
    result.innerHTML = `<div class="result-head" style="--i:0"><h2 class="result-title">${escapeHtml(t(early ? 'result.stopped' : 'result.title'))}</h2><span class="result-goal${met && !early ? ' met' : ''}">${escapeHtml(goal)}</span></div><div class="stats" style="--i:1">${stats.map(([label, value], index) => `<div><strong${index === 0 ? ' class="headline" id="result-wpm"' : ''}>${value}</strong><span>${escapeHtml(label)}</span></div>`).join('')}</div><p class="result-comparison" style="--i:2">${escapeHtml(compare)}</p><div class="result-actions" style="--i:3">${buttons}</div>${review}`;
    $('progress').textContent = t(early ? 'result.stopped' : 'progress.done');
    const forward = () => { if (!saveProgress()) return; if (mode === 'word') setMode('article'); else continueArticle(); };
    resultKeys = early ? { next:resumeEarly, again:restart } : { next:forward, again:restart };
    $('next-action')?.addEventListener('click', forward);
    $('resume-early')?.addEventListener('click', resumeEarly);
    $('replay-word')?.addEventListener('click', restart);
    $('again-article')?.addEventListener('click', restart);
    $('retry-errors')?.addEventListener('click', () => {
      if (!canResumeNotebook() || !saveProgress()) return;
      const chosen = [...missed].map(word => lesson().words.find(entry => entry[0] === word) || [word, '', '', '']);
      const scope = `retry:${passageId(JSON.stringify(chosen.map(entry => entry[0])))}`;
      mode = 'word'; loadPractice(true, chosen, null, null, scope);
      if (paused) resumePractice(); else $('typing')?.focus();
    });
    $('save-selected-words')?.addEventListener('click', () => {
      const selection = globalThis.getSelection?.(), reviewText = $('review-text'), message = $('selection-message');
      if (!selection || !reviewText?.contains(selection.anchorNode) || !reviewText.contains(selection.focusNode)) { message.textContent = t('result.pickNone'); return; }
      const words = selectedArticleWords(articleText, selection.toString());
      if (!words.length) { message.textContent = t('result.pickNone'); return; }
      const item = lesson(), additions = words.filter(word => !notebook.some(entry => entry.word === word));
      if (!additions.length) { message.textContent = t('result.pickExists'); return; }
      const newLessonWords = additions.filter(word => !item.words.some(entry => entry[0].toLowerCase() === word));
      if (newLessonWords.length && !prepareWordListChange()) return;
      newLessonWords.forEach(word => item.words.push([word, '', '', '']));
      $('word-mode').disabled = false;
      const lessonSaved = persistWords(item);
      const notebookSaved = noteWords({ add:additions });
      if (notebook.length && hintKey?.[0] === 'notebook.emptyResume') setHint(null);
      message.textContent = lessonSaved && notebookSaved ? t('result.pickAdded', { n:additions.length }) : t('result.pickStorage');
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
  // The practice text is keyboard-normalized; compare and advance against the
  // same representation or typographic punctuation makes a full text look partial.
  const source = typeable(section?.text || item.text);
  const parts = passageParts(source);
  // A passage read on to the end of its section has finished the section; a
  // single paragraph continues with the next one until the section ends.
  const lastPart = articlePassageIndex === parts.length - 1 || parts.indexOf(articleText.trim()) === parts.length - 1;
  if (activeSettings?.passage !== 'from' && articleText.trim() !== source.trim() && (!lastPart || item.notebook)) return { kind:'passage', run:() => { const next = nextPassageSelection(source, articleText, articlePassageIndex); $('passage-mode').value = 'random'; loadPractice(true, null, next.text, next.index); } };
  if (section && Number(sectionValue) + 1 < item.sections.length) return { kind:'passage', run:() => { $('section-mode').value = String(Number(sectionValue) + 1); $('passage-mode').value = 'full'; pickerPage = 0; loadPractice(); } };
  if (!item.notebook) return { kind:'book', run:() => { lessonPreview?.open(Number(lessonSelect.value), false); } };
  return { kind:'lesson', run:() => { lessonSelect.value = String((Number(lessonSelect.value) + 1) % lessons.length); if (item.notebook && !notebook.length) syncNotebookLesson(); updateSections(); pickerPage = 0; loadPractice(); } };
}
// Finish this passage before offering another one.
function completeArticle() {
  finish();
}
function notePractice(words) {
  if (!notebook.length) return true;
  const practiced = new Set(words.map(word => word.toLowerCase()).filter(word => !creditedWords.has(word)));
  const missed = new Set([...wrongWords].map(word => word.toLowerCase()).filter(word => !creditedMistakes.has(word)));
  if (!notebook.some(entry => practiced.has(entry.word) || missed.has(entry.word))) return true;
  const updated = recordPractice(notebook, practiced, missed, Date.now(), creditedMistakes);
  if (saveNotebook(storage, updated)) {
    notebook = updated;
    for (const entry of notebook) {
      if (practiced.has(entry.word)) creditedWords.add(entry.word);
      if (missed.has(entry.word)) creditedMistakes.add(entry.word);
    }
    return true;
  }
  return false;
}
function announce(text) {
  const toast = $('session-toast'); if (!toast) return;
  toast.textContent = text; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}
function finishEarly() {
  if (finished || !$('typing')) return;
  finish(true);
}
function canResumeNotebook() {
  if (lesson()?.notebook && !notebook.length) { setHint('notebook.emptyResume'); return false; }
  return true;
}
function resumeEarly() {
  if (!canResumeNotebook()) return;
  finished = false; paintResult = null; resultKeys = null; result.hidden = true; exercise.hidden = false;
  paused = false;
  updatePause(); setHint(baseHint());
  if (mode === 'article') paintArticle(); else paintWord();
  $('typing')?.focus();
}
function continueArticle() {
  const next = articleContinuation();
  next.run();
  if (next.kind === 'book') return;
  if (paused) resumePractice(); else $('typing')?.focus();
}
function markPicked(popped = []) {
  const visible = new Set(articleWords(articleText));
  const picked = new Set(notebook.map(entry => entry.word).filter(word => visible.has(word)));
  for (const node of result.querySelectorAll?.('[data-pick]') || []) {
    node.classList.toggle('picked', picked.has(node.dataset.pick));
    node.setAttribute?.('aria-pressed', String(picked.has(node.dataset.pick)));
    if (popped.includes(node.dataset.pick)) { node.classList.remove('pop'); void node.offsetWidth; node.classList.add('pop'); }
  }
  const count = $('pick-count');
  if (count) { count.textContent = String(picked.size); if (popped.length) { count.classList.remove('bump'); void count.offsetWidth; count.classList.add('bump'); } }
  renderPicker(); renderVocabulary();
}
function togglePick(word) {
  const item = lesson(), message = $('selection-message'), had = notebook.some(entry => entry.word === word);
  if (had && typeof globalThis.confirm === 'function' && !globalThis.confirm(t('notebook.removeConfirm', {word}))) return;
  const addLessonWord = !had && !item.words.some(entry => entry[0].toLowerCase() === word);
  if (addLessonWord && !prepareWordListChange()) return;
  if (addLessonWord) item.words.push([word, '', '', '']);
  const ok = persistWords(item);
  const notebookSaved = noteWords(had ? { remove:[word] } : { add:[word] });
  if (notebook.length && hintKey?.[0] === 'notebook.emptyResume') setHint(null);
  $('word-mode').disabled = item.notebook ? !notebook.length : !item.words.length;
  if (message) message.textContent = !ok || !notebookSaved ? t('result.pickStorage') : had ? t('result.pickRemoved', { word }) : t('result.pickAdded', { n:1 });
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
result.addEventListener('keydown', event => {
  if (!event.target.matches?.('#review-text .pick')) return;
  const buttons = [...result.querySelectorAll('#review-text .pick')];
  const next = nextWordFocus(buttons.indexOf(event.target), buttons.length, event.key);
  if (next === null) return;
  event.preventDefault();
  buttons.forEach((button, i) => { button.tabIndex = i === next ? 0 : -1; });
  buttons[next].focus();
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
let saveTranslation = null;
function openTranslationEditor(original, value, save) {
  const dialog = $('translation-dialog');
  if (!dialog?.showModal) return;
  saveTranslation = save;
  $('translation-original').textContent = original;
  $('translation-input').value = value;
  $('translation-error').textContent = '';
  holdClock();
  dialog.showModal(); $('translation-input').focus();
}
$('translation-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const value = $('translation-input').value.trim();
  if (!value) { $('translation-error').textContent = t('translation.empty'); $('translation-input').focus(); return; }
  $('translation-dialog').close();
  saveTranslation?.(value); saveTranslation = null;
});
$('figure-close')?.addEventListener('click', () => $('figure-dialog').close());
// A click on the dark area around the figure closes it too.
$('figure-dialog')?.addEventListener('click', event => { if (event.target === $('figure-dialog')) $('figure-dialog').close(); });
$('figure-dialog')?.addEventListener('close', () => { if (currentView === 'practice' && !finished && !paused) $('typing')?.focus({ preventScroll:true }); });
$('translation-cancel')?.addEventListener('click', () => { $('translation-dialog').close(); saveTranslation = null; });
exercise.addEventListener('click', event => {
  if (event.target.id !== 'edit-translation' || finished) return;
  if (mode === 'article') {
    const position = sentenceAt(articleSentences, input.length).index, sentence = articleSentences[position]?.trim();
    if (!sentence) return;
    openTranslationEditor(sentence, sentenceTranslations?.[position] || translationService.get(sentence, language.value) || '', value => {
      const ok = translationService.set(sentence, language.value, value);
      sentenceTranslations = articleSentences.map((s, i) => i === position ? value : (sentenceTranslations?.[i] || translationService.get(s.trim(), language.value)));
      paintArticle(); setHint(ok ? 'translation.saved' : 'result.pickStorage');
    });
    return;
  }
  const entry = currentWords()?.[wordIndex];
  if (entry) editWordTranslation(entry[0], entry[languageIndex()] || '');
});
$('restart').addEventListener('click', restart);
$('menu-restart')?.addEventListener('click', () => { closeMenu(); restart(); });
$('finish-now')?.addEventListener('click', finishEarly);
function resumePractice() {
  paused = false;
  setHint(baseHint()); updatePause(); $('typing')?.focus();
}
$('pause')?.addEventListener('click', () => {
  if (finished) return;
  if (!paused) { elapsedBase = elapsed(); started = null; clearInterval(timer); timer = null; paused = true; if (saveProgress()) setHint('hint.paused'); }
  else { resumePractice(); return; }
  updatePause();
});
lessonSelect.addEventListener('change', () => {
  if (!mayLeave()) { lessonSelect.value = String(lessons.findIndex(item => item.id === activeSettings.id)); return; }
  if (!saveProgress()) { lessonSelect.value = String(lessons.findIndex(item => item.id === activeSettings.id)); return; }
  if (activeSettings?.id === 'notebook' && !notebook.length && !lesson().notebook) syncNotebookLesson();
  updateSections(); if (lesson().custom) mode = 'article'; if (mode === 'article') restoreArticleScope(lesson()); pickerPage = 0; loadPractice();
});
language.addEventListener('change', () => {
  try { storage?.setItem('lingtype-language', language.value); } catch { /* the choice lasts for this visit */ }
  applyStatic(globalThis.document, language.value);
  const section = $('section-mode').value; updateSections(); $('section-mode').value = section;
  syncNotebookLesson(); renderNotebook(); renderHistory(); renderMyShelf(); updatePause(); updateMetrics();
  if (lessonPreview?.isOpen()) lessonPreview.render();
  if (currentView === 'public' && $('public-detail')?.hidden) loadPublicBooks();
  if (finished) { paintResult?.(); if (hintKey) setHint(...hintKey); return; }
  ++translationRun; sentenceTranslations = passageWithEdits(lesson());
  render(); updatePause(); if (paused) setHint('hint.paused');
  if (mode === 'article' && translatable(lesson()) && !sentenceTranslations) prepareTranslation();
  else if (mode === 'word' && (translatable(lesson()) || retryWords)) translateWord(lesson(), currentWords()[wordIndex][0], language.value);
});
$('passage-mode').addEventListener('change', () => { if (!mayLeave() || !saveProgress()) { $('passage-mode').value = activeSettings.passage; return; } loadPractice(); });
function selectPassageIndex(index) {
  const section = lesson().sections && activeSettings.section !== 'all' ? lesson().sections[Number(activeSettings.section)] : null;
  const count = passageParts(typeable(section?.text || lesson().text)).length;
  if (!Number.isInteger(index) || index < 0 || index >= count || !mayLeave() || !saveProgress()) { renderPassageChoices(); return; }
  loadPractice(true, null, null, index);
}
$('passage-choice')?.addEventListener('change', event => { if (event.target.value !== '') selectPassageIndex(Number(event.target.value)); });
$('passage-prev')?.addEventListener('click', () => { passageChoicePage--; renderPassageChoices(); });
$('passage-next')?.addEventListener('click', () => { passageChoicePage++; renderPassageChoices(); });
$('passage-saved-only')?.addEventListener('change', event => { passageOnlySaved = event.target.checked; passageChoicePage = 0; renderPassageChoices(); });
$('passage-go')?.addEventListener('click', () => selectPassageIndex(Number($('passage-number').value) - 1));
$('section-mode').addEventListener('change', () => { if (!mayLeave() || !saveProgress()) { $('section-mode').value = activeSettings.section; return; } pickerPage = 0; loadPractice(); });
globalThis.addEventListener?.('pagehide', saveProgress);
// On mobile a backgrounded tab can be suspended or killed before pagehide or
// the debounced save runs. Persist immediately and stop counting background time.
globalThis.document?.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  holdClock();
  saveProgress();
});
globalThis.addEventListener?.('resize', () => { if (mode === 'article' && !finished) placeCaret(); });
globalThis.visualViewport?.addEventListener('resize', () => {
  if (mode === 'article' && !finished && document.activeElement === $('typing')) keepCaretInView();
});
// Any printable key brings focus back to the typing card, unless another text field is in use.
globalThis.document?.addEventListener?.('keydown', event => {
  if ($('translation-dialog')?.open || $('figure-dialog')?.open || $('lesson-edit-dialog')?.open) return;
  if ($('lesson-chooser') && !$('lesson-chooser').hidden) return;
  if (event.key === 'Escape' && currentView === 'practice' && !finished && $('typing')) { event.preventDefault(); finishEarly(); return; }
  if (finished && currentView === 'practice' && event.key === 'Enter' && resultKeys && !globalThis.document.activeElement?.matches?.('input,textarea,select,button,summary,a,[contenteditable]')) {
    event.preventDefault(); (event.shiftKey ? resultKeys.again : resultKeys.next)(); return;
  }
  const field = $('typing');
  if (!field || finished || currentView !== 'practice' || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
  const active = globalThis.document.activeElement;
  if (active === field || active?.matches?.('input,textarea,select,[contenteditable]')) return;
  // Space is the native activation key for focused buttons and disclosures.
  // Do not redirect it into the exercise while a keyboard user operates them.
  if (event.key === ' ' && active?.matches?.('button,summary,a,[role="button"],[role="link"]')) return;
  closeMenu();
  if (paused) resumePractice(); else field.focus();
});
function renderHistory() {
  const container = $('history-list'); if (!container) return;
  const items = readHistory(storage);
  const locale = dateLocale[language.value];
  container.innerHTML = items.length ? items.map(item => `<tr><td>${escapeHtml(item.title)}</td><td class="meta">${escapeHtml(t(item.mode === 'word' ? 'mode.word' : 'mode.article'))}</td><td class="meta">${escapeHtml(new Date(item.date).toLocaleDateString(locale))}</td><td class="num">${Number(item.wpm) || 0}</td><td class="num">${item.mode === 'article' ? `${Number(item.accuracy) || 0}%` : escapeHtml(t('history.errors', { n:Number(item.errors) || 0 }))}</td><td class="num">${formatTime(Number(item.elapsed) || 0)}</td></tr>`).join('') : `<tr class="history-empty"><td colspan="6"><strong>${escapeHtml(t('history.empty'))}</strong><span>${escapeHtml(t('history.emptyNote'))}</span><button id="history-start" class="btn primary" type="button">${escapeHtml(t('history.start'))}</button></td></tr>`;
  $('history-start')?.addEventListener('click', () => { showView('practice'); currentView = 'practice'; if (globalThis.location && globalThis.history) globalThis.history.replaceState(null, '', '#practice'); });
}
function editWordTranslation(word, previous) {
  openTranslationEditor(word, previous, text => {
  const index = languageIndex();
  let ok = true;
  for (const item of lessons) {
    if (item.notebook) continue;
    const entry = item.words?.find(row => row[0].toLowerCase() === word.toLowerCase());
    if (entry) { entry[index] = text; ok = persistWords(item) && ok; }
  }
  if (retryWords) for (const entry of retryWords) if (entry[0].toLowerCase() === word.toLowerCase()) entry[index] = text;
  notebook = updateWordTranslation(notebook, word.toLowerCase(), language.value, text);
  ok = saveNotebook(storage, notebook) && ok;
  syncNotebookLesson(); renderNotebook(); renderVocabulary();
  if (!finished && mode === 'word' && currentWords()?.[wordIndex]?.[0].toLowerCase() === word.toLowerCase()) {
    const translation = exercise.querySelector('.translation'); if (translation) translation.textContent = text;
    failedWordTranslations.delete(wordTranslationKey(lesson(), word, language.value));
    updateCurrentWordTranslationStatus(lesson(), word, language.value);
  }
  if (retryWords) scheduleProgress();
  if (currentView === 'notebook' && $('notebook-message')) $('notebook-message').textContent = t(ok ? 'translation.saved' : 'result.pickStorage');
  else setHint(ok ? 'translation.saved' : 'result.pickStorage');
  });
}
function renderNotebook() {
  const list = $('notebook-list'); if (!list) return;
  const item = notebook.length ? lessons.find(entry => entry.notebook) : null;
  if ($('notebook-count')) $('notebook-count').textContent = notebook.length ? String(notebook.length) : '';
  if ($('notebook-words')) $('notebook-words').disabled = !notebook.length;
  if ($('notebook-sentences')) $('notebook-sentences').disabled = !notebook.some(entry => entry.sentences.length);
  if ($('notebook-due')) { const count = dueWords(notebook).length; $('notebook-due').disabled = !count; $('notebook-due').textContent = `${t('notebook.reviewDue')} (${count})`; }
  if ($('notebook-review-note')) {
    const next = nextReviewTime(notebook);
    const date = next ? new Intl.DateTimeFormat(dateLocale[language.value], {dateStyle:'medium', timeStyle:'short'}).format(new Date(next)) : '';
    $('notebook-review-note').textContent = [t('notebook.reviewHelp'), ...(date ? [t('notebook.reviewNext', {date})] : [])].join(' ');
  }
  const mark = (sentence, word) => escapeHtml(sentence).replace(new RegExp(`(^|[^A-Za-z&#;])(${escapeHtml(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![A-Za-z])`, 'gi'), '$1<mark>$2</mark>');
  list.innerHTML = item ? item.words.map(([word]) => {
    const entry = notebook.find(note => note.word === word), example = entry.sentences.at(-1);
    const meta = [example?.source ? t('notebook.from', { title:example.source }) : '', t('notebook.stats', { p:entry.practiced, m:entry.missed })].filter(Boolean).join(' · ');
    const due = !Number.isFinite(entry.reviewDue) || entry.reviewDue <= Date.now();
    const review = due ? t('notebook.dueNow') : t('notebook.dueOn', {date:new Intl.DateTimeFormat(dateLocale[language.value], {dateStyle:'medium', timeStyle:'short'}).format(new Date(entry.reviewDue))});
    return `<li><div class="note-word"><strong>${escapeHtml(word)}</strong><span>${escapeHtml(entry.translations[language.value] || '—')}</span><button type="button" class="btn-quiet" data-edit-note="${escapeHtml(word)}" aria-label="${escapeHtml(t('notebook.edit', { word }))}">${escapeHtml(t('translation.edit'))}</button></div><div class="note-body">${example ? `<p class="note-sentence">${mark(example.text, word)}</p>` : ''}<span class="note-meta">${escapeHtml(meta)}</span><span class="note-review" data-review-word="${escapeHtml(word)}" data-review-state="${due ? 'due' : 'scheduled'}">${escapeHtml(review)}</span></div><button type="button" class="btn-quiet note-remove" data-remove-note="${escapeHtml(word)}" aria-label="${escapeHtml(t('notebook.remove', { word }))}">×</button></li>`;
  }).join('') : `<li class="notebook-empty"><strong>${escapeHtml(t('notebook.empty'))}</strong><span>${escapeHtml(t('notebook.emptyNote'))}</span></li>`;
  if (item) fillWordTranslations(item);
}
let removedNotebookEntry = null;
$('notebook-list')?.addEventListener('click', event => {
  const edit = event.target.dataset?.editNote;
  if (edit) { editWordTranslation(edit, notebook.find(entry => entry.word === edit)?.translations?.[language.value] || ''); return; }
  const word = event.target.dataset?.removeNote;
  if (!word) return;
  if (typeof globalThis.confirm === 'function' && !globalThis.confirm(t('notebook.removeConfirm', {word}))) return;
  const hadFocus = document.activeElement === event.target;
  const entry = notebook.find(note => note.word === word), next = removeWord(notebook, word);
  if (!entry) return;
  const wasActiveNotebook = activeSettings?.id === 'notebook' && lesson()?.notebook;
  if (wasActiveNotebook && !saveProgress()) { if ($('notebook-message')) $('notebook-message').textContent = t('result.pickStorage'); return; }
  if (!saveNotebook(storage, next)) { if ($('notebook-message')) $('notebook-message').textContent = t('result.pickStorage'); return; }
  notebook = next; removedNotebookEntry = entry;
  syncNotebookLesson(); renderNotebook();
  if (wasActiveNotebook && !notebook.length) { mode = 'article'; updateSections(); loadPractice(); }
  if ($('notebook-message')) $('notebook-message').textContent = t('notebook.removed', {word});
  if ($('notebook-undo')) $('notebook-undo').hidden = false;
  if (hadFocus) $('notebook-undo')?.focus({ preventScroll:true });
});
$('notebook-undo')?.addEventListener('click', () => {
  const entry = removedNotebookEntry;
  if (!entry) return;
  const hadFocus = document.activeElement === $('notebook-undo');
  if (notebook.some(note => note.word === entry.word)) {
    removedNotebookEntry = null; $('notebook-undo').hidden = true;
    if ($('notebook-message')) $('notebook-message').textContent = t('notebook.undoExists');
    if (hadFocus) $('notebook-words')?.focus({ preventScroll:true });
    return;
  }
  const next = [...notebook, entry];
  if (!saveNotebook(storage, next)) { if ($('notebook-message')) $('notebook-message').textContent = t('result.pickStorage'); return; }
  notebook = next; removedNotebookEntry = null;
  syncNotebookLesson(); renderNotebook();
  $('notebook-undo').hidden = true;
  if ($('notebook-message')) $('notebook-message').textContent = t('notebook.restored', {word:entry.word});
  if (hadFocus) [...$('notebook-list').querySelectorAll('[data-remove-note]')].find(button => button.dataset.removeNote === entry.word)?.focus({ preventScroll:true });
});
// Practise the notebook: its words, or the sentences they came from.
function practiceNotebook(practiceMode, onlyDue = false) {
  if (!notebook.length || !mayLeave() || !saveProgress()) return;
  // Review counts can change at the end of a practice. Rebuild the derived
  // lesson before starting another run so the most-missed words move first.
  syncNotebookLesson();
  const index = lessons.findIndex(item => item.notebook);
  if (index < 0) return;
  const selected = onlyDue ? new Set(dueWords(notebook).map(entry => entry.word)) : null;
  const reviewWords = selected ? lessons[index].words.filter(word => selected.has(word[0])) : null;
  if (selected && !reviewWords.length) { renderNotebook(); return; }
  const scope = reviewWords && practiceMode === 'word' ? `due:${passageId(JSON.stringify(reviewWords.map(entry => entry[0])))}` : null;
  lessonSelect.value = String(index); updateSections(); pickerPage = 0; mode = practiceMode; loadPractice(true, reviewWords, null, null, scope);
  lessonPreview?.close();
  showView('practice'); currentView = 'practice'; globalThis.history?.replaceState?.(null, '', '#practice');
  if (paused) resumePractice(); else $('typing')?.focus();
}
$('notebook-words')?.addEventListener('click', () => practiceNotebook('word'));
$('notebook-sentences')?.addEventListener('click', () => practiceNotebook('article'));
$('notebook-due')?.addEventListener('click', () => practiceNotebook('word', true));
function closeMenu() { if ($('more-menu')) $('more-menu').open = false; }
$('delete-lesson')?.addEventListener('click', async () => {
  closeMenu();
  if (deletingLesson || restoringBackup || lessonEditSaving) return;
  const item = lesson();
  if (!item.custom || !globalThis.confirm(t('confirm.delete', { title:item.title }))) return;
  deletingLesson = true;
  const button = $('delete-lesson'); if (button) button.disabled = true;
  try {
    await persistLessonRemoval(storage, lessons, item.id);
    const selectedId = lesson()?.id;
    lessons.splice(lessons.indexOf(item), 1);
    updateLessonOptions();
    const selected = lessons.findIndex(entry => entry.id === selectedId);
    lessonSelect.value = String(selected < 0 ? 0 : selected);
    forgetReading(storage, item.id);
    if (selectedId === item.id) { clearSnapshot(storage, activeKey); updateSections(); mode = 'word'; loadPractice(); }
    if (item.figures?.some(figure => figure.kind === 'page')) { pdfPages.forget(item.id); await database?.remove(pdfKey(item.id)).catch(() => {}); }
  } catch { globalThis.alert?.(t('alert.deleteFail')); }
  finally { deletingLesson = false; if (button) button.disabled = false; }
});
// A whole novel is not sent for translation at once; the reader translates each passage as it is read.
const PREFETCH_LIMIT = 100_000;
function saveCustom(item, message, open = true) {
  if (restoringBackup || lessonEditSaving) return false;
  if (open && !mayLeave()) return false;
  if (!saveProgress()) { if ($(message)) $(message).textContent = t('notice.storageFail'); return false; }
  rememberTranslations(item.sentenceTranslations);
  delete item.sentenceTranslations;
  const current = lesson();
  const custom = addCustomLesson(lessons.filter(entry => entry.custom), item);
  const builtIn = lessons.filter(entry => !entry.custom);
  lessons.splice(0, lessons.length, ...builtIn, ...custom);
  const stored = persistLibrary();
  if (!stored) $(message).textContent = t('notice.storageFail');
  updateLessonOptions();
  const prefetch = item.sections?.length && item.text.length > PREFETCH_LIMIT ? item.sections[0].text : item.text;
  const fullSentences = splitSentences(typeable(prefetch));
  const translateAll = () => { if (!passageTranslations(fullSentences, fullSentences, item.translations?.[language.value], language.value)) prepareFullTranslation(fullSentences.map(sentence => sentence.trim()), language.value, item.id); };
  if (!open) { lessonSelect.value = String(Math.max(0, lessons.indexOf(current))); translateAll(); return true; }
  lessonSelect.value = String(lessons.length - 1); updateSections(); mode = 'article'; loadPractice();
  translateAll();
  showView('practice'); currentView = 'practice';
  lessonPreview?.open(Number(lessonSelect.value), false);
  if ($('workspace-notice')) { $('workspace-notice').textContent = stored && !storageError ? '' : t('notice.storageFail'); $('workspace-notice').hidden = stored && !storageError; }
  if (globalThis.location && globalThis.history) globalThis.history.replaceState(null, '', '#practice');
  return true;
}
let prefetchRun = 0;
function prepareFullTranslation(sentences, code, lessonId = lesson().id) {
  const run = ++prefetchRun, panel = $('translation-progress'), label = $('translation-progress-text'), retry = $('translation-retry');
  const title = lessons.find(item => item.id === lessonId)?.title || '';
  const describe = state => `${t('translation.progress', state)}${title ? ` · ${title}` : ''}`;
  if (panel) panel.hidden = false;
  if (label) label.textContent = describe({done:0, total:new Set(sentences.filter(Boolean)).size});
  if (retry) retry.hidden = true;
  void translationService.prefetch(sentences, code, state => {
    if (run !== prefetchRun) return;
    if (label) {
      label.textContent = describe(state);
      if (state.done === state.total && state.failed) label.textContent = `${t('translation.failed', state)}${title ? ` · ${title}` : ''}`;
    }
    if (activeSettings?.id === lessonId && language.value === code && mode === 'article' && !finished && !lesson().translations?.[code]) {
      sentenceTranslations = articleSentences.map(sentence => translationService.get(sentence.trim(), code));
      paintArticle();
    }
  }).then(complete => {
    if (run !== prefetchRun) return;
    if (panel) panel.hidden = complete;
    if (retry) { retry.hidden = complete; retry.onclick = () => prepareFullTranslation(sentences, code, lessonId); }
  });
}
const newId = () => `custom-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
let lessonEditOriginal = null, lessonEditUncertain = false;
$('edit-lesson')?.addEventListener('click', () => {
  const item = lesson(), dialog = $('lesson-edit-dialog');
  if (!dialog?.showModal || !item || item.notebook || restoringBackup || deletingLesson) return;
  if (lessonEditUncertain) { globalThis.alert?.(t('lessonEdit.uncertain')); return; }
  try {
    $('lesson-edit-text').value = editableLessonText(item);
    $('lesson-edit-name').value = t('lessonEdit.copyTitle', {title:String(item.title || '').slice(0, 80)}).slice(0, 100);
  } catch { globalThis.alert?.(t('lessonEdit.failed')); return; }
  lessonEditOriginal = item;
  $('lesson-edit-error').textContent = '';
  holdClock(); closeMenu(); dialog.showModal(); $('lesson-edit-name').focus();
});
$('lesson-edit-dialog')?.addEventListener('cancel', event => { if (lessonEditSaving) event.preventDefault(); });
$('lesson-edit-dialog')?.addEventListener('close', () => {
  if ($('lesson-edit-dialog').open || !lessonEditOriginal) return;
  lessonEditOriginal = null;
  $('more-menu')?.querySelector('summary')?.focus();
});
$('lesson-edit-cancel')?.addEventListener('click', () => {
  if (lessonEditSaving) return;
  $('lesson-edit-dialog').close(); lessonEditOriginal = null;
  $('more-menu')?.querySelector('summary')?.focus();
});
$('lesson-edit-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (lessonEditSaving || !lessonEditOriginal || restoringBackup || deletingLesson || publishingCount) return;
  const dialog = $('lesson-edit-dialog'), error = $('lesson-edit-error'), button = $('lesson-edit-save'), cancel = $('lesson-edit-cancel'), name = $('lesson-edit-name'), text = $('lesson-edit-text');
  error.textContent = '';
  let copy, persisted = false;
  try {
    let id;
    for (let i = 0; i < 10; i++) { const candidate = newId(); if (!lessons.some(item => item.id === candidate)) { id = candidate; break; } }
    copy = createEditedLessonCopy({ original:lessonEditOriginal, id, title:name.value, text:text.value });
    if (!mayLeave()) return;
    if (!saveProgress()) throw new Error('progress save failed');
    lessonEditSaving = true; button.disabled = true; cancel.disabled = true; name.disabled = true; text.disabled = true; button.textContent = t('lessonEdit.saving');
    await persistEditedCopy(storage, copy);
    persisted = true;
    const savedLessons = readCustomLessons(storage);
    const copyIndex = savedLessons.findIndex(item => item.id === copy.id);
    if (copyIndex < 0) throw new Error('Saved copy is unavailable');
    const builtIn = lessons.filter(item => !item.custom);
    lessons.splice(0, lessons.length, ...builtIn, ...savedLessons); updateLessonOptions();
    lessonSelect.value = String(builtIn.length + copyIndex);
    updateSections(); mode = 'article'; pickerPage = 0; loadPractice();
    dialog.close();
    lessonPreview?.open(Number(lessonSelect.value), false);
    lessonEditOriginal = null;
  } catch (failure) {
    lessonEditUncertain = persisted || failure?.code === 'cleanup_failed';
    error.textContent = t(lessonEditUncertain ? 'lessonEdit.uncertain' : 'lessonEdit.failed');
    if (lessonEditUncertain && !dialog.open) { try { dialog.showModal(); } catch { globalThis.alert?.(error.textContent); } }
  }
  finally { lessonEditSaving = false; button.disabled = lessonEditUncertain; cancel.disabled = false; name.disabled = false; text.disabled = false; button.textContent = t('lessonEdit.save'); }
});
function renderVocabulary() {
  const panel = $('lesson-vocab'), list = $('vocab-list'); if (!panel || !list) return;
  const item = lesson(), words = item.words || [];
  panel.hidden = !words.length;
  if ($('vocab-count')) $('vocab-count').textContent = words.length ? String(words.length) : '';
  list.innerHTML = words.map(word => `<div><dt>${escapeHtml(word[0])}</dt><dd>${escapeHtml(word[languageIndex()] || '—')}</dd></div>`).join('');
  fillWordTranslations(item);
}
// Avoid duplicate requests while allowing a failed translation to be retried later.
const wordAttempts = new Set();
const failedWordTranslations = new Set();
const wordTranslationKey = (item, word, code) => JSON.stringify([item.id, word, code]);
function updateCurrentWordTranslationStatus(item, word, code) {
  if (finished || mode !== 'word' || lesson() !== item || language.value !== code || currentWords()?.[wordIndex]?.[0] !== word) return;
  const button = $('retry-current-translation');
  if (button) button.hidden = !!currentWords()[wordIndex][languageIndex()] || !failedWordTranslations.has(wordTranslationKey(item, word, code));
}
function updateWordTranslationStatus() {
  const item = lesson(), code = language.value;
  const failed = (item.words || []).some(entry => !entry[languageIndex()] && failedWordTranslations.has(wordTranslationKey(item, entry[0], code)));
  const status = $('word-translation-status'), retry = $('word-translation-retry');
  if (status) status.textContent = failed ? t('picker.translationFail') : '';
  if (retry) retry.hidden = !failed;
}
$('word-translation-retry')?.addEventListener('click', () => {
  const item = lesson(), code = language.value;
  for (const entry of item.words || []) if (!entry[languageIndex()] && failedWordTranslations.has(wordTranslationKey(item, entry[0], code))) translateWord(item, entry[0], code);
});
function fillWordTranslations(item) {
  const index = languageIndex();
  for (const entry of (item.words || []).filter(word => !word[index] && !wordAttempts.has(`${item.id}\u0000${language.value}\u0000${word[0]}`)).slice(0, 12)) {
    const key = `${item.id}\u0000${language.value}\u0000${entry[0]}`;
    if (wordAttempts.has(key)) continue;
    wordAttempts.add(key); translateWord(item, entry[0], language.value).finally(() => wordAttempts.delete(key));
  }
}
function renderPicker() {
  const panel = $('word-picker');
  if (!panel) return;
  updateWordTranslationStatus();
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
  const saved = hasModeSnapshots(storage, lesson().id, 'word');
  const hasProgress = (mode === 'word' && !finished && (input || wordIndex || errors)) || saved;
  if (hasProgress && typeof globalThis.confirm === 'function' && !globalThis.confirm(t('confirm.words'))) return false;
  if (saved && !clearModeSnapshots(storage, lesson().id, 'word')) { setHint('hint.saveFail'); return false; }
  if (mode === 'word') { mode = 'article'; loadPractice(); }
  return true;
}
$('selected-words')?.addEventListener('click', event => {
  const word = event.target.dataset?.removeWord;
  if (!word || !prepareWordListChange()) return;
  const hadFocus = document.activeElement === event.target;
  const index = hadFocus ? [...$('selected-words').querySelectorAll('[data-remove-word]')].indexOf(event.target) : -1;
  const item = lesson(); item.words = item.words.filter(entry => entry[0] !== word);
  persistLibrary(); noteWords({ remove:[word] }); renderPicker(); $('word-mode').disabled = !item.words.length;
  if (hadFocus) { const buttons = [...$('selected-words').querySelectorAll('[data-remove-word]')]; (buttons[Math.min(index, buttons.length - 1)] || $('word-search')).focus({ preventScroll:true }); }
});
$('word-candidates')?.addEventListener('click', event => {
  const word = event.target.dataset?.word;
  if (!word) return;
  if (!prepareWordListChange()) return;
  const hadFocus = document.activeElement === event.target;
  const index = hadFocus ? [...$('word-candidates').querySelectorAll('.known-word')].indexOf(event.target) : -1;
  const item = lesson(); item.knownWords ||= [];
  if (!item.knownWords.includes(word)) item.knownWords.push(word);
  item.words = item.words.filter(entry => entry[0] !== word);
  persistLibrary(); noteWords({ remove:[word] });
  renderPicker();
  $('word-mode').disabled = !item.words.length;
  if (hadFocus) { const buttons = [...$('word-candidates').querySelectorAll('.known-word')]; (buttons[Math.min(index, buttons.length - 1)] || $('word-search')).focus({ preventScroll:true }); }
});
$('word-candidates')?.addEventListener('change', async event => {
  const target = event.target;
  if (target.type !== 'checkbox') return;
  if (!prepareWordListChange()) { target.checked = !target.checked; return; }
  const hadFocus = document.activeElement === target;
  const item = lesson(), word = target.value;
  item.words ||= [];
  if (target.checked && !item.words.some(entry => entry[0] === word)) item.words.push([word, '', '', '']);
  if (!target.checked) item.words = item.words.filter(entry => entry[0] !== word);
  persistLibrary();
  noteWords(target.checked ? { add:[word], text:item.text } : { remove:[word] });
  renderPicker();
  if (hadFocus) [...$('word-candidates').querySelectorAll('input[type="checkbox"]')].find(input => input.value === word)?.focus({ preventScroll:true });
  $('word-mode').disabled = !item.words.length;
  if (!target.checked) return;
  translateWord(item, word, language.value);
});
async function translateWord(item, word, selectedLanguage) {
  const index = ({zh:1, ja:2, ko:3})[selectedLanguage];
  const selectedEntry = item.words.find(entry => entry[0] === word);
  const retryEntry = lesson() === item ? retryWords?.find(entry => entry[0] === word) : null;
  if ((retryEntry || selectedEntry)?.[index]) return;
  let succeeded = false;
  try {
    const translations = await requestTranslation([word], selectedLanguage);
    if (restoringBackup || lessonEditSaving) return;
    const currentEntry = item.words.find(entry => entry[0] === word);
    const currentRetry = retryEntry && retryWords?.includes(retryEntry) ? retryEntry : null;
    if (currentEntry?.[index] || currentRetry?.[index] || (item.notebook && notebook.find(note => note.word === word.toLowerCase())?.translations?.[selectedLanguage])) return;
    const translation = typeof translations[0] === 'string' && translations[0].trim().toLowerCase() !== word.toLowerCase() ? translations[0] : '';
    if (!translation) return;
    succeeded = true;
    const entry = item.words.find(value => value[0] === word);
    if (entry) { entry[index] = translation; persistWords(item); if (lesson() === item) renderVocabulary(); }
    if (entry && !item.notebook && notebook.some(note => note.word === word.toLowerCase())) {
      notebook = notebook.map(note => note.word === word.toLowerCase() ? { ...note, translations:{ ...note.translations, [selectedLanguage]:translation } } : note);
      if (!saveNotebook(storage, notebook)) setHint('result.pickStorage');
      syncNotebookLesson();
      renderNotebook();
    }
    if (retryEntry && retryWords?.includes(retryEntry)) { retryEntry[index] = translation; scheduleProgress(); }
    if (!finished && mode === 'word' && lesson() === item && currentWords()[wordIndex]?.[0] === word && language.value === selectedLanguage) exercise.querySelector('.translation').textContent = translation || t('word.noTranslation');
  } catch { /* Word practice remains available without a translation. */ }
  finally {
    const key = wordTranslationKey(item, word, selectedLanguage);
    const currentRetry = retryEntry && retryWords?.includes(retryEntry) && lesson() === item ? retryEntry : null;
    if (succeeded || item.words.find(entry => entry[0] === word)?.[index] || currentRetry?.[index]) failedWordTranslations.delete(key);
    else if (item.words.some(entry => entry[0] === word) || currentRetry) failedWordTranslations.add(key);
    if (lesson() === item && language.value === selectedLanguage) { updateWordTranslationStatus(); updateCurrentWordTranslationStatus(item, word, selectedLanguage); }
  }
}
$('picker-start')?.addEventListener('click', () => setMode('word'));
async function publishLesson(item, category = '') {
  if (restoringBackup) throw new Error(t('backup.restoring'));
  if (storage?.volatile) throw new Error(t('notice.storageFail'));
  publishingCount++;
  try {
    const workbook = createWorkbook(item, translationCache);
    if (category) workbook.lesson.category = category;
    const body = JSON.stringify(workbook); readWorkbook(body);
    const { id, ownerKey } = createPublicationIdentity();
    const ownerKeys = readOwnerKeys(); ownerKeys[id] = ownerKey;
    try {
      storage.setItem('lingtype-published-keys', JSON.stringify(ownerKeys));
      if (readOwnerKeys()[id] !== ownerKey) throw new Error('Owner key was not saved');
    }
    catch { throw new Error(t('notice.storageFail')); }
    let data, uncertain = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await withPublicAttemptTimeout(async signal => {
          const response = await fetch('/api/workbooks', {method:'POST', headers:{'Content-Type':'application/json', 'X-Publication-Id':id, 'X-Owner-Key':ownerKey}, body, signal});
          return { response, data:await response.json() };
        });
        const response = result.response; data = result.data;
        if (!response.ok && ((response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) || response.status === 507)) throw Object.assign(new Error(data.error || ''), { rejected:true });
        if (!response.ok || data.id !== id || data.ownerKey !== ownerKey) throw new Error('Publication response was not confirmed');
        break;
      } catch (error) {
        if (error.rejected && !uncertain) throw error;
        uncertain = true; data = null;
      }
    }
    if (!data) throw Object.assign(new Error('Publication response was not confirmed'), { publicationId:id });
    // Each publication is a separate snapshot. Practising it from the shelf
    // uses its own local copy without reassigning the original lesson.
    return { data, canUnpublish:true };
  } finally { publishingCount--; }
}
$('publish-workbook')?.addEventListener('click', async () => {
  closeMenu();
  // The reader shares through the library's upload dialog; a browser without
  // dialogs asks for confirmation and shares the book directly.
  if (!lesson()?.notebook && openShareDialog(Number(lessonSelect.value))) return;
  if (!globalThis.confirm(t('confirm.publish'))) return;
  const button = $('publish-workbook'); button.disabled = true;
  try {
    const { data, canUnpublish } = await publishLesson(lesson());
    const notice = $('workspace-notice');
    const url = new URL(globalThis.location.href); url.hash = `book-${data.id}`;
    notice.textContent = t(['localhost','127.0.0.1'].includes(url.hostname) ? 'notice.local' : 'notice.shared') + ' ';
    const link = document.createElement('a'); link.href = url.href; link.textContent = url.href; notice.append(link); notice.hidden = false;
    if (!canUnpublish) notice.append(document.createTextNode(` ${t('notice.keyFail', { key:data.ownerKey })}`));
  } catch (error) { setHint(error.publicationId ? 'hint.publishUnknown' : 'hint.publishFail', error.publicationId ? { id:error.publicationId } : { error:localError(error.message, 'public.loadFail') }); }
  finally { button.disabled = false; }
});
$('export-workbook')?.addEventListener('click', () => {
  closeMenu();
  try {
    const json = JSON.stringify(createWorkbook(lesson(), translationCache), null, 2);
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
  translationService.remember(byLanguage);
}
function importedLesson(data, category) {
  const sections = importedSections(data.text, data.sections, data.figures, data.pages);
  const sourceUrl = /^https?:\/\/[^\s]+$/.test(data.sourceUrl || '') ? data.sourceUrl : '';
  return { id:newId(), custom:true, title:(data.title || t('import.defaultTitle')).slice(0, 100), category, text:data.text, ...(sections ? { sections } : {}), ...(sourceUrl ? { sourceUrl } : {}), ...(data.authors ? { authors:data.authors } : {}), ...(data.license ? { license:data.license } : {}), ...(data.formulas?.length ? { formulas:cleanFormulas(data.formulas) } : {}), ...(data.figures?.length ? { figures:cleanFigures(data.figures) } : {}), ...(data.sentenceTranslations ? { sentenceTranslations:data.sentenceTranslations } : {}), translations:{ zh:'', ja:'', ko:'' }, words:[] };
}
// Files: practice books and subtitles are read here; documents go to the server to have their text pulled out.
async function readLessonFile(file) {
  if (file.size > 20_000_000) throw Object.assign(new Error(''), {code:'file_big'});
  const name = file.name.toLowerCase();
  let item, pdfTextOnly = false;
  if (name.endsWith('.json')) { item = readWorkbook(await file.text()); item.id = newId(); }
  else if (/\.(srt|vtt)$/.test(name)) item = importedLesson({ title:file.name.replace(/\.(srt|vtt)$/i, ''), text:parseSubtitles(decodeSubtitleFile(await file.arrayBuffer())) }, 'subtitles');
  else {
    const response = await fetch(`/api/extract?name=${encodeURIComponent(file.name)}`, { method:'POST', headers:{ 'Content-Type':'application/octet-stream' }, body:file });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || ''), {code:data.code});
    item = importedLesson(data, 'document');
    // A PDF is kept here as it is, so its pages can be shown beside their text.
    const isPdf = name.endsWith('.pdf');
    const pages = isPdf ? pageFigures({ ...data, sections:item.sections }) : [];
    if (pages.length && database) {
      try { await database.write(pdfKey(item.id), file); item.figures = pages; }
      catch { pdfTextOnly = true; }
    } else if (isPdf && data.pages?.length) pdfTextOnly = true;
  }
  return { item, pdfTextOnly };
}
function fileErrorMessage(error) {
  return error.code === 'file_big' ? t('import.fileBig') : error.code === 'pdf_page_limit' ? t('import.pdfPageLimit') : error.code === 'epub_spine_invalid' ? t('import.epubSpineInvalid') : error instanceof SyntaxError ? t('import.needServer') : t('import.fileFail', { error:localError(error.message, 'import.fileBad') });
}
async function importFile(file) {
  const message = $('workbook-message');
  if (!file || !message) return;
  if (file.size > 20_000_000) { message.textContent = t('import.fileBig'); return; }
  message.textContent = t('import.reading');
  try {
    const { item, pdfTextOnly } = await readLessonFile(file);
    message.textContent = '';
    if (!saveCustom(item, 'workbook-message')) { if (!message.textContent) message.textContent = t('import.cancelled'); if (item.figures?.some(figure => figure.kind === 'page')) database?.remove(pdfKey(item.id)).catch(() => {}); }
    else if (pdfTextOnly) {
      if (!message.textContent) message.textContent = t('import.pdfTextOnly');
      const notice = $('workspace-notice');
      if (notice) { notice.textContent = [notice.hidden ? '' : notice.textContent, t('import.pdfTextOnly')].filter(Boolean).join(' '); notice.hidden = false; }
    } else if (!message.textContent) message.textContent = t('import.done', { title:item.title });
  } catch (error) { message.textContent = fileErrorMessage(error); }
}
$('document-file')?.addEventListener('change', event => { importFile(event.target.files?.[0]); event.target.value = ''; });
$('backup-export')?.addEventListener('click', async () => {
  if (lessonEditSaving) { $('backup-message').textContent = t('lessonEdit.saving'); return; }
  if (deletingLesson) { $('backup-message').textContent = t('backup.deletePending'); return; }
  if (publishingCount) { $('backup-message').textContent = t('backup.publishPending'); return; }
  if (restoringBackup) { $('backup-message').textContent = t('backup.restoring'); return; }
  if (!saveProgress()) { $('backup-message').textContent = t('backup.exportFailed'); return; }
  try {
    await storage.flush?.();
    const backup = await createBackupWithPdfs(storage, database);
    if (publishingCount || lessonEditSaving || JSON.stringify(createBackup(storage).data) !== JSON.stringify(backup.data)) throw new Error('Data changed during backup');
    const file = JSON.stringify(backup);
    if (new Blob([file]).size > MAX_BACKUP_BYTES) throw new Error('Backup too large');
    await verifyBackup(readBackup(file));
    if (lessonEditSaving || JSON.stringify(createBackup(storage).data) !== JSON.stringify(backup.data)) throw new Error('Data changed during backup');
    const url = URL.createObjectURL(new Blob([file], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'lingtype-backup.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('backup-message').textContent = t('backup.exported');
  } catch { $('backup-message').textContent = t('backup.exportFailed'); }
});
$('backup-file')?.addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  const message = $('backup-message');
  if (lessonEditSaving) { message.textContent = t('lessonEdit.saving'); return; }
  if (deletingLesson) { message.textContent = t('backup.deletePending'); return; }
  if (!database || storage?.volatile || !storage?.flush) { message.textContent = t('backup.unavailable'); return; }
  let json, parsed;
  try { if (file.size > MAX_BACKUP_BYTES) throw new Error('large'); json = await file.text(); parsed = readBackup(json); await verifyBackup(parsed); await verifyLegacyPdfCompatibility(parsed, database); }
  catch (error) { message.textContent = t(error.code === 'legacy_pdf_conflict' ? 'backup.legacyPdfConflict' : 'backup.invalid'); return; }
  if (!globalThis.confirm(t('backup.confirm') + (hasUnverifiedPdfs(parsed) ? `\n\n${t('backup.legacyPdfWarning')}` : ''))) return;
  if (lessonEditSaving) { message.textContent = t('lessonEdit.saving'); return; }
  if (deletingLesson) { message.textContent = t('backup.deletePending'); return; }
  if (publishingCount) { message.textContent = t('backup.publishPending'); return; }
  if (postingCommentCount) { message.textContent = t('backup.commentPending'); return; }
  holdClock();
  if (!saveProgress()) { message.textContent = t('backup.failed'); return; }
  try {
    restoringBackup = true;
    await stageBackupRestore(storage, database, json);
    globalThis.location.reload();
  } catch (error) {
    restoringBackup = false;
    message.textContent = t(error?.code === 'legacy_pdf_conflict' ? 'backup.legacyPdfConflict' : 'backup.failed');
    flushPublicAttempts();
  }
});
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
  if (!saveCustom(item, 'import-message')) { if (!$('import-message').textContent) $('import-message').textContent = t('import.cancelled'); return; }
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
    const host = (() => { try { return new URL(data.sourceUrl).hostname; } catch { return ''; } })();
    const item = importedLesson(data, host === 'arxiv.org' ? 'arxiv' : /youtube\.com$/.test(host) ? 'youtube' : 'web');
    message.textContent = '';
    if (!saveCustom(item, 'arxiv-message')) { if (!message.textContent) message.textContent = t('import.cancelled'); }
    else {
      $('arxiv-url').value = '';
      if (!message.textContent) message.textContent = item.category === 'arxiv' ? t('import.arxivDone', { n:item.sections.length }) : t('import.done', { title:item.title });
    }
  } catch (error) { message.textContent = error instanceof SyntaxError ? t('import.needServer') : t('import.arxivFail', { error:localError(error.message, 'import.urlBad') }); }
  finally { button.disabled = false; }
});
// The community bookshelf: shared books with covers, likes, readers, completion rates, rankings and comments.
const BOOK_ID = /^[0-9a-f]{32}$/;
const visitor = readVisitor(storage);
const commentTracker = createCommentTracker(storage);
let shelf = { books:[], ranking:[], comments:[] }, shelfCategory = '', shelfPage = 1, shelfTotal = 0, shelfCategories = [], openBookId = null, shelfSearchTimer;
let detailVersion = 0, communityRun = 0, likePending = false;
const detailIsCurrent = (id, version) => currentView === 'public' && openBookId === id && detailVersion === version;
const coverVersions = {};
const startedPublic = new Set();
function readerName() { try { return (storage?.getItem('lingtype-reader-name') || '').slice(0, 40); } catch { return ''; } }
function saveReaderName(name) { try { storage?.setItem('lingtype-reader-name', name.slice(0, 40)); } catch { /* the name is used for this visit only */ } }
// Imports file their lessons under short codes; shelves show them by name.
function categoryName(category) { const key = `public.cat.${category}`, name = t(key); return name === key ? category : name; }
function postCommunity(id, action, body, signal) {
  return Promise.resolve().then(() => fetch(`/api/workbooks/${id}/community/${action}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), ...(signal ? {signal} : {})}));
}
function notePublicStart() {
  const id = lesson()?.publicId;
  if (!BOOK_ID.test(id || '') || startedPublic.has(id)) return;
  if (!queuePublicStart(storage, id, visitor)) {
    reportStorageError();
    // Avoid a request on every keystroke when storage fails. Retry in this
    // session even if the reader stops before the network recovers.
    startedPublic.add(id);
    const retry = () => {
      const timer = setTimeout(send, 60000); timer?.unref?.();
    };
    const send = () => {
      if (restoringBackup) { retry(); return; }
      withPublicAttemptTimeout(signal => postCommunity(id, 'start', { visitor }, signal))
        .then(response => { if (!response.ok && ![400, 404, 410, 422].includes(response.status)) retry(); }, retry);
    };
    send();
    return;
  }
  startedPublic.add(id);
  flushPublicAttempts();
}
function publicQueueFlusher(pending, drain, action, onSuccess = () => {}) {
  let sending = false, retryTimer;
  return async function flush() {
    if (sending || restoringBackup) return;
    clearTimeout(retryTimer); sending = true;
    let failed = false;
    try {
      const result = await drain(storage, async (bookId, payload) => {
        const version = detailVersion;
        const response = await withPublicAttemptTimeout(signal => postCommunity(bookId, action, payload, signal));
        if (response.ok && !restoringBackup) onSuccess(bookId, version);
        return response;
      }, () => restoringBackup);
      failed = result.retry;
      if (result.discarded || result.capacity) {
        const notice = $('workspace-notice');
        if (notice) { notice.textContent = t(result.discarded ? 'notice.publicAttemptRejected' : 'notice.publicAttemptCapacity'); notice.hidden = false; }
      }
    } finally {
      sending = false;
      if (pending(storage).length && !restoringBackup) {
        if (failed) { retryTimer = setTimeout(flush, 60000); retryTimer?.unref?.(); }
        else queueMicrotask(flush);
      }
    }
  };
}
// A stalled start must not delay a completion, and vice versa.
const flushPublicStarts = publicQueueFlusher(pendingPublicStarts, drainPublicStarts, 'start');
const flushPublicResults = publicQueueFlusher(pendingPublicAttempts, drainPublicAttempts, 'attempts');
const flushPublicReads = publicQueueFlusher(pendingPublicReads, drainPublicReads, 'read', (id, version) => { if (detailIsCurrent(id, version)) loadCommunity(id); });
function flushPublicAttempts() { flushPublicStarts(); flushPublicResults(); flushPublicReads(); }
globalThis.addEventListener?.('online', flushPublicAttempts);
queueMicrotask(flushPublicAttempts);

// A whole book is complete only after every full section has been typed.
function notePublicFinish(record) {
  const item = lesson(), id = item?.publicId;
  if (!BOOK_ID.test(id || '') || mode !== 'article') return;
  const section = $('section-mode')?.value || 'all';
  const sections = section === 'all' ? [item.text] : item.sections?.map(part => part.text);
  const index = section === 'all' ? 0 : Number(section);
  if (!sections || !Number.isInteger(index) || index < 0 || index >= sections.length || articleText !== typeable(sections[index]).trimEnd()) return;
  const signature = JSON.stringify([passageId(typeable(item.text)), sections.map(text => passageId(typeable(text)))]);
  const counts = typedCounts(articleText, input, autoSeparators);
  if (!recordPublicPart(storage, { bookId:id, signature, index, size:sections.length, counts, elapsed:record.elapsed, author:readerName(), visitor })) {
    const notice = $('workspace-notice');
    if (notice) { notice.textContent = t('notice.storageFail'); notice.hidden = false; }
    return;
  }
  flushPublicAttempts();
}
function showShelf(on) {
  if ($('public-detail')) $('public-detail').hidden = on;
  if ($('public-shelf')) $('public-shelf').hidden = !on; else if ($('public-books')) $('public-books').hidden = !on;
  if (on) { openBookId = null; detailBook = null; detailVersion++; communityRun++; likePending = false; }
}
function coverHtml(book, size = '') {
  const [ink, paper] = coverColors(book.id), version = coverVersions[book.id] ? `?v=${coverVersions[book.id]}` : '';
  return `<div class="cover${size}" style="--ink:${ink};--paper:${paper}"><span class="cover-tag">${escapeHtml(categoryName(book.category) || 'Lingtype')}</span><span class="cover-title">${escapeHtml(book.title)}</span>${book.hasCover ? `<img src="/api/workbooks/${book.id}/cover${version}" alt="" loading="lazy">` : ''}</div>`;
}
const rateText = book => book.completionRate === null ? t('public.rateNone') : t('public.rate', { n:book.completionRate });
function renderShelf() {
  const list = $('public-books'), message = $('public-message'); if (!list || !message) return;
  const books = shelf.books;
  const ownerKeys = readOwnerKeys();
  message.textContent = books.length ? '' : ($('public-search')?.value.trim() || shelfCategory ? t('public.noMatch') : t('public.empty'));
  list.innerHTML = books.map(book => `<li class="shelf-book"><button class="cover-button" type="button" data-book-id="${book.id}" tabindex="-1" aria-hidden="true">${coverHtml(book)}</button><h3><button class="book" type="button" data-book-id="${book.id}">${escapeHtml(book.title)}</button></h3><p class="book-meta">${escapeHtml([categoryName(book.category), book.authors.slice(0, 3).join(', ') + (book.authors.length > 3 ? ', …' : ''), book.words ? t('public.minutes', { n:typingMinutes(book.words) }) : ''].filter(Boolean).join(' · '))}</p><p class="book-stats"><span aria-label="${escapeHtml(t('public.likesAria', { n:book.likes }))}">♥ ${book.likes}</span><span>${escapeHtml(t('public.reads', { n:book.reads }))}</span><span>${escapeHtml(rateText(book))}</span></p>${ownerKeys[book.id] ? `<button class="btn-quiet" type="button" data-remove-book="${book.id}">${escapeHtml(t('public.remove'))}</button>` : ''}</li>`).join('');
  const pages = Math.max(1, Math.ceil(shelfTotal / 24));
  if ($('public-pagination')) $('public-pagination').hidden = pages <= 1;
  if ($('public-page')) $('public-page').textContent = t('public.page', { page:shelfPage, pages });
  if ($('public-prev')) $('public-prev').disabled = shelfPage <= 1;
  if ($('public-next')) $('public-next').disabled = shelfPage >= pages;
}
function renderFilters() {
  const box = $('public-filters'); if (!box) return;
  const all = shelfCategories;
  if (!all.includes(shelfCategory)) shelfCategory = '';
  // Even a single named category can be useful when other books are uncategorized.
  box.hidden = all.length === 0;
  box.innerHTML = ['', ...all].map(category => `<button type="button" class="filter" data-category="${escapeHtml(category)}" aria-pressed="${category === shelfCategory}">${escapeHtml(category ? categoryName(category) : t('public.all'))}</button>`).join('');
}
function rankingHtml(rows, withTitle) {
  return rows.map((row, index) => `<li><strong>${String(index + 1).padStart(2, '0')}</strong><div><b>${escapeHtml(row.author)}</b>${withTitle ? `<button class="link" type="button" data-book-id="${row.bookId}">${escapeHtml(row.title)}</button>` : `<span>${escapeHtml(t('public.accuracy', { n:Math.round(row.accuracy) }))}</span>`}</div><span class="wpm">${Math.round(row.wpm)} WPM</span></li>`).join('');
}
const when = date => { const value = new Date(date); return Number.isNaN(value.getTime()) ? '' : value.toLocaleDateString(dateLocale[language.value]); };
function renderRail() {
  if ($('public-ranking')) $('public-ranking').innerHTML = shelf.ranking.length ? rankingHtml(shelf.ranking, true) : `<li class="rail-empty">${escapeHtml(t('public.rankingEmpty'))}</li>`;
  if ($('public-comments')) $('public-comments').innerHTML = shelf.comments.length ? shelf.comments.map(comment => `<li><p><b>${escapeHtml(comment.author)}</b> · <button class="link" type="button" data-book-id="${comment.bookId}">${escapeHtml(comment.title)}</button></p><p class="quote">${escapeHtml(comment.text)}</p><small>${escapeHtml(when(comment.createdAt))}</small></li>`).join('') : `<li class="rail-empty">${escapeHtml(t('public.recentEmpty'))}</li>`;
}
async function loadPublicBooks() {
  const list = $('public-books'), message = $('public-message'); if (!list || !message) return;
  clearTimeout(shelfSearchTimer);
  const run = ++publicRun;
  message.textContent = t('public.loading'); list.innerHTML = '';
  try {
    const params = new URLSearchParams({ query:$('public-search')?.value || '', category:shelfCategory, sort:$('public-sort')?.value || 'likes', page:String(shelfPage) });
    const {response, data} = await withPublicAttemptTimeout(async signal => {
      const response = await fetch(`/api/workbooks?${params}`, {signal});
      return {response, data:await response.json()};
    });
    if (run !== publicRun) return;
    if (!response.ok || !Array.isArray(data.books)) throw new Error(data.error || '');
    shelfTotal = Number.isSafeInteger(data.total) && data.total >= 0 ? data.total : data.books.length;
    const last = Math.max(1, Math.ceil(shelfTotal / 24));
    if (shelfPage > last) { shelfPage = last; return loadPublicBooks(); }
    shelfCategories = Array.isArray(data.categories) ? data.categories.filter(value => typeof value === 'string' && value.length <= 40) : [];
    // A selected category can disappear while another reader removes its last
    // book. Re-query the unfiltered shelf instead of presenting its old empty
    // results as though they belonged to the reset filter.
    if (shelfCategory && !shelfCategories.includes(shelfCategory)) {
      shelfCategory = ''; shelfPage = 1; return loadPublicBooks();
    }
    shelf = cleanShelf(data);
    renderFilters(); renderShelf(); renderRail();
  } catch (error) { if (run === publicRun) message.textContent = error.message === 'Community request timed out' ? t('public.loadFail') : localError(error.message, 'public.loadFail'); }
}
function statsText(book) {
  return [`♥ ${book.likes}`, t('public.reads', { n:book.reads }), rateText(book), ...(book.starts ? [t('public.completed', { done:book.completions, started:book.starts })] : []), t('public.practices', { n:book.practiceCount })].join(' · ');
}
async function openPublicBook(id) {
  const detail = $('public-detail'), message = $('public-message');
  if (!detail || !message || !BOOK_ID.test(id)) return;
  const opener = document.activeElement?.matches?.('[data-book-id]') ? document.activeElement : null;
  clearTimeout(shelfSearchTimer);
  if (started !== null && !paused && !finished) $('pause')?.click();
  const run = ++publicRun;
  showView('public'); currentView = 'public'; showShelf(true); message.textContent = t('public.loading');
  try {
    const {response, data} = await withPublicAttemptTimeout(async signal => {
      const response = await fetch(`/api/workbooks/${id}`, {signal});
      return {response, data:await response.json()};
    });
    if (run !== publicRun) return;
    if (!response.ok) throw new Error(data.error || t('public.notFound'));
    const item = readWorkbook(JSON.stringify(data));
    const book = shelf.books.find(entry => entry.id === id) || cleanShelf({ books:[{ id, title:item.title, category:typeof data.lesson?.category === 'string' ? data.lesson.category : '', authors:item.authors || [] }] }).books[0];
    const owner = readOwnerKeys()[id];
    const excerpt = item.text.length > 3000 ? `${item.text.slice(0, 3000)}…` : item.text;
    detail.innerHTML = `<button id="public-back" class="btn-quiet back" type="button">${escapeHtml(t('public.back'))}</button><div class="detail-top"><div id="public-cover-box" class="detail-cover">${coverHtml(book, ' large')}</div><div class="detail-info"><p class="eyebrow">${escapeHtml([categoryName(book.category), item.edited ? t('lessonEdit.edited') : ''].filter(Boolean).join(' · '))}</p><h2>${escapeHtml(item.title)}</h2>${(item.source || item.authors?.length || item.license || item.sourceUrl) ? `<p class="book-meta">${escapeHtml([item.source, item.authors?.join(', '), item.license].filter(Boolean).join(' · '))}${item.sourceUrl ? `${item.source || item.authors?.length || item.license ? ' · ' : ''}<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('source.link'))}</a>` : ''}</p>` : ''}<p id="public-stats" class="detail-stats">${escapeHtml(statsText(book))}</p><p class="public-detail-text">${escapeHtml(excerpt)}</p><div class="public-detail-actions"><button id="add-public-book" class="btn primary" type="button">${escapeHtml(t(lessons.some(entry => entry.publicId === id) ? 'public.open' : 'public.add'))}</button><button id="public-like" class="btn like" type="button" aria-pressed="false" disabled>♡ ${book.likes}</button>${owner ? `<button class="btn" id="public-cover-button" type="button">${escapeHtml(t('public.cover'))}</button><input id="public-cover-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>` : ''}<span id="public-detail-message" class="message" role="status"></span></div></div></div><div class="detail-columns"><section><h3>${escapeHtml(t('public.bookRanking'))}</h3><ol id="public-book-ranking" class="rank-list"></ol></section><section><h3>${escapeHtml(t('public.comments'))}</h3><form id="public-comment-form" class="comment-form"><input id="public-name" maxlength="40" autocomplete="nickname" aria-label="${escapeHtml(t('public.name'))}" placeholder="${escapeHtml(t('public.namePlaceholder'))}"><textarea id="public-comment" maxlength="1000" rows="3" required aria-label="${escapeHtml(t('public.comment'))}" placeholder="${escapeHtml(t('public.comment'))}"></textarea><div class="form-foot"><button class="btn" type="submit">${escapeHtml(t('public.post'))}</button></div></form><div id="public-pending-comments"></div><ul id="public-comment-list" class="comment-list"></ul></section></div>`;
    showShelf(false); openBookId = id; detailBook = book; communityInfo = null; message.textContent = '';
    if (opener && (document.activeElement === opener || document.activeElement === document.body)) $('public-back')?.focus();
    if ($('public-name')) $('public-name').value = readerName();
    $('add-public-book').addEventListener('click', () => practicePublicBook(id, item));
    $('public-back').addEventListener('click', () => {
      const back = $('public-back');
      showShelf(true); globalThis.history?.replaceState(null, '', '#public');
      loadPublicBooks().then(() => {
        if (document.activeElement === back || document.activeElement === document.body) {
          (document.querySelector?.(`#public-books .book[data-book-id="${id}"]`) || $('public-search'))?.focus();
        }
      });
    });
    $('public-like')?.addEventListener('click', () => communityInfo ? toggleLike(id) : loadCommunity(id));
    $('public-cover-button')?.addEventListener('click', () => $('public-cover-file')?.click());
    $('public-cover-file')?.addEventListener('change', event => changeCover(id, event.target.files?.[0]));
    $('public-comment-form')?.addEventListener('submit', event => { event.preventDefault(); postComment(id); });
    $('public-pending-comments')?.addEventListener('click', event => {
      const forgetId = event.target.dataset?.forgetComment;
      if (forgetId) {
        if (!commentTracker.pending(id).some(entry => entry.id === forgetId) || !globalThis.confirm(t('public.forgetCommentConfirm'))) return;
        commentTracker.confirm(id, forgetId);
        renderPendingComments(id);
        if ($('public-detail-message')) $('public-detail-message').textContent = commentTracker.isPersistent() ? t('public.commentForgotten') : t('public.commentConfirmStorageFail');
        return;
      }
      const pendingId = event.target.dataset?.pendingComment;
      const draft = commentTracker.pending(id).find(entry => entry.id === pendingId);
      const field = $('public-comment'), name = $('public-name');
      if (!draft || !field || !name) return;
      if (field.value.trim() && (field.value.trim() !== draft.text || name.value.trim() !== draft.author) && !globalThis.confirm(t('public.restoreDraftConfirm'))) return;
      field.value = draft.text; name.value = draft.author; field.focus();
      if ($('public-detail-message')) $('public-detail-message').textContent = t('public.pendingReady');
    });
    $('public-comment-list')?.addEventListener('click', event => { const comment = event.target.dataset?.removeComment; if (comment) removeComment(id, comment); });
    renderPendingComments(id);
    // Load the detail independently: a stalled read counter must not prevent
    // likes and comments from becoming usable. Refresh only the same view
    // after the counter succeeds; an old response must not supersede a newer
    // book's community request (including reopening the same book).
    loadCommunity(id);
    if (queuePublicRead(storage, id, visitor)) flushPublicReads();
    else {
      reportStorageError();
      const version = detailVersion;
      withPublicAttemptTimeout(signal => postCommunity(id, 'read', { visitor }, signal)).then(response => {
        if (response.ok && detailIsCurrent(id, version)) loadCommunity(id);
      }).catch(() => {});
    }
  } catch (error) { if (run === publicRun) message.textContent = error.message === 'Community request timed out' ? t('public.loadFail') : localError(error.message, 'public.notFound'); }
}
// Practising a shared book opens the copy already in the library, or adds one that remembers where it came from.
function practicePublicBook(id, item) {
  const index = lessons.findIndex(entry => entry.publicId === id);
  if (index < 0) { item.id = newId(); item.publicId = id; if (!saveCustom(item, 'public-detail-message') && $('public-detail-message') && !$('public-detail-message').textContent) $('public-detail-message').textContent = t('public.cancelled'); return; }
  if (!mayLeave()) return;
  if (!saveProgress()) { if ($('public-detail-message')) $('public-detail-message').textContent = t('notice.storageFail'); return; }
  lessonSelect.value = String(index); updateSections(); pickerPage = 0; mode = 'article'; loadPractice();
  showView('practice'); currentView = 'practice';
  lessonPreview?.open(index, false);
  globalThis.history?.replaceState(null, '', '#practice');
}
let communityInfo = null, detailBook = null;
function renderPendingComments(id) {
  const list = $('public-pending-comments'); if (!list) return;
  const drafts = commentTracker.pending(id);
  list.innerHTML = drafts.length ? `<p>${escapeHtml(t('public.pendingComments'))}</p><ul>${drafts.map(draft => `<li><button type="button" class="btn-quiet" data-pending-comment="${draft.id}">${escapeHtml(draft.text)}</button> <button type="button" class="btn-quiet" data-forget-comment="${draft.id}" aria-label="${escapeHtml(t('public.forgetCommentAria', { text:draft.text.slice(0, 80) }))}">${escapeHtml(t('public.forgetComment'))}</button></li>`).join('')}</ul>` : '';
}
async function loadCommunity(id) {
  const version = detailVersion;
  if (!detailIsCurrent(id, version)) return;
  const run = ++communityRun;
  if (!communityInfo && $('public-like')) $('public-like').disabled = true;
  try {
    const { response, data } = await withPublicAttemptTimeout(async signal => {
      const response = await fetch(`/api/workbooks/${id}/community?visitor=${visitor}`, {signal});
      return {response, data:await response.json()};
    });
    if (!detailIsCurrent(id, version) || run !== communityRun) return;
    if (!response.ok) throw new Error(data.error || '');
    communityInfo = data; paintCommunity(id);
    if ($('public-detail-message')?.textContent === t('public.statsFail')) $('public-detail-message').textContent = '';
  } catch {
    if (detailIsCurrent(id, version) && run === communityRun) {
      if ($('public-detail-message')) $('public-detail-message').textContent = t('public.statsFail');
      const like = $('public-like');
      if (!communityInfo && like) { like.disabled = false; like.textContent = t('public.retryStats'); like.setAttribute('aria-label', t('public.retryStats')); }
    }
  }
}
function paintCommunity(id) {
  const info = communityInfo; if (!info) return;
  const book = cleanShelf({ books:[{ id, title:'', ...info, comments:Array.isArray(info.comments) ? info.comments.length : 0 }] }).books[0];
  const revealCover = book.hasCover && detailBook && !detailBook.hasCover;
  const known = shelf.books.find(entry => entry.id === id); if (known) Object.assign(known, { ...book, title:known.title, category:known.category, summary:known.summary, words:known.words, authors:known.authors, hasCover:known.hasCover || book.hasCover });
  // A direct share link may not be represented in the current shelf page.
  // Its cover is discovered by the community response after detail renders.
  if (revealCover) {
    detailBook.hasCover = true;
    if ($('public-cover-box')) $('public-cover-box').innerHTML = coverHtml(detailBook, ' large');
  }
  if ($('public-stats')) $('public-stats').textContent = statsText(book);
  const like = $('public-like');
  if (like) { like.disabled = likePending; like.setAttribute('aria-pressed', String(info.liked === true)); like.textContent = `${info.liked ? '♥' : '♡'} ${book.likes}`; like.setAttribute('aria-label', t('public.likesAria', { n:book.likes })); }
  const ranking = (Array.isArray(info.ranking) ? info.ranking : []).filter(row => row && typeof row.author === 'string' && Number.isFinite(row.wpm) && Number.isFinite(row.accuracy));
  if ($('public-book-ranking')) $('public-book-ranking').innerHTML = ranking.length ? rankingHtml(ranking, false) : `<li class="rail-empty">${escapeHtml(t('public.rankingEmpty'))}</li>`;
  const owner = readOwnerKeys()[id];
  const comments = (Array.isArray(info.comments) ? info.comments : []).filter(comment => comment && BOOK_ID.test(comment.id) && typeof comment.author === 'string' && typeof comment.text === 'string');
  if ($('public-comment-list')) $('public-comment-list').innerHTML = comments.length ? comments.map(comment => `<li><p><b>${escapeHtml(comment.author)}</b> <small>${escapeHtml(when(comment.createdAt))}</small>${owner ? ` <button class="btn-quiet" type="button" data-remove-comment="${comment.id}">${escapeHtml(t('public.deleteComment'))}</button>` : ''}</p><p class="quote">${escapeHtml(comment.text)}</p></li>`).join('') : `<li class="rail-empty">${escapeHtml(t('public.commentsEmpty'))}</li>`;
}
async function toggleLike(id) {
  const button = $('public-like'), version = detailVersion; if (!button || !communityInfo || likePending) return;
  ++communityRun;
  likePending = true;
  button.disabled = true;
  try {
    const liked = !(communityInfo?.liked);
    const { response, data } = await withPublicAttemptTimeout(async signal => {
      const response = await postCommunity(id, 'like', { visitor, liked }, signal);
      return { response, data:await response.json() };
    });
    if (!response.ok) throw new Error(data.error || '');
    if (!detailIsCurrent(id, version)) return;
    ++communityRun;
    communityInfo = { ...communityInfo, liked, likes:data.likes }; paintCommunity(id);
  } catch (error) { if (detailIsCurrent(id, version) && $('public-detail-message')) $('public-detail-message').textContent = localError(error.message, 'public.likeFail'); }
  finally { if (detailIsCurrent(id, version)) { likePending = false; button.disabled = false; } }
}
async function postComment(id) {
  const field = $('public-comment'), form = $('public-comment-form'), version = detailVersion, message = $('public-detail-message'), previousMessage = message?.textContent;
  if (restoringBackup) { if ($('public-detail-message')) $('public-detail-message').textContent = t('backup.restoring'); return; }
  const raw = field?.value || '', text = raw.trim(), name = $('public-name')?.value.trim() || '';
  const button = form?.querySelector('[type=submit]');
  if (!text || button?.disabled) return;
  if (button) button.disabled = true;
  postingCommentCount++;
  try {
    saveReaderName(name);
    const commentId = commentTracker.begin(id, name, text);
    renderPendingComments(id);
    if (!commentTracker.isPersistent() && $('public-detail-message')) $('public-detail-message').textContent = t('public.commentStorageFail');
    const { response, data } = await withPublicAttemptTimeout(async signal => {
      const response = await postCommunity(id, 'comments', { author:name, text, commentId }, signal);
      return { response, data:await response.json() };
    });
    if (response.status === 410) {
      commentTracker.confirm(id, commentId);
      if (currentView === 'public' && openBookId === id) renderPendingComments(id);
      if (detailIsCurrent(id, version) && $('public-detail-message')) $('public-detail-message').textContent = [t('public.commentRemoved'), !commentTracker.isPersistent() ? t('public.commentConfirmStorageFail') : ''].filter(Boolean).join(' ');
      return;
    }
    if (!response.ok) throw Object.assign(new Error(data.error || ''), {definitive:(response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) || response.status === 507});
    if (data.id !== commentId) throw new Error('Comment response was not confirmed');
    commentTracker.confirm(id, commentId);
    if (currentView === 'public' && openBookId === id) renderPendingComments(id);
    if (!detailIsCurrent(id, version)) return;
    if (field.value === raw && ($('public-name')?.value.trim() || '') === name) field.value = '';
    if (message) {
      if (!commentTracker.isPersistent()) message.textContent = t('public.commentConfirmStorageFail');
      else if (message.textContent === previousMessage) message.textContent = '';
    }
    loadCommunity(id);
  } catch (error) {
    if (detailIsCurrent(id, version) && $('public-detail-message')) {
      $('public-detail-message').textContent = [error.definitive ? localError(error.message, 'public.postFail') : t('public.commentUnknown'), !commentTracker.isPersistent() ? t('public.commentStorageFail') : ''].filter(Boolean).join(' ');
    }
  }
  finally { postingCommentCount--; if (button) button.disabled = false; }
}
const deletingComments = new Set();
async function removeComment(id, comment) {
  const version = detailVersion;
  if (!BOOK_ID.test(comment) || deletingComments.has(comment) || !globalThis.confirm(t('public.deleteConfirm'))) return;
  deletingComments.add(comment);
  try {
    const {response, data} = await withPublicAttemptTimeout(async signal => {
      const response = await fetch(`/api/workbooks/${id}/community/comments/${comment}`, { method:'DELETE', headers:{'X-Owner-Key':readOwnerKeys()[id] || ''}, signal });
      return {response, data:await response.json()};
    });
    if (!response.ok) throw Object.assign(new Error(data.error || ''), {definitive:response.status >= 400 && response.status < 500 && response.status !== 408});
    if (detailIsCurrent(id, version)) loadCommunity(id);
  } catch (error) {
    if (detailIsCurrent(id, version)) {
      if ($('public-detail-message')) $('public-detail-message').textContent = error.definitive ? localError(error.message, 'public.postFail') : t('public.commentDeleteUnknown');
      if (!error.definitive) loadCommunity(id);
    }
  } finally { deletingComments.delete(comment); }
}
async function sendCover(id, file) {
  if (!file) return;
  if (file.size > 2_000_000) throw new Error(t('public.coverBig'));
  let sent = false;
  try {
    await withPublicAttemptTimeout(async (signal, expired) => {
      for (let retry = 0; retry < 3; retry++) {
        if (expired()) throw new Error('Cover upload timed out');
        const revisionResponse = await fetch(`/api/workbooks/${id}/cover-revision`, { signal });
        const revision = await revisionResponse.json();
        if (expired()) throw new Error('Cover upload timed out');
        if (!revisionResponse.ok || !Number.isSafeInteger(revision.revision) || revision.revision < 0) throw Object.assign(new Error(revision.error || ''), { definitive:true });
        sent = true;
        const response = await fetch(`/api/workbooks/${id}/cover`, { method:'POST', headers:{'Content-Type':file.type || 'application/octet-stream', 'X-Owner-Key':readOwnerKeys()[id] || '', 'X-Cover-Revision':String(revision.revision)}, body:file, signal });
        const data = await response.json();
        if (expired()) throw new Error('Cover upload timed out');
        if (response.status === 409) { sent = false; continue; }
        if (!response.ok) throw Object.assign(new Error(data.error || ''), { definitive:response.status >= 400 && response.status < 500 && response.status !== 408 });
        return;
      }
      throw Object.assign(new Error(t('public.coverFail')), { definitive:true });
    });
  } catch (error) {
    if (sent && !error.definitive) error.coverUnknown = true;
    throw error;
  }
  coverVersions[id] = Math.max(Date.now(), (coverVersions[id] || 0) + 1);
}
const uploadCover = createCoverUploadQueue(sendCover);
async function changeCover(id, file) {
  if (!file) return;
  const message = $('public-detail-message'), version = detailVersion;
  try {
    await uploadCover(id, file);
    const book = shelf.books.find(entry => entry.id === id); if (book) book.hasCover = true;
    if (!detailIsCurrent(id, version)) return;
    const current = detailBook || book;
    if (current) current.hasCover = true;
    if ($('public-cover-box') && current) $('public-cover-box').innerHTML = coverHtml(current, ' large');
    if (message) message.textContent = t('public.coverSaved');
  } catch (error) { if (detailIsCurrent(id, version) && message) message.textContent = error.coverUnknown ? t('public.coverUnknown') : localError(error.message, 'public.coverFail'); }
}
function openShelfBook(event) {
  const target = event.target.closest?.('[data-book-id]') || event.target;
  const id = target.dataset?.bookId;
  if (!id || !BOOK_ID.test(id)) return;
  globalThis.history?.replaceState(null, '', `#book-${id}`); openPublicBook(id);
}
$('public-books')?.addEventListener('click', async event => {
  const removeId = event.target.dataset?.removeBook;
  if (removeId && /^[0-9a-f]{32}$/.test(removeId)) {
    if (!globalThis.confirm(t('public.removeConfirm'))) return;
    const key = readOwnerKeys()[removeId] || '';
    try {
      const { response, data } = await deletePublicBook(removeId, key);
      if (!response.ok) throw new Error(data.error || '');
      forgetOwnerKey(removeId, key);
      loadPublicBooks();
    } catch (error) { $('public-message').textContent = error.uncertain ? t('public.removeUnknown') : localError(error.message, 'public.removeFail'); }
    return;
  }
  openShelfBook(event);
});
// A cover that cannot be shown leaves the drawn one underneath.
$('public-books')?.addEventListener('error', event => { if (event.target?.tagName === 'IMG') event.target.remove(); }, true);
$('public-detail')?.addEventListener('error', event => { if (event.target?.tagName === 'IMG') event.target.remove(); }, true);
$('public-ranking')?.addEventListener('click', openShelfBook);
$('public-comments')?.addEventListener('click', openShelfBook);
$('public-search')?.addEventListener('input', () => { clearTimeout(shelfSearchTimer); ++publicRun; shelfPage = 1; shelfSearchTimer = setTimeout(loadPublicBooks, 200); });
$('public-sort')?.addEventListener('change', () => { clearTimeout(shelfSearchTimer); shelfPage = 1; loadPublicBooks(); });
$('public-prev')?.addEventListener('click', () => { if (shelfPage > 1) { shelfPage--; loadPublicBooks(); } });
$('public-next')?.addEventListener('click', () => { if (shelfPage * 24 < shelfTotal) { shelfPage++; loadPublicBooks(); } });
$('public-filters')?.addEventListener('click', event => {
  const button = event.target.closest?.('[data-category]'); if (!button) return;
  clearTimeout(shelfSearchTimer); shelfCategory = button.dataset.category; shelfPage = 1; renderFilters(); loadPublicBooks();
});
// Sharing a book with the library: a file uploaded here, or a book already on the shelf.
let sharing = false;
const shareSource = () => $('public-share-form')?.querySelector('[name="share-source"]:checked')?.value || 'file';
function showShareSource() {
  const fromFile = shareSource() === 'file';
  if ($('public-share-file-field')) $('public-share-file-field').hidden = !fromFile;
  if ($('public-share-lesson-field')) $('public-share-lesson-field').hidden = fromFile;
}
function showShareFile() {
  const file = $('public-share-file')?.files?.[0], label = $('public-share-file-name');
  if (label) label.textContent = file ? file.name : t('import.drop');
  $('public-share-file-field')?.classList.toggle('chosen', Boolean(file));
}
function showShareCover() {
  const file = $('public-share-cover')?.files?.[0], label = $('public-share-cover-name');
  if (label) label.textContent = file ? file.name : t('share.coverHint');
}
function openShareDialog(index = null) {
  const dialog = $('share-dialog'), form = $('public-share-form'), select = $('public-share-lesson');
  if (!dialog?.showModal || !form || !select) return false;
  if (dialog.open) return true;
  // Reset first: resetting the form afterwards would also reset the chosen book.
  form.reset();
  // Books from the library are already shared, unless the reader shares the one open now.
  const books = lessons.map((item, i) => ({ item, i })).filter(({ item, i }) => !item.notebook && (i === index || !BOOK_ID.test(item.publicId || '')));
  select.innerHTML = books.map(({ item, i }) => `<option value="${i}">${escapeHtml(item.title)}</option>`).join('');
  const preferred = Number.isInteger(index) ? index : books.findLast(({ item }) => item.custom)?.i;
  if (Number.isInteger(preferred) && books.some(({ i }) => i === preferred)) select.value = String(preferred);
  form.querySelector(`[name="share-source"][value="${Number.isInteger(index) ? 'shelf' : 'file'}"]`).checked = true;
  form.querySelector('[name="share-source"][value="shelf"]').disabled = !books.length;
  showShareSource(); showShareFile(); showShareCover();
  $('public-share-message').textContent = '';
  holdClock();
  dialog.showModal();
  (Number.isInteger(index) ? select : $('public-share-file'))?.focus?.();
  return true;
}
$('public-share')?.addEventListener('click', () => openShareDialog());
$('book-share')?.addEventListener('click', () => openShareDialog(Number($('preview-lesson').value)));
for (const id of ['public-share-cancel', 'public-share-close']) $(id)?.addEventListener('click', () => { if (!sharing) $('share-dialog').close(); });
$('share-dialog')?.addEventListener('cancel', event => { if (sharing) event.preventDefault(); });
$('public-share-form')?.addEventListener('change', event => {
  if (event.target.name === 'share-source') showShareSource();
  if (event.target.id === 'public-share-file') showShareFile();
  if (event.target.id === 'public-share-cover') showShareCover();
});
const shareDrop = $('public-share-file-field');
for (const type of ['dragenter', 'dragover']) shareDrop?.addEventListener(type, event => { event.preventDefault(); shareDrop.classList.add('dragging'); });
for (const type of ['dragleave', 'drop']) shareDrop?.addEventListener(type, () => shareDrop.classList.remove('dragging'));
shareDrop?.addEventListener('drop', event => {
  event.preventDefault();
  if (event.dataTransfer?.files?.length) { $('public-share-file').files = event.dataTransfer.files; showShareFile(); }
});
$('public-share-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (sharing) return;
  const fromFile = shareSource() === 'file', upload = fromFile ? $('public-share-file')?.files?.[0] : null;
  let item = fromFile ? null : lessons[Number($('public-share-lesson').value)];
  const message = $('public-share-message'), cover = $('public-share-cover')?.files?.[0];
  const category = event.target.querySelector('[name="share-category"]:checked')?.value || '';
  if (fromFile && !upload) { message.textContent = t('public.shareNoFile'); $('public-share-file')?.focus(); return; }
  if (!fromFile && !item) return;
  if (cover && cover.size > 2_000_000) { message.textContent = t('public.coverBig'); return; }
  const button = $('public-share-submit');
  sharing = true; if (button) button.disabled = true;
  try {
    if (upload) {
      // The uploaded book also goes on the sharer's own shelf.
      message.textContent = t('import.reading');
      try { ({ item } = await readLessonFile(upload)); }
      catch (error) { message.textContent = fileErrorMessage(error); return; }
      message.textContent = '';
      if (!saveCustom(item, 'public-share-message', false)) { if (!message.textContent) message.textContent = t('import.cancelled'); return; }
    }
    message.textContent = t('share.uploading');
    let data, canUnpublish;
    try { ({ data, canUnpublish } = await publishLesson(item, category)); }
    catch (error) { message.textContent = error.publicationId ? t('hint.publishUnknown', { id:error.publicationId }) : t('hint.publishFail', { error:localError(error.message, 'public.loadFail') }); return; }
    let note = t(canUnpublish ? 'public.shared' : 'notice.keyFail', { key:data.ownerKey });
    if (cover) { try { await uploadCover(data.id, cover); } catch (error) { note += ` ${error.coverUnknown ? t('public.coverUnknown') : localError(error.message, 'public.coverFail')}`; } }
    sharing = false;
    $('share-dialog').close();
    // The new book opens in the library, where everyone will find it.
    showView('public'); currentView = 'public';
    globalThis.history?.replaceState(null, '', `#book-${data.id}`);
    await openPublicBook(data.id);
    if ($('public-detail-message')) $('public-detail-message').textContent = note; else $('public-message').textContent = note;
  } finally { sharing = false; if (button) button.disabled = false; }
});
function readOwnerKeys() {
  try { const value = JSON.parse(storage?.getItem('lingtype-published-keys') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
function forgetOwnerKey(id, usedKey) {
  // Other publications may have completed while the delete was in flight.
  const current = readOwnerKeys();
  if (current[id] !== usedKey) return;
  delete current[id];
  try { storage.setItem('lingtype-published-keys', JSON.stringify(current)); } catch { /* already removed remotely */ }
}
async function deletePublicBook(id, key) {
  try {
    return await withPublicAttemptTimeout(async signal => {
      const response = await fetch(`/api/workbooks/${id}`, { method:'DELETE', headers:{'X-Owner-Key':key}, signal });
      return { response, data:await response.json() };
    });
  } catch { throw Object.assign(new Error('Removal response was not confirmed'), { uncertain:true }); }
}
$('unpublish-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('unpublish-message');
  const match = $('unpublish-id').value.trim().match(/(?:^|#book-)([0-9a-f]{32})$/);
  if (!match) { message.textContent = t('public.invalidId'); return; }
  if (!globalThis.confirm(t('public.removeConfirm'))) return;
  try {
    const ownerKeys = readOwnerKeys(), key = $('unpublish-key').value.trim() || ownerKeys[match[1]] || '';
    const { response, data } = await deletePublicBook(match[1], key);
    if (!response.ok) throw new Error(data.error || '');
    forgetOwnerKey(match[1], key);
    $('unpublish-key').value = ''; message.textContent = t('public.removed'); loadPublicBooks();
  } catch (error) { message.textContent = error.uncertain ? t('public.removeUnknown') : localError(error.message, 'public.removeFail'); }
});
// My bookshelf, each book's page, and reading from anywhere in a book.
function bookCover(item, size = '') {
  return coverHtml({ id:item.publicId || item.id, title:item.title, category:item.category || '', hasCover:BOOK_ID.test(item.publicId || '') }, size);
}
// A section lists its paragraphs a page at a time, starting with the page to continue from.
const TOC_PAGE = 200;
function tocParts(item, section, entry, target, from = null) {
  const parts = passageParts(section.source), read = new Set(entry?.read?.[section.value] || []);
  const start = Number.isInteger(from) ? Math.max(0, Math.min(from, parts.length - 1)) : target?.section === section.value ? Math.floor(target.index / TOC_PAGE) * TOC_PAGE : 0;
  const end = Math.min(parts.length, start + TOC_PAGE);
  const page = to => `<li><button type="button" class="btn-quiet toc-more" data-toc-section="${section.value}" data-toc-from="${to}">${escapeHtml(t('book.showParts', { from:to + 1, to:Math.min(parts.length, to + TOC_PAGE) }))}</button></li>`;
  const rows = parts.slice(start, end).map((part, offset) => {
    const index = start + offset, state = target?.section === section.value && target.index === index ? 'here' : read.has(index) ? 'read' : '';
    return `<li><button type="button" class="toc-part${state ? ` ${state}` : ''}" data-section="${section.value}" data-index="${index}"><span class="toc-n">${index + 1}</span><span class="toc-text">${escapeHtml(plainText(part, item.formulas))}</span>${state ? `<span class="toc-state">${escapeHtml(t(state === 'here' ? 'book.here' : 'book.read'))}</span>` : ''}</button></li>`;
  });
  return [start > 0 ? page(Math.max(0, start - TOC_PAGE)) : '', ...rows, end < parts.length ? page(end) : ''].join('');
}
function placeText(item, target) {
  const sections = readingSections(item), section = sections.find(candidate => candidate.value === target.section);
  return [sections.length > 1 ? section?.title : '', t('book.part', { n:target.index + 1 })].filter(Boolean).join(' · ');
}
function renderBookPage(item) {
  if (!item || !$('lesson-preview')) return;
  const entry = readReading(storage)[item.id], progress = bookProgress(item, entry), target = nextUnread(item, entry), sections = readingSections(item);
  if ($('book-cover')) $('book-cover').innerHTML = bookCover(item, ' large');
  if ($('book-eyebrow')) $('book-eyebrow').textContent = [categoryName(item.category || ''), item.edited ? t('lessonEdit.edited') : ''].filter(Boolean).join(' · ');
  if ($('choose-heading')) $('choose-heading').textContent = item.title;
  const meta = $('book-meta'), authors = (item.authors || []).filter(Boolean);
  if (meta) {
    meta.textContent = [authors.slice(0, 3).join(', ') + (authors.length > 3 ? ', …' : ''), item.source, item.license].filter(Boolean).join(' · ');
    if (/^https?:\/\/[^\s]+$/.test(item.sourceUrl || '')) {
      const link = document.createElement('a'); link.href = item.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = t('source.link');
      meta.append(...(meta.textContent ? [document.createTextNode(' · ')] : []), link);
    }
    meta.hidden = !meta.textContent;
  }
  if ($('book-progress')) $('book-progress').value = progress.percent;
  if ($('book-progress-text')) $('book-progress-text').textContent = t('book.progress', progress);
  if ($('book-where')) $('book-where').textContent = !entry ? t('book.notStarted') : target ? t('book.next', { place:placeText(item, target) }) : t('book.finished');
  const startLabel = $('preview-start-label') || $('preview-start');
  if (startLabel) startLabel.textContent = t(!entry ? 'book.start' : target ? 'book.continue' : 'book.again');
  // A finished book starts again from the main button.
  if ($('book-restart')) $('book-restart').hidden = !entry || !target;
  // Books that came from the library are already shared.
  if ($('book-share')) $('book-share').hidden = Boolean(item.notebook) || BOOK_ID.test(item.publicId || '');
  const words = $('book-words');
  if (words) { words.hidden = !item.words?.length || Boolean(item.notebook); words.textContent = t('book.words', { n:item.words?.length || 0 }); }
  const open = target?.section ?? sections[0]?.value;
  $('lesson-preview').innerHTML = sections.length === 1 ? `<ol class="toc-parts">${tocParts(item, sections[0], entry, target)}</ol>` : sections.map(section => {
    const count = passageParts(section.source).length, read = (entry?.read?.[section.value] || []).filter(index => index < count).length;
    return `<details class="toc-section" data-section="${section.value}"${section.value === open ? ' open' : ''}><summary><span class="toc-title">${escapeHtml(section.title)}</span><span class="toc-count${read === count ? ' done' : ''}">${read}／${count}</span></summary>${section.value === open ? `<ol class="toc-parts">${tocParts(item, section, entry, target)}</ol>` : ''}</details>`;
  }).join('');
}
function selectBook(index) {
  lessonSelect.value = String(index);
  if (activeSettings?.id === 'notebook' && !notebook.length && !lesson().notebook) syncNotebookLesson();
  updateSections(); pickerPage = 0;
}
function showReader() { showView('practice'); currentView = 'practice'; globalThis.history?.replaceState(null, '', '#practice'); }
function openBook(index) {
  if (lessons[index] && lessonPreview?.open(index) !== false) showReader();
}
// Read one section of a book from one of its paragraphs to the section's end.
function startReading(index, section, part, restore = true, passage = part > 0 ? 'from' : 'full') {
  if (!lessons[index] || !mayLeave() || !saveProgress()) return false;
  selectBook(index); mode = 'article';
  const sectionSelect = $('section-mode');
  sectionSelect.value = [...sectionSelect.options].some(option => option.value === section) ? section : sectionSelect.value;
  $('passage-mode').value = passage;
  loadPractice(restore, null, null, part > 0 || passage === 'random' ? part : null);
  lessonPreview?.close(); showReader();
  if (paused) resumePractice(); else $('typing')?.focus();
  return true;
}
// A book's main button: the reading already open carries on; otherwise the
// passage left unfinished, then the next unread paragraph.
function continueReading(index) {
  const item = lessons[index]; if (!item) return false;
  if (activeSettings?.id === item.id && !finished) { lessonPreview?.close(); return true; }
  const entry = readReading(storage)[item.id], scope = entry?.scope;
  if (scope && readingSections(item).some(section => section.value === scope.section)) {
    if (scope.passage === 'random' && Number.isInteger(scope.start) && item.custom) return startReading(index, scope.section, scope.start, true, 'random');
    const key = snapshotKey(item.id, 'article', scope.section, scope.passage, scope.passage === 'from' ? `from:${scope.start}` : null);
    if ((scope.passage === 'full' || scope.start > 0) && hasSnapshot(storage, key)) return startReading(index, scope.section, scope.passage === 'from' ? scope.start : 0);
  }
  const target = nextUnread(item, entry);
  if (target) return startReading(index, target.section, target.index);
  return startReading(index, readingSections(item)[0].value, 0, false);
}
function renderMyShelf() {
  const list = $('shelf-books'); if (!list) return;
  const reading = readReading(storage);
  // Books being read come first, the latest on top; then the reader's own books, newest first; then the samples.
  const books = lessons.map((item, index) => ({ item, index, entry:reading[item.id] })).filter(book => !book.item.notebook);
  const rank = book => book.entry ? 0 : book.item.custom ? 1 : 2;
  books.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? b.entry.time.localeCompare(a.entry.time) : rank(a) === 1 ? b.index - a.index : a.index - b.index));
  if ($('shelf-count')) $('shelf-count').textContent = String(books.length);
  list.innerHTML = books.map(({ item, index, entry }) => {
    const progress = bookProgress(item, entry);
    const status = !entry ? t('shelf.unread') : nextUnread(item, entry) ? t('shelf.progress', { n:progress.percent }) : t('shelf.finished');
    return `<li class="shelf-book"><button class="cover-button" type="button" data-lesson="${index}" tabindex="-1" aria-hidden="true">${bookCover(item)}</button><h3><button class="book" type="button" data-lesson="${index}">${escapeHtml(item.title)}</button></h3><p class="book-meta">${escapeHtml([categoryName(item.category || ''), status].filter(Boolean).join(' · '))}</p><progress max="100" value="${progress.percent}" aria-label="${escapeHtml(t('book.progressLabel'))}"></progress></li>`;
  }).join('');
  const box = $('shelf-continue'); if (!box) return;
  const recent = books.find(book => book.entry && nextUnread(book.item, book.entry));
  box.hidden = !recent;
  box.innerHTML = recent ? `<div class="continue-cover" aria-hidden="true">${bookCover(recent.item)}</div><div class="continue-info"><p class="eyebrow">${escapeHtml(t('shelf.continue'))}</p><h2>${escapeHtml(recent.item.title)}</h2><p class="muted">${escapeHtml(t('book.next', { place:placeText(recent.item, nextUnread(recent.item, recent.entry)) }))}</p><progress max="100" value="${bookProgress(recent.item, recent.entry).percent}" aria-label="${escapeHtml(t('book.progressLabel'))}"></progress></div><button class="btn primary" type="button" data-continue="${recent.index}">${escapeHtml(t('book.continue'))}</button>` : '';
}
// A link or typed address can open a shared book or any page, including the reader.
globalThis.addEventListener?.('hashchange', () => {
  const hash = globalThis.location?.hash.slice(1) || 'public';
  const match = /^book-([0-9a-f]{32})$/.exec(hash);
  if (match) openPublicBook(match[1]);
  else if (['public', 'shelf', 'notebook', 'history', 'practice', 'import'].includes(hash) && hash !== currentView) { showView(hash); enterView(hash); }
});
$('brand')?.addEventListener('click', event => { event.preventDefault(); $('nav-public')?.click(); });
let lastPractice;
try { lastPractice = JSON.parse(storage?.getItem('lingtype-last-practice') || 'null'); } catch { lastPractice = null; }
const lastIndex = lastPractice ? lessons.findIndex(item => item.id === lastPractice.id) : -1;
const lastWordScope = typeof lastPractice?.wordScope === 'string' && /^(?:retry|due):\d+:\d+:\d+$/.test(lastPractice.wordScope) ? lastPractice.wordScope : null;
if (lastIndex >= 0) {
  lessonSelect.value = String(lastIndex);
  const lastKey = snapshotKey(lastPractice.id, 'word', lastPractice.section || 'all', lastPractice.passage || 'full', lastWordScope);
  const savedWords = readSnapshot(storage, lastKey)?.retryWords;
  mode = lastPractice.mode === 'word' && (lessons[lastIndex].words?.length || savedWords?.length) ? 'word' : 'article';
}
updateSections();
if (lastIndex >= 0) { $('section-mode').value = lastPractice.section || 'all'; $('passage-mode').value = lastPractice.passage || 'full'; }
loadPractice(true, null, null, mode === 'article' && Number.isInteger(lastPractice?.passageIndex) ? lastPractice.passageIndex : null, mode === 'word' ? lastWordScope : null);
if ($('lesson-chooser')) {
  lessonPreview = setupLessonPreview({ select:$('preview-lesson'), start:$('preview-start'), back:$('preview-back'), preview:$('lesson-preview'), chooser:$('lesson-chooser'), practice:$('practice-content'), returnFocus:$('choose-lesson') }, () => lessons, continueReading,
    // Opening a book's page pauses the reading in progress; it is kept as it is.
    () => { holdClock(); return saveProgress(); }, () => document.createElement('option'), lessonLabel,
    { render:renderBookPage, onBack:() => $('nav-shelf')?.click(), focus:$('preview-start') });
  $('choose-lesson').addEventListener('click', () => lessonPreview.open(Number(lessonSelect.value)));
  lessonPreview.open(Number(lessonSelect.value), false, false);
}
$('lesson-preview')?.addEventListener('click', event => {
  const more = event.target.closest?.('[data-toc-from]');
  if (more) {
    const item = lessons[Number($('preview-lesson').value)], entry = readReading(storage)[item?.id];
    const section = readingSections(item).find(candidate => candidate.value === more.dataset.tocSection), list = more.closest('.toc-parts');
    if (section && list) { list.innerHTML = tocParts(item, section, entry, nextUnread(item, entry), Number(more.dataset.tocFrom)); list.querySelector('.toc-part')?.focus(); }
    return;
  }
  const part = event.target.closest?.('[data-index]');
  if (part) startReading(Number($('preview-lesson').value), part.dataset.section, Number(part.dataset.index));
});
// A section's paragraphs are listed when it is opened, so a long book's page stays light.
$('lesson-preview')?.addEventListener('toggle', event => {
  const section = event.target;
  if (!section.open || section.querySelector?.('.toc-parts')) return;
  const item = lessons[Number($('preview-lesson').value)];
  const entry = readReading(storage)[item?.id], value = section.dataset?.section;
  const found = readingSections(item).find(candidate => candidate.value === value);
  if (found) section.insertAdjacentHTML('beforeend', `<ol class="toc-parts">${tocParts(item, found, entry, nextUnread(item, entry))}</ol>`);
}, true);
$('book-restart')?.addEventListener('click', () => {
  const index = Number($('preview-lesson').value), first = readingSections(lessons[index])[0];
  if (first) startReading(index, first.value, 0, false);
});
$('book-words')?.addEventListener('click', () => {
  const index = Number($('preview-lesson').value);
  if (!lessons[index]?.words?.length || !mayLeave() || !saveProgress()) return;
  selectBook(index); mode = 'word'; $('passage-mode').value = 'full'; loadPractice();
  lessonPreview?.close(); showReader();
  if (paused) resumePractice(); else $('typing')?.focus();
});
$('book-cover')?.addEventListener('error', event => { if (event.target?.tagName === 'IMG') event.target.remove(); }, true);
for (const id of ['shelf-books', 'shelf-continue']) $(id)?.addEventListener('error', event => { if (event.target?.tagName === 'IMG') event.target.remove(); }, true);
$('shelf-books')?.addEventListener('click', event => {
  const book = event.target.closest?.('[data-lesson]');
  if (book) openBook(Number(book.dataset.lesson));
});
$('shelf-continue')?.addEventListener('click', event => {
  const index = Number(event.target.closest?.('[data-continue]')?.dataset.continue);
  if (Number.isInteger(index) && lessons[index]) { if (continueReading(index) !== false) showReader(); }
});
$('shelf-import')?.addEventListener('click', () => { showView('import'); currentView = 'import'; globalThis.history?.replaceState(null, '', '#import'); });
$('import-back')?.addEventListener('click', () => $('nav-shelf')?.click());
if (initialView === 'shelf') renderMyShelf();
renderHistory();
if (initialView === 'public') {
  const match = /^book-([0-9a-f]{32})$/.exec(initialHash);
  if (match) openPublicBook(match[1]); else loadPublicBooks();
}
