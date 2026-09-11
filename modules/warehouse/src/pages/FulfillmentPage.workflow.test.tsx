import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { buildSeed, type FulfillmentOrder, type CustomerReturnCase } from '@intra/data-kit';
import { FulfillmentPage } from './FulfillmentPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import type { Capability } from '@/auth/roles';

function RouteProbe() {
  const location = useLocation();
  return <output aria-label="Current request route">{location.pathname}{location.search}</output>;
}

function fixture(status: FulfillmentOrder['status'] = 'received') {
  const data = buildSeed();
  data.fulfillmentOrders = [{
    id: 'summary-order', externalReference: 'SUMMARY-ORDER', source: 'department_request', status,
    deliveryMethod: 'internal_handover', createdBy: 'requester', createdAt: '2026-09-11', updatedAt: '2026-09-11',
    lines: [{ productId: 'smart-watch', quantity: 1, pickedQuantity: 1, pickedSerialNumbers: [] }],
    packaging: [], shipmentEvents: [], packedBy: 'another-packer', releasedBy: 'another-releaser',
    handoverRecipientName: 'Recipient', handoverRecipientDepartment: 'Marketing', handoverReference: 'REF', handoverEvidenceUrl: 'https://example.com/evidence',
  }];
  data.departmentStockRequests = [{
    id: 'summary-request', purpose: 'Campaign', requestingDepartment: 'marketing', costCenter: 'CC-1',
    requiredDate: '2026-09-12', expenseTreatment: 'expense', status: 'approved', requestedBy: 'requester', requestedAt: '2026-09-11',
    fulfillmentOrderId: 'summary-order', lines: [{ productId: 'smart-watch', quantity: 1 }],
  }];
  data.customerReturnCases = [{
    id: 'summary-return', productId: 'smart-watch', sourceOrderId: 'summary-order', defectDescription: 'Defect', requestingDepartment: 'customer_service',
    status: 'submitted', resolution: 'pending', createdBy: 'customer-service', createdAt: '2026-09-11',
  }];
  return data;
}

