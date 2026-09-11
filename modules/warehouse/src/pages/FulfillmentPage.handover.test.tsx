import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildSeed, type FulfillmentOrder } from '@intra/data-kit';
import { FulfillmentPage, fulfillmentAdvanceSuccessMessage, returnResolutionSuccessMessage } from './FulfillmentPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

describe('fulfillment success handover wording', () => {
  it.each(['internal_handover', 'event_handover', 'third_party_transfer'] as const)('keeps %s release separate from receipt', deliveryMethod => {
    const message = fulfillmentAdvanceSuccessMessage({ externalReference: 'ORDER-1', deliveryMethod }, 'release');
    expect(message).toContain('ORDER-1 release recorded.');
    expect(message).toContain('recipient or another authorized staff member');
    expect(message).toContain('reference and proof');
    expect(message).toContain('releasing operator cannot confirm receipt');
    expect(message).not.toMatch(/Picking|delivered|completed/);
  });

  it('hands a shipment to delivery follow-up without claiming delivery', () => {
    const message = fulfillmentAdvanceSuccessMessage({ externalReference: 'SHIP-1', deliveryMethod: 'shipment' }, 'release');
    expect(message).toContain('SHIP-1 release recorded.');
    expect(message).toContain('Courier / Warehouse delivery team');
    expect(message).toContain('proof-of-delivery reference and evidence');
    expect(message).toContain('Release does not confirm delivery.');
    expect(message).not.toMatch(/Picking|delivered|completed/);
  });

  it('requests verification for an unknown release method', () => {
    const message = fulfillmentAdvanceSuccessMessage({ externalReference: 'OLD-1', deliveryMethod: 'unknown' as FulfillmentOrder['deliveryMethod'] }, 'release');
    expect(message).toContain('Warehouse supervisor');
    expect(message).toContain('verify the delivery method');
    expect(message).not.toContain('Courier');
  });

  it.each([
    ['allocate', 'allocation recorded', 'Warehouse operator starts picking'],
    ['start_picking', 'picking started', 'Warehouse operator confirms scanned quantities'],
  ] as const)('gives the next floor action after %s', (action, outcome, next) => {
    const message = fulfillmentAdvanceSuccessMessage({ externalReference: 'ORDER-1', deliveryMethod: 'shipment' }, action);
    expect(message).toContain(outcome);
    expect(message).toContain(next);
  });

  it.each([
    ['replacement', 'Warehouse reviews the linked replacement order'],
    ['re_kit', 'Warehouse creates a re-kit work order'],
    ['refund', 'Customer Service confirms the refund outcome'],
    ['vendor_return', 'Warehouse coordinates the supplier return'],
    ['write_off', 'Customer Service confirms the final disposition'],
  ] as const)('names the remaining work after %s resolution', (resolution, next) => {
    const message = returnResolutionSuccessMessage(resolution);
    expect(message).toContain('Return resolution recorded');
    expect(message).toContain(next);
    expect(message).toContain('closure evidence');
    expect(message).not.toMatch(/case closed|stock released|refund paid|replacement delivered/i);
  });
});

function readyOrder(deliveryMethod: FulfillmentOrder['deliveryMethod']): FulfillmentOrder {
  return {
    id: 'handover-order', externalReference: 'HANDOVER-1', source: 'department_request', status: 'ready',
    deliveryMethod, createdBy: 'requester', createdAt: '2026-09-11', updatedAt: '2026-09-11',
    lines: [{ productId: 'doctor-token', quantity: 1, pickedQuantity: 1, pickedSerialNumbers: [] }],
    packaging: [], shipmentEvents: [], packedBy: 'another-packer',
    courier: 'Test courier', waybillNumber: 'WAYBILL-1',
    handoverRecipientName: 'Recipient', handoverRecipientDepartment: 'Marketing', handoverReference: 'REF', handoverEvidenceUrl: 'https://example.test/handover.jpg',
  };
}

describe('existing success toasts', () => {
  it.each(['shipment', 'internal_handover'] as const)('shows the release handover only after a confirmed %s mutation', async deliveryMethod => {
    const data = buildSeed();
    data.fulfillmentOrders = [readyOrder(deliveryMethod)];
    const repo = makeRepo(data);
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', route: '/fulfillment?tab=orders' });
    await userEvent.setup().click(await screen.findByRole('button', { name: deliveryMethod === 'shipment' ? 'Release shipment' : 'Release handover' }));
    expect(await screen.findByText(/HANDOVER-1 release recorded\./)).toBeVisible();
    expect((await repo.getData()).fulfillmentOrders[0]?.status).toBe('released');
    expect(screen.queryByText(/HANDOVER-1 moved to Picking/)).not.toBeInTheDocument();
  });

  it('does not show success after a denied release', async () => {
    const data = buildSeed();
    data.fulfillmentOrders = [readyOrder('internal_handover')];
    const repo = makeRepo(data);
    vi.spyOn(repo, 'advanceFulfillmentOrder').mockRejectedValueOnce(new Error('Release denied'));
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator', route: '/fulfillment?tab=orders' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Release handover' }));
    expect(await screen.findByText('Release denied')).toBeVisible();
    expect(screen.queryByText(/HANDOVER-1 release recorded/)).not.toBeInTheDocument();
    expect((await repo.getData()).fulfillmentOrders[0]?.status).toBe('ready');
  });

  it.each(['approved', 'rejected'] as const)('hands a %s stock request to the correct next responsibility', async decision => {
    const data = buildSeed();
    data.fulfillmentOrders = [];
    data.departmentStockRequests = [{
      id: 'request-1', purpose: 'Campaign', requestingDepartment: 'marketing', costCenter: 'CC-1',
      requiredDate: '2026-09-12', expenseTreatment: 'expense', status: 'pending_approval', requestedBy: 'requester', requestedAt: '2026-09-11',
      lines: [{ productId: 'doctor-token', quantity: 1 }],
    }];
    const repo = makeRepo(data);
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_supervisor', route: '/fulfillment?tab=requests' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'View request' }));
    await userEvent.setup().click(await screen.findByRole('button', { name: decision === 'approved' ? 'Approve' : 'Reject' }));
    expect(await screen.findByText(decision === 'approved'
      ? /Request approved\. Next: Warehouse/
      : /Request rejected\. Next: Requester/)).toBeVisible();
    const saved = await repo.getData();
    expect(saved.departmentStockRequests[0]?.status).toBe(decision);
    expect(saved.fulfillmentOrders).toHaveLength(decision === 'approved' ? 1 : 0);
  });
});
