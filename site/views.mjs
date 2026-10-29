export function setupViews(get, onNavigate = () => {}, initial = 'practice') {
  const names = ['practice', 'import', 'history'];
  if (get('nav-public') && get('view-public')) names.push('public');
  if (get('nav-notebook') && get('view-notebook')) names.push('notebook');
  if (names.some(name => !get(`nav-${name}`) || !get(`view-${name}`))) return () => {};
  function show(name) {
    // Each page opens at its top rather than at the scroll position of the page before it.
    globalThis.scrollTo?.(0, 0);
    for (const item of names) {
      get(`view-${item}`).hidden = item !== name;
      get(`nav-${item}`).setAttribute('aria-current', item === name ? 'page' : 'false');
    }
  }
  for (const name of names) get(`nav-${name}`).addEventListener('click', () => { onNavigate(name); show(name); });
  show(names.includes(initial) ? initial : 'practice');
  return show;
}
