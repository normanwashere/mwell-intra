import { describe, it, expect } from "vitest";
import {
  rowToProduct,
  rowToUnit,
  unitToRow,
  rowToMovement,
  movementToRow,
  rowToAllocation,
  allocationToRow,
  rowToException,
  rowToHold,
  rowToInventoryPosition,
  rowToOperationRoute,
  rowToQualityInspection,
  rowToStockChangeRequest,
  rowToWarehouseTask,
  rowToReceipt,
  rowToFulfillmentOrder,
  rowToDepartmentStockRequest,
  rowToCustomerReturnCase,
  rowToKitDefinition,
  rowToReKitWorkOrder,
} from "./mappers";

// Ported from `mwell-intra-warehouse/src/data/supabase/mappers.test.ts`.
// The only adaptation is the import path — the mapper module now lives inside
// `@intra/data-kit` (`./mappers` rather than the warehouse app's `./mappers`).

describe("rowToProduct", () => {
  it("maps snake_case columns and coerces numeric cost", () => {
    const p = rowToProduct({
      id: "ring",
      sku: "RING",
      name: "Ring",
      category: "device",
      item_class: "sellable_sku",
      serialization_policy: "required",
      uom: "piece",
      device_type: "ecg_ring",
      merchandise_type: null,
      serialized: true,
      attributes: { ringSize: "10" },
      unit_cost: "2500.00",
      reorder_point: 6,
      promotional: null,
      barcode: null,
    });
    expect(p).toMatchObject({
      id: "ring",
      deviceType: "ecg_ring",
      merchandiseType: undefined,
      serialized: true,
      attributes: { ringSize: "10" },
      unitCost: 2500,
      reorderPoint: 6,
      barcode: undefined,
      itemClass: "sellable_sku",
      serializationPolicy: "required",
      uom: "piece",
    });
  });
});

describe("rowToReceipt", () => {
  it("preserves delivery provenance from live receipts", () => {
    expect(
      rowToReceipt({
        id: "receipt-1",
        supplier_id: "supplier-1",
        location_id: "loc-wh",
        actual_delivery_date: "2026-07-21",
        delivery_reference: "DR-2048",
        courier_or_driver: "Courier A / Van 12",
        lines: [{ productId: "ring", quantity: 1 }],
        evidence_urls: [],
        actor: "receiver@mwell.com.ph",
        created_at: "2026-07-21T00:00:00Z",
      }),
    ).toMatchObject({
      actualDeliveryDate: "2026-07-21",
      deliveryReference: "DR-2048",
      courierOrDriver: "Courier A / Van 12",
    });
  });
});

describe("WMS row mapping", () => {
  it("maps fulfillment and department-request rows", () => {
    expect(
      rowToFulfillmentOrder({
        id: "order-1",
        source: "ecommerce",
        external_reference: "SHOP-1",
        requesting_department: null,
        source_location_id: "loc-wh",
        source_bin_id: null,
        customer_reference: "customer-1",
        event_id: null,
        third_party_location_id: null,
        courier: null,
        waybill_number: null,
        status: "received",
        lines: [
          {
            productId: "watch",
            quantity: 1,
            pickedQuantity: 0,
            pickedSerialNumbers: [],
          },
        ],
        packaging: [],
        created_by: "user-1",
        created_at: "2026-07-21T00:00:00Z",
        updated_at: "2026-07-21T00:00:00Z",
        released_by: null,
        released_at: null,
      }),
    ).toMatchObject({
      externalReference: "SHOP-1",
      sourceLocationId: "loc-wh",
      requestingDepartment: undefined,
      createdBy: "user-1",
    });
    expect(
      rowToDepartmentStockRequest({
        id: "request-1",
        requesting_department: "marketing",
        purpose: "Roadshow",
        cost_center: "MKT-100",
        required_date: "2026-08-01",
        expense_treatment: "expense",
        status: "pending_approval",
        lines: [{ productId: "token", quantity: 10 }],
        requested_by: "user-2",
        requested_at: "2026-07-21T00:00:00Z",
        approved_by: null,
        approved_at: null,
        fulfillment_order_id: null,
      }),
    ).toMatchObject({
      requestingDepartment: "marketing",
      requestedBy: "user-2",
      approvedBy: undefined,
      fulfillmentOrderId: undefined,
    });
  });

  it("maps return, kit, and re-kit rows without database nulls", () => {
    expect(
      rowToCustomerReturnCase({
        id: "return-1",
        source_order_id: null,
        serial_number: "SN-1",
        product_id: "watch",
        defect_description: "No power",
        requesting_department: "customer_service",
        status: "submitted",
        resolution: "pending",
        quarantine_bin_id: null,
        replacement_order_id: null,
        refund_reference: null,
        supplier_reference: null,
        created_by: "user-1",
        created_at: "2026-07-21T00:00:00Z",
        resolved_by: null,
        resolved_at: null,
      }),
    ).toMatchObject({ sourceOrderId: undefined, quarantineBinId: undefined });
    expect(
      rowToKitDefinition({
        id: "kit-1",
        product_id: "otg",
        version: 2,
        name: "OTG Set",
        components: [
          { productId: "tablet", quantity: 1, serializationPolicy: "required" },
        ],
        status: "active",
        owner_department: "product",
        product_approval_reference: "PROD-APPROVAL-1",
        created_by: "user-1",
        created_at: "2026-07-21T00:00:00Z",
      }),
    ).toMatchObject({
      productId: "otg",
      version: 2,
      ownerDepartment: "product",
      productApprovalReference: "PROD-APPROVAL-1",
    });
    expect(
      rowToReKitWorkOrder({
        id: "rekit-1",
        source_return_case_id: "return-1",
        kit_definition_id: "kit-1",
        output_serial_number: "KIT-NEW-1",
        component_serial_numbers: ["SN-1"],
        condition: "open_box",
        status: "inspection",
        created_by: "user-1",
        created_at: "2026-07-21T00:00:00Z",
        completed_by: null,
        completed_at: null,
      }),
    ).toMatchObject({
      outputSerialNumber: "KIT-NEW-1",
      completedBy: undefined,
    });
  });
});

