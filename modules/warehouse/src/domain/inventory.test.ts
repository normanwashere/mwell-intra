import { describe, it, expect } from 'vitest';
import { groupProductsByFamily, variantLabel } from './inventory';
import type { Product } from './types';

function device(id: string, deviceType: Product['deviceType'], ringSize?: string): Product {
  return {
    id,
    sku: id.toUpperCase(),
    name: `${deviceType} ${ringSize ?? ''}`.trim(),
    category: 'device',
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
    category: 'merchandise',
    merchandiseType: 'shirt',
    serialized: false,
    attributes: { size },
    unitCost: 200,
    reorderPoint: 10,
  };
}

describe('groupProductsByFamily', () => {
  it('groups all ECG ring sizes under one family, sorted by ring size', () => {
    const products = [
      device('ecg-ring-10', 'ecg_ring', '10'),
      device('ecg-ring-6', 'ecg_ring', '6'),
      device('ecg-ring-8', 'ecg_ring', '8'),
    ];
    const families = groupProductsByFamily(products);
    expect(families).toHaveLength(1);
    const family = families[0];
    expect(family).toBeDefined();
    expect(family!.label).toBe('ECG Ring');
    expect(family!.variants.map((v) => v.attributes.ringSize)).toEqual([
      '6',
      '8',
      '10',
    ]);
  });

  it('keeps single-product lines as their own one-variant family', () => {
    const families = groupProductsByFamily([device('otg', 'otg_bag')]);
    expect(families).toHaveLength(1);
    const family = families[0];
    expect(family).toBeDefined();
    expect(family!.variants).toHaveLength(1);
    expect(family!.label).toBe('On-The-Go Bag');
  });

  it('orders apparel sizes S, M, L, XL and separates families', () => {
    const families = groupProductsByFamily([
      shirt('XL'),
      shirt('S'),
      shirt('L'),
      shirt('M'),
      device('watch', 'smart_watch'),
    ]);
    const shirtFam = families.find((f) => f.label === 'Event Shirt')!;
    expect(shirtFam.variants.map((v) => v.attributes.size)).toEqual([
      'S',
      'M',
      'L',
      'XL',
    ]);
    expect(families.some((f) => f.label === 'mWellness Smart Watch')).toBe(true);
  });
});

describe('variantLabel', () => {
  it('renders the size label or Standard', () => {
    expect(variantLabel(device('ecg-ring-6', 'ecg_ring', '6'))).toBe('Size 6');
    expect(variantLabel(device('otg', 'otg_bag'))).toBe('Standard');
  });
});
