import { describe, expect, it } from "vitest";
import type { CreateProductInput } from "../repository";
import { buildNewProduct } from "./products";

const input = (
  patch: Partial<CreateProductInput> = {},
): CreateProductInput => ({
  sku: "SKU-1",
  name: "Tablet",
  category: "device",
  itemClass: "sellable_sku",
  serialized: false,
  unitCost: 1,
  reorderPoint: 1,
  actor: "product@mwell",
  ...patch,
});

describe("product WMS classification", () => {
  it("enforces serialization for sellable and re-kitted items", () => {
    expect(buildNewProduct("p1", input(), []).serialized).toBe(true);
    expect(
      buildNewProduct(
        "p2",
        input({ sku: "RK-1", itemClass: "re_kitted_item" }),
        [],
      ).serialized,
    ).toBe(true);
  });

  it("keeps fulfillment supplies non-serialized", () => {
    const product = buildNewProduct(
      "p1",
      input({
        category: "merchandise",
        itemClass: "fulfillment_supply",
        serialized: true,
      }),
      [],
    );
    expect(product.serialized).toBe(false);
    expect(product.itemClass).toBe("fulfillment_supply");
  });
});
