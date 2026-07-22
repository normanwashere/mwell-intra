'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@intra/auth';
import { EVENTS_DEMO_DATA } from './seed';
import type {
  EventDraft,
  EventFulfillmentRequest,
  EventLifecycle,
  EventManagementInput,
  EventRecord,
  EventsData,
} from './types';

type EventsClient = NonNullable<ReturnType<typeof useSession>['supabaseClient']>;
type UnknownRow = Record<string, unknown>;

const MEMORY_EVENTS_KEY = 'intra.events-data.v1';

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
  const fields = validateEventDraftFields(draft);
  return fields.name ?? fields.startDate ?? fields.endDate ?? null;
}

export function validateEventDraftFields(draft: EventDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = 'Event name is required.';
  if (!draft.startDate) errors.startDate = 'Start date is required.';
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.endDate = 'End date cannot be before the start date.';
  }
  return errors;
}

function lifecycleForRow(row: UnknownRow): EventLifecycle {
  const status = text(row.status);
  if (status === 'cancelled' || status === 'closed') return status;
  return lifecycleForDates(text(row.start_date), text(row.end_date) || undefined);
}

function mapEventRow(row: UnknownRow, totals = { reserved: 0, issued: 0, returned: 0 }): EventRecord {
  return {
    id: text(row.id),
    name: text(row.name, 'Untitled event'),
    type: text(row.type, 'corporate'),
    startDate: text(row.start_date),
    endDate: text(row.end_date) || undefined,
    siteLocationId: text(row.site_location_id) || undefined,
    ownerEmail: text(row.owner_email) || undefined,
    updatedAt: text(row.updated_at) || undefined,
    lifecycle: lifecycleForRow(row),
    reservedUnits: totals.reserved,
    issuedUnits: totals.issued,
    returnedUnits: totals.returned,
  };
}

export async function manageLiveEvent(
  client: EventsClient,
  input: EventManagementInput,
): Promise<EventRecord> {
  if (!input.reason.trim()) throw new Error('A reason is required.');
  const changes = input.changes ?? {};
  const { data, error } = await client.schema('warehouse').rpc('manage_event', {
    payload: {
      event_id: input.eventId,
      action: input.action,
      reason: input.reason.trim(),
      expected_updated_at: input.expectedUpdatedAt,
      changes: {
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.type !== undefined ? { type: changes.type } : {}),
        ...(changes.startDate !== undefined ? { start_date: changes.startDate } : {}),
        ...(changes.endDate !== undefined ? { end_date: changes.endDate || null } : {}),
        ...(changes.siteLocationId !== undefined ? { site_location_id: changes.siteLocationId || null } : {}),
        ...(changes.ownerEmail !== undefined ? { owner_email: changes.ownerEmail.trim() } : {}),
      },
    },
  });
  if (error) throw error;
  return mapEventRow((data ?? {}) as UnknownRow);
}

export async function requestEventFulfillment(
  client: EventsClient,
  input: EventFulfillmentRequest,
): Promise<{ id: string; eventId: string }> {
  if (!input.eventId || !input.purpose.trim() || !input.costCenter.trim() || !input.requiredDate) {
    throw new Error('Event, purpose, cost center, and required date are required.');
  }
  if (!input.productId || !Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error('A product and positive whole-number quantity are required.');
  }
  const { data, error } = await client.schema('warehouse').rpc('request_event_fulfillment', {
    payload: {
      event_id: input.eventId,
      requesting_department: input.requestingDepartment.trim(),
      purpose: input.purpose.trim(),
      cost_center: input.costCenter.trim(),
      required_date: input.requiredDate,
      expense_treatment: input.expenseTreatment,
      lines: [{ productId: input.productId, quantity: input.quantity }],
      idempotency_key: input.idempotencyKey,
    },
  });
  if (error) throw error;
  const row = (data ?? {}) as UnknownRow;
  return { id: text(row.id), eventId: text(row.event_id) };
}

export async function loadLiveEvents(client: EventsClient): Promise<EventsData> {
  const [eventResult, allocationResult, productResult] = await Promise.all([
    client
      .schema('warehouse')
      .from('events')
      .select('id,name,type,site_location_id,start_date,end_date,status,owner_email,updated_at')
      .order('start_date', { ascending: false })
      .limit(1000),
    client
      .schema('warehouse')
      .from('allocations')
      .select('event_id,quantity,status')
      .limit(10000),
    client
      .schema('warehouse')
      .from('products')
      .select('id,name,item_class')
      .eq('active', true)
      .in('item_class', ['sellable_sku', 'merchandise'])
      .order('name', { ascending: true })
      .limit(1000),
  ]);
  const warnings: string[] = [];
  if (eventResult.error) warnings.push(`Events: ${eventResult.error.message}`);
  if (allocationResult.error) warnings.push(`Fulfillment: ${allocationResult.error.message}`);
  if (productResult.error) warnings.push(`Products: ${productResult.error.message}`);
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
      const total = totals.get(id) ?? { reserved: 0, issued: 0, returned: 0 };
      return mapEventRow(row, total);
    }),
    products: (Array.isArray(productResult.data) ? productResult.data as UnknownRow[] : [])
      .map((row) => ({
        id: text(row.id),
        name: text(row.name, 'Unnamed product'),
        itemClass: text(row.item_class),
      })),
    warnings,
  };
}

export async function createLiveEvent(client: EventsClient, draft: EventDraft): Promise<void> {
  const validation = validateEventDraft(draft);
  if (validation) throw new Error(validation);
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

export function loadMemoryEvents(storage: Pick<Storage, 'getItem'>): EventsData {
  const stored = storage.getItem(MEMORY_EVENTS_KEY);
  if (!stored) return EVENTS_DEMO_DATA;
  try {
    const parsed = JSON.parse(stored) as Partial<EventsData>;
    return Array.isArray(parsed.events)
      ? { events: parsed.events as EventRecord[], warnings: [] }
      : EVENTS_DEMO_DATA;
  } catch {
    return EVENTS_DEMO_DATA;
  }
}

export function saveMemoryEvents(
  storage: Pick<Storage, 'setItem'>,
  data: EventsData,
): void {
  storage.setItem(MEMORY_EVENTS_KEY, JSON.stringify({ events: data.events }));
}

export function useEventsData() {
  const { mode, supabaseClient } = useSession();
  const live = mode === 'supabase' ? supabaseClient : null;
  const [data, setData] = useState<EventsData>(live ? { events: [], warnings: [] } : EVENTS_DEMO_DATA);
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!live) {
      setData(loadMemoryEvents(window.sessionStorage));
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
    setData((current) => {
      const updated = { ...current, events: [next, ...current.events] };
      saveMemoryEvents(window.sessionStorage, updated);
      return updated;
    });
  }, [live, refresh]);

  const manageEvent = useCallback(async (input: EventManagementInput) => {
    if (!live) throw new Error('Event lifecycle changes require Supabase mode.');
    const updated = await manageLiveEvent(live, input);
    await refresh();
    return updated;
  }, [live, refresh]);

  const requestFulfillment = useCallback(async (input: EventFulfillmentRequest) => {
    if (!live) throw new Error('Warehouse fulfillment requests require Supabase mode.');
    return requestEventFulfillment(live, input);
  }, [live]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { data, loading, error, refresh, createEvent, manageEvent, requestFulfillment };
}
