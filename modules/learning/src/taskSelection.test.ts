import { describe, expect, it } from 'vitest';
import { taskRequirementIds, taskSelectionQuery } from './taskSelection';
import type { LearningSnapshot } from './types';

describe('UX11 task selection context', () => {
  it('reconciles completed requirements and transitive prerequisites without retaining unrelated roles', () => {
    const cap = { module: 'product' as const, capability: 'decide_go_live' };
    const snapshot = { curricula: [{ curriculum: { audience: 'internal' }, requirements: [
      { id: 'completed', audience: 'internal', capabilityOutcomes: [cap], prerequisiteIds: ['orientation'] },
      { id: 'orientation', audience: 'internal', capabilityOutcomes: [], prerequisiteIds: [] },
      { id: 'unrelated', audience: 'internal', capabilityOutcomes: [{ module: 'events', capability: 'manage_events' }], prerequisiteIds: [] },
    ] }], lockedCapabilities: [], progress: [{ requirementId: 'completed', state: 'passed' }] } as unknown as LearningSnapshot;
    expect(taskRequirementIds(snapshot, 'internal', [cap])).toEqual(['completed', 'orientation']);
    expect(taskRequirementIds(snapshot, 'vendor', [cap])).toEqual([]);
    expect(taskRequirementIds(null, 'internal', [cap])).toEqual([]);
  });
  const task = { id: 'review-product-decisions', actionHref: '/product' };
  it('preserves compatible record, query, fragment and requirement without mutating history input', () => {
    const current = new URLSearchParams({ task: 'old', next: '/product?status=approved#readiness-42', requirement: 'req-A' });
    const next = taskSelectionQuery(current, task, ['req-A']);
    expect(next.get('next')).toBe('/product?status=approved#readiness-42');
    expect(next.get('requirement')).toBe('req-A');
    expect(next.get('task')).toBe(task.id);
    expect(current.get('task')).toBe('old');
  });
  it.each(['/events/e1', '//evil.test', '/\\evil.test', '/%2f%2fevil.test', '/product-other/42'])('replaces incompatible/unsafe next %s and unrelated requirement', (next) => {
    const result = taskSelectionQuery(new URLSearchParams({ next, requirement: 'other' }), task, []);
    expect(result.get('next')).toBe('/product');
    expect(result.has('requirement')).toBe(false);
  });
});
