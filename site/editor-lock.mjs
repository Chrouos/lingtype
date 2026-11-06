export async function acquireEditorLock(locks) {
  if (!locks?.request) return { acquired:true, protected:false, release:async () => {} };
  let notify, release;
  const ready = new Promise(resolve => { notify = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const request = locks.request('lingtype-editor', {ifAvailable:true}, async lock => {
    if (!lock) { notify(false); return; }
    notify(true);
    await hold;
  });
  request.catch(() => notify(false));
  const acquired = await ready;
  return { acquired, protected:true, release:async () => { release(); await request; } };
}
