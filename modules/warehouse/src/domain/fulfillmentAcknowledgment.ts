import type { DepartmentStockRequest, FulfillmentOrder } from "@intra/data-kit";
import type { Capability } from "@/auth/roles";

export function receiptAcknowledgmentBlockReason(
  order: FulfillmentOrder | undefined,
  {
    actorIds,
    can,
    requests = [],
  }: {
    actorIds: readonly (string | undefined)[];
    can: (capability: Capability) => boolean;
    requests?: readonly DepartmentStockRequest[];
  },
): string | undefined {
  if (!order)
    return "This order is no longer available. Refresh the queue before recording receipt.";
  if (order.status !== "released")
    return "Only released demand can be acknowledged.";
  if (
    order.deliveryMethod !== "internal_handover" &&
    order.deliveryMethod !== "event_handover" &&
    order.deliveryMethod !== "third_party_transfer"
  )
    return "Receipt acknowledgment is only available for handovers. Shipments require proof of delivery through shipment tracking.";
  const matchesActor = (value: string | undefined) =>
    !!value && actorIds.includes(value);
  if (matchesActor(order.releasedBy)) {
    return "The releasing operator cannot acknowledge receipt. The recipient/requester or an authorized nonreleasing recorder must document recipient acceptance with evidence.";
  }
  // Actor authority mirrors v2's acknowledgment branch, preserved by v3.
  // The handover-only workflow guard above is stricter than the legacy SQL.
  if (
    !matchesActor(order.createdBy) &&
    !can("request_fulfillment") &&
    !can("issue_items") &&
    !requests.some(
      (request) =>
        request.fulfillmentOrderId === order.id &&
        matchesActor(request.requestedBy),
    )
  ) {
    return "Receipt acknowledgment is unavailable for this account. Ask the recipient/requester or an authorized nonreleasing recorder to document recipient acceptance with evidence.";
  }
  return undefined;
}
