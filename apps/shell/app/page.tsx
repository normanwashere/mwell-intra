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
  SectionTitle,
} from "@intra/ui";
import { useSession } from "@intra/auth";
import {
  OnboardingStatusBand,
  roleOrientationState,
  useLearning,
} from "@intra/learning";
import { dashboardAreas, type ModuleNav } from "@shell/lib/navigation";
import { useModuleBadges } from "@shell/lib/moduleBadges";
import { cx } from "@shell/lib/cx";
import {
  isOnboardingProtectedPath,
  onboardingHref,
} from "@shell/lib/onboardingGate";

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
  const { profile, userRoles, userCapabilities, loading, mode } = useSession();
  const { snapshot } = useLearning();
  // Live counts read from the module localStores (guarded; empty in SSR).
  const badges = useModuleBadges(profile, userRoles);

  // Hydration-safe placeholder while the session restores.
  if (loading) {
    return (
      <div aria-hidden className="space-y-6">
        <div className="h-40 animate-pulse rounded-lg bg-inset" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="h-32 animate-pulse rounded-lg bg-inset" />
          <div className="h-32 animate-pulse rounded-lg bg-inset" />
          <div className="h-32 animate-pulse rounded-lg bg-inset" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6">
        <ModuleHero
          eyebrow="Mwell Intra"
          title="One internal OS for every team"
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

  const cards: CardModel[] = dashboardAreas(
    { mode, userRoles, userCapabilities },
    profile.kind,
  ).map((m) => ({
    href: m.href,
    label: m.label,
    description: m.description,
    icon: m.icon,
    tone: m.tone,
  }));
  const quickAreas = cards.slice(0, 3);
  const orientation = roleOrientationState(snapshot);
  const modulesLocked =
    profile.kind === "employee" &&
    orientation.required &&
    !orientation.complete;
  const isDestinationLocked = (href: string) =>
    modulesLocked && isOnboardingProtectedPath(href);
  const destinationFor = (href: string) =>
    isDestinationLocked(href) ? onboardingHref(href) : href;

  const firstName = profile.name?.split(/\s+/)[0] ?? "there";

  return (
    <div className="space-y-6">
      {/* One KPI surface (SH-3/AD-2 rule): the hero accessory keeps ONLY the
          module count; the scoped-roles counter lives in the account menu.
          Explanatory description copy moved behind the (i) next to "Your
          workspace" below. */}
      <ModuleHero
        eyebrow={`Welcome back, ${firstName}`}
        title={profile.kind === "vendor" ? "Vendor workspace" : "Your Intra workspace"}
        description={
          profile.kind === "vendor"
            ? "Continue accreditation, evidence, and required declarations for your organization."
            : `Open the governed workspaces assigned to your ${profile.title ?? "current role"}.`
        }
        icon="grid"
        action={
          cards.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {quickAreas.map((c) => (
                <HeroChipButton
                  key={c.href}
                  href={destinationFor(c.href)}
                  icon={isDestinationLocked(c.href) ? "lock" : c.icon}
                >
                  {c.label}
                </HeroChipButton>
              ))}
              {cards.length > quickAreas.length && (
                <a
                  href="#workspace-areas"
                  className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink transition hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  +{cards.length - quickAreas.length} more below
                </a>
              )}
            </div>
          ) : undefined
        }
        accessory={
          <div>
            <p className="text-caption font-semibold uppercase tracking-wide text-faint">
              Areas available
            </p>
            <p className="tnum font-display text-2xl font-extrabold text-ink">
              <AnimatedNumber value={cards.length} />
              <span className="ml-1 text-sm font-medium text-muted">
                {cards.length === 1 ? "area" : "areas"}
              </span>
            </p>
          </div>
        }
      />

      {profile.kind === "employee" && <OnboardingStatusBand />}

      <div id="workspace-areas" className="scroll-mt-24">
        <SectionTitle
          eyebrow="Your workspace"
          title={cards.length > 0 ? "Available areas" : "No areas yet"}
          subtitle="Open a governed module or workspace available to your current roles."
          action={
            <div className="flex items-center gap-2">
              <InfoTip
                label="About your workspace"
                content={
                  profile.title
                    ? `Signed in as ${profile.title}. You see only the areas your roles grant; ask an administrator to widen access.`
                    : profile.kind === "vendor"
                      ? "Vendor accreditation & document uploads for your organization."
                      : "You see only the areas your roles grant; ask an administrator to widen access."
                }
              />
              <Badge tone={profile.kind === "vendor" ? "emerald" : "brand"}>
                {profile.kind === "vendor" ? "External vendor" : "Employee"}
              </Badge>
            </div>
          }
        />
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon="info"
          title="No areas yet"
          message="You don't have access to an operational area yet. Contact your administrator to request the right role."
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
        <div
          id="workspace-area-cards"
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
            const cardLocked = isDestinationLocked(c.href);
            return (
              <Link
                key={c.href}
                href={destinationFor(c.href)}
                className="block h-full"
                aria-label={
                  cardLocked ? `${c.label}, onboarding required` : undefined
                }
                data-onboarding-locked={cardLocked ? "true" : undefined}
              >
                <Card
                  interactive
                  data-tone={c.tone}
                  className="workflow-launcher group flex h-full min-h-36 flex-col gap-3"
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
                    {cardLocked ? (
                      <span className="chip bg-amber-500/15 font-semibold text-amber-800 dark:text-amber-300">
                        <Icon name="lock" className="h-3.5 w-3.5" />
                        Onboarding required
                      </span>
                    ) : badge ? (
                      <span className="chip bg-amber-500/15 font-semibold text-amber-800 dark:text-amber-300">
                        {badge.label}
                      </span>
                    ) : null}
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
                    <p className="mt-0.5 text-sm text-muted">{c.description}</p>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
