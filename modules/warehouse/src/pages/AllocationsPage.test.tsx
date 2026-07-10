import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AllocationsPage } from './AllocationsPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

async function openReserveSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^reserve$/i }));
  return screen.findByRole('dialog');
}

function issueButtonFor(productName: string) {
  const list = screen.getByLabelText('Allocations');
  const items = within(list).getAllByRole('listitem');
  const li = items.find((el) => within(el).queryByText(productName));
  if (!li) throw new Error(`No allocation row for ${productName}`);
  return within(li).getByRole('button', { name: /^issue$/i });
}

describe('AllocationsPage', () => {
  it('reserves stock for an event via the sheet', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: 'operations' });
    await screen.findByLabelText('Allocations');

    const dialog = await openReserveSheet(user);
    await user.selectOptions(within(dialog).getByLabelText('Product'), 'shirt-l');
    const qty = within(dialog).getByLabelText('Quantity');
    await user.clear(qty);
    await user.type(qty, '5');
    await user.click(within(dialog).getByRole('button', { name: /^reserve$/i }));

    await waitFor(() => {
      const list = screen.getByLabelText('Allocations');
      expect(within(list).getAllByText(/Event Shirt \(L\)/i).length).toBeGreaterThan(0);
    });
  });

  it('blocks over-reservation with an error', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: 'operations' });
    await screen.findByLabelText('Allocations');

    const dialog = await openReserveSheet(user);
    await user.selectOptions(within(dialog).getByLabelText('Product'), 'otg-bag');
    const qty = within(dialog).getByLabelText('Quantity');
    await user.clear(qty);
    await user.type(qty, '9999');
    await user.click(within(dialog).getByRole('button', { name: /^reserve$/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/available/i);
  });

  it('warns about expired stock without blocking reservation in W1', async () => {
    const seed = await makeRepo().getData();
    seed.products = seed.products.map((product) => product.id === 'doctor-token'
      ? { ...product, expiryTracked: true, shelfLifeWarningDays: 30 }
      : product);
    seed.lots.push({
      id: 'lot-expired-allocation', productId: 'doctor-token', lotCode: 'EXP-ALLOC',
      unitCost: 10, receivedAt: '2026-06-01T00:00:00Z', expiryDate: '2026-07-09',
    });
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: 'operations', repo: makeRepo(seed) });
    await screen.findByLabelText('Allocations');

    const dialog = await openReserveSheet(user);
    await user.selectOptions(within(dialog).getByLabelText('Product'), 'doctor-token');
    expect(within(dialog).getByText(/expired lot on hand/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^reserve$/i })).toBeEnabled();
  });

  it('filters allocations by status', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: 'operations' });
    await screen.findByLabelText('Allocations');

    await user.click(screen.getByRole('tab', { name: /^reserved$/i }));
    const list = screen.getByLabelText('Allocations');
    expect(within(list).getByText('Doctor Token')).toBeInTheDocument();
    expect(within(list).queryByText('Event Shirt (L)')).not.toBeInTheDocument();
  });

  it('issues a reserved allocation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: 'operations' });
    await screen.findByLabelText('Allocations');

    const issueButtons = await screen.findAllByRole('button', { name: /^issue$/i });
    expect(issueButtons.length).toBeGreaterThan(0);
    const issueBtn = issueButtons[0];
    expect(issueBtn).toBeDefined();
    await user.click(issueBtn!);

    const dialog = await screen.findByRole('dialog', { name: /issue allocation/i });
    await user.click(within(dialog).getByRole('button', { name: /confirm issue/i }));

    await waitFor(() => {
      expect(screen.getAllByText('issued').length).toBeGreaterThan(0);
    });
  });

  it('issues a serialized allocation with the chosen serial units', async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(<AllocationsPage />, { role: 'operations', repo });
    await screen.findByLabelText('Allocations');

    await user.click(issueButtonFor('mWellness Smart Watch'));
    const dialog = await screen.findByRole('dialog', { name: /issue allocation/i });

    // alloc-4 reserves 8 smart watches; the first 8 in-stock serials are
    // pre-selected. Swap one selection to prove the chosen serials go out.
    await user.click(within(dialog).getByText('SMART-WATCH-SN0001')); // deselect
    await user.click(within(dialog).getByText('SMART-WATCH-SN0009')); // select

    await user.click(within(dialog).getByRole('button', { name: /confirm issue/i }));

    await waitFor(async () => {
      const data = await repo.getData();
      const status = (id: string) =>
        data.units.find((u) => u.id === id)?.status;
      // The 8 chosen serials (u2..u8 + u9) are issued; the deselected u1 is not.
      expect(status('smart-watch-u9')).toBe('issued');
      expect(status('smart-watch-u1')).toBe('in_stock');
      for (const i of [2, 3, 4, 5, 6, 7, 8]) {
        expect(status(`smart-watch-u${i}`)).toBe('issued');
      }
      const issued = data.units.filter(
        (u) => u.productId === 'smart-watch' && u.status === 'issued',
      );
      // 8 newly issued + the 1 seeded field-assigned VIP unit.
      expect(issued).toHaveLength(9);
    });
  });

  it('disables confirm until exactly the required serials are selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: 'operations' });
    await screen.findByLabelText('Allocations');

    await user.click(issueButtonFor('mWellness Smart Watch'));
    const dialog = await screen.findByRole('dialog', { name: /issue allocation/i });
    const confirm = within(dialog).getByRole('button', { name: /confirm issue/i });

    // Pre-selected at the required count (8) → enabled.
    expect(confirm).toBeEnabled();

    // Drop below the required count → disabled with a clear hint.
    await user.click(within(dialog).getByText('SMART-WATCH-SN0002'));
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText(/select 8 of 12 units/i)).toBeInTheDocument();

    // Restore the count → enabled again.
    await user.click(within(dialog).getByText('SMART-WATCH-SN0002'));
    expect(confirm).toBeEnabled();
  });

  it('issues a non-serialized allocation without a serial picker', async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(<AllocationsPage />, { role: 'operations', repo });
    await screen.findByLabelText('Allocations');

    await user.click(issueButtonFor('Doctor Token'));
    const dialog = await screen.findByRole('dialog', { name: /issue allocation/i });

    // Non-serialized: no serial selection UI, confirm immediately available.
    expect(within(dialog).queryByLabelText('Serial units')).not.toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: /confirm issue/i });
    expect(confirm).toBeEnabled();

    await user.click(confirm);

    await waitFor(async () => {
      const data = await repo.getData();
      expect(data.allocations.find((a) => a.id === 'alloc-3')?.status).toBe(
        'issued',
      );
    });
  });
});
