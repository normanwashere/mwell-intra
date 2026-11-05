import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.fn();
vi.mock('@shell/lib/supabase/server', () => ({ createSupabaseServerClient: (...args: unknown[]) => createClient(...args) }));
let POST: typeof import('@shell/app/api/warehouse/exports/route').POST;
let positions: Record<string, unknown>[];
let pageFailure = false;
let exportDenied = false;
const requests: { projection: string; after?: string; limit: number }[] = [];
const upload = vi.fn();
const remove = vi.fn();
const sign = vi.fn();
const rpc = vi.fn();
const from = vi.fn();
const getUser = vi.fn();
const row = (id: number) => ({ id: `row-${String(id).padStart(5, '0')}`, product_id: 'product', location_id: `loc-${id}`, bin_id: null,
  on_hand: 10, committed: 0, held: 0, unavailable: 0, available: 0, unscoped_committed: 8,
  product_available: 4, availability_verified: false, putaway_available: 10 });
const request = () => new Request('http://localhost/api/warehouse/exports', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ kind: 'inventory_position', location_id: 'forged-scope' }),
}) as never;
const csv = () => new TextDecoder().decode(upload.mock.calls[0]![1] as Uint8Array);

beforeAll(async () => { ({ POST } = await import('@shell/app/api/warehouse/exports/route')); });
beforeEach(() => {
  vi.clearAllMocks(); requests.length = 0; positions = [row(0), row(1)]; pageFailure = false; exportDenied = false;
  getUser.mockResolvedValue({ data: { user: { id: 'authorized-user' } }, error: null });
  upload.mockResolvedValue({ error: null }); remove.mockResolvedValue({ error: null });
  sign.mockResolvedValue({ data: { signedUrl: 'https://private.invalid/export' }, error: null });
  rpc.mockImplementation(async (name: string) => name === 'register_export_job'
    ? { data: { id: 'job' }, error: exportDenied ? { message: 'Export permission required.' } : null }
    : { data: { storage_path: 'exports/authorized-user/test.csv', filename: 'test.csv', expires_in: 60 }, error: null });
  from.mockImplementation(() => {
    let projection = ''; let after: string | undefined;
    const query = {
      select: vi.fn((value: string) => { projection = value; return query; }),
      order: vi.fn(() => query),
      gt: vi.fn((_column: string, value: string) => { after = value; return query; }),
      limit: vi.fn(async (limit: number) => {
        requests.push({ projection, after, limit });
        if (pageFailure && after) return { data: null, error: { message: 'Second page failed.' } };
        const data = positions.filter(value => !after || String(value.id) > after).slice(0, Math.min(limit, 1000));
        return { data: data.map(value => Object.fromEntries(projection.split(',').map(key => [key, value[key]]))), error: null };
      }),
    };
    return query;
  });
  createClient.mockResolvedValue({ auth: { getUser }, from, rpc, storage: { from: () => ({ upload, remove, createSignedUrl: sign }) } });
});

describe('inventory-position governed CSV', () => {
  it('exports explicit unknown products as blank availability without suppressing known products', async () => {
    positions = [
      { ...row(0), product_available: null, unscoped_committed: 0, available: 0, putaway_available: 0 },
      { ...row(1), product_id: 'known', product_available: 7, unscoped_committed: 0, available: 7, putaway_available: 7, availability_verified: true },
    ];
    expect((await POST(request())).status).toBe(201);
    const [header, unknown, known] = csv().replace(/^\uFEFF/, '').trim().split('\n').map(line => line.split(','));
    expect(unknown![header!.indexOf('available')]).toBe('');
    expect(unknown![header!.indexOf('product_available')]).toBe('');
    expect(unknown![header!.indexOf('availability_verified')]).toBe('false');
    expect(unknown![header!.indexOf('availability_status')]).toBe('Not confirmed');
    expect(known![header!.indexOf('available')]).toBe('7');
    expect(known![header!.indexOf('product_available')]).toBe('7');
    expect(known![header!.indexOf('availability_verified')]).toBe('true');
  });

  it.each(['verified', 'actionable', 'putaway', 'conflicting'] as const)('rejects contradictory null summaries: %s', async kind => {
    positions = [{ ...row(0), product_available: null, unscoped_committed: 0, putaway_available: 0 }];
    if (kind === 'verified') positions[0]!.availability_verified = true;
    if (kind === 'actionable') positions[0]!.available = 1;
    if (kind === 'putaway') positions[0]!.putaway_available = 1;
    if (kind === 'conflicting') positions.push(row(1));
    expect((await POST(request())).status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });

  it('includes explicit non-additive quantities and uncertainty without inventing a location commitment', async () => {
    expect((await POST(request())).status).toBe(201);
    const [header, first] = csv().replace(/^\uFEFF/, '').trim().split('\n');
    expect(header).toContain('unscoped_committed,product_available,availability_verified,putaway_available');
    expect(header).toContain('product_totals_scope');
    expect(first).toContain('false');
    expect(first).toContain('Unassigned demand');
    expect(csv()).toContain('Repeated per product_id; count once per product');
    expect(createClient).toHaveBeenCalledWith('warehouse');
    expect(from.mock.calls.every(([table]) => table === 'inventory_position_v1')).toBe(true);
    expect(requests[0]?.projection).not.toMatch(/reason|actor|cost|inspection/);
    expect(rpc).toHaveBeenCalledWith('register_export_job', { payload: expect.objectContaining({ export_type: 'inventory_position', row_count: 2 }) });
    expect(sign).toHaveBeenCalledOnce();
  });

  it('paginates beyond the API 1000-row cap using only caller-scoped position reads', async () => {
    positions = Array.from({ length: 1002 }, (_, i) => row(i));
    expect((await POST(request())).status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('register_export_job', { payload: expect.objectContaining({ row_count: 1002 }) });
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every(query => query.limit <= 1000)).toBe(true);
    expect(csv()).toContain('loc-1001');
  });

  it('does not upload or register a partial CSV when a later page fails', async () => {
    positions = Array.from({ length: 1002 }, (_, i) => row(i)); pageFailure = true;
    expect((await POST(request())).status).toBe(403);
    expect(upload).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
  });

  it('still requires independent export authority and removes the artifact on register denial', async () => {
    exportDenied = true;
    expect((await POST(request())).status).toBe(403);
    expect(remove).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalledWith('prepare_export_download', expect.anything());
    expect(sign).not.toHaveBeenCalled();
  });

  it('denies anonymous callers before reading any positions', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    expect(from).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  it.each(['missing', 'conflicting', 'invalid'] as const)('does not publish a %s product quantity summary', async (kind) => {
    if (kind === 'missing') positions[0]!.product_available = undefined;
    if (kind === 'conflicting') positions[1]!.product_available = 5;
    if (kind === 'invalid') positions[0]!.product_available = -1;
    expect((await POST(request())).status).toBe(403);
    expect(upload).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
  });

  it('preserves explicit verified zero and false status as different CSV states', async () => {
    positions = [{ ...row(0), unscoped_committed: 0, product_available: 0, availability_verified: true }];
    expect((await POST(request())).status).toBe(201);
    const [header, data] = csv().replace(/^\uFEFF/, '').trim().split('\n').map(line => line!.split(','));
    expect(data![header!.indexOf('available')]).toBe('0');
    expect(data![header!.indexOf('availability_verified')]).toBe('true');
  });
});
