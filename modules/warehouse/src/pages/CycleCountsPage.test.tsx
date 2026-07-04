import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CycleCountsPage } from './CycleCountsPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('CycleCountsPage', () => {
  it('shows a balanced sheet by default and flags variances on edit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: 'finance' });
    await screen.findByText(/count sheet/i);
    expect(screen.getByText('balanced')).toBeInTheDocument();

    const shirtInput = screen.getByLabelText(/Counted Event Shirt \(L\)/i);
    await user.clear(shirtInput);
    await user.type(shirtInput, '100');

    // shirt-l expected 120 -> counted 100 -> variance -20 (shown in both the
    // desktop table and the mobile card layout).
    expect((await screen.findAllByText('-20')).length).toBeGreaterThan(0);
    expect(screen.getByText(/variance\(s\)/i)).toBeInTheDocument();
  });

  it('blind count blanks inputs and records only entered rows', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: 'finance' });
    await screen.findByText(/count sheet/i);

    await user.click(screen.getByRole('button', { name: /blind count/i }));
    const shirt = screen.getByLabelText(/Counted Event Shirt \(L\)/i);
    expect(shirt).toHaveValue(null);
    expect(screen.getByRole('button', { name: /submit count/i })).toBeDisabled();

    await user.type(shirt, '100');
    expect(screen.getByText(/1\/9 counted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit count/i })).toBeEnabled();
  });

  it('records a count', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: 'finance' });
    await screen.findByText(/count sheet/i);

    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await waitFor(() =>
      expect(screen.getByText(/count recorded/i)).toBeInTheDocument(),
    );
  });
});
