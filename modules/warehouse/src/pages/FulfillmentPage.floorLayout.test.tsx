import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildSeed, type FulfillmentOrder } from '@intra/data-kit';
import { FulfillmentPage } from './FulfillmentPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

const reference = 'REQ-9ae80161-8a4c-4c38-aa94-4f597275c571';
const receiptTitle = `Acknowledge receipt / ${reference}`;

function fixture(status: FulfillmentOrder['status'] = 'released') {
  const data = buildSeed();
  data.fulfillmentOrders = [{
    id: 'floor-order', externalReference: reference, source: 'department_request', status,
    deliveryMethod: 'internal_handover', createdBy: 'marketing@mwell',
    createdAt: '2026-09-13', updatedAt: '2026-09-13', sourceLocationId: 'loc-wh',
    lines: [{ productId: 'doctor-token', quantity: 1, pickedQuantity: 0, pickedSerialNumbers: [] }],
    packaging: [], shipmentEvents: [], packedBy: 'packer', releasedBy: 'releaser',
    handoverRecipientName: 'Marketing recipient', handoverRecipientDepartment: 'Marketing',
  }];
  data.stockLevels = [{ productId: 'doctor-token', locationId: 'loc-wh', quantity: 10 }];
  data.departmentStockRequests = [{
    id: 'floor-request', purpose: 'Campaign stock', requestingDepartment: 'marketing', costCenter: 'CC-1',
    requiredDate: '2026-09-13', expenseTreatment: 'expense', status: 'issued',
    requestedBy: 'marketing@mwell', requestedAt: '2026-09-13', fulfillmentOrderId: 'floor-order',
    lines: [{ productId: 'doctor-token', quantity: 1 }],
  }];
  return makeRepo(data);
}

function Harness() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate(-1)}>History back</button>
    <output data-testid="route">{location.pathname}{location.search}</output>
    <FulfillmentPage />
  </>;
}

