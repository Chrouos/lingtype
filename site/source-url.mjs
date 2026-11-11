// Source links are displayed to readers, never fetched by the browser app.
export function safeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 500 || /\s/.test(value)) return '';
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
