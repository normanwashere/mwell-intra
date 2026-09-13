import { describe, expect, it } from 'vitest';
import { canReleaseFulfillmentOrder, nextFulfillmentStatus, type CustomerReturnCase, type DepartmentStockRequest, type FulfillmentOrder, type InventoryUnit, type ReturnRecord } from '@intra/data-kit';
import { orderWorkflowSummary, requestWorkflowSummary, returnWorkflowSummary } from './workflowSummary';

const order: FulfillmentOrder = {
  id: 'order-1', externalReference: 'SUMMARY-1', source: 'department_request', status: 'received',
  deliveryMethod: 'internal_handover', createdBy: 'requester', createdAt: '2026-09-11', updatedAt: '2026-09-11',
  lines: [{ productId: 'smart-watch', quantity: 1, pickedQuantity: 1, pickedSerialNumbers: ['SERIAL-1'] }],
  packaging: [], shipmentEvents: [], packedBy: 'packer', releasedBy: 'releaser',
  handoverRecipientName: 'Recipient', handoverRecipientDepartment: 'Marketing', handoverReference: 'REF-1', handoverEvidenceUrl: 'https://example.com/evidence',
};
const request: DepartmentStockRequest = {
  id: 'request-1', requestingDepartment: 'marketing', purpose: 'Campaign', costCenter: 'CC-1', requiredDate: '2026-09-12',
  expenseTreatment: 'expense', status: 'pending_approval', lines: [{ productId: 'smart-watch', quantity: 1 }],
  requestedBy: 'requester', requestedAt: '2026-09-11', fulfillmentOrderId: order.id,
};
const returnCase: CustomerReturnCase = {
  id: 'return-1', sourceOrderId: 'order-1', productId: 'smart-watch', defectDescription: 'Defect', requestingDepartment: 'customer_service',
  status: 'submitted', resolution: 'pending', createdBy: 'customer-service', createdAt: '2026-09-11',
};

