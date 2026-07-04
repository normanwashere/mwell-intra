import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FinancePage } from './FinancePage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('FinancePage', () => {
  it('shows valuation KPIs and audit trail', async () => {
    renderWithProviders(<FinancePage />, { role: 'finance' });
    expect(await screen.findByText('Total value')).toBeInTheDocument();
    expect(screen.getByText('Promo give-aways')).toBeInTheDocument();
    expect(screen.getByText(/valuation by category/i)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Audit trail' })).toBeInTheDocument();
  });

  it('breaks valuation into devices and merchandise', async () => {
    renderWithProviders(<FinancePage />, { role: 'finance' });
    expect(await screen.findByText(/wearable devices/i)).toBeInTheDocument();
    expect(screen.getByText(/marketing merchandise/i)).toBeInTheDocument();
  });

  it('clears a variance when finance posts an adjustment', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FinancePage />, { role: 'finance' });
    const recon = await screen.findByLabelText('Reconciliation');
    const before = within(recon).getAllByRole('button', { name: /post adjustment/i });
    expect(before.length).toBeGreaterThan(0);

    const adjustBtn = before[0];
    expect(adjustBtn).toBeDefined();
    await user.click(adjustBtn!);
    await waitFor(() => {
      expect(screen.getByText(/variance cleared/i)).toBeInTheDocument();
    });
  });
});
