import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { AcceptanceWorkItemPage } from './AcceptanceWorkItemPage';

vi.mock('../localStore', () => ({
  useAcceptanceWorkItem: () => ({
    loading: false,
    item: {
      purchaseOrderId: 'po-1', poNumber: 'PO-001', requestId: 'req-1', status: 'issued',
      warehouseReceiptReference: 'rcpt-accepted-1', qcStatus: 'accepted',
      lines: [{ poLineId: 'line-1', description: 'Barcode scanners', uom: 'pcs',
        orderedQuantity: 10, qcAcceptedQuantity: 8, rejectedOrQuarantinedQuantity: 0,
        warehouseReceiptId: 'rcpt-accepted-1', qcInspectionIds: ['qc-accepted-1'] }],
    },
    recordAcceptance: vi.fn(),
  }),
}));

vi.mock('@intra/ui', async () => {
  const actual = await vi.importActual<typeof import('@intra/ui')>('@intra/ui');
  return { ...actual, useToast: () => ({ success: vi.fn(), error: vi.fn() }) };
});

it('renders only the scoped QC acceptance work item without commercial facts', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: ['/purchase-orders/po-1'],
  }, createElement(Routes, null, createElement(Route, {
    path: '/purchase-orders/:id', element: createElement(AcceptanceWorkItemPage),
  }))));
  expect(html).toMatch(/goods acceptance/i);
  expect(html).toMatch(/Barcode scanners/i);
  expect(html).toMatch(/QC accepted[^]*8/i);
  expect(html).toMatch(/rcpt-accepted-1/i);
  expect(html).not.toMatch(/latest receipt/i);
  expect(html).not.toMatch(/vendor|unit price|total value|commercial/i);
});
