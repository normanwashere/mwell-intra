import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import * as sharedUi from '@intra/ui';
import * as warehouseUi from '@/components/ui';
import { renderWithProviders } from '@/test/renderWithProviders';
import { DashboardPage } from './DashboardPage';
import { FulfillmentPage } from './FulfillmentPage';
import { ReportsPage } from './ReportsPage';

describe('warehouse operational layout contracts', () => {
  it('uses the shared primitives without warehouse copies or wrappers', () => {
    expect(warehouseUi.PageHeader).toBe(sharedUi.PageHeader);
    expect(warehouseUi.SectionTitle).toBe(sharedUi.SectionTitle);
    expect(warehouseUi.ModuleHero).toBe(sharedUi.ModuleHero);
    expect(warehouseUi.Card).toBe(sharedUi.Card);
  });

  it('uses the common header and unframed analytics sections', async () => {
    renderWithProviders(<DashboardPage />, { role: 'bi_analyst' });
    const title = await screen.findByRole('heading', { name: 'Warehouse dashboard' });
    expect(title.closest('header')).toBeInTheDocument();
    const metric = screen.getByTestId('warehouse-dashboard-hero-metric');
    expect(metric).toHaveClass('border-y', 'min-w-0');
    expect(metric.closest('.card')).toBeNull();
    expect(screen.queryByTestId('warehouse-dashboard-hero-watermark')).toBeNull();
    for (const name of ['Fast-moving SKUs', 'Consumption by event type', 'Device utilization']) {
      const heading = screen.getByRole('heading', { name });
      expect(heading.closest('section')).toHaveClass('min-w-0');
      expect(heading.closest('.section-heading-band')).toBeInTheDocument();
      expect(heading.closest('.card')).toBeNull();
    }
  });

  it('keeps floor shortcuts touch-sized with wrapping labels and distinct sections', async () => {
    renderWithProviders(<DashboardPage />, { role: 'warehouse_operator' });
    const section = await screen.findByRole('region', { name: 'Shift queues' });
    expect(section).toHaveClass('min-w-0');
    expect(within(section).getByRole('heading', { name: 'Shift queues' }).closest('.section-heading-band')).toBeInTheDocument();
    for (const label of ['Receive and inspect', 'Put away', 'Pick & Pack', 'Returns and counts', 'Cycle counts']) {
      const link = within(section).getByRole('link', { name: label });
      expect(link).toHaveClass('min-h-11', 'min-w-0');
      expect(within(link).getByText(label)).toHaveClass('break-words');
    }
  });

  it.each([
    ['/fulfillment?tab=orders', 'Order counters'],
    ['/fulfillment?tab=requests', 'Request counters'],
  ])('keeps %s counters evenly separated with stable label space', async (route, label) => {
    renderWithProviders(<FulfillmentPage />, { role: 'warehouse_supervisor', route });
    const counters = await screen.findByRole('group', { name: label });
    expect(counters).toHaveClass('auto-rows-fr', 'gap-px', 'min-w-0');
    expect(counters).not.toHaveClass('divide-x');
    for (const button of within(counters).getAllByRole('button')) {
      expect(button).toHaveClass('min-h-11', 'min-w-0', 'justify-between');
      expect(button.firstElementChild).toHaveClass('min-h-8', 'break-words');
      expect(button).toHaveAttribute('aria-pressed');
    }
  });

  it('does not nest the inventory report table in an outer card', async () => {
    renderWithProviders(<ReportsPage />, { role: 'warehouse_supervisor' });
    const report = await screen.findByRole('region', { name: 'Committed report' });
    expect(report).toHaveClass('min-w-0');
    expect(within(report).getByRole('heading', { name: 'Committed report' }).closest('.section-heading-band')).toBeInTheDocument();
    expect(report.closest('.card')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export report' }).closest('.card')).toBeNull();
  });
});
