'use client';

import { StatCard, money } from '@intra/ui';
import type { FinanceSummary, FinanceData } from '../types';

export function FinanceOverview({ summary, states, procurement = true, warehouse = true }: { summary: FinanceSummary; states?: FinanceData['sourceStates']; procurement?: boolean; warehouse?: boolean }) {
  const value = (source: keyof NonNullable<FinanceData['sourceStates']>, amount: number, allowed = true, currency = true) => !allowed || states?.[source] === 'not_authorized' ? 'Not in your scope' : states?.[source] === 'error' ? 'Unavailable' : states?.[source] === 'loading' ? 'Loading' : currency ? money(amount) : amount;
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Finance summary">
      <StatCard
        label="Inventory value"
        value={value('inventory', summary.inventoryValue, warehouse)}
        icon="coins"
        tone="emerald"
        hint="On-hand stock at recorded unit cost"
      />
      <StatCard
        label="Committed POs"
        value={value('activity', summary.committedValue, procurement)}
        icon="cart"
        tone="brand"
        hint="Approved, issued, and closed POs"
      />
      <StatCard
        label="Net received"
        value={value('activity', summary.netWarehouseValue, warehouse)}
        icon="box"
        tone="cyan"
        hint={warehouse && states?.activity !== 'error' ? `${money(summary.receivedValue)} less ${money(summary.returnedValue)} returns` : 'Source-scoped period activity'}
      />
      <StatCard
        label="Needs review"
        value={value('payments', summary.reviewCount, procurement, false)}
        icon="clipboard"
        tone={summary.reviewCount > 0 ? 'amber' : 'emerald'}
        hint={
          !procurement || states?.payments === 'error' ? 'Payment source unavailable in this view' : summary.returnedCount > 0
            ? `${summary.returnedCount} returned for correction`
            : `${summary.acceptedCount} payment packs cleared`
        }
      />
    </div>
  );
}