describe("inventory unit round-trip", () => {
  it("survives row -> domain -> row", () => {
    const row = {
      id: "u1",
      product_id: "ring",
      serial_number: "SN1",
      lot_id: null,
      location_id: "loc-wh",
      bin_id: null,
      status: "in_stock",
      assigned_to: null,
      event_id: null,
    };
    const back = unitToRow(rowToUnit(row));
    expect(back).toEqual(row);
  });
});

describe("movement round-trip", () => {
  it("preserves evidence and optional fields", () => {
    const row = {
      id: "mv1",
      type: "issue",
      product_id: "ring",
      quantity: 2,
      from_location_id: null,
      to_location_id: null,
      from_bin_id: null,
      to_bin_id: null,
      lot_id: null,
      serial_number: null,
      event_id: "e1",
      reason: null,
      reference: "alloc-1",
      evidence_urls: ["blob:1"],
      actor: "ops@mwell",
      created_at: "2026-06-10T00:00:00.000Z",
    };
    expect(movementToRow(rowToMovement(row))).toEqual(row);
  });
});

describe("allocation round-trip", () => {
  it("defaults promotional to false on the row", () => {
    const domain = rowToAllocation({
      id: "a1",
      event_id: "e1",
      product_id: "ring",
      quantity: 5,
      status: "reserved",
      promotional: null,
      created_at: "2026-06-10T00:00:00.000Z",
    });
    expect(domain.promotional).toBeUndefined();
    expect(allocationToRow(domain).promotional).toBe(false);
  });
});

describe("warehouse control row mapping", () => {
  it("maps quality, hold, and exception rows without leaking database nulls", () => {
    expect(
      rowToQualityInspection({
        id: "qi-1",
        source_type: "receipt",
        source_id: "rcpt-1",
        product_id: "shirt",
        bin_id: null,
        lot_id: null,
        serial_number: null,
        quantity: 2,
        disposition: "hold",
        reason: "Damaged carton",
        evidence_urls: null,
        inspected_by: "user-1",
        inspected_at: "2026-07-10T00:00:00Z",
      }),
    ).toMatchObject({
      binId: undefined,
      evidenceUrls: [],
      inspectedBy: "user-1",
      inspectedAt: "2026-07-10T00:00:00Z",
    });
    expect(
      rowToHold({
        id: "hold-1",
        inspection_id: "qi-1",
        product_id: "shirt",
        location_id: "loc-wh",
        bin_id: "bin-a",
        lot_id: null,
        serial_number: null,
        quantity: 2,
        status: "active",
        reason: "Damaged carton",
        created_by: "user-1",
        created_at: "2026-07-10T00:00:00Z",
        released_by: null,
        released_at: null,
      }),
    ).toMatchObject({ binId: "bin-a", releasedBy: undefined });
    expect(
      rowToException({
        id: "ex-1",
        exception_type: "quality",
        severity: "P2",
        source_type: "quality_inspection",
        source_id: "qi-1",
        status: "open",
        owner_id: null,
        due_at: null,
        resolution: null,
        created_at: "2026-07-10T00:00:00Z",
      }),
    ).toMatchObject({
      type: "quality",
      ownerId: undefined,
      resolution: undefined,
    });
  });

  it("coerces numeric stock-change and inventory-position values", () => {
    expect(
      rowToStockChangeRequest({
        id: "scr-1",
        source_type: "cycle_count",
        source_id: "cc-1",
        product_id: "shirt",
        location_id: "loc-wh",
        bin_id: null,
        quantity_delta: "-3",
        unit_cost: "200.50",
        financial_impact: "601.50",
        reason: "Count variance",
        evidence_urls: null,
        status: "pending_supervisor",
        requested_by: "user-1",
        requested_at: "2026-07-10T00:00:00Z",
        can_decide: true,
      }),
    ).toMatchObject({
      quantityDelta: -3,
      unitCost: 200.5,
      financialImpact: 601.5,
      canDecide: true,
    });
    expect(
      rowToInventoryPosition({
        product_id: "shirt",
        location_id: "loc-wh",
        bin_id: null,
        on_hand: "20",
        committed: "3",
        held: "2",
        unavailable: "1",
        available: "14",
      }),
    ).toEqual({
      productId: "shirt",
      locationId: "loc-wh",
      binId: undefined,
      onHand: 20,
      committed: 3,
      held: 2,
      unavailable: 1,
      available: 14,
    });
  });

  it("maps operation-route arrays and task timestamps", () => {
    expect(
      rowToOperationRoute({
        id: "route-1",
        operation_type_id: "op-1",
        source_location_types: ["vendor"],
        destination_location_types: ["warehouse"],
        requires_evidence: true,
        requires_approval: false,
        requires_online: true,
        active: true,
      }),
    ).toMatchObject({ sourceLocationTypes: ["vendor"], requiresOnline: true });
    expect(
      rowToWarehouseTask({
        id: "task-1",
        task_type: "quality",
        source_id: "qi-1",
        title: "Inspect receipt",
        status: "due",
        assignee_id: null,
        due_at: null,
        completed_at: null,
      }),
    ).toMatchObject({
      type: "quality",
      assigneeId: undefined,
      completedAt: undefined,
    });
  });
});
