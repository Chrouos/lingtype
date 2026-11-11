import { plainText } from './paper.mjs';

// A book's page, shown in place of the reader until reading starts.
// `render` draws the chosen book (otherwise its text is shown), `onBack`
// leaves the page, and `focus` receives keyboard focus when it opens.
export function setupLessonPreview({ select, start, back, preview, chooser, practice, returnFocus, startFocus }, getLessons, onStart, canOpen, createOption, label = item => item.title, { render:renderBook = null, onBack = null, focus = null } = {}) {
  function render() {
    const index = Number(select.value), item = getLessons()[index];
    if (renderBook) renderBook(item, index);
    else preview.textContent = plainText(item?.text || '', item?.formulas);
  }
  function open(index, cancellable = true, moveFocus = true) {
    if (cancellable && !canOpen()) return false;
    select.innerHTML = '';
    getLessons().forEach((item, i) => { const option = createOption(); option.value = String(i); option.textContent = label(item); select.append(option); });
    select.value = String(index);
    back.hidden = !cancellable && !onBack;
    render();
    chooser.hidden = false;
    practice.hidden = true;
    if (moveFocus) (focus || select).focus?.();
    return true;
  }
  function close() { chooser.hidden = true; practice.hidden = false; }
  select.addEventListener('change', render);
  start.addEventListener('click', () => { const index = Number(select.value); close(); onStart(index); startFocus?.focus?.(); });
  back.addEventListener('click', () => { if (onBack) { onBack(); return; } close(); returnFocus?.focus?.(); });
  return { open, close, render, isOpen:() => !chooser.hidden };
}
