'use client';

// Minimal light/dark theme hook for the shell (ported concept from the
// warehouse ThemeToggle — kept in the app, NOT in @intra/ui). Persists the
// choice to localStorage and toggles the `.dark` class on <html>; the no-flash
// bootstrap lives in <ThemeScript> so there is no first-paint flicker.

import { useCallback, useEffect, useState } from 'react';
import { THEME_STORAGE_KEY, type Theme } from '@shell/lib/theme';

function resolveInitialTheme(): Theme {
  if (typeof document !== 'undefined') {
    return document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light';
  }
  return 'light';
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>('light');

  // Sync to whatever <ThemeScript> already applied to <html> on the client.
  useEffect(() => {
    setTheme(resolveInitialTheme());
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      const root = document.documentElement;
      root.classList.toggle('dark', next === 'dark');
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage unavailable (private mode) — theme still applies for the session.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
