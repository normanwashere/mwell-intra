import type { ItemCategory, Product } from './types';

export interface ProductFamily {
  key: string;
  label: string;
  category: ItemCategory;
  /** Variants (e.g. sizes) belonging to this family, sorted by size. */
  variants: Product[];
}

const DEVICE_LABEL: Record<string, string> = {
  ecg_ring: 'ECG Ring',
  sleep_ring: 'Sleep Ring',
  smart_watch: 'mWellness Smart Watch',
  otg_bag: 'On-The-Go Bag',
};

const MERCH_LABEL: Record<string, string> = {
  shirt: 'Event Shirt',
  jacket: 'Event Jacket',
  token: 'Doctor Token',
  kit: 'Kit',
  other: 'Merchandise',
};

const APPAREL_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export function familyKey(p: Product): string {
  if (p.category === 'device') return `device:${p.deviceType ?? p.id}`;
  return `merch:${p.merchandiseType ?? p.id}`;
}

export function familyLabel(p: Product): string {
  if (p.category === 'device') return DEVICE_LABEL[p.deviceType ?? ''] ?? p.name;
  return MERCH_LABEL[p.merchandiseType ?? ''] ?? p.name;
}

/** The distinguishing variant attribute value (ring size / apparel size), if any. */
export function variantSize(p: Product): string | undefined {
  return p.attributes.ringSize ?? p.attributes.size;
}

export function variantLabel(p: Product): string {
  const size = variantSize(p);
  return size !== undefined ? `Size ${size}` : 'Standard';
}

function sizeRank(p: Product): number {
  const ring = p.attributes.ringSize;
  if (ring !== undefined) return Number(ring);
  const size = p.attributes.size;
  if (size !== undefined) {
    const idx = APPAREL_ORDER.indexOf(size);
    return idx === -1 ? 999 : idx;
  }
  return 0;
}

/**
 * Groups products into families (e.g. all ECG Ring sizes under one "ECG Ring"),
 * with single-product lines remaining as their own one-variant family.
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
        variants: [p],
      });
  }
  const families = [...map.values()];
  for (const fam of families) {
    fam.variants.sort((a, b) => sizeRank(a) - sizeRank(b) || a.name.localeCompare(b.name));
  }
  families.sort((a, b) => a.label.localeCompare(b.label));
  return families;
}
