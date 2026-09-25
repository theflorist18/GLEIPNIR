// Colour theme (Claude Design screen 05): follows prefers-color-scheme unless
// the viewer picks light or dark, which sets [data-theme] on <html>. The choice
// is a per-viewer convenience in localStorage — missing storage just means
// "system".
export type Theme = 'system' | 'light' | 'dark';
const KEY = 'gleipnir.theme';

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme): void {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch { /* storage unavailable — the choice lasts for this page only */ }
}
