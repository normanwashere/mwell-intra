import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ScanPage } from './ScanPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('ScanPage', () => {
  it('shows logistics operations and a manual fallback', async () => {
    renderWithProviders(<ScanPage />, { role: 'logistics_supervisor' });
    const actions = await screen.findByLabelText('Scan operations');
    expect(within(actions).getByRole('link', { name: /receive/i })).toBeInTheDocument();
    expect(within(actions).getByRole('link', { name: /count/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/enter barcode or sku manually/i)).toBeInTheDocument();
  });

  it('filters actions by capability', async () => {
    renderWithProviders(<ScanPage />, { role: 'finance' });
    const actions = await screen.findByLabelText('Scan operations');
    expect(within(actions).queryByRole('link', { name: /receive/i })).not.toBeInTheDocument();
  });
});
