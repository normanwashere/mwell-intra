import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StorageAreasPage } from './StorageAreasPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { loadCompleteControlQueue } from '@/domain/controlQueues';

describe('StorageAreasPage', () => {
  it('opens generated staging work and refreshes remaining quantity after partial putaway', async () => {
    const seed = await makeRepo().getData();
    seed.stockLevels = [{ productId: 'shirt-l', locationId: 'loc-wh', quantity: 60 }];
    const repo = makeRepo(seed);
    const task = (await loadCompleteControlQueue(query => repo.listWarehouseTasks(query))).find(row => row.sourceId === 'staging:["shirt-l","loc-wh"]')!;
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo, route: `/storage?source=${encodeURIComponent(task.sourceId)}` });
    const dialog = await screen.findByRole('dialog', { name: /put away stock/i });
    const quantity = within(dialog).getByLabelText('Quantity to put away');
    expect(quantity).toHaveValue(60);
    fireEvent.change(quantity, { target: { value: '50' } });
    await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'PASIG-A-01{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm putaway' }));
    expect(await screen.findByText(/10 units: remaining stock is still due/)).toBeVisible();
    expect((await loadCompleteControlQueue(query => repo.listWarehouseTasks(query))).find(row => row.id === task.id)?.title).toContain('10 units');
  });
  it('moves 50 of 60 bulk units once and retains the destination for the next scan', async () => {
    const seed = await makeRepo().getData();
    seed.stockLevels = [{ productId: 'shirt-l', locationId: 'loc-wh', quantity: 60 }];
    const repo = makeRepo(seed);
    const relocate = vi.spyOn(repo, 'relocate');
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo });
    await user.click(await screen.findByRole('button', { name: /put away/i }));
    const dialog = await screen.findByRole('dialog', { name: /put away stock/i });
    await user.type(within(dialog).getByLabelText('Enter stock code manually'), 'shirt-l{Enter}');
    const quantity = within(dialog).getByLabelText('Quantity to put away');
    await user.clear(quantity);
    await user.type(quantity, '50');
    await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'PASIG-A-01{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm putaway' }));
    await waitFor(() => expect(relocate).toHaveBeenCalledOnce());
    const data = await repo.getData();
    expect(data.stockLevels.find(row => row.productId === 'shirt-l' && !row.binId)?.quantity).toBe(10);
    expect(data.stockLevels.find(row => row.productId === 'shirt-l' && row.binId === 'bin-pasig-a1')?.quantity).toBe(50);
    expect(within(dialog).getByText('Selected PASIG-A-01')).toBeVisible();
  });

  it('blocks fractional/excess quantities, double taps, and dismissal during a delayed putaway', async () => {
    const seed = await makeRepo().getData();
    seed.stockLevels = [{ productId: 'shirt-l', locationId: 'loc-wh', quantity: 60, unavailable: 10 }];
    const repo = makeRepo(seed);
    let reject!: (error: Error) => void;
    const relocate = vi.spyOn(repo, 'relocate').mockImplementation(() => new Promise((_resolve, rej) => { reject = rej; }));
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo });
    await user.click(await screen.findByRole('button', { name: /put away/i }));
    const dialog = await screen.findByRole('dialog', { name: /put away stock/i });
    await user.type(within(dialog).getByLabelText('Enter stock code manually'), 'shirt-l{Enter}');
    await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'PASIG-A-01{Enter}');
    const quantity = within(dialog).getByLabelText('Quantity to put away');
    for (const value of ['0', '1.5', '51', '']) {
      fireEvent.change(quantity, { target: { value } });
      expect(within(dialog).getByRole('button', { name: 'Confirm putaway' })).toBeDisabled();
    }
    fireEvent.change(quantity, { target: { value: '50' } });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm putaway' });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    await waitFor(() => expect(relocate).toHaveBeenCalledOnce());
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(dialog).toBeInTheDocument();
    await act(async () => reject(new Error('Connection lost')));
    expect(quantity).toHaveValue(50);
    await user.keyboard('{Escape}');
    expect(within(dialog).getByRole('button', { name: 'Keep capturing' })).toBeVisible();
  });

  it('opens the exact unit from a paginated putaway task source', async () => {
    const repo = makeRepo();
    const data = await repo.getData();
    const unit = data.units.find(row => row.serialNumber === 'SMART-WATCH-SN0001')!;
    const tasks = vi.spyOn(repo, 'listWarehouseTasks').mockImplementation(async (query) => query.cursor
      ? { rows: [{ id: 'putaway-exact', type: 'putaway', sourceId: unit.id, title: 'Store watch', status: 'due' }] }
      : { rows: [], nextCursor: 'page-2' });
    const relocate = vi.spyOn(repo, 'relocate');
    renderWithProviders(<StorageAreasPage />, { repo, route: `/storage?source=${encodeURIComponent(unit.id)}` });
    const dialog = await screen.findByRole('dialog', { name: /put away stock/i });
    expect(within(dialog).getByText(/1 serialized unit: SMART-WATCH-SN0001/)).toBeVisible();
    expect(within(dialog).queryByText(/Store watch/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Enter stock code manually')).toBeDisabled();
    expect(tasks).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'page-2' }));
    expect(relocate).not.toHaveBeenCalled();
  });

  it.each(['completed', 'missing'] as const)('shows an explicit %s source without opening unrelated stock', async (status) => {
    const repo = makeRepo();
    vi.spyOn(repo, 'listWarehouseTasks').mockResolvedValue({ rows: status === 'completed'
      ? [{ id: 'putaway-done', type: 'putaway', sourceId: 'selected', title: 'Store watch', status: 'completed' }]
      : [] });
    renderWithProviders(<StorageAreasPage />, { repo, route: '/storage?source=selected' });
    await screen.findByText(status === 'completed' ? 'Store watch: completed.' : 'The selected putaway task is unavailable or you do not have access.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to tasks' })).toHaveAttribute('href', '/tasks');
  });
  it('requires transfer_stock for live putaway', async () => {
    renderWithProviders(<StorageAreasPage />, {
      role: 'warehouse_operator',
      source: 'supabase',
      capabilities: ['receive_stock'],
    });
    await screen.findByRole('heading', { name: 'Storage areas' });
    expect(screen.queryByRole('button', { name: /put away/i })).not.toBeInTheDocument();
  });

  it('opens the exact add-bin state requested by a Knowledge Base guide link', async () => {
    renderWithProviders(<StorageAreasPage />, {
      role: 'logistics_supervisor',
      route: '/storage?guide=setup-bin&returnTo=%2Fknowledge%3Fflow%3Dwarehouse-setup',
    });

    const dialog = await screen.findByRole('dialog', { name: 'Add storage area' });
    const binCode = within(dialog).getByLabelText('Bin code');
    expect(binCode).toHaveAttribute('id', 'sa-code');
    await waitFor(() => expect(binCode).toHaveFocus());
    expect(within(dialog).getByRole('button', { name: 'Add bin' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: 'Back to workflow guide' }),
    ).toHaveAttribute('href', '/knowledge?flow=warehouse-setup');
  });

  it('does not render an unsafe guided return destination', async () => {
    renderWithProviders(<StorageAreasPage />, {
      role: 'logistics_supervisor',
      route: '/storage?guide=setup-bin&returnTo=https%3A%2F%2Fevil.example',
    });

    const dialog = await screen.findByRole('dialog', { name: 'Add storage area' });
    expect(
      within(dialog).queryByRole('link', { name: 'Back to workflow guide' }),
    ).not.toBeInTheDocument();
  });

  it('puts away the exact scanned unit into the scanned destination bin', async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(<StorageAreasPage />, {
      role: 'logistics_supervisor',
      repo,
    });

    await user.click(await screen.findByRole('button', { name: /put away/i }));
    const dialog = await screen.findByRole('dialog', { name: /put away stock/i });
    await user.type(
      within(dialog).getByLabelText('Enter stock code manually'),
      'SMART-WATCH-SN0001',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add stock' }));
    await user.type(
      within(dialog).getByLabelText('Enter destination bin manually'),
      'PASIG-A-01',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add bin' }));
    await user.click(within(dialog).getByRole('button', { name: /confirm putaway/i }));

    await waitFor(async () => {
      const unit = (await repo.getData()).units.find(
        (row) => row.serialNumber === 'SMART-WATCH-SN0001',
      );
      expect(unit?.binId).toBe('bin-pasig-a1');
    });
  });
});
