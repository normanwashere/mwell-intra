import { createElement, type ReactNode } from 'react';
import { writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PurchaseOrder } from '../types';
import { PODetailPage } from './PODetailPage';

const po: PurchaseOrder = {
  id: 'po-issued-1',
  poNumber: 'PO-2026-0042',
  requestId: 'req-approved-1',
  vendorId: 'vendor-approved-1',
  vendorName: 'Approved Medical Supply Corp',
  status: 'issued',
  origin: 'procurement',
  lines: [{
    id: 'line-1',
    description: 'Barcode scanners',
    quantity: 10,
    receivedQuantity: 4,
    uom: 'pcs',
    unitPrice: 100,
  }],
  receiptStatus: {
    orderedQuantity: 10,
    acceptedQuantity: 3,
    rejectedOrQuarantinedQuantity: 1,
    outstandingQuantity: 6,
    latestReceiptReference: 'rcpt-warehouse-1',
    latestQcStatus: 'exception',
    lastReceiptAt: '2026-07-15T09:00:00.000Z',
    acceptedLines: [{
      poLineId: 'line-1', acceptedQuantity: 3, rejectedOrQuarantinedQuantity: 1,
    }],
  },
  commitmentReadiness: {
    ready: false,
    phase: 'issue',
    requestId: 'req-approved-1',
    vendorId: 'vendor-approved-1',
    route: 'rfq',
    blockers: ['approved policy evidence RFQ_COMMERCIAL_COMPARISON'],
    evidence: [{
      id: 'evidence-1',
      controlCode: 'RFQ_COMMERCIAL_COMPARISON', evidenceType: 'comparison',
      reviewStatus: 'submitted', facts: {},
    }],
    protections: [{
      id: 'protection-1', protectionType: 'performance_bond',
      triggerBasis: 'Contract commitment', status: 'required',
    }, {
      id: 'protection-2', protectionType: 'payment_bond',
      triggerBasis: 'Authorized risk decision', status: 'waived',
      waiverReason: 'Equivalent escrow is active', waiverBasis: 'Approved risk classification',
      waiverEvidenceStoragePath: 'evidence/escrow-review.pdf',
    }],
    canRecordAcceptance: true,
  },
  acceptancePacks: [{
    id: 'acceptance-pack-1', purchaseOrderId: 'po-issued-1', requestId: 'req-approved-1',
    warehouseReceiptReference: 'rcpt-warehouse-1', acceptanceType: 'goods',
    acceptedScope: 'First partial receipt', exceptions: [], acceptedAt: '2026-07-15T08:00:00.000Z',
    status: 'accepted',
  }, {
    id: 'acceptance-pack-2', purchaseOrderId: 'po-issued-1', requestId: 'req-approved-1',
    warehouseReceiptReference: 'rcpt-warehouse-2', acceptanceType: 'goods',
    acceptedScope: 'Second partial receipt', exceptions: [], acceptedAt: '2026-07-15T09:00:00.000Z',
    status: 'accepted',
  }],
  createdAt: '2026-07-14T09:00:00.000Z',
  updatedAt: '2026-07-15T09:00:00.000Z',
  total: 1_000,
};

let warehouseAccess = true;
let procurementAccess = true;
let requesterId: string | undefined;

vi.mock('@intra/auth', async () => {
  const actual = await vi.importActual<typeof import('@intra/auth')>('@intra/auth');
  return {
    ...actual,
    Guard: ({ children }: { children: ReactNode }) => children,
    useCan: (module: string, cap: string) =>
      module === 'warehouse' && cap === 'receive_stock'
        ? warehouseAccess
        : module === 'procurement'
          ? procurementAccess
          : true,
    useSession: () => ({ profile: { id: 'requester-1', name: 'Procurement Officer', email: 'procurement@mwell.com.ph' } }),
  };
});

vi.mock('@intra/ui', async () => {
  const actual = await vi.importActual<typeof import('@intra/ui')>('@intra/ui');
  return {
    ...actual,
    useToast: () => ({ success: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../localStore', () => ({
  isAccredited: () => true,
  useProcurementRequests: () => ({
    rows: [{ id: 'req-approved-1', status: 'approved', category: 'goods', requesterId }],
  }),
  useProcurementVendors: () => [{
    id: 'vendor-approved-1',
    legalName: 'Approved Medical Supply Corp',
    accreditationStatus: 'approved',
    accreditationExpiresAt: '2027-01-01',
  }],
  usePurchaseOrders: () => ({
    rows: [po],
    loading: false,
    approve: vi.fn(),
    issue: vi.fn(),
    cancel: vi.fn(),
    recordAcceptance: vi.fn(),
    preparePayment: vi.fn(),
    reviewPayment: vi.fn(),
  }),
}));

function renderPage() {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/purchase-orders/po-issued-1'] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: '/purchase-orders/:id',
          element: createElement(PODetailPage),
        }),
      ),
    ),
  );
}

