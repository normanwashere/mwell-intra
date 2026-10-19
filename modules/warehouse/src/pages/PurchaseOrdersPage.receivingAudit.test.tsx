import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { PROCUREMENT_PO_KEY } from '@/data/procurementBridge';

const api = vi.hoisted(() => ({ rpc: vi.fn(), live: false, receiptRows: [] as Array<Record<string, unknown>> }));
vi.mock('@intra/auth', async original => {
  const actual = await original<typeof import('@intra/auth')>();
  const query = { select: () => query, eq: () => query, order: () => query, range: async () => ({ data: api.receiptRows, error: null }) };
  const client = { schema: () => ({ rpc: api.rpc, from: () => query }), storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://example.com/signed-evidence.jpg' }, error: null }) }) } };
  return { ...actual, useSession: () => {
    const session = actual.useSession();
    return api.live ? { ...session, mode: 'supabase', supabaseClient: client } : session;
  } };
});

const partial = { id: 'po-partial', poNumber: 'PO-ORIGINAL-7', vendorName: 'Vendor', status: 'issued', createdAt: '2026-10-20',
  lines: [{ id: 'line-1', productId: 'shirt-l', description: 'Shirts', quantity: 7, receivedQuantity: 3 }] };
const closed = { ...partial, status: 'closed', lines: [{ ...partial.lines[0], receivedQuantity: 7 }] };

beforeEach(() => { api.live = false; api.rpc.mockReset(); api.receiptRows = []; localStorage.clear(); });

it('lets the eligible independent Lead open the exact receipt and submit its existing uploaded evidence', async () => {
  api.live = true;
  api.receiptRows = [{ id: 'receipt-first', created_at: '2026-10-19', quality_status: 'accepted', evidence_urls: ['evidence/already-uploaded.jpg'] }];
  let decided = false;
  api.rpc.mockImplementation(async name => {
    if (name === 'resolve_procurement_po_exception') { decided = true; return { error: null }; }
    if (name === 'procurement_receipt_exception_work_items' && !decided) return { error: null, data: [{
      decision_id: 'decision-first', receipt_id: 'receipt-first', purchase_order_id: 'po-partial', po_number: 'PO-ORIGINAL-7',
      requested_disposition: 'short', requested_by: 'other-receiver', requested_at: '2026-10-19', reason: 'Four missing', status: 'pending',
      lines: [{ po_line_id: 'line-1', product_id: 'shirt-l', actual_quantity: 0, remaining_at_request: 4, raw_description: 'Shirts' }],
    }] };
    return { error: null, data: [] };
  });
  renderWithProviders(<PurchaseOrdersPage />, { source: 'supabase', role: 'logistics_supervisor', route: '/purchase-orders?receipt=receipt-first', capabilities: ['release_quality_hold', 'resolve_exceptions'] });
  const dialog = await screen.findByRole('dialog', { name: /supervisor receipt decision/i });
  await userEvent.click(await within(dialog).findByLabelText('Use receipt evidence 1'));
  await userEvent.type(within(dialog).getByLabelText('Decision reason'), 'Accept partial; four remain due');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Accept partial receipt' }));
  await waitFor(() => expect(api.rpc).toHaveBeenCalledWith('resolve_procurement_po_exception', { payload: expect.objectContaining({ decision_id: 'decision-first', decision: 'accept', evidence_urls: ['evidence/already-uploaded.jpg'], identifications: [] }) }));
  expect(decided).toBe(true);
});

it('blocks the saved next delivery before submission with owner and exact handoff, then resumes after resolution', async () => {
  localStorage.setItem(PROCUREMENT_PO_KEY, JSON.stringify([partial]));
  const repo = makeRepo();
  const data = await repo.getData();
  data.receipts.push({ id: 'receipt-first', procurementPoId: partial.id, locationId: 'loc-wh', lines: [], actor: 'receiver', createdAt: '2026-10-20' });
  vi.spyOn(repo, 'getData').mockResolvedValue(data);
  const list = vi.spyOn(repo, 'listExceptions').mockResolvedValue({ rows: [{ id: 'ex-1', type: 'po_receipt', sourceType: 'receipt', sourceId: 'receipt-first', status: 'in_progress', severity: 'P2', ownerId: 'lead-1', createdAt: '2026-10-20' }] });
  const receive = vi.spyOn(repo, 'receiveProcurementPO');
  renderWithProviders(<PurchaseOrdersPage />, { repo, role: 'warehouse_operator', route: '/purchase-orders?po=po-partial' });
  const dialog = await screen.findByRole('dialog', { name: /receive approved procurement po/i });
  await within(dialog).findByText(/pending controlled receipt decision/i);
  expect(within(dialog).getByText(/owner: lead-1/i)).toBeVisible();
  expect(within(dialog).getByRole('link', { name: /decision handoff/i })).toHaveAttribute('href', '/purchase-orders?receipt=receipt-first');
  fireEvent.change(within(dialog).getByLabelText('Actual delivery date'), { target: { value: '2026-10-19' } });
  fireEvent.change(within(dialog).getByLabelText(/delivery evidence url/i), { target: { value: 'https://example.com/delivery.jpg' } });
  expect(within(dialog).getByRole('button', { name: 'Confirm governed receipt' })).toBeDisabled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }));
  expect(receive).not.toHaveBeenCalled();
  list.mockResolvedValue({ rows: [] });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Refresh decision status' }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Confirm governed receipt' })).toBeEnabled());
  expect(within(dialog).getByLabelText('clean quantity for Shirts')).toHaveValue(4);
  expect(receive).not.toHaveBeenCalled();
});

