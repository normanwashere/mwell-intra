import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportsPage } from './ReportsPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('ReportsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows committed inventory-position columns, totals, and filters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReportsPage />, { role: 'bi_analyst' });
    for (const heading of ['On hand', 'Committed', 'Held', 'Unavailable', 'Available']) {
      await screen.findByRole('columnheader', { name: heading });
    }
    expect(screen.getByLabelText('Inventory position totals')).toHaveTextContent(/on hand/i);
    await user.selectOptions(screen.getByLabelText('Location filter'), 'loc-cebu');
    expect(screen.getAllByText(/Cebu Hub/i).length).toBeGreaterThan(0);
  });

  it('prepares a governed inventory-position export', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      job: { filename: 'inventory-position.csv' },
      download_url: 'https://signed.example/report.csv',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    renderWithProviders(<ReportsPage />, { role: 'bi_analyst', source: 'supabase' });
    await user.click(await screen.findByRole('button', { name: 'Export report' }));
    expect(request).toHaveBeenCalledWith('/api/warehouse/exports', expect.objectContaining({
      body: JSON.stringify({ kind: 'inventory_position' }),
    }));
    expect(await screen.findByText(/private download link expires/i)).toBeInTheDocument();
  });
});
