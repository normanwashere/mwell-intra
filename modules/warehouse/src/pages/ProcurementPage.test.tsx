import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcurementPage } from './ProcurementPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('ProcurementPage', () => {
  it('summarises reorder needs and supplier lead times', async () => {
    renderWithProviders(<ProcurementPage />, { role: 'procurement' });
    expect(await screen.findByText('SKUs to reorder')).toBeInTheDocument();
    expect(screen.getByText('Stockout risk')).toBeInTheDocument();
    expect(screen.getByText(/avg lead time/i)).toBeInTheDocument();
  });

  it('lists items needing reorder (e.g. the OTG bag seeded below threshold)', async () => {
    renderWithProviders(<ProcurementPage />, { role: 'procurement' });
    const worklist = await screen.findByText(/reorder worklist/i);
    expect(worklist).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText(/On-The-Go Bag/i)).toBeInTheDocument();
  });

  it('drafts purchase orders for all reorder items at once', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProcurementPage />, { role: 'procurement' });
    await screen.findByText(/reorder worklist/i);

    await user.click(screen.getByRole('button', { name: /draft all/i }));
    expect(await screen.findByText(/drafted .*po/i)).toBeInTheDocument();
  });
});
