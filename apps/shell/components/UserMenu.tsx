'use client';

// Signed-in identity + sign-out control. Reads the session from @intra/auth and
// shows a compact popover (name, email, tier, active modules, sign out). When
// signed out it renders a "Sign in" link instead.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@intra/ui';
import { useSession } from '@intra/auth';
import { MODULE_LIST } from '@intra/rbac';
import { cx } from '@shell/lib/cx';
import { resetDemoData } from '@shell/lib/demoData';
import { hasCapability, hasModuleAccess } from '@shell/lib/navigation';

function initials(nameOrEmail: string): string {
  const source = nameOrEmail.trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? source;
  const second = parts[1];
  if (second) {
    return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const { profile, userRoles, userCapabilities, signOut, loading, mode } =
    useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Hydration-safe: while the session restores, render an empty slot on both
  // server and first client render so React sees identical trees. Once loaded
  // we swap in either the signed-in avatar or the signed-out Sign-in link.
  if (loading) {
    return <div className="h-10 w-10" aria-hidden />;
  }

  if (!profile) {
    return (
      <Link href="/login" className="btn-primary btn-sm">
        <Icon name="lock" className="h-4 w-4" />
        Sign in
      </Link>
    );
  }

  const label = profile.name ?? profile.email;
  const access = { mode, userRoles, userCapabilities };
  const activeModules = MODULE_LIST.filter((module) =>
    hasModuleAccess(access, module),
  );
  const isAdmin = hasCapability(access, 'core', 'manage_rbac');

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    router.push('/login');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="grid h-11 w-11 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white shadow-e2 transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        {initials(label)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-30 w-64 animate-pop-in rounded-2xl border border-line bg-surface p-3 shadow-pop"
        >
          <div className="flex items-center gap-3 px-1 pb-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
              {initials(label)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{label}</p>
              <p className="truncate text-xs text-muted">{profile.email}</p>
            </div>
          </div>

          <div className="border-t border-line pt-2">
            <p className="px-1 text-[0.65rem] font-semibold uppercase tracking-wide text-faint">
              {profile.kind === 'vendor' ? 'External vendor' : 'Employee'}
              {profile.title ? ` · ${profile.title}` : ''}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1 px-1">
              {activeModules.length > 0 ? (
                activeModules.map((m) => (
                  <span
                    key={m}
                    className={cx('chip bg-inset capitalize text-muted')}
                  >
                    {m}
                  </span>
                ))
              ) : (
                <span className="text-xs text-faint">No module access</span>
              )}
            </div>
          </div>

          {isAdmin && (
            <Link
              href="/admin/users"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="btn-ghost mt-3 w-full justify-start"
            >
              <Icon name="list" className="h-4 w-4" />
              Manage users
            </Link>
          )}

          {mode === 'memory' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (
                  window.confirm(
                    'Reset all demo data? Every module goes back to the seeded dataset.',
                  )
                ) {
                  setOpen(false);
                  resetDemoData();
                }
              }}
              className={cx(
                'btn-ghost w-full justify-start',
                isAdmin ? 'mt-1' : 'mt-3',
              )}
            >
              <Icon name="rotate" className="h-4 w-4" />
              Reset demo data
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => void handleSignOut()}
            className={cx(
              'btn-ghost w-full justify-start',
              isAdmin || mode === 'memory' ? 'mt-1' : 'mt-3',
            )}
          >
            <Icon name="logout" className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
