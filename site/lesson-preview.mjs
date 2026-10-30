export function setupLessonPreview({ select, start, back, preview, chooser, practice }, getLessons, onStart, canOpen, createOption) {
  function render() {
    const item = getLessons()[Number(select.value)];
    preview.textContent = item?.text || '';
  }
  function open(index, cancellable = true) {
    if (cancellable && !canOpen()) return;
    select.innerHTML = '';
    getLessons().forEach((item, i) => { const option = createOption(); option.value = String(i); option.textContent = item.title; select.append(option); });
    select.value = String(index);
    back.hidden = !cancellable;
    render();
    chooser.hidden = false;
    practice.hidden = true;
  }
  function close() { chooser.hidden = true; practice.hidden = false; }
  select.addEventListener('change', render);
  start.addEventListener('click', () => { const index = Number(select.value); close(); onStart(index); });
  back.addEventListener('click', close);
  return { open, close };
}
