import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from './App';
import { renderWithProviders } from '@/test/renderWithProviders';

const FIRST_RENDER_TIMEOUT = 10_000;

describe('App routing & guards', () => {
  it('renders the dashboard at the root', async () => {
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByTestId('warehouse-dashboard-hero')).toBeInTheDocument();
    expect(screen.getByText(/warehouse dashboard/i)).toBeInTheDocument();
  }, FIRST_RENDER_TIMEOUT);

  it('allows logistics to open Receiving', async () => {
    renderWithProviders(<App />, {
      role: 'logistics_supervisor',
      route: '/receiving',
    });
    expect(await screen.findByText(/scan & tag incoming inventory/i)).toBeInTheDocument();
  });

  it('shows a friendly access-denied page for an unauthorized role', async () => {
    renderWithProviders(<App />, { role: 'finance', route: '/receiving' });
    // finance lacks receive_stock -> explicit access-denied page (not a blank
    // screen), with a way back to the dashboard.
    expect(
      await screen.findByText(/don't have access to this page/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /back to dashboard/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/scan & tag incoming inventory/i),
    ).not.toBeInTheDocument();
  });
});
