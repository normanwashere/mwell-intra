'use client';

// Admin: User provisioning + RBAC assignment (spec §4.2, §5, §6.2).
//
// Gated on `core:manage_rbac`. Lists `core.profiles`, joins `core.user_roles`
// via a live Supabase read (schema pinned to `core`), and toggles scoped role
// grants through the SECURITY DEFINER RPCs `core.assign_user_role` /
// `core.revoke_user_role` (the ONLY write path — direct table writes are
// revoked from `authenticated` by the core RLS migration).
//
// Memory-mode fallback: the shell renders with NO live backend, so we surface
// a read-only preview of the demo tiles (`DEMO_PROFILES`) with every checkbox
// disabled + an explanatory banner. This keeps `next build` and demo mode
// producing a useful screen instead of a blank error.
//
// UX shape:
//   * DataTable = the "role matrix" (rows = users, extra cols = module:role
//     checkboxes). Horizontally scrolls on desktop; the responsive card mode
//     hides checkbox columns on mobile and offers "Manage roles" per row.
//   * Sheet = per-user detail (id / email / kind / current roles as chips)
//     and a role picker with the same grid but scoped to that one user, which
//     is what a phone user will use to grant/revoke.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  HeroChipButton,
  Icon,
  Input,
  SectionTitle,
  Sheet,
  Skeleton,
  useToast,
  userFacingError,
  type Column,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import { MODULE_LIST, MODULES, type Module, type UserRoles } from '@intra/rbac';
import { DEMO_PROFILES } from '@shell/lib/demoProfiles';
import { cx } from '@shell/lib/cx';
import { AdminHeader } from '../AdminHeader';
import { useDirectoryState } from './directoryState';
import {
  validateRoleChangeEvidence,
  type RoleChangeEvidence,
} from '@shell/lib/adminGovernance';
import {
  getAdminModulePresentation,
  getAdminRolePresentation,
} from '@shell/lib/adminRolePresentation';

// ---------------------------------------------------------------------------
// Types + helpers
// ---------------------------------------------------------------------------

interface AdminProfile {
  readonly id: string;
  readonly email: string;
  readonly full_name: string | null;
  readonly title: string | null;
  readonly kind: 'employee' | 'vendor';
  readonly vendor_id: string | null;
  readonly status: string;
}

interface RoleAssignment {
  readonly user_id: string;
  readonly module: string;
  readonly role: string;
}

interface RoleCatalogRow {
  readonly module: string;
  readonly role: string;
  readonly label: string;
  readonly description: string | null;
  readonly is_active: boolean;
  readonly is_protected: boolean;
  readonly updated_at: string;
  readonly capabilities: readonly string[];
  readonly assignment_count: number;
}

/** module:role pair that identifies one column of the role matrix. */
interface RoleColumn {
  readonly module: Module;
  readonly role: string;
  readonly key: string; // `${module}:${role}`
  readonly label: string;
  readonly description: string;
  readonly isActive: boolean;
  readonly updatedAt: string | null;
}

/** Materialize the full module × role catalogue in stable declaration order. */
function buildStaticRoleColumns(): readonly RoleColumn[] {
  const out: RoleColumn[] = [];
  for (const module of MODULE_LIST) {
    // Widen to a plain record so we can iterate module role tables that carry
    // different literal unions per module without a per-module type dance.
    const roles = MODULES[module].roles as Readonly<
      Record<string, { label: string; description: string }>
    >;
    for (const role of Object.keys(roles)) {
      const presentation = getAdminRolePresentation(module, role, roles[role]);
      out.push({
        module,
        role,
        key: `${module}:${role}`,
        label: presentation.label,
        description: presentation.description,
        isActive: true,
        updatedAt: null,
      });
    }
  }
  return out;
}

function roleColumnsFromCatalog(
  rows: readonly RoleCatalogRow[],
): readonly RoleColumn[] {
  return rows
    .filter((row): row is RoleCatalogRow & { module: Module } =>
      MODULE_LIST.includes(row.module as Module),
    )
    .map((row) => {
      const presentation = getAdminRolePresentation(row.module, row.role, row);
      return {
        module: row.module,
        role: row.role,
        key: `${row.module}:${row.role}`,
        label: presentation.label,
        description: presentation.description,
        isActive: row.is_active,
        updatedAt: row.updated_at,
      };
    });
}

/** Group a flat list of assignments back into a per-user role matrix. */
function indexAssignments(
  rows: readonly RoleAssignment[],
): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = idx.get(row.user_id) ?? new Set<string>();
    set.add(`${row.module}:${row.role}`);
    idx.set(row.user_id, set);
  }
  return idx;
}

