import { describe, expect, it } from "vitest";
import { buildSeed } from "@intra/data-kit";
import { isStockQuantity, resolveProductScan } from "./productScan";

describe("product-code quantity capture", () => {
  it("accepts only positive safe whole quantities", () => {
    for (const value of [1, 10, 1000]) expect(isStockQuantity(value)).toBe(true);
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(isStockQuantity(value)).toBe(false);
  });
  it("rejects unknown and ambiguous codes without guessing a variant", () => {
    const base = buildSeed().products[0]!;
    const products = [{ ...base, id: "small", sku: "JACKET-S", barcode: "SMALL" }, { ...base, id: "medium", sku: "JACKET-M", barcode: "MEDIUM" }];
    expect(resolveProductScan(products, " SMALL ")?.id).toBe("small");
    expect(resolveProductScan(products, "JACKET-M")?.id).toBe("medium");
    expect(resolveProductScan(products, "JACKET")).toBeUndefined();
    expect(resolveProductScan(products, "")).toBeUndefined();
    expect(resolveProductScan([...products, { ...products[1]!, barcode: "SMALL" }], "SMALL")).toBeUndefined();
  });
});
