import { describe, expect, it } from 'vitest';
import { applyReceipt, evaluateIssueReadiness, evaluatePaymentReadiness, outstandingOf } from './receiving';
import type { AcceptancePack, PaymentReadinessPack, PurchaseOrderLine } from './types';

function line(
  id: string,
  quantity: number,
  receivedQuantity = 0,
): PurchaseOrderLine {
  return { id, description: `Line ${id}`, quantity, receivedQuantity, uom: 'ea' };
}

describe('outstandingOf', () => {
  it('is ordered minus received, floored at zero', () => {
    expect(outstandingOf(line('a', 10, 4))).toBe(6);
    expect(outstandingOf(line('a', 10, 10))).toBe(0);
    expect(outstandingOf(line('a', 10, 12))).toBe(0); // over-received legacy data
  });
});

describe('policy handoff readiness', () => {
  it('blocks issue until award, source request, and vendor eligibility all pass', () => {
    expect(evaluateIssueReadiness({ poApproved: true, sourceAwardApproved: false, vendorEligible: false }))
      .toEqual(['approved source request', 'current vendor accreditation or scoped temporary clearance']);
    expect(evaluateIssueReadiness({ poApproved: true, sourceAwardApproved: true, vendorEligible: true }))
      .toEqual([]);
  });

  it('requires acceptance and the complete Finance evidence pack', () => {
    expect(evaluatePaymentReadiness(undefined, undefined)).toEqual([
      'requester or Warehouse acceptance',
      'PO/receipt/invoice match',
      'invoice, OR, or SI',
      'delivery or milestone evidence',
      'tax and withholding support',
    ]);
    const acceptance: AcceptancePack = {
      id: 'accept-1', purchaseOrderId: 'po-1', acceptanceType: 'goods',
      acceptedScope: 'All goods', acceptedAt: '2026-07-10T00:00:00Z',
      status: 'accepted', exceptions: [],
    };
    const pack: PaymentReadinessPack = {
      id: 'pay-1', purchaseOrderId: 'po-1', acceptancePackId: 'accept-1',
      poMatch: true, status: 'ready_for_finance', preparedAt: '2026-07-10T00:00:00Z',
      invoiceOrSiReference: 'invoice.pdf',
      milestoneSupportReference: 'receipt.pdf',
      taxWithholdingSupportReference: 'tax.pdf',
    };
    expect(evaluatePaymentReadiness(acceptance, pack)).toEqual([]);
  });
});

describe('applyReceipt (PR-24 — partial receipts)', () => {
  it('records a partial receipt without closing the PO', () => {
    const res = applyReceipt([line('a', 10), line('b', 5)], [
      { lineId: 'a', quantity: 4 },
    ]);
    expect(res).not.toBeNull();
    expect(res!.closes).toBe(false);
    expect(res!.lines.find((l) => l.id === 'a')?.receivedQuantity).toBe(4);
    expect(res!.lines.find((l) => l.id === 'b')?.receivedQuantity).toBe(0);
    expect(res!.accepted).toEqual([
      { lineId: 'a', description: 'Line a', quantity: 4 },
    ]);
  });

  it('closes when every line reaches its ordered quantity', () => {
    const res = applyReceipt(
      [line('a', 10, 6), line('b', 5, 0)],
      [
        { lineId: 'a', quantity: 4 },
        { lineId: 'b', quantity: 5 },
      ],
    );
    expect(res!.closes).toBe(true);
  });

  it('clamps quantities to the outstanding amount', () => {
    const res = applyReceipt([line('a', 10, 8)], [{ lineId: 'a', quantity: 99 }]);
    expect(res!.accepted[0]?.quantity).toBe(2);
    expect(res!.lines[0]?.receivedQuantity).toBe(10);
    expect(res!.closes).toBe(true);
  });

  it('ignores zero, negative, NaN quantities and unknown line ids', () => {
    const res = applyReceipt(
      [line('a', 10), line('b', 5)],
      [
        { lineId: 'a', quantity: 0 },
        { lineId: 'b', quantity: -3 },
        { lineId: 'b', quantity: Number.NaN },
        { lineId: 'ghost', quantity: 4 },
      ],
    );
    expect(res).toBeNull();
  });

  it('returns null when nothing is outstanding', () => {
    const res = applyReceipt([line('a', 10, 10)], [{ lineId: 'a', quantity: 5 }]);
    expect(res).toBeNull();
  });

  it('supports receiving the same PO across multiple sequential receipts', () => {
    const first = applyReceipt([line('a', 10)], [{ lineId: 'a', quantity: 3 }]);
    expect(first!.closes).toBe(false);
    const second = applyReceipt(first!.lines, [{ lineId: 'a', quantity: 7 }]);
    expect(second!.closes).toBe(true);
    expect(second!.lines[0]?.receivedQuantity).toBe(10);
  });
});
