import { act, render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import * as dataKit from '@intra/data-kit';
import { ToastProvider } from '@/components/ui';
import { makeRepo } from '@/test/renderWithProviders';
import { useWarehouse, WarehouseProvider } from './store';

const single = { idempotencyKey: 'inspection-store-outcome', sourceType: 'receipt' as const, sourceId: 'receipt', productId: 'device', quantity: 1, disposition: 'accepted' as const };
const batch = { ...single, evidenceUrls: ['stored/photo.jpg'], items: [single] };
const kinds = ['single', 'batch'] as const;
async function setup(kind: typeof kinds[number], allowed = true) {
  const repo = makeRepo();
  const save = kind === 'single' ? vi.spyOn(repo, 'inspectQuality') : vi.spyOn(repo, 'inspectQualityBatch');
  let api!: ReturnType<typeof useWarehouse>;
  function Probe() { api = useWarehouse(); return null; }
  render(<ToastProvider><WarehouseProvider repo={repo} source="supabase" actor="inspector" capabilities={allowed ? ['inspect_quality'] : []}><Probe /></WarehouseProvider></ToastProvider>);
  await waitFor(() => expect(api.loading).toBe(false));
  expect(typeof api.submitQualityInspection).toBe('function');
  expect(typeof api.submitQualityBatch).toBe('function');
  return { repo, save, api, submit: () => kind === 'single' ? api.submitQualityInspection(single) : api.submitQualityBatch(batch) };
}

it.each(kinds)('returns not-sent for a local %s capability denial without calling the repository', async kind => {
  const { save, submit } = await setup(kind, false);
  let result;
  await act(async () => { result = await submit(); });
  expect(result).toMatchObject({ status: 'rejected', stage: 'not-sent' });
  expect(save).not.toHaveBeenCalled();
});

it.each(kinds)('distinguishes a typed %s rejection from unknown errors without inferring earlier-attempt state', async kind => {
  const { save, submit } = await setup(kind);
  save.mockRejectedValueOnce(new Error('Response lost'))
    .mockRejectedValueOnce(new dataKit.InspectionRejectedError('Permission revoked', '42501'))
    .mockRejectedValueOnce(Object.assign(new Error('Unknown returned error'), { code: '42501' }));
  const results: unknown[] = [];
  await act(async () => { for (let i = 0; i < 3; i++) results.push(await submit()); });
  expect(results).toEqual([
    { status: 'uncertain', message: 'Response lost' },
    { status: 'rejected', code: '42501', message: 'Permission revoked', stage: 'rolled-back' },
    { status: 'uncertain', message: 'Unknown returned error' },
  ]);
});

it.each(kinds)('keeps a confirmed %s commit committed even when the subsequent refresh fails', async kind => {
  const { repo, save, submit } = await setup(kind);
  save.mockResolvedValue({} as never);
  vi.spyOn(repo, 'getData').mockRejectedValue(new Error('Refresh unavailable'));
  let result;
  await act(async () => { result = await submit(); });
  expect(result).toEqual({ status: 'committed' });
});
