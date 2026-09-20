import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { isFloorWork, FLOOR_WORK_PATH } from "@/domain/workQueues";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { Logo } from "./Logo";
import { Icon, type IconName } from "./Icon";
import { UserMenu, WorkspaceNavigation } from "./UserMenu";
import { useWarehouse } from "@/app/store";
import {
  MODULE_GROUP_LABELS,
  modulesForWarehouseAccess,
  primaryModulesForWarehouseAccess,
  type ModuleGroup,
} from "@/app/modules";
import { buildNotifications, groupNotifications, type NotificationFilter } from "@/app/notifications";
import { Sheet, useToast, PageTransition } from "./ui";
import { ThemeToggle } from "./ThemeToggle";
import { ContextualHelpLink, DesktopNavigationToggle, useDesktopNavigation } from "@intra/ui";
import { SyncConflictDetails } from './SyncConflictDetails';

const MODULE_GROUP_ORDER: ModuleGroup[] = [
  "operate",
  "plan",
  "control",
  "analyze",
  "configure",
];

const WAREHOUSE_GUIDES = [
  {
    path: "/",
    articleId: "feature-warehouse-dashboard",
    title: "Warehouse dashboard",
  },
  {
    path: "/scan",
    articleId: "feature-warehouse-scan",
    title: "Warehouse scan",
  },
  {
    path: "/tasks",
    articleId: "feature-warehouse-tasks",
    title: "Warehouse tasks",
  },
  {
    path: "/inventory/:id",
    articleId: "feature-warehouse-product-detail",
    title: "Warehouse product detail",
  },
  {
    path: "/inventory",
    articleId: "feature-warehouse-inventory",
    title: "Inventory browser",
  },
  {
    path: "/receiving",
    articleId: "feature-warehouse-receiving",
    title: "Warehouse receiving",
  },
  {
    path: "/allocations",
    articleId: "feature-warehouse-allocations",
    title: "Stock allocations",
  },
  {
    path: "/fulfillment",
    articleId: "feature-warehouse-fulfillment",
    title: "Pick and pack fulfillment",
  },
  {
    path: "/returns",
    articleId: "feature-warehouse-returns",
    title: "Warehouse returns",
  },
  {
    path: "/storage",
    articleId: "feature-warehouse-storage",
    title: "Warehouse storage areas and bins",
  },
  {
    path: "/events/:id",
    articleId: "feature-warehouse-event-detail",
    title: "Warehouse event detail",
  },
  {
    path: "/events",
    articleId: "feature-warehouse-events",
    title: "Warehouse events",
  },
  {
    path: "/procurement",
    articleId: "feature-warehouse-procurement-planning",
    title: "Warehouse procurement planning",
  },
  {
    path: "/purchase-orders",
    articleId: "feature-warehouse-purchase-orders",
    title: "Warehouse purchase orders",
  },
  {
    path: "/cycle-counts",
    articleId: "feature-warehouse-cycle-counts",
    title: "Cycle counts",
  },
  {
    path: "/quality",
    articleId: "feature-warehouse-quality",
    title: "Quality control",
  },
  {
    path: "/approvals",
    articleId: "feature-warehouse-approvals",
    title: "Stock approvals",
  },
  {
    path: "/exceptions",
    articleId: "feature-warehouse-exceptions",
    title: "Warehouse exceptions",
  },
  {
    path: "/pricing",
    articleId: "feature-warehouse-pricing",
    title: "Warehouse pricing",
  },
  {
    path: "/data",
    articleId: "feature-warehouse-data",
    title: "Warehouse data and analytics",
  },
  {
    path: "/reports",
    articleId: "feature-warehouse-reports",
    title: "Inventory reports",
  },
  {
    path: "/suppliers",
    articleId: "feature-warehouse-suppliers",
    title: "Warehouse suppliers",
  },
  {
    path: "/locations",
    articleId: "feature-warehouse-locations",
    title: "Warehouse locations",
  },
  {
    path: "/imports",
    articleId: "feature-warehouse-imports",
    title: "Warehouse imports",
  },
  {
    path: "/operation-routes",
    articleId: "feature-warehouse-operation-routes",
    title: "Warehouse operation routes",
  },
] as const;

