import {describe,expect,it} from 'vitest';
import {selectedWarehouse} from './warehouseSelection';

describe('warehouse selection for new work', () => {
  const sites = [{id:'test',type:'warehouse',active:true},{id:'master',type:'warehouse',active:true}];
  it('never chooses the first of several warehouses', () => {
    expect(selectedWarehouse(sites, '')).toBe('');
    expect(selectedWarehouse([...sites].reverse(), '')).toBe('');
  });
  it('keeps an explicit valid choice and rejects stale choices', () => {
    expect(selectedWarehouse(sites,'master')).toBe('master');
    expect(selectedWarehouse(sites,'missing')).toBe('');
    expect(selectedWarehouse([{id:'gone',type:'warehouse',active:false}],'gone')).toBe('');
  });
  it('can use the sole active warehouse, excluding other location types', () => {
    expect(selectedWarehouse([...sites.map(s=>({...s,active:s.id==='master'})),{id:'event',type:'event'}],'')).toBe('master');
    expect(selectedWarehouse([],'')).toBe('');
  });
});
