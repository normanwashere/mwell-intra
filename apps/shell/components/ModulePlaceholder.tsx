// Presentational "coming soon" placeholder for gated module routes. Pure (no
// hooks / no 'use client') so it composes inside client Guard pages. Real UIs
// land in Step 2 (Warehouse) and Step 3 (Procurement, Legal, /vendor).

import { Badge, EmptyState, PageHeader, type IconName } from '@intra/ui';

export interface ModulePlaceholderProps {
  title: string;
  subtitle: string;
  step: string;
  icon?: IconName;
  bullets?: readonly string[];
}

export function ModulePlaceholder({
  title,
  subtitle,
  step,
  icon = 'box',
  bullets,
}: ModulePlaceholderProps) {
  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        action={<Badge tone="amber">{step}</Badge>}
      />
      <EmptyState
        icon={icon}
        title="This module is being built"
        message={`You have access here. The full experience arrives in ${step}.`}
      />
      {bullets && bullets.length > 0 && (
        <ul className="mx-auto mt-5 grid max-w-md gap-2 text-sm text-muted">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
