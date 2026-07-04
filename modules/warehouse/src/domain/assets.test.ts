import { describe, it, expect } from 'vitest';
import { serializedAssetRegister } from './assets';
import type { InventoryUnit, Product } from './types';

const watch: Product = {
  id: 'p-watch',
  sku: 'SMART-WATCH',
  name: 'Smart Watch',
  category: 'device',
  deviceType: 'smart_watch',
  serialized: true,
  attributes: {},
  unitCost: 3200,
  reorderPoint: 5,
};
const ring: Product = {
  id: 'p-ring',
  sku: 'ECG-RING-10',
  name: 'ECG Ring (10)',
  category: 'device',
  deviceType: 'ecg_ring',
  serialized: true,
  attributes: {},
  unitCost: 2500,
  reorderPoint: 5,
};

function unit(over: Partial<InventoryUnit>): InventoryUnit {
  return {
    id: crypto.randomUUID(),
    productId: 'p-ring',
    serialNumber: 'SN',
    locationId: 'loc-wh',
    status: 'in_stock',
    ...over,
  };
}

describe('serializedAssetRegister', () => {
  it('includes only issued/allocated units sorted by product then serial', () => {
    const units = [
      unit({ productId: 'p-watch', serialNumber: 'W2', status: 'issued', assignedTo: 'VIP', eventId: 'e1' }),
      unit({ productId: 'p-ring', serialNumber: 'R2', status: 'allocated' }),
      unit({ productId: 'p-ring', serialNumber: 'R1', status: 'issued', assignedTo: 'Dr. Santos' }),
      unit({ productId: 'p-ring', serialNumber: 'R9', status: 'in_stock' }),
      unit({ productId: 'p-ring', serialNumber: 'R8', status: 'returned' }),
    ];
    const rows = serializedAssetRegister(units, [watch, ring]);
    expect(rows.map((r) => r.serialNumber)).toEqual(['R1', 'R2', 'W2']);
    expect(rows[0]).toEqual({
      serialNumber: 'R1',
      productId: 'p-ring',
      productName: 'ECG Ring (10)',
      assignedTo: 'Dr. Santos',
      eventId: undefined,
      status: 'issued',
    });
    expect(rows[2]?.assignedTo).toBe('VIP');
    expect(rows[2]?.eventId).toBe('e1');
  });

  it('returns an empty array when nothing is in the field', () => {
    const units = [unit({ status: 'in_stock' }), unit({ status: 'lost' })];
    expect(serializedAssetRegister(units, [ring])).toEqual([]);
  });
});
