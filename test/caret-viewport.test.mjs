import test from 'node:test';
import assert from 'node:assert/strict';
import { caretScrollOffset } from '../site/caret-viewport.mjs';

test('keeps a caret above the soft keyboard and below sticky controls', () => {
  const viewport = { offsetTop:0, height:400 };
  assert.equal(caretScrollOffset({ top:250, bottom:275 }, viewport, 180), 0);
  const down = caretScrollOffset({ top:410, bottom:435 }, viewport, 180);
  assert.ok(410 - down >= 196);
  assert.ok(435 - down <= 384);
  const up = caretScrollOffset({ top:100, bottom:125 }, viewport, 180);
  assert.ok(100 - up >= 196);
});

test('uses the visual viewport offset when the keyboard or zoom pans it', () => {
  const viewport = { offsetTop:120, height:350 };
  const offset = caretScrollOffset({ top:500, bottom:525 }, viewport, 150);
  assert.ok(500 - offset >= 286);
  assert.ok(525 - offset <= 454);
  assert.equal(caretScrollOffset(null, viewport, 150), 0);
});
