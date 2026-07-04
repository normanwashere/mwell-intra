import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuppliersPage } from './SuppliersPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('SuppliersPage', () => {
  it('lists seeded suppliers', async () => {
    renderWithProviders(<SuppliersPage />, { role: 'procurement' });
    const list = await screen.findByLabelText('Suppliers');
    expect(within(list).getByText(/mWellness Wearables/i)).toBeInTheDocument();
  });

  it('adds a new supplier', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SuppliersPage />, { role: 'procurement' });
    await screen.findByLabelText('Suppliers');

    await user.click(screen.getByRole('button', { name: /add supplier/i }));
    const dialog = await screen.findByRole('dialog', { name: /add supplier/i });
    await user.type(within(dialog).getByLabelText('Supplier name'), 'Acme Health Mfg.');
    await user.click(within(dialog).getByRole('button', { name: /save supplier/i }));

    await waitFor(() => {
      expect(screen.getByText('Acme Health Mfg.')).toBeInTheDocument();
    });
  });

  it('edits an existing supplier', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SuppliersPage />, { role: 'procurement' });
    await screen.findByLabelText('Suppliers');

    await user.click(screen.getByRole('button', { name: /edit mWellness Wearables/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit supplier/i });
    const nameInput = within(dialog).getByLabelText('Supplier name');
    await user.clear(nameInput);
    await user.type(nameInput, 'mWellness Wearables Co.');
    await user.click(within(dialog).getByRole('button', { name: /save supplier/i }));

    await waitFor(() => {
      expect(screen.getByText('mWellness Wearables Co.')).toBeInTheDocument();
    });
  });
});
