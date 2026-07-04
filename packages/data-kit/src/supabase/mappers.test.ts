import { describe, it, expect } from 'vitest';
import {
  rowToProduct,
  rowToUnit,
  unitToRow,
  rowToMovement,
  movementToRow,
  rowToAllocation,
  allocationToRow,
} from './mappers';

// Ported from `mwell-intra-warehouse/src/data/supabase/mappers.test.ts`.
// The only adaptation is the import path — the mapper module now lives inside
// `@intra/data-kit` (`./mappers` rather than the warehouse app's `./mappers`).

describe('rowToProduct', () => {
  it('maps snake_case columns and coerces numeric cost', () => {
    const p = rowToProduct({
      id: 'ring',
      sku: 'RING',
      name: 'Ring',
      category: 'device',
      device_type: 'ecg_ring',
      merchandise_type: null,
      serialized: true,
      attributes: { ringSize: '10' },
      unit_cost: '2500.00',
      reorder_point: 6,
      promotional: null,
      barcode: null,
    });
    expect(p).toMatchObject({
      id: 'ring',
      deviceType: 'ecg_ring',
      merchandiseType: undefined,
      serialized: true,
      attributes: { ringSize: '10' },
      unitCost: 2500,
      reorderPoint: 6,
      barcode: undefined,
    });
  });
});

describe('inventory unit round-trip', () => {
  it('survives row -> domain -> row', () => {
    const row = {
      id: 'u1',
      product_id: 'ring',
      serial_number: 'SN1',
      lot_id: null,
      location_id: 'loc-wh',
      bin_id: null,
      status: 'in_stock',
      assigned_to: null,
      event_id: null,
    };
    const back = unitToRow(rowToUnit(row));
    expect(back).toEqual(row);
  });
});

describe('movement round-trip', () => {
  it('preserves evidence and optional fields', () => {
    const row = {
      id: 'mv1',
      type: 'issue',
      product_id: 'ring',
      quantity: 2,
      from_location_id: null,
      to_location_id: null,
      from_bin_id: null,
      to_bin_id: null,
      lot_id: null,
      serial_number: null,
      event_id: 'e1',
      reason: null,
      reference: 'alloc-1',
      evidence_urls: ['blob:1'],
      actor: 'ops@mwell',
      created_at: '2026-06-10T00:00:00.000Z',
    };
    expect(movementToRow(rowToMovement(row))).toEqual(row);
  });
});

describe('allocation round-trip', () => {
  it('defaults promotional to false on the row', () => {
    const domain = rowToAllocation({
      id: 'a1',
      event_id: 'e1',
      product_id: 'ring',
      quantity: 5,
      status: 'reserved',
      promotional: null,
      created_at: '2026-06-10T00:00:00.000Z',
    });
    expect(domain.promotional).toBeUndefined();
    expect(allocationToRow(domain).promotional).toBe(false);
  });
});
