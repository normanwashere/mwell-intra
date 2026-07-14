'use client';

import { useParams } from 'next/navigation';
import { InsightsApp, type InsightArea } from '@intra/insights';

const AREAS = new Set<InsightArea>(['warehouse', 'procurement', 'legal', 'finance', 'executive']);

export default function InsightsPage() {
  const params = useParams<{ slug?: string[] }>();
  const requested = params.slug?.[0] as InsightArea | undefined;
  return <InsightsApp initialArea={requested && AREAS.has(requested) ? requested : undefined} />;
}
