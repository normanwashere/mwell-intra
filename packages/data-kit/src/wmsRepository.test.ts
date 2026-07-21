import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "./inMemoryRepository";
import { buildSeed } from "./seed";

let repo: InMemoryRepository;

beforeEach(() => {
  repo = new InMemoryRepository(buildSeed(), {
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
      actor: "warehouse@mwell",
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
      costCenter: "MKT-100",
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

  it("limits department requests to SKU or merchandise and expenses merchandise", async () => {
    await expect(
      repo.createDepartmentStockRequest({
        requestingDepartment: "operations",
        purpose: "Packing station replenishment",
        costCenter: "OPS-100",
        requiredDate: "2026-08-01",
        expenseTreatment: "expense",
        lines: [{ productId: "pack-small-box", quantity: 2 }],
        actor: "operations@mwell",
      }),
    ).rejects.toThrow(/SKU and merchandise/i);

    await expect(
      repo.createDepartmentStockRequest({
        requestingDepartment: "marketing",
        purpose: "Campaign giveaways",
        costCenter: "MKT-100",
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
