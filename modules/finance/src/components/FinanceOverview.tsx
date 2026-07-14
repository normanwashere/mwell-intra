'use client';

import { StatCard, money } from '@intra/ui';
import type { FinanceSummary } from '../types';

export function FinanceOverview({ summary }: { summary: FinanceSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Finance summary">
      <StatCard
        label="Inventory value"
        value={money(summary.inventoryValue)}
        icon="coins"
        tone="emerald"
        hint="On-hand stock at recorded unit cost"
      />
      <StatCard
        label="Committed POs"
        value={money(summary.committedValue)}
        icon="cart"
        tone="brand"
        hint="Approved, issued, and closed POs"
      />
      <StatCard
        label="Net received"
        value={money(summary.netWarehouseValue)}
        icon="box"
        tone="cyan"
        hint={`${money(summary.receivedValue)} less ${money(summary.returnedValue)} returns`}
      />
      <StatCard
        label="Needs review"
        value={summary.reviewCount}
        icon="clipboard"
        tone={summary.reviewCount > 0 ? 'amber' : 'emerald'}
        hint={
          summary.returnedCount > 0
            ? `${summary.returnedCount} returned for correction`
            : `${summary.acceptedCount} payment packs cleared`
        }
      />
    </div>
  );
}
