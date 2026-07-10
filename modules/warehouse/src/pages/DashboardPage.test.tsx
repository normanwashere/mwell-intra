import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { axe } from 'jest-axe';
import { DashboardPage } from './DashboardPage';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { Role } from '@/domain/types';

const ALL_ROLES: Role[] = [
  'logistics_supervisor',
  'operations',
  'finance',
  'bi_analyst',
  'business_unit',
  'marketing',
  'procurement',
  'pricing',
  'warehouse_admin',
];

const FIRST_RENDER_TIMEOUT = 10_000;

describe('DashboardPage', () => {
  it('shows the active role and its KPIs (BI analyst)', async () => {
    renderWithProviders(<DashboardPage />, { role: 'bi_analyst' });
    expect(
      await screen.findByRole('heading', { name: 'BI Analyst' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Active SKUs')).toBeInTheDocument();
    expect(screen.getByText('Inventory Value')).toBeInTheDocument();
    expect(screen.getByText('Device return rate')).toBeInTheDocument();
  }, FIRST_RENDER_TIMEOUT);

  it('renders analytics panels for the BI analyst', async () => {
    renderWithProviders(<DashboardPage />, { role: 'bi_analyst' });
    expect(
      await screen.findByRole('heading', { name: /fast-moving skus/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /consumption by event type/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /device utilization/i })).toBeInTheDocument();
  });

  it('tailors the dashboard to the logistics supervisor', async () => {
    renderWithProviders(<DashboardPage />, { role: 'logistics_supervisor' });
    expect(await screen.findByText(/low-stock alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/reconciliation/i)).toBeInTheDocument();
    expect(screen.getByText(/recent activity/i)).toBeInTheDocument();
    // analytics panels are NOT shown to logistics
    expect(screen.queryByText(/device utilization/i)).not.toBeInTheDocument();
  });

  it('tailors the dashboard to procurement', async () => {
    renderWithProviders(<DashboardPage />, { role: 'procurement' });
    expect(await screen.findByText(/reorder worklist/i)).toBeInTheDocument();
    expect(screen.getByText(/open purchase orders/i)).toBeInTheDocument();
    expect(screen.getByText('Stockout risk')).toBeInTheDocument();
  });

  it('tailors the dashboard to finance', async () => {
    renderWithProviders(<DashboardPage />, { role: 'finance' });
    expect(await screen.findByText(/valuation by category/i)).toBeInTheDocument();
    expect(screen.getByText(/asset register/i)).toBeInTheDocument();
  });

  it('tailors the dashboard to operations', async () => {
    renderWithProviders(<DashboardPage />, { role: 'operations' });
    expect(
      await screen.findByRole('heading', { name: /pending reservations/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^events$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /consumption by event type/i })).toBeInTheDocument();
  });

  it('tailors the dashboard to pricing', async () => {
    renderWithProviders(<DashboardPage />, { role: 'pricing' });
    expect(await screen.findByText(/top skus by value/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /valuation by category/i })).toBeInTheDocument();
  });

  it('tailors the dashboard to marketing', async () => {
    renderWithProviders(<DashboardPage />, { role: 'marketing' });
    expect(await screen.findByRole('heading', { name: /consumption by event type/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^events$/i })).toBeInTheDocument();
  });

  it('tailors the dashboard to business unit', async () => {
    renderWithProviders(<DashboardPage />, { role: 'business_unit' });
    expect(await screen.findByText(/low-stock alerts/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /pending reservations/i })).toBeInTheDocument();
  });

  it('gives the Warehouse Administrator an operational control overview', async () => {
    renderWithProviders(<DashboardPage />, { role: 'warehouse_admin' });
    expect(
      await screen.findByRole('heading', { name: 'Warehouse Administrator' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/low-stock alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/reconciliation/i)).toBeInTheDocument();
  });

  it('lists low-stock items for logistics', async () => {
    renderWithProviders(<DashboardPage />, { role: 'logistics_supervisor' });
    expect(await screen.findByText(/low-stock alerts/i)).toBeInTheDocument();
    expect(screen.getAllByText(/left$/i).length).toBeGreaterThan(0);
  });

  it(
    'renders an overview and interactive panels for every role',
    async () => {
      for (const role of ALL_ROLES) {
        const { unmount } = renderWithProviders(<DashboardPage />, { role });
        expect(await screen.findByRole('heading', { name: /overview$/i })).toBeInTheDocument();
        const buttons = screen
          .getAllByRole('button')
          .filter((b) => !/export data/i.test(b.textContent ?? ''));
        buttons.forEach((b) => fireEvent.click(b));
        unmount();
      }
    },
    // Renders every role against the full 90-day seed history — needs more
    // headroom than the 5s default.
    15_000,
  );

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<DashboardPage />, { role: 'bi_analyst' });
    await screen.findByRole('heading', { name: /fast-moving skus/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
