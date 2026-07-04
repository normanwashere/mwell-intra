import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PricingPage } from './PricingPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('PricingPage', () => {
  it('shows landed cost table, supplier variance and bundles', async () => {
    renderWithProviders(<PricingPage />, { role: 'pricing' });
    expect(await screen.findByText('Pricing')).toBeInTheDocument();
    expect(screen.getByLabelText('Pricing table')).toBeInTheDocument();
    expect(screen.getByText(/cost variance by supplier/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Bundles')).toBeInTheDocument();
    expect(screen.getByText('Wellness Starter Kit')).toBeInTheDocument();
  });

  it('sets a product sell price from a table row', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PricingPage />, { role: 'pricing' });
    const table = await screen.findByLabelText('Pricing table');

    await user.click(within(table).getByText(/Doctor Token/i));
    const dialog = await screen.findByRole('dialog', { name: /set price/i });
    const input = within(dialog).getByLabelText(/sell price/i);
    await user.clear(input);
    await user.type(input, '999');
    await user.click(within(dialog).getByRole('button', { name: /save price/i }));

    await waitFor(() => {
      expect(
        within(screen.getByLabelText('Pricing table')).getByText('₱999'),
      ).toBeInTheDocument();
    });
  });
});
