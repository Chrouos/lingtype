// Animated icons from PulsoIcon (site/vendor/pulsoicon). An element with
// data-icon="name" receives that icon; it moves when the button or link it is
// in is pointed at or focused, and stays still when less motion is preferred.
import { iconFrame, frameMarkup } from './vendor/pulsoicon/frame.js';
import { ArrowLeft } from './vendor/pulsoicon/icons/arrow-left.js';
import { BookOpen } from './vendor/pulsoicon/icons/book-open.js';
import { BookPlus } from './vendor/pulsoicon/icons/book-plus.js';
import { ChartLine } from './vendor/pulsoicon/icons/chart-line.js';
import { Library } from './vendor/pulsoicon/icons/library.js';
import { NotebookPen } from './vendor/pulsoicon/icons/notebook-pen.js';
import { Play } from './vendor/pulsoicon/icons/play.js';
import { Share2 } from './vendor/pulsoicon/icons/share-2.js';
import { TableOfContents } from './vendor/pulsoicon/icons/table-of-contents.js';
import { Upload } from './vendor/pulsoicon/icons/upload.js';
import { X } from './vendor/pulsoicon/icons/x.js';

const ICONS = { 'arrow-left':ArrowLeft, 'book-open':BookOpen, 'book-plus':BookPlus, 'chart-line':ChartLine, library:Library, 'notebook-pen':NotebookPen, play:Play, 'share-2':Share2, 'table-of-contents':TableOfContents, upload:Upload, x:X };

export function iconMarkup(name, size = 16) {
  const data = ICONS[name];
  return data ? frameMarkup(iconFrame(data, { size, strokeWidth:1.75 })) : '';
}

export async function mountIcons(root) {
  if (typeof root?.querySelectorAll !== 'function') return;
  const placed = [];
  for (const slot of root.querySelectorAll('[data-icon]:not([data-icon-ready])')) {
    const data = ICONS[slot.dataset.icon];
    if (!data) continue;
    const frame = iconFrame(data, { size:Number(slot.dataset.iconSize) || 16, strokeWidth:1.75 });
    slot.innerHTML = frameMarkup(frame);
    slot.dataset.iconReady = '';
    placed.push([slot.firstElementChild, frame]);
  }
  if (!placed.length) return;
  // The icons are drawn already; without the motion library they simply stay still.
  let playIcon;
  try { ({ playIcon } = await import('./vendor/pulsoicon/dom.js')); } catch { return; }
  for (const [svg, frame] of placed) { try { playIcon(svg, frame); } catch { /* a still icon */ } }
}
