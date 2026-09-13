import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { warehouseModule } from '@intra/rbac';
import type { WarehouseSessionValue } from '@/auth/session';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ProductDetailPage } from './ProductDetailPage';
import { InventoryRecommendationAction } from '@/components/InventoryRecommendationAction';

let sessionOverrides: Partial<WarehouseSessionValue>;
vi.mock('@/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/auth/session')>();
  return { ...actual, useSession: () => ({ ...actual.useSession(), ...sessionOverrides }) };
});
const request = vi.fn(), rpc = vi.fn(), schema = vi.fn(), from = vi.fn(), select = vi.fn(), eq = vi.fn(), inStatus = vi.fn();
const id = '11111111-1111-4111-8111-111111111111';
const operationCaps = warehouseModule.roles.operations.capabilities;
const combinedCaps = [...new Set([...operationCaps, ...warehouseModule.roles.warehouse_operator.capabilities])];
function Detail() {
  const [, refresh] = useState(0);
  return <><button onClick={() => refresh(n => n + 1)}>Refresh session</button>
    <Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes></>;
}
function mount(capabilities = operationCaps, source: 'supabase' | 'memory' = 'supabase') {
  return renderWithProviders(<Detail />, { route: '/inventory/doctor-token', role: 'operations', source, capabilities });
}
async function open() {
  fireEvent.click(await screen.findByRole('button', { name: 'Recommend replenishment' }));
  return within(await screen.findByRole('dialog', { name: 'Recommend replenishment' }));
}
beforeEach(() => {
  vi.clearAllMocks();
  request.mockResolvedValue({ data: [], count: 0, error: null });
  rpc.mockResolvedValue({ data: { id, product_id: 'doctor-token', status: 'recommended' }, error: null });
  inStatus.mockReturnValue({ limit: request }); eq.mockReturnValue({ in: inStatus });
  select.mockReturnValue({ eq }); from.mockReturnValue({ select }); schema.mockReturnValue({ from, rpc });
  sessionOverrides = { mode: 'supabase', loading: false, userCapabilities: { warehouse: operationCaps },
    supabaseClient: { schema } as unknown as WarehouseSessionValue['supabaseClient'] };
});

