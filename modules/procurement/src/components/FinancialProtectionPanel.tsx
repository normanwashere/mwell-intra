'use client';

import { Badge, Icon } from '@intra/ui';
import type { RequestCategory } from '../types';

export function FinancialProtectionPanel({
  category,
  amount,
  importation,
}: {
  category?: RequestCategory;
  amount: number;
  importation: boolean;
}) {
  const rows: Array<{ label: string; basis: string }> = [];
  if (category === 'manpower') rows.push({ label: 'Payment bond review', basis: 'Labor and worker/subcontractor payment exposure' });
  if (category === 'construction') {
    rows.push({ label: 'Performance bond - generally 30%', basis: 'Required before work starts or as approved' });
    rows.push({ label: 'Warranty bond - generally 10%', basis: 'Defects liability and warranty exposure' });
    if (amount >= 5_000_000) rows.push({ label: 'CARI/EARI - generally at least 100%', basis: 'Construction/erection risk review' });
  }
  if (importation) rows.push({ label: 'SBLC or equivalent protection review', basis: 'Foreign delivery and payment exposure; not an automatic RFP trigger' });
  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No automatic protection trigger identified. Procurement, Finance, and Legal may still require protection based on the final contract risk.</p>
      ) : rows.map((row) => (
        <div key={row.label} className="flex min-h-11 items-start gap-3 rounded-lg border border-line px-3 py-2">
          <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink">{row.label}</p><p className="text-xs text-muted">{row.basis}</p></div>
          <Badge tone="amber">Review</Badge>
        </div>
      ))}
    </div>
  );
}
