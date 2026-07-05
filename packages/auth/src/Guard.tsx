'use client';

// <Guard module cap> — client-side capability gate (spec §5, LLD §9).
//
// Generalization of the warehouse `<Guard anyOf>` to the scoped, per-module
// RBAC. This is a UX gate ONLY: the authoritative check is the server RPC /
// RLS `core.has_cap()` reading `core.user_roles` (spec §6.2). Never rely on
// this to protect data — it only decides what to render.

import type { ReactNode } from 'react';
import type { Module } from '@intra/rbac';
import { can, type CapabilityFor } from '@intra/rbac';
import { useSession } from './SessionProvider';

/**
 * Does the current session hold ANY role in `module` granting `cap`? Scoped
 * per module — roles in other modules are irrelevant (spec §4.2).
 */
export function useCan<M extends Module>(
  module: M,
  cap: CapabilityFor<M>,
): boolean {
  const { userRoles } = useSession();
  return can(userRoles, module, cap);
}

export interface GuardProps<M extends Module> {
  /** The module the capability belongs to. */
  module: M;
  /** The capability required to view `children`. */
  cap: CapabilityFor<M>;
  /** Rendered when allowed. */
  children: ReactNode;
  /** Rendered when denied (default: an accessible "Access denied" block). */
  fallback?: ReactNode;
}

/**
 * Renders `children` only when the session can perform `cap` in `module`;
 * otherwise renders `fallback` (or a friendly, accessible access-denied block —
 * never a blank redirect, mirroring the warehouse `<Guard>` intent).
 */
export function Guard<M extends Module>({
  module,
  cap,
  children,
  fallback,
}: GuardProps<M>) {
  const { loading } = useSession();
  const allowed = useCan(module, cap);
  // While the session is restoring (memory: sessionStorage read; supabase:
  // getSession) render nothing rather than briefly flashing "Access denied".
  if (loading) return null;
  if (allowed) return <>{children}</>;
  return <>{fallback ?? <AccessDenied />}</>;
}

function AccessDenied() {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="intra-access-denied grid place-items-center gap-3 rounded-2xl border border-black/10 bg-black/[0.02] p-6 text-center dark:border-white/10 dark:bg-white/[0.03]"
    >
      <h2 className="text-base font-semibold">Access denied</h2>
      <p className="max-w-sm text-sm opacity-70">
        This isn&apos;t part of your role. Head back to your dashboard to pick
        something you can access, or contact your administrator.
      </p>
      <a
        href="/"
        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-black/85 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40 dark:bg-white/90 dark:text-black dark:hover:bg-white dark:focus-visible:ring-white/40"
      >
        Back to dashboard
      </a>
    </div>
  );
}
