export const BACKUP_KEYS = ['lingtype-custom-lessons','lingtype-custom-lesson','lingtype-translations','lingtype-notebook','lingtype-builtin-words','lingtype-progress','lingtype-practice-history','lingtype-best-results','lingtype-last-practice','lingtype-language','lingtype-published-keys'];
const arrays = new Set(['lingtype-custom-lessons','lingtype-notebook','lingtype-practice-history']);

export function createBackup(storage) {
  const data = {};
  for (const key of BACKUP_KEYS) {
    const value = storage?.getItem(key);
    if (value !== null && value !== undefined) data[key] = value;
  }
  return {format:'lingtype-backup', version:1, data};
}

export function readBackup(json) {
  if (typeof json !== 'string' || json.length > 50_000_000) throw new Error('Invalid backup');
  const file = JSON.parse(json);
  if (!file || file.format !== 'lingtype-backup' || file.version !== 1 || !file.data || typeof file.data !== 'object' || Array.isArray(file.data)) throw new Error('Invalid backup');
  for (const [key, value] of Object.entries(file.data)) {
    if (!BACKUP_KEYS.includes(key) || typeof value !== 'string') throw new Error('Invalid backup');
    if (key === 'lingtype-language') { if (!['zh','ja','ko'].includes(value)) throw new Error('Invalid backup'); continue; }
    const parsed = JSON.parse(value);
    if (arrays.has(key) ? !Array.isArray(parsed) : (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('Invalid backup');
    if (key === 'lingtype-custom-lessons' && parsed.some(item => !item || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.text !== 'string' || !Array.isArray(item.words))) throw new Error('Invalid backup');
    if (key === 'lingtype-notebook' && parsed.some(item => !item || typeof item.word !== 'string' || !Array.isArray(item.sentences) || !item.translations || typeof item.translations !== 'object')) throw new Error('Invalid backup');
  }
  return file.data;
}

export async function restoreBackup(storage, data) {
  const before = createBackup(storage).data;
  const write = values => {
    for (const key of BACKUP_KEYS) {
      if (Object.hasOwn(values, key)) storage.setItem(key, values[key]);
      else storage.removeItem(key);
    }
  };
  try {
    write(data);
    await storage.flush?.();
  } catch (error) {
    try { write(before); await storage.flush?.(); } catch { throw new Error('Restore failed; rollback also failed', {cause:error}); }
    throw error;
  }
}
