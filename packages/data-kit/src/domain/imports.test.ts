import { describe, expect, it } from 'vitest';
import { validateImportRows } from './imports';

const locationRow = {
  template_version: '1', location_external_id: 'LOC-PASIG',
  location_name: 'Pasig Main Warehouse', location_type: 'warehouse',
  bin_code: 'GEN-001', bin_label: 'General', zone: 'General', active: 'true',
};
const productRow = {
  template_version: '1', sku: 'SKU-1', product_name: 'Product One',
  category: 'merchandise', serialized: 'false', unit_cost: '100.00',
  reorder_point: '10', location_external_id: 'LOC-PASIG', bin_code: 'GEN-001',
  quantity: '25', serial_number: '',
};

describe('warehouse import validation', () => {
  it('normalizes an exact locations/bins v1 row and reconciles counts', () => {
    const result = validateImportRows('locations_bins_v1', [locationRow]);
    expect(result).toMatchObject({ sourceRows: 1, acceptedRows: 1, rejectedRows: 0, duplicateRows: 0 });
    expect(result.normalizedRows[0]).toMatchObject({ active: true, locationExternalId: 'LOC-PASIG' });
    expect(result.sourceRows).toBe(result.acceptedRows + result.rejectedRows + result.duplicateRows);
  });

  it('rejects the whole batch for wrong headers or a stale version', () => {
    const wrongHeader = validateImportRows('locations_bins_v1', [{ ...locationRow, extra: 'x' }]);
    expect(wrongHeader.acceptedRows).toBe(0);
    expect(wrongHeader.issues.some((issue) => issue.code === 'invalid_headers')).toBe(true);
    const stale = validateImportRows('locations_bins_v1', [{ ...locationRow, template_version: '0' }]);
    expect(stale.rejectedRows).toBe(1);
    expect(stale.issues.some((issue) => issue.code === 'stale_version')).toBe(true);
  });

  it('detects duplicate bin keys and duplicate serialized numbers', () => {
    const bins = validateImportRows('locations_bins_v1', [locationRow, { ...locationRow }]);
    expect(bins.duplicateRows).toBe(1);
    const serialized = { ...productRow, serialized: 'true', quantity: '1', serial_number: 'SN-001' };
    const products = validateImportRows('products_opening_stock_v1', [
      serialized,
      { ...serialized, location_external_id: 'LOC-CEBU' },
    ], { knownLocationIds: ['LOC-PASIG', 'LOC-CEBU'], knownBinKeys: ['LOC-PASIG|GEN-001', 'LOC-CEBU|GEN-001'] });
    expect(products.duplicateRows).toBe(1);
  });

  it('reports unknown parents, invalid enums, and negative values by row', () => {
    const result = validateImportRows('products_opening_stock_v1', [{
      ...productRow, category: 'food', unit_cost: '-1', quantity: '-2',
      location_external_id: 'MISSING', bin_code: 'NONE',
    }], { knownLocationIds: [], knownBinKeys: [] });
    expect(result.rejectedRows).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'invalid_enum', 'negative_number', 'unknown_parent',
    ]));
  });

  it('rejects formula-leading text while allowing validated numeric syntax', () => {
    const result = validateImportRows('products_opening_stock_v1', [{
      ...productRow, product_name: '=HYPERLINK("bad")', unit_cost: '+100.00',
    }], { knownLocationIds: ['LOC-PASIG'], knownBinKeys: ['LOC-PASIG|GEN-001'] });
    expect(result.rejectedRows).toBe(1);
    expect(result.issues.some((issue) => issue.code === 'unsafe_formula')).toBe(true);
  });

  it('enforces the 10,000 row cap', () => {
    const rows = Array.from({ length: 10_001 }, (_, index) => ({
      ...locationRow, bin_code: `BIN-${index}`,
    }));
    const result = validateImportRows('locations_bins_v1', rows);
    expect(result.acceptedRows).toBe(0);
    expect(result.issues.some((issue) => issue.code === 'row_limit')).toBe(true);
  });
});
