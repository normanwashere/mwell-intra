import { describe, expect, it } from 'vitest';
import { filterFinanceActivity, scopeFinanceData, summarizeFinanceData } from './data';
import { FINANCE_DEMO_DATA } from './seed';

describe('summarizeFinanceData', () => {
  it('summarizes commitments, receipts, returns, and review states', () => {
    expect(summarizeFinanceData(FINANCE_DEMO_DATA)).toEqual({
      inventoryValue: 1_284_750,
      committedValue: 590_500,
      receivedValue: 287_250,
      returnedValue: 18_750,
      netWarehouseValue: 268_500,
      reviewCount: 1,
      returnedCount: 1,
      acceptedCount: 0,
    });
  });
});

describe('filterFinanceActivity', () => {
  it('keeps each source family distinct', () => {
    expect(filterFinanceActivity(FINANCE_DEMO_DATA.activity, 'procurement')).toHaveLength(2);
    expect(filterFinanceActivity(FINANCE_DEMO_DATA.activity, 'receipts')).toHaveLength(1);
    expect(filterFinanceActivity(FINANCE_DEMO_DATA.activity, 'returns')).toHaveLength(1);
    expect(filterFinanceActivity(FINANCE_DEMO_DATA.activity, 'all')).toHaveLength(4);
  });
});

describe('scopeFinanceData', () => {
  it('keeps Procurement and Warehouse data within their assigned Finance scope', () => {
    const procurement = scopeFinanceData(FINANCE_DEMO_DATA, {
      procurement: true,
      warehouse: false,
    });
    expect(procurement.activity.every((item) => item.source === 'procurement_po')).toBe(true);
    expect(procurement.payments.length).toBeGreaterThan(0);
    expect(procurement.inventoryValue).toBe(0);

    const warehouse = scopeFinanceData(FINANCE_DEMO_DATA, {
      procurement: false,
      warehouse: true,
    });
    expect(warehouse.activity.every((item) => item.source !== 'procurement_po')).toBe(true);
    expect(warehouse.payments).toEqual([]);
    expect(warehouse.inventoryValue).toBe(FINANCE_DEMO_DATA.inventoryValue);
  });
});
