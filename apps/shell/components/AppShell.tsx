'use client';

// Suite chrome (spec §1, adapted from the warehouse AppShell to the scoped
// multi-module model). Desktop sidebar + top bar + mobile bottom nav that list
// ONLY the modules the signed-in user can access (any role in the module).

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@intra/ui';
import { useSession } from '@intra/auth';
import {
  accessibleModules,
  VENDOR_NAV,
  type ModuleNav,
} from '@shell/lib/navigation';
import { cx } from '@shell/lib/cx';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface NavEntry {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
}

const HOME_ENTRY: NavEntry = { href: '/', label: 'Home', icon: 'grid' };

function toEntry(item: ModuleNav): NavEntry {
  return { href: item.href, label: item.label, icon: item.icon };
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, userRoles, mode, loading } = useSession();
  const pathname = usePathname() ?? '/';

  const modules = accessibleModules(userRoles);
  const entries: NavEntry[] = [HOME_ENTRY, ...modules.map(toEntry)];
  if (profile?.kind === 'vendor') {
    entries.push({
      href: VENDOR_NAV.href,
      label: VENDOR_NAV.label,
      icon: VENDOR_NAV.icon,
    });
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-app md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col bg-brand-grad text-white md:flex lg:w-64">
        <div className="safe-top flex items-center gap-2 px-5 py-5">
          <BrandMark />
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Primary">
          {entries.map((e) => (
            <Link
              key={e.href}
              href={e.href}
              aria-current={isActive(e.href) ? 'page' : undefined}
              className={cx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive(e.href)
                  ? 'bg-white/15 text-white shadow-soft'
                  : 'text-brand-100/80 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon name={e.icon} />
              {e.label}
            </Link>
          ))}
        </nav>
        <div className="safe-bottom border-t border-white/10 px-5 py-4">
          {profile ? (
            <>
              <p className="truncate text-sm font-semibold text-white">
                {profile.name ?? profile.email}
              </p>
              <p className="mt-0.5 truncate text-xs text-brand-100/70">
                {profile.title ??
                  (profile.kind === 'vendor' ? 'Vendor portal' : 'Employee')}
              </p>
            </>
          ) : (
            <Link
              href="/login"
              className="text-xs font-medium text-brand-100/80 underline-offset-2 hover:text-white hover:underline"
            >
              Sign in to get started
            </Link>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="safe-top sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2 md:hidden">
              <BrandMark compact />
            </div>
            <h1 className="hidden font-display text-lg font-bold text-ink md:block">
              Intra <span className="text-faint">|</span> Suite
            </h1>
            <div className="flex items-center gap-1.5">
              <span
                className={cx(
                  'chip',
                  mode === 'supabase'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
                )}
                title={
                  mode === 'supabase'
                    ? 'Connected to Supabase'
                    : 'Demo data (no backend configured)'
                }
              >
                {mode === 'supabase' ? 'Live' : 'Demo'}
              </span>
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-10 xl:max-w-6xl">
          {loading ? (
            <div
              className="grid place-items-center py-24 text-muted"
              role="status"
              aria-live="polite"
            >
              <Icon name="rotate" className="h-6 w-6 animate-spin" />
              <span className="mt-2 text-sm">Restoring your session…</span>
            </div>
          ) : (
            <div key={pathname} className="animate-fade-in">
              {children}
            </div>
          )}
        </main>

        {/* Mobile bottom navigation */}
        <nav
          className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur md:hidden"
          aria-label="Primary mobile"
        >
          <ul className="flex">
            {entries.slice(0, 5).map((e) => (
              <li key={e.href} className="flex-1">
                <Link
                  href={e.href}
                  aria-current={isActive(e.href) ? 'page' : undefined}
                  className={cx(
                    'flex flex-col items-center gap-0.5 px-2 py-2.5 text-[0.65rem] font-medium transition',
                    isActive(e.href)
                      ? 'text-brand-600 dark:text-brand-300'
                      : 'text-faint',
                  )}
                >
                  <span
                    className={cx(
                      'grid h-7 w-12 place-items-center rounded-full transition',
                      isActive(e.href) && 'bg-brand-500/10',
                    )}
                  >
                    <Icon name={e.icon} className="h-5 w-5" />
                  </span>
                  <span className="truncate">{e.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={cx(
          'font-display font-extrabold tracking-tight',
          compact ? 'text-lg text-ink' : 'text-xl text-white',
        )}
      >
        m<span className={compact ? 'brand-gradient' : 'text-brand-200'}>well</span>
      </span>
      <span
        className={cx(
          'text-xs font-semibold',
          compact ? 'text-faint' : 'text-brand-100/70',
        )}
      >
        Intra
      </span>
    </span>
  );
}
