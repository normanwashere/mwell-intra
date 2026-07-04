// No-flash theme bootstrap. Runs before paint to set the `.dark` class from the
// persisted choice (or the OS preference) so there is no light→dark flicker.
// Rendered in <head>; server component (no interactivity).

import { THEME_STORAGE_KEY } from '@shell/lib/theme';

export function ThemeScript() {
  const script = `(function(){try{var k=${JSON.stringify(
    THEME_STORAGE_KEY,
  )};var s=localStorage.getItem(k);var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
