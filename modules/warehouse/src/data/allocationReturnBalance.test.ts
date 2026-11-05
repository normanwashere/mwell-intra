import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { allocationReturnRemaining } from './allocationReturnBalance';

function clientFor(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const schema = vi.fn(() => ({ rpc }));
  return { client: { schema } as unknown as SupabaseClient<Record<string, unknown>, string>, rpc, schema };
}
const row = { allocation_id: 'owned', issued_units: 2, returned_units: 0, remaining_units: 1 };
describe('allocation return balance adapter', () => {
  it.each([0, 1, 2])('retains authoritative remaining %s without recomputing from issued', async remaining_units => {
    const { client, rpc, schema } = clientFor({ ...row, remaining_units });
    expect(await allocationReturnRemaining(client, 'owned')).toBe(remaining_units);
    expect(schema).toHaveBeenCalledWith('warehouse');
    expect(rpc).toHaveBeenCalledWith('allocation_return_balance', { p_allocation_id: 'owned' });
  });
  it.each([null, {}, [], { ...row, allocation_id: 'other' }, { ...row, remaining_units: null },
    { ...row, remaining_units: '1' }, { ...row, remaining_units: -1 }, { ...row, remaining_units: 0.5 },
    { ...row, remaining_units: Number.NaN }, { ...row, remaining_units: Infinity },
    { ...row, remaining_units: 3 }, { ...row, returned_units: 2 }, { ...row, issued_units: null },
    { ...row, returned_units: Number.MAX_SAFE_INTEGER + 1 }, { ...row, returned_units: undefined },
  ])('rejects missing, malformed or inconsistent authority %#', async data => {
    await expect(allocationReturnRemaining(clientFor(data).client, 'owned')).rejects.toThrow(/unavailable/);
  });
  it('does not use a stale payload when the RPC reports an error', async () => {
    await expect(allocationReturnRemaining(clientFor(row, { message: 'denied' }).client, 'owned')).rejects.toThrow(/unavailable/);
  });
  it('propagates transport failure without fallback', async () => {
    const { client, rpc } = clientFor(row);rpc.mockRejectedValue(new Error('offline'));
    await expect(allocationReturnRemaining(client, 'owned')).rejects.toThrow('offline');
  });
});
