import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ProcurementRequest, PurchaseOrder } from '../types';
import { RequestDetailPage } from './RequestDetailPage';

let request: ProcurementRequest;
let readError: string | undefined;
let linkedOrders: PurchaseOrder[] = [];
const submit = vi.fn();
const cancel = vi.fn();
vi.mock('@intra/auth', () => ({
  Guard: ({ children }: { children: React.ReactNode }) => children,
  useCan: () => false,
  useSession: () => ({ profile: { id: 'viewer', email: 'viewer@example.test' }, mode: 'demo' }),
}));
vi.mock('@intra/ui', async () => ({
  ...await vi.importActual('@intra/ui'),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../localStore', () => ({
  useProcurementRequests: () => ({ rows: [request], loading: false, error: readError, submit, cancel, refresh: vi.fn() }),
  usePurchaseOrders: () => ({ rows: linkedOrders, add: vi.fn() }),
  useProcurementVendors: () => [],
  useApprovalHistory: () => [],
}));

beforeEach(() => {
  readError = undefined;
  linkedOrders = [];
  submit.mockClear(); cancel.mockClear();
  request = { id: 'request-kept', title: 'Request record', status: 'draft', category: 'goods', lines: [], attachments: [], createdAt: '2026-09-01T00:00:00Z' } as unknown as ProcurementRequest;
});
function renderPage() {
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/requests/request-kept']}><Routes><Route path="/requests/:id" element={<RequestDetailPage />} /></Routes></MemoryRouter>);
}
it.each([
  ['draft', 'Procurement / requester'],
  ['rejected', 'Review the rejection note'],
  ['cancelled', 'No further request action'],
  ['under_review', 'No pending approval step'],
  ['unexpected', 'Status unrecognized'],
])('renders the %s summary without mutation or an unauthorized primary action', (status, text) => {
  request.status = status as ProcurementRequest['status'];
  const html = renderPage();
  expect(html).toContain('Next responsibility');
  expect(html).toContain(text);
  expect(html).toContain('<h1');
  expect(html).not.toContain('hero-surface');
  expect(html).toContain('href="/procurement" class="btn-ghost btn-sm"');
  expect(html).not.toContain('>Submit for approval<');
  expect(submit).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});
it('retains the linked purchase order ID in the existing action', () => {
  request.status = 'approved';
  linkedOrders = [{ id: 'po-kept', requestId: request.id, poNumber: 'PO-KEPT', createdAt: request.createdAt }] as PurchaseOrder[];
  const html = renderPage();
  expect(html).toContain('href="/purchase-orders/po-kept"');
  expect(html).toContain('Review the linked purchase order');
});
it('shows read failure recovery without presenting stale request status as current', () => {
  readError = 'Request read failed';
  request.status = 'approved';
  const html = renderPage();
  expect(html).toContain('Request unavailable');
  expect(html).toContain('Request read failed');
  expect(html).toContain('Retry request');
  expect(html).toContain('href="/requests"');
  expect(html).not.toContain('Author purchase order');
});

it('keeps the competitive sourcing introduction stage-neutral until the sourcing state is loaded', () => {
  request.compliance = { routeConfirmed: true } as ProcurementRequest['compliance'];
  request.route = { procurementMode: 'competitive_bidding', solicitationType: 'rfq', governanceTier: 'standard' } as ProcurementRequest['route'];
  const html = renderPage();
  expect(html).toContain('Competitive sourcing');
  expect(html).toContain('Preparation, responses, evaluation, and award follow the recorded sourcing stage.');
  expect(html).not.toContain('Close the response window, document commercial and technical evidence');
  expect(submit).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});
