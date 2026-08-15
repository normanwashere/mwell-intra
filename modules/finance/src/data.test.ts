import { describe, expect, it } from 'vitest';
import {
  filterFinanceActivity,
  manageLiveFinanceCloseEntry,
  scopeFinanceData,
  summarizeFinanceData,
  validateFinanceCloseEntry,
} from './data';
import { FINANCE_DEMO_DATA } from './seed';

describe('summarizeFinanceData', () => {
  it('summarizes commitments, receipts, returns, and review states', () => {
    expect(summarizeFinanceData(FINANCE_DEMO_DATA)).toEqual({
      inventoryValue: 1_284_750,
      committedValue: 1_840_000,
      receivedValue: 287_250,
      returnedValue: 18_750,
      netWarehouseValue: 268_500,
      reviewCount: 1,
      returnedCount: 1,
      acceptedCount: 0,
    });
  });
});

describe('manageLiveFinanceCloseEntry', () => {
  it('passes the current row timestamp to governed transitions', async () => {
    const calls: unknown[] = [];
    const client = {
      schema: () => ({
        rpc: async (_name: string, args: unknown) => {
          calls.push(args);
          return {
            data: {
              id: 'close-1',
              period_start: '2026-08-01',
              period_end: '2026-08-31',
              entry_type: 'cogs',
              source_module: 'warehouse',
              source_reference: 'AUG-2026',
              amount: 100,
              status: 'posted',
              prepared_by: 'finance-a',
              prepared_at: '2026-08-10T01:00:00Z',
              posted_by: 'finance-b',
              posted_at: '2026-08-10T02:00:00Z',
              updated_at: '2026-08-10T02:00:00Z',
            },
            error: null,
          };
        },
      }),
    };

    await manageLiveFinanceCloseEntry(client as never, {
      action: 'post',
      id: 'close-1',
      expectedUpdatedAt: '2026-08-10T01:00:00Z',
    });

    expect(calls).toEqual([
      {
        payload: expect.objectContaining({
          action: 'post',
          id: 'close-1',
          expected_updated_at: '2026-08-10T01:00:00Z',
        }),
      },
    ]);
  });
});

describe('Finance close source binding', () => {
  it('requires canonical source and evidence record identities', () => {
    expect(validateFinanceCloseEntry({ action: 'save', amount: 100 })).toEqual(
      expect.arrayContaining(['Select a canonical source record.', 'Select registered evidence.']),
    );
  });

  it('passes source, evidence, and actor-lineage fields to the governed RPC', async () => {
    const calls: unknown[] = [];
    const client = {
      schema: () => ({
        rpc: async (_name: string, args: unknown) => {
          calls.push(args);
          return {
            data: {
              id: 'close-2',
              period_start: '2026-08-01',
              period_end: '2026-08-31',
              entry_type: 'cogs',
              source_module: 'procurement',
              source_reference: 'PO-1',
              source_record_type: 'purchase_order',
              source_record_id: 'po-1',
              evidence_record_type: 'request_attachment',
              evidence_record_id: 'att-1',
              amount: 100,
              status: 'ready',
              prepared_by: 'finance-a',
              prepared_by_name: 'Finance A',
              prepared_by_email: 'finance-a@mwell.com.ph',
              prepared_at: '2026-08-15T01:00:00Z',
              updated_at: '2026-08-15T01:00:00Z',
            },
            error: null,
          };
        },
      }),
    };

    const result = await manageLiveFinanceCloseEntry(client as never, {
      action: 'save',
      amount: 100,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      entryType: 'cogs',
      sourceModule: 'procurement',
      sourceReference: 'PO-1',
      sourceRecordType: 'purchase_order',
      sourceRecordId: 'po-1',
      evidenceRecordType: 'request_attachment',
      evidenceRecordId: 'att-1',
    });

    expect(calls).toEqual([
      {
        payload: expect.objectContaining({
          source_record_type: 'purchase_order',
          source_record_id: 'po-1',
          evidence_record_type: 'request_attachment',
          evidence_record_id: 'att-1',
        }),
      },
    ]);
    expect(result.preparedActor).toEqual({
      id: 'finance-a',
      name: 'Finance A',
      email: 'finance-a@mwell.com.ph',
    });
  });
});

describe('filterFinanceActivity', () => {
  it('keeps each source family distinct', () => {
    expect(filterFinanceActivity(FINANCE_DEMO_DATA.activity, 'procurement')).toHaveLength(2);
    expect(filterFinanceActivity(FINANCE_DEMO_DATA.activity, 'receipts')).toHaveLength(1);
    expect(filterFinanceActivity(FINANCE_DEMO_DATA.activity, 'returns')).toHaveLength(1);
    expect(filterFinanceActivity(FINANCE_DEMO_DATA.activity, 'all')).toHaveLength(4);
  });
});

describe('scopeFinanceData', () => {
  it('keeps Procurement and Warehouse data within their assigned Finance scope', () => {
    const procurement = scopeFinanceData(FINANCE_DEMO_DATA, {
      procurement: true,
      warehouse: false,
    });
    expect(procurement.activity.every((item) => item.source === 'procurement_po')).toBe(true);
    expect(procurement.payments.length).toBeGreaterThan(0);
    expect(procurement.inventoryValue).toBe(0);

    const warehouse = scopeFinanceData(FINANCE_DEMO_DATA, {
      procurement: false,
      warehouse: true,
    });
    expect(warehouse.activity.every((item) => item.source !== 'procurement_po')).toBe(true);
    expect(warehouse.payments).toEqual([]);
    expect(warehouse.inventoryValue).toBe(FINANCE_DEMO_DATA.inventoryValue);
  });
});
