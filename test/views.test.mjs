import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupViews } from '../site/views.mjs';

test('workspace navigation shows only the selected view and updates its current state', () => {
  const nodes = new Map();
  class Node extends EventTarget {
    constructor() { super(); this.hidden = false; this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  for (const id of ['practice','import','history']) { nodes.set(`view-${id}`, new Node()); nodes.set(`nav-${id}`, new Node()); }
  const changes = [];
  setupViews(id => nodes.get(id), name => changes.push(name));
  nodes.get('nav-import').dispatchEvent(new Event('click'));
  assert.equal(nodes.get('view-practice').hidden, true);
  assert.equal(nodes.get('view-import').hidden, false);
  assert.equal(nodes.get('view-history').hidden, true);
  assert.equal(nodes.get('nav-import').attributes['aria-current'], 'page');
  assert.deepEqual(changes, ['import']);
  nodes.get('nav-practice').dispatchEvent(new Event('click'));
  assert.equal(nodes.get('view-practice').hidden, false);
  setupViews(id => nodes.get(id), () => {}, 'history');
  assert.equal(nodes.get('view-history').hidden, false);
});
