'use client';

// Landing / dashboard (spec §1). Greets the signed-in user and surfaces cards
// for the modules they can access. Signed out → a friendly sign-in prompt.

import Link from 'next/link';
import { Badge, Card, EmptyState, Icon, PageHeader } from '@intra/ui';
import { useSession } from '@intra/auth';
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

export default function DashboardPage() {
  const { profile, userRoles } = useSession();

  if (!profile) {
    return (
      <div>
        <PageHeader
          title="Welcome to Mwell Intra"
          subtitle="One internal operating system for Warehouse, Procurement and Legal."
        />
        <EmptyState
          icon="lock"
          title="Please sign in"
          message="Sign in to see the modules and tools available to your account."
          action={
            <Link href="/login" className="btn-primary">
              <Icon name="lock" className="h-4 w-4" />
              Sign in
            </Link>
          }
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

  if (profile.kind === 'vendor') {
    cards.push({ ...VENDOR_NAV });
  }

  const firstName = profile.name?.split(/\s+/)[0] ?? 'there';

  return (
    <div>
      <PageHeader
        title={`Hello, ${firstName}`}
        subtitle={
          cards.length > 0
            ? 'Jump into a module below.'
            : 'Your account is set up. Module access will appear here once assigned.'
        }
        action={
          <Badge tone={profile.kind === 'vendor' ? 'emerald' : 'brand'}>
            {profile.kind === 'vendor' ? 'Vendor' : 'Employee'}
          </Badge>
        }
      />

      {cards.length === 0 ? (
        <EmptyState
          icon="info"
          title="No modules yet"
          message="You don't have a role in any module. Contact your administrator to get access."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
