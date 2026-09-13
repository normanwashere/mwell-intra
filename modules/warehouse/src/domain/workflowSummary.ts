import { canReleaseFulfillmentOrder, type CustomerReturnCase, type DepartmentStockRequest, type FulfillmentOrder, type InventoryUnit, type ReturnRecord } from '@intra/data-kit';

export interface RecordWorkflowSummary {
  status: string;
  owner: string;
  nextStep: string;
  blocker?: string;
  tone?: 'neutral' | 'warning' | 'success';
}

const review = (status: string, blocker: string): RecordWorkflowSummary => ({
  status, owner: 'Warehouse supervisor', nextStep: 'Verify the current record before any further handoff.', blocker, tone: 'warning',
});

// Responsibility comes from workflow transitions, never from the last actor.
export function orderWorkflowSummary(order: FulfillmentOrder, context: {
  actorIds?: readonly (string | undefined)[];
  units?: readonly InventoryUnit[];
} = {}): RecordWorkflowSummary {
  if (order.status === 'cancelled') return {
    status: 'Cancelled', owner: 'No further fulfillment handoff',
    nextStep: order.cancellationReason ? `Stopped: ${order.cancellationReason}` : 'Fulfillment stopped. Cancellation reason is not available in this view.',
  };
  if (order.status === 'completed') {
    const evidenceRecorded = order.deliveryMethod === 'shipment'
      ? order.proofOfDeliveryReference && order.proofOfDeliveryEvidenceUrl
      : ['internal_handover', 'event_handover', 'third_party_transfer'].includes(order.deliveryMethod) && order.acknowledgedAt && order.acknowledgementReference && order.acknowledgementEvidenceUrl;
    return {
      status: 'Completed', owner: evidenceRecorded ? 'No further fulfillment handoff' : 'Warehouse / Customer Service verification', tone: evidenceRecorded ? 'success' : 'warning',
      nextStep: 'The order is recorded as completed. Retain or verify its delivery or recipient acceptance evidence.',
      ...(!evidenceRecorded ? { blocker: 'Completion evidence is not available in this view; the completed status alone does not show proof of receipt.' } : {}),
    };
  }
  if (order.status === 'released') {
    if (['internal_handover', 'event_handover', 'third_party_transfer'].includes(order.deliveryMethod)) return {
      status: 'Awaiting receipt confirmation', owner: 'Recipient / another authorized staff member',
      nextStep: 'Confirm the recipient received the items and attach the reference and proof. The person who released them cannot confirm receipt.',
      ...(order.releasedBy && context.actorIds?.includes(order.releasedBy) ? {
        blocker: 'The releasing operator cannot acknowledge receipt.', tone: 'warning' as const,
      } : {}),
    };
    if (order.deliveryMethod !== 'shipment') return review('Released / handoff unknown', 'Delivery method is unavailable or unrecognized. Release does not confirm receipt.');
    if (order.shipmentStatus === 'returned_to_sender') return {
      status: 'Returned to sender', owner: 'Warehouse / Customer Service', tone: 'warning',
      nextStep: 'Reconcile physical return and customer resolution. This order remains released, not completed.',
      blocker: order.deliveryFailureReason || 'Delivery did not complete; return disposition needs follow-up.',
    };
    if (order.shipmentStatus === 'delivery_failed') return {
      status: 'Delivery failed', owner: 'Warehouse delivery team', tone: 'warning',
      nextStep: 'Confirm the courier outcome, then record retry, delivery evidence, or return to sender.',
      blocker: order.deliveryFailureReason || 'Failed-delivery reason is not available in this view.',
    };
    if (['dispatched', 'in_transit'].includes(order.shipmentStatus ?? '')) return {
      status: order.shipmentStatus === 'in_transit' ? 'In transit' : 'Dispatched / awaiting delivery',
      owner: 'Courier / Warehouse delivery team',
      nextStep: 'Track delivery, then record proof-of-delivery reference and evidence to complete fulfillment.',
    };
    return review('Released / delivery needs verification', 'Shipment state is missing or inconsistent with this released order. Delivery completion is not confirmed.');
  }

  const summaries: Partial<Record<FulfillmentOrder['status'], RecordWorkflowSummary>> = {
    received: { status: 'Awaiting allocation', owner: 'Warehouse operator', nextStep: 'Verify available stock and quality holds, then allocate stock for picking.' },
    allocated: { status: 'Awaiting picking', owner: 'Warehouse operator', nextStep: 'Start picking the reserved order lines.' },
    picking: { status: 'Picking', owner: 'Warehouse operator', nextStep: 'Confirm scanned quantities, serials, bins, and pick evidence; hand off to packing.' },
    packing: { status: 'Awaiting packing', owner: 'Warehouse operator', nextStep: order.deliveryMethod === 'shipment' ? 'Confirm packaging, courier, and waybill; hand off to a second operator for release.' : 'Prepare recipient, department, handover reference, and evidence; hand off to a second operator for release.' },
    ready: { status: 'Awaiting release', owner: 'Warehouse operator other than the packer', nextStep: order.deliveryMethod === 'shipment' ? 'Release the prepared shipment to the courier; delivery confirmation follows.' : 'Release the prepared items. The recipient or another authorized staff member then confirms receipt; the person who released them cannot do this.' },
  };
  const summary = Object.hasOwn(summaries, order.status) ? summaries[order.status] : undefined;
  if (!summary) return review('Workflow state unknown', `The order status "${order.status}" is unrecognized. No completion or next action can be confirmed.`);

  // Only exact picked serials establish unavailable stock; product-level holds
  // are not loaded here and must not be inferred from unrelated inventory.
  const unavailablePickedUnit = order.lines.some(line => line.pickedSerialNumbers.some(serial =>
    context.units?.some(unit => unit.productId === line.productId && unit.serialNumber === serial && ['pending_inspection', 'returned', 'vendor_return', 'lost'].includes(unit.status)),
  ));
  if (unavailablePickedUnit) return {
    ...summary, status: `${summary.status} / stock blocked`, owner: 'Warehouse / Quality Control', tone: 'warning',
    blocker: 'A selected serial is not accepted, available stock. Inspection or custody follow-up is required.',
    nextStep: 'Verify the selected serial and its inspection or custody outcome before continuing fulfillment.',
  };
  if (order.status === 'ready') {
    const actor = context.actorIds?.find(id => id && id === order.packedBy);
    const release = canReleaseFulfillmentOrder(order, actor);
    if (!release.ok) return { ...summary, blocker: release.reason, tone: 'warning' };
  }
  return summary;
}

