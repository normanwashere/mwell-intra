'use client';

// NotificationBell — the suite-wide in-app notification surface (spec §4.7, §8).
//
// The nightly jobs (migration #22) populate core.notifications for the signed-in
// user; this component polls that table and lets the user mark rows read via the
// core.mark_notification_read RPC.  It intentionally reads via the standard
// browser Supabase client (schema pinned to `core` by client.ts) so RLS on
// core.notifications naturally scopes rows to `user_id = auth.uid()` — no
// user_id filter is needed here.
//
// Memory / demo mode (no NEXT_PUBLIC_SUPABASE_* env) has no live backend, so
// this component gracefully no-ops: the bell renders dimmed and disabled, with
// an aria-label explaining why.  This preserves the invariant that the shell
// builds and runs with no live backend (LLD §10, ADR-003).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Sheet } from '@intra/ui';
import { useSession } from '@intra/auth';
import { ENABLE_NOTIFICATIONS } from '@shell/lib/supabase/env';
import type { ShellSupabaseClient } from '@shell/lib/supabase/types';
import { cx } from '@shell/lib/cx';

/** How often we re-fetch notifications in supabase mode. */
const POLL_INTERVAL_MS = 60_000;
/** Cap the dropdown at the latest N rows. */
const MAX_ROWS = 10;

export interface NotificationRow {
  readonly id: string;
  readonly kind: string;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly read_at: string | null;
  readonly created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  accreditation_expired: 'Vendor accreditation expired',
  accreditation_renewal_due: 'Vendor accreditation renewal due',
  approval_overdue: 'Approval past its due date',
  approval_pending: 'Approval waiting on you',
  accreditation_expiring: 'Vendor accreditation expiring',
};

function labelFor(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/_/g, ' ');
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function sortNotifications(rows: NotificationRow[], unreadOnly: boolean, unreadFirst: boolean) {
  return rows.filter(row => !unreadOnly || row.read_at === null).sort((a, b) => {
    if (unreadFirst && (a.read_at === null) !== (b.read_at === null)) return a.read_at === null ? -1 : 1;
    return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || a.id.localeCompare(b.id);
  });
}

export function NotificationBell() {
  const { profile, mode, supabaseClient } = useSession();
  const client = supabaseClient as ShellSupabaseClient | null;

  // Memory mode OR no client OR signed-out → no-op (dimmed bell, no popover).
  const disabled = mode !== 'supabase' || !ENABLE_NOTIFICATIONS || !client || !profile;

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [initialFetch, setInitialFetch] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadFirst, setUnreadFirst] = useState(true);
  const readInFlight = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Poll core.notifications while signed in with a live backend.  RLS scopes
  // rows to auth.uid() so we don't add a user_id filter (that also means the
  // manage_notifications tier sees a global stream, which is intentional).
  useEffect(() => {
    if (disabled || !client) return;
    let active = true;
    let fetching = false;

    const fetchRows = async () => {
      if (!active || fetching || document.visibilityState === 'hidden') return;
      fetching = true;
      setRefreshing(true);
      try {
        const { data, error } = await client
          .from('notifications')
          .select('id, kind, entity_type, entity_id, read_at, created_at')
          .order('created_at', { ascending: false })
          .limit(MAX_ROWS);
        if (!active) return;
        if (!error && Array.isArray(data)) {
          setRows(data as NotificationRow[]);
          setLoadFailed(false);
        } else {
          setLoadFailed(true);
        }
      } catch {
        // Route changes can abort the live fetch. Notifications are secondary,
        // so keep the shell quiet and leave the last known list in place.
        if (!active) return;
        setLoadFailed(true);
      } finally {
        fetching = false;
        if (active) {
          setInitialFetch(true);
          setRefreshing(false);
        }
      }
    };

    void fetchRows();
    const timer = window.setInterval(fetchRows, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', fetchRows);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', fetchRows);
    };
  }, [client, disabled, retryVersion]);

  const unread = useMemo(
    () => rows.reduce((n, r) => (r.read_at === null ? n + 1 : n), 0),
    [rows],
  );

  const markRead = useCallback(
    async (id: string) => {
      if (!client || readInFlight.current) return;
      readInFlight.current = true;
      setBusyId(id);
      setReadError(null);
      try {
        const { error } = await client.rpc('mark_notification_read', {
          payload: { notification_id: id },
        });
        if (error) throw error;
        if (!error) {
          const nowIso = new Date().toISOString();
          setRows((prev) =>
            prev.map((r) =>
              r.id === id ? { ...r, read_at: r.read_at ?? nowIso } : r,
            ),
          );
        }
      } catch {
        setReadError('We could not confirm this was marked as read. Refresh the list to check, then try again if it is still unread.');
      } finally {
        readInFlight.current = false;
        setBusyId(null);
      }
    },
    [client],
  );

  const ariaLabel = disabled
    ? mode === 'supabase'
      ? ENABLE_NOTIFICATIONS
        ? 'Notifications (sign in to view)'
        : 'Notifications are not available in this environment'
      : 'Notifications unavailable in demo mode'
    : `Notifications${unread > 0 ? `, ${unread} unread in the latest ${MAX_ROWS}` : ''}`;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        title={ariaLabel}
        className={cx(
          'relative grid h-11 w-11 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          disabled
            ? 'cursor-not-allowed text-faint/50'
            : 'text-muted hover:bg-inset hover:text-ink',
        )}
      >
        <Icon name="bell" />
        {!disabled && unread > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-700 px-1 text-[0.65rem] font-bold leading-none text-white shadow-e1"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <Sheet open={open && !disabled} onOpenChange={setOpen} side="right" title="Notifications"
        description={`Latest ${MAX_ROWS} notifications you have access to. Older notifications are not included in this count.`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Recent activity</p>
              <p className="text-xs text-muted">
                Opening this panel does not mark notifications as read.
              </p>
            </div>
            <span
              className={cx(
                'chip',
                unread > 0
                  ? 'bg-rose-500/15 text-rose-800 dark:text-rose-300'
                  : 'bg-inset text-muted',
              )}
            >
              {notificationSummary(initialFetch, loadFailed, unread)}
            </span>
          </div>

          <div className="grid grid-cols-[1fr_auto] items-end gap-3 border-b border-line py-3 text-sm">
            <div role="group" aria-label="Notification filter" className="flex gap-1">
              {[false, true].map(value => <button key={String(value)} type="button" aria-pressed={unreadOnly === value}
                className={cx('min-h-11 rounded-md px-3 font-semibold', unreadOnly === value ? 'bg-inset text-ink ring-1 ring-line' : 'text-muted')}
                onClick={() => setUnreadOnly(value)}>{value ? 'Unread' : 'All'}</button>)}
            </div>
            <label className="col-span-2 row-start-2 min-w-0">Sort
              <select className="input mt-1" value={unreadFirst ? 'unread' : 'newest'} onChange={event => setUnreadFirst(event.target.value === 'unread')}>
                <option value="unread">Unread first</option><option value="newest">Newest first</option>
              </select>
            </label>
            <button type="button" className="btn-ghost col-start-2 row-start-1 min-h-11 min-w-11" title="Refresh notifications" aria-label="Refresh notifications"
              disabled={refreshing || busyId !== null} onClick={() => setRetryVersion(version => version + 1)}><Icon name="rotate" /></button>
          </div>
          {readError && <p role="alert" className="border-b border-line py-3 text-sm text-rose-800 dark:text-rose-300">{readError}</p>}
          <NotificationResults
            rows={sortNotifications(rows, unreadOnly, unreadFirst)}
            initialFetch={initialFetch}
            loadFailed={loadFailed}
            refreshing={refreshing}
            busyId={busyId}
            onMarkRead={markRead}
            onRetry={() => setRetryVersion((version) => version + 1)}
          />
      </Sheet>
    </div>
  );
}

