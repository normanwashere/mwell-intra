import { describe, it, expect } from 'vitest';
import {
  allocationsToCsv,
  inventoryToCsv,
  movementsToCsv,
  governedExportFilename,
  toCsv,
} from './export';
import type { StockState } from './stock';
import type {
  Allocation,
  Movement,
  Product,
  WarehouseEvent,
} from './types';

const products: Product[] = [
  {
    id: 'ring',
    sku: 'RING',
    name: 'Ring',
    category: 'device',
    serialized: true,
    attributes: {},
    unitCost: 2500,
    reorderPoint: 2,
  },
  {
    id: 'shirt',
    sku: 'SHIRT',
    name: 'Shirt',
    category: 'merchandise',
    serialized: false,
    attributes: {},
    unitCost: 200,
    reorderPoint: 10,
  },
];

describe('toCsv', () => {
  it('returns empty string for empty input', () => {
    expect(toCsv([])).toBe('');
  });

  it('builds a header from the first row keys', () => {
    expect(toCsv([{ a: 1, b: 'x' }])).toBe('a,b\n1,x');
  });

  it('escapes commas, quotes and newlines', () => {
    const csv = toCsv([{ name: 'a,b', note: 'say "hi"', multi: 'one\ntwo' }]);
    expect(csv).toBe('name,note,multi\n"a,b","say ""hi""","one\ntwo"');
  });
});

describe('governedExportFilename', () => {
  it('creates a stable, filesystem-safe audit filename', () => {
    expect(
      governedExportFilename('inventory', new Date('2026-07-10T04:30:15.000Z')),
    ).toBe('mwell-intra-inventory-20260710T043015Z.csv');
  });

  it('neutralizes formula-leading text cells', () => {
    expect(toCsv([{ value: '=HYPERLINK("bad")' }])).toContain("'=HYPERLINK");
    expect(toCsv([{ value: '@SUM(A1)' }])).toContain("'@SUM");
    expect(toCsv([{ value: '-10' }])).toContain("'-10");
  });
});

describe('movementsToCsv', () => {
  it('maps product ids to skus and includes locations', () => {
    const movements: Movement[] = [
      {
        id: 'm1',
        type: 'transfer',
        productId: 'ring',
        quantity: 2,
        fromLocationId: 'loc-wh',
        toLocationId: 'loc-cebu',
        actor: 'logi@mwell',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ];
    const csv = movementsToCsv(movements, products);
    const [header, row] = csv.split('\n');
    expect(header).toContain('sku');
    expect(row).toContain('RING');
    expect(row).toContain('loc-cebu');
  });
});

describe('inventoryToCsv', () => {
  it('emits sku,name,category,available,unitCost,value per product', () => {
    const state: StockState = {
      products,
      units: [
        { id: 'u1', productId: 'ring', serialNumber: 'SN1', locationId: 'loc-wh', status: 'in_stock' },
      ],
      stockLevels: [{ productId: 'shirt', locationId: 'loc-wh', quantity: 5 }],
    };
    const csv = inventoryToCsv(state);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('sku,name,category,available,unitCost,value');
    expect(lines).toContain('RING,Ring,device,1,2500,2500');
    expect(lines).toContain('SHIRT,Shirt,merchandise,5,200,1000');
  });
});

describe('allocationsToCsv', () => {
  it('resolves event names and product skus', () => {
    const allocations: Allocation[] = [
      { id: 'a1', eventId: 'e1', productId: 'shirt', quantity: 10, status: 'reserved', promotional: true, createdAt: '2026-06-01T00:00:00.000Z' },
    ];
    const events: WarehouseEvent[] = [
      { id: 'e1', name: 'Makati Day', type: 'corporate', startDate: '2026-06-10' },
    ];
    const csv = allocationsToCsv(allocations, products, events);
    expect(csv).toContain('Makati Day');
    expect(csv).toContain('SHIRT');
    expect(csv).toContain('yes');
  });
});
