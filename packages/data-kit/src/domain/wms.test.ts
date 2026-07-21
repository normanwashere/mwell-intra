import { describe, expect, it } from "vitest";
import {
  canReleaseFulfillmentOrder,
  nextFulfillmentStatus,
  requiredSerializationPolicy,
  validateDepartmentRequest,
  type FulfillmentOrder,
} from "./wms";

const order = (patch: Partial<FulfillmentOrder> = {}): FulfillmentOrder => ({
  id: "order-1",
  source: "ecommerce",
  externalReference: "SHOP-1001",
  requestingDepartment: "sales",
  status: "received",
  lines: [
    {
      productId: "tablet",
      quantity: 1,
      pickedQuantity: 0,
      pickedSerialNumbers: [],
    },
  ],
  packaging: [],
  createdBy: "sales@mwell",
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
  ...patch,
});

describe("WMS operating contracts", () => {
  it("requires per-unit serials for sellable SKUs and not for supplies", () => {
    expect(requiredSerializationPolicy("sellable_sku")).toBe("required");
    expect(requiredSerializationPolicy("fulfillment_supply")).toBe("none");
    expect(requiredSerializationPolicy("warehouse_tool")).toBe("asset_tag");
  });

  it("prevents release before every line is picked and a waybill is assigned", () => {
    expect(canReleaseFulfillmentOrder(order())).toEqual({
      ok: false,
      reason: "Every order line must be fully picked before release.",
    });

    expect(
      canReleaseFulfillmentOrder(
        order({
          status: "ready",
          courier: "LBC",
          lines: [
            {
              productId: "tablet",
              quantity: 1,
              pickedQuantity: 1,
              pickedSerialNumbers: ["TAB-001"],
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "A waybill is required before release." });
  });

  it("allows only the governed fulfillment sequence", () => {
    expect(nextFulfillmentStatus("received", "allocate")).toBe("allocated");
    expect(nextFulfillmentStatus("allocated", "start_picking")).toBe("picking");
    expect(() => nextFulfillmentStatus("received", "release")).toThrow(
      "Cannot release an order while it is received.",
    );
  });

  it("requires department, purpose, cost center, date, and at least one line", () => {
    expect(
      validateDepartmentRequest({
        requestingDepartment: "",
        purpose: "",
        costCenter: "",
        requiredDate: "",
        lines: [],
      }),
    ).toEqual([
      "Requesting department is required.",
      "Business purpose is required.",
      "Cost center is required.",
      "Required date is required.",
      "At least one stock line is required.",
    ]);
  });
});
