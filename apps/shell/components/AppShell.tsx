"use client";

// Suite chrome v2 — clinical-modern workspace.
// Desktop: compact icon rail with flyout labels + dense content column.
// Mobile: bottom tab bar with raised context-aware center action + spring pill.

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import * as m from "framer-motion/m";
import { Icon, PageTransition, Sheet, type IconName } from "@intra/ui";
import { useSession } from "@intra/auth";
import {
  FINANCE_NAV,
  KNOWLEDGE_NAV,
  dashboardAreas,
  mobileCenterAction,
  type ShellNavItem,
} from "@shell/lib/navigation";
import { cx } from "@shell/lib/cx";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { CommandPalette } from "./CommandPalette";
import { MwellIntraLogo } from "./MwellIntraLogo";

interface NavEntry {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
}

const HOME_ENTRY: NavEntry = { href: "/", label: "Home", icon: "grid" };

function navItemToEntry(item: ShellNavItem): NavEntry {
  return { href: item.href, label: item.label, icon: item.icon };
}

function topBarLabel(pathname: string, entries: readonly NavEntry[]): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith(FINANCE_NAV.href)) return FINANCE_NAV.label;
  if (pathname.startsWith(KNOWLEDGE_NAV.href)) return KNOWLEDGE_NAV.label;
  if (pathname.startsWith("/admin/users")) return "Admin · Users & Roles";
  if (pathname.startsWith("/admin/doa"))
    return "Admin · Delegation of Authority";
  if (pathname.startsWith("/admin")) return "Admin";
  const match = entries.find(
    (e) => e.href !== "/" && pathname.startsWith(e.href),
  );
  if (match) return match.label;
  if (pathname.startsWith("/login")) return "Sign in";
  if (pathname.startsWith("/reset-password")) return "Reset password";
  return "";
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, userRoles, mode, loading } = useSession();
  const profileId = profile?.id;
  const pathname = usePathname() ?? "/";
  const reduced = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pageGuide, setPageGuide] = useState<{
    title: string;
    href: string;
  } | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  useEffect(() => {
    if (!profileId || pathname.startsWith("/knowledge")) {
      setPageGuide(null);
      return;
    }
    const controller = new AbortController();
    setPageGuide(null);
    fetch(`/api/knowledge/context?path=${encodeURIComponent(pathname)}`, {
      signal: controller.signal,
    })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as {
              guide: { title: string; href: string } | null;
            })
          : { guide: null },
      )
      .then((payload) => setPageGuide(payload.guide))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setPageGuide(null);
      });
    return () => controller.abort();
  }, [pathname, profileId]);

  const areas =
    loading || !profile ? [] : dashboardAreas(userRoles, profile.kind);
  const entries: NavEntry[] = [HOME_ENTRY, ...areas.map(navItemToEntry)];

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === FINANCE_NAV.href) return pathname.startsWith(FINANCE_NAV.href);
    if (href === "/warehouse") {
      return (
        pathname.startsWith("/warehouse") &&
        !pathname.startsWith(FINANCE_NAV.href)
      );
    }
    return pathname.startsWith(href);
  };

  const fab = mobileCenterAction(pathname, userRoles);
  const mobileLeft = entries.slice(0, 2);
  const hasMobileOverflow = entries.length > 4;
  const mobileRight = hasMobileOverflow
    ? entries.slice(2, 3)
    : entries.slice(2, 4);

  return (
    <div className="min-h-screen bg-app md:flex">
      <CommandPalette />

      {/* Desktop icon rail */}
      <aside
        className="safe-top hidden w-[4.75rem] shrink-0 flex-col items-center border-r border-line bg-surface py-4 md:flex lg:w-[12.5rem] lg:items-stretch"
        aria-label="Primary"
      >
        <Link
          href="/"
          className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl text-ink transition hover:bg-inset lg:mx-3 lg:w-auto lg:justify-start lg:px-2"
          aria-label="Mwell Intra home"
        >
          <span
            aria-hidden
            className="brand-gradient font-display text-2xl font-extrabold lg:hidden"
          >
            M
          </span>
          <MwellIntraLogo
            className="hidden lg:inline-flex"
            logoClassName="h-7"
            labelClassName="text-sm"
          />
        </Link>

        <nav
          className="flex flex-1 flex-col items-center gap-1 lg:items-stretch lg:px-3"
          aria-label="Primary"
        >
          {entries.map((e) => (
            <Link
              key={e.href}
              href={e.href}
              aria-label={e.label}
              aria-current={isActive(e.href) ? "page" : undefined}
              className={cx(
                "group relative grid h-11 w-11 place-items-center rounded-xl text-faint transition hover:bg-inset hover:text-ink lg:flex lg:w-full lg:justify-start lg:gap-3 lg:px-3",
                isActive(e.href) && "text-brand-700 dark:text-brand-300",
              )}
            >
              {isActive(e.href) && !reduced && (
                <m.span
                  layoutId="nav-rail-pill"
                  className="absolute inset-0 rounded-xl bg-brand-500/12"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              {isActive(e.href) && reduced && (
                <span className="absolute inset-0 rounded-xl bg-brand-500/12" />
              )}
              <Icon name={e.icon} className="relative h-5 w-5" />
              <span className="relative hidden min-w-0 truncate text-sm font-medium lg:block">
                {e.label}
              </span>
              <span
                className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink opacity-0 shadow-e2 transition group-hover:opacity-100 md:block lg:hidden"
                role="tooltip"
              >
                {e.label}
              </span>
            </Link>
          ))}
        </nav>

        <div className="mt-auto px-2 lg:px-3">
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", metaKey: true }),
              );
            }}
            className="flex h-10 w-10 items-center justify-center gap-3 rounded-xl border border-line bg-inset text-faint transition hover:text-ink lg:w-full lg:justify-start lg:px-3"
            aria-label="Open command palette"
            title="Command palette (⌘K)"
          >
            <Icon name="search" className="h-4 w-4" />
            <span className="hidden text-sm font-medium lg:inline">Search</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cx(
            "safe-top sticky top-0 z-20 border-b border-line/80 bg-surface/80 backdrop-blur-md transition-[padding,box-shadow]",
            scrolled && "shadow-e1 md:shadow-none",
          )}
        >
          <div
            className={cx(
              "flex items-center justify-between gap-3 px-4 sm:px-6 transition-[padding]",
              scrolled ? "py-2 md:py-3" : "py-3",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
              <BrandMark compact />
              {scrolled && (
                <p className="truncate font-display text-sm font-semibold text-ink">
                  {topBarLabel(pathname, entries) || "Home"}
                </p>
              )}
            </div>
            <p
              className="hidden truncate font-display text-title text-ink md:block"
              aria-hidden="true"
            >
              {topBarLabel(pathname, entries) || "Home"}
            </p>
            <div
              className="flex shrink-0 items-center gap-1.5"
              data-shell-header-actions="true"
            >
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "k", metaKey: true }),
                  );
                }}
                className="hidden items-center gap-2 rounded-xl border border-line bg-inset px-2.5 py-1.5 text-xs text-faint transition hover:text-muted md:inline-flex"
                aria-label="Open command palette"
              >
                <Icon name="search" className="h-3.5 w-3.5" />
                <span>Search</span>
                <kbd className="rounded border border-line bg-surface px-1 font-mono text-[0.6rem]">
                  ⌘K
                </kbd>
              </button>
              <span
                className={cx(
                  "chip hidden min-[360px]:inline-flex",
                  mode === "supabase"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
                )}
                title={
                  mode === "supabase"
                    ? "Connected to Supabase"
                    : "Demo data (no backend configured)"
                }
              >
                {mode === "supabase" ? "Live" : "Demo"}
              </span>
              {profile && !pathname.startsWith("/knowledge") && (
                <Link
                  href={pageGuide?.href ?? "/knowledge"}
                  aria-label={
                    pageGuide
                      ? `Help for ${pageGuide.title}`
                      : "Open the Knowledge Base"
                  }
                  title={
                    pageGuide
                      ? `Help for ${pageGuide.title}`
                      : "Open the Knowledge Base"
                  }
                  className="grid h-10 w-10 place-items-center rounded-xl text-faint transition hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <Icon name="info" className="h-5 w-5" />
                </Link>
              )}
              <NotificationBell />
              <span className="hidden min-[400px]:block">
                <ThemeToggle />
              </span>
              <UserMenu />
            </div>
          </div>
        </header>

        <main
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-[calc(11rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-10 xl:max-w-7xl"
          style={{ "--shell-header": "4.5rem" } as CSSProperties}
        >
          {loading ? (
            <div
              className="grid place-items-center py-24 text-muted"
              role="status"
              aria-live="polite"
            >
              <Icon name="rotate" className="h-6 w-6 animate-spin" />
              <span className="mt-2 text-sm">Restoring your session…</span>
            </div>
          ) : (
            <PageTransition id={pathname}>{children}</PageTransition>
          )}
        </main>

        {/* Mobile bottom navigation */}
        <nav
          className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur-md md:hidden"
          aria-label="Primary mobile"
        >
          <ul className="relative flex items-end px-2 pb-1 pt-2">
            {mobileLeft.map((e) => (
              <li key={e.href} className="min-w-0 flex-1">
                <MobileTab
                  entry={e}
                  active={isActive(e.href)}
                  reduced={!!reduced}
                />
              </li>
            ))}

            {fab && (
              <li className="flex w-16 min-w-0 shrink-0 justify-center">
                <Link
                  href={fab.href}
                  className="relative -mt-5 grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-e3 ring-4 ring-surface transition active:scale-95"
                  aria-label={fab.label}
                >
                  <Icon name={fab.icon} className="h-6 w-6" />
                </Link>
              </li>
            )}

            {mobileRight.map((e) => (
              <li key={e.href} className="min-w-0 flex-1">
                <MobileTab
                  entry={e}
                  active={isActive(e.href)}
                  reduced={!!reduced}
                />
              </li>
            ))}
            {hasMobileOverflow && (
              <li className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  className="relative flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[0.65rem] font-medium text-faint transition"
                  aria-haspopup="dialog"
                  aria-expanded={mobileMenuOpen}
                >
                  <Icon name="menu" className="h-5 w-5" />
                  <span>More</span>
                </button>
              </li>
            )}
          </ul>
        </nav>

        <Sheet
          open={mobileMenuOpen}
          onOpenChange={setMobileMenuOpen}
          title="All areas"
          description="Open any area available to your account."
        >
          <nav aria-label="All accessible areas">
            <ul className="space-y-1">
              {entries.map((entry) => (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    onClick={() => setMobileMenuOpen(false)}
                    aria-current={isActive(entry.href) ? "page" : undefined}
                    className={cx(
                      "flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-inset",
                      isActive(entry.href)
                        ? "bg-brand-500/10 text-brand-700 dark:text-brand-300"
                        : "text-ink",
                    )}
                  >
                    <Icon name={entry.icon} className="h-5 w-5 shrink-0" />
                    <span>{entry.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Sheet>
      </div>
    </div>
  );
}

function MobileTab({
  entry,
  active,
  reduced,
}: {
  entry: NavEntry;
  active: boolean;
  reduced: boolean;
}) {
  return (
    <Link
      href={entry.href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[0.65rem] font-medium transition",
        active ? "text-brand-700 dark:text-brand-300" : "text-faint",
      )}
    >
      {active && !reduced && (
        <m.span
          layoutId="nav-mobile-pill"
          className="absolute inset-x-1 inset-y-0.5 rounded-2xl bg-brand-500/10"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}
      {active && reduced && (
        <span className="absolute inset-x-1 inset-y-0.5 rounded-2xl bg-brand-500/10" />
      )}
      <Icon name={entry.icon} className="relative h-5 w-5" />
      <span className="relative block max-w-full text-center leading-tight break-words">
        {entry.label}
      </span>
    </Link>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <MwellIntraLogo
      logoClassName={compact ? "h-5" : "h-7"}
      labelClassName={compact ? "text-[0.65rem]" : "text-xs"}
    />
  );
}
