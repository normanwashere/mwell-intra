import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '@/app/App';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('Fulfillment conversion destination through the Warehouse shell', () => {
  it.each(['orders', 'conversion'])('admits the operator with manage_returns from %s without kit authority', async (tab) => {
    renderWithProviders(<App />, {
      role: 'warehouse_operator', source: 'supabase', capabilities: ['manage_returns'], route: `/fulfillment?tab=${tab}`,
    });
    const tabs = await screen.findByRole('tablist', { name: 'Fulfillment workspace' });
    expect(within(tabs).queryByRole('tab', { name: 'Kits and re-kits' })).not.toBeInTheDocument();
    const conversion = within(tabs).getByRole('tab', { name: 'Stock conversion' });
    if (tab === 'orders') await userEvent.click(conversion);
    expect(conversion).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('region', { name: 'Stock conversion' })).toHaveTextContent('governed live service');
    expect(screen.queryByRole('button', { name: 'Create kit definition' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create re-kit work order' })).not.toBeInTheDocument();
  });

  it('does not admit conversion from an order-only capability or direct selector', async () => {
    renderWithProviders(<App />, {
      role: 'warehouse_operator', source: 'supabase', capabilities: ['issue_items'], route: '/fulfillment?tab=conversion',
    });
    await screen.findByRole('heading', { name: 'Pick & Pack' });
    expect(screen.queryByRole('tab', { name: 'Stock conversion' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Stock conversion' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Orders and event demand' })).toBeInTheDocument();
  });

  it('admits inspect_quality-only through ModuleGate and the shell navigation without operational grants', async () => {
    renderWithProviders(<App />, {
      role: 'warehouse_operator', source: 'supabase', capabilities: ['inspect_quality'], route: '/fulfillment?tab=conversion',
    });
    const tabs = await screen.findByRole('tablist', { name: 'Fulfillment workspace' });
    expect(within(tabs).getByRole('tab', { name: 'Stock conversion' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('region', { name: 'Stock conversion' })).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.some(link => link.getAttribute('href')?.startsWith('/fulfillment'))).toBe(true);
    expect(links.some(link => link.getAttribute('href')?.startsWith('/returns'))).toBe(false);
    expect(within(tabs).queryByRole('tab', { name: 'Kits and re-kits' })).not.toBeInTheDocument();
    expect(within(tabs).queryByRole('tab', { name: 'Return cases' })).not.toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Orders and events' }));
    expect(screen.queryByRole('button', { name: 'New order / demand' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allocate stock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Receive physical return' })).not.toBeInTheDocument();
  });
});
