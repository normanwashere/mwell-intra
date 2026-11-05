import { describe, expect, it } from 'vitest';
import { purchaseOrdersToCsv } from './export';
import { governedReceivedQuantity, poReceiptSummary } from './evidencePresentation';
import type { PurchaseOrder } from './types';

function order(lines: PurchaseOrder['lines']): PurchaseOrder {
  return {
    id: 'po-local', poNumber: 'PO-LOCAL', vendorId: 'vendor-local', vendorName: 'Local vendor',
    status: 'issued', origin: 'procurement', total: 20, requestId: 'request-local',
    createdAt: '2026-11-05', updatedAt: '2026-11-05', lines,
  };
}

function line(quantity: number, receivedQuantity: number): PurchaseOrder['lines'][number] {
  return { id: 'line-local', description: 'Local item', quantity, receivedQuantity };
}

describe('purchaseOrdersToCsv receipt availability', () => {
  it('preserves the original columns and appends explicit availability columns', () => {
    expect(purchaseOrdersToCsv([])).toBe('PO Number,Vendor,Status,Origin,Total,Ordered Units,Received Units,Request ID,Created,Updated,Approved,Approved By,Ordered Units Availability,Received Units Availability');
  });

  it('keeps a missing authoritative receipt quantity blank instead of exporting NaN or zero', () => {
    const po = order([line(2, governedReceivedQuantity('po-local', 'line-local', []))]);
    expect(poReceiptSummary(po.lines)).toContain('Unknown / 2');
    expect(purchaseOrdersToCsv([po]).split('\n')[1]).toBe('PO-LOCAL,Local vendor,issued,procurement,20,2,,request-local,2026-11-05,2026-11-05,,,available,unknown');
  });

  it.each([NaN, Infinity, -Infinity, -1])('does not export an invalid received quantity: %s', value => {
    const cells = purchaseOrdersToCsv([order([line(2, value)])]).split('\n')[1]!.split(',');
    expect(cells[5]).toBe('2');
    expect(cells[6]).toBe('');
    expect(cells.slice(12)).toEqual(['available', 'unknown']);
  });

  it('does not publish a partial known total when any line is unknown', () => {
    const cells = purchaseOrdersToCsv([order([line(2, 1), line(3, NaN)])]).split('\n')[1]!.split(',');
    expect(cells.slice(5, 7)).toEqual(['5', '']);
    expect(cells.slice(12)).toEqual(['available', 'unknown']);
  });

  it('preserves genuine zero and independently marks unavailable ordered quantities', () => {
    const cells = purchaseOrdersToCsv([order([line(NaN, 0)])]).split('\n')[1]!.split(',');
    expect(cells.slice(5, 7)).toEqual(['', '0']);
    expect(cells.slice(12)).toEqual(['unknown', 'available']);
  });

  it('keeps finite partial receipts numeric and preserves the legacy columns', () => {
    const po = { ...order([line(2, 0), line(3, 1)]), approvedAt: '2026-11-04', approvedByEmail: 'reviewer@example.test' };
    expect(purchaseOrdersToCsv([po]).split('\n')[1]).toBe('PO-LOCAL,Local vendor,issued,procurement,20,5,1,request-local,2026-11-05,2026-11-05,2026-11-04,reviewer@example.test,available,available');
  });

  it('preserves empty-line availability instead of inventing zero quantities', () => {
    const cells = purchaseOrdersToCsv([order([])]).split('\n')[1]!.split(',');
    expect(cells.slice(5, 7)).toEqual(['', '']);
    expect(cells.slice(12)).toEqual(['unknown', 'unknown']);
  });

  it('marks an overflowing quantity total unavailable in both the CSV and the UI', () => {
    const po = order([line(Number.MAX_VALUE, Number.MAX_VALUE), line(Number.MAX_VALUE, Number.MAX_VALUE)]);
    expect(purchaseOrdersToCsv([po]).split('\n')[1]!.split(',').slice(5, 7)).toEqual(['', '']);
    expect(poReceiptSummary(po.lines)).toContain('Unknown / Unknown');
  });

  it('retains CSV escaping for vendor names', () => {
    const po = { ...order([line(2, 0)]), vendorName: 'Local, "Vendor"\nBranch' };
    expect(purchaseOrdersToCsv([po])).toContain('"Local, ""Vendor""\nBranch"');
  });
});
