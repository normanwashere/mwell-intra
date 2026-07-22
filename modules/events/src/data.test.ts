import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createLiveEvent,
  lifecycleForDates,
  loadMemoryEvents,
  manageLiveEvent,
  requestEventFulfillment,
  saveMemoryEvents,
  validateEventDraft,
  validateEventDraftFields,
} from './data';
import { EVENTS_DEMO_DATA } from './seed';

describe('event lifecycle rules', () => {
  it('exposes controlled lifecycle and fulfillment operations', async () => {
    const module = await import('./data');

    expect(module.validateEventDraftFields).toBeTypeOf('function');
    expect(module.manageLiveEvent).toBeTypeOf('function');
    expect(module.requestEventFulfillment).toBeTypeOf('function');
  });

  it('classifies planned, active, and completed dates', () => {
    expect(lifecycleForDates('2026-07-15', '2026-07-16', '2026-07-14')).toBe('planned');
    expect(lifecycleForDates('2026-07-14', '2026-07-15', '2026-07-14')).toBe('active');
    expect(lifecycleForDates('2026-07-10', '2026-07-11', '2026-07-14')).toBe('completed');
  });

  it('rejects incomplete or reversed event dates', () => {
    expect(validateEventDraft({ name: '', type: 'corporate', startDate: '' })).toBe('Event name is required.');
    expect(validateEventDraft({ name: 'Town hall', type: 'corporate', startDate: '' })).toBe('Start date is required.');
    expect(validateEventDraft({ name: 'Town hall', type: 'corporate', startDate: '2026-07-15', endDate: '2026-07-14' })).toBe('End date cannot be before the start date.');
  });

  it('returns field-specific date validation', () => {
    expect(validateEventDraftFields({ name: '', type: 'corporate', startDate: '' })).toEqual({
      name: 'Event name is required.',
      startDate: 'Start date is required.',
    });
    expect(validateEventDraftFields({
      name: 'Town hall',
      type: 'corporate',
      startDate: '2026-07-15',
      endDate: '2026-07-14',
    })).toEqual({ endDate: 'End date cannot be before the start date.' });
  });

  it('rejects an empty start date before calling Supabase', async () => {
    const calls: string[] = [];
    const client = {
      schema: () => ({
        rpc: async (name: string) => {
          calls.push(name);
          return { data: null, error: null };
        },
      }),
    };

    await expect(createLiveEvent(client as never, {
      name: 'Town hall',
      type: 'corporate',
      startDate: '',
    })).rejects.toThrow('Start date is required.');
    expect(calls).toEqual([]);
  });

  it('routes controlled changes through the lifecycle RPC with concurrency metadata', async () => {
    const calls: Array<{ name: string; payload: unknown }> = [];
    const client = {
      schema: () => ({
        rpc: async (name: string, args: { payload: unknown }) => {
          calls.push({ name, payload: args.payload });
          return {
            data: {
              id: 'evt-1', name: 'Moved event', type: 'corporate',
              start_date: '2026-08-02', end_date: null, status: 'planned',
              owner_email: 'owner@mwell.com.ph', updated_at: '2026-07-22T03:00:00Z',
            },
            error: null,
          };
        },
      }),
    };

    await expect(manageLiveEvent(client as never, {
      eventId: 'evt-1',
      action: 'reschedule',
      reason: 'Venue conflict',
      expectedUpdatedAt: '2026-07-22T02:00:00Z',
      changes: { startDate: '2026-08-02' },
    })).resolves.toMatchObject({ id: 'evt-1', name: 'Moved event', lifecycle: 'planned' });
    expect(calls).toEqual([{
      name: 'manage_event',
      payload: {
        event_id: 'evt-1', action: 'reschedule', reason: 'Venue conflict',
        expected_updated_at: '2026-07-22T02:00:00Z',
        changes: { start_date: '2026-08-02' },
      },
    }]);
  });

  it('preserves event identity in a warehouse fulfillment request', async () => {
    const calls: Array<{ name: string; payload: unknown }> = [];
    const client = {
      schema: () => ({
        rpc: async (name: string, args: { payload: unknown }) => {
          calls.push({ name, payload: args.payload });
          return { data: { id: 'request-1', event_id: 'evt-1' }, error: null };
        },
      }),
    };
    const input = {
      eventId: 'evt-1', requestingDepartment: 'marketing', purpose: 'Launch kits',
      costCenter: 'MKT-100', requiredDate: '2026-08-01', expenseTreatment: 'expense' as const,
      productId: 'merch-1', quantity: 25, idempotencyKey: 'event-request-1',
    };

    await expect(requestEventFulfillment(client as never, input)).resolves.toEqual({
      id: 'request-1', eventId: 'evt-1',
    });
    expect(calls[0]).toMatchObject({
      name: 'request_event_fulfillment',
      payload: { event_id: 'evt-1', idempotency_key: 'event-request-1' },
    });
  });

  it('defines audited lifecycle and event-linked handoff database controls', () => {
    const sql = readFileSync(resolve(
      process.cwd(),
      '../../supabase/migrations/20260722120500_procurement_event_workflow_remediation.sql',
    ), 'utf8');

    expect(sql).toContain('warehouse.event_lifecycle_events');
    expect(sql).toContain('warehouse.manage_event');
    expect(sql).toContain('warehouse.request_event_fulfillment');
    expect(sql).toContain('event_id text references warehouse.events');
    expect(sql).toContain("core.has_cap('events', 'manage_events')");
    expect(sql).toContain("core.has_cap('events', 'close_event')");
    expect(sql).toContain('expected_updated_at');
  });

  it('wires every granted event capability to a usable control', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/EventsApp.tsx'), 'utf8');
    const access = readFileSync(resolve(process.cwd(), 'src/access.ts'), 'utf8');

    expect(access).toContain('canManageEvents');
    expect(access).toContain('canCloseEvents');
    expect(access).toContain('canRequestEventFulfillment');
    expect(app).toContain('manageEvent');
    expect(app).toContain('requestFulfillment');
    expect(app).toContain('Transfer owner');
    expect(app).toContain('Reschedule');
    expect(app).toContain('Close event');
    expect(app).toContain('Cancel event');
    expect(app).toContain('Reopen event');
    expect(app).toContain('Request warehouse stock');
    expect(app).toContain('error={formErrors.startDate}');
  });
});

describe('event demo repository', () => {
  it('falls back to the governed seed when the stored value is missing or invalid', () => {
    expect(loadMemoryEvents({ getItem: () => null })).toEqual(EVENTS_DEMO_DATA);
    expect(loadMemoryEvents({ getItem: () => '{invalid' })).toEqual(EVENTS_DEMO_DATA);
  });

  it('round-trips created events across route remounts', () => {
    let stored: string | null = null;
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => { stored = value; },
    };
    const created = {
      ...EVENTS_DEMO_DATA,
      events: [
        {
          id: 'evt-demo-created',
          name: 'Created event',
          type: 'corporate',
          startDate: '2026-07-20',
          lifecycle: 'planned' as const,
          reservedUnits: 0,
          issuedUnits: 0,
          returnedUnits: 0,
        },
        ...EVENTS_DEMO_DATA.events,
      ],
    };

    saveMemoryEvents(storage, created);

    expect(loadMemoryEvents(storage).events[0]).toMatchObject({
      id: 'evt-demo-created',
      name: 'Created event',
    });
  });
});
