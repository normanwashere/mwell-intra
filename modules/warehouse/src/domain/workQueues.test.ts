import { describe, expect, it } from 'vitest';
import { inboundQueue, isFloorWork, isReleasedFollowUp } from './workQueues';
import type { BridgedPO } from '../data/procurementBridge';

const po = (id: string, quantity: number, receivedQuantity: number, status: BridgedPO['status'] = 'issued'): BridgedPO => ({
  id, poNumber: id, vendorName: 'Fixture vendor', status,
  createdAt: '2026-09-05T00:00:00Z',
  lines: [{ id, description: `Item ${id}`, quantity, receivedQuantity, unitPrice: 10 }],
  totalOrdered: quantity, totalReceived: receivedQuantity, value: quantity * 10,
  href: `/procurement/purchase-orders/${id}`, warehouseHref: `/warehouse/purchase-orders?po=${id}`,
});

describe('warehouse authoritative queue contracts', () => {
  it('counts the three live handoffs with 402 outstanding units, not an empty legacy table', () => {
    const rows = [po('PO1', 400, 0), po('PO2', 100, 99), po('Handbook', 1, 0), po('done', 1, 1), po('awaiting', 8, 0, 'approved')];
    const result = inboundQueue([...rows, po('PO1', 400, 0)], [], 'supabase');
    expect(result.count).toBe(3);
    expect(result.outstandingUnits).toBe(402);
    expect(result.outstandingValue).toBe(4020);
    expect(result.receivable.map(p => p.id)).toEqual(['PO1', 'PO2', 'Handbook']);
    expect(result.awaitingIssue.map(p => p.id)).toEqual(['awaiting']);
    rows[1] = po('PO2', 100, 100);
    expect(inboundQueue(rows, [], 'supabase').count).toBe(2);
    const unknown: BridgedPO = { ...po('missing-price', 1, 0),
      lines: [{ id: 'missing-price', description: 'No quoted price', quantity: 1, receivedQuantity: 0 }] };
    expect(inboundQueue([unknown], [], 'supabase').outstandingValue).toBeNull();
  });

  it('unifies floor work at 13 while keeping 17 released follow-ups separate', () => {
    const rows = Object.entries({ received: 2, allocated: 3, picking: 4, packing: 2, ready: 2, released: 17, completed: 1, cancelled: 1 })
      .flatMap(([status, count]) => Array.from({ length: count }, (_, n) => ({ id: `${status}-${n}`, status: status as Parameters<typeof isFloorWork>[0]['status'] })));
    expect(rows.filter(isFloorWork)).toHaveLength(13);
    expect(rows.filter(isReleasedFollowUp)).toHaveLength(17);
    expect(rows.filter(isFloorWork).every(row => !['released','completed','cancelled'].includes(row.status))).toBe(true);
  });
});
