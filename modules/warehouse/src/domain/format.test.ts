import { describe, expect, it } from 'vitest';
import {
  actorName,
  formatDate,
  formatWhen,
  movementTypeLabel,
  poNumberMap,
  signedQuantity,
  statusLabel,
} from './format';

describe('movementTypeLabel', () => {
  it('humanizes every movement slug', () => {
    expect(movementTypeLabel('cycle_count')).toBe('Cycle count');
    expect(movementTypeLabel('issue')).toBe('Issue');
    expect(movementTypeLabel('receipt')).toBe('Receipt');
  });
});

describe('signedQuantity (sign convention WH-4)', () => {
  it('renders issues as outbound (−), never "+40"', () => {
    expect(signedQuantity('issue', 40)).toBe('−40');
    expect(signedQuantity('issue', -40)).toBe('−40');
  });

  it('renders allocations as outbound', () => {
    expect(signedQuantity('allocation', 5)).toBe('−5');
  });

  it('renders receipts and returns as inbound (+)', () => {
    expect(signedQuantity('receipt', 25)).toBe('+25');
    expect(signedQuantity('return', 3)).toBe('+3');
  });

  it('keeps the recorded sign for adjustments and cycle counts', () => {
    expect(signedQuantity('adjustment', -2)).toBe('−2');
    expect(signedQuantity('adjustment', 2)).toBe('+2');
    expect(signedQuantity('cycle_count', -7)).toBe('−7');
    expect(signedQuantity('cycle_count', 0)).toBe('0');
  });

  it('renders transfers as neutral', () => {
    expect(signedQuantity('transfer', 12)).toBe('12');
  });
});

describe('statusLabel', () => {
  it('sentence-cases slugs', () => {
    expect(statusLabel('partially_received')).toBe('Partially received');
    expect(statusLabel('draft')).toBe('Draft');
  });
});

describe('formatDate / formatWhen (WH-5)', () => {
  it('formats en-PH medium dates', () => {
    expect(formatDate('2026-06-10T00:00:00.000Z')).toMatch(/10 Jun 2026/);
  });

  it('returns empty for invalid input', () => {
    expect(formatDate('nonsense')).toBe('');
  });

  it('uses relative time under 7 days and absolute dates beyond', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(formatWhen(twoHoursAgo)).toBe('2h ago');
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(formatWhen(monthAgo)).toMatch(/\d{1,2} \w{3} \d{4}/);
  });
});

describe('actorName', () => {
  it('resolves known demo emails to persona names', () => {
    expect(actorName('logistics@mwell.demo')).toBe('Bea Santos');
  });

  it('falls back to the raw identifier for unknown actors', () => {
    expect(actorName('someone@example.com')).toBe('someone@example.com');
  });
});

describe('poNumberMap (WH-26)', () => {
  it('assigns stable human numbers in creation order', () => {
    const map = poNumberMap([
      { id: 'po-b', createdAt: '2026-06-02T00:00:00Z' },
      { id: 'po-a', createdAt: '2026-06-01T00:00:00Z' },
    ]);
    expect(map.get('po-a')).toBe('PO-0001');
    expect(map.get('po-b')).toBe('PO-0002');
  });

  it('breaks createdAt ties by id so numbering never flaps', () => {
    const map = poNumberMap([
      { id: 'po-z', createdAt: '2026-06-01T00:00:00Z' },
      { id: 'po-a', createdAt: '2026-06-01T00:00:00Z' },
    ]);
    expect(map.get('po-a')).toBe('PO-0001');
    expect(map.get('po-z')).toBe('PO-0002');
  });
});
