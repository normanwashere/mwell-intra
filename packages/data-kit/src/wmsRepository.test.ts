import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "./inMemoryRepository";
import { buildSeed } from "./seed";

let repo: InMemoryRepository;

beforeEach(() => {
  const seed = buildSeed();
  const merchandise = seed.products.find((row) => row.id === "doctor-token")!;
  const merchandiseStock = seed.stockLevels.find(
    (row) => row.productId === "doctor-token" && row.locationId === "loc-wh",
  )!;
  seed.products.push({
    ...merchandise,
    id: "event-banner",
    sku: "EVENT-BANNER",
    name: "Event Banner",
    itemClass: "event_material",
    barcode: "4900099999",
  });
  seed.stockLevels.push({
    ...merchandiseStock,
    productId: "event-banner",
    quantity: 5,
  });
  repo = new InMemoryRepository(seed, {
    now: () => "2026-07-21T08:00:00.000Z",
    id: (prefix) => `${prefix}-test`,
  });
});

describe("cross-department WMS repository", () => {
  it("creates an ecommerce order and enforces pick-pack-release progression", async () => {
    const created = await repo.createFulfillmentOrder({
      source: "ecommerce",
      externalReference: "SHOP-1001",
      requestingDepartment: "sales",
      sourceLocationId: "loc-wh",
      lines: [{ productId: "smart-watch", quantity: 1 }],
      actor: "sales@mwell",
    });

    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "allocate",
      actor: "warehouse@mwell",
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "start_picking",
      actor: "warehouse@mwell",
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "confirm_pick",
      actor: "warehouse@mwell",
      pickedLines: [
        {
          productId: "smart-watch",
          quantity: 1,
          serialNumbers: ["SMART-WATCH-SN0001"],
        },
      ],
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "confirm_pack",
      actor: "warehouse@mwell",
      courier: "LBC",
      waybillNumber: "WB-1001",
      packaging: [{ productId: "pack-small-box", quantity: 1 }],
    });
    const released = await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "release",
      actor: "warehouse.supervisor@mwell",
    });

    expect(released.status).toBe("released");
    expect(released.waybillNumber).toBe("WB-1001");
    expect((await repo.getData()).movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "fulfillment_release",
          serialNumber: "SMART-WATCH-SN0001",
        }),
        expect.objectContaining({
          type: "packaging_consumption",
          productId: "pack-small-box",
        }),
      ]),
    );
  });

  it("synchronizes an internal request through allocation, issue, and acknowledgment", async () => {
    const request = await repo.createDepartmentStockRequest({
      requestingDepartment: "marketing",
      purpose: "Event booth materials",
      costCenter: "CC-4100",
      requiredDate: "2026-08-15",
      expenseTreatment: "custody",
      lines: [{ productId: "event-banner", quantity: 1 }],
      actor: "marketing.requester@mwell",
    });
    const approved = await repo.decideDepartmentStockRequest({
      requestId: request.id,
      decision: "approved",
      actor: "marketing.approver@mwell",
    });
    const orderId = approved.fulfillmentOrderId!;

    await repo.advanceFulfillmentOrder({
      orderId,
      action: "allocate",
      actor: "warehouse.operator@mwell",
    });
    expect(
      (await repo.getData()).departmentStockRequests.find(
        (row) => row.id === request.id,
      )?.status,
    ).toBe("allocated");

    await repo.advanceFulfillmentOrder({
      orderId,
      action: "start_picking",
      actor: "warehouse.operator@mwell",
    });
    await repo.advanceFulfillmentOrder({
      orderId,
      action: "confirm_pick",
      actor: "warehouse.operator@mwell",
      pickedLines: [{ productId: "event-banner", quantity: 1 }],
    });
    await repo.advanceFulfillmentOrder({
      orderId,
      action: "confirm_pack",
      actor: "warehouse.operator@mwell",
      handoverRecipientName: "Maya Santos",
      handoverRecipientDepartment: "Marketing",
      handoverReference: "HO-EVENT-1001",
      handoverEvidenceUrl: "https://evidence.example/handover.jpg",
      packaging: [],
    });
    await expect(
      repo.advanceFulfillmentOrder({
        orderId,
        action: "release",
        actor: "warehouse.operator@mwell",
      }),
    ).rejects.toThrow(/second warehouse operator/i);
    await repo.advanceFulfillmentOrder({
      orderId,
      action: "release",
      actor: "warehouse.supervisor@mwell",
    });
    expect(
      (await repo.getData()).departmentStockRequests.find(
        (row) => row.id === request.id,
      )?.status,
    ).toBe("issued");

    const completed = await repo.advanceFulfillmentOrder({
      orderId,
      action: "acknowledge_receipt",
      actor: "marketing.requester@mwell",
      acknowledgementReference: "ACK-EVENT-1001",
      acknowledgementEvidenceUrl: "https://evidence.example/accepted.jpg",
    });
    expect(completed.status).toBe("completed");
    expect(
      (await repo.getData()).departmentStockRequests.find(
        (row) => row.id === request.id,
      )?.status,
    ).toBe("closed");
  });

  it("creates an explicit reservation and splits unavailable demand into a backorder", async () => {
    const order = await repo.createFulfillmentOrder({
      source: "event",
      externalReference: "EVENT-2001",
      eventId: "evt-makati",
      sourceLocationId: "loc-wh",
      lines: [{ productId: "doctor-token", quantity: 10 }],
      actor: "operations@mwell",
    });

    await repo.advanceFulfillmentOrder({
      orderId: order.id,
      action: "split_backorder",
      actor: "warehouse.operator@mwell",
      fulfilledLines: [{ productId: "doctor-token", quantity: 4 }],
    });
    await repo.advanceFulfillmentOrder({
      orderId: order.id,
      action: "allocate",
      actor: "warehouse.operator@mwell",
    });

    const data = await repo.getData();
    expect(data.fulfillmentOrders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: order.id,
          lines: [expect.objectContaining({ quantity: 4 })],
        }),
        expect.objectContaining({
          parentOrderId: order.id,
          externalReference: "EVENT-2001-BO-1",
          lines: [expect.objectContaining({ quantity: 6 })],
        }),
      ]),
    );
    expect(data.fulfillmentReservations).toEqual([
      expect.objectContaining({
        orderId: order.id,
        productId: "doctor-token",
        quantity: 4,
        status: "active",
      }),
    ]);
  });

  it("records consumed packaging when a prepared order is cancelled", async () => {
    const order = await repo.createFulfillmentOrder({
      source: "ecommerce",
      externalReference: "SHOP-CANCEL-1",
      sourceLocationId: "loc-wh",
      lines: [{ productId: "smart-watch", quantity: 1 }],
      actor: "sales@mwell",
    });
    await repo.advanceFulfillmentOrder({
      orderId: order.id,
      action: "allocate",
      actor: "warehouse.operator@mwell",
    });
    await repo.advanceFulfillmentOrder({
      orderId: order.id,
      action: "start_picking",
      actor: "warehouse.operator@mwell",
    });
    await repo.advanceFulfillmentOrder({
      orderId: order.id,
      action: "confirm_pick",
      actor: "warehouse.operator@mwell",
      pickedLines: [
        {
          productId: "smart-watch",
          quantity: 1,
          serialNumbers: ["SMART-WATCH-SN0001"],
        },
      ],
    });
    await repo.advanceFulfillmentOrder({
      orderId: order.id,
      action: "confirm_pack",
      actor: "warehouse.operator@mwell",
      courier: "LBC",
      waybillNumber: "VOID-1001",
      packaging: [{ productId: "pack-small-box", quantity: 1 }],
    });
    await repo.advanceFulfillmentOrder({
      orderId: order.id,
      action: "cancel",
      actor: "warehouse.supervisor@mwell",
      cancellationReason: "Customer cancelled before dispatch",
      packagingDisposition: "consumed",
    });

    const data = await repo.getData();
    expect(data.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "packaging_consumption",
          reference: order.id,
          reason: "Cancelled after packing: Customer cancelled before dispatch",
        }),
      ]),
    );
    expect(
      data.fulfillmentReservations.find((row) => row.orderId === order.id)
        ?.status,
    ).toBe("cancelled");
  });

  it("records third-party event sales demand against its external stock location", async () => {
    const created = await repo.createFulfillmentOrder({
      source: "third_party",
      externalReference: "EVENT-SALE-1001",
      requestingDepartment: "sales",
      eventId: "evt-makati",
      thirdPartyLocationId: "loc-event-makati",
      grossSalesAmount: 8640,
      lines: [{ productId: "smart-watch", quantity: 2 }],
      actor: "sales@mwell",
    });

    expect(created).toMatchObject({
      source: "third_party",
      eventId: "evt-makati",
      thirdPartyLocationId: "loc-event-makati",
      grossSalesAmount: 8640,
      currency: "PHP",
    });
  });

  it("keeps fulfillment supplies and warehouse tools out of customer demand", async () => {
    await expect(
      repo.createFulfillmentOrder({
        source: "ecommerce",
        externalReference: "SHOP-SUPPLY-1",
        lines: [{ productId: "pack-small-box", quantity: 1 }],
        actor: "sales@mwell",
      }),
    ).rejects.toThrow(/not eligible for ecommerce fulfillment/i);

    await expect(
      repo.createFulfillmentOrder({
        source: "event",
        externalReference: "EVENT-TOOL-1",
        eventId: "evt-makati",
        lines: [{ productId: "tool-cutter", quantity: 1 }],
        actor: "operations@mwell",
      }),
    ).rejects.toThrow(/not eligible for event fulfillment/i);
  });

  it("turns an approved department request into warehouse demand", async () => {
    const request = await repo.createDepartmentStockRequest({
      requestingDepartment: "marketing",
      purpose: "Doctor roadshow giveaways",
      costCenter: "CC-4100",
      requiredDate: "2026-08-01",
      expenseTreatment: "expense",
      lines: [{ productId: "doctor-token", quantity: 10 }],
      actor: "marketing@mwell",
    });
    const approved = await repo.decideDepartmentStockRequest({
      requestId: request.id,
      decision: "approved",
      actor: "marketing-head@mwell",
    });

    expect(approved.status).toBe("approved");
    expect(approved.fulfillmentOrderId).toBeTruthy();
    expect((await repo.getData()).fulfillmentOrders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "department_request",
          requestingDepartment: "marketing",
        }),
      ]),
    );
  });

  it("limits department requests to governed issue classes and expenses merchandise", async () => {
    await expect(
      repo.createDepartmentStockRequest({
        requestingDepartment: "operations",
        purpose: "Packing station replenishment",
        costCenter: "CC-1100",
        requiredDate: "2026-08-01",
        expenseTreatment: "expense",
        lines: [{ productId: "pack-small-box", quantity: 2 }],
        actor: "operations@mwell",
      }),
    ).rejects.toThrow(/SKU, merchandise, and event material/i);

    await expect(
      repo.createDepartmentStockRequest({
        requestingDepartment: "marketing",
        purpose: "Campaign giveaways",
        costCenter: "CC-4100",
        requiredDate: "2026-08-01",
        expenseTreatment: "custody",
        lines: [{ productId: "doctor-token", quantity: 2 }],
        actor: "marketing@mwell",
      }),
    ).rejects.toThrow(/merchandise.*expense/i);
  });

  it("records customer-service return cases without prematurely choosing a resolution", async () => {
    const created = await repo.createCustomerReturnCase({
      productId: "smart-watch",
      serialNumber: "SMART-WATCH-VIP001",
      defectDescription: "Display does not turn on",
      actor: "customer.service@mwell",
    });

    expect(created).toMatchObject({
      requestingDepartment: "customer_service",
      status: "submitted",
      resolution: "pending",
    });
  });

  it("requires Product ownership when activating a bundle definition", async () => {
    await expect(
      repo.createKitDefinition({
        productId: "otg-bag",
        name: "OTG Standard Set",
        components: [
          {
            productId: "smart-watch",
            quantity: 1,
            serializationPolicy: "required",
          },
        ],
        status: "active",
        ownerDepartment: "product",
        productApprovalReference: "",
        actor: "warehouse@mwell",
      }),
    ).rejects.toThrow(/approval reference/i);
    await expect(
      repo.createKitDefinition({
        productId: "otg-bag",
        name: "OTG Standard Set",
        components: [
          {
            productId: "smart-watch",
            quantity: 1,
            serializationPolicy: "required",
          },
        ],
        status: "active",
        ownerDepartment: "marketing",
        productApprovalReference: "MKT-UNAUTHORIZED-1",
        actor: "marketing@mwell",
      }),
    ).rejects.toThrow(/Product department/i);
  });

  it("completes inspected re-kit work into serialized open-box stock", async () => {
    const returnCase = await repo.createCustomerReturnCase({
      productId: "smart-watch",
      serialNumber: "SMART-WATCH-VIP001",
      defectDescription: "Packaging damaged; device passed inspection",
      actor: "customer.service@mwell",
    });
    await repo.resolveCustomerReturnCase({
      returnCaseId: returnCase.id,
      resolution: "re_kit",
      quarantineBinId: "bin-pasig-a2",
      actor: "warehouse@mwell",
    });
    const definition = await repo.createKitDefinition({
      productId: "smart-watch",
      name: "Open-box Smart Watch",
      components: [
        {
          productId: "smart-watch",
          quantity: 1,
          serializationPolicy: "required",
        },
      ],
      status: "active",
      ownerDepartment: "product",
      productApprovalReference: "PROD-OPEN-BOX-01",
      actor: "warehouse@mwell",
    });
    const work = await repo.createReKitWorkOrder({
      sourceReturnCaseId: returnCase.id,
      kitDefinitionId: definition.id,
      outputSerialNumber: "OPENBOX-SW-001",
      componentSerialNumbers: ["SMART-WATCH-VIP001"],
      condition: "open_box",
      actor: "warehouse@mwell",
    });

    const completed = await repo.completeReKitWorkOrder({
      workOrderId: work.id,
      locationId: "loc-wh",
      binId: "bin-pasig-a1",
      actor: "warehouse@mwell",
    });

    expect(completed.status).toBe("completed");
    expect((await repo.getData()).units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serialNumber: "OPENBOX-SW-001",
          locationId: "loc-wh",
          binId: "bin-pasig-a1",
          status: "in_stock",
        }),
      ]),
    );
    expect((await repo.getData()).movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "re_kit",
          serialNumber: "OPENBOX-SW-001",
          reference: work.id,
        }),
      ]),
    );
  });
});