function assignedRoleColumns(
  held: ReadonlySet<string> | undefined,
  roleColumns: readonly RoleColumn[],
): readonly RoleColumn[] {
  if (!held || held.size === 0) return [];
  const byKey = new Map(roleColumns.map((column) => [column.key, column]));
  return Array.from(held)
    .map((key) => byKey.get(key))
    .filter((column): column is RoleColumn => Boolean(column))
    .sort((left, right) =>
      getAdminModulePresentation(left.module).label.localeCompare(
        getAdminModulePresentation(right.module).label,
      ),
    );
}

// ---------------------------------------------------------------------------
// Page (Guard-gated)
// ---------------------------------------------------------------------------

export default function AdminUsersPage() {
  return (
    <Guard module="core" cap="manage_rbac">
      <AdminUsersInner />
    </Guard>
  );
}

function AdminUsersInner() {
  const { mode } = useSession();
  const isLive = mode === 'supabase';
  return isLive ? <LiveAdminUsers /> : <MemoryAdminUsers />;
}

// ---------------------------------------------------------------------------
// Memory-mode preview (no backend, controls disabled)
// ---------------------------------------------------------------------------

function MemoryAdminUsers() {
  const [evidenceRoles, setEvidenceRoles] = useState<Set<string> | null>(null);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const columns = useMemo(buildStaticRoleColumns, []);
  const profiles = useMemo<AdminProfile[]>(
    () =>
      DEMO_PROFILES.map((p) => ({
        id: p.id,
        email: p.email,
        full_name: p.name ?? null,
        title: p.title ?? null,
        kind: p.kind,
        vendor_id: p.vendorId ?? null,
        status: 'active',
      })),
    [],
  );
  const held = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const p of DEMO_PROFILES) {
      const set = new Set<string>();
      for (const module of MODULE_LIST) {
        for (const role of (p.roles as Partial<UserRoles>)[module] ?? []) {
          set.add(`${module}:${role}`);
        }
      }
      map.set(p.id, set);
    }
    return map;
  }, []);

  useEffect(() => {
    if (
      window.sessionStorage.getItem('intra.evidence-scenario') ===
      'admin-role-correction'
    ) {
      setEvidenceRoles(new Set(held.get('demo-operations') ?? []));
    }
  }, [held]);

  const evidenceUser = evidenceRoles
    ? (profiles.find((profile) => profile.id === 'demo-operations') ?? null)
    : null;

  const totalGrants = profiles.reduce((n, user) => n + (held.get(user.id)?.size ?? 0), 0);
  const vendors = profiles.filter((p) => p.kind === 'vendor').length;

  return (
    <div className="space-y-4">
      <AdminHeader title="Users & Roles" />
      <dl aria-label="Directory summary" className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line pb-3 text-sm">
        <div><dt className="inline text-muted">Profiles</dt><dd className="ml-2 inline font-semibold text-ink">{profiles.length}</dd></div>
        <div><dt className="inline text-muted">Grants on this page</dt><dd className="ml-2 inline font-semibold text-ink">{totalGrants}</dd></div>
        <div><dt className="inline text-muted">Vendors on this page</dt><dd className="ml-2 inline font-semibold text-ink">{vendors}</dd></div>
      </dl>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-300">
            <Icon name="info" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink">Read-only preview</p>
            <p className="mt-0.5 text-sm text-muted">
              Live identity services are not connected in this environment, so
              the profiles below are examples and access controls are disabled.
            </p>
          </div>
        </div>
      </Card>

      <UserRoleTable
        profiles={profiles}
        held={
          evidenceRoles
            ? new Map(held).set('demo-operations', evidenceRoles)
            : held
        }
        roleColumns={columns}
        onToggle={(userId, moduleName, role, next) => {
          if (!evidenceRoles || userId !== 'demo-operations') return;
          const updated = new Set(evidenceRoles);
          const key = `${moduleName}:${role}`;
          if (next) updated.add(key);
          else updated.delete(key);
          setEvidenceRoles(updated);
        }}
        onOpenDetail={
          evidenceRoles ? (userId) => setDetailUserId(userId) : undefined
        }
        disabled={!evidenceRoles}
      />

      <Sheet
        open={Boolean(evidenceUser && detailUserId === evidenceUser.id)}
        onOpenChange={(open) => {
          if (!open) setDetailUserId(null);
        }}
        title={evidenceUser?.full_name ?? evidenceUser?.email ?? 'User'}
        description={evidenceUser?.email}
        side="right"
        size="wide"
      >
        {evidenceUser && evidenceRoles && (
          <UserDetail
            key={evidenceUser.id}
            profile={evidenceUser}
            held={evidenceRoles}
            roleColumns={columns}
            pending={new Set()}
            onToggle={(moduleName, role, next) => {
              const updated = new Set(evidenceRoles);
              const key = `${moduleName}:${role}`;
              if (next) updated.add(key);
              else updated.delete(key);
              setEvidenceRoles(updated);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live (Supabase) mode
// ---------------------------------------------------------------------------

function LiveAdminUsers() {
  const toast = useToast();
  const { profile, supabaseClient } = useSession();
  const supabase = useMemo(
    () => supabaseClient?.schema('core') ?? null,
    [supabaseClient],
  );

  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [columns, setColumns] = useState<readonly RoleColumn[]>([]);
  const [held, setHeld] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [selectedProfile, setSelectedProfile] = useState<AdminProfile | null>(null);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const directoryRequest = useRef(0);
  const [roleChange, setRoleChange] = useState<{
    userId: string;
    moduleName: Module;
    role: string;
    next: boolean;
  } | null>(null);
  const [roleEvidence, setRoleEvidence] = useState<RoleChangeEvidence>({
    approvalReference: '',
    reason: '',
    effectiveAt: new Date().toISOString().slice(0, 10),
    expiresAt: '',
  });
  const [roleEvidenceErrors, setRoleEvidenceErrors] = useState<
    Partial<Record<keyof RoleChangeEvidence, string>>
  >({});
  const confirmDiscard = useCallback(() => {
    if (pending.size) return false;
    if (roleChange && !window.confirm('Discard the unsaved role change evidence? No access change will be saved.')) return false;
    setRoleChange(null);
    return true;
  }, [roleChange, pending.size]);
  const state = useDirectoryState(confirmDiscard);
  const { query, status: statusFilter, kind: kindFilter, page, user: detailUserId, ready, update } = state;
  const lastSelected = useRef<string | null>(null);
  const setDetailUserId = (user: string | null) => update({ user });
  useEffect(() => {
    if (detailUserId) { lastSelected.current = detailUserId; return; }
    if (loading || !lastSelected.current) return;
    const previous = lastSelected.current;
    lastSelected.current = null;
    const frame = requestAnimationFrame(() => {
      (document.getElementById(`manage-user-${previous}`) ?? document.getElementById('admin-user-search'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [detailUserId, loading]);
  useEffect(() => {
    if (!roleChange) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [roleChange]);

  const refresh = useCallback(async () => {
    if (!supabase || !ready) return;
    const request = ++directoryRequest.current;
    setLoading(true);
    setError(null);
    try {
      const [
        { data: directoryData, error: pErr },
        { data: catalogRows, error: catalogError },
      ] = await Promise.all([
        supabase.rpc('platform_user_directory', { p_query: query, p_status: statusFilter, p_kind: kindFilter, p_page: page }),
        supabase.rpc('list_rbac_catalog'),
      ]);
      if (pErr) throw pErr;
      if (catalogError) throw catalogError;
      if (request !== directoryRequest.current) return;
      const result = directoryData as { rows: AdminProfile[]; roles: RoleAssignment[]; total: number };
      if (!Array.isArray(result?.rows) || !Array.isArray(result?.roles) || !Number.isFinite(result.total)) throw new Error('Directory authority is incomplete. Retry before changing roles.');
      let selected: AdminProfile | null = null;
      let selectedRoles: RoleAssignment[] = [];
      if (detailUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detailUserId)) {
        const { data, error: detailError } = await supabase.from('profiles')
          .select('id,email,full_name,title,kind,vendor_id,status').eq('id', detailUserId).maybeSingle();
        if (detailError) throw detailError;
        selected = data as AdminProfile | null;
        if (selected) {
          const roles = await supabase.from('user_roles').select('user_id,module,role').eq('user_id', detailUserId);
          if (roles.error) throw roles.error;
          selectedRoles = (roles.data ?? []) as RoleAssignment[];
        }
      }
      if (request !== directoryRequest.current) return;
      setSelectedProfile(selected);
      setProfiles(result.rows);
      setHeld(indexAssignments([...result.roles.filter(row => row.user_id !== selected?.id), ...selectedRoles]));
      setDirectoryTotal(result.total);
      setColumns(
        roleColumnsFromCatalog((catalogRows ?? []) as RoleCatalogRow[]),
      );
    } catch (err) {
      if (request !== directoryRequest.current) return;
      setProfiles([]); setHeld(new Map()); setSelectedProfile(null);
      const msg = err instanceof Error ? err.message : 'Failed to load users.';
      setError(msg);
      toast.error(msg);
    } finally {
      if (request === directoryRequest.current) setLoading(false);
    }
  }, [supabase, toast, query, statusFilter, kindFilter, page, detailUserId, ready]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (
      userId: string,
      moduleName: Module,
      role: string,
      next: boolean,
      evidence: RoleChangeEvidence,
    ) => {
      if (!supabase || loading || error) return;
      const key = `${userId}::${moduleName}:${role}`;
      // Optimistic update.
      setPending((prev) => new Set(prev).add(key));
      const cellKey = `${moduleName}:${role}`;
      setHeld((prev) => {
        const copy = new Map(prev);
        const set = new Set(copy.get(userId) ?? []);
        if (next) set.add(cellKey);
        else set.delete(cellKey);
        copy.set(userId, set);
        return copy;
      });

      try {
        const fn = next ? 'assign_user_role' : 'revoke_user_role';
        const { error: rpcErr } = await supabase.rpc(fn, {
          payload: {
            user_id: userId,
            module: moduleName,
            role,
            approval_reference: evidence.approvalReference.trim(),
            reason: evidence.reason.trim(),
            effective_at: new Date(
              `${evidence.effectiveAt}T00:00:00+08:00`,
            ).toISOString(),
            expires_at: evidence.expiresAt
              ? new Date(`${evidence.expiresAt}T23:59:59+08:00`).toISOString()
              : null,
          },
        });
        if (rpcErr) throw rpcErr;
        const roleLabel = getAdminRolePresentation(moduleName, role).label;
        const moduleLabel = getAdminModulePresentation(moduleName).label;
        toast.success(
          `${next ? 'Granted' : 'Revoked'} ${roleLabel} in ${moduleLabel}`,
        );
      } catch (err) {
        // Roll back optimistic update.
        setHeld((prev) => {
          const copy = new Map(prev);
          const set = new Set(copy.get(userId) ?? []);
          if (next) set.delete(cellKey);
          else set.add(cellKey);
          copy.set(userId, set);
          return copy;
        });
        const msg =
          err instanceof Error ? err.message : 'Failed to update role.';
        toast.error(msg);
      } finally {
        setPending((prev) => {
          const copy = new Set(prev);
          copy.delete(key);
          return copy;
        });
      }
    },
    [supabase, toast, loading, error],
  );

  const detailUser = selectedProfile?.id === detailUserId ? selectedProfile : null;
  const directory = { rows: profiles, total: directoryTotal, pages: Math.max(1, Math.ceil(directoryTotal / 20)) };

  const requestRoleChange = useCallback(
    (userId: string, moduleName: Module, role: string, next: boolean) => {
      if (loading || error || pending.size) return;
      if (userId === profile?.id) {
        toast.error(
          'You cannot change your own roles. Ask another platform administrator.',
        );
        return;
      }
      setRoleEvidence({
        approvalReference: '',
        reason: '',
        effectiveAt: new Date().toISOString().slice(0, 10),
        expiresAt: '',
      });
      setRoleEvidenceErrors({});
      setRoleChange({ userId, moduleName, role, next });
    },
    [profile?.id, toast, loading, error, pending.size],
  );

  const confirmRoleChange = useCallback(async () => {
    if (!roleChange || pending.size || loading || error) return;
    const errors = validateRoleChangeEvidence(roleEvidence);
    setRoleEvidenceErrors(errors);
    if (Object.keys(errors).length > 0) return;
    await toggle(
      roleChange.userId,
      roleChange.moduleName,
      roleChange.role,
      roleChange.next,
      roleEvidence,
    );
    setRoleChange(null);
  }, [roleChange, roleEvidence, toggle, pending.size, loading, error]);

  const totalGrants = profiles.reduce((n, user) => n + (held.get(user.id)?.size ?? 0), 0);
  const vendors = profiles.filter((p) => p.kind === 'vendor').length;

  return (
    <div className="space-y-4">
      <AdminHeader title="Users & Roles" action={<HeroChipButton icon="rotate" onClick={() => void refresh()}>Refresh</HeroChipButton>} />
      <dl aria-label="Directory summary" className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line pb-3 text-sm">
        <div><dt className="inline text-muted">Matching profiles</dt><dd className="ml-2 inline font-semibold text-ink">{directoryTotal}</dd></div>
        <div><dt className="inline text-muted">Grants on this page</dt><dd className="ml-2 inline font-semibold text-ink">{totalGrants}</dd></div>
        <div><dt className="inline text-muted">Vendors on this page</dt><dd className="ml-2 inline font-semibold text-ink">{vendors}</dd></div>
      </dl>

      {error && (
        <Card className="mb-4 border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-800 dark:text-rose-300">
              <Icon name="alert" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">Couldn&apos;t load users</p><Button variant="outline" onClick={() => void refresh()}>Retry directory</Button>
              <p className="mt-0.5 text-sm text-muted">{userFacingError(error)}</p>
            </div>
          </div>
        </Card>
      )}

      {(
        <>
          <section aria-label="Directory filters" className="border-b border-line pb-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
              <div className="col-span-2 md:col-span-1">
              <Field label="Search users" htmlFor="admin-user-search">
                <Input
                  id="admin-user-search"
                  type="search"
                  value={query}
                  maxLength={200}
                  onChange={(event) => update({ q: event.target.value, page: 1 }, true)}
                  placeholder="Name or email"
                />
              </Field>
              </div>
              <Field label="Status" htmlFor="admin-user-status">
                <select
                  id="admin-user-status"
                  className="input-base min-h-11 w-full"
                  value={statusFilter}
                  onChange={(event) => update({ status: event.target.value, page: 1 })}
                >
                  <option value="active">Active</option>
                  <option value="all">All statuses</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <Field label="User type" htmlFor="admin-user-kind">
                <select
                  id="admin-user-kind"
                  className="input-base min-h-11 w-full"
                  value={kindFilter}
                  onChange={(event) =>
                    update({ kind: event.target.value, page: 1 })
                  }
                >
                  <option value="all">All user types</option>
                  <option value="employee">Employees</option>
                  <option value="vendor">Vendors</option>
                </select>
              </Field>
            </div>
          </section>
          {loading ? <Skeleton className="h-32 w-full" /> : error ? <p role="status">Directory unavailable. Retry before managing access.</p> : directory.rows.length === 0 ? (
            <EmptyState
              icon="search"
              title={directory.total === 0 ? 'No matching users' : 'No users on this page'}
              message={directory.total === 0 ? 'Adjust the search or filters to find another profile.' : 'The directory has changed. Return to the first page with the same filters.'}
              action={page > 1 ? <Button variant="outline" onClick={() => update({ page: 1 })}>First page</Button> : undefined}
            />
          ) : (
            <UserRoleTable
              profiles={directory.rows as AdminProfile[]}
              held={held}
              roleColumns={columns}
              pending={pending}
              onToggle={requestRoleChange}
              onOpenDetail={(id) => setDetailUserId(id)}
            />
          )}
          {directory.pages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Page {page} of {directory.pages} · {directory.total} users
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={loading || page <= 1}
                  onClick={() => update({ page: Math.max(1, page - 1) })}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={loading || page >= directory.pages}
                  onClick={() =>
                    update({ page: Math.min(directory.pages, page + 1) })
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Sheet
        open={Boolean(detailUserId)}
        onOpenChange={(open) => {
          if (!open) setDetailUserId(null);
        }}
        title={detailUser?.full_name ?? detailUser?.email ?? 'User'}
        description={detailUser?.email}
        side="right"
        size="wide"
      >
        {loading ? <Skeleton className="h-32 w-full" /> : error ? <div role="alert"><p>User details are unavailable.</p><Button onClick={() => void refresh()}>Retry user details</Button></div> : !detailUser ? <div role="status"><p>User not found or outside your authorized scope.</p><Button variant="outline" onClick={() => setDetailUserId(null)}>Return to directory</Button></div> : (
          <UserDetail
            key={detailUser.id}
            profile={detailUser}
            held={held.get(detailUser.id) ?? new Set()}
            roleColumns={columns}
            pending={pending}
            onToggle={(moduleName, role, next) =>
              requestRoleChange(detailUser.id, moduleName, role, next)
            }
            selfManaged={detailUser.id === profile?.id}
          />
        )}
      </Sheet>
      <Sheet
        open={Boolean(roleChange)}
        onOpenChange={(open) => {
          if (!open) confirmDiscard();
        }}
        title={
          roleChange?.next ? 'Grant governed access' : 'Revoke governed access'
        }
        description={
          roleChange
            ? `${getAdminRolePresentation(roleChange.moduleName, roleChange.role).label} · ${getAdminModulePresentation(roleChange.moduleName).label}`
            : undefined
        }
        side="right"
        footer={
          <Button className="w-full" disabled={pending.size > 0 || loading || Boolean(error)} onClick={() => void confirmRoleChange()}>
            {roleChange?.next ? 'Grant access' : 'Revoke access'}
          </Button>
        }
      >
        <div className="space-y-4">
          {roleChange && (
            <div className="border-l-4 border-brand-500 bg-brand-50 p-4 dark:bg-brand-900/20">
              <p className="text-xs font-bold uppercase text-brand-700 dark:text-brand-300">
                {getAdminModulePresentation(roleChange.moduleName).label} module
              </p>
              <p className="mt-1 font-semibold text-ink">
                {
                  getAdminRolePresentation(
                    roleChange.moduleName,
                    roleChange.role,
                  ).label
                }
              </p>
              <p className="mt-1 text-sm text-muted">
                {
                  getAdminRolePresentation(
                    roleChange.moduleName,
                    roleChange.role,
                  ).description
                }
              </p>
            </div>
          )}
          <p className="text-sm text-muted">
            Record the approved request before changing access. This evidence is
            retained in the audit trail.
          </p>
          <Field
            label="Approval reference"
            htmlFor="role-change-approval"
            error={roleEvidenceErrors.approvalReference}
          >
            <Input
              id="role-change-approval"
              value={roleEvidence.approvalReference}
              onChange={(event) =>
                setRoleEvidence((value) => ({
                  ...value,
                  approvalReference: event.target.value,
                }))
              }
              placeholder="e.g. IAM-2026-001"
            />
          </Field>
          <Field
            label="Business reason"
            htmlFor="role-change-reason"
            error={roleEvidenceErrors.reason}
          >
            <textarea
              id="role-change-reason"
              className="input-base min-h-28 w-full resize-y"
              value={roleEvidence.reason}
              onChange={(event) =>
                setRoleEvidence((value) => ({
                  ...value,
                  reason: event.target.value,
                }))
              }
            />
          </Field>
          <Field
            label="Effective date"
            htmlFor="role-change-effective"
            error={roleEvidenceErrors.effectiveAt}
          >
            <Input
              id="role-change-effective"
              type="date"
              value={roleEvidence.effectiveAt}
              onChange={(event) =>
                setRoleEvidence((value) => ({
                  ...value,
                  effectiveAt: event.target.value,
                }))
              }
            />
          </Field>
          <Field
            label="Expiry date (optional)"
            htmlFor="role-change-expiry"
            error={roleEvidenceErrors.expiresAt}
          >
            <Input
              id="role-change-expiry"
              type="date"
              value={roleEvidence.expiresAt}
              onChange={(event) =>
                setRoleEvidence((value) => ({
                  ...value,
                  expiresAt: event.target.value,
                }))
              }
            />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The DataTable — rows = users, cols = identity + module:role checkboxes.
// ---------------------------------------------------------------------------

interface UserRoleTableProps {
  readonly profiles: readonly AdminProfile[];
  readonly held: ReadonlyMap<string, ReadonlySet<string>>;
  readonly roleColumns: readonly RoleColumn[];
  readonly pending?: ReadonlySet<string>;
  readonly onToggle: (
    userId: string,
    moduleName: Module,
    role: string,
    next: boolean,
  ) => void;
  readonly onOpenDetail?: (userId: string) => void;
  readonly disabled?: boolean;
}

function UserRoleTable({
  profiles,
  held,
  roleColumns,
  pending,
  onToggle,
  onOpenDetail,
  disabled,
}: UserRoleTableProps) {
  const columns = useMemo<Column<AdminProfile>[]>(() => {
    const cols: Column<AdminProfile>[] = [
      {
        key: 'user',
        header: 'User',
        primary: true,
        render: (row) => (
          <div className="min-w-0 max-w-full">
            <div className="break-words font-semibold text-ink [overflow-wrap:anywhere]">
              {row.full_name ?? row.email}
            </div>
            <div className="break-words text-xs text-muted [overflow-wrap:anywhere]">{row.email}</div>
          </div>
        ),
      },
      {
        key: 'kind',
        header: 'Tier',
        hideOnMobile: true,
        render: (row) => (
          <Badge tone={row.kind === 'vendor' ? 'emerald' : 'brand'}>
            {row.kind === 'vendor' ? 'Vendor' : 'Employee'}
          </Badge>
        ),
      },
    ];

    cols.push({
      key: 'summary',
      header: 'Roles',
      hideOnMobile: false,
      render: (row) => {
        const assigned = assignedRoleColumns(held.get(row.id), roleColumns);
        if (assigned.length === 0) {
          return <span className="text-xs text-faint">No roles</span>;
        }
        return (
          <div className="flex min-w-0 max-w-full flex-wrap gap-1">
            {assigned.slice(0, 3).map((column) => (
              <span
                key={column.key}
                className="inline-block max-w-full whitespace-normal break-words [overflow-wrap:anywhere] rounded px-2 py-1 bg-inset text-xs text-muted"
                title={`${column.label} in ${getAdminModulePresentation(column.module).label}`}
              >
                {getAdminModulePresentation(column.module).shortLabel} ·{' '}
                {column.label}
              </span>
            ))}
            {assigned.length > 3 && (
              <span className="chip bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                +{assigned.length - 3} more
              </span>
            )}
          </div>
        );
      },
    });

    if (onOpenDetail) {
      cols.push({
        key: 'action',
        header: '',
        align: 'right',
        hideOnMobile: false,
        render: (row) => (
          <Button
            id={`manage-user-${row.id}`}
            variant="ghost"
            size="sm"
            iconRight="chevron"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail(row.id);
            }}
          >
            Manage
          </Button>
        ),
      });
    }

    return cols;
  }, [roleColumns, held, pending, onToggle, onOpenDetail, disabled]);

  return (
    <section className="min-w-0 overflow-hidden" aria-label="User directory">
      <div className="border-b border-line pb-2">
        <SectionTitle
          title="User directory"
          subtitle={`${profiles.length} user${profiles.length === 1 ? '' : 's'} · ${roleColumns.length} scoped role${roleColumns.length === 1 ? '' : 's'}`}
        />
      </div>
      <div data-testid="admin-users-table" className="max-w-full pt-2 [&_table]:min-w-0 [&_table]:table-fixed [&_th:first-child]:w-[32%] [&_th:nth-child(2)]:w-24 [&_th:last-child]:w-28 [&_td]:align-top [&_td]:px-2 [&_th]:px-2">
        <DataTable
          density="compact"
          ariaLabel="Users and scoped role assignments"
          columns={columns}
          rows={profiles as AdminProfile[]}
          keyOf={(row) => row.id}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small, accessible checkbox
// ---------------------------------------------------------------------------

function RoleCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={cx(
        'inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg transition',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      title={label}
    >
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cx(
          'inline-flex h-6 w-6 items-center justify-center rounded-md border transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-brand-700 forced-colors:peer-focus-visible:outline-[Highlight]',
          checked
            ? 'border-brand-500 bg-brand-500 text-white'
            : 'border-line bg-surface text-transparent hover:border-brand-300',
        )}
      >
        {checked && <Icon name="check" className="h-3.5 w-3.5" />}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// User detail sheet
// ---------------------------------------------------------------------------

interface UserDetailProps {
  readonly profile: AdminProfile;
  readonly held: ReadonlySet<string>;
  readonly roleColumns: readonly RoleColumn[];
  readonly pending: ReadonlySet<string>;
  readonly onToggle: (moduleName: Module, role: string, next: boolean) => void;
  readonly selfManaged?: boolean;
}

function UserDetail({
  profile,
  held,
  roleColumns,
  pending,
  onToggle,
  selfManaged,
}: UserDetailProps) {
  const [openModules, setOpenModules] = useState<Set<Module>>(
    () =>
      new Set(
        roleColumns
          .filter((column) => held.has(column.key))
          .map((column) => column.module),
      ),
  );
  const grouped = useMemo(() => {
    const g = new Map<Module, RoleColumn[]>();
    for (const c of roleColumns) {
      const list = g.get(c.module) ?? [];
      list.push(c);
      g.set(c.module, list);
    }
    return g;
  }, [roleColumns]);
  const orderedGroups = useMemo(
    () =>
      Array.from(grouped.entries()).sort(
        ([leftModule, left], [rightModule, right]) => {
          const leftAssigned = left.some((column) => held.has(column.key));
          const rightAssigned = right.some((column) => held.has(column.key));
          if (leftAssigned !== rightAssigned) return leftAssigned ? -1 : 1;
          if (leftModule === 'core' && rightModule !== 'core') return 1;
          if (rightModule === 'core' && leftModule !== 'core') return -1;
          return (
            MODULE_LIST.indexOf(leftModule) - MODULE_LIST.indexOf(rightModule)
          );
        },
      ),
    [grouped, held],
  );
  const assigned = useMemo(
    () => assignedRoleColumns(held, roleColumns),
    [held, roleColumns],
  );
  const assignedModuleCount = useMemo(
    () => new Set(assigned.map((column) => column.module)).size,
    [assigned],
  );

  return (
    <div className="space-y-6">
      <div className="border-b border-line pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words font-semibold text-ink [overflow-wrap:anywhere]">
              {profile.full_name ?? profile.email}
            </p>
            <p className="break-words text-sm text-muted [overflow-wrap:anywhere]">{profile.email}</p>
          </div>
          <Badge tone={profile.kind === 'vendor' ? 'emerald' : 'brand'}>
            {profile.kind === 'vendor' ? 'Vendor' : 'Employee'}
          </Badge>
        </div>
        {profile.title && (
          <p className="mt-2 text-sm text-muted">{profile.title}</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="border-l-2 border-line pl-3">
            <p className="text-xs font-semibold uppercase text-faint">
              Assigned roles
            </p>
            <p className="mt-0.5 font-display text-xl font-bold text-ink">
              {assigned.length}
            </p>
          </div>
          <div className="border-l-2 border-line pl-3">
            <p className="text-xs font-semibold uppercase text-faint">
              Active modules
            </p>
            <p className="mt-0.5 font-display text-xl font-bold text-ink">
              {assignedModuleCount}
            </p>
          </div>
        </div>
      </div>

      <div className="border-l-4 border-brand-500 bg-brand-50 p-4 dark:bg-brand-900/20">
        <p className="font-semibold text-ink">How access is organized</p>
        <p className="mt-1 text-sm text-muted">
          A module is a workspace, such as Warehouse or Procurement. A role
          defines what this person may do inside that workspace. One person may
          need roles in several modules.
        </p>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase text-brand-700 dark:text-brand-300">
              Access by module
            </p>
            <h2 className="font-display text-lg font-bold text-ink">
              Choose the person&apos;s responsibilities
            </h2>
          </div>
          <p className="text-xs text-muted">Assigned modules appear first</p>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {orderedGroups.map(([moduleName, cols]) => {
            const modulePresentation = getAdminModulePresentation(moduleName);
            const assignedInModule = cols.filter((column) =>
              held.has(column.key),
            ).length;
            const orderedRoles = [...cols].sort((left, right) => {
              const leftAssigned = held.has(left.key);
              const rightAssigned = held.has(right.key);
              if (leftAssigned !== rightAssigned) return leftAssigned ? -1 : 1;
              return left.label.localeCompare(right.label);
            });
            return (
              <details
                key={moduleName}
                className="group min-w-0"
                open={openModules.has(moduleName)}
                onToggle={(event) => {
                  const nextOpen = event.currentTarget.open;
                  setOpenModules((current) => {
                    const next = new Set(current);
                    if (nextOpen) next.add(moduleName);
                    else next.delete(moduleName);
                    return next;
                  });
                }}
              >
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-3 px-2 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 [&::-webkit-details-marker]:hidden">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                    <Icon name={modulePresentation.icon} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1 basis-48 break-words">
                    <span className="block text-[0.68rem] font-bold uppercase text-faint">
                      Module
                    </span>
                    <span className="block font-semibold text-ink">
                      {modulePresentation.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted">
                      {modulePresentation.description}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={assignedInModule > 0 ? 'emerald' : 'slate'}>
                      {assignedInModule} assigned
                    </Badge>
                    <Icon
                      name="chevron"
                      className="h-4 w-4 text-muted transition-transform group-open:rotate-90"
                    />
                  </span>
                </summary>
                <ul className="border-t border-line">
                  {orderedRoles.map((column) => {
                    const checked = held.has(column.key);
                    const rowPending = pending.has(
                      `${profile.id}::${column.key}`,
                    );
                    const disabled =
                      selfManaged ||
                      rowPending ||
                      (!column.isActive && !checked);
                    return (
                      <li
                        key={column.key}
                        className={cx(
                          'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0',
                          checked && 'bg-brand-50/70 dark:bg-brand-900/20',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[0.65rem] font-bold uppercase text-brand-700 dark:text-brand-300">
                              Role
                            </span>
                            <p className="font-semibold text-ink">
                              {column.label}
                            </p>
                            {!column.isActive && (
                              <Badge tone="slate">Inactive</Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {column.description}
                          </p>
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                          <RoleCheckbox
                            checked={checked}
                            disabled={disabled}
                            label={`${checked ? 'Remove' : 'Assign'} ${column.label} in ${modulePresentation.label} for ${profile.email}`}
                            onChange={(next) =>
                              onToggle(column.module, column.role, next)
                            }
                          />
                          <span
                            className={cx(
                              'text-[0.65rem] font-semibold',
                              checked
                                ? 'text-brand-700 dark:text-brand-300'
                                : 'text-faint',
                            )}
                          >
                            {rowPending
                              ? 'Saving'
                              : checked
                                ? 'Assigned'
                                : 'Available'}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}
