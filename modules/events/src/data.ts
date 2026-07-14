'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@intra/auth';
import { EVENTS_DEMO_DATA } from './seed';
import type { EventDraft, EventLifecycle, EventRecord, EventsData } from './types';

type EventsClient = NonNullable<ReturnType<typeof useSession>['supabaseClient']>;
type UnknownRow = Record<string, unknown>;

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function count(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function lifecycleForDates(
  startDate: string,
  endDate: string | undefined,
  today = new Date().toISOString().slice(0, 10),
): EventLifecycle {
  if (startDate > today) return 'planned';
  if ((endDate ?? startDate) < today) return 'completed';
  return 'active';
}

export function validateEventDraft(draft: EventDraft): string | null {
  if (!draft.name.trim()) return 'Event name is required.';
  if (!draft.startDate) return 'Start date is required.';
  if (draft.endDate && draft.endDate < draft.startDate) {
    return 'End date cannot be before the start date.';
  }
  return null;
}

export async function loadLiveEvents(client: EventsClient): Promise<EventsData> {
  const [eventResult, allocationResult] = await Promise.all([
    client
      .schema('warehouse')
      .from('events')
      .select('id,name,type,site_location_id,start_date,end_date')
      .order('start_date', { ascending: false })
      .limit(1000),
    client
      .schema('warehouse')
      .from('allocations')
      .select('event_id,quantity,status')
      .limit(10000),
  ]);
  const warnings: string[] = [];
  if (eventResult.error) warnings.push(`Events: ${eventResult.error.message}`);
  if (allocationResult.error) warnings.push(`Fulfillment: ${allocationResult.error.message}`);
  const allocations = Array.isArray(allocationResult.data)
    ? (allocationResult.data as UnknownRow[])
    : [];
  const totals = new Map<string, { reserved: number; issued: number; returned: number }>();
  for (const row of allocations) {
    const eventId = text(row.event_id);
    const current = totals.get(eventId) ?? { reserved: 0, issued: 0, returned: 0 };
    const quantity = count(row.quantity);
    const status = text(row.status);
    if (status === 'reserved' || status === 'allocated') current.reserved += quantity;
    if (status === 'issued') current.issued += quantity;
    if (status === 'returned') current.returned += quantity;
    totals.set(eventId, current);
  }
  const rows = Array.isArray(eventResult.data) ? (eventResult.data as UnknownRow[]) : [];
  return {
    events: rows.map((row): EventRecord => {
      const id = text(row.id);
      const startDate = text(row.start_date);
      const endDate = text(row.end_date) || undefined;
      const total = totals.get(id) ?? { reserved: 0, issued: 0, returned: 0 };
      return {
        id,
        name: text(row.name, 'Untitled event'),
        type: text(row.type, 'corporate'),
        startDate,
        endDate,
        siteLocationId: text(row.site_location_id) || undefined,
        lifecycle: lifecycleForDates(startDate, endDate),
        reservedUnits: total.reserved,
        issuedUnits: total.issued,
        returnedUnits: total.returned,
      };
    }),
    warnings,
  };
}

export async function createLiveEvent(client: EventsClient, draft: EventDraft): Promise<void> {
  const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await client.schema('warehouse').rpc('create_event', {
    payload: {
      event: {
        id,
        name: draft.name.trim(),
        type: draft.type,
        start_date: draft.startDate,
        end_date: draft.endDate || null,
        site_location_id: draft.siteLocationId || null,
      },
    },
  });
  if (error) throw error;
}

export function useEventsData() {
  const { mode, supabaseClient } = useSession();
  const live = mode === 'supabase' ? supabaseClient : null;
  const [data, setData] = useState<EventsData>(live ? { events: [], warnings: [] } : EVENTS_DEMO_DATA);
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!live) {
      setData(EVENTS_DEMO_DATA);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await loadLiveEvents(live);
      setData(next);
      setError(next.warnings.length ? next.warnings.join(' ') : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Events could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [live]);

  const createEvent = useCallback(async (draft: EventDraft) => {
    if (live) {
      await createLiveEvent(live, draft);
      await refresh();
      return;
    }
    const next: EventRecord = {
      id: `evt-demo-${Date.now()}`,
      ...draft,
      name: draft.name.trim(),
      lifecycle: lifecycleForDates(draft.startDate, draft.endDate),
      reservedUnits: 0,
      issuedUnits: 0,
      returnedUnits: 0,
    };
    setData((current) => ({ ...current, events: [next, ...current.events] }));
  }, [live, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { data, loading, error, refresh, createEvent };
}
