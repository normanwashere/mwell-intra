"use client";

// Landing / dashboard (spec §1). Greets the signed-in user with the suite hero
// (matching the warehouse brand look), then surfaces cards for every surface
// they can access — modules, the vendor portal, and admin tools.

import Link from "next/link";
import {
  AnimatedNumber,
  Badge,
  Card,
  EmptyState,
  HeroChipButton,
  Icon,
  InfoTip,
  ModuleHero,
  StaggerGrid,
  StaggerItem,
} from "@intra/ui";
import { useSession } from "@intra/auth";
import { can } from "@intra/rbac";
import {
  ADMIN_NAV,
  FINANCE_NAV,
  KNOWLEDGE_NAV,
  VENDOR_NAV,
  accessibleModules,
  type ModuleNav,
} from "@shell/lib/navigation";
import { useModuleBadges } from "@shell/lib/moduleBadges";
import { cx } from "@shell/lib/cx";

const TONE_CLASS: Record<ModuleNav["tone"], string> = {
  brand: "bg-brand-500/10 text-brand-700 dark:text-brand-300",
  accent: "bg-accent/15 text-accent",
  cyan: "bg-cyan-500/10 text-cyan-800 dark:text-cyan-300",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  rose: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
  emerald: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  slate: "bg-inset text-muted",
};

interface CardModel {
  href: string;
  label: string;
  description: string;
  icon: ModuleNav["icon"];
  tone: ModuleNav["tone"];
}

export default function DashboardPage() {
  const { profile, userRoles, loading, mode } = useSession();
  // Live counts read from the module localStores (guarded; empty in SSR).
  const badges = useModuleBadges(profile, userRoles);

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
  if (profile.kind === "vendor") cards.push({ ...VENDOR_NAV });
  if (can(userRoles, "warehouse", "view_finance"))
    cards.push({ ...FINANCE_NAV });
  if (can(userRoles, "core", "manage_rbac")) cards.push({ ...ADMIN_NAV });
  cards.push({ ...KNOWLEDGE_NAV });

  const firstName = profile.name?.split(/\s+/)[0] ?? "there";

  return (
    <div className="space-y-6">
      {/* One KPI surface (SH-3/AD-2 rule): the hero accessory keeps ONLY the
          module count; the scoped-roles counter lives in the account menu.
          Explanatory description copy moved behind the (i) next to "Your
          workspace" below. */}
      <ModuleHero
        eyebrow="Welcome back,"
        title={firstName}
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
          <div>
            <p className="text-caption font-semibold uppercase tracking-wide text-faint">
              Access
            </p>
            <p className="tnum font-display text-2xl font-extrabold text-ink">
              <AnimatedNumber value={cards.length} />
              <span className="ml-1 text-sm font-medium text-muted">
                {cards.length === 1 ? "module" : "modules"}
              </span>
            </p>
          </div>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-faint">
            Your workspace
            <InfoTip
              label="About your workspace"
              content={
                profile.title
                  ? `Signed in as ${profile.title}. You see only the modules your roles grant; ask an administrator to widen access.`
                  : profile.kind === "vendor"
                    ? "Vendor accreditation & document uploads for your organization."
                    : "You see only the modules your roles grant; ask an administrator to widen access."
              }
            />
          </p>
          <h2 className="font-display text-lg font-bold text-ink">
            {cards.length > 0 ? "Your modules" : "No modules yet"}
          </h2>
        </div>
        <Badge tone={profile.kind === "vendor" ? "emerald" : "brand"}>
          {profile.kind === "vendor" ? "External vendor" : "Employee"}
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
                "chip",
                mode === "supabase"
                  ? "bg-inset text-muted"
                  : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
              )}
            >
              {mode === "supabase" ? "Live backend" : "Demo mode · no backend"}
            </span>
          }
        />
      ) : (
        <StaggerGrid
          className={cx(
            "grid gap-4",
            cards.length === 1
              ? "mx-auto max-w-md grid-cols-1"
              : cards.length === 2
                ? "sm:grid-cols-2"
                : "sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {cards.map((c) => {
            const badge = badges[c.href];
            return (
              <StaggerItem key={c.href}>
                <Link href={c.href} className="block">
                  <Card
                    interactive
                    className="group flex h-full flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={cx(
                          "grid h-11 w-11 place-items-center rounded-xl",
                          TONE_CLASS[c.tone],
                        )}
                      >
                        <Icon name={c.icon} />
                      </span>
                      {badge && (
                        <span className="chip bg-amber-500/15 font-semibold text-amber-800 dark:text-amber-300">
                          {badge.label}
                        </span>
                      )}
                    </div>
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
                      <p className="mt-0.5 text-sm text-muted">
                        {c.description}
                      </p>
                    </div>
                  </Card>
                </Link>
              </StaggerItem>
            );
          })}
        </StaggerGrid>
      )}
    </div>
  );
}
