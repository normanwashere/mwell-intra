'use client';

// Landing / dashboard (spec §1). Greets the signed-in user with the suite hero
// (matching the warehouse brand look), then surfaces cards for every surface
// they can access — modules, the vendor portal, and admin tools.

import Link from 'next/link';
import {
  Badge,
  Card,
  EmptyState,
  HeroChipButton,
  Icon,
  ModuleHero,
} from '@intra/ui';
import { useSession } from '@intra/auth';
import { can } from '@intra/rbac';
import {
  VENDOR_NAV,
  accessibleModules,
  type ModuleNav,
} from '@shell/lib/navigation';
import { cx } from '@shell/lib/cx';

const TONE_CLASS: Record<ModuleNav['tone'], string> = {
  brand: 'bg-brand-500/10 text-brand-700 dark:text-brand-300',
  accent: 'bg-cyan-500/10 text-cyan-800 dark:text-cyan-300',
  cyan: 'bg-cyan-500/10 text-cyan-800 dark:text-cyan-300',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  rose: 'bg-rose-500/15 text-rose-800 dark:text-rose-300',
  emerald: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  slate: 'bg-inset text-muted',
};

interface CardModel {
  href: string;
  label: string;
  description: string;
  icon: ModuleNav['icon'];
  tone: ModuleNav['tone'];
}

const ADMIN_CARD: CardModel = {
  href: '/admin/users',
  label: 'Admin — Users & Roles',
  description: 'Provision profiles, assign scoped module roles, review audit trail.',
  icon: 'list',
  tone: 'rose',
};

export default function DashboardPage() {
  const { profile, userRoles, loading, mode } = useSession();

  // Hydration-safe placeholder while the session restores.
  if (loading) {
    return (
      <div aria-hidden className="space-y-6">
        <div className="h-40 animate-pulse rounded-3xl bg-inset" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="h-32 animate-pulse rounded-2xl bg-inset" />
          <div className="h-32 animate-pulse rounded-2xl bg-inset" />
          <div className="h-32 animate-pulse rounded-2xl bg-inset" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6">
        <ModuleHero
          eyebrow="Mwell Intra"
          title="One internal OS for Warehouse, Procurement & Legal"
          description="Sign in to see the modules and tools available to your account."
          icon="grid"
          action={
            <HeroChipButton href="/login" icon="lock">
              Sign in
            </HeroChipButton>
          }
        />
        <EmptyState
          icon="lock"
          title="Please sign in"
          message="You'll land right back here with the modules your account can use."
        />
      </div>
    );
  }

  const cards: CardModel[] = accessibleModules(userRoles).map((m) => ({
    href: m.href,
    label: m.label,
    description: m.description,
    icon: m.icon,
    tone: m.tone,
  }));
  if (profile.kind === 'vendor') cards.push({ ...VENDOR_NAV });
  if (can(userRoles, 'core', 'manage_rbac')) cards.push(ADMIN_CARD);

  const firstName = profile.name?.split(/\s+/)[0] ?? 'there';
  const roleCount = Object.values(userRoles).reduce(
    (n, arr) => n + (arr?.length ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Welcome back,"
        title={firstName}
        description={
          profile.title
            ? profile.title
            : profile.kind === 'vendor'
              ? 'Vendor accreditation & document uploads.'
              : 'Pick a module to get started.'
        }
        icon="grid"
        action={
          cards.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {cards.slice(0, 2).map((c) => (
                <HeroChipButton key={c.href} href={c.href} icon={c.icon}>
                  {c.label.split(/\s+—\s+/)[0]}
                </HeroChipButton>
              ))}
            </div>
          ) : undefined
        }
        accessory={
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-100/70">
                Access
              </p>
              <p className="tnum text-2xl font-extrabold">
                {cards.length}
                <span className="ml-1 text-sm font-medium text-brand-100/70">
                  {cards.length === 1 ? 'module' : 'modules'}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-100/70">
                Scoped roles
              </p>
              <p className="tnum text-2xl font-extrabold">{roleCount}</p>
            </div>
          </div>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">
            Your workspace
          </p>
          <h2 className="font-display text-lg font-bold text-ink">
            {cards.length > 0 ? 'Jump into a surface' : 'No modules yet'}
          </h2>
        </div>
        <Badge tone={profile.kind === 'vendor' ? 'emerald' : 'brand'}>
          {profile.kind === 'vendor' ? 'External vendor' : 'Employee'}
        </Badge>
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon="info"
          title="No modules yet"
          message="You don't have a role in any module. Contact your administrator to get access."
          action={
            <span
              className={cx(
                'chip',
                mode === 'supabase'
                  ? 'bg-inset text-muted'
                  : 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
              )}
            >
              {mode === 'supabase' ? 'Live backend' : 'Demo mode · no backend'}
            </span>
          }
        />
      ) : (
        <div
          className={cx(
            'stagger grid gap-4',
            // When a user has 1 card, don't leave it stranded in the top-left of
            // a 3-column grid — center a single tile with a bounded width.
            cards.length === 1
              ? 'mx-auto max-w-md grid-cols-1'
              : cards.length === 2
                ? 'sm:grid-cols-2'
                : 'sm:grid-cols-2 lg:grid-cols-3',
          )}
        >
          {cards.map((c) => (
            <Link key={c.href} href={c.href} className="block">
              <Card interactive className="group flex h-full flex-col gap-3">
                <span
                  className={cx(
                    'grid h-11 w-11 place-items-center rounded-xl',
                    TONE_CLASS[c.tone],
                  )}
                >
                  <Icon name={c.icon} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h2 className="font-display text-base font-bold text-ink">
                      {c.label}
                    </h2>
                    <Icon
                      name="arrowRight"
                      className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-600 dark:group-hover:text-brand-300"
                    />
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{c.description}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
