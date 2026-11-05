import type { SupabaseClient } from '@supabase/supabase-js';

export async function allocationReturnRemaining(client: SupabaseClient<Record<string, unknown>, string>, allocationId: string): Promise<number> {
  const { data, error } = await client.schema('warehouse').rpc('allocation_return_balance', {
    p_allocation_id: allocationId,
  });
  const quantities = [data?.issued_units, data?.returned_units, data?.remaining_units];
  if (error || data?.allocation_id !== allocationId ||
    !quantities.every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    data.returned_units + data.remaining_units > data.issued_units) {
    throw new Error('Allocation return balance unavailable');
  }
  return data.remaining_units;
}
