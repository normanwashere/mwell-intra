'use client';

// Session bridge → @intra/auth (spec §5, ADR-003).
//
// The suite-wide SessionProvider now lives in @intra/auth and is owned/mounted by
// the shell. This thin adapter re-exports it and maps the warehouse-era
// `logout()` name onto the shared `signOut()` so ported components (UserMenu,
// ResetPasswordPage) keep working verbatim. Roles are read via `userRoles`.

import { SessionProvider, useSession as useIntraSession } from '@intra/auth';
import type { SessionValue as IntraSessionValue } from '@intra/auth';

export { SessionProvider };
export type { SessionValue } from '@intra/auth';

/** Warehouse-compatible session: adds the legacy `logout` alias for `signOut`. */
export type WarehouseSessionValue = IntraSessionValue & {
  logout: IntraSessionValue['signOut'];
};

export function useSession(): WarehouseSessionValue {
  const s = useIntraSession();
  return { ...s, logout: s.signOut };
}
