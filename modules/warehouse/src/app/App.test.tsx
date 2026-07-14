import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { App } from './App';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useWarehouse } from './store';
import { InMemoryRepository } from '@/data/inMemoryRepository';

function ControlFailureProbe() {
  const { inspectQuality } = useWarehouse();
  const [result, setResult] = useState('idle');
  return (
    <>
      <button
        onClick={() => void inspectQuality({
          idempotencyKey: 'provider-test-001', sourceType: 'receipt', sourceId: 'missing',
          productId: 'missing', quantity: 1, disposition: 'accepted',
        }).then((ok) => setResult(String(ok)))}
      >Run guarded command</button>
      <output>{result}</output>
    </>
  );
}

class DeniedControlRepository extends InMemoryRepository {
  attempts = 0;

  override async inspectQuality(): Promise<never> {
    this.attempts += 1;
    throw new Error('Not authorized: warehouse.inspect_quality');
  }
}

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

  it('uses live capabilities instead of display-role grants in Supabase mode', async () => {
    const denied = renderWithProviders(<App />, {
      role: 'logistics_supervisor',
      source: 'supabase',
      capabilities: [],
      route: '/receiving',
    });
    expect(
      await screen.findByText(/don't have access to this page/i),
    ).toBeInTheDocument();
    denied.unmount();

    renderWithProviders(<App />, {
      role: 'finance',
      source: 'supabase',
      capabilities: ['receive_stock'],
      route: '/receiving',
    });
    expect(
      await screen.findByText(/scan & tag incoming inventory/i),
    ).toBeInTheDocument();
  });

  it('guards dashboard and inventory routes with live capabilities', async () => {
    const dashboard = renderWithProviders(<App />, {
      role: 'warehouse_admin',
      source: 'supabase',
      capabilities: [],
      route: '/',
    });
    expect(
      await screen.findByText(/don't have access to this page/i),
    ).toBeInTheDocument();
    dashboard.unmount();

    renderWithProviders(<App />, {
      role: 'finance',
      source: 'supabase',
      capabilities: ['manage_inventory'],
      route: '/inventory',
    });
    expect(
      await screen.findByRole('heading', { name: /inventory/i }),
    ).toBeInTheDocument();
  });

  it('allows logistics to open the dedicated Scan workspace', async () => {
    renderWithProviders(<App />, {
      role: 'logistics_supervisor',
      route: '/scan',
    });
    expect(await screen.findByRole('heading', { name: 'Scan' })).toBeInTheDocument();
    expect(screen.getByLabelText('Scan operations')).toBeInTheDocument();
  });

  it('allows logistics to open the task queue', async () => {
    renderWithProviders(<App />, {
      role: 'logistics_supervisor',
      route: '/tasks',
    });
    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Due' })).toBeInTheDocument();
  });

  it('allows inspection roles to open quality control', async () => {
    renderWithProviders(<App />, {
      role: 'operations',
      route: '/quality',
    });
    expect(await screen.findByRole('heading', { name: 'Quality control' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pending' })).toBeInTheDocument();
  });

  it('routes authorized users to stock approvals and exceptions', async () => {
    const approval = renderWithProviders(<App />, {
      role: 'finance',
      route: '/approvals',
    });
    expect(await screen.findByRole('heading', { name: 'Stock approvals' })).toBeInTheDocument();
    approval.unmount();

    renderWithProviders(<App />, {
      role: 'operations',
      route: '/exceptions',
    });
    expect(await screen.findByRole('heading', { name: 'Warehouse exceptions' })).toBeInTheDocument();
  });

  it('routes authorized users to imports, reports, and operation policies', async () => {
    const imports = renderWithProviders(<App />, { role: 'warehouse_admin', route: '/imports' });
    expect(await screen.findByRole('heading', { name: 'Warehouse imports' })).toBeInTheDocument();
    imports.unmount();
    const reports = renderWithProviders(<App />, { role: 'bi_analyst', route: '/reports' });
    expect(await screen.findByRole('heading', { name: 'Inventory position report' })).toBeInTheDocument();
    reports.unmount();
    renderWithProviders(<App />, { role: 'logistics_supervisor', route: '/operation-routes' });
    expect(await screen.findByRole('heading', { name: 'Operation routes' })).toBeInTheDocument();
  });

  it('returns false when a guarded control command is denied', async () => {
    renderWithProviders(<ControlFailureProbe />, { repo: new DeniedControlRepository() });
    fireEvent.click(screen.getByRole('button', { name: /run guarded command/i }));
    expect(await screen.findByText('false')).toBeInTheDocument();
    expect(await screen.findByText(/not authorized: warehouse\.inspect_quality/i)).toBeInTheDocument();
  });

  it('blocks live mutations before the repository when capability refresh is empty', async () => {
    const repo = new DeniedControlRepository();
    renderWithProviders(<ControlFailureProbe />, {
      repo,
      source: 'supabase',
      capabilities: [],
    });

    fireEvent.click(screen.getByRole('button', { name: /run guarded command/i }));
    expect(await screen.findByText('false')).toBeInTheDocument();
    expect(repo.attempts).toBe(0);
  });
});
