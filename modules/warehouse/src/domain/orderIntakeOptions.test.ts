import { describe, expect, it } from "vitest";
import {
  cityPreset,
  fulfillmentOrdersToCsv,
  paymentStatusFor,
  trackerTemplateCsv,
} from "./orderIntakeOptions";

describe("order intake controls", () => {
  it("suggests editable delivery details from a supported city", () => {
    expect(cityPreset(" pasig ")).toEqual(
      expect.objectContaining({
        province: "Metro Manila",
        postalCode: "1600",
        area: "Metro Manila",
      }),
    );
    expect(cityPreset("Unknown municipality")).toBeUndefined();
  });

  it("derives allocation status from payment authority", () => {
    expect(paymentStatusFor("cash", "pending")).toBe("cod");
    expect(paymentStatusFor("billing", "pending")).toBe("authorized");
    expect(paymentStatusFor("online_payment", "paid")).toBe("paid");
    expect(paymentStatusFor("online_payment", "failed")).toBe("blocked");
  });

  it("provides an import template with governed tracker fields", () => {
    const csv = trackerTemplateCsv();
    expect(csv).toContain("order_reference");
    expect(csv).toContain("payment_reference");
    expect(csv).toContain("selling_price");
    expect(csv).toContain("bundle_set_codes");
    expect(csv).toContain("delivery_link");
  });

  it("exports the current fulfillment record as a tracker replacement", () => {
    const csv = fulfillmentOrdersToCsv(
      [
        {
          id: "order-1",
          source: "ecommerce",
          externalReference: "SHOP-001",
          ecommerceChannel: "Shopify",
          customerName: "Ana Reyes",
          paymentStatus: "paid",
          paymentReference: "RRN-001",
          shipmentStatus: "in_transit",
          shipmentEvents: [],
          deliveryMethod: "shipment",
          status: "released",
          lines: [
            {
              productId: "ring-8",
              quantity: 2,
              pickedQuantity: 2,
              pickedSerialNumbers: ["RING-001", "RING-002"],
              unitPrice: 5990,
              bundleSetCodes: [],
            },
          ],
          packaging: [],
          createdBy: "operations@mwell.com.ph",
          createdAt: "2026-08-21T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:00.000Z",
        },
      ],
      [
        {
          id: "ring-8",
          sku: "RING-8",
          name: "mWell Ring Size 8",
        } as never,
      ],
    );
    expect(csv).toContain("selling_price");
    expect(csv).toContain("SHOP-001");
    expect(csv).toContain("RING-8");
    expect(csv).toContain("5990");
    expect(csv).toContain("in_transit");
  });
});
