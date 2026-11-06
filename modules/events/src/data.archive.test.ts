import { describe, expect, it } from 'vitest';
import { loadLiveEvents } from './data';

describe('event fulfillment archive boundary', () => {
  it('uses active product choices while retaining historical event reads and selector filters', async () => {
    const active = { id: 'active-product', name: 'Active product', item_class: 'sellable_sku' };
    const archived = { id: 'archived-sample', name: 'Archived sample', item_class: 'sellable_sku' };
    const supply = { id: 'active-supply', name: 'Active supply', item_class: 'fulfillment_supply' };
    const fixtures: Record<string, Array<Record<string, unknown>>> = {
      'warehouse.products': [active, archived, supply],
      'warehouse.active_products': [active, supply],
      'warehouse.events': [{ id: 'past-event', name: 'Historical event', start_date: '2026-01-01' }],
      'warehouse.event_custody_totals': [{ event_id: 'past-event', issued_units: 2, returned_units: 1 }],
      'warehouse.department_stock_requests': [{ id: 'past-handoff', event_id: 'past-event', status: 'issued' }],
    };
    const calls: Array<{ relation: string; method: string; args: unknown[] }> = [];
    const reads: string[] = [];
    const client = {
      schema: (schema: string) => ({ from: (table: string) => {
        const relation = `${schema}.${table}`;
        reads.push(relation);
        let rows = fixtures[relation] ?? [];
        const record = (method: string, ...args: unknown[]) => calls.push({ relation, method, args });
        const query = {
          select: (columns: string) => { record('select', columns); return query; },
          order: (column: string, options: { ascending: boolean }) => { record('order', column, options); return query; },
          eq: (column: string, value: unknown) => {
            record('eq', column, value);
            rows = rows.filter(row => row[column] === value);
            return query;
          },
          in: (column: string, values: readonly string[]) => {
            record('in', column, values);
            rows = rows.filter(row => values.includes(String(row[column])));
            return query;
          },
          limit: async (count: number) => {
            record('limit', count);
            return { data: rows.slice(0, count), error: null };
          },
        };
        return query;
      } }),
    };

    const result = await loadLiveEvents(client as never);

    expect(result.products).toEqual([{ id: active.id, name: active.name, itemClass: active.item_class }]);
    expect(reads).toEqual([
      'warehouse.events', 'warehouse.event_custody_totals', 'warehouse.active_products',
      'warehouse.event_reconciliations', 'core.departments', 'core.department_cost_centers',
      'warehouse.department_stock_requests',
    ]);
    const productCalls = calls.filter(call => call.relation === 'warehouse.active_products');
    expect(productCalls).toEqual([
      { relation: 'warehouse.active_products', method: 'select', args: ['id,name,item_class'] },
      { relation: 'warehouse.active_products', method: 'in', args: ['item_class', expect.arrayContaining(['sellable_sku', 'merchandise', 'event_material'])] },
      { relation: 'warehouse.active_products', method: 'order', args: ['name', { ascending: true }] },
      { relation: 'warehouse.active_products', method: 'limit', args: [1000] },
    ]);
    expect(result.events).toEqual([expect.objectContaining({ id: 'past-event', issuedUnits: 2, returnedUnits: 1 })]);
    expect(result.fulfillmentHandoffs).toEqual([expect.objectContaining({ id: 'past-handoff', eventId: 'past-event', status: 'issued' })]);
  });
});