describe('fulfillment workflow responsibility matrix', () => {
  it.each([
    ['received', 'allocate', 'Awaiting allocation', 'picking'],
    ['allocated', 'start_picking', 'Awaiting picking', 'picking'],
    ['picking', 'confirm_pick', 'Picking', 'packing'],
    ['packing', 'confirm_pack', 'Awaiting packing', 'release'],
    ['ready', 'release', 'Awaiting release', 'confirms receipt'],
  ] as const)('maps %s using the existing %s transition', (status, action, label, handoff) => {
    expect(nextFulfillmentStatus(status, action)).toBeTruthy();
    const summary = orderWorkflowSummary({ ...order, status });
    expect(summary.status).toBe(label);
    expect(summary.nextStep).toContain(handoff);
    expect(['requester', 'packer', 'releaser']).not.toContain(summary.owner);
  });

  it.each(['shipment', 'internal_handover', 'event_handover', 'third_party_transfer'] as const)('distinguishes the released %s handoff', deliveryMethod => {
    const summary = orderWorkflowSummary({ ...order, status: 'released', deliveryMethod, shipmentStatus: 'dispatched' });
    expect(summary.status).toBe(deliveryMethod === 'shipment' ? 'Dispatched / awaiting delivery' : 'Awaiting receipt confirmation');
    expect(summary.tone).not.toBe('success');
  });

  it.each([
    ['dispatched', 'Dispatched / awaiting delivery'], ['in_transit', 'In transit'],
    ['delivery_failed', 'Delivery failed'], ['returned_to_sender', 'Returned to sender'],
    [undefined, 'Released / delivery needs verification'], ['delivered', 'Released / delivery needs verification'],
    ['awaiting_dispatch', 'Released / delivery needs verification'], ['not_applicable', 'Released / delivery needs verification'],
  ] as const)('does not infer completion from released shipment %s', (shipmentStatus, status) => {
    const summary = orderWorkflowSummary({ ...order, status: 'released', deliveryMethod: 'shipment', shipmentStatus });
    expect(summary.status).toBe(status);
    expect(summary.tone).not.toBe('success');
  });

  it('preserves the reported failure reason and requires follow-up after return to sender', () => {
    const summary = orderWorkflowSummary({ ...order, status: 'released', deliveryMethod: 'shipment', shipmentStatus: 'returned_to_sender', deliveryFailureReason: 'Address inaccessible' });
    expect(summary.blocker).toBe('Address inaccessible');
    expect(summary.nextStep).toContain('not completed');
  });

  it.each(['completed', 'cancelled'] as const)('treats only stored terminal status %s as terminal', status => {
    const summary = orderWorkflowSummary({ ...order, status, cancellationReason: 'Demand withdrawn' });
    expect(summary.owner).toBe(status === 'completed' ? 'Warehouse / Customer Service verification' : 'No further fulfillment handoff');
    if (status === 'completed') expect(summary.blocker).toContain('does not show proof of receipt');
    else expect(summary.blocker).toBeUndefined();
    if (status === 'cancelled') expect(summary.nextStep).toContain('Demand withdrawn');
  });

  it('uses the actual release validator and matches any actor identity for separation of duties', () => {
    const ready = { ...order, status: 'ready' as const };
    const validation = canReleaseFulfillmentOrder(ready, 'packer');
    expect(validation.ok).toBe(false);
    expect(orderWorkflowSummary(ready, { actorIds: ['other-id', 'packer'] }).blocker).toBe(!validation.ok ? validation.reason : undefined);
    expect(orderWorkflowSummary(ready, { actorIds: ['other-id'] }).blocker).toBeUndefined();
    expect(orderWorkflowSummary({ ...ready, handoverEvidenceUrl: undefined }).blocker).toMatch(/evidence.*required/);
    expect(orderWorkflowSummary({ ...ready, deliveryMethod: 'shipment', courier: undefined }).blocker).toMatch(/courier/);
  });

  it('does not assign the viewer responsibility or bypass nonreleasing acknowledgment', () => {
    const released = { ...order, status: 'released' as const };
    const recorder = orderWorkflowSummary(released, { actorIds: ['finance'] });
    const releaser = orderWorkflowSummary(released, { actorIds: ['profile', 'releaser'] });
    expect(recorder.owner).toBe(releaser.owner);
    expect(releaser.blocker).toMatch(/releasing operator cannot acknowledge/);
  });

  it.each(['pending_inspection', 'returned', 'vendor_return', 'lost'] as const)('flags only exact picked stock that is %s', status => {
    const unit: InventoryUnit = { id: 'unit', productId: 'smart-watch', serialNumber: 'SERIAL-1', locationId: 'loc-wh', status };
    expect(orderWorkflowSummary({ ...order, status: 'ready' }, { units: [unit] }).status).toBe('Awaiting release / stock blocked');
    expect(orderWorkflowSummary(order, { units: [{ ...unit, serialNumber: 'OTHER' }] }).blocker).toBeUndefined();
    expect(orderWorkflowSummary(order, { units: [{ ...unit, productId: 'OTHER' }] }).blocker).toBeUndefined();
    expect(orderWorkflowSummary(order).blocker).toBeUndefined();
  });

  it('does not let stale timestamps imply completion; unknown status fails closed in copy', () => {
    expect(orderWorkflowSummary({ ...order, acknowledgedAt: '2026-09-11' }).status).toBe('Awaiting allocation');
    expect(orderWorkflowSummary({ ...order, status: 'future' as FulfillmentOrder['status'] }).status).toBe('Workflow state unknown');
    expect(orderWorkflowSummary({ ...order, status: 'released', deliveryMethod: 'future' as FulfillmentOrder['deliveryMethod'] }).blocker).toContain('unrecognized');
    expect(orderWorkflowSummary({ ...order, status: 'held' as FulfillmentOrder['status'] }).blocker).toContain('"held"');
  });

  it('only describes completion evidence as available when its reference and proof are present', () => {
    expect(orderWorkflowSummary({ ...order, status: 'completed', deliveryMethod: 'shipment', proofOfDeliveryReference: 'POD', proofOfDeliveryEvidenceUrl: 'https://example.com/proof' }).tone).toBe('success');
    expect(orderWorkflowSummary({ ...order, status: 'completed', acknowledgedAt: '2026-09-11', acknowledgementReference: 'ACK', acknowledgementEvidenceUrl: 'https://example.com/proof' }).tone).toBe('success');
    expect(orderWorkflowSummary({ ...order, status: 'completed', acknowledgedAt: '2026-09-11' }).tone).toBe('warning');
  });
});