export function requestWorkflowSummary(request: DepartmentStockRequest, order?: FulfillmentOrder, context: Parameters<typeof orderWorkflowSummary>[1] = {}): RecordWorkflowSummary {
  switch (request.status) {
    case 'draft': return { status: 'Draft', owner: 'Requesting department', nextStep: 'Confirm the business purpose, cost center, required date, and items before approval.' };
    // warehouse_decide_department_stock_request (20260721200000) authorizes
    // warehouse.issue_items OR procurement.approve_request, excluding self.
    // The UI's supervisor-role gate and store's reserve_allocate guard remain
    // unchanged; neither contract assigns a department/DOA approver here.
    case 'pending_approval': return {
      status: 'Awaiting approval', owner: 'Authorized warehouse / procurement reviewer',
      nextStep: 'An authorized reviewer other than the requester approves or rejects; approval creates fulfillment demand.',
      ...(context.actorIds?.includes(request.requestedBy) ? { blocker: 'The requester cannot approve their own request.', tone: 'warning' as const } : {}),
    };
    case 'rejected': return { status: 'Rejected', owner: 'Requester', nextStep: 'Ask the approver for the rejection reason; prepare a new corrected request if still needed. The original request stays rejected.', tone: 'warning' };
    case 'cancelled': return { status: 'Cancelled', owner: 'No further fulfillment handoff', nextStep: 'This request is stopped; no further issue is due under this request.' };
    case 'closed': return { status: 'Closed', owner: 'No further request handoff', nextStep: 'The request is closed. Consult the linked order for its receipt evidence.', tone: 'success' };
    case 'approved':
    case 'allocated':
    case 'issued': {
      if (!order || order.id !== request.fulfillmentOrderId) return review(
        `${request.status === 'approved' ? 'Approved' : request.status === 'allocated' ? 'Allocated' : 'Issued'} / fulfillment unavailable`,
        'The linked fulfillment record is not available in this view. Picking, delivery, and recipient acceptance cannot be confirmed.',
      );
      const summary = orderWorkflowSummary(order, context);
      return { ...summary, status: `${request.status === 'approved' ? 'Approved' : request.status === 'allocated' ? 'Allocated' : 'Issued'} / ${summary.status}` };
    }
    default: return review('Request state unknown', 'The request status is unrecognized. Verify approval and fulfillment before proceeding.');
  }
}

