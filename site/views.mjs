// Pages listed in the navigation, and pages opened from one of them (a book
// being read, the import form) that keep their parent marked as current.
export function setupViews(get, onNavigate = () => {}, initial = 'practice', parents = {}) {
  const names = ['practice', 'import', 'history', 'public', 'notebook', 'shelf'].filter(name => get(`view-${name}`));
  if (!names.length) return () => {};
  function show(name) {
    // Each page opens at its top rather than at the scroll position of the page before it.
    globalThis.scrollTo?.(0, 0);
    for (const item of names) {
      get(`view-${item}`).hidden = item !== name;
      get(`nav-${item}`)?.setAttribute('aria-current', item === name || parents[name] === item ? 'page' : 'false');
    }
  }
  // The page changes first, so a page that fails to draw still opens.
  for (const name of names) get(`nav-${name}`)?.addEventListener('click', () => { show(name); onNavigate(name); });
  show(names.includes(initial) ? initial : names[0]);
  return show;
}
