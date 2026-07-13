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
  HeroChipButton,
  HeroStat,
  Icon,
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
import {
  MODULE_LIST,
  MODULES,
  type Module,
  type UserRoles,
} from '@intra/rbac';
import { DEMO_PROFILES } from '@shell/lib/demoProfiles';
import { cx } from '@shell/lib/cx';

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

/** module:role pair that identifies one column of the role matrix. */
interface RoleColumn {
  readonly module: Module;
  readonly role: string;
  readonly key: string; // `${module}:${role}`
  readonly label: string;
}

/** Materialize the full module × role catalogue in stable declaration order. */
function buildRoleColumns(): readonly RoleColumn[] {
  const out: RoleColumn[] = [];
  for (const module of MODULE_LIST) {
    // Widen to a plain record so we can iterate module role tables that carry
    // different literal unions per module without a per-module type dance.
    const roles = MODULES[module].roles as Readonly<
      Record<string, { label: string }>
    >;
    for (const role of Object.keys(roles)) {
      out.push({
        module,
        role,
        key: `${module}:${role}`,
        label: roles[role]?.label ?? role,
      });
    }
  }
  return out;
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

/** Compact "core:staff, warehouse:operations" summary for the row footer. */
function summarizeRoles(held: ReadonlySet<string> | undefined): string {
  if (!held || held.size === 0) return '—';
  return Array.from(held).sort().join(', ');
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
  const columns = useMemo(buildRoleColumns, []);
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
    ? profiles.find((profile) => profile.id === 'demo-operations') ?? null
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
              <p className="tnum font-display text-2xl font-extrabold text-ink">{profiles.length}</p>
            </HeroStat>
            <HeroStat label="Scoped grants" align="right">
              <p className="tnum font-display text-2xl font-extrabold text-ink">{totalGrants}</p>
            </HeroStat>
          </div>
        }
      />

      <StaggerGrid className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StaggerItem>
          <StatCard label="Profiles" value={profiles.length} icon="list" tone="brand" hint="Employees + vendors" />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Scoped grants" value={totalGrants} icon="check" tone="emerald" hint="Across all modules" />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="External vendors" value={vendors} icon="building" tone="cyan" hint="kind = vendor" />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Backend" value="Demo" icon="alert" tone="amber" hint="Read-only preview" />
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
      >
        {evidenceUser && evidenceRoles && (
          <UserDetail
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
  const columns = useMemo(buildRoleColumns, []);
  const { supabaseClient } = useSession();
  const supabase = useMemo(
    () => supabaseClient?.schema('core') ?? null,
    [supabaseClient],
  );

  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [held, setHeld] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [detailUserId, setDetailUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const [{ data: profileRows, error: pErr }, { data: roleRows, error: rErr }] =
        await Promise.all([
          supabase
            .from('profiles')
            .select('id,email,full_name,title,kind,vendor_id,status')
            .order('email'),
          supabase.from('user_roles').select('user_id,module,role'),
        ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;
      setProfiles((profileRows ?? []) as AdminProfile[]);
      setHeld(indexAssignments((roleRows ?? []) as RoleAssignment[]));
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
    async (userId: string, moduleName: Module, role: string, next: boolean) => {
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
          payload: { user_id: userId, module: moduleName, role },
        });
        if (rpcErr) throw rpcErr;
        toast.success(
          `${next ? 'Granted' : 'Revoked'} ${moduleName}:${role}`,
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
              <p className="tnum font-display text-2xl font-extrabold text-ink">{profiles.length}</p>
            </HeroStat>
            <HeroStat label="Scoped grants" align="right">
              <p className="tnum font-display text-2xl font-extrabold text-ink">{totalGrants}</p>
            </HeroStat>
          </div>
        }
      />

      <StaggerGrid className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StaggerItem>
          <StatCard label="Profiles" value={profiles.length} icon="list" tone="brand" hint="Employees + vendors" />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Scoped grants" value={totalGrants} icon="check" tone="emerald" hint="Across all modules" />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="External vendors" value={vendors} icon="building" tone="cyan" hint="kind = vendor" />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Backend" value="Live" icon="bell" tone="emerald" hint="Supabase connected" />
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
        <UserRoleTable
          profiles={profiles}
          held={held}
          roleColumns={columns}
          pending={pending}
          onToggle={(userId, moduleName, role, next) =>
            void toggle(userId, moduleName, role, next)
          }
          onOpenDetail={(id) => setDetailUserId(id)}
        />
      )}

      <Sheet
        open={Boolean(detailUser)}
        onOpenChange={(open) => {
          if (!open) setDetailUserId(null);
        }}
        title={detailUser?.full_name ?? detailUser?.email ?? 'User'}
        description={detailUser?.email}
        side="right"
      >
        {detailUser && (
          <UserDetail
            profile={detailUser}
            held={held.get(detailUser.id) ?? new Set()}
            roleColumns={columns}
            pending={pending}
            onToggle={(moduleName, role, next) =>
              void toggle(detailUser.id, moduleName, role, next)
            }
          />
        )}
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
        const set = held.get(row.id);
        if (!set || set.size === 0) {
          return <span className="text-xs text-faint">No roles</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {Array.from(set)
              .sort()
              .map((k) => (
                <span key={k} className="chip bg-inset text-xs text-muted">
                  {k}
                </span>
              ))}
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
}

function UserDetail({
  profile,
  held,
  roleColumns,
  pending,
  onToggle,
}: UserDetailProps) {
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
      Array.from(grouped.entries()).sort(([leftModule, left], [rightModule, right]) => {
        const leftAssigned = left.some((column) => held.has(column.key));
        const rightAssigned = right.some((column) => held.has(column.key));
        if (leftAssigned !== rightAssigned) return leftAssigned ? -1 : 1;
        if (leftModule === 'core' && rightModule !== 'core') return 1;
        if (rightModule === 'core' && leftModule !== 'core') return -1;
        return MODULE_LIST.indexOf(leftModule) - MODULE_LIST.indexOf(rightModule);
      }),
    [grouped, held],
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-inset p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {profile.full_name ?? profile.email}
            </p>
            <p className="truncate text-xs text-muted">{profile.email}</p>
          </div>
          <Badge tone={profile.kind === 'vendor' ? 'emerald' : 'brand'}>
            {profile.kind === 'vendor' ? 'Vendor' : 'Employee'}
          </Badge>
        </div>
        {profile.title && (
          <p className="mt-2 text-xs text-faint">{profile.title}</p>
        )}
        <p className="mt-2 text-xs text-faint">
          <span className="font-semibold text-muted">Current:</span>{' '}
          {summarizeRoles(held)}
        </p>
      </div>

      {orderedGroups.map(([moduleName, cols]) => (
        <section key={moduleName}>
          <SectionTitle
            title={MODULES[moduleName].label}
            subtitle={`module: ${moduleName}`}
          />
          <ul className="space-y-1">
            {cols.map((c) => {
              const checked = held.has(c.key);
              const rowPending = pending.has(`${profile.id}::${c.key}`);
              return (
                <li
                  key={c.key}
                  className="flex items-center justify-between gap-3 rounded-xl bg-inset/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">
                      {c.label}
                    </div>
                    <div className="truncate font-mono text-[0.7rem] text-faint">
                      {c.key}
                    </div>
                  </div>
                  <RoleCheckbox
                    checked={checked}
                    disabled={rowPending}
                    label={`${c.key} for ${profile.email}`}
                    onChange={(next) => onToggle(c.module, c.role, next)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
