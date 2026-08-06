import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { PurchaseOrderDetailRoute } from './PurchaseOrderDetailRoute';

const state = vi.hoisted(() => ({
  loading: false,
  item: null as null | Record<string, unknown>,
}));

vi.mock('../localStore', () => ({
  useAcceptanceWorkItem: () => ({
    loading: state.loading,
    item: state.item,
    recordAcceptance: vi.fn(),
  }),
  usePurchaseOrders: () => ({ rows: [], loading: false }),
  useProcurementRequests: () => ({ rows: [], loading: false }),
  useProcurementVendors: () => [],
}));

vi.mock('./PODetailPage', () => ({
  PODetailPage: () => createElement('h1', null, 'Full purchase order detail'),
}));

vi.mock('@intra/ui', async () => {
  const actual = await vi.importActual<typeof import('@intra/ui')>('@intra/ui');
  return { ...actual, useToast: () => ({ success: vi.fn(), error: vi.fn() }) };
});

function render(canViewFullDetail: boolean) {
  return renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: ['/purchase-orders/po-1'],
  }, createElement(Routes, null, createElement(Route, {
    path: '/purchase-orders/:id',
    element: createElement(PurchaseOrderDetailRoute, { canViewFullDetail }),
  }))));
}

beforeEach(() => {
  state.loading = false;
  state.item = null;
});

it('keeps full purchase-order roles on the commercial detail surface', () => {
  state.item = { purchaseOrderId: 'po-1' };
  expect(render(true)).toMatch(/Full purchase order detail/);
});

it('renders the scoped acceptance surface for an assigned requester', () => {
  state.item = {
    purchaseOrderId: 'po-1', poNumber: 'PO-001', requestId: 'req-1', status: 'issued',
    warehouseReceiptReference: 'receipt-1', qcStatus: 'accepted',
    lines: [{ poLineId: 'line-1', description: 'Ring kit', uom: 'pcs',
      orderedQuantity: 2, qcAcceptedQuantity: 2, rejectedOrQuarantinedQuantity: 0,
      warehouseReceiptId: 'receipt-1', qcInspectionIds: ['qc-1'] }],
  };
  const html = render(false);
  expect(html).toMatch(/Goods acceptance/);
  expect(html).toMatch(/Ring kit/);
  expect(html).not.toMatch(/Full purchase order detail/);
});

it('falls back to ownership-checked detail for non-stock requester acceptance', () => {
  expect(render(false)).toMatch(/Full purchase order detail/);
});
