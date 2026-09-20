import { describe, it, expect } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { ProcurementPage } from './ProcurementPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('ProcurementPage', () => {
  it('keeps an alert product scoped and lets the planner return to all shortages', async () => {
    renderWithProviders(<ProcurementPage />, { role: 'warehouse_admin', route: '/procurement?product=otg-bag' });
    const filter = await screen.findByRole('combobox', { name: 'Replenishment product' });
    expect(filter).toHaveValue('otg-bag');
    const table = screen.getByRole('table', { name: 'Reorder worklist' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    fireEvent.change(filter, { target: { value: '' } });
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(2);
  });
  it('presents the page as Warehouse replenishment with a Procurement handoff', async () => {
    renderWithProviders(<ProcurementPage />, { role: 'procurement' });
    expect(await screen.findByRole('heading', { name: /replenishment planning/i })).toBeInTheDocument();
    expect(screen.getByText(/warehouse.*procurement handoff/i)).toBeInTheDocument();
  });

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

  it('keeps Warehouse-only planning read-only at the Procurement boundary', async () => {
    renderWithProviders(<ProcurementPage />, { role: 'procurement' });
    await screen.findByText(/reorder worklist/i);
    expect(screen.queryByRole('button', { name: /draft all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /create procurement request/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Procurement owns request creation/i)).toBeInTheDocument();
  });
});
