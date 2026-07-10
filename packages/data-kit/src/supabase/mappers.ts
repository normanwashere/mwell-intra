// Pure row <-> domain mappers for the Supabase adapter. Kept separate so they
// can be unit-tested without a live database.
//
// Adaptation note: ported verbatim from
// `mwell-intra-warehouse/src/data/supabase/mappers.ts`. The only change is the
// domain-type import path — inside `@intra/data-kit` the entity types live at
// `../domain/types` rather than the warehouse app's `@/domain/types` alias.
import type {
  Allocation,
  CycleCount,
  InventoryUnit,
  Location,
  Lot,
  Movement,
  Product,
  Profile,
  PurchaseOrder,
  Receipt,
  ReturnRecord,
  StockLevel,
  StorageArea,
  Supplier,
  WarehouseEvent,
} from '../domain/types';
import type {
  InventoryHold,
  InventoryPosition,
  OperationRoute,
  OperationType,
  QualityInspection,
  StockChangeRequest,
  WarehouseException,
  WarehouseTask,
  VendorReturn,
} from '../domain/warehouseControls';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export function rowToProduct(r: Row): Product {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    deviceType: r.device_type ?? undefined,
    merchandiseType: r.merchandise_type ?? undefined,
    serialized: r.serialized,
    attributes: r.attributes ?? {},
    unitCost: Number(r.unit_cost),
    price: r.price != null ? Number(r.price) : undefined,
    reorderPoint: r.reorder_point,
    promotional: r.promotional ?? undefined,
    barcode: r.barcode ?? undefined,
    expiryTracked: r.expiry_tracked ?? undefined,
    shelfLifeWarningDays: r.shelf_life_warning_days == null
      ? undefined
      : Number(r.shelf_life_warning_days),
  };
}

export function productToRow(p: Product): Row {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    device_type: p.deviceType ?? null,
    merchandise_type: p.merchandiseType ?? null,
    serialized: p.serialized,
    attributes: p.attributes ?? {},
    unit_cost: p.unitCost,
    price: p.price ?? null,
    reorder_point: p.reorderPoint,
    promotional: p.promotional ?? null,
    barcode: p.barcode ?? null,
    expiry_tracked: p.expiryTracked ?? false,
    shelf_life_warning_days: p.shelfLifeWarningDays ?? 30,
  };
}

export function rowToLocation(r: Row): Location {
  return { id: r.id, name: r.name, type: r.type };
}

export function rowToProfile(r: Row): Profile {
  return {
    id: r.id,
    role: r.role,
    name: r.name,
    email: r.email,
    title: r.title,
  };
}

export function profileToRow(p: Profile): Row {
  return { id: p.id, role: p.role, name: p.name, email: p.email, title: p.title };
}

export function rowToSupplier(r: Row): Supplier {
  return { id: r.id, name: r.name, leadTimeDays: r.lead_time_days };
}

export function rowToLot(r: Row): Lot {
  return {
    id: r.id,
    productId: r.product_id,
    lotCode: r.lot_code,
    supplierId: r.supplier_id ?? undefined,
    unitCost: Number(r.unit_cost),
    receivedAt: r.received_at,
    expiryDate: r.expiry_date ?? undefined,
  };
}

export function lotToRow(l: Lot): Row {
  return {
    id: l.id,
    product_id: l.productId,
    lot_code: l.lotCode,
    supplier_id: l.supplierId ?? null,
    unit_cost: l.unitCost,
    received_at: l.receivedAt,
    expiry_date: l.expiryDate ?? null,
  };
}

export function rowToUnit(r: Row): InventoryUnit {
  return {
    id: r.id,
    productId: r.product_id,
    serialNumber: r.serial_number,
    lotId: r.lot_id ?? undefined,
    locationId: r.location_id,
    binId: r.bin_id ?? undefined,
    status: r.status,
    assignedTo: r.assigned_to ?? undefined,
    eventId: r.event_id ?? undefined,
  };
}

export function unitToRow(u: InventoryUnit): Row {
  return {
    id: u.id,
    product_id: u.productId,
    serial_number: u.serialNumber,
    lot_id: u.lotId ?? null,
    location_id: u.locationId,
    bin_id: u.binId ?? null,
    status: u.status,
    assigned_to: u.assignedTo ?? null,
    event_id: u.eventId ?? null,
  };
}

export function rowToStockLevel(r: Row): StockLevel {
  return {
    productId: r.product_id,
    locationId: r.location_id,
    binId: r.bin_id ?? undefined,
    lotId: r.lot_id ?? undefined,
    quantity: r.quantity,
  };
}

