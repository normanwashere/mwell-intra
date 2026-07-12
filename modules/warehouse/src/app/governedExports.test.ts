import { describe, expect, it, vi } from 'vitest';
import { prepareWarehouseExport } from './governedExports';

describe('prepareWarehouseExport', () => {
  it('labels local-only demo CSVs', async () => {
    await expect(
      prepareWarehouseExport({
        source: 'memory',
        kind: 'inventory',
        demoContent: 'sku\nABC',
      }),
    ).resolves.toEqual({
      filename: 'demo-inventory.csv',
      demoContent: 'sku\nABC',
    });
  });

  it('requests a governed signed export in live mode', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          job: { filename: 'mwell-intra-inventory-20260710T043015Z.csv' },
          download_url: 'https://example.test/signed',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(
      prepareWarehouseExport({
        source: 'supabase',
        kind: 'inventory',
        demoContent: 'ignored',
        request,
      }),
    ).resolves.toEqual({
      filename: 'mwell-intra-inventory-20260710T043015Z.csv',
      downloadUrl: 'https://example.test/signed',
    });
    expect(request).toHaveBeenCalledWith('/api/warehouse/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'inventory' }),
    });
  });

  it('surfaces a controlled API error', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not authorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(
      prepareWarehouseExport({
        source: 'supabase',
        kind: 'movements',
        demoContent: '',
        request,
      }),
    ).rejects.toThrow('Not authorized');
  });
});
