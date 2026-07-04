'use client';

// Routes that ship their own chrome (sidebar, nav) render full-screen without
// the suite AppShell wrapper to avoid double sidebars.

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from './AppShell';

// Modules that render their own chrome (react-router + AppShell inside the
// mounted module). Keep in sync with the shell's catch-all route mounts.
const CHROMELESS_PREFIXES = [
  '/warehouse',
  '/procurement',
  '/legal',
  '/vendor',
] as const;

function isChromelessPath(pathname: string): boolean {
  return CHROMELESS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function ChromeGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';

  if (isChromelessPath(pathname)) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}
