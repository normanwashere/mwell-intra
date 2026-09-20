import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './SupabaseRepository';

it('sends a single bounded RPC with each exact custody identity and rejects incomplete confirmation', async () => {
  const item = {sourceType:'receipt' as const,sourceId:'receipt',productId:'device',procurementPoLineId:'line',
    binId:'bin',lotId:'lot',quantity:1,serialNumber:'S1'};
  const input = {idempotencyKey:'quality-batch-wire-01',disposition:'accepted' as const,evidenceUrls:['stored/photo.jpg'],items:[item,{...item,serialNumber:'S2'}]};
  const rpc = vi.fn().mockResolvedValue({data:{inspections:['S1','S2'].map((serial_number,i)=>({id:`i-${i}`,source_type:'receipt',
    source_id:'receipt',product_id:'device',procurement_po_line_id:'line',bin_id:'bin',lot_id:'lot',serial_number,quantity:1,
    disposition:'accepted',evidence_urls:input.evidenceUrls,inspected_at:'2026-09-20',inspected_by:'inspector'}))},error:null});
  const repo = new SupabaseRepository({rpc} as unknown as SupabaseClient);
  expect(await repo.inspectQualityBatch(input)).toEqual([
    expect.objectContaining({serialNumber:'S1',lotId:'lot',procurementPoLineId:'line'}),
    expect.objectContaining({serialNumber:'S2',lotId:'lot',procurementPoLineId:'line'}),
  ]);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('inspect_quality_batch',{payload:expect.objectContaining({
    idempotency_key:input.idempotencyKey,items:[expect.objectContaining({serial_number:'S1',procurement_po_line_id:'line',lot_id:'lot'}),
      expect.objectContaining({serial_number:'S2',procurement_po_line_id:'line',lot_id:'lot'})],
  })});
  await expect(repo.inspectQualityBatch({...input,items:[item,{...item,binId:'other'}]})).rejects.toThrow(/same source/);
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockResolvedValue({data:{inspections:[]},error:null});
  await expect(repo.inspectQualityBatch(input)).rejects.toThrow(/confirmation is incomplete/);
});