export function rowToStorageArea(r: Row): StorageArea {
  return {
    id: r.id,
    locationId: r.location_id,
    code: r.code,
    label: r.label ?? undefined,
    zone: r.zone ?? undefined,
    active: r.active ?? undefined,
  };
}

export function storageAreaToRow(a: StorageArea): Row {
  return {
    id: a.id,
    location_id: a.locationId,
    code: a.code,
    label: a.label ?? null,
    zone: a.zone ?? null,
    active: a.active ?? true,
  };
}

export function rowToMovement(r: Row): Movement {
  return {
    id: r.id,
    type: r.type,
    productId: r.product_id,
    fromBinId: r.from_bin_id ?? undefined,
    toBinId: r.to_bin_id ?? undefined,
    quantity: r.quantity,
    fromLocationId: r.from_location_id ?? undefined,
    toLocationId: r.to_location_id ?? undefined,
    lotId: r.lot_id ?? undefined,
    serialNumber: r.serial_number ?? undefined,
    eventId: r.event_id ?? undefined,
    reason: r.reason ?? undefined,
    reference: r.reference ?? undefined,
    evidenceUrls: r.evidence_urls ?? [],
    actor: r.actor,
    createdAt: r.created_at,
  };
}

export function movementToRow(m: Movement): Row {
  return {
    id: m.id,
    type: m.type,
    product_id: m.productId,
    quantity: m.quantity,
    from_location_id: m.fromLocationId ?? null,
    to_location_id: m.toLocationId ?? null,
    from_bin_id: m.fromBinId ?? null,
    to_bin_id: m.toBinId ?? null,
    lot_id: m.lotId ?? null,
    serial_number: m.serialNumber ?? null,
    event_id: m.eventId ?? null,
    reason: m.reason ?? null,
    reference: m.reference ?? null,
    evidence_urls: m.evidenceUrls ?? [],
    actor: m.actor,
    created_at: m.createdAt,
  };
}

export function rowToAllocation(r: Row): Allocation {
  return {
    id: r.id,
    eventId: r.event_id,
    productId: r.product_id,
    quantity: r.quantity,
    status: r.status,
    promotional: r.promotional ?? undefined,
    createdAt: r.created_at,
  };
}

export function allocationToRow(a: Allocation): Row {
  return {
    id: a.id,
    event_id: a.eventId,
    product_id: a.productId,
    quantity: a.quantity,
    status: a.status,
    promotional: a.promotional ?? false,
    created_at: a.createdAt,
  };
}

export function rowToEvent(r: Row): WarehouseEvent {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    siteLocationId: r.site_location_id ?? undefined,
    startDate: r.start_date,
    endDate: r.end_date ?? undefined,
  };
}

export function eventToRow(e: WarehouseEvent): Row {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    site_location_id: e.siteLocationId ?? null,
    start_date: e.startDate,
    end_date: e.endDate ?? null,
  };
}

export function supplierToRow(s: Supplier): Row {
  return {
    id: s.id,
    name: s.name,
    lead_time_days: s.leadTimeDays,
  };
}

export function rowToReturn(r: Row): ReturnRecord {
  return {
    id: r.id,
    source: r.source,
    eventId: r.event_id ?? undefined,
    lines: r.lines ?? [],
    evidenceUrls: r.evidence_urls ?? [],
    actor: r.actor,
    createdAt: r.created_at,
  };
}

export function rowToCycleCount(r: Row): CycleCount {
  return {
    id: r.id,
    locationId: r.location_id,
    binId: r.bin_id ?? undefined,
    category: r.category ?? undefined,
    lines: r.lines ?? [],
    status: r.status ?? undefined,
    requestedBy: r.requested_by ?? undefined,
    submittedAt: r.submitted_at ?? undefined,
    actor: r.actor,
    createdAt: r.created_at,
  };
}

export function rowToReceipt(r: Row): Receipt {
  return {
    id: r.id,
    supplierId: r.supplier_id ?? undefined,
    locationId: r.location_id,
    lines: r.lines ?? [],
    evidenceUrls: r.evidence_urls ?? [],
    operationRouteId: r.operation_route_id ?? undefined,
    procurementPoId: r.procurement_po_id ?? undefined,
    qualityStatus: r.quality_status ?? undefined,
    actor: r.actor,
    createdAt: r.created_at,
  };
}

