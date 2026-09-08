import type { Product } from "./types";

export function resolveProductScan(products: Product[], code: string): Product | undefined {
  const value = code.trim();
  if (!value) return undefined;
  const matches = products.filter((product) => product.barcode === value || product.sku === value);
  return matches.length === 1 ? matches[0] : undefined;
}

export function isStockQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
