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
  const { mode, userRoles, userCapabilities } = useSession();
  return mode === 'supabase'
    ? userCapabilities?.[module]?.includes(cap) === true
    : can(userRoles, module, cap);
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
  const { loading, mode, userRoles, roleCapabilities } = useSession();
  const allowed = useCan(module, cap);
  const moduleAssigned = (userRoles[module]?.length ?? 0) > 0;
  const certificationRequired =
    mode === "supabase" &&
    roleCapabilities?.[module]?.includes(cap) === true;
  // While the session is restoring (memory: sessionStorage read; supabase:
  // getSession) render nothing rather than briefly flashing "Access denied".
  if (loading) return null;
  if (allowed) return <>{children}</>;
  return (
    <>
      {fallback !== undefined ? (
        fallback
      ) : (
        <AccessDenied
          moduleAssigned={moduleAssigned}
          certificationRequired={certificationRequired}
        />
      )}
    </>
  );
}

function AccessDenied({
  moduleAssigned,
  certificationRequired,
}: {
  moduleAssigned: boolean;
  certificationRequired: boolean;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="intra-access-denied grid place-items-center gap-3 rounded-2xl border border-black/10 bg-black/[0.02] p-6 text-center dark:border-white/10 dark:bg-white/[0.03]"
    >
      <h1 className="text-lg font-semibold">Access denied for this page</h1>
      <h2 className="font-semibold">
        {certificationRequired
          ? "Certification required"
          : moduleAssigned
            ? "Action access not assigned"
            : "Module access not assigned"}
      </h2>
      <p className="max-w-sm text-sm opacity-70">
        {certificationRequired
          ? "Complete the required onboarding and guided practice before using this action."
          : moduleAssigned
            ? "Your account can open this module, but this action is not assigned to your role. Contact your administrator if your responsibilities changed."
            : "This module is not assigned to your account. Contact your administrator if you need access."}
      </p>
      {certificationRequired && (
        <a href="/onboarding" className="btn-primary min-h-11">
          Open onboarding
        </a>
      )}
      <a
        href="/"
        className={
          certificationRequired ? "btn-secondary min-h-11" : "btn-primary min-h-11"
        }
      >
        Back to dashboard
      </a>
    </div>
  );
}
