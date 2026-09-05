import { describe, expect, it } from 'vitest';
import { applyLocalPaymentRelease, mapProcurementRequest, mapPurchaseOrder } from './localStore';
import type { PurchaseOrder } from './types';

it('maps live normalized physical receipts without inferring QC or changing PO state', () => {
  const row = { id: 'po1', status: 'closed', lines: [{ id: 'line1', quantity: 100, receivedQuantity: 0 }], total: 1800 };
  const receipt = { acceptedQuantity: 0, outstandingQuantity: 100, latestQcStatus: 'not_received' };
  const mapped = mapPurchaseOrder(row as never, receipt as never, [], undefined, undefined, [], undefined, [], [
    { id: 'line1', purchase_order_id: 'po1', received_quantity: 100 } as never,
  ]);
  expect(mapped.lines[0]?.receivedQuantity).toBe(100);
  expect(mapped.status).toBe('closed');
  expect(mapped.receiptStatus).toEqual(receipt);
  expect(mapped.paymentReadiness).toBeUndefined();
  expect(row.lines[0]?.receivedQuantity).toBe(0);
  const unavailable = mapPurchaseOrder(row as never, receipt as never, [], undefined, undefined, [], undefined, [], []);
  expect(unavailable.lines[0]?.receivedQuantity).toBeNaN();
});

describe('mapProcurementRequest', () => {
  it('maps governed route axes while retaining the legacy projection for old consumers', () => {
    const request = mapProcurementRequest({
      id: 'req-route-001',
      title: 'Formal device restock',
      status: 'draft',
      created_at: '2026-08-22T00:00:00.000Z',
      solicitation_type: 'rfq',
      procurement_mode: 'competitive_bidding',
      governance_tier: 'formal_bid',
      policy_profile_id: 'profile-mwell-2026',
      route_reasons: ['material_requirement', 'tier:formal_bid'],
      sourcing_method: 'rfq',
    } as never);

    expect(request.route).toEqual({
      solicitationType: 'rfq',
      procurementMode: 'competitive_bidding',
      governanceTier: 'formal_bid',
      policyProfileId: 'profile-mwell-2026',
      reasons: ['material_requirement', 'tier:formal_bid'],
      legacySourcingMethod: 'rfq',
      confirmedAt: undefined,
      confirmedByEmail: undefined,
    });
    expect(request.sourcingMethod).toBe('rfq');
  });

  it('does not manufacture an authority route from a legacy-only row', () => {
    const request = mapProcurementRequest({
      id: 'req-legacy-001',
      title: 'Legacy request',
      status: 'draft',
      created_at: '2026-08-22T00:00:00.000Z',
      sourcing_method: 'small_purchase',
    } as never);

    expect(request.route).toBeUndefined();
    expect(request.sourcingMethod).toBe('small_purchase');
  });
});

describe('applyLocalPaymentRelease', () => {
  it('keeps a fully paid issued PO out of the terminal state until the governed independent closure path runs', () => {
    const issued = {
      id: 'po-local-payment-001',
      status: 'issued',
      lifecycle: {
        revision: 9,
        acknowledgementStatus: 'acknowledged',
        deliveryNoticeStatus: 'recorded',
        qualityRecoveryStatus: 'none',
        closureStatus: 'ready',
      },
      paymentReadiness: {
        id: 'payment-local-001',
        purchaseOrderId: 'po-local-payment-001',
        acceptancePackId: 'acceptance-local-001',
        invoiceAmount: 1_000,
        releasedAmount: 500,
        status: 'accepted',
        preparedAt: '2026-08-23T00:00:00.000Z',
      },
    } as PurchaseOrder;

    const updated = { ...issued, ...applyLocalPaymentRelease(issued, 500) };

    expect(updated.paymentReadiness).toMatchObject({ releasedAmount: 1_000, status: 'released' });
    expect(updated.status).toBe('issued');
    expect(updated.lifecycle?.closureStatus).toBe('ready');
  });
});