describe('Inventory recommendation entry', () => {
  it('uses the shared outlined button style for the icon and tap target', async () => {
    mount();
    const button = await screen.findByRole('button', { name: 'Recommend replenishment' });
    expect(button).toHaveClass('btn-outline', 'min-h-11');
    expect(button).not.toHaveClass('btn-secondary');
    expect(button).toHaveAttribute('type', 'button');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([{ caps: operationCaps }, { caps: combinedCaps }])('opens for the effective Operations bundle without Procurement navigation', async ({ caps }) => {
    sessionOverrides.userCapabilities = { warehouse: caps }; mount(caps);
    const dialog = await open();
    expect(await dialog.findByText('No active recommendation')).toBeInTheDocument();
    expect(dialog.getByLabelText('Planning assumption (days)')).toHaveValue(14);
    expect((dialog.getByLabelText('Recommended quantity') as HTMLInputElement).valueAsNumber).toBeGreaterThan(0);
    expect(dialog.queryByRole('link')).not.toBeInTheDocument();
    expect(dialog.queryByText(/supplier|forecast|spend|purchase order|accept|hand off/i)).not.toBeInTheDocument();
    expect(schema).toHaveBeenCalledExactlyOnceWith('procurement');
    expect(from).toHaveBeenCalledExactlyOnceWith('replenishment_recommendations');
    expect(select).toHaveBeenCalledExactlyOnceWith('id,product_id,status', { count: 'exact' });
    expect(eq).toHaveBeenCalledExactlyOnceWith('product_id', 'doctor-token');
    expect(inStatus).toHaveBeenCalledWith('status', ['recommended', 'accepted', 'handed_off']);
    expect(request).toHaveBeenCalledWith(2); expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { userCapabilities: { warehouse: warehouseModule.roles.warehouse_operator.capabilities } },
    { userCapabilities: { warehouse: warehouseModule.roles.marketing.capabilities } },
    { userCapabilities: {}, roleCapabilities: { warehouse: operationCaps } },
    { userCapabilities: { warehouse: ['recommend_replenishment'] } },
    { loading: true }, { profile: null },
  ] satisfies Partial<WarehouseSessionValue>[])('does not offer the action or read recommendation rows without effective access: %j', async override => {
    sessionOverrides = { ...sessionOverrides, ...override }; mount();
    await screen.findByRole('heading', { name: 'Doctor Token' });
    expect(screen.queryByRole('button', { name: 'Recommend replenishment' })).not.toBeInTheDocument();
    expect(schema).not.toHaveBeenCalled();
  });

  it('preserves memory behavior without adding live recommendations', async () => {
    sessionOverrides = {}; mount(operationCaps, 'memory');
    await screen.findByRole('heading', { name: 'Doctor Token' });
    expect(screen.queryByRole('button', { name: 'Recommend replenishment' })).not.toBeInTheDocument();
    expect(schema).not.toHaveBeenCalled();
  });

  it('uses editable minimum-based quantity and rationale, refreshes exact status, and saves the unchanged recommend payload', async () => {
    mount(); const dialog = await open();
    await dialog.findByText('No active recommendation');
    const available = Number(dialog.getByTestId('recommendation-available').textContent);
    const minimum = Number(dialog.getByTestId('recommendation-minimum').textContent);
    expect(dialog.getByLabelText('Recommended quantity')).toHaveValue(Math.max(Math.max(0, minimum - available), minimum));
    fireEvent.change(dialog.getByLabelText('Recommended quantity'), { target: { value: '9' } });
    fireEvent.change(dialog.getByLabelText('Rationale'), { target: { value: 'Planned campaign demand' } });
    fireEvent.change(dialog.getByLabelText('Planning assumption (days)'), { target: { value: '21' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save recommendation' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledExactlyOnceWith('manage_replenishment_recommendation', { payload: {
      action: 'recommend', product_id: 'doctor-token', recommended_quantity: 9, on_hand: available, reorder_point: minimum,
      lead_time_days: 21, stockout_risk: available === 0 ? 'critical' : available < minimum ? 'medium' : 'low', rationale: 'Planned campaign demand',
    } }));
    expect(request).toHaveBeenCalledTimes(2);
    expect(await dialog.findByText('Recommendation saved')).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Save recommendation' }));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: [], count: null, error: null },
    { data: null, count: null, error: { message: 'PRIVATE ERROR must not render' } },
    { data: [{ id, product_id: 'foreign', status: 'recommended' }], count: 1, error: null },
    { data: [{ id, product_id: 'doctor-token', status: 'unknown' }], count: 1, error: null },
    { data: [{ id, product_id: 'doctor-token', status: 'recommended' }], count: 2, error: null },
  ])('fails closed for incomplete, failed or foreign status readback', async result => {
    request.mockResolvedValue(result); mount(); const dialog = await open();
    await dialog.findByRole('alert');
    expect(dialog.getByRole('button', { name: 'Save recommendation' })).toBeDisabled();
    expect(dialog.queryByText(/PRIVATE ERROR/)).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'handed_off'])('shows only exact %s status and blocks approved snapshot updates', async status => {
    request.mockResolvedValue({ data: [{ id, product_id: 'doctor-token', status }], count: 1, error: null });
    mount(); const dialog = await open();
    await dialog.findByText(`Current status: ${status}`);
    expect(dialog.queryByRole('button', { name: 'Save recommendation' })).not.toBeInTheDocument();
    for (const label of ['Recommended quantity', 'Planning assumption (days)', 'Rationale']) {
      expect(dialog.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(dialog.queryByRole('link')).not.toBeInTheDocument(); expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'handed_off'])('blocks a fresh %s decision without displaying the stale draft as its snapshot', async status => {
    mount(); const dialog = await open(); await dialog.findByText('No active recommendation');
    fireEvent.change(dialog.getByLabelText('Rationale'), { target: { value: 'Demand' } });
    request.mockResolvedValue({ data: [{ id, product_id: 'doctor-token', status }], count: 1, error: null });
    fireEvent.click(dialog.getByRole('button', { name: 'Save recommendation' }));
    await dialog.findByText(`Current status: ${status}`); expect(rpc).not.toHaveBeenCalled();
    expect(dialog.queryByRole('button', { name: 'Save recommendation' })).not.toBeInTheDocument();
    for (const label of ['Recommended quantity', 'Planning assumption (days)', 'Rationale']) {
      expect(dialog.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(dialog.queryByText('Demand')).not.toBeInTheDocument();
  });

  it('does not mutate if permission is revoked while the fresh pre-submit read is pending', async () => {
    mount(); const dialog = await open(); await dialog.findByText('No active recommendation');
    fireEvent.change(dialog.getByLabelText('Rationale'), { target: { value: 'Demand' } });
    let finish!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(dialog.getByRole('button', { name: 'Save recommendation' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    sessionOverrides.userCapabilities = { warehouse: ['view_inventory'] };
    fireEvent.click(screen.getByText('Refresh session'));
    await act(async () => finish({ data: [], count: 0, error: null }));
    expect(dialog.getByRole('button', { name: 'Save recommendation' })).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps pending status read-only and discards a read completed after Cancel', async () => {
    let finish!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mount(); const dialog = await open();
    expect(dialog.getByRole('button', { name: 'Save recommendation' })).toBeDisabled();
    expect(dialog.getByLabelText('Recommended quantity')).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await act(async () => finish({ data: [], count: 0, error: null }));
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never dispatches a save after Cancel during the pre-submit read', async () => {
    mount(); const dialog = await open(); await dialog.findByText('No active recommendation');
    fireEvent.change(dialog.getByLabelText('Rationale'), { target: { value: 'Demand' } });
    let finish!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(dialog.getByRole('button', { name: 'Save recommendation' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await act(async () => finish({ data: [], count: 0, error: null }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires explicit rationale above minimum and valid integer quantity and days', async () => {
    mount(); const dialog = await open(); await dialog.findByText('No active recommendation');
    expect(dialog.getByLabelText('Rationale')).toHaveValue('');
    const save = dialog.getByRole('button', { name: 'Save recommendation' });
    expect(save).toBeDisabled();
    fireEvent.change(dialog.getByLabelText('Rationale'), { target: { value: 'Planned demand' } });
    expect(save).toBeEnabled();
    for (const value of ['0', '-1', '1.5', '', '2147483648']) {
      fireEvent.change(dialog.getByLabelText('Recommended quantity'), { target: { value } });
      expect(save).toBeDisabled();
    }
    fireEvent.change(dialog.getByLabelText('Recommended quantity'), { target: { value: '3' } });
    for (const value of ['-1', '1.5', '', '2147483648']) {
      fireEvent.change(dialog.getByLabelText('Planning assumption (days)'), { target: { value } });
      expect(save).toBeDisabled();
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('contains a rejected status transport without exposing its message', async () => {
    request.mockRejectedValue(new Error('PRIVATE transport detail')); mount();
    const dialog = await open(); await dialog.findByRole('alert');
    expect(dialog.queryByText(/PRIVATE/)).not.toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Save recommendation' })).toBeDisabled();
  });

  it.each([
    { stockReady: false, available: 5 }, { stockReady: true, available: Number.NaN },
    { stockReady: true, available: -1 }, { stockReady: true, available: 0.5 },
  ])('keeps unavailable or invalid inventory read-only without status queries', async props => {
    renderWithProviders(<InventoryRecommendationAction product={{ id: 'doctor-token', name: 'Doctor Token', sku: 'TOKEN-DOC', reorderPoint: 10 }}
      source="supabase" {...props} />, { role: 'operations' });
    const entry = await screen.findByRole('button', { name: 'Recommend replenishment' });
    expect(entry).toBeDisabled(); fireEvent.click(entry);
    expect(schema).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prefills below-minimum planning and permits editing an open recommendation only', async () => {
    request.mockResolvedValue({ data: [{ id, product_id: 'doctor-token', status: 'recommended' }], count: 1, error: null });
    renderWithProviders(<InventoryRecommendationAction product={{ id: 'doctor-token', name: 'Doctor Token', sku: 'TOKEN-DOC', reorderPoint: 10 }}
      source="supabase" stockReady available={2} />, { role: 'operations' });
    const dialog = await open(); await dialog.findByText('Current status: recommended');
    expect(dialog.getByLabelText('Recommended quantity')).toHaveValue(10);
    expect(dialog.getByLabelText('Rationale')).toHaveValue('Available inventory is below the minimum stock level.');
    expect(dialog.getByRole('button', { name: 'Save recommendation' })).toBeEnabled();
    expect(dialog.queryByRole('link')).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: 'PRIVATE backend detail' } },
    { data: { id, product_id: 'foreign', status: 'recommended' }, error: null },
    { data: { id, product_id: 'doctor-token', status: 'accepted' }, error: null },
  ])('does not claim success or retry an unverified RPC result', async result => {
    rpc.mockResolvedValue(result); mount(); const dialog = await open();
    await dialog.findByText('No active recommendation');
    fireEvent.change(dialog.getByLabelText('Rationale'), { target: { value: 'Demand' } });
    const save = dialog.getByRole('button', { name: 'Save recommendation' });
    fireEvent.click(save); fireEvent.click(save);
    await dialog.findByRole('alert');
    expect(rpc).toHaveBeenCalledTimes(1); expect(save).toBeDisabled();
    expect(dialog.queryByText('Recommendation saved')).not.toBeInTheDocument();
    expect(dialog.queryByText(/PRIVATE/)).not.toBeInTheDocument();
  });
});
