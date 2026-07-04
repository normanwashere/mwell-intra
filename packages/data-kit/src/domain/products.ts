import type { Product } from './types';
// Adaptation note (Step 1d): the source imported these DTOs from `@/data/repository`.
// Inside data-kit the repository port lives one level up at `../repository`.
import type { CreateProductInput, ProductPatch } from '../repository';

/**
 * Validate and normalise a new product master record (shared by both repository
 * adapters so create behaviour stays at parity).
 */
export function buildNewProduct(
  id: string,
  input: CreateProductInput,
  existing: Product[],
): Product {
  const sku = input.sku.trim();
  const name = input.name.trim();
  if (!sku) throw new Error('SKU is required.');
  if (!name) throw new Error('Name is required.');
  if (existing.some((p) => p.sku.toLowerCase() === sku.toLowerCase())) {
    throw new Error(`SKU "${sku}" already exists.`);
  }
  if (Number.isNaN(input.unitCost) || input.unitCost < 0) {
    throw new Error('Unit cost must be zero or more.');
  }
  if (Number.isNaN(input.reorderPoint) || input.reorderPoint < 0) {
    throw new Error('Reorder point must be zero or more.');
  }
  return {
    id,
    sku,
    name,
    category: input.category,
    deviceType: input.category === 'device' ? input.deviceType : undefined,
    merchandiseType:
      input.category === 'merchandise' ? input.merchandiseType : undefined,
    serialized: input.serialized,
    attributes: input.attributes ?? {},
    unitCost: input.unitCost,
    price: input.price,
    reorderPoint: input.reorderPoint,
    promotional: input.promotional,
    barcode: input.barcode?.trim() || undefined,
  };
}

/**
 * Apply an editable-field patch to a product, returning the next product.
 * Throws on invalid values. Pure — callers persist the result.
 */
export function applyProductPatch(product: Product, patch: ProductPatch): Product {
  const next: Product = { ...product };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error('Name is required.');
    next.name = patch.name.trim();
  }
  if (patch.unitCost !== undefined) {
    if (Number.isNaN(patch.unitCost) || patch.unitCost < 0) {
      throw new Error('Unit cost must be zero or more.');
    }
    next.unitCost = patch.unitCost;
  }
  if (patch.reorderPoint !== undefined) {
    if (Number.isNaN(patch.reorderPoint) || patch.reorderPoint < 0) {
      throw new Error('Reorder point must be zero or more.');
    }
    next.reorderPoint = patch.reorderPoint;
  }
  if (patch.price !== undefined) {
    if (Number.isNaN(patch.price) || patch.price < 0) {
      throw new Error('Price must be zero or more.');
    }
    next.price = patch.price;
  }
  if (patch.barcode !== undefined) {
    next.barcode = patch.barcode.trim() || undefined;
  }
  if (patch.promotional !== undefined) next.promotional = patch.promotional;
  if (patch.attributes !== undefined) next.attributes = patch.attributes;
  return next;
}