describe('workflow summaries preserve the existing detail and action surface', () => {
  it.each(['marketing', 'logistics_supervisor'] as const)('shows rejected recovery to %s without reopening or submitting', async role => {
    const data = fixture();
    data.departmentStockRequests[0]!.status = 'rejected';
    data.departmentStockRequests[0]!.fulfillmentOrderId = undefined;
    const repo = makeRepo(data);
    const before = await repo.getData();
    const create = vi.spyOn(repo, 'createDepartmentStockRequest');
    const decide = vi.spyOn(repo, 'decideDepartmentStockRequest');
    renderWithProviders(<><FulfillmentPage /><RouteProbe /></>, { repo, role, route: '/fulfillment?tab=requests&request=summary-request&requestStatus=rejected' });
    const dialog = await screen.findByRole('dialog', { name: 'Review request' });
    const summary = within(dialog).getByRole('region', { name: 'Workflow status' });
    expect(summary).toHaveTextContent('Requester');
    expect(summary).toHaveTextContent('Ask the approver for the rejection reason; prepare a new corrected request if still needed. The original request stays rejected.');
    expect(within(dialog).queryByRole('button', { name: /reopen|resubmit|approve|new stock request/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /rejection reason/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await userEvent.setup().keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current request route')).toHaveTextContent('/fulfillment?tab=requests&requestStatus=rejected');
    expect(create).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(await repo.getData()).toEqual(before);
  });
  it.each([
    ['received', 'Allocate stock', 'Awaiting allocation'],
    ['allocated', 'Start picking', 'Awaiting picking'],
    ['picking', 'Confirm scanned pick', 'Picking'],
    ['packing', 'Prepare accountable handover', 'Awaiting packing'],
    ['ready', 'Release handover', 'Awaiting release'],
  ] as const)('keeps the %s action in the queue, without duplicating it in details', async (status, action, label) => {
    const repo = makeRepo(fixture(status));
    const mutate = vi.spyOn(repo, 'advanceFulfillmentOrder');
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', route: '/fulfillment?tab=orders' });
    expect(await screen.findByRole('button', { name: action })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'View order details' }));
    const dialog = await screen.findByRole('dialog');
    const summary = within(dialog).getByRole('region', { name: 'Workflow status' });
    expect(summary).toHaveTextContent(label);
    expect(summary).toHaveTextContent('Next responsibility');
    expect(within(dialog).queryByRole('button', { name: action })).not.toBeInTheDocument();
    const link = within(summary).getByRole('link', { name: 'Review order lines' });
    expect(link).toHaveAttribute('href', '#order-lines-title');
    expect(dialog.querySelector('#order-lines-title')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: action })).toBeEnabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([{ capabilities: [] }, { capabilities: ['issue_items'] }] as { capabilities: Capability[] }[])('does not grant or remove controls for effective capabilities $capabilities', async ({ capabilities }) => {
    const repo = makeRepo(fixture());
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', source: 'supabase', capabilities, route: '/fulfillment?tab=orders' });
    await screen.findByRole('button', { name: 'View order details' });
    expect(!!screen.queryByRole('button', { name: 'Allocate stock' })).toBe(capabilities.includes('issue_items'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'View order details' }));
    expect(within(await screen.findByRole('dialog')).getByRole('region', { name: 'Workflow status' })).toHaveTextContent('Warehouse operator');
  });

  it('keeps linked-order navigation exact and does not treat issued as accepted', async () => {
    const data = fixture('released');
    data.departmentStockRequests[0]!.status = 'issued';
    const repo = makeRepo(data);
    const mutate = vi.spyOn(repo, 'advanceFulfillmentOrder');
    renderWithProviders(<FulfillmentPage />, { repo, role: 'marketing', route: '/fulfillment?tab=requests&request=summary-request&requestStatus=issued' });
    const dialog = await screen.findByRole('dialog', { name: 'Review request' });
    const summary = within(dialog).getByRole('region', { name: 'Workflow status' });
    expect(summary).toHaveTextContent('Issued / Awaiting receipt confirmation');
    const link = within(summary).getByRole('link', { name: 'Open fulfillment order' });
    const params = new URL(link.getAttribute('href')!, 'https://intra.example').searchParams;
    expect(params.get('tab')).toBe('orders');
    expect(params.get('order')).toBe('summary-order');
    expect(params.has('request')).toBe(false);
    expect(params.get('requestStatus')).toBe('issued');
    expect(within(summary).queryByRole('button')).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('shows an unavailable linked record without a link or fabricated completion', async () => {
    const data = fixture();
    data.departmentStockRequests[0]!.status = 'issued';
    data.fulfillmentOrders = [];
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), route: '/fulfillment?tab=requests&request=summary-request' });
    const summary = within(await screen.findByRole('dialog')).getByRole('region', { name: 'Workflow status' });
    expect(summary).toHaveTextContent('fulfillment unavailable');
    expect(summary).toHaveTextContent('cannot be confirmed');
    expect(within(summary).queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps shipment proof distinct from release and links to an existing timeline anchor', async () => {
    const data = fixture('released');
    Object.assign(data.fulfillmentOrders[0]!, { deliveryMethod: 'shipment', shipmentStatus: 'delivery_failed', deliveryFailureReason: 'No recipient' });
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), route: '/fulfillment?tab=orders&order=summary-order' });
    const dialog = await screen.findByRole('dialog');
    const summary = within(dialog).getByRole('region', { name: 'Workflow status' });
    expect(summary).toHaveTextContent('Delivery failed');
    expect(summary).toHaveTextContent('No recipient');
    expect(within(summary).getByRole('link', { name: 'Review shipment timeline' })).toHaveAttribute('href', '#shipment-timeline-title');
    expect(dialog.querySelector('#shipment-timeline-title')).not.toBeNull();
  });

  it.each([
    ['logistics_supervisor', 'submitted', 'Record resolution', 'Awaiting physical intake', 'Save resolution'],
    ['finance', 'submitted', 'Record refund', 'Awaiting physical intake', 'Save resolution'],
    ['operations', 'resolved', 'Close with customer', 'awaiting customer closure', 'Confirm customer closure'],
  ] as const)('adds only a read-only summary to the existing %s return panel', async (role, status, action, label, save) => {
    const data = fixture();
    data.customerReturnCases[0]!.status = status as CustomerReturnCase['status'];
    data.customerReturnCases[0]!.resolution = status === 'resolved' ? 'replacement' : 'pending';
    const repo = makeRepo(data);
    const resolve = vi.spyOn(repo, 'resolveCustomerReturnCase');
    const close = vi.spyOn(repo, 'closeCustomerReturnCase');
    renderWithProviders(<FulfillmentPage />, { repo, role, route: '/fulfillment?tab=returns' });
    await userEvent.setup().click(await screen.findByRole('button', { name: action }));
    const dialog = await screen.findByRole('dialog');
    const summary = within(dialog).getByRole('region', { name: 'Workflow status' });
    expect(summary).toHaveTextContent(label);
    expect(within(summary).queryByRole('button')).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: save })).toHaveLength(1);
    expect(resolve).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
