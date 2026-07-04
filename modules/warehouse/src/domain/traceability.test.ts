import { describe, it, expect } from 'vitest';
import {
  findUnitBySerial,
  productMovementHistory,
  unitTimeline,
} from './traceability';
import type { InventoryUnit, Movement } from './types';

const movements: Movement[] = [
  { id: 'm1', type: 'receipt', productId: 'ring', quantity: 1, serialNumber: 'SN1', actor: 'a', createdAt: '2026-06-01T00:00:00.000Z' },
  { id: 'm2', type: 'issue', productId: 'ring', quantity: 1, serialNumber: 'SN1', actor: 'a', createdAt: '2026-06-03T00:00:00.000Z' },
  { id: 'm3', type: 'return', productId: 'ring', quantity: 1, serialNumber: 'SN1', actor: 'a', createdAt: '2026-06-02T00:00:00.000Z' },
  { id: 'm4', type: 'issue', productId: 'ring', quantity: 1, serialNumber: 'SN2', actor: 'a', createdAt: '2026-06-05T00:00:00.000Z' },
  { id: 'm5', type: 'issue', productId: 'shirt', quantity: 5, actor: 'a', createdAt: '2026-06-04T00:00:00.000Z' },
];

const units: InventoryUnit[] = [
  { id: 'u1', productId: 'ring', serialNumber: 'SN1', locationId: 'loc-wh', status: 'in_stock' },
  { id: 'u2', productId: 'ring', serialNumber: 'SN2', locationId: 'loc-wh', status: 'issued' },
];

describe('unitTimeline', () => {
  it('returns matching serial movements sorted ascending by createdAt', () => {
    const timeline = unitTimeline(movements, 'SN1');
    expect(timeline.map((m) => m.id)).toEqual(['m1', 'm3', 'm2']);
  });

  it('returns empty for unknown serial', () => {
    expect(unitTimeline(movements, 'NOPE')).toEqual([]);
  });

  it('folds in product-level receive/issue/transfer history when a productId is given', () => {
    const withAggregates: Movement[] = [
      ...movements,
      { id: 'r1', type: 'receipt', productId: 'ring', quantity: 10, actor: 'a', createdAt: '2026-05-30T00:00:00.000Z' },
      { id: 't1', type: 'transfer', productId: 'ring', quantity: 1, actor: 'a', createdAt: '2026-06-04T12:00:00.000Z' },
      { id: 'agg-issue', type: 'issue', productId: 'shirt', quantity: 5, actor: 'a', createdAt: '2026-06-06T00:00:00.000Z' },
    ];
    const timeline = unitTimeline(withAggregates, 'SN1', 'ring');
    // serial-specific (m1,m3,m2) + ring product-level aggregates (r1,t1), sorted asc; shirt aggregate excluded.
    expect(timeline.map((m) => m.id)).toEqual(['r1', 'm1', 'm3', 'm2', 't1']);
  });

  it('does not fold aggregates without a productId (back-compat)', () => {
    expect(unitTimeline(movements, 'SN1').map((m) => m.id)).toEqual([
      'm1',
      'm3',
      'm2',
    ]);
  });
});

describe('findUnitBySerial', () => {
  it('finds a unit by serial number', () => {
    expect(findUnitBySerial(units, 'SN2')?.id).toBe('u2');
  });

  it('returns undefined when not found', () => {
    expect(findUnitBySerial(units, 'SN9')).toBeUndefined();
  });
});

describe('productMovementHistory', () => {
  it('returns product movements sorted descending by createdAt', () => {
    const history = productMovementHistory(movements, 'ring');
    expect(history.map((m) => m.id)).toEqual(['m4', 'm2', 'm3', 'm1']);
  });
});