const routeMatches = (pattern: string, pathname: string) => {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  return (
    expected.length === actual.length &&
    expected.every(
      (segment, index) => segment.startsWith(":") || segment === actual[index],
    )
  );
};

export function AppShell({ children }: { children: ReactNode }) {
  const desktopNavigation = useDesktopNavigation();
  const {
    role,
    roleLabel,
    roleDescription,
    source,
    data,
    can,
    canOpenDestination,
    canOpenRoute,
    resetDemo,
    pendingSync,
    unresolvedLegacyCount,
    conflicts,
    syncNow,
    discardConflict,
  } = useWarehouse();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const modules = modulesForWarehouseAccess(
    source,
    role,
    can,
    canOpenDestination,
  );
  const rolePresentation = { label: roleLabel, description: roleDescription };
  const pageGuide =
    WAREHOUSE_GUIDES.find((guide) =>
      routeMatches(guide.path, location.pathname),
    ) ?? WAREHOUSE_GUIDES[0];

  const [moreOpen, setMoreOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [alertFilter, setAlertFilter] = useState<NotificationFilter>({});
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ModuleGroup>>(
    () => new Set<ModuleGroup>(["analyze", "configure"]),
  );
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" && !navigator.onLine,
  );

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [location.pathname]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await syncNow();
      if (pendingSync === 0) toast.success("All changes synced.");
    } finally {
      setSyncing(false);
    }
  };

  const notifications = useMemo(
    () => (data ? buildNotifications(data, canOpenRoute, {
      canRecommendReplenishment: source === 'supabase' && can('recommend_replenishment'),
      canIssueStock: can('issue_items'),
    }) : []),
    [can, canOpenRoute, data, source],
  );
  const alertGroups = groupNotifications(notifications, alertFilter);
  const filteredAlertCount = alertGroups.reduce((count, group) => count + group.items.length, 0);
  const actionableAlertCount = notifications.filter(alert => alert.actionable).length;

  const primary = primaryModulesForWarehouseAccess(
    source,
    role,
    can,
    canOpenDestination,
  );
  const canScan = primary.some((module) => module.id === "scan");
  const primaryIds = new Set(primary.map((module) => module.id));
  const remainingModules = modules.filter(
    (module) => !primaryIds.has(module.id),
  );
  const groupedModules = MODULE_GROUP_ORDER.map((group) => ({
    group,
    modules: modules.filter((module) => module.group === group),
  })).filter((section) => section.modules.length > 0);
  const pendingModuleCounts = useMemo(
    () => ({
      allocations:
        data?.allocations.filter((item) =>
          ["reserved", "allocated"].includes(item.status),
        ).length ?? 0,
      fulfillment:
        data?.fulfillmentOrders.filter(
          isFloorWork,
        ).length ?? 0,
    }),
    [data],
  );
  const activeGroup = modules.find((module) =>
    module.path === "/"
      ? location.pathname === "/"
      : location.pathname === module.path ||
        location.pathname.startsWith(`${module.path}/`),
  )?.group;

  useEffect(() => {
    if (!activeGroup) return;
    setCollapsedGroups((current) => {
      if (!current.has(activeGroup)) return current;
      const next = new Set(current);
      next.delete(activeGroup);
      return next;
    });
  }, [activeGroup]);

  const toggleGroup = (group: ModuleGroup) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // Reset demo data is destructive (wipes + reseeds) — always confirm first
  // and give explicit feedback before the reload (WH-6).
  const requestReset = () => {
    setMoreOpen(false);
    setResetConfirmOpen(true);
  };
  const confirmReset = () => {
    setResetConfirmOpen(false);
    toast.success("Demo data reset — reloading fresh seed…");
    window.setTimeout(() => resetDemo(), 450);
  };

  return (
    <div className="h-dvh overflow-hidden bg-app md:flex md:h-auto md:min-h-screen md:overflow-visible">
      {/* Desktop sidebar */}
      <aside id="warehouse-side-navigation" style={desktopNavigation.hidden ? { display: "none" } : undefined} className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:self-start lg:w-64">
        <div className="safe-top flex shrink-0 items-center gap-2 px-5 py-3">
          <a
            href="/"
            aria-label="Mwell Intra home"
            className="flex min-h-11 min-w-0 items-center gap-2 transition hover:opacity-80"
            title="Mwell Intra home"
          >
            <Logo className="h-7 w-auto" />
            <span className="text-xs font-bold text-ink">Intra</span>
            <span className="rounded-md bg-inset px-1.5 py-1 text-[0.65rem] font-semibold text-muted">
              Warehouse
            </span>
          </a>
        </div>
        <nav
          className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 pb-4"
          aria-label="Primary"
        >
          {groupedModules.map((section) => (
            <section
              key={section.group}
              aria-labelledby={`warehouse-nav-${section.group}`}
            >
              <h2 id={`warehouse-nav-${section.group}`} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(section.group)}
                  aria-expanded={!collapsedGroups.has(section.group)}
                  aria-controls={`warehouse-nav-${section.group}-items`}
                  className="flex min-h-11 w-full items-center justify-between rounded-md px-3 text-[0.65rem] font-bold uppercase text-faint transition hover:bg-inset hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <span>{MODULE_GROUP_LABELS[section.group]}</span>
                  <Icon
                    name="chevron"
                    className={clsx(
                      "h-3.5 w-3.5 transition-transform",
                      !collapsedGroups.has(section.group) && "rotate-90",
                    )}
                  />
                </button>
              </h2>
              {!collapsedGroups.has(section.group) && (
                <div
                  id={`warehouse-nav-${section.group}-items`}
                  className="space-y-1"
                >
                  {section.modules.map((module) => (
                    <SideLink
                      key={module.id}
                      to={module.id === "fulfillment" ? FLOOR_WORK_PATH : module.path}
                      icon={module.icon as IconName}
                      label={module.label}
                      count={
                        pendingModuleCounts[
                          module.id as keyof typeof pendingModuleCounts
                        ]
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </nav>
        <div className="safe-bottom shrink-0 border-t border-line px-5 py-4">
          <p className="text-sm font-semibold text-ink">
            {rolePresentation.label}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {rolePresentation.description}
          </p>
          {source === "memory" && (
            <button
              type="button"
              onClick={requestReset}
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1.5 text-xs font-medium text-muted transition hover:bg-inset hover:text-ink"
            >
              <Icon name="rotate" className="h-3.5 w-3.5" /> Reset demo data
            </button>
          )}
        </div>
      </aside>

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col md:h-auto md:min-h-screen">
        {/* Top bar */}
        <header
          className={clsx(
            "safe-top z-20 shrink-0 border-b border-line bg-surface/85 backdrop-blur transition-[padding,box-shadow] md:sticky md:top-0",
            scrolled && "shadow-e1",
          )}
        >
          <div
            className={clsx(
              "flex items-center justify-between gap-3 px-4 sm:px-6 transition-[padding]",
              scrolled ? "py-2" : "py-3",
            )}
          >
            <div
              className="flex min-w-0 items-center gap-1.5 md:hidden"
              aria-label="Mwell Intra Warehouse"
            >
              <Logo className="h-5 w-auto shrink-0" />
              <span className="min-w-0 leading-tight">
                <span className="block text-[0.65rem] font-bold text-ink">
                  Intra · Warehouse
                </span>
                <span className="block max-w-28 truncate text-[0.6rem] text-faint">
                  {roleLabel.replace(/^Warehouse\s+/i, "")}
                </span>
              </span>
            </div>
            {/* Visual brand only — the semantic <h1> belongs to each page's
                header so documents never carry two level-1 headings (WH-1). */}
            <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
            <DesktopNavigationToggle hidden={desktopNavigation.hidden} onToggle={desktopNavigation.toggle} controls="warehouse-side-navigation" />
            <p
              className="font-display text-lg font-bold text-ink"
              aria-hidden="true"
            >
              Intra <span className="text-faint">|</span> Warehouse
            </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={clsx(
                  "chip hidden sm:inline-flex",
                  source === "supabase"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
                )}
                title={
                  source === "supabase"
                    ? "Connected to Supabase"
                    : "Offline demo data"
                }
              >
                {source === "supabase" ? "Live" : "Demo"}
              </span>
              <ContextualHelpLink
                articleId={pageGuide.articleId}
                title={pageGuide.title}
              />
              {canScan && (
                <button
                  type="button"
                  onClick={() => navigate("/scan")}
                  aria-label="Quick scan"
                  className="grid h-11 w-11 place-items-center rounded-full text-muted transition hover:bg-inset hover:text-ink"
                >
                  <Icon name="scan" />
                </button>
              )}
              <span className="hidden min-[420px]:block">
                <ThemeToggle />
              </span>
              {/* Active warehouse issues are distinct from persisted suite notifications. */}
              <button
                type="button"
                onClick={() => setNotifOpen(true)}
                aria-label={`Warehouse alerts (${notifications.length} active)`}
                title="Warehouse alerts"
                className="relative flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-md text-muted transition hover:bg-inset hover:text-ink"
              >
                <Icon name="bell" className="h-4 w-4" />
                <span className="text-[0.6rem] font-semibold">Alerts</span>
                {notifications.length > 0 && (
                  <span className="absolute right-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-700 px-1 text-[0.65rem] font-bold leading-none text-white">
                    {notifications.length}
                  </span>
                )}
              </button>
              <UserMenu />
            </div>
          </div>
          <div className="border-t border-line px-4 sm:px-6">
            <WorkspaceNavigation />
          </div>
        </header>

        {(offline || pendingSync > 0 || conflicts.length > 0) && (
          <div
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-y border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
            role="status"
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon name="alert" className="h-4 w-4" />
              {offline && source === "memory"
                ? "Offline — changes are saved locally and sync when you reconnect."
                : offline
                  ? `Offline — ${pendingSync} change(s) queued and will sync automatically when you reconnect.`
                  : pendingSync > 0
                    ? `${pendingSync} change(s) syncing…`
                    : 'Some saved changes need review.'}
            </span>
            {source === "supabase" && pendingSync > 0 && !offline && (
              <button
                type="button"
                onClick={() => void handleSyncNow()}
                disabled={syncing}
                className="underline disabled:opacity-60"
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            )}
            {conflicts.length > 0 && (
              <button
                type="button"
                onClick={() => setConflictsOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={conflictsOpen}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-amber-600 px-3 py-2 font-semibold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <Icon name="alert" className="h-3.5 w-3.5" /> {conflicts.length}{" "}
                {conflicts.length === 1 ? 'conflict' : 'conflicts'} - View details
              </button>
            )}
          </div>
        )}

        <main
          style={desktopNavigation.hidden ? { maxWidth: "none" } : undefined}
          data-testid="warehouse-scroll-region"
          aria-label="Warehouse workspace"
          tabIndex={0}
          className="workspace-hierarchy mx-auto min-h-0 w-full max-w-5xl flex-1 scroll-pb-[calc(5rem+env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain px-4 py-5 pb-[calc(7.5rem+env(safe-area-inset-bottom))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:px-6 md:overflow-visible md:pb-10 xl:max-w-6xl"
        >
          {unresolvedLegacyCount > 0 && (
            <div role="status" aria-label="Unresolved legacy queue" className="mb-4 space-y-1 border-y border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="font-semibold">{unresolvedLegacyCount} unresolved legacy queued action{unresolvedLegacyCount === 1 ? '' : 's'} on this device.</p>
              <p>Ask your account administrator to reconcile them against server receipts and movements before re-entering these actions or clearing this device's saved data.</p>
              <p>They will not be automatically assigned, replayed, or deleted.</p>
            </div>
          )}
          <PageTransition
            id={location.pathname}
            className="warehouse-workspace min-w-0 max-w-full"
          >
            {children}
          </PageTransition>
        </main>

        {/* Mobile primary navigation stays in the thumb zone as shell chrome,
            outside the scrolling page area, so controls never slide behind it. */}
        <nav
          className="safe-bottom z-30 shrink-0 border-t border-line bg-surface/95 shadow-e2 backdrop-blur-md md:hidden"
          aria-label="Primary mobile"
        >
          <ul
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))`,
            }}
          >
            {primary.map((m) => (
              <li key={m.id} className="flex-1">
                <BottomLink
                  to={m.path}
                  icon={m.icon as IconName}
                  label={m.shortLabel ?? m.label}
                  count={
                    pendingModuleCounts[
                      m.id as keyof typeof pendingModuleCounts
                    ]
                  }
                />
              </li>
            ))}
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                className="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[0.65rem] font-medium text-faint transition hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
              >
                <Icon name="dots" className="h-5 w-5" />
                <span className="max-w-full truncate">More</span>
              </button>
            </li>
          </ul>
        </nav>
      </div>

      {/* More drawer */}
      <Sheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title="All tools"
        side="right"
        footer={
          source === "memory" ? (
            <button
              type="button"
              className="btn-ghost w-full"
              onClick={requestReset}
            >
              <Icon name="rotate" className="h-4 w-4" /> Reset demo data
            </button>
          ) : undefined
        }
      >
        <ul className="space-y-1">
          <li className="min-[420px]:hidden">
            <div className="flex min-h-12 items-center justify-between gap-3 rounded-lg px-3 py-2">
              <span className="flex items-center gap-3 text-sm font-medium text-ink">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-inset text-muted">
                  <Icon name="moon" />
                </span>
                Appearance
              </span>
              <ThemeToggle />
            </div>
          </li>
          <li>
            <WorkspaceNavigation />
          </li>
          {remainingModules.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  navigate(m.path);
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-ink hover:bg-inset"
              >
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
                  <Icon name={m.icon as IconName} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="block">{m.label}</span>
                    {(pendingModuleCounts[
                      m.id as keyof typeof pendingModuleCounts
                    ] ?? 0) > 0 && (
                      <span
                        className="grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[0.65rem] font-bold text-white"
                        aria-hidden="true"
                        title={`${pendingModuleCounts[m.id as keyof typeof pendingModuleCounts]} pending`}
                      >
                        {pendingModuleCounts[
                          m.id as keyof typeof pendingModuleCounts
                        ] > 99
                          ? "99+"
                          : pendingModuleCounts[
                              m.id as keyof typeof pendingModuleCounts
                            ]}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-faint">
                    {m.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      {/* Warehouse alerts drawer */}
      <Sheet
        open={notifOpen}
        onOpenChange={setNotifOpen}
        title="Warehouse alerts"
        description={`${notifications.length} active warehouse issues, not unread notifications. Highest priority first; alerts remain until the underlying issue is resolved.`}
        side="right"
      >
        <div className="mb-4 space-y-3 border-b border-line pb-4">
          <label className="block text-xs font-medium text-muted">
            Search alerts
            <input type="search" className="input mt-1 w-full" value={alertFilter.search ?? ''}
              onChange={event => setAlertFilter(current => ({ ...current, search: event.target.value }))} />
          </label>
          <div className="grid grid-cols-1 gap-3">
            <label className="block min-w-0 text-xs font-medium text-muted">
              Alert scope
              <select className="input mt-1 w-full" value={alertFilter.scope ?? 'all'}
                onChange={event => setAlertFilter(current => ({ ...current, scope: event.target.value as NotificationFilter['scope'] }))}>
                <option value="all">All active ({notifications.length})</option>
                <option value="actionable">Actionable ({actionableAlertCount})</option>
                <option value="informational">Informational ({notifications.length - actionableAlertCount})</option>
              </select>
            </label>
            <label className="block min-w-0 text-xs font-medium text-muted">
              Issue type
              <select className="input mt-1 w-full" value={alertFilter.issueType ?? 'all'}
                onChange={event => setAlertFilter(current => ({ ...current, issueType: event.target.value as NotificationFilter['issueType'] }))}>
                <option value="all">All issue types</option>
                <option value="shortage">Stock shortages</option>
                <option value="reservation">Reservations</option>
              </select>
            </label>
          </div>
          <p role="status" className="text-xs text-muted">{filteredAlertCount} of {notifications.length} active issues</p>
        </div>
        {notifications.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            You're all caught up.
          </p>
        ) : alertGroups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No alerts match these filters.</p>
        ) : (
          <div className="space-y-3">
          {alertGroups.map(group => (
          <details key={`${group.id}:${alertFilter.search ?? ''}:${alertFilter.scope ?? 'all'}:${alertFilter.issueType ?? 'all'}`}
            open={Boolean(alertFilter.search?.trim()) || undefined} className="border-b border-line pb-3">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink [overflow-wrap:anywhere]">
              {group.issueType === 'shortage' ? 'Stock shortages' : 'Reservations'} / {group.owner} ({group.items.length})
            </summary>
          <ul className="space-y-2" aria-label={`${group.issueType} alerts for ${group.owner}`}>
            {group.items.map((n) => {
              const inner = (
                <>
                  <span
                    className={clsx(
                      "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                      n.tone === "rose"
                        ? "bg-rose-500/15 text-rose-500"
                        : n.tone === "amber"
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : "bg-brand-500/10 text-brand-600 dark:text-brand-300",
                    )}
                  >
                    <Icon name={n.icon} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{n.title}</p>
                    <p className="text-xs text-muted [overflow-wrap:anywhere]">{n.detail}</p>
                    <p className="mt-1 text-xs font-medium text-muted [overflow-wrap:anywhere]">{n.nextStep}</p>
                  </div>
                </>
              );
              return (
                <li key={n.id}>
                  {n.to ? (
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-start gap-3 rounded-lg bg-inset p-3 text-left transition hover:bg-line"
                      onClick={() => {
                        setNotifOpen(false);
                        navigate(n.to!);
                      }}
                    >
                      {inner}
                      <Icon name="chevron" className="ml-auto mt-1 h-4 w-4 shrink-0" />
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 rounded-xl bg-inset p-3">
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </details>
          ))}
          </div>
        )}
      </Sheet>

      {/* Reset demo data — confirm before the destructive wipe (WH-6). */}
      <Sheet
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Reset demo data?"
        description="This wipes every local change (receipts, counts, allocations…) and reloads the fresh demo seed. This cannot be undone."
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost flex-1 justify-center"
              onClick={() => setResetConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 justify-center"
              onClick={confirmReset}
            >
              <Icon name="rotate" className="h-4 w-4" /> Reset demo data
            </button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          Use this when you want a clean slate for a walkthrough. Your theme and
          sign-in are kept.
        </p>
      </Sheet>

      {/* Sync conflicts */}
      <Sheet
        open={conflictsOpen}
        onOpenChange={setConflictsOpen}
        title="Sync conflicts"
        description="These saved changes need review before you try again."
        side="right"
        size="wide"
      >
        <p tabIndex={-1} data-sheet-initial-focus className="mb-4 border-b border-line pb-4 text-sm text-muted focus:outline-none">Check the affected record and its history before submitting it again. Discard removes only this device's queued copy; it does not undo any change already saved on the server.</p>
        {conflicts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No conflicts.</p>
        ) : (
          <ul className="space-y-2" aria-label="Conflicted changes">
            {conflicts.map((c) => (
              <li key={c.id} className="space-y-3 border-b border-line py-4 last:border-0">
                <SyncConflictDetails entry={c} data={data} />
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn-outline min-h-11 text-sm"
                    onClick={() => {
                      void discardConflict(c.id).then(() => {
                        toast.success("Queued copy discarded.");
                      }).catch(() => toast.error("We could not confirm the queued copy was discarded. Reopen this list to check before trying again."));
                    }}
                  >
                    Discard queued copy
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}

function SideLink({
  to,
  icon,
  label,
  count = 0,
}: {
  to: string;
  icon: IconName;
  label: string;
  count?: number;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        clsx(
          "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
          isActive
            ? "bg-brand-500/12 text-brand-700 dark:text-brand-300"
            : "text-muted hover:bg-inset hover:text-ink",
        )
      }
    >
      <Icon name={icon} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          className="grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[0.65rem] font-bold text-white"
          aria-hidden="true"
          title={`${count} pending`}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </NavLink>
  );
}

function BottomLink({
  to,
  icon,
  label,
  count = 0,
}: {
  to: string;
  icon: IconName;
  label: string;
  count?: number;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        clsx(
          "flex min-h-16 flex-col items-center justify-center gap-0.5 px-0.5 py-2.5 text-[0.65rem] font-medium transition",
          isActive ? "text-brand-600 dark:text-brand-300" : "text-faint",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              "relative grid h-7 w-12 place-items-center rounded-full transition",
              isActive && "bg-brand-500/10",
            )}
          >
            <Icon name={icon} className="h-5 w-5" />
            {count > 0 && (
              <span
                className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-0.5 text-[0.55rem] font-bold text-white"
                aria-hidden="true"
                title={`${count} pending`}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </span>
          <span className="flex min-h-7 max-w-full items-center text-center leading-tight [overflow-wrap:anywhere]">{label}</span>
        </>
      )}
    </NavLink>
  );
}
