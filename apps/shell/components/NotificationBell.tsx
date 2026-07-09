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
import { Icon } from '@intra/ui';
import { useSession } from '@intra/auth';
import { ENABLE_NOTIFICATIONS } from '@shell/lib/supabase/env';
import type { ShellSupabaseClient } from '@shell/lib/supabase/types';
import { cx } from '@shell/lib/cx';

/** How often we re-fetch notifications in supabase mode. */
const POLL_INTERVAL_MS = 60_000;
/** Cap the dropdown at the latest N rows. */
const MAX_ROWS = 10;

interface NotificationRow {
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
  approval_overdue: 'Approval SLA overdue',
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

export function NotificationBell() {
  const { profile, mode, supabaseClient } = useSession();
  const client = supabaseClient as ShellSupabaseClient | null;

  // Memory mode OR no client OR signed-out → no-op (dimmed bell, no popover).
  const disabled = mode !== 'supabase' || !ENABLE_NOTIFICATIONS || !client || !profile;

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [initialFetch, setInitialFetch] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Poll core.notifications while signed in with a live backend.  RLS scopes
  // rows to auth.uid() so we don't add a user_id filter (that also means the
  // manage_notifications tier sees a global stream, which is intentional).
  useEffect(() => {
    if (disabled || !client) return;
    let active = true;

    const fetchRows = async () => {
      try {
        const { data, error } = await client
          .from('notifications')
          .select('id, kind, entity_type, entity_id, read_at, created_at')
          .order('created_at', { ascending: false })
          .limit(MAX_ROWS);
        if (!active) return;
        if (!error && Array.isArray(data)) {
          setRows(data as NotificationRow[]);
        }
      } catch {
        // Route changes can abort the live fetch. Notifications are secondary,
        // so keep the shell quiet and leave the last known list in place.
        if (!active) return;
      } finally {
        if (active) setInitialFetch(true);
      }
    };

    void fetchRows();
    const timer = window.setInterval(fetchRows, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client, disabled]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const unread = useMemo(
    () => rows.reduce((n, r) => (r.read_at === null ? n + 1 : n), 0),
    [rows],
  );

  const markRead = useCallback(
    async (id: string) => {
      if (!client) return;
      setBusyId(id);
      try {
        const { error } = await client.rpc('mark_notification_read', {
          payload: { notification_id: id },
        });
        if (!error) {
          const nowIso = new Date().toISOString();
          setRows((prev) =>
            prev.map((r) =>
              r.id === id ? { ...r, read_at: r.read_at ?? nowIso } : r,
            ),
          );
        }
      } catch {
        // Best-effort UI action. A later poll will restore the authoritative
        // state; do not surface aborted fetches as global console errors.
      } finally {
        setBusyId(null);
      }
    },
    [client],
  );

  const ariaLabel = disabled
    ? mode === 'supabase'
      ? ENABLE_NOTIFICATIONS
        ? 'Notifications (sign in to view)'
        : 'Notifications unavailable until core notifications are deployed'
      : 'Notifications unavailable in demo mode'
    : `Notifications${unread > 0 ? `, ${unread} unread` : ''}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
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
            className="absolute right-1.5 top-1.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-rose-500 px-1 text-[0.6rem] font-bold leading-none text-white shadow-e1"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && !disabled && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-30 w-80 max-w-[calc(100vw-1rem)] animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Notifications</p>
              <p className="text-xs text-muted">
                Latest {MAX_ROWS} across your active modules
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
              {unread > 0 ? `${unread} unread` : 'All read'}
            </span>
          </div>

          <ul className="max-h-96 divide-y divide-line/60 overflow-auto">
            {!initialFetch ? (
              <li className="grid place-items-center gap-2 px-4 py-8 text-sm text-muted">
                <Icon name="rotate" className="h-4 w-4 animate-spin" />
                <span>Loading…</span>
              </li>
            ) : rows.length === 0 ? (
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
                  busy={busyId === row.id}
                  onMarkRead={markRead}
                />
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
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
        'flex items-start gap-3 px-4 py-3 text-sm transition',
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
      <div className="min-w-0 flex-1">
        <p
          className={cx(
            'truncate font-medium',
            unread ? 'text-ink' : 'text-muted',
          )}
        >
          {labelFor(row.kind)}
        </p>
        <p className="text-xs text-faint">
          {timeAgo(row.created_at)}
          {row.entity_type ? ` · ${row.entity_type}` : ''}
        </p>
      </div>
      {unread && (
        <button
          type="button"
          role="menuitem"
          onClick={() => void onMarkRead(row.id)}
          disabled={busy}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-wait disabled:opacity-60 dark:text-brand-300"
        >
          {busy ? '…' : 'Mark read'}
        </button>
      )}
    </li>
  );
}