describe('department request matrix', () => {
  it('gives the requester a new-request recovery step without reopening the rejected original', () => {
    const rejected = { ...request, status: 'rejected' as const };
    const summary = requestWorkflowSummary(rejected);
    expect(summary).toMatchObject({
      status: 'Rejected', owner: 'Requester', tone: 'warning',
      nextStep: 'Ask the approver for the rejection reason; prepare a new corrected request if still needed. The original request stays rejected.',
    });
    expect(summary.blocker).toBeUndefined();
    expect(summary.nextStep).not.toMatch(/reopen|resubmit|linked correction/i);
    expect(rejected.status).toBe('rejected');
  });
  it.each(['draft', 'pending_approval', 'rejected', 'cancelled', 'closed'] as const)('keeps %s independent of stale linked-order data', status => {
    const summary = requestWorkflowSummary({ ...request, status }, { ...order, status: 'completed' });
    expect(summary.status).toBe({ draft: 'Draft', pending_approval: 'Awaiting approval', rejected: 'Rejected', cancelled: 'Cancelled', closed: 'Closed' }[status]);
  });
  it.each(['approved', 'allocated', 'issued'] as const)('requires actual linked fulfillment for %s', status => {
    for (const linked of [undefined, { ...order, id: 'not-linked' }]) {
      const summary = requestWorkflowSummary({ ...request, status }, linked);
      expect(summary.blocker).toContain('cannot be confirmed');
      expect(summary.status).toContain('fulfillment unavailable');
    }
    expect(requestWorkflowSummary({ ...request, status }, { ...order, status: 'released' }).status).toContain('Awaiting receipt confirmation');
    expect(requestWorkflowSummary({ ...request, status }, { ...order, status: 'cancelled' }).status).toContain('Cancelled');
  });
  it('keeps multi-role requester separation of duties explicit', () => {
    const summary = requestWorkflowSummary(request, undefined, { actorIds: ['admin', 'requester'] });
    expect(summary.blocker).toBe('The requester cannot approve their own request.');
    expect(summary.owner).toBe('Authorized warehouse / procurement reviewer');
    expect(requestWorkflowSummary(request, undefined, { actorIds: ['other'] }).blocker).toBeUndefined();
  });
  it('does not silently map unknown request states', () => {
    expect(requestWorkflowSummary({ ...request, status: 'future' as DepartmentStockRequest['status'] }).status).toBe('Request state unknown');
  });
});