export function rowToPurchaseOrder(r: Row): PurchaseOrder {
  return {
    id: r.id,
    supplierId: r.supplier_id,
    status: r.status,
    lines: r.lines ?? [],
    expectedDate: r.expected_date ?? undefined,
    actor: r.actor,
    createdAt: r.created_at,
  };
}

export function poToRow(po: PurchaseOrder): Row {
  return {
    id: po.id,
    supplier_id: po.supplierId,
    status: po.status,
    lines: po.lines,
    expected_date: po.expectedDate ?? null,
    actor: po.actor,
    created_at: po.createdAt,
  };
}

export function rowToOperationRoute(r: Row): OperationRoute {
  return {
    id: r.id,
    operationTypeId: r.operation_type_id,
    sourceLocationTypes: r.source_location_types ?? [],
    destinationLocationTypes: r.destination_location_types ?? [],
    requiresEvidence: Boolean(r.requires_evidence),
    requiresApproval: Boolean(r.requires_approval),
    requiresOnline: Boolean(r.requires_online),
    active: Boolean(r.active),
  };
}

export function rowToOperationType(r: Row): OperationType {
  return { id: r.id, code: r.code, label: r.label, active: Boolean(r.active) };
}

export function rowToQualityInspection(r: Row): QualityInspection {
  return {
    id: r.id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    productId: r.product_id,
    binId: r.bin_id ?? undefined,
    lotId: r.lot_id ?? undefined,
    serialNumber: r.serial_number ?? undefined,
    quantity: Number(r.quantity),
    disposition: r.disposition,
    reason: r.reason ?? undefined,
    evidenceUrls: r.evidence_urls ?? [],
    inspectedBy: r.inspected_by,
    inspectedAt: r.created_at,
  };
}

export function rowToHold(r: Row): InventoryHold {
  return {
    id: r.id,
    inspectionId: r.inspection_id,
    productId: r.product_id,
    locationId: r.location_id,
    binId: r.bin_id ?? undefined,
    lotId: r.lot_id ?? undefined,
    serialNumber: r.serial_number ?? undefined,
    quantity: Number(r.quantity),
    status: r.status,
    reason: r.reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
    releasedBy: r.released_by ?? undefined,
    releasedAt: r.released_at ?? undefined,
  };
}

export function rowToVendorReturn(r: Row): VendorReturn {
  return {
    id: r.id,
    holdId: r.hold_id,
    supplierId: r.supplier_id,
    sourceReceiptId: r.source_receipt_id ?? undefined,
    sourceReturnId: r.source_return_id ?? undefined,
    productId: r.product_id,
    lotId: r.lot_id ?? undefined,
    serialNumber: r.serial_number ?? undefined,
    quantity: Number(r.quantity),
    reason: r.reason,
    reference: r.reference,
    status: r.status,
    evidenceUrls: r.evidence_urls ?? [],
    createdBy: r.created_by,
    createdAt: r.created_at,
    handedOffBy: r.handed_off_by ?? undefined,
    handedOffAt: r.handed_off_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
  };
}

export function rowToException(r: Row): WarehouseException {
  return {
    id: r.id,
    type: r.exception_type,
    severity: r.severity,
    sourceType: r.source_type,
    sourceId: r.source_id,
    status: r.status,
    ownerId: r.owner_id ?? undefined,
    dueAt: r.due_at ?? undefined,
    resolution: r.resolution ?? undefined,
    createdAt: r.created_at,
  };
}

export function rowToStockChangeRequest(r: Row): StockChangeRequest {
  return {
    id: r.id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    productId: r.product_id,
    locationId: r.location_id,
    binId: r.bin_id ?? undefined,
    quantityDelta: Number(r.quantity_delta),
    unitCost: Number(r.unit_cost),
    financialImpact: Number(r.financial_impact),
    reason: r.reason,
    evidenceUrls: r.evidence_urls ?? [],
    status: r.status,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
  };
}

export function rowToWarehouseTask(r: Row): WarehouseTask {
  return {
    id: r.id,
    type: r.task_type,
    sourceId: r.source_id,
    title: r.title,
    status: r.status,
    assigneeId: r.assignee_id ?? undefined,
    dueAt: r.due_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
  };
}

export function rowToInventoryPosition(r: Row): InventoryPosition {
  return {
    productId: r.product_id,
    locationId: r.location_id,
    binId: r.bin_id ?? undefined,
    onHand: Number(r.on_hand),
    committed: Number(r.committed),
    held: Number(r.held),
    unavailable: Number(r.unavailable),
    available: Number(r.available),
  };
}
