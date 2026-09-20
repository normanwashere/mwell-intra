import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildSeed, type FulfillmentOrder } from '@intra/data-kit';
import { orderWorkflowSummary } from '@/domain/workflowSummary';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { FulfillmentPage } from './FulfillmentPage';
import { hasReturnableOrderCustody } from './fulfillmentReturnEligibility';

function fixture(status: FulfillmentOrder['status'] = 'received') {
  const data = structuredClone(buildSeed());
  data.fulfillmentOrders = [{
    id: 'audit-order', externalReference: 'AUDIT-ORDER', source: 'ecommerce', status,
    lines: [{ productId: 'shirt-l', quantity: 2, pickedQuantity: 2, pickedSerialNumbers: [] }],
    packaging: [], shipmentEvents: [], deliveryMethod: 'shipment', shipmentStatus: 'dispatched',
    createdBy: 'requester', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z',
  }];
  data.returns = [];
  data.customerReturnCases = [];
  return data;
}

describe('Sep20 fulfillment presentation and handoffs', () => {
  it.each([undefined, null])('tolerates legacy serial arrays %s without inventing returned custody', async (serials) => {
    const data = fixture();
    const order = data.fulfillmentOrders[0]!;
    const line = order.lines[0]!;
    line.productId = data.products.find(product => product.serialized)!.id;
    Object.assign(line, { pickedSerialNumbers: serials });
    const before = structuredClone(order);
    expect(orderWorkflowSummary(order).status).toBe('Awaiting allocation');
    expect(order).toEqual(before);
    expect(hasReturnableOrderCustody({ ...order, status: 'released' }, data)).toBe(false);
    expect(order).toEqual(before);
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), role: 'warehouse_operator', route: '/fulfillment?tab=orders' });
    const row = await screen.findByRole('listitem', { name: 'Order AUDIT-ORDER' });
    expect(row).toHaveTextContent('Awaiting allocation');
    await userEvent.click(within(row).getByRole('button', { name: 'View order details' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('link', { name: 'Receive physical return' })).not.toBeInTheDocument();
  });
  it.each(['received', 'allocated', 'picking', 'packing', 'ready', 'released', 'completed', 'cancelled'] as const)(
    'uses workflow labels in the queue and detail for %s', async (status) => {
      const data = fixture(status);
      renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), route: '/fulfillment?tab=orders&status=all' });
      const row = await screen.findByRole('listitem', { name: 'Order AUDIT-ORDER' });
      const label = orderWorkflowSummary(data.fulfillmentOrders[0]!).status;
      expect(within(row).getByText(label, { exact: true })).toBeInTheDocument();
      await userEvent.click(within(row).getByRole('button', { name: 'View order details' }));
      const dialog = await screen.findByRole('dialog', { name: 'Order details / AUDIT-ORDER' });
      expect(within(dialog).getByRole('region', { name: 'Operational summary' })).toHaveTextContent(label);
      for (const term of within(dialog).getAllByText('Current status', { selector: 'dt' })) expect(term.parentElement).toHaveTextContent(label);
      expect(within(dialog).queryByText('Received', { exact: true })).not.toBeInTheDocument();
    },
  );

  it.each(['received', 'allocated', 'picking', 'packing', 'ready', 'cancelled'] as const)(
    'does not offer physical intake for unreleased %s orders', async (status) => {
      renderWithProviders(<FulfillmentPage />, { repo: makeRepo(fixture(status)), role: 'warehouse_operator', route: '/fulfillment?tab=orders&order=audit-order' });
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByRole('link', { name: 'Receive physical return' })).not.toBeInTheDocument();
    },
  );

  it.each(['released', 'completed'] as const)('retains intake for eligible %s custody', async (status) => {
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(fixture(status)), role: 'warehouse_operator', route: '/fulfillment?tab=orders&order=audit-order' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Receive physical return' })).toHaveAttribute('href', '/returns?sourceOrderId=audit-order');
  });

  it.each(['not-picked', 'already-returned', 'serial-not-issued'] as const)('hides intake when released custody is %s', async (reason) => {
    const data = fixture('released');
    const line = data.fulfillmentOrders[0]!.lines[0]!;
    if (reason === 'not-picked') line.pickedQuantity = 0;
    if (reason === 'already-returned') data.returns = [{ id: 'physical-return', source: 'customer', sourceOrderId: 'audit-order', lines: [{ productId: line.productId, quantity: 2, reason: 'unused', disposition: 'quarantine' }], actor: 'operator', createdAt: '2026-09-20T00:00:00Z' }];
    if (reason === 'serial-not-issued') {
      line.productId = data.units[0]!.productId;
      line.pickedSerialNumbers = [data.units[0]!.serialNumber];
      data.units[0]!.status = 'in_stock';
    }
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), role: 'warehouse_operator', route: '/fulfillment?tab=orders&order=audit-order' });
    expect(within(await screen.findByRole('dialog')).queryByRole('link', { name: 'Receive physical return' })).not.toBeInTheDocument();
  });

  it.each(['orders', 'returns'] as const)('shows Finance authorized physical-return context without a denied route in %s', async (tab) => {
    const data = fixture('released');
    data.customerReturnCases = [{ id: 'case-audit', sourceOrderId: 'audit-order', productId: 'shirt-l', defectDescription: 'Damaged', requestingDepartment: 'customer_service', status: 'submitted', resolution: 'pending', createdBy: 'requester', createdAt: '2026-09-20T00:00:00Z' }];
    data.returns = [{ id: 'physical-return', source: 'customer', sourceOrderId: 'audit-order', returnCaseId: 'case-audit', lines: [], actor: 'operator', createdAt: '2026-09-20T00:00:00Z' }];
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), role: 'finance', route: `/fulfillment?tab=${tab}${tab === 'orders' ? '&order=audit-order' : ''}` });
    const context = tab === 'orders' ? await screen.findByRole('dialog') : await screen.findByRole('list', { name: 'Customer return cases' });
    expect(within(context).getByText('physical-return')).toBeInTheDocument();
    expect(within(context).queryByRole('link', { name: 'physical-return' })).not.toBeInTheDocument();
    expect(context).toHaveTextContent('Warehouse returns team');
    if (tab === 'returns') expect(within(context).getByRole('button', { name: 'Record refund' })).toBeEnabled();
  });

  it('keeps long references disclosed and copyable, filters collapsible, and six order summaries single-column', async () => {
    const data = fixture();
    const reference = 'PERF-LONG-ORDER-REFERENCE-' + 'CONTEXT-'.repeat(12) + '0099';
    data.fulfillmentOrders = Array.from({ length: 6 }, (_, index) => ({ ...data.fulfillmentOrders[0]!, id: `order-${index}`, externalReference: index ? `ORDER-${index}` : reference }));
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), role: 'warehouse_operator', route: '/fulfillment?tab=orders' });
    const list = await screen.findByRole('list', { name: 'Fulfillment demand' });
    expect(list).toHaveAttribute('data-density', 'compact');
    expect(list).not.toHaveClass('lg:grid-cols-2');
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    const row = within(list).getByRole('listitem', { name: `Order ${reference}` });
    expect(within(row).getByRole('button', { name: 'Allocate stock' })).toHaveClass('min-h-11');
    const more = within(row).getByLabelText('More order actions', { selector: 'summary' });
    expect(more.parentElement).not.toHaveAttribute('open');
    await user.click(more);
    expect(within(more.parentElement!).getByRole('button', { name: 'Split backorder' })).toBeEnabled();
    expect(within(more.parentElement!).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    const disclosure = within(row).getByLabelText('Full order reference', { selector: 'summary' });
    expect(disclosure.parentElement).not.toHaveAttribute('open');
    await user.click(disclosure);
    expect(disclosure.parentElement).toHaveAttribute('open');
    expect(within(disclosure.parentElement!).getByText(reference, { exact: true })).toBeInTheDocument();
    expect(within(disclosure.parentElement!).getByRole('button', { name: 'Copy reference' })).toBeEnabled();
    await user.click(within(disclosure.parentElement!).getByRole('button', { name: 'Copy reference' }));
    expect(await navigator.clipboard.readText()).toBe(reference);
    const filters = screen.getByRole('button', { name: 'Filters' });
    expect(filters).toHaveAttribute('aria-expanded', 'false');
    await user.click(filters);
    expect(filters).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Channel')).toBeInTheDocument();
  });

  it.each([false, true])('hides only known load-only orders when explicit UAT mode=%s and retains direct links', async (uat) => {
    const data = fixture();
    const order = data.fulfillmentOrders[0]!;
    data.fulfillmentOrders.push({ ...order, id: 'load-order', externalReference: 'PERF-SEP12-ORDER-0001',
      orderNotes: 'PERF-SEP12 synthetic volume fixture. No payment or stock allocated. Do not dispatch.',
      lines: [{ productId: 'perf-sep12-product-1', quantity: 1, pickedQuantity: 0, pickedSerialNumbers: [] }],
    }, { ...order, id: 'tester-order', externalReference: 'PERF-SEP12-ORDER-0002', orderNotes: 'Tester scenario: pick and pack.' },
    { ...order, id: 'history-order', externalReference: 'HISTORY-ORDER', fixture: { purpose: 'historical-evidence' } } as FulfillmentOrder);
    const repo = makeRepo(data);
    const before = await repo.getData();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', route: `/fulfillment?tab=orders${uat ? '&uat=1' : ''}` });
    const list = await screen.findByRole('list', { name: 'Fulfillment demand' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(uat ? 3 : 4);
    expect(within(list).getByRole('listitem', { name: 'Order PERF-SEP12-ORDER-0002' })).toBeInTheDocument();
    expect(within(list).getByRole('listitem', { name: 'Order HISTORY-ORDER' })).toBeInTheDocument();
    if (uat) {
      expect(screen.getByText('1 load-only fixture hidden')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Show all records (4)' }));
      expect(within(list).getAllByRole('listitem')).toHaveLength(4);
      await user.click(within(within(list).getByRole('listitem', { name: 'Order PERF-SEP12-ORDER-0001' })).getByRole('button', { name: 'View order details' }));
      expect(await screen.findByRole('dialog', { name: 'Order details / PERF-SEP12-ORDER-0001' })).toBeInTheDocument();
    } else expect(screen.queryByRole('button', { name: /Show all records/ })).not.toBeInTheDocument();
    expect(await repo.getData()).toEqual(before);
  });

  it('opens a directly linked load fixture even when excluded from the UAT queue', async () => {
    const data = fixture();
    Object.assign(data.fulfillmentOrders[0]!, { externalReference: 'PERF-SEP12-ORDER-0001', orderNotes: 'PERF-SEP12 synthetic volume fixture. No payment or stock allocated. Do not dispatch.', lines: [{ productId: 'perf-sep12-product-1', quantity: 1, pickedQuantity: 0, pickedSerialNumbers: [] }] });
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), role: 'warehouse_operator', route: '/fulfillment?tab=orders&uat=1&order=audit-order' });
    expect(await screen.findByRole('dialog', { name: 'Order details / PERF-SEP12-ORDER-0001' })).toBeInTheDocument();
  });
});
