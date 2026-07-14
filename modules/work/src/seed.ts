import type { WorkData } from './types';

export const WORK_DEMO_DATA: WorkData = {
  items: [
    { id: 'work-qc-318', source: 'warehouse', title: 'Inspect receipt RCPT-318', description: '3 receipt lines require evidence-backed quality inspection.', status: 'awaiting inspection', priority: 'high', dueAt: '2026-07-14T09:00:00+08:00', href: '/warehouse/quality-control' },
    { id: 'work-po-1042', source: 'finance', title: 'Review payment pack PO-2026-1042', description: 'The PO, receipt, and invoice references are ready for Finance.', status: 'ready for finance', priority: 'high', href: '/procurement/purchase-orders/po-demo-1042' },
    { id: 'work-vendor-45', source: 'legal', title: 'Review vendor accreditation', description: 'Cloudline Technology Services submitted all required documents.', status: 'legal review', priority: 'normal', href: '/legal/accreditation' },
    { id: 'work-event-cebu', source: 'events', title: 'Confirm Cebu event fulfillment', description: '160 units are reserved and need release coordination.', status: 'planned', priority: 'normal', dueAt: '2026-07-17T12:00:00+08:00', href: '/events/evt-demo-wellness-caravan' },
    { id: 'work-pr-88', source: 'procurement', title: 'Approve purchase request PR-0088', description: 'Department head approval is the next required step.', status: 'pending approval', priority: 'normal', href: '/procurement/approvals' },
  ],
  warnings: [],
};
