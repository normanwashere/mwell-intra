import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AllocationReturnSheet } from './AllocationReturnSheet';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

const state = vi.hoisted(() => {
  const rpc = vi.fn();
  const single = vi.fn();
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }) }));
  return { rpc, single, from, client: { schema: vi.fn(() => ({ rpc, from })) } };
});
vi.mock('@intra/auth', async original => ({
  ...await original<typeof import('@intra/auth')>(),
  useSession: () => ({ mode: 'supabase', supabaseClient: state.client,
    profile: { id: 'warehouse-actor' }, userRoles: {} }),
}));

async function setup() {
  const data = await makeRepo().getData();
  const allocation = data.allocations.find(row => row.id === 'alloc-1')!;
  allocation.quantity = 2;
  const repo = makeRepo(data);
  const record = vi.spyOn(repo, 'recordReturn');
  renderWithProviders(<AllocationReturnSheet allocation={allocation} productName="Owned event stock" open onOpenChange={vi.fn()} />,
    { repo, role: 'warehouse_operator', capabilities: ['manage_returns'] });
  const dialog = await screen.findByRole('dialog');
  const user = userEvent.setup();
  await user.selectOptions(within(dialog).getByLabelText('Quarantine location'), 'loc-wh');
  await user.selectOptions(within(dialog).getByLabelText('Quarantine bin'), 'bin-pasig-a1');
  return { dialog, record };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.single.mockResolvedValue({ data: { remaining_units: 2 }, error: null });
  state.rpc.mockResolvedValue({ data: { allocation_id: 'alloc-1', issued_units: 2, returned_units: 0, remaining_units: 1 }, error: null });
});

describe('live allocation return quantity authority', () => {
  it('uses the sold-aware projection for the default, maximum and hint', async () => {
    const { dialog } = await setup();
    await waitFor(() => expect(within(dialog).getByLabelText('Quantity returned')).toHaveValue(1));
    expect(within(dialog).getByLabelText('Quantity returned')).toHaveAttribute('max', '1');
    expect(within(dialog).getByText('1 remaining of 2 issued')).toBeVisible();
    expect(state.rpc).toHaveBeenCalledWith('allocation_return_balance', { p_allocation_id: 'alloc-1' });
    expect(state.from).not.toHaveBeenCalled();
  });
  it('cannot submit after one sale and one return exhaust custody', async () => {
    state.rpc.mockResolvedValue({ data: { allocation_id: 'alloc-1', issued_units: 2, returned_units: 1, remaining_units: 0 }, error: null });
    const { dialog, record } = await setup();
    await waitFor(() => expect(within(dialog).getByLabelText('Quantity returned')).toHaveValue(0));
    expect(within(dialog).getByText('0 remaining of 2 issued')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Log return' })).toBeDisabled();
    expect(record).not.toHaveBeenCalled();
  });
  it('fails closed instead of falling back to issued-minus-returned on denied reads', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'Not authorized' } });
    const { dialog } = await setup();
    expect(await within(dialog).findByText(/custody is unavailable/i)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Log return' })).toBeDisabled();
    expect(within(dialog).queryByText('0 remaining of 2 issued')).not.toBeInTheDocument();
    expect(state.from).not.toHaveBeenCalled();
  });
});
