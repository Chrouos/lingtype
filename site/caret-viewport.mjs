// Return the scroll needed to keep the typing caret above a phone keyboard and
// below the sticky practice controls. Coordinates are in the layout viewport.
export function caretScrollOffset(box, viewport, headerHeight = 0) {
  if (!box || !viewport || viewport.height <= 0) return 0;
  const top = viewport.offsetTop || 0;
  const height = viewport.height;
  const safeTop = top + Math.min(Math.max(0, headerHeight) + 16, height - 32);
  const safeBottom = top + height - 16;
  if (box.top >= safeTop && box.bottom <= safeBottom) return 0;
  const target = Math.min(safeBottom - (box.bottom - box.top), Math.max(safeTop, top + height * 0.42));
  return box.top - target;
}
