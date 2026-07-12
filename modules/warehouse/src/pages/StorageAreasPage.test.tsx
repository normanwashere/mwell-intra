import { describe, expect, it } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StorageAreasPage } from './StorageAreasPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

describe('StorageAreasPage', () => {
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
