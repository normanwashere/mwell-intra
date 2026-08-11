import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocationsPage } from './LocationsPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('LocationsPage', () => {
  it('lists existing locations and lets logistics add one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LocationsPage />, { role: 'logistics_supervisor' });
    // Seed ships with Pasig Main Warehouse.
    expect(await screen.findByText('Pasig Main Warehouse')).toBeInTheDocument();
    expect(screen.getAllByText(/active bins/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/units? on hand/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /add location/i }));
    await user.type(screen.getByLabelText('Name'), 'Davao Hub');
    await user.click(screen.getByRole('button', { name: /^add location$/i }));

    expect(await screen.findByText('Davao Hub')).toBeInTheDocument();
  });
});
