import { describe, it, expect } from "vitest";
import { SupabaseRepository } from "./SupabaseRepository";
import type { WarehouseData } from "../repository";
import type { ReceiveProcurementPOInput } from "../domain/warehouseControls";
import { buildSeed } from "../seed";
import {
  productToRow,
  lotToRow,
  unitToRow,
  movementToRow,
  allocationToRow,
  eventToRow,
  supplierToRow,
} from "./mappers";

const DIRECT_RECEIPT_EXCEPTION = {
  type: "non_po" as const,
  reason: "Approved live receipt outside the PO workflow",
  evidenceUrls: ["evidence/approved-receipt-exception.pdf"],
};

// Minimal mock: records rpc() calls and returns a row the mappers can read.
// Table rows are returned in the snake_case shape the rowTo* mappers expect.
//
// Adaptation notes (spec §12 step 2):
//   * ported from `mwell-intra-warehouse/src/data/supabase/supabaseRepository.test.ts`
//   * imports the adapter from its new home (`./SupabaseRepository`) and the
//     seed / repository from the runtime-agnostic package root (no `@/` alias).
//   * the RPC gate now lives at `core.has_cap('warehouse', <cap>')`, but the
//     wire payload envelope is identical — these assertions stay valid.
function makeMockClient(
  seed: WarehouseData,
  options: {
    inventoryHolds?: Record<string, unknown>[];
    commitReceiveThenFail?: boolean;
    commitFloorThenFail?: boolean;
  } = {},
) {
  const calls: { fn: string; payload: Record<string, unknown> }[] = [];
  const floorReceipts = new Map<string, Record<string, unknown>>();
  const queries: {
    table: string;
    projection: string;
    limit?: number;
    orders: string[];
  }[] = [];
  const locationRows = seed.locations.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
  }));
  const storageAreaRows = seed.storageAreas.map((a) => ({
    id: a.id,
    location_id: a.locationId,
    code: a.code,
    label: a.label ?? null,
    zone: a.zone ?? null,
    active: a.active ?? true,
  }));
  const stockRows = seed.stockLevels.map((s) => ({
    product_id: s.productId,
    location_id: s.locationId,
    bin_id: s.binId ?? null,
    lot_id: s.lotId ?? null,
    quantity: s.quantity,
  }));
  const returnRows = seed.returns.map((r) => ({
    id: r.id,
    source: r.source,
    event_id: r.eventId ?? null,
    lines: r.lines,
    evidence_urls: r.evidenceUrls ?? [],
    actor: r.actor,
    created_at: r.createdAt,
  }));
  const ccRows = seed.cycleCounts.map((c) => ({
    id: c.id,
    location_id: c.locationId,
    bin_id: c.binId ?? null,
    category: c.category ?? null,
    lines: c.lines,
    actor: c.actor,
    created_at: c.createdAt,
  }));
  const receiptRows = seed.receipts.map((r) => ({
    id: r.id,
    supplier_id: r.supplierId ?? null,
    location_id: r.locationId,
    actual_delivery_date: r.actualDeliveryDate ?? null,
    delivery_reference: r.deliveryReference ?? null,
    courier_or_driver: r.courierOrDriver ?? null,
    lines: r.lines,
    evidence_urls: r.evidenceUrls ?? [],
    receipt_exception: r.receiptException ?? null,
    quality_status: r.qualityStatus ?? "pending",
    actor: r.actor,
    created_at: r.createdAt,
  }));
  const poRows = seed.purchaseOrders.map((p) => ({
    id: p.id,
    supplier_id: p.supplierId,
    status: p.status,
    lines: p.lines,
    expected_date: p.expectedDate ?? null,
    actor: p.actor,
    created_at: p.createdAt,
  }));
  const tables: Record<string, unknown[]> = {
    products: seed.products.map(productToRow),
    locations: locationRows,
    storage_areas: storageAreaRows,
    suppliers: seed.suppliers.map(supplierToRow),
    lots: seed.lots.map(lotToRow),
    inventory_units: seed.units.map(unitToRow),
    stock_levels: stockRows,
    movements: seed.movements.map(movementToRow),
    allocations: seed.allocations.map(allocationToRow),
    events: seed.events.map(eventToRow),
    returns: returnRows,
    cycle_counts: ccRows,
    receipts: receiptRows,
    purchase_orders: poRows,
    profiles: [],
    operation_types: [],
    operation_routes: [],
    quality_inspections: [
      {
        id: "qi-1",
        source_type: "receipt",
        source_id: "rcpt-1",
        product_id: "shirt",
        bin_id: null,
        lot_id: null,
        serial_number: null,
        quantity: 1,
        disposition: "accepted",
        reason: null,
        evidence_urls: [],
        inspected_by: "user-1",
        inspected_at: "2026-07-10T00:00:00Z",
      },
    ],
    inventory_holds: options.inventoryHolds ?? [
      {
        id: "hold-1",
        inspection_id: "qi-1",
        product_id: "shirt",
        location_id: "loc-wh",
        bin_id: null,
        lot_id: null,
        serial_number: null,
        quantity: 1,
        status: "active",
        reason: "Damage",
        created_by: "user-1",
        created_at: "2026-07-10T00:00:00Z",
        released_by: null,
        released_at: null,
      },
    ],
    vendor_returns: [
      {
        id: "vr-1",
        hold_id: "hold-1",
        supplier_id: "sup-1",
        source_receipt_id: "rcpt-1",
        source_return_id: null,
        product_id: "shirt",
        lot_id: null,
        serial_number: null,
        quantity: 1,
        reason: "Rejected",
        reference: "RMA-001",
        status: "ready",
        evidence_urls: [],
        created_by: "user-2",
        created_at: "2026-07-10T00:00:00Z",
        handed_off_by: null,
        handed_off_at: null,
        completed_at: null,
      },
    ],
    exceptions: [
      {
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
      },
    ],
    stock_change_requests: [
      {
        id: "scr-1",
        source_type: "cycle_count",
        source_id: "cc-1",
        product_id: "shirt",
        location_id: "loc-wh",
        bin_id: null,
        quantity_delta: -1,
        unit_cost: 200,
        financial_impact: 200,
        reason: "Variance",
        evidence_urls: [],
        status: "pending_supervisor",
        requested_by: "user-1",
        requested_at: "2026-07-10T00:00:00Z",
        can_decide: true,
      },
    ],
    warehouse_tasks: [
      {
        id: "task-1",
        task_type: "quality",
        source_id: "qi-1",
        title: "Inspect receipt",
        status: "due",
        assignee_id: null,
        due_at: null,
        completed_at: null,
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    inventory_position_v1: [
      {
        id: "shirt|loc-wh|",
        product_id: "shirt",
        location_id: "loc-wh",
        bin_id: null,
        on_hand: 20,
        committed: 1,
        held: 1,
        unavailable: 0,
        available: 18,
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    procurement_po_handoff: [
      {
        id: "live-po-1",
        po_number: "PO-LIVE-001",
        vendor_name: "Live Vendor",
        status: "issued",
        expected_date: "2026-07-20",
        total: 625,
        created_at: "2026-07-18T08:00:00Z",
        lines: [
          {
            id: "line-1",
            productId: "shirt",
            description: "Shirts",
            quantity: 5,
            receivedQuantity: 1,
            unitPrice: 125,
          },
        ],
      },
    ],
    fulfillment_orders: seed.fulfillmentOrders.map((order) => ({
      id: order.id,
      source: order.source,
      external_reference: order.externalReference,
      requesting_department: order.requestingDepartment ?? null,
      source_location_id: order.sourceLocationId ?? null,
      source_bin_id: order.sourceBinId ?? null,
      customer_reference: order.customerReference ?? null,
      event_id: order.eventId ?? null,
      third_party_location_id: order.thirdPartyLocationId ?? null,
      gross_sales_amount: order.grossSalesAmount ?? null,
      courier: order.courier ?? null,
      waybill_number: order.waybillNumber ?? null,
      status: order.status,
      lines: order.lines,
      packaging: order.packaging,
      created_by: order.createdBy,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
      released_by: order.releasedBy ?? null,
      released_at: order.releasedAt ?? null,
    })),
    department_stock_requests: seed.departmentStockRequests.map((request) => ({
      id: request.id,
      requesting_department: request.requestingDepartment,
      purpose: request.purpose,
      cost_center: request.costCenter,
      required_date: request.requiredDate,
      expense_treatment: request.expenseTreatment,
      status: request.status,
      lines: request.lines,
      requested_by: request.requestedBy,
      requested_at: request.requestedAt,
      approved_by: request.approvedBy ?? null,
      approved_at: request.approvedAt ?? null,
      fulfillment_order_id: request.fulfillmentOrderId ?? null,
    })),
    customer_return_cases: seed.customerReturnCases.map((record) => ({
      id: record.id,
      source_order_id: record.sourceOrderId ?? null,
      serial_number: record.serialNumber ?? null,
      product_id: record.productId,
      defect_description: record.defectDescription,
      requesting_department: record.requestingDepartment,
      status: record.status,
      resolution: record.resolution,
      quarantine_bin_id: record.quarantineBinId ?? null,
      replacement_order_id: record.replacementOrderId ?? null,
      refund_reference: record.refundReference ?? null,
      supplier_reference: record.supplierReference ?? null,
      created_by: record.createdBy,
      created_at: record.createdAt,
      resolved_by: record.resolvedBy ?? null,
      resolved_at: record.resolvedAt ?? null,
    })),
    kit_definitions: seed.kitDefinitions.map((definition) => ({
      id: definition.id,
      product_id: definition.productId,
      version: definition.version,
      name: definition.name,
      components: definition.components,
      status: definition.status,
      owner_department: definition.ownerDepartment,
      product_approval_reference: definition.productApprovalReference,
      created_by: definition.createdBy,
      created_at: definition.createdAt,
    })),
    rekit_work_orders: seed.reKitWorkOrders.map((order) => ({
      id: order.id,
      source_return_case_id: order.sourceReturnCaseId,
      kit_definition_id: order.kitDefinitionId,
      output_serial_number: order.outputSerialNumber,
      component_serial_numbers: order.componentSerialNumbers,
      condition: order.condition,
      status: order.status,
      created_by: order.createdBy,
      created_at: order.createdAt,
      completed_by: order.completedBy ?? null,
      completed_at: order.completedAt ?? null,
    })),
  };
  let receiveFailureInjected = false;
  const client = {
    from: (table: string) => ({
      select: (projection: string) => {
        const record = { table, projection, orders: [] } as {
          table: string;
          projection: string;
          limit?: number;
          orders: string[];
        };
        queries.push(record);
        const result = Promise.resolve({
          data: tables[table] ?? [],
          error: null,
        });
        const query = {
          order: (column: string) => {
            record.orders.push(column);
            return query;
          },
          or: () => query,
          eq: () => query,
          limit: (limit: number) => {
            record.limit = limit;
            return query;
          },
          then: result.then.bind(result),
        };
        return query;
      },
      insert: () => Promise.resolve({ data: null, error: null }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    }),
    rpc: (fn: string, args: { payload: Record<string, unknown> }) => {
      calls.push({ fn, payload: args.payload });
      const floorKey = `${fn}:${args.payload.idempotency_key}`;
      if (args.payload.replay_only) {
        return Promise.resolve({ data: floorReceipts.get(floorKey) ?? null, error: null });
      }
      if (
        fn === "receive_stock" &&
        options.commitReceiveThenFail &&
        !receiveFailureInjected
      ) {
        receiveFailureInjected = true;
        tables.receipts!.push(args.payload.receipt!);
        return Promise.resolve({
          data: null,
          error: { message: "Failed to fetch after commit" },
        });
      }
      const row: Record<string, unknown> = {
        id: "mock",
        product_id: "mock-product",
        location_id: "loc-wh",
        supplier_id: null,
        event_id: "evt-makati",
        status: "issued",
        quantity: 1,
        type: "movement",
        actor: "test",
        created_at: new Date().toISOString(),
        lines: [],
        evidence_urls: [],
        source: "customer",
        category: null,
        serial_number: null,
        from_location_id: null,
        to_location_id: null,
        lot_id: null,
        code: "BIN-MOCK",
        label: null,
        zone: null,
        active: true,
        reason: null,
        reference: null,
        sku: "MOCK",
        name: "Mock",
        serialized: false,
        attributes: {},
        unit_cost: 0,
        reorder_point: 0,
        promotional: false,
        barcode: null,
        price: null,
        device_type: null,
        merchandise_type: null,
        lead_time_days: 0,
        site_location_id: null,
        start_date: "2026-01-01",
        end_date: null,
        expected_date: null,
        email: "t@t",
        role: "logistics_supervisor",
        title: "t",
        lot_code: null,
        received_at: null,
        assigned_to: null,
      };
      const quality = tables.quality_inspections![0] as Record<string, unknown>;
      const hold = tables.inventory_holds![0] as Record<string, unknown>;
      const exception = tables.exceptions![0] as Record<string, unknown>;
      const request = tables.stock_change_requests![0] as Record<
        string,
        unknown
      >;
      const route = {
        id: "route-1",
        operation_type_id: "op-1",
        source_location_types: ["vendor"],
        destination_location_types: ["warehouse"],
        requires_evidence: true,
        requires_approval: false,
        requires_online: true,
        active: true,
      };
      const wmsRows: Record<string, Record<string, unknown>> = {
        create_fulfillment_order: {
          id: "11111111-1111-4111-8111-111111111111",
          source: "ecommerce",
          external_reference: "SHOP-1",
          requesting_department: "sales",
          source_location_id: "loc-wh",
          source_bin_id: null,
          customer_reference: null,
          event_id: null,
          third_party_location_id: null,
          gross_sales_amount: null,
          courier: null,
          waybill_number: null,
          status: "received",
          lines: [],
          packaging: [],
          created_by: "user-1",
          created_at: "2026-07-21T00:00:00Z",
          updated_at: "2026-07-21T00:00:00Z",
          released_by: null,
          released_at: null,
        },
        create_department_stock_request: {
          id: "22222222-2222-4222-8222-222222222222",
          requesting_department: "marketing",
          purpose: "Roadshow",
          cost_center: "MKT-100",
          required_date: "2026-08-01",
          expense_treatment: "expense",
          status: "pending_approval",
          lines: [],
          requested_by: "user-1",
          requested_at: "2026-07-21T00:00:00Z",
          approved_by: null,
          approved_at: null,
          fulfillment_order_id: null,
        },
        create_customer_return_case: {
          id: "33333333-3333-4333-8333-333333333333",
          source_order_id: null,
          serial_number: null,
          product_id: "shirt",
          defect_description: "Damage",
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
        },
        create_kit_definition: {
          id: "44444444-4444-4444-8444-444444444444",
          product_id: "otg-bag",
          version: 1,
          name: "OTG Set",
          components: [],
          status: "active",
          owner_department: "product",
          product_approval_reference: "PROD-APPROVAL-1",
          created_by: "user-1",
          created_at: "2026-07-21T00:00:00Z",
        },
        create_rekit_work_order: {
          id: "55555555-5555-4555-8555-555555555555",
          source_return_case_id: "33333333-3333-4333-8333-333333333333",
          kit_definition_id: "44444444-4444-4444-8444-444444444444",
          output_serial_number: "KIT-1",
          component_serial_numbers: ["SN-1"],
          condition: "open_box",
          status: "inspection",
          created_by: "user-1",
          created_at: "2026-07-21T00:00:00Z",
          completed_by: null,
          completed_at: null,
        },
        complete_rekit_work_order: {
          id: "55555555-5555-4555-8555-555555555555",
          source_return_case_id: "33333333-3333-4333-8333-333333333333",
          kit_definition_id: "44444444-4444-4444-8444-444444444444",
          output_serial_number: "KIT-1",
          component_serial_numbers: ["SN-1"],
          condition: "open_box",
          status: "completed",
          created_by: "user-1",
          created_at: "2026-07-21T00:00:00Z",
          completed_by: "user-1",
          completed_at: "2026-07-21T01:00:00Z",
        },
      };
      const response =
        fn === "inspect_quality"
          ? { inspection: quality }
          : fn === "release_quality_hold"
            ? hold
            : fn === "update_operation_route"
              ? route
              : fn === "submit_cycle_count" ||
                  fn === "create_and_submit_cycle_count"
                ? { cycle_count: row, requests: [request] }
                : fn === "list_stock_change_requests"
                  ? { rows: [request], next_cursor: null, total: 1 }
                  : fn === "decide_stock_change"
                    ? request
                    : fn === "resolve_exception"
                      ? exception
                      : fn === "receive_procurement_po"
                        ? { receipt: row, purchase_order: {} }
                        : fn === "advance_fulfillment_order"
                          ? wmsRows.create_fulfillment_order
                          : fn === "decide_department_stock_request"
                            ? wmsRows.create_department_stock_request
                            : fn === "resolve_customer_return_case"
                              ? wmsRows.create_customer_return_case
                              : (wmsRows[fn] ?? row);
      if (options.commitFloorThenFail && (fn === "issue" || fn === "transfer")) {
        floorReceipts.set(floorKey, response ?? row);
        tables.allocations = [];
        tables.stock_levels = [];
        tables.inventory_units = [];
        return Promise.resolve({ data: null, error: { message: "Failed to fetch after commit" } });
      }
      return Promise.resolve({ data: response, error: null });
    },
  };
  return { client: client as never, calls, queries };
}

describe("SupabaseRepository read model query shape", () => {
  it("uses explicit projections and bounds operational history", async () => {
    const { client, queries } = makeMockClient(buildSeed());
    await new SupabaseRepository(client).getData();
    expect(queries).toHaveLength(23);
    expect(queries.every((query) => query.projection !== "*")).toBe(true);
    expect(queries.find((query) => query.table === "movements")?.limit).toBe(
      5000,
    );
    expect(
      queries.find((query) => query.table === "products")?.limit,
    ).toBeUndefined();
    expect(
      queries.find((query) => query.table === "fulfillment_reservations")
        ?.projection,
    ).not.toBe("*");
    expect(
      queries.find((query) => query.table === "department_request_options")
        ?.projection,
    ).not.toBe("*");
  });
});

describe("SupabaseRepository WMS persistence boundary", () => {
  it("hydrates every WMS aggregate with explicit projections", async () => {
    const { client, queries } = makeMockClient(buildSeed());
    const data = await new SupabaseRepository(client).getData();
    expect(data).toMatchObject({
      fulfillmentOrders: [],
      departmentStockRequests: [],
      customerReturnCases: [],
      kitDefinitions: [],
      reKitWorkOrders: [],
    });
    for (const table of [
      "fulfillment_orders",
      "fulfillment_reservations",
      "department_request_options",
      "department_stock_requests",
      "customer_return_cases",
      "kit_definitions",
      "rekit_work_orders",
    ]) {
      expect(
        queries.find((query) => query.table === table)?.projection,
      ).not.toBe("*");
    }
  });

  it("routes all WMS mutations through audited idempotent RPC payloads", async () => {
    const { client, calls } = makeMockClient(buildSeed());
    const repo = new SupabaseRepository(client);
    const order = await repo.createFulfillmentOrder({
      source: "third_party",
      externalReference: "SHOP-1",
      requestingDepartment: "operations_events",
      sourceLocationId: "loc-wh",
      eventId: "evt-makati",
      thirdPartyLocationId: "loc-event-makati",
      grossSalesAmount: 8640,
      lines: [{ productId: "shirt", quantity: 1 }],
      actor: "forged",
    });
    await repo.advanceFulfillmentOrder({
      orderId: order.id,
      action: "allocate",
      actor: "forged",
    });
    const request = await repo.createDepartmentStockRequest({
      requestingDepartment: "marketing",
      purpose: "Roadshow",
      costCenter: "MKT-100",
      requiredDate: "2026-08-01",
      expenseTreatment: "expense",
      lines: [{ productId: "shirt", quantity: 1 }],
      actor: "forged",
    });
    await repo.decideDepartmentStockRequest({
      requestId: request.id,
      decision: "approved",
      actor: "forged",
    });
    const returnCase = await repo.createCustomerReturnCase({
      productId: "shirt",
      defectDescription: "Damage",
      actor: "forged",
    });
    await repo.resolveCustomerReturnCase({
      returnCaseId: returnCase.id,
      resolution: "write_off",
      actor: "forged",
    });
    const kit = await repo.createKitDefinition({
      productId: "otg-bag",
      name: "OTG Set",
      components: [],
      status: "active",
      ownerDepartment: "product",
      productApprovalReference: "PROD-APPROVAL-1",
      actor: "forged",
    });
    const rekit = await repo.createReKitWorkOrder({
      sourceReturnCaseId: returnCase.id,
      kitDefinitionId: kit.id,
      outputSerialNumber: "KIT-1",
      componentSerialNumbers: ["SN-1"],
      condition: "open_box",
      actor: "forged",
    });
    await repo.completeReKitWorkOrder({
      workOrderId: rekit.id,
      locationId: "loc-wh",
      binId: "bin-a",
      actor: "forged",
    });

    expect(calls.slice(-9).map((call) => call.fn)).toEqual([
      "create_fulfillment_order",
      "advance_fulfillment_order",
      "create_department_stock_request",
      "decide_department_stock_request",
      "create_customer_return_case",
      "resolve_customer_return_case",
      "create_kit_definition",
      "create_rekit_work_order",
      "complete_rekit_work_order",
    ]);
    expect(
      calls.find((call) => call.fn === "create_fulfillment_order")?.payload,
    ).toMatchObject({
      event_id: "evt-makati",
      third_party_location_id: "loc-event-makati",
      gross_sales_amount: 8640,
    });
    expect(
      calls.find((call) => call.fn === "decide_department_stock_request")
        ?.payload,
    ).toMatchObject({ fulfillment_order_id: request.id });
    for (const call of calls.slice(-9)) {
      expect(call.payload.idempotency_key).toMatch(/^[A-Za-z0-9_-]{12,128}$/);
      expect(call.payload).not.toHaveProperty("actor");
      expect(call.payload).not.toHaveProperty("created_by");
      expect(call.payload).not.toHaveProperty("requested_by");
      expect(call.payload).not.toHaveProperty("released_by");
    }
  });
});

describe("SupabaseRepository W1 control boundary", () => {
  it("uses explicit projections and stable bounded pagination for every control list", async () => {
    const { client, queries, calls } = makeMockClient(buildSeed());
    const repo = new SupabaseRepository(client);
    await Promise.all([
      repo.listQualityInspections({ limit: 500 }),
      repo.listHolds({ limit: 500 }),
      repo.listVendorReturns({ limit: 500 }),
      repo.listExceptions({ limit: 500 }),
      repo.listStockChangeRequests({ limit: 500 }),
      repo.listWarehouseTasks({ limit: 500 }),
      repo.listInventoryPositions({ limit: 500 }),
    ]);
    const controlTables = [
      "quality_inspections",
      "inventory_holds",
      "vendor_returns",
      "exceptions",
      "warehouse_tasks",
      "inventory_position_v1",
    ];
    for (const table of controlTables) {
      const query = queries.find((item) => item.table === table)!;
      expect(query.projection).not.toBe("*");
      expect(query.orders).toEqual([
        table === "quality_inspections" ? "inspected_at" : "created_at",
        "id",
      ]);
      expect(query.limit).toBe(101);
    }
    const qualityQuery = queries.find(
      (item) => item.table === "quality_inspections",
    )!;
    expect(qualityQuery.projection).toContain("inspected_at");
    expect(qualityQuery.projection).not.toContain("created_at");
    expect(
      calls.find((call) => call.fn === "list_stock_change_requests")?.payload,
    ).toMatchObject({ limit: 100 });
  });

  it("preserves mixed-case inspection payloads and idempotency identity for database canonical matching", async () => {
    const { client, calls } = makeMockClient(buildSeed());
    const repo = new SupabaseRepository(client);
    for (const sourceType of ["receipt", "return"] as const) {
      const input = {
        idempotencyKey: `quality-${sourceType}-canonical`, sourceType, sourceId: "receipt-legacy",
        productId: "shirt", procurementPoLineId: "line-A", binId: "bin-A", quantity: 1,
        serialNumber: "  Mixed-Serial  ", disposition: "hold" as const, reason: "Quality review",
      };
      await repo.inspectQuality(input);
      expect(calls.filter(item => item.fn === "inspect_quality").at(-1)?.payload).toMatchObject({
        source_type: sourceType, source_id: "receipt-legacy", product_id: "shirt",
        procurement_po_line_id: "line-A", bin_id: "bin-A", quantity: 1,
        serial_number: "  Mixed-Serial  ", idempotency_key: input.idempotencyKey,
      });
      expect(input.serialNumber).toBe("  Mixed-Serial  ");
    }
  });

  it("sends idempotent command payloads without trusted actor or role values", async () => {
    const { client, calls } = makeMockClient(buildSeed());
    const repo = new SupabaseRepository(client);
    await repo.inspectQuality({
      idempotencyKey: "quality-key-0001",
      sourceType: "receipt",
      sourceId: "rcpt-1",
      productId: "shirt",
      procurementPoLineId: "po-line-1",
      quantity: 1,
      disposition: "accepted",
    });
    await repo.releaseHold({
      idempotencyKey: "release-key-0001",
      holdId: "hold-1",
      targetDisposition: "accepted",
      reason: "QC cleared",
      evidenceUrls: ["evidence/release.jpg"],
    });
    await repo.updateOperationRoute({
      idempotencyKey: "route-key-00001",
      routeId: "route-1",
      patch: {
        sourceLocationTypes: ["vendor"],
        destinationLocationTypes: ["warehouse"],
        requiresEvidence: true,
        requiresApproval: false,
        requiresOnline: true,
        active: true,
      },
    });
    await repo.submitCycleCount({
      idempotencyKey: "count-key-00001",
      cycleCountId: "cc-1",
      reason: "Scheduled count",
    });
    await repo.requestStockChange({
      idempotencyKey: "request-key-0001",
      sourceType: "write_off",
      productId: "shirt",
      locationId: "loc-wh",
      quantityDelta: -1,
      reason: "Damaged stock",
      evidenceUrls: [],
    });
    await repo.decideStockChange({
      idempotencyKey: "decision-key-01",
      requestId: "scr-1",
      decision: "approved",
    });
    await repo.resolveException({
      idempotencyKey: "exception-key01",
      exceptionId: "ex-1",
      action: "begin",
    });

    for (const call of calls.slice(-7)) {
      expect(call.payload.idempotency_key).toMatch(/key/);
      expect(call.payload).not.toHaveProperty("actor");
      expect(call.payload).not.toHaveProperty("role");
      expect(call.payload).not.toHaveProperty("approval_tier");
    }
    expect(calls.at(-7)?.payload).toMatchObject({
      procurement_po_line_id: "po-line-1",
    });
    expect(calls.slice(-7).map((call) => call.fn)).toEqual([
      "inspect_quality",
      "release_quality_hold",
      "update_operation_route",
      "submit_cycle_count",
      "request_stock_change",
      "decide_stock_change",
      "resolve_exception",
    ]);
  });

  it("receives a procurement PO through one idempotent RPC without actor claims", async () => {
    const { client, calls } = makeMockClient(buildSeed());
    const repo = new SupabaseRepository(client);
    await repo.receiveProcurementPO({
      mode: "legacy",
      idempotencyKey: "procurement-receipt-01",
      poId: "po-live-1",
      locationId: "loc-wh",
      binId: "bin-a",
      lines: [
        {
          mode: "legacy",
          lineId: "line-1",
          productId: "shirt",
          quantity: 2,
        },
      ],
      evidenceUrls: ["evidence/delivery.jpg"],
    });
    const call = calls.find((item) => item.fn === "receive_procurement_po")!;
    expect(call.payload).toMatchObject({
      idempotency_key: "procurement-receipt-01",
      po_id: "po-live-1",
      location_id: "loc-wh",
      bin_id: "bin-a",
    });
    expect(call.payload).not.toHaveProperty("actor");
    expect(call.payload).not.toHaveProperty("role");
    expect(call.payload).not.toHaveProperty("exception_reason");
  });

  it("sends a mixed serialized receipt breakdown through one governed RPC", async () => {
    const { client, calls } = makeMockClient(buildSeed());
    const repo = new SupabaseRepository(client);
    await repo.receiveProcurementPO({
      mode: "breakdown",
      idempotencyKey: "procurement-mixed-0001",
      poId: "po-0001",
      locationId: "loc-wh",
      binId: "bin-receiving",
      exceptionReason: "Mixed physical outcomes at receiving",
      lines: [
        {
          mode: "breakdown",
          lineId: "line-0001",
          productId: "smart-watch",
          expectedQuantity: 100,
          outcomes: {
            clean: { quantity: 50, serialNumbers: ["CLEAN-001"] },
            damaged: { quantity: 20, serialNumbers: ["DAMAGED-001"] },
            unidentified: {
              quantity: 10,
              serialNumbers: ["UNKNOWN-001"],
              observedDescription: "Unmarked smart watch",
              observedIdentifiers: "Carton A",
            },
            short: { quantity: 20 },
            excess: { quantity: 0, serialNumbers: [] },
          },
        },
      ],
      evidenceUrls: ["evidence/po-0001.jpg"],
    } satisfies ReceiveProcurementPOInput);

    const matchingCalls = calls.filter(
      (item) => item.fn === "receive_procurement_po",
    );
    expect(matchingCalls).toHaveLength(1);
    expect(matchingCalls[0]!.payload).toMatchObject({
      idempotency_key: "procurement-mixed-0001",
      po_id: "po-0001",
      location_id: "loc-wh",
      bin_id: "bin-receiving",
      exception_reason: "Mixed physical outcomes at receiving",
      lines: [
        {
          line_id: "line-0001",
          product_id: "smart-watch",
          expected_quantity: 100,
          outcomes: {
            clean: { quantity: 50, serial_numbers: ["CLEAN-001"] },
            damaged: { quantity: 20, serial_numbers: ["DAMAGED-001"] },
            unidentified: {
              quantity: 10,
              serial_numbers: ["UNKNOWN-001"],
              observed_description: "Unmarked smart watch",
              observed_identifiers: "Carton A",
            },
            short: { quantity: 20 },
            excess: { quantity: 0, serial_numbers: [] },
          },
        },
      ],
      evidence_urls: ["evidence/po-0001.jpg"],
    });
  });

  it("persists delivery, batch, and device-test provenance in live receiving", async () => {
    const seed = buildSeed();
    const serialized = seed.products.find((product) => product.serialized)!;
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.receiveStock({
      locationId: "loc-wh",
      actualDeliveryDate: "2026-07-21",
      deliveryReference: "DR-2048",
      courierOrDriver: "Courier A / Van 12",
      lines: [
        {
          productId: serialized.id,
          quantity: 1,
          serialNumbers: ["SERIAL-2048"],
          batchNumber: "BATCH-77",
          deviceTestStatus: "passed",
        },
      ],
      receiptException: DIRECT_RECEIPT_EXCEPTION,
      actor: "untrusted-client-actor",
    });

    const call = calls.find((item) => item.fn === "receive_stock")!;
    expect(call.payload.receipt).toMatchObject({
      actual_delivery_date: "2026-07-21",
      delivery_reference: "DR-2048",
      courier_or_driver: "Courier A / Van 12",
      lines: [
        expect.objectContaining({
          batchNumber: "BATCH-77",
          deviceTestStatus: "passed",
        }),
      ],
    });
  });

  it("uses a stable receive operation identity for every generated row", async () => {
    const seed = buildSeed();
    const serialized = seed.products.find((product) => product.serialized)!;
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);

    await repo.receiveStock({
      idempotencyKey: "receive-live-20260813-001",
      locationId: "loc-wh",
      actor: "untrusted-client-actor",
      lines: [
        {
          productId: serialized.id,
          quantity: 1,
          lotCode: "LOT-LIVE-001",
        },
      ],
      receiptException: DIRECT_RECEIPT_EXCEPTION,
    });

    const payload = calls.find((item) => item.fn === "receive_stock")!.payload;
    expect(payload.idempotency_key).toBe("receive-live-20260813-001");
    expect((payload.receipt as { id: string }).id).toBe(
      "rcpt-receive-live-20260813-001",
    );
    expect((payload.lots as { id: string }[])[0]!.id).toBe(
      "lot-receive-live-20260813-001-0",
    );
    expect((payload.units as { id: string }[])[0]!.id).toBe(
      "unit-receive-live-20260813-001-0-0",
    );
    expect(
      (payload.units as { serial_number: string }[])[0]!.serial_number,
    ).toBe(`${serialized.sku}-SN-receive-live-20260813-001-0`);
    expect((payload.movements as { id: string }[])[0]!.id).toBe(
      "mv-receive-live-20260813-001-0",
    );
  });

  it("recovers the committed receipt when the RPC response is lost", async () => {
    const seed = buildSeed();
    const product = seed.products.find((candidate) => !candidate.serialized)!;
    const { client, calls } = makeMockClient(seed, {
      commitReceiveThenFail: true,
    });

    const receipt = await new SupabaseRepository(client).receiveStock({
      idempotencyKey: "receive-lost-response-20260813-001",
      locationId: "loc-wh",
      lines: [{ productId: product.id, quantity: 4 }],
      receiptException: DIRECT_RECEIPT_EXCEPTION,
      actor: "client-user",
    });

    expect(receipt.id).toBe("rcpt-receive-lost-response-20260813-001");
    expect(calls.filter((call) => call.fn === "receive_stock")).toHaveLength(1);
  });

  it("returns a committed receipt on retry without sending a second mutation", async () => {
    const seed = buildSeed();
    const product = seed.products.find((candidate) => !candidate.serialized)!;
    const committedReceipt = {
      id: "rcpt-receive-uncertain-20260813-001",
      locationId: "loc-wh",
      lines: [{ productId: product.id, quantity: 4 }],
      evidenceUrls: [],
      receiptException: DIRECT_RECEIPT_EXCEPTION,
      qualityStatus: "pending" as const,
      actor: "server-user",
      createdAt: "2026-08-13T02:00:00.000Z",
    };
    seed.receipts.push(committedReceipt);
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);

    const receipt = await repo.receiveStock({
      idempotencyKey: "receive-uncertain-20260813-001",
      locationId: "loc-wh",
      lines: [{ productId: product.id, quantity: 4 }],
      receiptException: DIRECT_RECEIPT_EXCEPTION,
      actor: "client-user",
    });

    expect(receipt).toEqual(committedReceipt);
    expect(calls.filter((call) => call.fn === "receive_stock")).toHaveLength(0);
  });

  it("rejects a committed receipt whose idempotency key is reused for another payload", async () => {
    const seed = buildSeed();
    const product = seed.products.find((candidate) => !candidate.serialized)!;
    seed.receipts.push({
      id: "rcpt-receive-mismatch-20260813-001",
      locationId: "loc-wh",
      lines: [{ productId: product.id, quantity: 4 }],
      evidenceUrls: [],
      receiptException: DIRECT_RECEIPT_EXCEPTION,
      qualityStatus: "pending",
      actor: "server-user",
      createdAt: "2026-08-13T02:00:00.000Z",
    });
    const { client } = makeMockClient(seed);

    await expect(
      new SupabaseRepository(client).receiveStock({
        idempotencyKey: "receive-mismatch-20260813-001",
        locationId: "loc-wh",
        lines: [{ productId: product.id, quantity: 5 }],
        receiptException: DIRECT_RECEIPT_EXCEPTION,
        actor: "client-user",
      }),
    ).rejects.toThrow("Idempotency key was reused with a different payload.");
  });

  it("treats reordered JSONB line keys as the same committed receive payload", async () => {
    const seed = buildSeed();
    const product = seed.products.find((candidate) => !candidate.serialized)!;
    seed.receipts.push({
      id: "rcpt-receive-jsonb-order-20260813-001",
      locationId: "loc-wh",
      lines: [{ quantity: 4, productId: product.id }],
      evidenceUrls: [],
      receiptException: DIRECT_RECEIPT_EXCEPTION,
      qualityStatus: "pending",
      actor: "server-user",
      createdAt: "2026-08-13T02:00:00.000Z",
    });
    const { client, calls } = makeMockClient(seed);

    const receipt = await new SupabaseRepository(client).receiveStock({
      idempotencyKey: "receive-jsonb-order-20260813-001",
      locationId: "loc-wh",
      lines: [{ productId: product.id, quantity: 4 }],
      receiptException: DIRECT_RECEIPT_EXCEPTION,
      actor: "client-user",
    });

    expect(receipt.id).toBe("rcpt-receive-jsonb-order-20260813-001");
    expect(calls.filter((call) => call.fn === "receive_stock")).toHaveLength(0);
  });

  it("reads the explicit RLS-backed procurement handoff projection", async () => {
    const { client, queries } = makeMockClient(buildSeed());
    const rows = await new SupabaseRepository(
      client,
    ).getReceivableProcurementPOs();
    expect(rows).toEqual([
      expect.objectContaining({
        id: "live-po-1",
        poNumber: "PO-LIVE-001",
        status: "issued",
        total: 625,
        createdAt: "2026-07-18T08:00:00Z",
      }),
    ]);
    const query = queries.find(
      (item) => item.table === "procurement_po_handoff",
    )!;
    expect(query.projection).not.toBe("*");
    expect(query.projection).toContain("created_at");
    expect(query.projection).toContain("total");
    expect(query.limit).toBe(500);
  });
});

describe("SupabaseRepository concurrency-safe payloads (warehouse.* v8 RPCs)", () => {
  const seed = buildSeed();
  // Pick a non-serialized product with stock at loc-wh for delta assertions.
  const token = seed.products.find((p) => p.sku === "TOKEN-DOC")!;

  for (const method of ['issue', 'transfer', 'relocate'] as const) {
    it(`${method} recovers a lost commit response before stale stock/status validation`, async () => {
      const { client, calls, queries } = makeMockClient(seed, { commitFloorThenFail: true });
      const repo = new SupabaseRepository(client);
      const key = `offline-${method}-test-0001`;
      const allocation = seed.allocations.find((a) => a.productId === token.id && a.status === 'reserved')!;
      const send = () => method === 'issue'
        ? repo.issue({ allocationId: allocation.id, actor: 'test', idempotencyKey: key })
        : method === 'transfer'
          ? repo.transfer({ productId: token.id, fromLocationId: 'loc-wh', toLocationId: 'loc-cebu', quantity: 1, actor: 'test', idempotencyKey: key })
          : repo.relocate({ productId: token.id, locationId: 'loc-wh', toBinId: 'bin-pasig-c1', quantity: 1, actor: 'test', idempotencyKey: key });
      await expect(send()).rejects.toThrow('Failed to fetch after commit');
      const reads = queries.length;
      await expect(send()).resolves.toBeTruthy();
      expect(queries).toHaveLength(reads);
      const mutations = calls.filter((c) => !c.payload.replay_only);
      expect(mutations).toHaveLength(1);
      expect(mutations[0]!.payload.idempotency_key).toBe(key);
      expect(mutations[0]!.payload.command_input).not.toHaveProperty('actor');
      expect(calls.at(-1)!.payload.command_input).toEqual(mutations[0]!.payload.command_input);
    });
  }

  it("issue sends stock DELTAS (negative) across bins, not an absolute quantity", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    const alloc = seed.allocations.find(
      (a) => a.productId === token.id && a.status === "reserved",
    )!;
    await repo.issue({ allocationId: alloc.id, actor: "test" });
    const call = calls.find((c) => c.fn === "issue")!;
    const deltas = call.payload.stock_deltas as
      { delta: number; product_id: string }[] | undefined;
    expect(deltas).toBeDefined();
    expect(deltas!.length).toBeGreaterThan(0);
    // Every delta targets the allocation product and is a negative draw-down.
    for (const d of deltas!) {
      expect(d.product_id).toBe(token.id);
      expect(d).toHaveProperty("lot_id");
      expect(d.delta).toBeLessThan(0);
    }
    // The magnitudes sum to the allocation quantity (a delta, not an absolute).
    const sum = deltas!.reduce((s, d) => s + Math.abs(d.delta), 0);
    expect(sum).toBe(alloc.quantity);
  });

  it("avoids exact held stock and selects another unheld source location", async () => {
    const heldSeed = buildSeed();
    const heldToken = heldSeed.products.find(
      (product) => product.sku === "TOKEN-DOC",
    )!;
    const heldAllocation = heldSeed.allocations.find(
      (allocation) =>
        allocation.productId === heldToken.id &&
        allocation.status === "reserved",
    )!;
    const { client, calls } = makeMockClient(heldSeed, {
      inventoryHolds: [
        {
          id: "hold-token-primary",
          inspection_id: "qi-token",
          product_id: heldToken.id,
          location_id: "loc-wh",
          bin_id: null,
          lot_id: null,
          serial_number: null,
          quantity: 40,
          status: "active",
          reason: "Controlled hold",
          created_by: "user-1",
          created_at: "2026-07-10T00:00:00Z",
          released_by: null,
          released_at: null,
        },
      ],
    });
    const repo = new SupabaseRepository(client);

    await repo.issue({ allocationId: heldAllocation.id, actor: "test" });

    const call = calls.find((entry) => entry.fn === "issue")!;
    const deltas = call.payload.stock_deltas as {
      location_id: string;
      delta: number;
    }[];
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      location_id: "loc-cebu",
      delta: -heldAllocation.quantity,
    });
  });

  it("issue wraps its payload in the { payload } RPC envelope", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    const alloc = seed.allocations.find(
      (a) => a.productId === token.id && a.status === "reserved",
    )!;
    await repo.issue({ allocationId: alloc.id, actor: "test" });
    const call = calls.find((c) => c.fn === "issue")!;
    // Envelope shape must expose the fields the SECURITY DEFINER RPC reads.
    expect(call.payload.allocation_id).toBe(alloc.id);
    expect(call.payload.movement).toBeTruthy();
    expect(call.payload).toHaveProperty("unit_ids");
  });

  it("transfer sends from/to DELTAS (negative and positive) with matching magnitudes", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.transfer({
      productId: token.id,
      fromLocationId: "loc-wh",
      toLocationId: "loc-cebu",
      quantity: 1,
      actor: "test",
    });
    const call = calls.find((c) => c.fn === "transfer")!;
    const from = call.payload.from_stock_delta as { delta: number };
    const to = call.payload.to_stock_delta as { delta: number };
    expect(from.delta).toBe(-1);
    expect(to.delta).toBe(1);
    // The SECURITY DEFINER RPC rejects mismatched magnitudes; verify parity.
    expect(Math.abs(from.delta)).toBe(Math.abs(to.delta));
  });

  it("receiveStock sends stock_deltas (positive additive), not absolute stock_levels", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.receiveStock({
      locationId: "loc-wh",
      lines: [{ productId: token.id, quantity: 7 }],
      receiptException: DIRECT_RECEIPT_EXCEPTION,
      actor: "test",
    });
    const call = calls.find((c) => c.fn === "receive_stock")!;
    expect(call.payload.stock_levels).toBeUndefined();
    const deltas = call.payload.stock_deltas as { delta: number }[];
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.delta).toBe(7);
    // Receipt row uses snake_case columns so the RPC's jsonb_populate_record
    // maps straight into warehouse.receipts (evidence_urls -> core.documents).
    const receipt = call.payload.receipt as Record<string, unknown>;
    expect(receipt.location_id).toBe("loc-wh");
    expect(Array.isArray(receipt.evidence_urls)).toBe(true);
  });

  it("reserve routes through the reserve RPC (server-side ATP re-check)", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.reserve({
      eventId: "evt-makati",
      productId: token.id,
      quantity: 1,
      actor: "test",
    });
    const call = calls.find((c) => c.fn === "reserve")!;
    expect(call).toBeDefined();
    // The RPC re-checks that the allocation row matches the (product, qty)
    // that ATP was evaluated against, so the client must send both sides.
    expect(call.payload.product_id).toBe(token.id);
    expect(call.payload.quantity).toBe(1);
    const alloc = call.payload.allocation as Record<string, unknown>;
    expect(alloc.product_id).toBe(token.id);
    expect(alloc.quantity).toBe(1);
    expect(alloc.status).toBe("reserved");
  });

  it("recordCycleCount creates only a governed draft", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.recordCycleCount({
      locationId: "loc-wh",
      lines: [{ productId: token.id, expected: 80, counted: 75 }],
      actor: "test",
    });
    const call = calls.find((c) => c.fn === "record_cycle_count")!;
    expect(call.payload).not.toHaveProperty("stock_sets");
    expect(call.payload).not.toHaveProperty("movements");
    expect(call.payload.cycle_count).toMatchObject({
      status: "draft",
    });
    expect(call.payload.cycle_count).not.toHaveProperty("requested_by");
    expect(call.payload.cycle_count).not.toHaveProperty("actor");
  });

  it("creates and submits an evidenced cycle count through one atomic RPC", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);

    await repo.createAndSubmitCycleCount({
      idempotencyKey: "atomic-count-001",
      locationId: "loc-wh",
      category: "merchandise",
      lines: [{ productId: token.id, expected: 80, counted: 75 }],
      reason: "Scheduled control count",
      evidenceUrls: ["evidence/cycle-counts/atomic-count-001.jpg"],
      actor: "counter@mwell.com.ph",
      requesterId: "counter-profile-id",
    });

    expect(
      calls.filter((call) => call.fn.includes("cycle_count")),
    ).toHaveLength(1);
    const call = calls.find(
      (entry) => entry.fn === "create_and_submit_cycle_count",
    )!;
    expect(call.payload).toMatchObject({
      idempotency_key: "atomic-count-001",
      reason: "Scheduled control count",
      evidence_urls: ["evidence/cycle-counts/atomic-count-001.jpg"],
      cycle_count: {
        location_id: "loc-wh",
        category: "merchandise",
        lines: [{ productId: token.id, expected: 80, counted: 75 }],
      },
    });
    expect(call.payload.cycle_count).not.toHaveProperty("actor");
    expect(call.payload.cycle_count).not.toHaveProperty("requested_by");
  });

  it("recordReturn sends quarantine intent and leaves physical deltas to the RPC", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.recordReturn({
      source: "customer",
      eventId: "evt-makati",
      lines: [
        {
          productId: token.id,
          quantity: 3,
          reason: "unused",
          locationId: "loc-wh",
        },
      ],
      evidenceUrls: ["evidence/return/abc.jpg"],
      actor: "test",
    });
    const call = calls.find((c) => c.fn === "record_return_v2")!;
    expect(call.payload.stock_deltas).toBeUndefined();
    expect(call.payload.unit_updates).toBeUndefined();
    expect(call.payload.movements).toBeUndefined();
    expect(call.payload.idempotency_key).toMatch(/^return-/);
    const ret = call.payload.return as Record<string, unknown>;
    expect(ret.event_id).toBe("evt-makati");
    expect(ret.evidence_urls).toEqual(["evidence/return/abc.jpg"]);
    expect(ret.lines).toEqual([
      expect.objectContaining({
        locationId: "loc-wh",
        disposition: "quarantine",
      }),
    ]);
  });

  it("createPurchaseOrder + cancelPurchaseOrder + receiveAgainstPO route through their RPCs", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.createPurchaseOrder({
      supplierId: "sup-tokens",
      lines: [{ productId: token.id, quantityOrdered: 100 }],
      actor: "test",
    });
    const create = calls.find((c) => c.fn === "create_purchase_order")!;
    const po = create.payload.purchase_order as Record<string, unknown>;
    expect(po.supplier_id).toBe("sup-tokens");
    // Server stamps status='ordered' + origin='warehouse'; we still send the
    // full row for jsonb_populate_record.
    expect(po.status).toBe("ordered");

    const existingPo = seed.purchaseOrders.find(
      (p) => p.status === "ordered" || p.status === "partially_received",
    );
    if (existingPo) {
      await repo.receiveAgainstPO({
        poId: existingPo.id,
        locationId: "loc-wh",
        lines: existingPo.lines.map((l) => ({
          productId: l.productId,
          quantityReceived: 1,
        })),
        actor: "test",
      });
      const receive = calls.find((c) => c.fn === "receive_against_po")!;
      expect(receive.payload.po_id).toBe(existingPo.id);
      // Client-projected next status feeds a hint the RPC uses only when its
      // own recomputed status agrees (server is still authoritative).
      expect(receive.payload.po_status).toBeDefined();
      // line_deltas is the additive receipt list (positive quantities only).
      const lineDeltas = receive.payload.line_deltas as {
        quantityReceived: number;
      }[];
      expect(lineDeltas.every((l) => l.quantityReceived > 0)).toBe(true);
    }

    // Cancel an ordered PO (not one already fully received).
    const cancellable = seed.purchaseOrders.find((p) => p.status === "ordered");
    if (cancellable) {
      await repo.cancelPurchaseOrder({ poId: cancellable.id, actor: "test" });
      const cancel = calls.find((c) => c.fn === "cancel_purchase_order")!;
      expect(cancel.payload.po_id).toBe(cancellable.id);
    }
  });

  it("cancelAllocation routes through the cancel_allocation RPC", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    const reservable = seed.allocations.find((a) => a.status === "reserved")!;
    await repo.cancelAllocation({
      allocationId: reservable.id,
      actor: "test",
    });
    const call = calls.find((c) => c.fn === "cancel_allocation")!;
    expect(call.payload.allocation_id).toBe(reservable.id);
  });

  it("setProductPrice routes through the set_product_price RPC", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.setProductPrice({
      productId: token.id,
      price: 199,
      actor: "test",
    });
    const call = calls.find((c) => c.fn === "set_product_price")!;
    expect(call.payload.product_id).toBe(token.id);
    expect(call.payload.price).toBe(199);
  });

  it("deleteStorageArea routes through the delete_storage_area RPC", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.deleteStorageArea({ storageAreaId: "bin-pasig-a1" });
    const call = calls.find((c) => c.fn === "delete_storage_area")!;
    expect(call.payload.storage_area_id).toBe("bin-pasig-a1");
  });

  it("createEvent routes through the create_event RPC", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.createEvent({
      name: "Audit Pop-up Clinic",
      type: "medical_mission",
      siteLocationId: "site-makati",
      startDate: "2026-08-01",
    });
    const call = calls.find((c) => c.fn === "create_event")!;
    expect(call).toBeDefined();
    expect((call.payload.event as Record<string, unknown>).name).toBe(
      "Audit Pop-up Clinic",
    );
  });

  it("createStorageArea and updateStorageArea route through bin RPCs", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.createStorageArea({
      locationId: "loc-wh",
      code: "A-99",
      label: "Audit shelf",
      zone: "A",
    });
    const create = calls.find((c) => c.fn === "create_storage_area")!;
    expect(create).toBeDefined();
    expect((create.payload.storage_area as Record<string, unknown>).code).toBe(
      "A-99",
    );

    await repo.updateStorageArea({
      storageAreaId: "bin-pasig-a1",
      code: "A-01",
      label: "Updated shelf",
      active: false,
    });
    const update = calls.find((c) => c.fn === "update_storage_area")!;
    expect(update.payload.storage_area_id).toBe("bin-pasig-a1");
    expect((update.payload.patch as Record<string, unknown>).active).toBe(
      false,
    );
  });

  it("relocate reuses the transfer RPC with same-location from/to deltas", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.relocate({
      productId: token.id,
      locationId: "loc-wh",
      fromBinId: undefined,
      toBinId: "bin-pasig-c1",
      quantity: 2,
      actor: "test",
    });
    const call = calls.find((c) => c.fn === "transfer")!;
    expect(call.payload.from_location_id).toBe("loc-wh");
    expect(call.payload.to_location_id).toBe("loc-wh");
    const from = call.payload.from_stock_delta as { delta: number };
    const to = call.payload.to_stock_delta as { delta: number };
    expect(from.delta).toBe(-2);
    expect(to.delta).toBe(2);
  });

  it("routes vendor return custody through the controlled RPC", async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.createVendorReturn({
      idempotencyKey: "vendor-return-rpc-001",
      holdId: "hold-1",
      supplierId: "sup-1",
      reason: "Incoming quality rejection",
      reference: "RMA-001",
      evidenceUrls: ["evidence/rma.jpg"],
    });
    const call = calls.find((entry) => entry.fn === "create_vendor_return")!;
    expect(call.payload).toMatchObject({
      hold_id: "hold-1",
      supplier_id: "sup-1",
      reference: "RMA-001",
    });
  });
});
