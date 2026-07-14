import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Logo } from './Logo';
import { Icon, type IconName } from './Icon';
import { UserMenu } from './UserMenu';
import { useWarehouse } from '@/app/store';
import {
  MODULE_GROUP_LABELS,
  modulesForWarehouseAccess,
  primaryModulesForWarehouseAccess,
  type ModuleGroup,
} from '@/app/modules';
import { buildNotifications } from '@/app/notifications';
import { Sheet, useToast, PageTransition } from './ui';
import { ThemeToggle } from './ThemeToggle';
import { ContextualHelpLink } from '@intra/ui';

const MODULE_GROUP_ORDER: ModuleGroup[] = [
  'operate',
  'plan',
  'control',
  'analyze',
  'configure',
];

const WAREHOUSE_GUIDES = [
  { path: '/', articleId: 'feature-warehouse-dashboard', title: 'Warehouse dashboard' },
  { path: '/scan', articleId: 'feature-warehouse-scan', title: 'Warehouse scan' },
  { path: '/tasks', articleId: 'feature-warehouse-tasks', title: 'Warehouse tasks' },
  { path: '/inventory/:id', articleId: 'feature-warehouse-product-detail', title: 'Warehouse product detail' },
  { path: '/inventory', articleId: 'feature-warehouse-inventory', title: 'Inventory browser' },
  { path: '/receiving', articleId: 'feature-warehouse-receiving', title: 'Warehouse receiving' },
  { path: '/allocations', articleId: 'feature-warehouse-allocations', title: 'Stock allocations' },
  { path: '/returns', articleId: 'feature-warehouse-returns', title: 'Warehouse returns' },
  { path: '/storage', articleId: 'feature-warehouse-storage', title: 'Warehouse storage areas and bins' },
  { path: '/events/:id', articleId: 'feature-warehouse-event-detail', title: 'Warehouse event detail' },
  { path: '/events', articleId: 'feature-warehouse-events', title: 'Warehouse events' },
  { path: '/procurement', articleId: 'feature-warehouse-procurement-planning', title: 'Warehouse procurement planning' },
  { path: '/purchase-orders', articleId: 'feature-warehouse-purchase-orders', title: 'Warehouse purchase orders' },
  { path: '/cycle-counts', articleId: 'feature-warehouse-cycle-counts', title: 'Cycle counts' },
  { path: '/quality', articleId: 'feature-warehouse-quality', title: 'Quality control' },
  { path: '/approvals', articleId: 'feature-warehouse-approvals', title: 'Stock approvals' },
  { path: '/exceptions', articleId: 'feature-warehouse-exceptions', title: 'Warehouse exceptions' },
  { path: '/pricing', articleId: 'feature-warehouse-pricing', title: 'Warehouse pricing' },
  { path: '/data', articleId: 'feature-warehouse-data', title: 'Warehouse data and analytics' },
  { path: '/reports', articleId: 'feature-warehouse-reports', title: 'Inventory reports' },
  { path: '/suppliers', articleId: 'feature-warehouse-suppliers', title: 'Warehouse suppliers' },
  { path: '/locations', articleId: 'feature-warehouse-locations', title: 'Warehouse locations' },
  { path: '/imports', articleId: 'feature-warehouse-imports', title: 'Warehouse imports' },
  { path: '/operation-routes', articleId: 'feature-warehouse-operation-routes', title: 'Warehouse operation routes' },
] as const;

const routeMatches = (pattern: string, pathname: string) => {
  const expected = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  return expected.length === actual.length && expected.every(
    (segment, index) => segment.startsWith(':') || segment === actual[index],
  );
};

