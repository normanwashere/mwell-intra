import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './supabase/SupabaseRepository';
import { rowToStockChangeRequest } from './supabase/mappers';

const row = {
  id: 'net-zero-request', source_type: 'cycle_count', source_id: 'count-lot-review',
  product_id: 'bulk', location_id: 'main', bin_id: null, quantity_delta: 0,
  unit_cost: 700, financial_impact: 0, reason: 'Offsetting lot variances', evidence_urls: [],
  status: 'pending_finance', requested_by: 'counter', requested_at: '2026-11-05T00:00:00Z', can_decide: true,
};

describe('stock-change approval exposure transport', () => {
  it.each([
    ['gross', { approval_exposure: '11200', gross_quantity: '16' }, 11200, 16],
    ['zero', { approval_exposure: 0, gross_quantity: 0, financial_impact: 700 }, 0, 0],
    ['legacy absent', {}, undefined, undefined],
    ['legacy null', { approval_exposure: null, gross_quantity: null }, undefined, undefined],
  ] as const)('maps %s exposure without replacing net valuation', (_label, fields, approvalExposure, grossQuantity) => {
    const mapped = rowToStockChangeRequest({ ...row, ...fields });
    expect(mapped).toMatchObject({ approvalExposure, grossQuantity, unitCost: 700,
      financialImpact: 'financial_impact' in fields ? 700 : 0 });
  });

  it('preserves new exposure fields from the authorized list RPC without extra scope or mutations', async () => {
    const profiles = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) };
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: { rows: [{ ...row, approval_exposure: 11200, gross_quantity: 16 }] }, error: null }),
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(profiles) }),
    };
    const repo = new SupabaseRepository(client as unknown as SupabaseClient);
    expect((await repo.listStockChangeRequests({ limit: 10, status: 'pending_finance' })).rows[0]).toMatchObject({
      approvalExposure: 11200, grossQuantity: 16, financialImpact: 0, quantityDelta: 0, unitCost: 700, canDecide: true,
    });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('list_stock_change_requests', { payload: { limit: 10, status: 'pending_finance' } });
  });
});
