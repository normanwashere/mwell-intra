import { describe, expect, it } from 'vitest';
import { poDetailPath, poListSort, poReturnPath } from './poListContext';
describe('PO list return context', () => {
  it('preserves only validated list filter and sort settings', () => {
    const detail = poDetailPath('po/one', new URLSearchParams('filter=active&sort=total&dir=desc&token=secret'));
    expect(detail).toBe('/purchase-orders/po%2Fone?fromFilter=active&fromSort=total&fromDir=desc');
    expect(poReturnPath(detail.split('?')[1]!)).toBe('/procurement/purchase-orders?filter=active&sort=total&dir=desc');
  });
  it('rejects unknown filters, sorting and redirect destinations', () => {
    expect(poReturnPath('?fromFilter=deleted&fromSort=password&returnTo=https://other.example')).toBe('/procurement/purchase-orders');
    expect(poListSort(new URLSearchParams('sort=unknown&dir=evil'))).toEqual({key:null,dir:'asc'});
  });
});
