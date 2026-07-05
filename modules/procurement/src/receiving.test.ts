import { describe, expect, it } from 'vitest';
import { applyReceipt, outstandingOf } from './receiving';
import type { PurchaseOrderLine } from './types';

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