describe('focused floor feedback and receipt work surface', () => {
  it.each([
    { deliveryMethod: 'shipment', filter: 'active' },
    { deliveryMethod: 'shipment', filter: 'packing' },
    { deliveryMethod: 'internal_handover', filter: 'active' },
    { deliveryMethod: 'internal_handover', filter: 'packing' },
  ] as const)('keeps $deliveryMethod packing success inline in the $filter queue', async ({ deliveryMethod, filter }) => {
    const data = await fixture('packing').getData();
    Object.assign(data.fulfillmentOrders[0]!, { deliveryMethod, source: deliveryMethod === 'shipment' ? 'ecommerce' : 'department_request' });
    const repo = makeRepo(data);
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', route: `/fulfillment?tab=orders&status=${filter}` });
    await user.click(await screen.findByRole('button', { name: deliveryMethod === 'shipment' ? 'Pack and add waybill' : 'Prepare accountable handover' }));
    const dialog = await screen.findByRole('dialog', { name: `Pack order / ${reference}` });
    if (deliveryMethod === 'shipment') {
      await user.type(within(dialog).getByLabelText('Courier'), 'Synthetic courier');
      await user.type(within(dialog).getByLabelText('Waybill number'), 'WAYBILL-TEST');
      await user.type(within(dialog).getByLabelText('Delivery tracking link'), 'https://example.invalid/tracking');
    } else {
      await user.type(within(dialog).getByLabelText('Recipient name'), 'Recipient');
    }
    await user.click(within(dialog).getByRole('button', { name: 'Confirm packing' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const message = deliveryMethod === 'shipment' ? 'Packing confirmed.' : 'Handover prepared.';
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(message);
    expect(within(screen.getByRole('region', { name: 'Notifications' })).queryByRole('status')).not.toBeInTheDocument();
    if (filter === 'packing') {
      expect(notice).toHaveTextContent(reference);
      expect(screen.queryByRole('listitem', { name: `Order ${reference}` })).not.toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText('Status'), 'active');
    }
    const row = screen.getByRole('listitem', { name: `Order ${reference}` });
    expect(within(row).getByRole('status')).toHaveTextContent(message);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(within(row).getByText('Awaiting release by a second warehouse operator.')).toBeVisible();
    expect(within(row).queryByRole('button', { name: /^Release / })).not.toBeInTheDocument();
    expect((await repo.getData()).fulfillmentOrders[0]?.status).toBe('ready');
  });

  it('keeps the full pick reference copyable and quality guidance expandable without taking scanner focus', async () => {
    const data = await fixture('picking').getData();
    data.storageAreas = [{ id: 'floor-bin', locationId: 'loc-wh', code: 'FLOOR-01', active: true }];
    data.stockLevels[0]!.binId = 'floor-bin';
    const repo = makeRepo(data);
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', route: '/fulfillment?tab=orders&status=picking' });
    await user.click(await screen.findByRole('button', { name: 'Confirm scanned pick' }));
    const dialog = await screen.findByRole('dialog', { name: `Confirm pick / ${reference}` });
    expect(within(dialog).getByRole('button', { name: 'Scan rack or bin' })).toHaveFocus();
    const quality = within(dialog).getByText('Quality checkpoint', { selector: 'summary' });
    expect(quality.closest('details')).not.toHaveAttribute('open');
    await user.click(quality);
    expect(within(dialog).getByText(/Only accepted, put-away stock is pickable/)).toBeVisible();
    await user.click(quality);
    await user.click(within(dialog).getByText('Order reference', { selector: 'summary' }));
    await user.click(within(dialog).getByRole('button', { name: 'Copy reference' }));
    expect(clipboard).toHaveBeenCalledWith(reference);
    await user.click(within(dialog).getByText('Order reference', { selector: 'summary' }));
    await user.type(within(dialog).getByLabelText('Scanned bin code for Doctor Token'), 'FLOOR-01');
    await user.click(within(dialog).getByRole('button', { name: 'Use bin' }));
    await user.type(within(dialog).getByLabelText('Product barcode for Doctor Token'), data.products.find(product => product.id === 'doctor-token')!.sku);
    await user.click(within(dialog).getByRole('button', { name: 'Use product' }));
    await user.type(within(dialog).getByLabelText('Picked quantity for Doctor Token'), '1');
    const before = await repo.getData();
    await user.type(within(dialog).getByLabelText('Scanned bin code for Doctor Token'), 'WRONG');
    await user.click(within(dialog).getByRole('button', { name: 'Use bin' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Wrong source bin');
    expect(within(dialog).getByLabelText('Picked quantity for Doctor Token')).toHaveValue(1);
    expect(await repo.getData()).toEqual(before);
  });

  it.each([
    { status: 'received', action: 'Allocate stock', nextStatus: 'allocated', message: 'Allocation recorded.' },
    { status: 'allocated', action: 'Start picking', nextStatus: 'picking', message: 'Picking started.' },
  ] as const)('retains one queue confirmation when $action leaves the $status filter', async ({ status, action, nextStatus, message }) => {
    const repo = fixture(status);
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', route: `/fulfillment?tab=orders&status=${status}` });
    await user.click(await screen.findByRole('button', { name: action }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: `Order ${reference}` })).not.toBeInTheDocument());
    expect((await repo.getData()).fulfillmentOrders[0]?.status).toBe(nextStatus);
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(`${reference}: ${message}`);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(notice.closest('[role="listitem"], li')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Notifications' })).queryByRole('status')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'active');
    const card = await screen.findByRole('listitem', { name: `Order ${reference}` });
    expect(within(card).getByRole('status')).toHaveTextContent(message);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(notice).not.toBeInTheDocument();
    if (nextStatus === 'allocated') {
      await user.click(within(card).getByRole('button', { name: 'Start picking' }));
      expect(await within(card).findByRole('status')).toHaveTextContent('Picking started.');
      expect(screen.queryByText('Allocation recorded.')).not.toBeInTheDocument();
    }
    await user.click(await screen.findByRole('button', { name: 'Confirm scanned pick' }));
    expect(screen.queryByRole('status', { hidden: true })).not.toBeInTheDocument();
  });

  it('clears the queue fallback on the next action even when another filtered row remains and fails', async () => {
    const data = await fixture('received').getData();
    data.fulfillmentOrders.push({ ...data.fulfillmentOrders[0]!, id: 'second-order', externalReference: 'REQ-SECOND' });
    const repo = makeRepo(data);
    const advance = vi.spyOn(repo, 'advanceFulfillmentOrder');
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', route: '/fulfillment?tab=orders&status=received' });
    const first = await screen.findByRole('listitem', { name: `Order ${reference}` });
    await user.click(within(first).getByRole('button', { name: 'Allocate stock' }));
    expect(await screen.findByRole('status')).toHaveTextContent(`${reference}: Allocation recorded.`);
    const second = screen.getByRole('listitem', { name: 'Order REQ-SECOND' });
    expect(within(second).queryByRole('status')).not.toBeInTheDocument();
    advance.mockRejectedValueOnce(new Error('Allocation denied'));
    await user.click(within(second).getByRole('button', { name: 'Allocate stock' }));
    expect(await screen.findByText('Allocation denied')).toBeVisible();
    expect(screen.queryByText(`${reference}: Allocation recorded.`)).not.toBeInTheDocument();
    expect((await repo.getData()).fulfillmentOrders.find(order => order.id === 'second-order')?.status).toBe('received');
  });

  it('replaces rapid floor success notices inline without covering the pick sheet', async () => {
    const repo = fixture('received');
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', route: '/fulfillment?tab=orders' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Allocate stock' }));
    const card = screen.getByRole('listitem', { name: `Order ${reference}` });
    expect(await within(card).findByRole('status')).toHaveTextContent('Allocation recorded.');
    await user.click(await screen.findByRole('button', { name: 'Start picking' }));
    expect(await within(card).findByRole('status')).toHaveTextContent('Picking started.');
    expect(within(card).getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByText('Allocation recorded.')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Notifications' })).queryByRole('status')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Confirm scanned pick' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Product barcode for Doctor Token')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Notifications', hidden: true })).queryByRole('status', { hidden: true })).not.toBeInTheDocument();
    expect((await repo.getData()).fulfillmentOrders[0]?.status).toBe('picking');
  });

  it('clears an obsolete floor confirmation on a failed next step without suppressing the error', async () => {
    const repo = fixture('received');
    const advance = vi.spyOn(repo, 'advanceFulfillmentOrder');
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', route: '/fulfillment?tab=orders' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Allocate stock' }));
    await screen.findByText('Allocation recorded.');
    advance.mockRejectedValueOnce(new Error('Picking denied'));
    await user.click(await screen.findByRole('button', { name: 'Start picking' }));
    expect(await screen.findByText('Picking denied')).toBeVisible();
    expect(screen.queryByText('Allocation recorded.')).not.toBeInTheDocument();
    expect(screen.queryByText('Picking started.')).not.toBeInTheDocument();
    expect((await repo.getData()).fulfillmentOrders[0]?.status).toBe('allocated');
  });

  it('shows one receipt dialog, preserves full accessible reference and copies it outside the heading', async () => {
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderWithProviders(<Harness />, { repo: fixture(), role: 'marketing', route: '/fulfillment?tab=requests&request=floor-request&requestStatus=issued' });
    const review = await screen.findByRole('dialog', { name: 'Review request' });
    await user.click(within(review).getByRole('button', { name: 'Acknowledge receipt' }));
    const dialog = await screen.findByRole('dialog', { name: receiptTitle });
    expect(within(dialog).getByLabelText('Acknowledgment reference')).toHaveFocus();
    // Include hidden dialogs: an aria-hidden background sheet still visually stacks.
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1);
    const heading = within(dialog).getByRole('heading', { name: receiptTitle });
    expect(heading).toHaveTextContent(reference);
    await user.click(within(dialog).getByText('Order reference', { selector: 'summary' }));
    expect(within(dialog).getByText(reference, { exact: true })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Copy reference' }));
    expect(clipboard).toHaveBeenCalledWith(reference);
    expect(screen.getByTestId('route')).toHaveTextContent('request=floor-request&requestStatus=issued');
  });

  it('cancel restores request context and focus; reopening starts a fresh receipt draft', async () => {
    const repo = fixture();
    const advance = vi.spyOn(repo, 'advanceFulfillmentOrder');
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { repo, role: 'marketing', route: '/fulfillment?tab=requests&requestStatus=issued' });
    const viewRequest = await screen.findByRole('button', { name: 'View request' });
    await user.click(viewRequest);
    const review = await screen.findByRole('dialog', { name: 'Review request' });
    await user.click(within(review).getByRole('button', { name: 'Acknowledge receipt' }));
    await user.type(await screen.findByLabelText('Acknowledgment reference'), 'UNSAVED');
    await user.keyboard('{Escape}');
    const restored = await screen.findByRole('dialog', { name: 'Review request' });
    await waitFor(() => expect(within(restored).getByRole('button', { name: 'Acknowledge receipt' })).toHaveFocus());
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1);
    await user.click(within(restored).getByRole('button', { name: 'Acknowledge receipt' }));
    expect(await screen.findByLabelText('Acknowledgment reference')).toHaveValue('');
    await user.click(within(screen.getByRole('dialog', { name: receiptTitle })).getByRole('button', { name: 'Close' }));
    await screen.findByRole('dialog', { name: 'Review request' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(viewRequest).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('route')).toHaveTextContent('/fulfillment?tab=requests&requestStatus=issued');
    expect(advance).not.toHaveBeenCalled();
  });

  it('browser Back from acknowledgment closes the detached request surface without a write', async () => {
    const repo = fixture();
    const advance = vi.spyOn(repo, 'advanceFulfillmentOrder');
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { repo, role: 'marketing', route: '/fulfillment?tab=requests' });
    await user.click(await screen.findByRole('button', { name: 'View request' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Review request' })).getByRole('button', { name: 'Acknowledge receipt' }));
    await screen.findByRole('dialog', { name: receiptTitle });
    fireEvent.click(screen.getByText('History back', { selector: 'button' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('route')).not.toHaveTextContent('request=');
    expect(advance).not.toHaveBeenCalled();
  });

  it('queue acknowledgment cancel restores the queue trigger without opening a request dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { repo: fixture(), role: 'marketing', route: '/fulfillment?tab=requests' });
    const trigger = await screen.findByRole('button', { name: 'Acknowledge receipt' });
    await user.click(trigger);
    await screen.findByRole('dialog', { name: receiptTitle });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps receipt evidence and command on an uncertain response, then returns to the completed request', async () => {
    const repo = fixture();
    const advance = vi.spyOn(repo, 'advanceFulfillmentOrder');
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { repo, role: 'marketing', route: '/fulfillment?tab=requests&request=floor-request' });
    await user.click(within(await screen.findByRole('dialog', { name: 'Review request' })).getByRole('button', { name: 'Acknowledge receipt' }));
    const dialog = await screen.findByRole('dialog', { name: receiptTitle });
    await user.type(within(dialog).getByLabelText('Acknowledgment reference'), 'ACK-DRAFT');
    await user.upload(dialog.querySelector<HTMLInputElement>('input[type=file]')!, new File(['proof'], 'proof.png', { type: 'image/png' }));
    const submit = await within(dialog).findByRole('button', { name: 'Confirm receipt' });
    await waitFor(() => expect(submit).toBeEnabled());
    let reject!: (error: Error) => void;
    advance.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await user.click(submit);
    await waitFor(() => expect(advance).toHaveBeenCalledOnce());
    await user.keyboard('{Escape}');
    expect(dialog).toBeInTheDocument();
    await act(async () => reject(new Error('Receipt response lost')));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Your evidence is retained');
    expect(within(dialog).getByLabelText('Acknowledgment reference')).toHaveValue('ACK-DRAFT');
    expect(within(dialog).getByLabelText('Acknowledgment reference')).toBeDisabled();
    const original = structuredClone(advance.mock.calls[0]![0]);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm receipt' }));
    const review = await screen.findByRole('dialog', { name: 'Review request' });
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1);
    expect(review).toHaveTextContent('Receipt acknowledged');
    expect(advance).toHaveBeenCalledTimes(2);
    expect(advance.mock.calls[1]![0]).toEqual(original);
    expect((await repo.getData()).fulfillmentOrders[0]?.acknowledgementReference).toBe('ACK-DRAFT');
    await waitFor(() => expect(review.contains(document.activeElement)).toBe(true));
  });
});
