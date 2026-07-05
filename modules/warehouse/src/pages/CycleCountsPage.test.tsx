import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CycleCountsPage } from './CycleCountsPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('CycleCountsPage', () => {
  it('never prefills counted quantities with the expected number (WH-18)', async () => {
    renderWithProviders(<CycleCountsPage />, { role: 'finance' });
    await screen.findByText(/count sheet/i);

    // Inputs start EMPTY; expected shows as a placeholder reference only.
    const shirtInput = screen.getByLabelText(/Counted Event Shirt \(L\)/i);
    expect(shirtInput).toHaveValue(null);
    expect(shirtInput).toHaveAttribute('placeholder', expect.stringMatching(/^Exp\./));

    // No fake "balanced" state and no submit before a real entry.
    expect(screen.queryByText('balanced')).not.toBeInTheDocument();
    expect(screen.getByText('not started')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /submit count/i }),
    ).toBeDisabled();
  });

  it('flags variances once a real value is entered', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: 'finance' });
    await screen.findByText(/count sheet/i);

    const shirtInput = screen.getByLabelText(/Counted Event Shirt \(L\)/i);
    await user.type(shirtInput, '100');

    // shirt-l expected 120 -> counted 100 -> variance -20 (desktop + mobile).
    expect((await screen.findAllByText('-20')).length).toBeGreaterThan(0);
    expect(screen.getByText(/variance\(s\)/i)).toBeInTheDocument();
  });

  it('shows "balanced" only after a matching entry', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: 'finance' });
    await screen.findByText(/count sheet/i);

    const shirtInput = screen.getByLabelText(/Counted Event Shirt \(L\)/i);
    await user.type(shirtInput, '120'); // matches expected
    expect(screen.getByText('balanced')).toBeInTheDocument();
    expect((await screen.findAllByText('±0')).length).toBeGreaterThan(0);
  });

  it('blind count blanks expected values and records only entered rows', async () => {
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

  it('asks for confirmation when rows are left uncounted, then records', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: 'finance' });
    await screen.findByText(/count sheet/i);

    await user.type(
      screen.getByLabelText(/Counted Event Shirt \(L\)/i),
      '120',
    );
    await user.click(screen.getByRole('button', { name: /submit count/i }));

    // 8 of 9 rows untouched → explicit confirmation before recording.
    const confirm = await screen.findByRole('alertdialog', {
      name: /confirm uncounted rows/i,
    });
    expect(confirm).toHaveTextContent(/8 rows not counted/i);

    await user.click(screen.getByRole('button', { name: /submit anyway/i }));
    await waitFor(() =>
      expect(screen.getByText(/count recorded/i)).toBeInTheDocument(),
    );
  });

  it('records without confirmation when every row is counted in blind mode', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: 'finance' });
    await screen.findByText(/count sheet/i);

    await user.click(screen.getByRole('button', { name: /blind count/i }));
    await user.type(
      screen.getByLabelText(/Counted Event Shirt \(L\)/i),
      '100',
    );
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await waitFor(() =>
      expect(screen.getByText(/count recorded/i)).toBeInTheDocument(),
    );
  });
});
