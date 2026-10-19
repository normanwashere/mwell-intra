import type { ItemCategory, Product } from "./types";

export const INVENTORY_CATEGORIES = [
  { value: "watches", label: "Watches" },
  { value: "rings", label: "Rings" },
  { value: "accessories", label: "Accessories" },
  { value: "merchandise", label: "Merchandise" },
  { value: "otg", label: "OTG" },
  { value: "packaging", label: "Packaging" },
  { value: "healthpass", label: "HealthPass" },
  { value: "uncategorized", label: "Needs categorization" },
] as const;

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]["value"];

export interface ProductFamily {
  key: string;
  label: string;
  category: ItemCategory;
  browseCategory: InventoryCategory;
  /** Genuine variants, sorted by size then product identity. */
  variants: Product[];
}

const SOURCE_CATEGORIES: Record<string, InventoryCategory> = {
  watch: "watches",
  watches: "watches",
  smartwatch: "watches",
  smartwatches: "watches",
  ring: "rings",
  rings: "rings",
  ecgring: "rings",
  sleepring: "rings",
  accessory: "accessories",
  accessories: "accessories",
  merch: "merchandise",
  merchandise: "merchandise",
  otg: "otg",
  otgbag: "otg",
  onthego: "otg",
  packaging: "packaging",
  healthpass: "healthpass",
  hpg: "healthpass",
};

const APPAREL_ORDER = ["XS", "S", "M", "L", "XL", "XXL"];

function normalized(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function attribute(p: Product, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = Object.entries(p.attributes)
      .find(
        ([name, value]) => normalized(name) === normalized(key) && value.trim(),
      )?.[1]
      .trim();
    if (value) return value;
  }
  return undefined;
}

/** Display taxonomy only: never infer it from operational class or serialization. */
export function inventoryCategory(p: Product): InventoryCategory {
  // Preserve recognized masterlist top-level categories before considering subcategories.
  for (const key of [
    "sourceCategory",
    "category",
    "sourceSubcategory",
    "subcategory",
  ]) {
    const value = attribute(p, key);
    const category =
      value && Object.hasOwn(SOURCE_CATEGORIES, normalized(value))
        ? SOURCE_CATEGORIES[normalized(value)]
        : undefined;
    if (category) return category;
  }
  return "uncategorized";
}

function explicitFamily(p: Product): string | undefined {
  return attribute(p, "familyId", "familyKey");
}

/**
 * Legacy exact-size contract: BOTH "Name (Size X)" / "Name (X)" and "SKU-X"
 * must end in the recorded size. The remaining name, SKU prefix and every
 * non-size attribute must match. No stripping arbitrary words, colors or models.
 * Other variants require attributes.familyId / familyKey (optional familyName).
 */
function exactSizeFamily(
  p: Product,
): { name: string; sku: string } | undefined {
  const size = variantSize(p);
  if (!size) return undefined;
  const suffix = [` (Size ${size})`, ` (${size})`].find((suffix) =>
    p.name.endsWith(suffix),
  );
  const skuSuffix = `-${size}`;
  if (!suffix || !p.sku.endsWith(skuSuffix)) return undefined;
  const name = p.name.slice(0, -suffix.length);
  const sku = p.sku.slice(0, -skuSuffix.length);
  return name && sku ? { name, sku } : undefined;
}

export function familyKey(p: Product): string {
  const scope = [
    inventoryCategory(p),
    p.category,
    p.itemClass,
    p.serialized,
    p.serializationPolicy,
    p.uom,
  ];
  const explicit = explicitFamily(p);
  if (explicit) return JSON.stringify(["family", ...scope, explicit]);
  const exact = exactSizeFamily(p);
  if (exact) {
    const attributes = Object.entries(p.attributes)
      .filter(([key]) => !["size", "ringsize"].includes(normalized(key)))
      .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify([
      "size-family",
      ...scope,
      p.deviceType,
      p.merchandiseType,
      exact.name,
      exact.sku,
      attributes,
    ]);
  }
  return JSON.stringify(["product", p.id]);
}

export function familyLabel(p: Product): string {
  if (explicitFamily(p))
    return attribute(p, "familyName", "familyLabel") ?? p.name;
  return exactSizeFamily(p)?.name ?? p.name;
}

/** The distinguishing variant attribute value (ring size / apparel size), if any. */
export function variantSize(p: Product): string | undefined {
  return attribute(p, "ringSize", "size");
}

export function variantLabel(p: Product): string {
  const size = variantSize(p);
  const color = attribute(p, "color");
  return (
    [size ? `Size ${size}` : undefined, color].filter(Boolean).join(" / ") ||
    "Standard"
  );
}

function sizeRank(p: Product): number {
  const size = variantSize(p);
  if (size !== undefined) {
    if (Number.isFinite(Number(size))) return Number(size);
    const idx = APPAREL_ORDER.indexOf(size.toUpperCase());
    return idx === -1 ? 999 : idx;
  }
  return 0;
}

/**
 * Groups only explicitly identified or exact-size variants. Unrelated products
 * remain standalone, even when their operational types or names are identical.
 */
export function groupProductsByFamily(products: Product[]): ProductFamily[] {
  const map = new Map<string, ProductFamily>();
  for (const p of products) {
    const key = familyKey(p);
    const existing = map.get(key);
    if (existing) existing.variants.push(p);
    else
      map.set(key, {
        key,
        label: familyLabel(p),
        category: p.category,
        browseCategory: inventoryCategory(p),
        variants: [p],
      });
  }
  const families = [...map.values()];
  for (const fam of families) {
    fam.variants.sort(
      (a, b) => sizeRank(a) - sizeRank(b) || a.name.localeCompare(b.name),
    );
  }
  families.sort((a, b) => a.label.localeCompare(b.label));
  return families;
}
