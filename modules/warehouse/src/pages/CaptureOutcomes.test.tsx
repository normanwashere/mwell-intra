import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runAction } from '@intra/data-kit';
import { ReceivingPage } from './ReceivingPage';
import { StorageAreasPage } from './StorageAreasPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@intra/data-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intra/data-kit')>();
  return { ...actual, runAction: vi.fn(async (context: Parameters<typeof actual.runAction>[0]) => {
    context.onStatus?.('queued');
    return false;
  }) };
});

describe('Queued capture outcome presentation', () => {
  it('retains a receipt draft without presenting a queued intent as failure or receipt success', async () => {
    const repo = makeRepo();
    const before = await repo.getData();
    const user = userEvent.setup();
    renderWithProviders(<ReceivingPage />, { repo });
    await user.selectOptions(await screen.findByLabelText('Product'), 'doctor-token');
    await user.click(screen.getByRole('button', { name: /add to receipt/i }));
    await user.type(screen.getByLabelText('Exception reason'), 'Approved emergency delivery');
    await user.upload(screen.getByLabelText('Capture photo evidence'), new File(['photo'], 'delivery.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: /receive .*item/i }));
    expect(await screen.findByText(/Receipt queued for sync, not yet received into stock/)).toBeVisible();
    expect(screen.queryByText(/The receipt was not saved/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /receive .*item/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Product')).toBeDisabled();
    expect(screen.getByLabelText('Exception reason')).toBeDisabled();
    expect(await repo.getData()).toEqual(before);
  });

  it('retains putaway identity, quantity and destination until the intent is committed', async () => {
    const seed = await makeRepo().getData();
    seed.stockLevels = [{ productId: 'shirt-l', locationId: 'loc-wh', quantity: 60 }];
    const repo = makeRepo(seed);
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
    expect(await within(dialog).findByText(/Putaway queued for sync, not yet committed/)).toBeVisible();
    expect(quantity).toHaveValue(50);
    expect(quantity).toBeDisabled();
    expect(within(dialog).getByLabelText('Enter destination bin manually')).toBeDisabled();
    expect(within(dialog).getByText('Selected PASIG-A-01')).toBeVisible();
    expect((await repo.getData()).stockLevels).toEqual(seed.stockLevels);
    const firstInput = vi.mocked(runAction).mock.calls.at(-1)?.[4];
    await user.click(within(dialog).getByRole('button', { name: 'Confirm putaway' }));
    const retryInput = vi.mocked(runAction).mock.calls.at(-1)?.[4];
    expect(firstInput?.idempotencyKey).toMatch(/^putaway-/);
    expect(retryInput).toEqual(firstInput);
  });
});
