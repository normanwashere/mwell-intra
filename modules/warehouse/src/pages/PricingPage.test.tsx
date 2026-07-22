import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
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

  it('routes product price changes to Product governance', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PricingPage />, { role: 'pricing' });
    const table = await screen.findByLabelText('Pricing table');

    await user.click(within(table).getByText(/Doctor Token/i));
    const dialog = await screen.findByRole('dialog', {
      name: /pricing governance/i,
    });
    expect(within(dialog).queryByLabelText(/sell price/i)).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: /open governed pricing/i }),
    ).toHaveAttribute('href', '/product/pricing?productId=doctor-token');
  });
});
