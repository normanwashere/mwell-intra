import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { DataPage } from './DataPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('DataPage', () => {
  it('shows export options, data dictionary and metric definitions', async () => {
    renderWithProviders(<DataPage />, { role: 'bi_analyst' });
    expect(await screen.findByText('Data & Reports')).toBeInTheDocument();
    expect(screen.getByLabelText('Data dictionary')).toBeInTheDocument();
    expect(screen.getByLabelText('Metric definitions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /inventory/i })).toBeInTheDocument();
  });
});
