'use client';

// Routes that ship their own chrome (sidebar, nav) render full-screen without
// the suite AppShell wrapper to avoid double sidebars.

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from './AppShell';

// Modules that render their own chrome (react-router + AppShell inside the
// mounted module OR intentional own-chrome route like /vendor / /login).
// Only add here if the route MUST NOT have the suite sidebar/top-bar.
//
// - /warehouse — has its own AppShell inside (LLD §13); nested here to avoid
//   double sidebars.
// - /vendor    — external vendor tier ships its own thin brand chrome.
// - /login     — sign-in card should stand alone (no distracting shell nav).
// - /~offline  — service-worker fallback; standalone.
//
// PROCUREMENT + LEGAL used to be chromeless too, which stranded users with
// no sign-out or Home link. They now render INSIDE the shell chrome so every
// signed-in user gets consistent navigation.
const CHROMELESS_PREFIXES = [
  '/warehouse',
  '/vendor',
  '/login',
  '/reset-password',
  '/~offline',
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
