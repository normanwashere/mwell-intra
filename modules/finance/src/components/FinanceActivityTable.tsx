'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  DataTable,
  EmptyState,
  SectionTitle,
  SegmentedControl,
  money,
  type Column,
} from '@intra/ui';
import { filterFinanceActivity } from '../data';
import type {
  FinanceActivity,
  FinanceActivityFilter,
  FinanceActivitySource,
} from '../types';

const SOURCE_LABEL: Record<FinanceActivitySource, string> = {
  procurement_po: 'Procurement PO',
  warehouse_receipt: 'Warehouse receipt',
  warehouse_return: 'Warehouse return',
};

const SOURCE_TONE: Record<
  FinanceActivitySource,
  'brand' | 'emerald' | 'rose'
> = {
  procurement_po: 'brand',
  warehouse_receipt: 'emerald',
  warehouse_return: 'rose',
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(date);
}

function activityHref(item: FinanceActivity): string {
  if (item.purchaseOrderId) {
    return `/procurement/purchase-orders/${encodeURIComponent(item.purchaseOrderId)}`;
  }
  return item.source === 'warehouse_return'
    ? '/warehouse/returns'
    : '/warehouse/receiving';
}

const columns: Column<FinanceActivity>[] = [
  {
    key: 'reference',
    header: 'Reference',
    primary: true,
    sortable: true,
    sortValue: (row) => row.referenceId,
    render: (row) => (
      <a
        href={activityHref(row)}
        className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
      >
        {row.referenceId}
      </a>
    ),
  },
  {
    key: 'source',
    header: 'Source',
    render: (row) => (
      <Badge tone={SOURCE_TONE[row.source]}>{SOURCE_LABEL[row.source]}</Badge>
    ),
  },
  {
    key: 'status',
    header: 'State',
    render: (row) => <span className="capitalize">{row.status.replaceAll('_', ' ')}</span>,
  },
  {
    key: 'amount',
    header: 'Value',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.amount,
    render: (row) => (
      <span className={row.amount < 0 ? 'font-semibold text-rose-700 dark:text-rose-300' : 'font-semibold'}>
        {money(row.amount)}
      </span>
    ),
  },
  {
    key: 'date',
    header: 'Recorded',
    hideOnMobile: true,
    sortable: true,
    sortValue: (row) => row.occurredAt,
    render: (row) => formatDate(row.occurredAt),
  },
];

const FILTERS: Array<{ value: FinanceActivityFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'procurement', label: 'POs' },
  { value: 'receipts', label: 'Receipts' },
  { value: 'returns', label: 'Returns' },
];

export function FinanceActivityTable({ activity }: { activity: FinanceActivity[] }) {
  const [filter, setFilter] = useState<FinanceActivityFilter>('all');
  const visible = useMemo(
    () => filterFinanceActivity(activity, filter),
    [activity, filter],
  );

  return (
    <section aria-labelledby="finance-activity-title" className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <SectionTitle
          title="Cross-module activity"
          subtitle="One financial trail across approved POs, receipts, and returns"
        />
        <div className="w-full lg:w-auto lg:min-w-[24rem]">
          <SegmentedControl
            ariaLabel="Filter financial activity"
            options={FILTERS}
            value={filter}
            onChange={setFilter}
          />
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon="history"
          title="No activity in this view"
          message="Choose another source or complete an approved PO, receipt, or return workflow."
        />
      ) : (
        <DataTable
          ariaLabel="Cross-module financial activity"
          columns={columns}
          rows={visible}
          keyOf={(row) => row.id}
          density="compact"
        />
      )}
    </section>
  );
}