export function returnWorkflowSummary(record: CustomerReturnCase, context: {
  returns?: readonly ReturnRecord[];
} = {}): RecordWorkflowSummary {
  if (record.status === 'closed') return {
    status: 'Customer case closed', owner: 'No further customer-case handoff', tone: 'success',
    nextStep: 'Customer closure is recorded. This does not establish that quarantined stock was released by Quality Control.',
  };
  if (record.status === 'resolved') return {
    status: 'Resolution recorded / awaiting customer closure', owner: 'Customer Service',
    nextStep: 'Confirm the customer received the replacement, refund, or final disposition; record the customer reference and closure evidence.',
    ...(record.resolution === 'pending' ? { blocker: 'The recorded resolution is still pending. Verify the case before confirming customer closure.', tone: 'warning' as const } : {}),
  };
  if (!['submitted', 'received', 'inspecting', 'decision_required'].includes(record.status)) return review('Return state unknown', 'The return status is unrecognized. Resolution and customer closure cannot be confirmed.');
  // Case state and intake disposition do not establish current Quality or custody.
  const linked = context.returns?.filter(intake => intake.returnCaseId === record.id) ?? [];
  const intake = linked.length === 1 ? linked[0] : undefined;
  const hasText = (value?: string) => typeof value === 'string' && value.trim().length > 0;
  const intakeRecorded = intake && hasText(record.sourceOrderId) && intake.sourceOrderId === record.sourceOrderId
    && intake.source === 'customer' && hasText(intake.id) && hasText(intake.actor) && Number.isFinite(Date.parse(intake.createdAt))
    && !!intake.evidenceUrls?.length && intake.evidenceUrls.every(hasText)
    && intake.lines.length > 0 && intake.lines.every(line => line.productId === record.productId
      && (line.serialNumber ?? null) === (record.serialNumber ?? null)
      && Number.isFinite(line.quantity) && line.quantity > 0 && hasText(line.locationId) && hasText(line.binId));
  return {
    status: { submitted: 'Customer case submitted / awaiting resolution', received: 'Customer case received / awaiting resolution', inspecting: 'Customer case under review / awaiting resolution', decision_required: 'Awaiting resolution decision' }[record.status],
    owner: record.status === 'decision_required' && record.resolution === 'refund' ? 'Finance' : 'Warehouse returns team',
    nextStep: 'Review the linked physical intake and Quality records; record the resolution with required evidence, then hand off to Customer Service. Refunds belong to Finance.',
    blocker: intakeRecorded
      ? 'Linked physical intake is recorded. Current Quality hold or release status is not available in this view.'
      : 'Linked physical intake and current Quality status are not verified in this view.',
    tone: 'warning',
  };
}
