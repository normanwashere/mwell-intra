import { describe, expect, it } from 'vitest';
import { insightAreaFromPath, insightAreaHref } from './navigation';

describe('UX06 canonical insight routes', () => {
  it.each(['warehouse', 'procurement', 'legal', 'finance', 'executive', 'all'] as const)('round trips %s', area => {
    expect(insightAreaFromPath(insightAreaHref(area))).toBe(area);
  });
  it.each(['/insights/unknown', '/insights/executive/extra', '/insights//finance', '/other'])('rejects invalid route %s', path => {
    expect(insightAreaFromPath(path)).toBe('invalid');
  });
});
