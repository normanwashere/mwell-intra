import { describe, expect, it } from 'vitest';
import * as visibility from '../../../packages/data-kit/src/domain/testFixtures';

describe('persisted record purpose', () => {
  it('recognizes only the exact procurement volume seed contract', () => {
    expect(visibility.classifyRecord({ id: 'perf-sep12-request-99', description: 'Synthetic list-volume fixture; not submitted or approved.' }).purpose).toBe('load-only');
    for (const record of [
      { id: 'real', title: 'PERF-SEP12 draft purchase request 99' },
      { id: 'perf-sep12-request-99', description: 'Real replacement order' },
      { id: 'perf-sep12-request-999', description: 'Synthetic list-volume fixture; not submitted or approved.' },
    ]) expect(visibility.classifyRecord(record).purpose).toBe('unclassified');
  });
  it('requires complete explicit scenario metadata and never guesses readiness from a UAT title', () => {
    expect(visibility.classifyRecord({ title: 'UAT approved real business request' }).purpose).toBe('unclassified');
    expect(visibility.classifyRecord({ fixture: { purpose: 'scenario-ready' } }).purpose).toBe('unclassified');
    expect(visibility.classifyRecord({ fixture: { purpose: 'scenario-ready', scenarioName: 'Receipt', startingState: 'approved', nextActor: 'Warehouse receiver' } })).toMatchObject({ purpose: 'scenario-ready', scenarioName: 'Receipt', startingState: 'approved', nextActor: 'Warehouse receiver' });
  });
  it('requires the full persisted order or department fixture convention', () => {
    const order = { externalReference: 'PERF-SEP12-ORDER-0099', orderNotes: 'PERF-SEP12 synthetic volume fixture. No payment or stock allocated. Do not dispatch.', lines: [{ productId: 'perf-sep12-product-99' }] };
    expect(visibility.classifyRecord(order).purpose).toBe('load-only');
    expect(visibility.classifyRecord({ ...order, orderNotes: 'Real order' }).purpose).toBe('unclassified');
    expect(visibility.classifyRecord({ ...order, lines: [{ productId: 'real-product' }] }).purpose).toBe('unclassified');
    expect(visibility.classifyRecord({ purpose: 'PERF-SEP12 draft stock request 1', lines: [{ productId: 'perf-sep12-product-1' }] }).purpose).toBe('load-only');
    expect(visibility.classifyRecord({ purpose: 'PERF-SEP12 draft stock request 1' }).purpose).toBe('unclassified');
  });
  it('retains unclassified and business records by default, keeping load and evidence available explicitly', () => {
    expect(visibility.recordIsVisible({ purpose: 'unclassified' }, 'operational')).toBe(true);
    expect(visibility.recordIsVisible({ purpose: 'business-tester' }, 'operational')).toBe(true);
    expect(visibility.recordIsVisible({ purpose: 'load-only' }, 'operational')).toBe(false);
    expect(visibility.recordIsVisible({ purpose: 'historical-evidence' }, 'operational')).toBe(true);
    expect(visibility.recordIsVisible({ purpose: 'load-only' }, 'all')).toBe(true);
    expect(visibility.recordIsVisible({ purpose: 'unclassified' }, 'scenario-ready')).toBe(false);
  });
});
