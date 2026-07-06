import { describe, expect, it } from 'vitest';
import { buildActivityHistory, buildSeed } from './seed';

const NOW = new Date('2026-07-06T12:00:00.000Z');

describe('buildActivityHistory', () => {
  const history = buildActivityHistory(NOW);

  it('produces a dense 90-day movement history', () => {
    expect(history.movements.length).toBeGreaterThanOrEqual(50);
    const types = new Set(history.movements.map((m) => m.type));
    for (const t of ['issue', 'return', 'receipt', 'transfer', 'cycle_count']) {
      expect(types.has(t as never), `missing movement type ${t}`).toBe(true);
    }
  });

  it('movements span the window and never land in the future', () => {
    const nowMs = NOW.getTime();
    const ninetyDaysMs = 90 * 86_400_000;
    let oldest = Infinity;
    for (const m of history.movements) {
      const t = new Date(m.createdAt).getTime();
      expect(t).toBeLessThanOrEqual(nowMs);
      oldest = Math.min(oldest, t);
    }
    expect(nowMs - oldest).toBeGreaterThan(ninetyDaysMs * 0.8);
  });

  it('adds an upcoming event with reserved allocations', () => {
    expect(history.events).toHaveLength(1);
    const evt = history.events[0]!;
    expect(new Date(evt.startDate).getTime()).toBeGreaterThan(NOW.getTime());
    expect(history.allocations.length).toBeGreaterThanOrEqual(3);
    for (const a of history.allocations) {
      expect(a.eventId).toBe(evt.id);
      expect(a.status).toBe('reserved');
    }
  });

  it('cycle counts include a variance and a balanced count', () => {
    expect(history.cycleCounts.length).toBeGreaterThanOrEqual(2);
    const hasVariance = history.cycleCounts.some((c) =>
      c.lines.some((l) => l.counted !== l.expected),
    );
    const hasBalancedLine = history.cycleCounts.some((c) =>
      c.lines.every((l) => l.counted === l.expected) ||
      c.lines.some((l) => l.counted === l.expected),
    );
    expect(hasVariance).toBe(true);
    expect(hasBalancedLine).toBe(true);
  });

  it('is deterministic for a fixed now', () => {
    expect(buildActivityHistory(NOW)).toEqual(history);
  });
});

describe('buildSeed with history', () => {
  const seed = buildSeed();

  it('merges the history into the base dataset', () => {
    expect(seed.movements.length).toBeGreaterThanOrEqual(60);
    expect(seed.returns.length).toBeGreaterThanOrEqual(4);
    expect(seed.cycleCounts.length).toBeGreaterThanOrEqual(3);
    expect(seed.receipts.length).toBeGreaterThanOrEqual(3);
    expect(seed.events.length).toBeGreaterThanOrEqual(6);
  });

  it('every history movement references a real product', () => {
    const productIds = new Set(seed.products.map((p) => p.id));
    for (const m of seed.movements) {
      expect(productIds.has(m.productId), `unknown product ${m.productId}`).toBe(true);
    }
  });

  it('every allocation references a real event and product', () => {
    const eventIds = new Set(seed.events.map((e) => e.id));
    const productIds = new Set(seed.products.map((p) => p.id));
    for (const a of seed.allocations) {
      expect(eventIds.has(a.eventId), `unknown event ${a.eventId}`).toBe(true);
      expect(productIds.has(a.productId), `unknown product ${a.productId}`).toBe(true);
    }
  });

  it('movement ids are unique', () => {
    const ids = seed.movements.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
