'use client';

import { useState } from 'react';
import { useSession } from '@intra/auth';
import { Badge, Card, EmptyState, HeroChipButton, Icon, ModuleHero, SegmentedControl, SignInPrompt, SkeletonStats } from '@intra/ui';
import { useInsightsData } from './data';
import type { InsightArea } from './types';

const LABELS: Record<InsightArea, string> = { warehouse: 'Warehouse', procurement: 'Procurement', legal: 'Legal', finance: 'Finance', executive: 'Executive' };

export function InsightsApp({ initialArea }: { initialArea?: InsightArea }) {
  const { profile, loading: sessionLoading } = useSession();
  const { data, loading, error, refresh, areas } = useInsightsData();
  const [area, setArea] = useState<InsightArea | 'all'>(initialArea && areas.includes(initialArea) ? initialArea : 'all');
  if (sessionLoading || (profile && loading)) return <div aria-busy="true"><SkeletonStats /></div>;
  if (!profile) return <SignInPrompt module="Insights" basename="/insights" />;
  if (areas.length === 0) return <div role="alert" className="grid min-h-[60vh] place-items-center text-center"><div className="max-w-sm space-y-3"><Icon name="lock" className="mx-auto h-8 w-8 text-faint" /><h1 className="font-display text-lg font-bold text-ink">No Insights access</h1><p className="text-sm text-muted">Ask an administrator for an Insights analyst, manager, executive, or administrator role.</p></div></div>;
  const visible = area === 'all' ? data.metrics : data.metrics.filter((metric) => metric.area === area);
  return (
    <div className="space-y-6">
      <ModuleHero eyebrow="Decision support" title="Insights" description="Role-scoped indicators from governed operational sources. Open the source record when an indicator needs action." icon="trend" action={<HeroChipButton href="/work" icon="clipboard">Open My Work</HeroChipButton>} accessory={<Badge tone="brand">{areas.length} views available</Badge>} />
      {error && <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"><span><strong>Insights unavailable.</strong> {error}</span><button type="button" className="btn-ghost btn-sm" onClick={() => void refresh()}><Icon name="rotate" className="h-4 w-4" /> Retry</button></div>}
      <div className="overflow-x-auto pb-1"><SegmentedControl ariaLabel="Choose insight view" options={[{ value: 'all', label: 'All available' }, ...areas.map((value) => ({ value, label: LABELS[value] }))]} value={area} onChange={(value) => setArea(value as InsightArea | 'all')} /></div>
      {visible.length === 0 ? <EmptyState icon="trend" title="No indicators available" message="No governed metrics are available for this view yet." /> : (
        <section aria-label="Operational indicators" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((metric) => {
            const outsideTarget = metric.target != null && metric.value > metric.target;
            return <Card key={metric.id} className="flex min-h-56 flex-col gap-4">
              <div className="flex items-center justify-between gap-2"><Badge tone="slate">{LABELS[metric.area]}</Badge>{metric.target != null && <Badge tone={outsideTarget ? 'amber' : 'emerald'}>{outsideTarget ? 'Review' : 'On target'}</Badge>}</div>
              <div><p className="text-sm font-semibold text-muted">{metric.label}</p><p className="mt-1 font-display text-3xl font-extrabold text-ink">{metric.value}{metric.unit ?? ''}</p>{metric.target != null && <p className="mt-1 text-xs text-faint">Target: {metric.target}{metric.unit ?? ''}</p>}</div>
              <p className="text-sm text-muted">{metric.detail}</p>
              <a href={metric.sourceHref} className="btn-ghost mt-auto justify-between">Open governed source <Icon name="arrowRight" className="h-4 w-4" /></a>
            </Card>;
          })}
        </section>
      )}
      {data.updatedAt && <p className="text-xs text-faint">Data snapshot: {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.updatedAt))}</p>}
    </div>
  );
}
