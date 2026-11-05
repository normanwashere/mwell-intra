import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildSeed } from '@intra/data-kit';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';
import { FulfillmentPage } from './FulfillmentPage';
import { InventoryPage } from './InventoryPage';

describe('recovery queue priority and status semantics', () => {
  it('does not collapse the existing overview on the unrelated kits workspace', async () => {
    renderWithProviders(<FulfillmentPage />, { route: '/fulfillment?tab=kits' });
    expect(await screen.findByRole('tab', { name: 'Kits and re-kits' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Workload overview')).not.toBeInTheDocument();
  });
  it('keeps receiving guidance collapsed without hiding the purchase-order queue', async () => {
    renderWithProviders(<PurchaseOrdersPage />);
    const heading = await screen.findByText('From rider arrival to available stock');
    const details = heading.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByRole('list', { name: 'Purchase orders' })).toBeVisible();
    await userEvent.setup().click(within(details!).getByText('Receiving guidance'));
    expect(details).toHaveAttribute('open');
  });

  it('keeps return cases ahead of optional handoff guidance and workload summaries', async () => {
    renderWithProviders(<FulfillmentPage />, { route: '/fulfillment?tab=returns' });
    const guidance = await screen.findByText('Return handoff guidance');
    expect(guidance.closest('details')).not.toHaveAttribute('open');
    const overview = screen.getByText('Workload overview').closest('details');
    expect(overview).not.toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Return cases' })).toBeVisible();
  });

  it.each(['delivery_failed', 'returned_to_sender'] as const)('shows the released %s shipment as an exception, not success', async shipmentStatus => {
    const seed = buildSeed();
    seed.fulfillmentOrders = [{
      id: 'failed-order', externalReference: 'FAILED-ORDER', source: 'ecommerce', status: 'released',
      deliveryMethod: 'shipment', shipmentStatus, deliveryFailureReason: 'Recipient unavailable',
      createdBy: 'operator', createdAt: '2026-11-05', updatedAt: '2026-11-05',
      lines: [{ productId: 'shirt-l', quantity: 1, pickedQuantity: 1, pickedSerialNumbers: [] }], packaging: [], shipmentEvents: [],
    }];
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(seed), route: '/fulfillment?tab=orders&status=all' });
    const badge = await screen.findByText(shipmentStatus === 'delivery_failed' ? 'Delivery failed' : 'Returned to sender');
    expect(badge).toHaveClass('text-rose-800');
    expect(badge).not.toHaveClass('text-emerald-800');
  });

  it('marks low SKU availability in text and uses the stronger local low-stock token', async () => {
    const seed = buildSeed();
    seed.products = seed.products.filter(product => product.id === 'shirt-l').map(product => ({ ...product, reorderPoint: 100000 }));
    renderWithProviders(<InventoryPage />, { repo: makeRepo(seed) });
    const row = await screen.findByRole('button', { name: /Event Shirt.*available/ });
    expect(await within(row).findByText('Low stock')).toBeVisible();
    expect(within(row).getByText('Low stock')).toHaveClass('text-rose-700', 'dark:text-rose-300');
    expect(screen.getByText('1 low')).toHaveClass('text-rose-700', 'dark:text-rose-300');
  });
});
