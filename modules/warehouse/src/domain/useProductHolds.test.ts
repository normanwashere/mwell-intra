import { describe, expect, it } from 'vitest';
import type { InventoryHold, InventoryUnit } from '@intra/data-kit';
import { matchingUnitHolds } from './useProductHolds';

const unit = { productId:'watch', serialNumber:'SER-1', locationId:'wh', binId:'bin-a', lotId:'lot-a' } as InventoryUnit;
const hold = { productId:'watch', status:'active', locationId:'wh', binId:'bin-a', lotId:'lot-a' } as InventoryHold;
describe('unit hold display scope',()=>{
  it('matches an exact active serial and never a different product or released hold',()=>{
    expect(matchingUnitHolds([{...hold,serialNumber:'SER-1'}],unit)).toHaveLength(1);
    expect(matchingUnitHolds([{...hold,serialNumber:'SER-2'},{...hold,productId:'other'}, {...hold,status:'released'}],unit)).toEqual([]);
  });
  it('does not interpret a general-area or unlotted hold as every bin or receipt lot',()=>{
    expect(matchingUnitHolds([hold],unit)).toHaveLength(1);
    expect(matchingUnitHolds([{...hold,binId:undefined},{...hold,lotId:undefined}],unit)).toEqual([]);
    expect(matchingUnitHolds([{...hold,binId:undefined,lotId:undefined}],{...unit,binId:undefined,lotId:undefined})).toHaveLength(1);
  });
});
