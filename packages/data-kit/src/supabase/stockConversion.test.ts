import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "./SupabaseRepository";
import { StockConversionRejectedError, type StockConversionCommand } from "../domain/stockConversion";

const input: StockConversionCommand = {action:"complete",batch_id:"batch",idempotency_key:"complete-conversion-001",evidence_urls:["https://evidence.test/check"]};
it("preserves caller retry key and distinguishes rolled-back database rejection from uncertain transport", async () => {
  const rpc=vi.fn().mockResolvedValueOnce({data:null,error:{message:"Held source",code:"P0001"}})
    .mockResolvedValueOnce({data:null,error:{message:"Response lost"}})
    .mockResolvedValue({data:{id:"batch",status:"completed"},error:null});
  const repo=new SupabaseRepository({rpc} as unknown as SupabaseClient);
  await expect(repo.executeStockConversion(input)).rejects.toBeInstanceOf(StockConversionRejectedError);
  await expect(repo.executeStockConversion(input)).rejects.not.toBeInstanceOf(StockConversionRejectedError);
  await expect(repo.executeStockConversion(input)).resolves.toMatchObject({status:"completed"});
  expect(rpc.mock.calls.map(call=>call[1])).toEqual(Array(3).fill({payload:input}));
});
it("uses the installed workspace payload signature without changing data", async () => {
  const workspace={recipes:[],batches:[],candidates:[],recovery_available:false};
  const rpc=vi.fn().mockResolvedValue({data:workspace,error:null});
  expect(await new SupabaseRepository({rpc} as unknown as SupabaseClient).loadStockConversionWorkspace()).toEqual(workspace);
  expect(rpc).toHaveBeenCalledWith("stock_conversion_workspace",{payload:{}});
});