describe('PODetailPage Warehouse handoff', () => {
  it('shows Unknown for unavailable receipt authority and missing normalized counts', () => {
    const priorReceipt = po.receiptStatus;
    const priorLines = po.lines;
    try {
      po.receiptStatus = undefined;
      po.lines = po.lines.map(line => ({ ...line, receivedQuantity: Number.NaN }));
      const html = renderPage();
      expect(html).not.toContain('NaN');
      expect(html).toMatch(/Accepted<\/p>[^]*?>Unknown<\/p>/);
      expect(html).toMatch(/Not yet QC accepted \(outstanding\)<\/p>[^]*?>Unknown<\/p>/);
      expect(html).toMatch(/QC:[^]*?>Unknown<\/strong>/);
    } finally {
      po.receiptStatus = priorReceipt;
      po.lines = priorLines;
    }
  });
  it('does not infer satisfied issue controls or completed QC from closed PO status', () => {
    const priorStatus = po.status;
    const priorReceipt = po.receiptStatus;
    try {
      po.status = 'closed';
      po.receiptStatus = { ...priorReceipt!, acceptedQuantity: 0, outstandingQuantity: 10, latestQcStatus: 'not_received' };
      const html = renderPage();
      expect(html).not.toContain('Issue controls satisfied before closure');
      expect(html).toContain('Closed PO: current control gaps');
      expect(html).toContain('approved policy evidence RFQ_COMMERCIAL_COMPARISON');
      expect(html).toContain('Not yet QC accepted');
      expect(html).toContain('Awaiting QC acceptance');
      expect(html).not.toContain('not_received');
      if (process.env.QA_PO_STATUS_HTML) writeFileSync(process.env.QA_PO_STATUS_HTML, html);
    } finally {
      po.status = priorStatus;
      po.receiptStatus = priorReceipt;
    }
  });
  beforeEach(() => {
    warehouseAccess = true;
    procurementAccess = true;
    requesterId = undefined;
  });

  it('removes receipt mutation and shows governed Warehouse status for issued POs', () => {
    const html = renderPage();

    expect(html).not.toMatch(/receive items/i);
    expect(html).toMatch(/warehouse receiving/i);
    expect(html).toMatch(/accepted[^]*3/i);
    expect(html).toMatch(/rejected[^]*1/i);
    expect(html).toMatch(/outstanding[^]*6/i);
    expect(html).toMatch(/approved policy evidence RFQ_COMMERCIAL_COMPARISON/i);
    expect(html).toMatch(/RFQ_COMMERCIAL_COMPARISON[^]*submitted/i);
    expect(html).toMatch(/href="[^"]*\/warehouse\/purchase-orders\?po=po-issued-1"[^>]*>[^<]*open warehouse handoff/i);
    expect(html).not.toContain('/warehouse/purchase-orders/po-issued-1');
    expect(html.match(/\/warehouse\/purchase-orders\?po=po-issued-1/g)).toHaveLength(2);
    expect(html).not.toMatch(/>Waive<\/button>/i);
    expect(html).toMatch(/waive with evidence/i);
    expect(html).toMatch(/Approved risk classification[^]*Equivalent escrow is active[^]*escrow-review\.pdf/i);
    expect(html).toMatch(/2 active acceptance packs/i);
    expect(html).toMatch(/First partial receipt/i);
    expect(html).toMatch(/Second partial receipt/i);
  });

  it('keeps receipt status readable without rendering a dead handoff link', () => {
    warehouseAccess = false;
    const html = renderPage();

    expect(html).toMatch(/warehouse receiving/i);
    expect(html).not.toMatch(/open warehouse handoff/i);
  });

  it('uses the immutable requester id when a request has no denormalized email', () => {
    procurementAccess = false;
    warehouseAccess = false;
    requesterId = 'requester-1';

    const html = renderPage();

    expect(html).toMatch(/PO-2026-0042/);
    expect(html).not.toMatch(/No purchase order access/);
  });
});
