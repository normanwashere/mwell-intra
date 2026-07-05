import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Logo } from './Logo';
import { Icon, type IconName } from './Icon';
import { UserMenu } from './UserMenu';
import { useWarehouse } from '@/app/store';
import { modulesForRole, primaryModulesForRole } from '@/app/modules';
import { ROLES } from '@/auth/roles';
import { buildNotifications } from '@/app/notifications';
import { Sheet, Fab, useToast } from './ui';
import { ThemeToggle } from './ThemeToggle';
import { BarcodeScanner } from './camera/BarcodeScanner';

export function AppShell({ children }: { children: ReactNode }) {
  const { role, source, data, resetDemo, pendingSync, conflicts, syncNow, discardConflict } =
    useWarehouse();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const modules = modulesForRole(role);

  const [moreOpen, setMoreOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
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
    () => (data ? buildNotifications(data, role) : []),
    [data, role],
  );

  const primary = primaryModulesForRole(role);
  const hasMore = modules.length > primary.length;

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

  const handleScan = (code: string) => {
    setScanOpen(false);
    const product = data?.products.find(
      (p) => p.barcode === code || code.startsWith(p.sku),
    );
    if (product) {
      navigate(`/inventory/${product.id}`);
      toast.success(`Opened ${product.name}`);
    } else {
      toast.error(`No product matches "${code}"`);
    }
  };

  return (
    <div className="min-h-screen bg-app md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col bg-brand-grad text-white md:flex lg:w-64">
        <div className="safe-top flex items-center gap-2 px-5 py-5">
          <Logo className="h-7 w-auto" variant="light" />
          <span className="text-xs font-semibold text-brand-100/70">Intra</span>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Primary">
          {modules.map((m) => (
            <SideLink key={m.id} to={m.path} icon={m.icon as IconName} label={m.label} />
          ))}
        </nav>
        <div className="safe-bottom border-t border-white/10 px-5 py-4">
          <p className="text-sm font-semibold text-white">{ROLES[role].label}</p>
          <p className="mt-0.5 text-xs text-brand-100/70">{ROLES[role].description}</p>
          {source === 'memory' && (
            <button
              type="button"
              onClick={requestReset}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-100/70 transition hover:text-white"
            >
              <Icon name="rotate" className="h-3.5 w-3.5" /> Reset demo data
            </button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="safe-top sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
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
                  'chip',
                  source === 'supabase'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
                )}
                title={source === 'supabase' ? 'Connected to Supabase' : 'Offline demo data'}
              >
                {source === 'supabase' ? 'Live' : 'Demo'}
              </span>
              <button
                type="button"
                onClick={() => setScanOpen(true)}
                aria-label="Quick scan"
                className="hidden h-10 w-10 place-items-center rounded-full text-muted transition hover:bg-inset hover:text-ink md:grid"
              >
                <Icon name="scan" />
              </button>
              <ThemeToggle />
              {/* Branded "Module alerts" (not "Notifications") so it doesn't
                  contradict the shell's disabled demo bell (SH-7). */}
              <button
                type="button"
                onClick={() => setNotifOpen(true)}
                aria-label={`Module alerts (${notifications.length})`}
                title="Module alerts"
                className="relative grid h-10 w-10 place-items-center rounded-full text-muted transition hover:bg-inset hover:text-ink"
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
            className="flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white"
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

        {/* Clearance matches the shell main (Exec #3): fixed nav height +
            safe-area + headroom for sticky bars/sheets. */}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-10 xl:max-w-6xl">
          <div key={location.pathname} className="animate-fade-in">
            {children}
          </div>
        </main>

        {/* Mobile bottom navigation. Solid background (no translucency-only)
            + top border so partially covered content clearly sits BENEATH
            chrome instead of ghosting through it (Exec #3). */}
        <nav
          className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface md:hidden"
          aria-label="Primary mobile"
        >
          <ul className="flex">
            {primary.map((m) => (
              <li key={m.id} className="flex-1">
                <BottomLink
                  to={m.path}
                  icon={m.icon as IconName}
                  label={m.shortLabel ?? m.label}
                />
              </li>
            ))}
            {hasMore && (
              <li className="flex-1">
                <button
                  type="button"
                  onClick={() => setMoreOpen(true)}
                  className="flex w-full flex-col items-center gap-0.5 px-2 py-2.5 text-[0.65rem] font-medium text-faint"
                >
                  <Icon name="dots" className="h-5 w-5" />
                  More
                </button>
              </li>
            )}
          </ul>
        </nav>
      </div>

      {/* Quick-scan FAB */}
      <Fab onClick={() => setScanOpen(true)} icon="scan" label="Quick scan" mobileOnly />

      {/* Scanner sheet */}
      <Sheet
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Quick scan"
        description="Scan a product barcode to jump to its details."
      >
        <BarcodeScanner onDetected={handleScan} label="Start scanning" />
      </Sheet>

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
          {modules.map((m) => (
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
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
          isActive
            ? 'bg-white/15 text-white shadow-soft'
            : 'text-brand-100/80 hover:bg-white/10 hover:text-white',
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
          'flex flex-col items-center gap-0.5 px-2 py-2.5 text-[0.65rem] font-medium transition',
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
