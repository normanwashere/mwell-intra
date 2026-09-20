import { describe, expect, it } from 'vitest';
import { requestEventFulfillment, validateEventFulfillmentFields } from './data';
import * as eventData from './data';

const demand = {
  eventId: 'event-a', requestingDepartment: 'marketing', purpose: 'Activation',
  costCenter: 'MKT', requiredDate: '2026-10-01', expenseTreatment: 'expense' as const,
  idempotencyKey: 'one-intent',
  lines: [{ productId: 'watch', quantity: 50 }, { productId: 'bag', quantity: 50 }],
};

describe('one multi-line event demand', () => {
  it('reads eligible quantities through a scoped event quote, never broad inventory tables', async () => {
    const quote = (eventData as unknown as { quoteEventDemand?: (client: unknown, eventId: string, productIds: string[]) => Promise<unknown> }).quoteEventDemand;
    expect(quote).toBeTypeOf('function');
    const calls: unknown[] = [];
    const client = { schema: () => ({ rpc: async (name: string, args: unknown) => {
      calls.push([name,args]); return { data: [{ product_id: 'watch', eligible_quantity: 20 }], error: null };
    } }) };
    expect(await quote!(client, 'event-a', ['watch'])).toEqual({ watch: 20 });
    expect(calls).toEqual([['event_demand_availability', { payload: { event_id: 'event-a', product_ids: ['watch'] } }]]);
  });
  it('submits all lines once through the existing governed demand RPC', async () => {
    const calls: unknown[] = [];
    const client = { schema: () => ({ rpc: async (name: string, args: unknown) => {
      calls.push([name, args]); return { data: { id: 'request-a', event_id: 'event-a' }, error: null };
    } }) };
    expect(await requestEventFulfillment(client as never, demand)).toEqual({ id: 'request-a', eventId: 'event-a' });
    expect(calls).toEqual([['request_event_fulfillment', { payload: {
      event_id: 'event-a', requesting_department: 'marketing', purpose: 'Activation', cost_center: 'MKT',
      required_date: '2026-10-01', expense_treatment: 'expense', lines: demand.lines, idempotency_key: 'one-intent',
    } }]]);
  });
  it('rejects missing, duplicate, fractional and excessive lines before submitting', () => {
    expect(validateEventFulfillmentFields(demand)).toEqual({});
    for (const lines of [[], [{ productId: '', quantity: 1 }], [{ productId: 'watch', quantity: 0.5 }],
      [demand.lines[0]!, demand.lines[0]!], Array.from({ length: 101 }, (_, i) => ({ productId: String(i), quantity: 1 }))]) {
      expect(Object.keys(validateEventFulfillmentFields({ ...demand, lines })).length).toBeGreaterThan(0);
    }
  });
});
