import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROCUREMENT_PO_KEY,
  loadProcurementPOs,
  readProcurementPOs,
} from './procurementBridge';

function seedStore(value: unknown): void {
  window.localStorage.setItem(
    PROCUREMENT_PO_KEY,
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

const issuedPO = {
  id: 'ppo-1',
  poNumber: 'PO-2026-0003',
  requestId: 'req-9',
  vendorId: 'ven-acme',
  vendorName: 'Acme Medical Supplies',
  status: 'issued',
  expectedDate: '2026-07-20',
  origin: 'request',
  lines: [
    {
      id: 'l1',
      description: 'Barcode scanners',
      quantity: 4,
      uom: 'pcs',
      unitPrice: 650000,
      receivedQuantity: 1,
    },
    { id: 'l2', description: 'Charging docks', quantity: 2, receivedQuantity: 0 },
  ],
  createdAt: '2026-07-05T10:00:00.000Z',
  updatedAt: '2026-07-05T11:00:00.000Z',
  total: 2600000,
};

describe('readProcurementPOs (procurement → warehouse bridge)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns [] when the key is absent', () => {
    expect(readProcurementPOs()).toEqual([]);
  });

  it('returns [] for corrupt JSON', () => {
    seedStore('{not json');
    expect(readProcurementPOs()).toEqual([]);
  });

  it('returns [] when the payload is not an array', () => {
    seedStore({ hello: 'world' });
    expect(readProcurementPOs()).toEqual([]);
  });

  it('maps an issued PO onto the warehouse card shape', () => {
    seedStore([issuedPO]);
    const [po] = readProcurementPOs();
    expect(po).toBeDefined();
    expect(po!.poNumber).toBe('PO-2026-0003');
    expect(po!.vendorName).toBe('Acme Medical Supplies');
    expect(po!.status).toBe('issued');
    expect(po!.totalOrdered).toBe(6);
    expect(po!.totalReceived).toBe(1);
    expect(po!.value).toBe(2600000);
    expect(po!.href).toBe('/procurement/purchase-orders/ppo-1');
    expect(po!.warehouseHref).toBe('/warehouse/purchase-orders?po=ppo-1');
  });

  it('only surfaces receivable statuses (approved / issued)', () => {
    seedStore([
      issuedPO,
      { ...issuedPO, id: 'ppo-2', status: 'approved' },
      { ...issuedPO, id: 'ppo-3', status: 'draft' },
      { ...issuedPO, id: 'ppo-4', status: 'pending_approval' },
      { ...issuedPO, id: 'ppo-5', status: 'closed' },
      { ...issuedPO, id: 'ppo-6', status: 'cancelled' },
    ]);
    const ids = readProcurementPOs().map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('ppo-1');
    expect(ids).toContain('ppo-2');
  });

  it('ignores unknown fields the procurement sibling may add', () => {
    seedStore([
      {
        ...issuedPO,
        receiptEvents: [{ at: '2026-07-05', qty: 1 }],
        somethingNew: { nested: true },
      },
    ]);
    expect(readProcurementPOs()).toHaveLength(1);
  });

  it('tolerates missing lines and missing receivedQuantity', () => {
    seedStore([
      { ...issuedPO, id: 'no-lines', lines: undefined },
      {
        ...issuedPO,
        id: 'sparse-line',
        lines: [{ description: 'Mystery item', quantity: 3 }],
        total: undefined,
      },
    ]);
    const pos = readProcurementPOs();
    const noLines = pos.find((p) => p.id === 'no-lines');
    expect(noLines!.lines).toEqual([]);
    expect(noLines!.totalOrdered).toBe(0);
    const sparse = pos.find((p) => p.id === 'sparse-line');
    expect(sparse!.lines[0]!.receivedQuantity).toBe(0);
    expect(sparse!.value).toBe(0); // no stored total, no unit prices → 0
  });

  it('skips malformed rows instead of throwing', () => {
    seedStore([null, 42, 'nope', { status: 'issued' }, issuedPO]);
    const pos = readProcurementPOs();
    expect(pos).toHaveLength(1);
    expect(pos[0]!.id).toBe('ppo-1');
  });

  it('sorts newest first by createdAt', () => {
    seedStore([
      { ...issuedPO, id: 'old', createdAt: '2026-06-01T00:00:00.000Z' },
      { ...issuedPO, id: 'new', createdAt: '2026-07-01T00:00:00.000Z' },
    ]);
    expect(readProcurementPOs().map((p) => p.id)).toEqual(['old', 'new'].reverse());
  });

  it('never reads localStorage in live Supabase mode', async () => {
    const storage = { getItem: () => { throw new Error('localStorage must not be read'); } };
    const rows = await loadProcurementPOs(
      'supabase',
      async () => [{
        id: 'live-po-1', poNumber: 'PO-LIVE-001', vendorName: 'Live Vendor',
        status: 'issued', createdAt: '2026-07-20T08:00:00Z', total: 700, lines: [{
          id: 'line-1', description: 'Live stock', quantity: 3, receivedQuantity: 1, unitPrice: 250,
        }],
      }],
      storage,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'live-po-1', createdAt: '2026-07-20T08:00:00Z', totalOrdered: 3, totalReceived: 1, value: 700 });
    expect(rows[0]!.warehouseHref).toBe('/warehouse/purchase-orders?po=live-po-1');
  });
});
