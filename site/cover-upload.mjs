// Preserve selection order for each book while letting different books upload
// independently. A failed upload must not prevent the next choice from running.
export function createCoverUploadQueue(upload) {
  const pending = new Map();
  return (bookId, file) => {
    const previous = pending.get(bookId) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => upload(bookId, file));
    pending.set(bookId, current);
    return current.finally(() => { if (pending.get(bookId) === current) pending.delete(bookId); });
  };
}
