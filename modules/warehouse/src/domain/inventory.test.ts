import { describe, it, expect } from "vitest";
import {
  groupProductsByFamily,
  inventoryCategory,
  variantLabel,
} from "./inventory";
import type { Product } from "./types";

function device(
  id: string,
  deviceType: Product["deviceType"],
  ringSize?: string,
): Product {
  return {
    id,
    sku: id.toUpperCase(),
    name: ringSize ? `ECG Ring (Size ${ringSize})` : id,
    category: "device",
    deviceType,
    serialized: true,
    attributes: ringSize ? { ringSize } : {},
    unitCost: 1000,
    reorderPoint: 5,
  };
}

function shirt(size: string): Product {
  return {
    id: `shirt-${size.toLowerCase()}`,
    sku: `SHIRT-${size}`,
    name: `Event Shirt (${size})`,
    category: "merchandise",
    merchandiseType: "shirt",
    serialized: false,
    attributes: { size },
    unitCost: 200,
    reorderPoint: 10,
  };
}

describe("groupProductsByFamily", () => {
  it("groups exact name-and-SKU size variants, sorted by ring size", () => {
    const products = [
      device("ecg-ring-10", "ecg_ring", "10"),
      device("ecg-ring-6", "ecg_ring", "6"),
      device("ecg-ring-8", "ecg_ring", "8"),
    ];
    const families = groupProductsByFamily(products);
    expect(families).toHaveLength(1);
    const family = families[0];
    expect(family).toBeDefined();
    expect(family!.label).toBe("ECG Ring");
    expect(family!.variants.map((v) => v.attributes.ringSize)).toEqual([
      "6",
      "8",
      "10",
    ]);
  });

  it("keeps single-product lines as their own one-variant family", () => {
    const families = groupProductsByFamily([device("otg", "otg_bag")]);
    expect(families).toHaveLength(1);
    const family = families[0];
    expect(family).toBeDefined();
    expect(family!.variants).toHaveLength(1);
    expect(family!.label).toBe("otg");
  });

  it("orders apparel sizes S, M, L, XL and separates families", () => {
    const families = groupProductsByFamily([
      shirt("XL"),
      shirt("S"),
      shirt("L"),
      shirt("M"),
      device("watch", "smart_watch"),
    ]);
    const shirtFam = families.find((f) => f.label === "Event Shirt")!;
    expect(shirtFam.variants.map((v) => v.attributes.size)).toEqual([
      "S",
      "M",
      "L",
      "XL",
    ]);
    expect(families.some((f) => f.label === "watch")).toBe(true);
  });

  it("never groups unrelated other merchandise or smart watches by type", () => {
    const products = [
      {
        ...shirt("M"),
        id: "mug",
        name: "Ceramic Mug",
        sku: "MUG",
        merchandiseType: "other" as const,
      },
      {
        ...shirt("M"),
        id: "pen",
        name: "Pen",
        sku: "PEN",
        merchandiseType: "other" as const,
      },
      device("Watch Pro", "smart_watch"),
      device("Watch Lite", "smart_watch"),
    ];
    const families = groupProductsByFamily(products);
    expect(families).toHaveLength(4);
    expect(families.every((family) => family.variants.length === 1)).toBe(true);
    expect(families.map((family) => family.label)).toEqual([
      "Ceramic Mug",
      "Pen",
      "Watch Lite",
      "Watch Pro",
    ]);
  });

  it("groups explicit color variants without changing product identity or stock fields", () => {
    const products = ["Black", "Silver"].map((color) => ({
      ...device(`watch-${color}`, "smart_watch"),
      name: `Watch Pro ${color}`,
      attributes: {
        category: "Watches",
        familyId: "watch-pro",
        familyName: "Watch Pro",
        color,
      },
    }));
    const before = structuredClone(products);
    const families = groupProductsByFamily(products);
    expect(families).toHaveLength(1);
    expect(families[0]).toMatchObject({
      label: "Watch Pro",
      browseCategory: "watches",
    });
    expect(families[0]!.variants).toEqual(products);
    expect(products).toEqual(before);
  });

  it("keeps families apart across browsing categories and operational classes", () => {
    const base = {
      ...shirt("S"),
      attributes: {
        familyKey: "same",
        familyName: "Same",
        category: "Merchandise",
      },
    };
    expect(
      groupProductsByFamily([
        base,
        {
          ...base,
          id: "accessory",
          attributes: { ...base.attributes, category: "Accessories" },
        },
        { ...base, id: "tool", itemClass: "warehouse_tool" },
      ]),
    ).toHaveLength(3);
  });

  it("does not infer a family from names, size alone, or mismatched name/SKU suffixes", () => {
    const base = shirt("M");
    const unrelated: Product[] = [
      {
        ...base,
        id: "other-model",
        sku: "PRO-SHIRT-L",
        name: "Event Shirt (L)",
        attributes: { size: "L" },
      },
      {
        ...base,
        id: "other-name",
        sku: "SHIRT-L",
        name: "Staff Shirt (L)",
        attributes: { size: "L" },
      },
      {
        ...base,
        id: "other-color",
        sku: "SHIRT-S",
        name: "Event Shirt (S)",
        attributes: { size: "S", color: "Red" },
      },
      {
        ...base,
        id: "bad-size",
        sku: "SHIRT-XL",
        name: "Event Shirt (XL)",
        attributes: { size: "S" },
      },
      { ...base, id: "same-name", sku: "DUPLICATE", attributes: {} },
    ];
    expect(groupProductsByFamily([base, ...unrelated])).toHaveLength(6);
  });

  it("does not use category-like family labels without an explicit identifier", () => {
    const products = ["Mug", "Pen"].map((name) => ({
      ...shirt("M"),
      id: name,
      name,
      attributes: { familyName: "Merchandise" },
    }));
    expect(groupProductsByFamily(products)).toHaveLength(2);
  });
});

