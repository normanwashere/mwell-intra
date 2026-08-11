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

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  HeroChipButton,
  HeroStat,
  Icon,
  Input,
  ModuleHero,
  SectionTitle,
  Sheet,
  Skeleton,
  StatCard,
  StaggerGrid,
  StaggerItem,
  useToast,
  type Column,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import { MODULE_LIST, MODULES, type Module, type UserRoles } from '@intra/rbac';
import { DEMO_PROFILES } from '@shell/lib/demoProfiles';
import { cx } from '@shell/lib/cx';
import {
  filterAndPageProfiles,
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

  const totalGrants = Array.from(held.values()).reduce((n, s) => n + s.size, 0);
  const vendors = profiles.filter((p) => p.kind === 'vendor').length;

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Platform admin,"
        title="Users & Roles"
        description="Assign each person only the access they need across Mwell Intra."
        icon="list"
        accessory={
          <div className="flex flex-wrap items-end gap-3">
            <HeroStat label="Profiles">
              <p className="tnum font-display text-2xl font-extrabold text-ink">
                {profiles.length}
              </p>
            </HeroStat>
            <HeroStat label="Scoped grants" align="right">
              <p className="tnum font-display text-2xl font-extrabold text-ink">
                {totalGrants}
              </p>
            </HeroStat>
          </div>
        }
      />

      <StaggerGrid className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StaggerItem>
          <StatCard
            label="Profiles"
            value={profiles.length}
            icon="list"
            tone="brand"
            hint="Employees + vendors"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Scoped grants"
            value={totalGrants}
            icon="check"
            tone="emerald"
            hint="Across all modules"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="External vendors"
            value={vendors}
            icon="building"
            tone="cyan"
            hint="kind = vendor"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Backend"
            value="Demo"
            icon="alert"
            tone="amber"
            hint="Read-only preview"
          />
        </StaggerItem>
      </StaggerGrid>

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
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [kindFilter, setKindFilter] = useState<'all' | 'employee' | 'vendor'>(
    'all',
  );
  const [page, setPage] = useState(1);
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

  const refresh = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const [
        { data: profileRows, error: pErr },
        { data: roleRows, error: rErr },
        { data: catalogRows, error: catalogError },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id,email,full_name,title,kind,vendor_id,status')
          .order('email'),
        supabase.from('user_roles').select('user_id,module,role'),
        supabase.rpc('list_rbac_catalog'),
      ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;
      if (catalogError) throw catalogError;
      setProfiles((profileRows ?? []) as AdminProfile[]);
      setHeld(indexAssignments((roleRows ?? []) as RoleAssignment[]));
      setColumns(
        roleColumnsFromCatalog((catalogRows ?? []) as RoleCatalogRow[]),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load users.';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [supabase, toast]);

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
      if (!supabase) return;
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
    [supabase, toast],
  );

  const detailUser = detailUserId
    ? profiles.find((p) => p.id === detailUserId)
    : null;
  const directory = useMemo(
    () =>
      filterAndPageProfiles(profiles, {
        query,
        status: statusFilter,
        kind: kindFilter,
        page,
        pageSize: 20,
      }),
    [profiles, query, statusFilter, kindFilter, page],
  );

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, kindFilter]);

  const requestRoleChange = useCallback(
    (userId: string, moduleName: Module, role: string, next: boolean) => {
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
    [profile?.id, toast],
  );

  const confirmRoleChange = useCallback(async () => {
    if (!roleChange) return;
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
  }, [roleChange, roleEvidence, toggle]);

  const totalGrants = Array.from(held.values()).reduce((n, s) => n + s.size, 0);
  const vendors = profiles.filter((p) => p.kind === 'vendor').length;

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Platform admin,"
        title="Users & Roles"
        description="Assign each person only the access they need across Mwell Intra."
        icon="list"
        action={
          <HeroChipButton icon="rotate" onClick={() => void refresh()}>
            Refresh
          </HeroChipButton>
        }
        accessory={
          <div className="flex flex-wrap items-end gap-3">
            <HeroStat label="Profiles">
              <p className="tnum font-display text-2xl font-extrabold text-ink">
                {profiles.length}
              </p>
            </HeroStat>
            <HeroStat label="Scoped grants" align="right">
              <p className="tnum font-display text-2xl font-extrabold text-ink">
                {totalGrants}
              </p>
            </HeroStat>
          </div>
        }
      />

      <StaggerGrid className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StaggerItem>
          <StatCard
            label="Profiles"
            value={profiles.length}
            icon="list"
            tone="brand"
            hint="Employees + vendors"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Scoped grants"
            value={totalGrants}
            icon="check"
            tone="emerald"
            hint="Across all modules"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="External vendors"
            value={vendors}
            icon="building"
            tone="cyan"
            hint="kind = vendor"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Backend"
            value="Live"
            icon="bell"
            tone="emerald"
            hint="Supabase connected"
          />
        </StaggerItem>
      </StaggerGrid>

      {error && (
        <Card className="mb-4 border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-800 dark:text-rose-300">
              <Icon name="alert" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">Couldn&apos;t load users</p>
              <p className="mt-0.5 text-sm text-muted">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : profiles.length === 0 ? (
        <EmptyState
          icon="info"
          title="No profiles yet"
          message="Users appear here after they sign in for the first time."
        />
      ) : (
        <>
          <Card className="p-4 sm:p-5">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
              <Field label="Search users" htmlFor="admin-user-search">
                <Input
                  id="admin-user-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name or email"
                />
              </Field>
              <Field label="Status" htmlFor="admin-user-status">
                <select
                  id="admin-user-status"
                  className="input-base min-h-11 w-full"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
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
                    setKindFilter(
                      event.target.value as 'all' | 'employee' | 'vendor',
                    )
                  }
                >
                  <option value="all">Employees and vendors</option>
                  <option value="employee">Employees</option>
                  <option value="vendor">Vendors</option>
                </select>
              </Field>
            </div>
          </Card>
          {directory.total === 0 ? (
            <EmptyState
              icon="search"
              title="No matching users"
              message="Adjust the search or filters to find another profile."
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
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={page >= directory.pages}
                  onClick={() =>
                    setPage((value) => Math.min(directory.pages, value + 1))
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
        open={Boolean(detailUser)}
        onOpenChange={(open) => {
          if (!open) setDetailUserId(null);
        }}
        title={detailUser?.full_name ?? detailUser?.email ?? 'User'}
        description={detailUser?.email}
        side="right"
        size="wide"
      >
        {detailUser && (
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
          if (!open) setRoleChange(null);
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
          <Button className="w-full" onClick={() => void confirmRoleChange()}>
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
          <div className="min-w-[10rem]">
            <div className="truncate font-semibold text-ink">
              {row.full_name ?? row.email}
            </div>
            <div className="truncate text-xs text-muted">{row.email}</div>
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
          <div className="flex flex-wrap gap-1">
            {assigned.slice(0, 3).map((column) => (
              <span
                key={column.key}
                className="chip bg-inset text-xs text-muted"
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
    <div className="card min-w-0 overflow-hidden">
      <div className="border-b border-line px-4 pb-2 pt-4 sm:px-5">
        <SectionTitle
          title="Access matrix"
          subtitle={`${profiles.length} user${profiles.length === 1 ? '' : 's'} · ${roleColumns.length} scoped role${roleColumns.length === 1 ? '' : 's'}`}
        />
      </div>
      <div className="max-w-full overflow-x-auto px-4 pb-4 pt-2 sm:px-5 sm:pb-5">
        <DataTable
          ariaLabel="Users and scoped role assignments"
          columns={columns}
          rows={profiles as AdminProfile[]}
          keyOf={(row) => row.id}
        />
      </div>
    </div>
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
        className="sr-only"
      />
      <span
        aria-hidden
        className={cx(
          'inline-flex h-6 w-6 items-center justify-center rounded-md border transition',
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
      <div className="rounded-lg border border-line bg-inset p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">
              {profile.full_name ?? profile.email}
            </p>
            <p className="truncate text-sm text-muted">{profile.email}</p>
          </div>
          <Badge tone={profile.kind === 'vendor' ? 'emerald' : 'brand'}>
            {profile.kind === 'vendor' ? 'Vendor' : 'Employee'}
          </Badge>
        </div>
        {profile.title && (
          <p className="mt-2 text-sm text-muted">{profile.title}</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
          <div className="bg-surface px-3 py-2.5">
            <p className="text-xs font-semibold uppercase text-faint">
              Assigned roles
            </p>
            <p className="mt-0.5 font-display text-xl font-bold text-ink">
              {assigned.length}
            </p>
          </div>
          <div className="bg-surface px-3 py-2.5">
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
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {orderedGroups.map(([moduleName, cols]) => {
            const modulePresentation = getAdminModulePresentation(moduleName);
            const assignedInModule = cols.filter((column) =>
              held.has(column.key),
            ).length;
            return (
              <details
                key={moduleName}
                className="group overflow-hidden rounded-lg border border-line bg-surface shadow-e1"
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
                <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 [&::-webkit-details-marker]:hidden">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                    <Icon name={modulePresentation.icon} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
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
                  {cols.map((column) => {
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