export function notificationSummary(initialFetch: boolean, loadFailed: boolean, unread: number) {
  if (loadFailed) return 'Unavailable';
  if (!initialFetch) return 'Loading';
  return unread > 0 ? `${unread} unread` : 'All read';
}

export function NotificationResults({ rows, initialFetch, loadFailed, refreshing, busyId, onMarkRead, onRetry }: {
  rows: NotificationRow[];
  initialFetch: boolean;
  loadFailed: boolean;
  refreshing: boolean;
  busyId: string | null;
  onMarkRead: (id: string) => Promise<void>;
  onRetry: () => void;
}) {
  return (
    <>
      {loadFailed && (
        <div role="alert" className="space-y-2 border-b border-line px-4 py-3 text-sm text-muted">
          <p>{rows.length > 0
            ? 'Notifications could not be refreshed. Previously loaded alerts may be out of date.'
            : 'Notifications are unavailable. Try again.'}</p>
          <button type="button" disabled={refreshing} onClick={onRetry}
            className="btn-ghost min-h-11 min-w-11 max-w-full whitespace-normal [overflow-wrap:anywhere]">
            <Icon name="rotate" className="h-4 w-4 shrink-0" />
            {refreshing ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      )}
      <ul className="divide-y divide-line/60">
            {!initialFetch ? (
              <li className="grid place-items-center gap-2 px-4 py-8 text-sm text-muted">
                <Icon name="rotate" className="h-4 w-4 animate-spin" />
                <span>Loading…</span>
              </li>
            ) : rows.length === 0 && !loadFailed ? (
              <li className="grid place-items-center gap-2 px-4 py-8 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <Icon name="check" className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-ink">
                  You're all caught up
                </p>
                <p className="text-xs text-faint">
                  New alerts appear here as soon as they land.
                </p>
              </li>
            ) : (
              rows.map((row) => (
                <NotificationItem
                  key={row.id}
                  row={row}
                  busy={busyId !== null}
                  onMarkRead={onMarkRead}
                />
              ))
            )}
          </ul>
    </>
  );
}

export function NotificationItem({
  row,
  busy,
  onMarkRead,
}: {
  row: NotificationRow;
  busy: boolean;
  onMarkRead: (id: string) => Promise<void>;
}) {
  const unread = row.read_at === null;
  return (
    <li
      className={cx(
        'flex min-w-0 flex-wrap items-start gap-3 px-4 py-3 text-sm transition',
        unread ? 'bg-brand-500/5' : 'bg-transparent',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          unread ? 'bg-rose-500' : 'bg-transparent',
        )}
      />
      <div className="min-w-0 flex-1 basis-[8rem]">
        <p
          className={cx(
            'font-medium [overflow-wrap:anywhere]',
            unread ? 'text-ink' : 'text-muted',
          )}
        >
          {labelFor(row.kind)}
        </p>
        <p className="text-xs text-faint">
          {timeAgo(row.created_at)}
          {row.entity_type ? ` · ${row.entity_type.replace(/_/g, ' ')}` : ''}
        </p>
        {row.entity_id && <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">Record reference: {row.entity_id}</p>}
        <p className="mt-1 text-xs text-muted">{unread ? 'Unread' : 'Read'}</p>
      </div>
      {unread && (
        <button
          type="button"
          onClick={() => void onMarkRead(row.id)}
          disabled={busy}
          className="min-h-11 min-w-11 max-w-full whitespace-normal rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 transition [overflow-wrap:anywhere] hover:bg-brand-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-wait disabled:opacity-60 dark:text-brand-300"
        >
          {busy ? '…' : 'Mark read'}
        </button>
      )}
    </li>
  );
}
