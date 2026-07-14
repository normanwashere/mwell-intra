import { describe, expect, it } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StorageAreasPage } from './StorageAreasPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

describe('StorageAreasPage', () => {
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
    expect(within(dialog).getByLabelText('Bin code')).toHaveFocus();
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
