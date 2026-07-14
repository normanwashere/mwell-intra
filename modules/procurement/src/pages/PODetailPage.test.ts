import { createElement, type ReactNode } from 'react';
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
  createdAt: '2026-07-14T09:00:00.000Z',
  updatedAt: '2026-07-15T09:00:00.000Z',
  total: 1_000,
};

let warehouseAccess = true;

vi.mock('@intra/auth', async () => {
  const actual = await vi.importActual<typeof import('@intra/auth')>('@intra/auth');
  return {
    ...actual,
    Guard: ({ children }: { children: ReactNode }) => children,
    useCan: (module: string, cap: string) =>
      module === 'warehouse' && cap === 'receive_stock'
        ? warehouseAccess
        : true,
    useSession: () => ({ profile: { name: 'Procurement Officer', email: 'procurement@mwell.com.ph' } }),
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
    rows: [{ id: 'req-approved-1', status: 'approved', category: 'goods' }],
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
  beforeEach(() => {
    warehouseAccess = true;
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
  });

  it('keeps receipt status readable without rendering a dead handoff link', () => {
    warehouseAccess = false;
    const html = renderPage();

    expect(html).toMatch(/warehouse receiving/i);
    expect(html).not.toMatch(/open warehouse handoff/i);
  });
});
