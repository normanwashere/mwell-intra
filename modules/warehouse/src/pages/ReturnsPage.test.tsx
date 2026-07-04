import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReturnsPage } from './ReturnsPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('ReturnsPage', () => {
  it('records a customer return and shows it in the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: 'operations' });
    await screen.findByText(/recent returns/i);

    await user.selectOptions(screen.getByLabelText('Product'), 'shirt-l');
    const qty = screen.getByLabelText('Quantity');
    await user.clear(qty);
    await user.type(qty, '3');
    await user.selectOptions(screen.getByLabelText('Reason'), 'wrong size');
    await user.click(screen.getByRole('button', { name: /record return/i }));

    await waitFor(() => {
      const list = screen.getByLabelText('Returns');
      expect(within(list).getByText(/Event Shirt \(L\)/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/return logged/i)).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Returns')).getAllByText('Restocked').length,
    ).toBeGreaterThan(0);
  });

  it('reveals a serial field and requires it for serialized devices', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: 'operations' });
    await screen.findByText(/recent returns/i);

    expect(screen.queryByLabelText('Serial number')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Product'), 'ecg-ring-10');
    expect(screen.getByLabelText('Serial number')).toBeInTheDocument();
    // submit is blocked until a serial is supplied
    expect(screen.getByRole('button', { name: /record return/i })).toBeDisabled();

    await user.type(screen.getByLabelText('Serial number'), 'ECG-RING-10-SN0001');
    expect(screen.getByRole('button', { name: /record return/i })).toBeEnabled();
  });
});
