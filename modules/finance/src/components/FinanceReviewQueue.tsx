'use client';

import { Badge, DataTable, EmptyState, SectionTitle, money, type Column } from '@intra/ui';
import type { FinancePaymentItem, PaymentReadinessStatus } from '../types';

const STATUS_LABEL: Record<PaymentReadinessStatus, string> = {
  draft: 'Draft',
  ready_for_finance: 'Ready for Finance',
  returned: 'Correction required',
  accepted: 'Accepted',
  released: 'Released',
  superseded: 'Superseded',
};

const STATUS_TONE: Record<
  PaymentReadinessStatus,
  'slate' | 'amber' | 'rose' | 'emerald' | 'cyan'
> = {
  draft: 'slate',
  ready_for_finance: 'amber',
  returned: 'rose',
  accepted: 'emerald',
  released: 'cyan',
  superseded: 'slate',
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

const columns: Column<FinancePaymentItem>[] = [
  {
    key: 'po',
    header: 'Purchase order',
    primary: true,
    sortable: true,
    sortValue: (row) => row.poNumber,
    render: (row) => (
      <span className="block min-w-0">
        <a
          href={`/procurement/purchase-orders/${encodeURIComponent(row.purchaseOrderId)}`}
          className="block max-w-full break-all font-semibold text-brand-700 hover:underline sm:break-normal dark:text-brand-300"
        >
          {row.poNumber}
        </a>
        <span className="block truncate text-xs font-normal text-muted">
          {row.vendorName}
        </span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Finance state',
    render: (row) => (
      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
    ),
  },
  {
    key: 'match',
    header: 'PO match',
    render: (row) => (
      <Badge tone={row.poMatch ? 'emerald' : 'rose'}>
        {row.poMatch ? 'Matched' : 'Mismatch'}
      </Badge>
    ),
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.amount,
    render: (row) => money(row.amount),
  },
  {
    key: 'prepared',
    header: 'Prepared',
    hideOnMobile: true,
    sortable: true,
    sortValue: (row) => row.preparedAt,
    render: (row) => formatDate(row.preparedAt),
  },
];

function priority(item: FinancePaymentItem): number {
  if (item.status === 'ready_for_finance') return 0;
  if (item.status === 'returned') return 1;
  if (item.status === 'draft') return 2;
  return 3;
}

export function FinanceReviewQueue({ items }: { items: FinancePaymentItem[] }) {
  const visible = [...items]
    .filter((item) => item.status !== 'superseded')
    .sort((a, b) => priority(a) - priority(b) || b.preparedAt.localeCompare(a.preparedAt));

  return (
    <section aria-label="Payment readiness" className="min-w-0 max-w-full overflow-hidden">
      <SectionTitle
        title="Payment readiness"
        subtitle="Prioritized evidence packs handed off by Procurement"
        action={
          visible.some((item) => item.status === 'ready_for_finance') ? (
            <Badge tone="amber">
              {visible.filter((item) => item.status === 'ready_for_finance').length} waiting
            </Badge>
          ) : undefined
        }
      />
      {visible.length === 0 ? (
        <EmptyState
          icon="check"
          title="No payment packs yet"
          message="Payment readiness appears after an approved PO, governed receipt or service acceptance, and complete invoice evidence."
        />
      ) : (
        <DataTable
          ariaLabel="Payment readiness queue"
          columns={columns}
          rows={visible}
          keyOf={(row) => row.id}
          density="compact"
        />
      )}
    </section>
  );
}
