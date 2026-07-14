import type { InsightsData } from './types';

export const INSIGHTS_DEMO_DATA: InsightsData = {
  updatedAt: '2026-07-14T08:00:00+08:00', warnings: [],
  metrics: [
    { id: 'wh-fill', area: 'warehouse', label: 'Fulfillment rate', value: 92, unit: '%', target: 95, detail: 'Issued units against approved event demand', sourceHref: '/warehouse/analytics' },
    { id: 'wh-variance', area: 'warehouse', label: 'Open stock variances', value: 3, target: 0, detail: 'Unresolved cycle-count and approval variances', sourceHref: '/warehouse/exceptions' },
    { id: 'pr-cycle', area: 'procurement', label: 'Average PR-to-PO cycle', value: 6.4, unit: ' days', target: 5, detail: 'Approved requests converted to issued POs', sourceHref: '/procurement/purchase-orders' },
    { id: 'pr-approval', area: 'procurement', label: 'Approvals waiting', value: 7, target: 0, detail: 'Requests currently waiting for the next DOA tier', sourceHref: '/procurement/approvals' },
    { id: 'lg-review', area: 'legal', label: 'Accreditation review time', value: 4.2, unit: ' days', target: 3, detail: 'Submitted accreditation to legal determination', sourceHref: '/legal/accreditation' },
    { id: 'fn-ready', area: 'finance', label: 'Payment packs ready', value: 5, target: 0, detail: 'Reconciled packs awaiting Finance review', sourceHref: '/finance' },
    { id: 'ex-control', area: 'executive', label: 'Controls completed on time', value: 88, unit: '%', target: 95, detail: 'Cross-department operational controls completed within target', sourceHref: '/work' },
    { id: 'ex-risk', area: 'executive', label: 'Priority exceptions', value: 6, target: 0, detail: 'High-priority exceptions requiring accountable ownership', sourceHref: '/work' },
  ],
};
