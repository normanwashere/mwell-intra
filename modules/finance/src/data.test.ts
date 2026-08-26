import { describe, expect, it } from 'vitest';
import {
  applyMemoryFinanceCloseEntry,
  filterFinanceActivity,
  manageLiveFinanceCloseEntry,
  scopeFinanceData,
  summarizeFinanceData,
  validateFinanceCloseEntry,
} from './data';
import { FINANCE_DEMO_DATA } from './seed';
import type { FinanceData } from './types';

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
      evidenceUrl: 'https://example.com/evidence/att-1',
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

describe('event settlement close', () => {
  const eventSettlementData = (): FinanceData => ({
    activity: [],
    payments: [],
    closeEntries: [
      {
        id: 'close-event-a',
        periodStart: '2026-08-24',
        periodEnd: '2026-08-24',
        entryType: 'event_settlement',
        sourceModule: 'events',
        sourceReference: 'uat-event-a',
        sourceRecordType: 'event_reconciliation',
        sourceRecordId: 'uat-event-a',
        evidenceRecordType: 'event_reconciliation',
        evidenceRecordId: 'uat-event-a',
        amount: 16_970,
        status: 'ready',
        evidenceUrl: 'https://example.com/uat/events/UAT-AUG24-EVENT-A',
        preparedBy: 'marketing-user',
        settlementApprovedBy: 'finance-approver',
        preparedAt: '2026-08-24T12:00:00Z',
        updatedAt: '2026-08-24T12:00:00Z',
      },
    ],
    inventoryValue: 0,
    warnings: [],
  });

  it('moves an approved event settlement through independent Finance posting and closure', () => {
    const posted = applyMemoryFinanceCloseEntry(
      eventSettlementData(),
      { action: 'post', id: 'close-event-a' },
      'finance-poster',
    );
    expect(posted.closeEntries[0]).toMatchObject({
      status: 'posted',
      postedBy: 'finance-poster',
    });

    const reconciled = applyMemoryFinanceCloseEntry(
      posted,
      { action: 'reconcile', id: 'close-event-a' },
      'finance-closer',
    );
    expect(reconciled.closeEntries[0]).toMatchObject({
      status: 'reconciled',
      postedBy: 'finance-poster',
      reconciledBy: 'finance-closer',
    });
  });

  it('prevents the posting Finance actor from closing their own event settlement', () => {
    const posted = applyMemoryFinanceCloseEntry(
      eventSettlementData(),
      { action: 'post', id: 'close-event-a' },
      'finance-poster',
    );
    expect(() =>
      applyMemoryFinanceCloseEntry(
        posted,
        { action: 'reconcile', id: 'close-event-a' },
        'finance-poster',
      ),
    ).toThrow('A different Finance user must reconcile a posted close entry.');
  });

  it('prevents the settlement approver from posting the generated close entry', () => {
    expect(() =>
      applyMemoryFinanceCloseEntry(
        eventSettlementData(),
        { action: 'post', id: 'close-event-a' },
        'finance-approver',
      ),
    ).toThrow('The Event settlement approver cannot post its generated close entry.');
  });

  it('prevents the settlement approver from reconciling after independent posting', () => {
    const posted = applyMemoryFinanceCloseEntry(
      eventSettlementData(),
      { action: 'post', id: 'close-event-a' },
      'finance-poster',
    );

    expect(() =>
      applyMemoryFinanceCloseEntry(
        posted,
        { action: 'reconcile', id: 'close-event-a' },
        'finance-approver',
      ),
    ).toThrow('The Event settlement approver cannot reconcile its generated close entry.');
  });

  it('reconciles only posted entries', () => {
    expect(() =>
      applyMemoryFinanceCloseEntry(
        eventSettlementData(),
        { action: 'reconcile', id: 'close-event-a' },
        'finance-closer',
      ),
    ).toThrow('Post the entry before reconciliation.');
  });

  it('prevents the preparer from reconciling even after another Finance actor posts', () => {
    const prepared = eventSettlementData();
    prepared.closeEntries[0] = {
      ...prepared.closeEntries[0]!,
      preparedBy: 'finance-preparer',
    };
    const posted = applyMemoryFinanceCloseEntry(
      prepared,
      { action: 'post', id: 'close-event-a' },
      'finance-poster',
    );

    expect(() =>
      applyMemoryFinanceCloseEntry(
        posted,
        { action: 'reconcile', id: 'close-event-a' },
        'finance-preparer',
      ),
    ).toThrow('The preparer cannot reconcile their own entry.');
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
