export type ItemClass =
  | "sellable_sku"
  | "merchandise"
  | "event_material"
  | "fulfillment_supply"
  | "warehouse_tool"
  | "re_kitted_item";

export type SerializationPolicy =
  "required" | "optional" | "none" | "asset_tag";

export function requiredSerializationPolicy(
  itemClass: ItemClass,
): SerializationPolicy {
  if (itemClass === "sellable_sku") return "required";
  if (itemClass === "warehouse_tool") return "asset_tag";
  if (itemClass === "re_kitted_item") return "required";
  return "none";
}

export type FulfillmentSource =
  "ecommerce" | "department_request" | "event" | "third_party";

export type FulfillmentStatus =
  | "received"
  | "allocated"
  | "picking"
  | "packing"
  | "ready"
  | "released"
  | "cancelled";

export type FulfillmentAction =
  | "allocate"
  | "start_picking"
  | "confirm_pick"
  | "confirm_pack"
  | "mark_ready"
  | "release"
  | "cancel";

export interface FulfillmentOrderLine {
  productId: string;
  quantity: number;
  pickedQuantity: number;
  pickedSerialNumbers: string[];
  /** One code per customer-facing set, e.g. OTG1 and OTG2. */
  bundleSetCodes?: string[];
}

export interface PackagingConsumption {
  productId: string;
  quantity: number;
}

export interface FulfillmentOrder {
  id: string;
  source: FulfillmentSource;
  externalReference: string;
  requestingDepartment?: string;
  sourceLocationId?: string;
  sourceBinId?: string;
  customerReference?: string;
  eventId?: string;
  thirdPartyLocationId?: string;
  /** Commercial value reported by the selling channel for event reconciliation. */
  grossSalesAmount?: number;
  currency?: "PHP";
  courier?: string;
  waybillNumber?: string;
  status: FulfillmentStatus;
  lines: FulfillmentOrderLine[];
  packaging: PackagingConsumption[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  releasedBy?: string;
  releasedAt?: string;
}

const FULFILLMENT_TRANSITIONS: Record<
  Exclude<FulfillmentStatus, "released" | "cancelled">,
  Partial<Record<FulfillmentAction, FulfillmentStatus>>
> = {
  received: { allocate: "allocated", cancel: "cancelled" },
  allocated: { start_picking: "picking", cancel: "cancelled" },
  picking: { confirm_pick: "packing", cancel: "cancelled" },
  packing: { confirm_pack: "ready", mark_ready: "ready", cancel: "cancelled" },
  ready: { release: "released", cancel: "cancelled" },
};

export function nextFulfillmentStatus(
  current: FulfillmentStatus,
  action: FulfillmentAction,
): FulfillmentStatus {
  if (current === "released" || current === "cancelled") {
    throw new Error(
      `Cannot ${action.replace("_", " ")} an order while it is ${current}.`,
    );
  }
  const next = FULFILLMENT_TRANSITIONS[current][action];
  if (!next) {
    throw new Error(
      `Cannot ${action.replace("_", " ")} an order while it is ${current}.`,
    );
  }
  return next;
}

export type ReleaseValidation = { ok: true } | { ok: false; reason: string };

export function canReleaseFulfillmentOrder(
  order: FulfillmentOrder,
): ReleaseValidation {
  if (order.lines.some((line) => line.pickedQuantity !== line.quantity)) {
    return {
      ok: false,
      reason: "Every order line must be fully picked before release.",
    };
  }
  if (!order.courier?.trim()) {
    return { ok: false, reason: "A courier is required before release." };
  }
  if (!order.waybillNumber?.trim()) {
    return { ok: false, reason: "A waybill is required before release." };
  }
  if (order.status !== "ready") {
    return {
      ok: false,
      reason: "The order must be marked ready before release.",
    };
  }
  return { ok: true };
}

export type DepartmentRequestStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "allocated"
  | "issued"
  | "closed"
  | "cancelled";

export interface DepartmentStockRequestLine {
  productId: string;
  quantity: number;
}

export interface DepartmentStockRequest {
  id: string;
  requestingDepartment: string;
  purpose: string;
  costCenter: string;
  requiredDate: string;
  expenseTreatment: "expense" | "custody" | "sale";
  status: DepartmentRequestStatus;
  lines: DepartmentStockRequestLine[];
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  fulfillmentOrderId?: string;
}

export function validateDepartmentRequest(
  request: Pick<
    DepartmentStockRequest,
    "requestingDepartment" | "purpose" | "costCenter" | "requiredDate" | "lines"
  >,
): string[] {
  const errors: string[] = [];
  if (!request.requestingDepartment.trim())
    errors.push("Requesting department is required.");
  if (!request.purpose.trim()) errors.push("Business purpose is required.");
  if (!request.costCenter.trim()) errors.push("Cost center is required.");
  if (!request.requiredDate.trim()) errors.push("Required date is required.");
  if (request.lines.length === 0)
    errors.push("At least one stock line is required.");
  if (request.lines.some((line) => line.quantity <= 0)) {
    errors.push("Every stock line must have a quantity greater than zero.");
  }
  return errors;
}

export interface KitComponent {
  productId: string;
  quantity: number;
  serializationPolicy: SerializationPolicy;
}

export interface KitDefinition {
  id: string;
  productId: string;
  version: number;
  name: string;
  components: KitComponent[];
  status: "draft" | "active" | "retired";
  ownerDepartment: "product";
  /** Product's attributable go-live or recipe approval reference. */
  productApprovalReference: string;
  createdBy: string;
  createdAt: string;
}

export interface ReKitWorkOrder {
  id: string;
  sourceReturnCaseId: string;
  kitDefinitionId: string;
  outputSerialNumber: string;
  componentSerialNumbers: string[];
  condition: "open_box" | "reconditioned";
  status: "draft" | "inspection" | "ready" | "completed" | "cancelled";
  createdBy: string;
  createdAt: string;
  completedBy?: string;
  completedAt?: string;
}

export type ReturnResolution =
  | "pending"
  | "replacement"
  | "refund"
  | "vendor_return"
  | "re_kit"
  | "write_off";

export interface CustomerReturnCase {
  id: string;
  sourceOrderId?: string;
  serialNumber?: string;
  productId: string;
  defectDescription: string;
  requestingDepartment: "customer_service";
  status:
    "submitted" | "received" | "inspecting" | "decision_required" | "resolved";
  resolution: ReturnResolution;
  quarantineBinId?: string;
  replacementOrderId?: string;
  refundReference?: string;
  supplierReference?: string;
  createdBy: string;
  createdAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

export const WMS_DEPARTMENT_OWNERS = {
  orderDemand: "sales_ecommerce",
  physicalCustody: "warehouse_logistics",
  bundleDefinition: "product",
  returnIntake: "customer_service",
  replenishment: "procurement",
  expenseAndRefund: "finance",
  merchandiseDemand: "marketing",
  eventDemand: "operations_events",
} as const;
