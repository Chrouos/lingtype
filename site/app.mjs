import { lessons } from './data.mjs';
import { wordEdit, articleResult } from './typing.mjs';

const $ = (id) => document.getElementById(id);
const lessonSelect = $('lesson'), language = $('language'), exercise = $('exercise'), result = $('result');
let mode = 'word', wordIndex = 0, errors = 0, started = null, finished = false, input = '';
lessons.forEach((lesson, i) => { const option = document.createElement('option'); option.value = i; option.textContent = lesson.title; lessonSelect.append(option); });
const lesson = () => lessons[Number(lessonSelect.value)];
const languageIndex = () => ({ zh: 1, ja: 2, ko: 3 })[language.value];
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const elapsed = () => started === null ? 0 : performance.now() - started;
const formatTime = (ms) => { const sec = Math.floor(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
function restart() { wordIndex = 0; errors = 0; started = null; finished = false; input = ''; result.hidden = true; exercise.hidden = false; render(); }
function setMode(value) { mode = value; $('word-mode').classList.toggle('active', mode === 'word'); $('article-mode').classList.toggle('active', mode === 'article'); restart(); }
function render() {
  const item = lesson(); $('category').textContent = `${item.category.toUpperCase()}  /  ${item.title.toUpperCase()}`;
  $('progress').textContent = mode === 'word' ? `${String(wordIndex + 1).padStart(2,'0')} / ${String(item.words.length).padStart(2,'0')} WORDS` : 'ARTICLE PRACTICE';
  $('hint').textContent = mode === 'word' ? '開始輸入，即開始計時 · 打錯從頭再來' : '開始輸入，即開始計時 · 可用 Backspace 修正';
  if (mode === 'word') {
    const word = item.words[wordIndex];
    exercise.innerHTML = `<h2>${escapeHtml(word[0])}</h2><p class="translation">${escapeHtml(word[languageIndex()])}</p><input class="word-input" id="typing" aria-label="輸入英文單字" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="開始輸入..." value="${escapeHtml(input)}"><div class="error-note" aria-live="polite"></div>`;
    $('typing').addEventListener('input', onWord);
  } else {
    exercise.innerHTML = `<div class="article-text" id="article-text"></div><div class="article-translation">${escapeHtml(item.translations[language.value])}</div><textarea id="typing" class="article-input" aria-label="輸入英文文章" placeholder="在這裡開始輸入英文..." autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>`;
    $('typing').value = input; $('typing').addEventListener('input', onArticle); paintArticle();
  }
}
function onWord(e) {
  if (finished) return;
  const next = e.target.value;
  if (next && started === null) started = performance.now();
  const state = wordEdit(lesson().words[wordIndex][0], next);
  input = state.input;
  if (state.error) { errors++; e.target.value = ''; exercise.querySelector('.error-note').textContent = '打錯了，從這個單字重新開始'; return; }
  if (state.complete) { wordIndex++; input = ''; if (wordIndex === lesson().words.length) return finish(); render(); $('typing').focus(); return; }
  e.target.value = input; exercise.querySelector('.error-note').textContent = '';
}
function paintArticle() {
  $('article-text').innerHTML = [...lesson().text].map((c,i) => `<span class="${i < input.length ? (input[i] === c ? 'correct' : 'incorrect') : ''} ${i === input.length ? 'cursor' : ''}">${escapeHtml(c)}</span>`).join('');
}
function onArticle(e) {
  if (finished) return;
  input = e.target.value.slice(0, lesson().text.length); e.target.value = input;
  if (input.length && started === null) started = performance.now();
  paintArticle();
  if (input.length === lesson().text.length) finish();
}
function finish() {
  finished = true; const time = elapsed(); exercise.hidden = true; result.hidden = false;
  const stats = mode === 'word' ? [['時間',formatTime(time)],['單字',lesson().words.length],['錯誤',errors]] : (() => { const r = articleResult(lesson().text, input, time); return [['WPM',r.wpm],['正確率',`${r.accuracy}%`],['時間',formatTime(time)]]; })();
  result.innerHTML = `<div class="result-label">PRACTICE COMPLETE ✳</div><div class="result-title">完成這次練習</div><div class="stats">${stats.map(([label,value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')}</div><button class="primary" id="next-action">${mode === 'word' ? '接著練習文章 →' : '再練一次 ↻'}</button>`;
  $('progress').textContent = 'COMPLETE'; $('next-action').addEventListener('click', () => mode === 'word' ? setMode('article') : restart());
}
$('word-mode').addEventListener('click', () => setMode('word'));
$('article-mode').addEventListener('click', () => setMode('article'));
$('restart').addEventListener('click', restart);
lessonSelect.addEventListener('change', restart);
language.addEventListener('change', () => { if (!finished) { render(); $('typing').focus(); } });
render();
