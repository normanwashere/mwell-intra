import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CycleCountRejectedError } from '../cycleCountOutcome';
import { SupabaseRepository } from './SupabaseRepository';

const input = {
  cycleCountId: 'cc-outcome-test', idempotencyKey: 'atomic-count-outcome-test',
  actor: 'counter', requesterId: 'counter', locationId: 'warehouse',
  lines: [{ productId: 'bulk', expected: 3, counted: 2 }],
  reason: 'Physical count', evidenceUrls: ['synthetic/count.jpg'],
};

it('preserves the server PWC01 rollback receipt only from the returned count RPC response', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PWC01', message: 'Lots changed' }, status: 400 });
  const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
  await expect(repo.createAndSubmitCycleCount(input)).rejects.toBeInstanceOf(CycleCountRejectedError);
  await expect(repo.createAndSubmitCycleCount(input)).rejects.toMatchObject({ code: 'PWC01', status: 400, message: 'Lots changed' });
  expect(rpc).toHaveBeenCalledWith('create_and_submit_cycle_count', { payload: {
    idempotency_key: input.idempotencyKey, cycle_count: {
      id: input.cycleCountId, location_id: input.locationId, bin_id: null, category: null, lines: input.lines,
    }, reason: input.reason, evidence_urls: input.evidenceUrls,
  } });
});

it.each([
  { code: 'P0001', status: 400 }, { code: '23514', status: 400 }, { code: '23505', status: 409 },
  { code: '42501', status: 403 }, { code: 'PWC01', status: 500 }, { code: 'PWC01', status: 504 },
  { code: 'PWC01', status: undefined }, { code: 'PGRST000', status: 503 },
])('keeps $code / $status uncertain and retains diagnostics', async ({ code, status }) => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: 'Result unavailable' }, status });
  const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
  await expect(repo.createAndSubmitCycleCount(input)).rejects.not.toBeInstanceOf(CycleCountRejectedError);
  await expect(repo.createAndSubmitCycleCount(input)).rejects.toMatchObject({ code, status, message: 'Result unavailable' });
});

it('never promotes thrown transport or response-mapping errors into rollback receipts', async () => {
  const rpc = vi.fn().mockRejectedValue(Object.assign(new Error('Transport failed'), { code: 'PWC01', status: 400 }));
  const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
  await expect(repo.createAndSubmitCycleCount(input)).rejects.not.toBeInstanceOf(CycleCountRejectedError);
  rpc.mockResolvedValue({ data: null, error: null, status: 200 });
  await expect(repo.createAndSubmitCycleCount(input)).rejects.not.toBeInstanceOf(CycleCountRejectedError);
});
