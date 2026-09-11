import type { InsightArea } from './types';

const areas = new Set(['warehouse', 'procurement', 'legal', 'finance', 'executive']);
export function insightAreaFromPath(path: string): InsightArea | 'all' | 'invalid' {
  if (path === '/insights' || path === '/insights/') return 'all';
  const parts = path.split('/');
  return parts.length === 3 && parts[1] === 'insights' && areas.has(parts[2]!)
    ? parts[2] as InsightArea : 'invalid';
}

export function insightAreaHref(area: InsightArea | 'all'): string {
  return area === 'all' ? '/insights' : `/insights/${area}`;
}