describe("inventoryCategory", () => {
  it.each([
    [{ category: "Devices", Subcategory: " Watches " }, "watches"],
    [{ Category: "Rings" }, "rings"],
    [{ sourceCategory: "Accessories" }, "accessories"],
    [{ "Source category": "Merch", Subcategory: "Apparel" }, "merchandise"],
    [{ "Source category": "Merch", Subcategory: "Accessories" }, "merchandise"],
    [{ "Source category": "OTG", Subcategory: "Packaging" }, "otg"],
    [{ Category: "Merch", sourceSubcategory: "Accessories" }, "merchandise"],
    [{ "Source category": "Unknown", Subcategory: "Packaging" }, "packaging"],
    [{ "Source category": "", Subcategory: "Accessories" }, "accessories"],
    [{ "Source category": "HPG" }, "healthpass"],
    [{ category: "Merchandise", Subcategory: "Shirts" }, "merchandise"],
    [{ source_category: "OTG" }, "otg"],
    [{ category: "Packaging" }, "packaging"],
    [{ category: "HealthPass" }, "healthpass"],
    [{ subcategory: "Rings" }, "rings"],
    [{ category: "Unrecognized" }, "uncategorized"],
    [{ category: "constructor" }, "uncategorized"],
    [{ category: " ", Subcategory: "" }, "uncategorized"],
    [{}, "uncategorized"],
  ] as const)(
    "maps source attributes %j to %s without relying on operational type",
    (attributes, expected) => {
      expect(
        inventoryCategory({ ...device("watch", "smart_watch"), attributes }),
      ).toBe(expected);
    },
  );
});

describe("variantLabel", () => {
  it("renders the size label or Standard", () => {
    expect(variantLabel(device("ecg-ring-6", "ecg_ring", "6"))).toBe("Size 6");
    expect(variantLabel(device("otg", "otg_bag"))).toBe("Standard");
  });

  it("includes color and source Size without mislabeling every variant as a size", () => {
    expect(
      variantLabel({ ...shirt("M"), attributes: { Size: "M", Color: "Blue" } }),
    ).toBe("Size M / Blue");
    expect(
      variantLabel({
        ...device("watch", "smart_watch"),
        attributes: { color: "Black" },
      }),
    ).toBe("Black");
    expect(
      variantLabel({ ...shirt("M"), attributes: { size: " ", color: "" } }),
    ).toBe("Standard");
  });
});
