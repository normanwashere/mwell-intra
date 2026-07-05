import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';

/**
 * SINGLE theme source of truth across the suite (SH-8).
 *
 * Contract: the shell owns the key — `THEME_STORAGE_KEY = 'intra-theme'` in
 * `apps/shell/lib/theme.ts` — and boots it before paint via <ThemeScript>.
 * The warehouse module cannot import shell code, so it reads/writes the SAME
 * localStorage key by value and mirrors the `.dark` class on <html>. A
 * `storage` listener keeps the module in sync when the theme is toggled from
 * shell chrome in another tab/window.
 */
export const THEME_KEY = 'intra-theme';
/** Pre-unification key; migrated (read once) so users keep their choice. */
const LEGACY_THEME_KEY = 'mwell-intra-warehouse:theme';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  // The shell's <ThemeScript> has already applied the class before paint —
  // trust the DOM first so both surfaces always agree.
  if (document.documentElement.classList.contains('dark')) return 'dark';
  const stored = (window.localStorage.getItem(THEME_KEY) ??
    window.localStorage.getItem(LEGACY_THEME_KEY)) as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#06101c' : '#ffffff');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(THEME_KEY, t);
      // Retire the legacy key so nothing re-reads a stale value.
      window.localStorage.removeItem(LEGACY_THEME_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Cross-tab sync: honor a shell-side toggle without a reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      if (e.newValue === 'light' || e.newValue === 'dark') {
        setThemeState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