it('retains closed POs in history on reload and direct link without receiving controls', async () => {
  localStorage.setItem(PROCUREMENT_PO_KEY, JSON.stringify([closed]));
  renderWithProviders(<PurchaseOrdersPage />, { role: 'warehouse_operator', route: '/purchase-orders?po=po-partial' });
  const dialog = await screen.findByRole('dialog', { name: /closed procurement po/i });
  expect(within(dialog).getByText('PO-ORIGINAL-7')).toBeVisible();
  expect(within(dialog).getByText(/received 7 \/ 7/i)).toBeVisible();
  expect(within(dialog).queryByRole('button', { name: /receive|confirm/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: /receive approved/i })).not.toBeInTheDocument();
});

it('loads paginated authorized closed history even when the inbound queue is empty, with search and receipt links', async () => {
  api.live = true;
  api.rpc.mockImplementation(async (name, args) => name === 'closed_procurement_po_history' ? { error: null, data: {
    rows: [{ ...closed, receipts: [{ id: 'receipt-last', createdAt: '2026-10-20', qualityStatus: 'accepted', evidenceUrls: [] }] }],
    nextCursor: args.payload.cursor ? null : 'po-partial',
  } } : { error: null, data: [] });
  const repo = makeRepo();
  vi.spyOn(repo, 'getReceivableProcurementPOs').mockResolvedValue([]);
  renderWithProviders(<PurchaseOrdersPage />, { repo, source: 'supabase', role: 'logistics_supervisor', capabilities: ['receive_stock', 'inspect_quality'] });
  await userEvent.click(await screen.findByRole('tab', { name: 'Closed' }));
  expect(await screen.findByRole('link', { name: 'PO-ORIGINAL-7' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Next closed page' }));
  await waitFor(() => expect(api.rpc).toHaveBeenCalledWith('closed_procurement_po_history', { payload: expect.objectContaining({ cursor: 'po-partial' }) }));
  fireEvent.change(screen.getByLabelText('Search closed POs'), { target: { value: 'ORIGINAL' } });
  await waitFor(() => expect(api.rpc).toHaveBeenCalledWith('closed_procurement_po_history', { payload: expect.objectContaining({ search: 'ORIGINAL', cursor: null }) }));
  await userEvent.click(screen.getByRole('button', { name: 'View closed history' }));
  const dialog = await screen.findByRole('dialog', { name: /closed procurement po/i });
  expect(within(dialog).getByRole('link', { name: /quality history/i })).toHaveAttribute('href', '/quality?source=receipt-last');
  expect(within(dialog).queryByRole('button', { name: /receive/i })).not.toBeInTheDocument();
});

it('does not show decision controls to a receiver following the exact receipt link', async () => {
  renderWithProviders(<PurchaseOrdersPage />, { role: 'warehouse_operator', route: '/purchase-orders?receipt=receipt-first' });
  expect(await screen.findByText(/authorized Lead.*separate from the receiver/i)).toBeVisible();
  expect(screen.queryByRole('button', { name: /review controlled receipt/i })).not.toBeInTheDocument();
});
