import { describe, expect, it, vi } from 'vitest';
import { readAcceptedReplenishment, parseReplenishmentBinding } from './replenishmentRequest';

const id = '11111111-1111-4111-8111-111111111111';
const row = () => ({ id, status: 'accepted', product_id: 'owned-product', recommended_quantity: 2, rationale: 'Accepted need', procurement_request_id: null });
describe('accepted replenishment request binding', () => {
  it('preserves only the exact accepted product, quantity and rationale', () => {
    expect(parseReplenishmentBinding(row(), id)).toEqual({ id, productId: 'owned-product', quantity: 2, rationale: 'Accepted need' });
  });
  it.each([
    { id: 'foreign' }, { status: 'recommended' }, { status: 'handed_off' },
    { procurement_request_id: 'req_foreign' }, { product_id: '' }, { recommended_quantity: 0 },
    { recommended_quantity: 1.5 }, { recommended_quantity: '2' }, { rationale: '' },
  ])('rejects incomplete or non-accepted state %j', patch => {
    expect(() => parseReplenishmentBinding({ ...row(), ...patch }, id)).toThrow();
  });
  it('reads only the requested ID and rejects changed accepted snapshots', async () => {
    const single = vi.fn().mockResolvedValue({ data: row(), error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    const client = { schema: vi.fn(() => ({ from: vi.fn(() => ({ select })) })) };
    const binding = await readAcceptedReplenishment(client as never, id);
    expect(eq).toHaveBeenCalledWith('id', id);
    single.mockResolvedValue({ data: { ...row(), recommended_quantity: 3 }, error: null });
    await expect(readAcceptedReplenishment(client as never, id, binding)).rejects.toThrow('changed');
    single.mockResolvedValue({ data: null, error: { message: 'denied' } } as never);
    await expect(readAcceptedReplenishment(client as never, id)).rejects.toThrow();
  });
});
