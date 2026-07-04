import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('PurchaseOrdersPage', () => {
  it('lists seeded purchase orders with suppliers', async () => {
    renderWithProviders(<PurchaseOrdersPage />, { role: 'procurement' });
    const list = await screen.findByLabelText('Purchase orders');
    expect(within(list).getAllByText(/mWellness Wearables/i).length).toBeGreaterThan(0);
    expect(within(list).getByText(/MetroPrint Apparel/i)).toBeInTheDocument();
  });

  it('filters purchase orders by status', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: 'procurement' });
    await screen.findByLabelText('Purchase orders');

    await user.click(screen.getByRole('tab', { name: /^closed$/i }));
    const list = screen.getByLabelText('Purchase orders');
    expect(within(list).getByText(/GiftWorks/i)).toBeInTheDocument();
    expect(within(list).queryByText(/mWellness Wearables/i)).not.toBeInTheDocument();
  });

  it('creates a new purchase order', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: 'procurement' });
    await screen.findByLabelText('Purchase orders');

    await user.click(screen.getByRole('button', { name: /new po/i }));
    const dialog = await screen.findByRole('dialog', { name: /new purchase order/i });
    await user.selectOptions(within(dialog).getByLabelText('Product'), 'smart-watch');
    await user.click(within(dialog).getByRole('button', { name: /add line/i }));
    expect(within(dialog).getByLabelText('Draft lines')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /create po/i }));

    await waitFor(() => {
      expect(screen.getByText(/purchase order created/i)).toBeInTheDocument();
    });
  });

  it('receives stock against an open PO', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: 'procurement' });
    await screen.findByLabelText('Purchase orders');

    const receiveBtn = screen.getAllByRole('button', { name: /^receive$/i })[0];
    expect(receiveBtn).toBeDefined();
    await user.click(receiveBtn!);
    const dialog = await screen.findByRole('dialog', { name: /receive against po/i });
    await user.click(within(dialog).getByRole('button', { name: /confirm receipt/i }));

    await waitFor(() => {
      expect(screen.getByText(/received against po/i)).toBeInTheDocument();
    });
  });

  it('cancels an open purchase order', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: 'procurement' });
    await screen.findByLabelText('Purchase orders');

    const cancelBtn = screen.getAllByRole('button', { name: /^cancel$/i })[0];
    expect(cancelBtn).toBeDefined();
    await user.click(cancelBtn!);
    await waitFor(() => {
      expect(screen.getByText(/purchase order cancelled/i)).toBeInTheDocument();
    });
  });
});
