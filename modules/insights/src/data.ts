'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@intra/auth';
import { can, type UserRoles } from '@intra/rbac';
import { INSIGHTS_DEMO_DATA } from './seed';
import type { InsightArea, InsightMetric, InsightsData } from './types';

type UnknownRow = Record<string, unknown>;
const AREAS: InsightArea[] = ['warehouse', 'procurement', 'legal', 'finance', 'executive'];
const text = (value: unknown, fallback = '') => typeof value === 'string' && value ? value : fallback;
const number = (value: unknown) => { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; };

export function visibleInsightAreas(roles: Partial<UserRoles>): InsightArea[] {
  return AREAS.filter((area) => can(roles, 'insights', `view_${area}`));
}

export function scopeInsights(data: InsightsData, areas: readonly InsightArea[]): InsightsData {
  return { ...data, metrics: data.metrics.filter((metric) => areas.includes(metric.area)) };
}

export function useInsightsData() {
  const { mode, supabaseClient, userRoles } = useSession();
  const live = mode === 'supabase' ? supabaseClient : null;
  const areas = visibleInsightAreas(userRoles);
  const [data, setData] = useState<InsightsData>(live ? { metrics: [], updatedAt: '', warnings: [] } : scopeInsights(INSIGHTS_DEMO_DATA, areas));
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!live) { setData(scopeInsights(INSIGHTS_DEMO_DATA, areas)); setLoading(false); return; }
    setLoading(true);
    const { data: rows, error: queryError } = await live.schema('core').from('v_insights_snapshot').select('id,area,label,value,unit,target,detail,source_href,updated_at').in('area', areas).limit(500);
    if (queryError) { setData({ metrics: [], updatedAt: '', warnings: [queryError.message] }); setError(queryError.message); }
    else {
      const mapped = (rows as UnknownRow[] ?? []).map((row): InsightMetric => ({ id: text(row.id), area: text(row.area) as InsightArea, label: text(row.label), value: number(row.value), unit: text(row.unit) || undefined, target: row.target == null ? undefined : number(row.target), detail: text(row.detail), sourceHref: text(row.source_href, '/') }));
      setData({ metrics: mapped, updatedAt: text((rows as UnknownRow[] | null)?.[0]?.updated_at, new Date().toISOString()), warnings: [] }); setError(null);
    }
    setLoading(false);
  }, [areas.join('|'), live]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { data, loading, error, refresh, areas };
}
