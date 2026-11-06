import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, readBackup, restoreBackup } from '../site/backup.mjs';

function memory(initial = {}) {
  const values = {...initial};
  return { values, getItem:k => values[k] ?? null, setItem(k,v) { values[k] = v; }, removeItem(k) { delete values[k]; } };
}

test('backup and restore include lessons, translations, notebook and progress', async () => {
  const source = memory({'lingtype-custom-lessons':'[{"id":"a","custom":true,"title":"Hello","text":"Hello.","words":[],"translations":{}}]', 'lingtype-translations':'{"zh\\u0000Hello.":"你好。"}', 'lingtype-notebook':'[]', 'lingtype-progress':'{"one":{"input":"H"}}'});
  const data = readBackup(JSON.stringify(createBackup(source)));
  const destination = memory({'lingtype-notebook':'[{"word":"old"}]'});
  await restoreBackup(destination, data);
  for (const [key, value] of Object.entries(source.values)) assert.equal(destination.getItem(key), value);
});

test('rejects invalid backups before changing any data', async () => {
  const destination = memory({'lingtype-notebook':'[]'});
  assert.throws(() => readBackup(JSON.stringify({format:'lingtype-backup', version:1, data:{'lingtype-notebook':'not json'}})));
  assert.throws(() => readBackup(JSON.stringify({format:'lingtype-backup', version:1, data:{'foreign-key':'[]'}})));
  assert.throws(() => readBackup(JSON.stringify({format:'lingtype-backup', version:1, data:{'lingtype-custom-lessons':'[{"text":"hello"}]'}})));
  assert.deepEqual(destination.values, {'lingtype-notebook':'[]'});
});

test('restore rolls back previous values if a write fails', async () => {
  const destination = memory({'lingtype-language':'zh', 'lingtype-notebook':'[]'});
  const set = destination.setItem;
  let failed = false;
  destination.setItem = (key,value) => { if (key === 'lingtype-notebook' && !failed) { failed = true; throw Error('quota'); } set(key,value); };
  const data = readBackup(JSON.stringify({format:'lingtype-backup',version:1,data:{'lingtype-language':'ja','lingtype-notebook':'[{"word":"new","sentences":[],"translations":{}}]'}}));
  await assert.rejects(restoreBackup(destination, data));
  assert.deepEqual(destination.values, {'lingtype-language':'zh', 'lingtype-notebook':'[]'});
});