describe('return case matrix', () => {
  const intake: ReturnRecord = {
    id: 'intake-1', source: 'customer', sourceOrderId: 'order-1', returnCaseId: 'return-1',
    actor: 'receiver', createdAt: '2026-09-11', evidenceUrls: ['return/intake-1/0/photo.png'],
    lines: [{ productId: 'smart-watch', quantity: 1, reason: 'Defect', locationId: 'warehouse', binId: 'quarantine', disposition: 'hold' }],
  };

  it('separates a submitted case from its recorded physical intake without claiming current Quality or custody', () => {
    const before = structuredClone({ returnCase, intake });
    const summary = returnWorkflowSummary(returnCase, { returns: [intake] });
    expect(summary.status).toBe('Customer case submitted / awaiting resolution');
    expect(summary.blocker).toBe('Linked physical intake is recorded. Current Quality hold or release status is not available in this view.');
    expect(summary.nextStep).toContain('Review the linked physical intake and Quality records');
    expect(summary.tone).not.toBe('success');
    expect({ returnCase, intake }).toEqual(before);
  });

  it.each(['hold', 'restock'] as const)('does not infer current held or accepted Quality from intake disposition %s', disposition => {
    const linked = { ...intake, lines: [{ ...intake.lines[0]!, disposition }] };
    const summary = returnWorkflowSummary(returnCase, { returns: [linked] });
    expect(summary.blocker).toContain('Current Quality hold or release status is not available');
    expect(summary.status).not.toMatch(/held|accepted|released|intake/i);
  });

  it.each(['resolved', 'closed'] as const)('preserves %s customer handoff regardless of linked physical records', status => {
    const record = { ...returnCase, status, resolution: 'replacement' as const };
    expect(returnWorkflowSummary(record, { returns: [intake] })).toEqual(returnWorkflowSummary(record));
    expect(returnWorkflowSummary(record, { returns: [{ ...intake, returnCaseId: 'foreign' }] })).toEqual(returnWorkflowSummary(record));
  });

  it('requires the exact serial when the customer case identifies one', () => {
    const record = { ...returnCase, serialNumber: 'SERIAL-1' };
    expect(returnWorkflowSummary(record, { returns: [intake] }).blocker).toContain('not verified');
    const serialized = { ...intake, lines: [{ ...intake.lines[0]!, serialNumber: record.serialNumber }] };
    expect(returnWorkflowSummary(record, { returns: [serialized] }).blocker).toContain('intake is recorded');
  });

  it('requires exact lineage and complete recorded intake before positive wording', () => {
    const variants: ReturnRecord[] = [
      { ...intake, source: 'event' }, { ...intake, sourceOrderId: 'other-order' },
      { ...intake, returnCaseId: 'other-case' }, { ...intake, sourceOrderId: undefined },
      { ...intake, lines: [{ ...intake.lines[0]!, productId: 'other-product' }] },
      { ...intake, lines: [{ ...intake.lines[0]!, serialNumber: 'foreign-serial' }] },
      { ...intake, lines: [{ ...intake.lines[0]!, quantity: 0 }] },
      { ...intake, lines: [{ ...intake.lines[0]!, binId: undefined }] },
      { ...intake, lines: [{ ...intake.lines[0]!, locationId: undefined }] },
      { ...intake, evidenceUrls: [] }, { ...intake, evidenceUrls: [' '] },
      { ...intake, actor: '' }, { ...intake, createdAt: 'invalid' },
    ];
    for (const returns of [undefined, [], ...variants.map(row => [row]), [intake, intake]]) {
      const summary = returnWorkflowSummary({ ...returnCase, quarantineBinId: 'selected-bin' }, { returns });
      expect(summary.blocker).toBe('Linked physical intake and current Quality status are not verified in this view.');
      expect(summary.status).not.toContain('Awaiting physical intake');
      expect(summary.blocker).not.toContain('quarantine bin is required');
    }
    expect(returnWorkflowSummary({ ...returnCase, sourceOrderId: undefined }, { returns: [intake] }).blocker).not.toContain('intake is recorded');
  });

  it.each([
    ['submitted', 'Customer case submitted / awaiting resolution'], ['received', 'Customer case received / awaiting resolution'],
    ['inspecting', 'Customer case under review / awaiting resolution'], ['decision_required', 'Awaiting resolution decision'],
    ['resolved', 'Resolution recorded / awaiting customer closure'], ['closed', 'Customer case closed'],
  ] as const)('distinguishes %s from customer closure and quality release', (status, label) => {
    const summary = returnWorkflowSummary({ ...returnCase, status, resolution: 'replacement' });
    expect(summary.status).toBe(label);
    expect(summary.tone === 'success').toBe(status === 'closed');
    if (status === 'resolved') expect(summary.owner).toBe('Customer Service');
    if (status === 'closed') expect(summary.nextStep).toContain('does not establish');
  });
  it.each(['replacement', 'refund', 'vendor_return', 're_kit', 'write_off'] as const)('does not confuse %s resolution with customer receipt', resolution => {
    const summary = returnWorkflowSummary({ ...returnCase, status: 'resolved', resolution });
    expect(summary.owner).toBe('Customer Service');
    expect(summary.nextStep).toContain('closure evidence');
    expect(summary.tone).not.toBe('success');
  });
  it('keeps physical status unverified, identifies Finance refunds, and preserves unknown outcomes', () => {
    expect(returnWorkflowSummary(returnCase).blocker).toContain('not verified in this view');
    expect(returnWorkflowSummary({ ...returnCase, status: 'decision_required', resolution: 'refund' }).owner).toBe('Finance');
    expect(returnWorkflowSummary({ ...returnCase, status: 'resolved' }).blocker).toContain('still pending');
    expect(returnWorkflowSummary({ ...returnCase, status: 'future' as CustomerReturnCase['status'] }).status).toBe('Return state unknown');
  });

  it.each(['submitted', 'received', 'inspecting'] as const)('keeps refund physical work %s with Warehouse before Finance', status => {
    expect(returnWorkflowSummary({ ...returnCase, status, resolution: 'refund' }).owner).toBe('Warehouse returns team');
  });
});
