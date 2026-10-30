import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupLessonPreview } from '../site/lesson-preview.mjs';

test('a lesson can be previewed before starting practice', () => {
  const lessons = [{ title:'First', text:'First article.' }, { title:'Second', text:'Second article.' }];
  const select = new EventTarget(); select.value = '0'; select.append = function(option) { (this.options ||= []).push(option); };
  const start = new EventTarget(), back = new EventTarget();
  const elements = { select, start, back, preview:{}, chooser:{ hidden:true }, practice:{ hidden:false } };
  let chosen = null;
  const preview = setupLessonPreview(elements, () => lessons, i => { chosen = i; }, () => true, () => ({}));
  preview.open(0);
  assert.equal(elements.practice.hidden, true);
  assert.equal(elements.preview.textContent, 'First article.');
  select.value = '1'; select.dispatchEvent(new Event('change'));
  assert.equal(elements.preview.textContent, 'Second article.');
  assert.equal(chosen, null);
  start.dispatchEvent(new Event('click'));
  assert.equal(chosen, 1);
  assert.equal(elements.chooser.hidden, true);
  assert.equal(elements.practice.hidden, false);
});