export function AppShell({ children }: { children: ReactNode }) {
  const {
    role,
    roleLabel,
    roleDescription,
    source,
    data,
    can,
    canOpenRoute,
    resetDemo,
    pendingSync,
    conflicts,
    syncNow,
    discardConflict,
  } = useWarehouse();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const modules = modulesForWarehouseAccess(source, role, can);
  const rolePresentation = { label: roleLabel, description: roleDescription };
  const pageGuide = WAREHOUSE_GUIDES.find((guide) =>
    routeMatches(guide.path, location.pathname),
  ) ?? WAREHOUSE_GUIDES[0];

  const [moreOpen, setMoreOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' && !navigator.onLine,
  );

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.pathname]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await syncNow();
      if (pendingSync === 0) toast.success('All changes synced.');
    } finally {
      setSyncing(false);
    }
  };

  const notifications = useMemo(
    () => (data ? buildNotifications(data, canOpenRoute) : []),
    [canOpenRoute, data],
  );

  const primary = primaryModulesForWarehouseAccess(source, role, can);
  const canScan = primary.some((module) => module.id === 'scan');
  const primaryIds = new Set(primary.map((module) => module.id));
  const remainingModules = modules.filter((module) => !primaryIds.has(module.id));
  const groupedModules = MODULE_GROUP_ORDER.map((group) => ({
    group,
    modules: modules.filter((module) => module.group === group),
  })).filter((section) => section.modules.length > 0);

  // Reset demo data is destructive (wipes + reseeds) — always confirm first
  // and give explicit feedback before the reload (WH-6).
  const requestReset = () => {
    setMoreOpen(false);
    setResetConfirmOpen(true);
  };
  const confirmReset = () => {
    setResetConfirmOpen(false);
    toast.success('Demo data reset — reloading fresh seed…');
    window.setTimeout(() => resetDemo(), 450);
  };

  return (
    <div className="h-dvh overflow-hidden bg-app md:flex md:h-auto md:min-h-screen md:overflow-visible">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex lg:w-64">
        <div className="safe-top flex items-center gap-2 px-5 py-5">
          <a href="/" className="flex min-w-0 items-center gap-2 transition hover:opacity-80" title="Mwell Intra home">
            <Logo className="h-7 w-auto" />
            <span className="text-xs font-semibold text-faint">Warehouse</span>
          </a>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Primary">
          {groupedModules.map((section) => (
            <section key={section.group} aria-labelledby={`warehouse-nav-${section.group}`}>
              <h2
                id={`warehouse-nav-${section.group}`}
                tabIndex={0}
                className="mb-1 px-3 text-[0.65rem] font-bold uppercase text-faint outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {MODULE_GROUP_LABELS[section.group]}
              </h2>
              <div className="space-y-1">
                {section.modules.map((module) => (
                  <SideLink
                    key={module.id}
                    to={module.path}
                    icon={module.icon as IconName}
                    label={module.label}
                  />
                ))}
              </div>
            </section>
          ))}
        </nav>
        <div className="safe-bottom border-t border-line px-5 py-4">
          <p className="text-sm font-semibold text-ink">{rolePresentation.label}</p>
          <p className="mt-0.5 text-xs text-muted">{rolePresentation.description}</p>
          {source === 'memory' && (
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
            'safe-top z-20 shrink-0 border-b border-line bg-surface/85 backdrop-blur transition-[padding,box-shadow] md:sticky md:top-0',
            scrolled && 'shadow-e1',
          )}
        >
          <div
            className={clsx(
              'flex items-center justify-between gap-3 px-4 sm:px-6 transition-[padding]',
              scrolled ? 'py-2' : 'py-3',
            )}
          >
            <div className="flex items-center gap-2 md:hidden">
              <Logo className="h-6 w-auto" />
            </div>
            {/* Visual brand only — the semantic <h1> belongs to each page's
                header so documents never carry two level-1 headings (WH-1). */}
            <p
              className="hidden font-display text-lg font-bold text-ink md:block"
              aria-hidden="true"
            >
              Intra <span className="text-faint">|</span> Warehouse
            </p>
            <div className="flex items-center gap-1.5">
              <span
                className={clsx(
                  'chip hidden sm:inline-flex',
                  source === 'supabase'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
                )}
                title={source === 'supabase' ? 'Connected to Supabase' : 'Offline demo data'}
              >
                {source === 'supabase' ? 'Live' : 'Demo'}
              </span>
              <ContextualHelpLink
                articleId={pageGuide.articleId}
                title={pageGuide.title}
              />
              {canScan && (
                <button
                  type="button"
                  onClick={() => navigate('/scan')}
                  aria-label="Quick scan"
                  className="grid h-11 w-11 place-items-center rounded-full text-muted transition hover:bg-inset hover:text-ink"
                >
                  <Icon name="scan" />
                </button>
              )}
              <ThemeToggle />
              {/* Branded "Module alerts" (not "Notifications") so it doesn't
                  contradict the shell's disabled demo bell (SH-7). */}
              <button
                type="button"
                onClick={() => setNotifOpen(true)}
                aria-label={`Module alerts (${notifications.length})`}
                title="Module alerts"
                className="relative grid h-11 w-11 place-items-center rounded-full text-muted transition hover:bg-inset hover:text-ink"
              >
                <Icon name="bell" />
                {notifications.length > 0 && (
                  <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[0.6rem] font-bold text-white">
                    {notifications.length}
                  </span>
                )}
              </button>
              <UserMenu />
            </div>
          </div>
        </header>

        {(offline || pendingSync > 0 || conflicts.length > 0) && (
          <div
            className="flex shrink-0 flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white"
            role="status"
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon name="alert" className="h-4 w-4" />
              {source === 'memory'
                ? 'Offline — changes are saved locally and sync when you reconnect.'
                : offline
                  ? `Offline — ${pendingSync} change(s) queued and will sync automatically when you reconnect.`
                  : pendingSync > 0
                    ? `${pendingSync} change(s) syncing…`
                    : null}
            </span>
            {source === 'supabase' && pendingSync > 0 && !offline && (
              <button
                type="button"
                onClick={() => void handleSyncNow()}
                disabled={syncing}
                className="underline disabled:opacity-60"
              >
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
            {conflicts.length > 0 && (
              <button
                type="button"
                onClick={() => setConflictsOpen(true)}
                className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5"
              >
                <Icon name="alert" className="h-3.5 w-3.5" /> {conflicts.length} conflict(s)
              </button>
            )}
          </div>
        )}

        <main
          data-testid="warehouse-scroll-region"
          className="mx-auto min-h-0 w-full max-w-5xl flex-1 scroll-pb-[calc(5rem+env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain px-4 py-5 pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:px-6 md:overflow-visible md:pb-10 xl:max-w-6xl"
        >
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
            style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}
          >
            {primary.map((m) => (
              <li key={m.id} className="flex-1">
                <BottomLink
                  to={m.path}
                  icon={m.icon as IconName}
                  label={m.shortLabel ?? m.label}
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
          source === 'memory' ? (
            <button type="button" className="btn-ghost w-full" onClick={requestReset}>
              <Icon name="rotate" className="h-4 w-4" /> Reset demo data
            </button>
          ) : undefined
        }
      >
        <ul className="space-y-1">
          <li>
            <a
              href="/"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-muted hover:bg-inset hover:text-ink"
            >
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-inset text-brand-700 dark:text-brand-300">
                <Icon name="grid" />
              </span>
              <span className="min-w-0">
                <span className="block">Mwell Intra home</span>
                <span className="block truncate text-xs text-faint">All modules</span>
              </span>
            </a>
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
                  <span className="block">{m.label}</span>
                  <span className="block truncate text-xs text-faint">
                    {m.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      {/* Notifications drawer */}
      <Sheet
        open={notifOpen}
        onOpenChange={setNotifOpen}
        title="Notifications"
        description={`${notifications.length} alert(s)`}
        side="right"
      >
        {notifications.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">You're all caught up.</p>
        ) : (
          <ul className="space-y-2" aria-label="Alerts">
            {notifications.map((n) => {
              const inner = (
                <>
                  <span
                    className={clsx(
                      'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                      n.tone === 'rose'
                        ? 'bg-rose-500/15 text-rose-500'
                        : n.tone === 'amber'
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-brand-500/10 text-brand-600 dark:text-brand-300',
                    )}
                  >
                    <Icon name={n.icon} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{n.title}</p>
                    <p className="text-xs text-muted">{n.detail}</p>
                  </div>
                </>
              );
              return (
                <li key={n.id}>
                  {n.to ? (
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 rounded-xl bg-inset p-3 text-left transition hover:bg-line"
                      onClick={() => {
                        setNotifOpen(false);
                        navigate(n.to!);
                      }}
                    >
                      {inner}
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
          Use this when you want a clean slate for a walkthrough. Your theme
          and sign-in are kept.
        </p>
      </Sheet>

      {/* Sync conflicts */}
      <Sheet
        open={conflictsOpen}
        onOpenChange={setConflictsOpen}
        title="Sync conflicts"
        description="These changes could not be applied and need your attention."
        side="right"
      >
        {conflicts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No conflicts.</p>
        ) : (
          <ul className="space-y-2" aria-label="Conflicted changes">
            {conflicts.map((c) => (
              <li key={c.id} className="rounded-xl bg-inset p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">{c.method}</span>
                  <button
                    type="button"
                    className="text-xs font-medium text-brand-700 dark:text-brand-300"
                    onClick={() => {
                      void discardConflict(c.id).then(() => {
                        toast.success('Discarded.');
                      });
                    }}
                  >
                    Discard
                  </button>
                </div>
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">
                  {c.error ?? 'Conflict'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}

function SideLink({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
          isActive
            ? 'bg-brand-500/12 text-brand-700 dark:text-brand-300'
            : 'text-muted hover:bg-inset hover:text-ink',
        )
      }
    >
      <Icon name={icon} />
      {label}
    </NavLink>
  );
}

function BottomLink({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'flex min-h-16 flex-col items-center justify-center gap-0.5 px-2 py-2.5 text-[0.65rem] font-medium transition',
          isActive ? 'text-brand-600 dark:text-brand-300' : 'text-faint',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              'grid h-7 w-12 place-items-center rounded-full transition',
              isActive && 'bg-brand-500/10',
            )}
          >
            <Icon name={icon} className="h-5 w-5" />
          </span>
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}
