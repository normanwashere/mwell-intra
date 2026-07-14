import { describe, expect, it } from 'vitest';
import { scopeInsights, visibleInsightAreas } from './data';
import { INSIGHTS_DEMO_DATA } from './seed';

describe('Insights scope', () => {
  it('shows analysts source detail without executive-only indicators', () => {
    const areas = visibleInsightAreas({ insights: ['analyst'] });
    expect(areas).toEqual(['warehouse', 'procurement', 'legal', 'finance']);
    expect(areas).not.toContain('executive');
  });

  it('keeps executive accounts summary-only', () => {
    const areas = visibleInsightAreas({ insights: ['executive'] });
    expect(areas).toEqual(['executive']);
    expect(scopeInsights(INSIGHTS_DEMO_DATA, areas).metrics.every((metric) => metric.area === 'executive')).toBe(true);
  });
});
