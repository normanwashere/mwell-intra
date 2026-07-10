import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { ScanPage } from './ScanPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('ScanPage', () => {
  it('shows logistics operations and a manual fallback', async () => {
    renderWithProviders(<ScanPage />, { role: 'logistics_supervisor' });
    const actions = await screen.findByLabelText('Scan operations');
    expect(within(actions).getByRole('link', { name: /receive/i })).toBeInTheDocument();
    expect(within(actions).getByRole('link', { name: /count/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/enter barcode manually/i)).toBeInTheDocument();
  });

  it('filters actions by capability', async () => {
    renderWithProviders(<ScanPage />, { role: 'finance' });
    const actions = await screen.findByLabelText('Scan operations');
    expect(within(actions).queryByRole('link', { name: /receive/i })).not.toBeInTheDocument();
  });

  it('resolves a unit serial to its product record', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/inventory/:id" element={<h1>Resolved product</h1>} />
      </Routes>,
      { route: '/scan', role: 'logistics_supervisor' },
    );
    await user.type(
      await screen.findByLabelText('Enter barcode manually'),
      'SMART-WATCH-SN0001',
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('heading', { name: 'Resolved product' })).toBeInTheDocument();
  });
});
