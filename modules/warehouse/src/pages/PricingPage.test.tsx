import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildSeed } from '@intra/data-kit';
import { PricingPage } from './PricingPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { money } from '@/components/ui';

describe('PricingPage', () => {
  it('makes every product accessible through bounded load-more batches', async () => {
    const user = userEvent.setup();
    const seed = structuredClone(buildSeed());
    seed.products = Array.from({ length: 25 }, (_, index) => ({
      ...seed.products[0]!, id: `pricing-${index}`, sku: `PRICE-${index}`,
      name: `Pricing product ${index}`, unitCost: 0,
    }));
    seed.lots = [];
    renderWithProviders(<PricingPage />, { role: 'pricing', repo: makeRepo(seed) });
    const table = await screen.findByLabelText('Pricing table');
    expect(screen.getByText('Showing 12 of 25 products')).toBeInTheDocument();
    expect(within(table).queryByText('Pricing product 12', { exact: false })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more products' }));
    expect(screen.getByText('Showing 24 of 25 products')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more products' }));
    expect(screen.getByText('Showing 25 of 25 products')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more products' })).not.toBeInTheDocument();
    for (let index = 0; index < 25; index += 1) {
      expect(within(table).getByText(`Pricing product ${index}`)).toBeInTheDocument();
    }
    await user.click(within(table).getByText('Pricing product 24', { exact: false }));
    expect(await screen.findByRole('dialog', { name: 'Pricing governance' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open governed pricing' })).not.toBeInTheDocument();
  });

  it.each([0, 2])('marks a bundle with %i of 3 constituents incomplete without partial or zero pricing', async (count) => {
    const seed = structuredClone(buildSeed());
    const ids = ['smart-watch', 'shirt-l', 'doctor-token'].slice(0, count);
    seed.products = seed.products.filter((product) => ids.includes(product.id));
    seed.lots = [];
    renderWithProviders(<PricingPage />, { role: 'pricing', repo: makeRepo(seed) });
    const bundles = await screen.findByRole('list', { name: 'Bundles' });
    const kit = within(bundles).getByText('Wellness Starter Kit').closest('li')!;
    expect(within(kit).getByText('Unavailable')).toBeInTheDocument();
    expect(within(kit).getByText(`Incomplete bundle: ${3 - count} of 3 products unavailable.`)).toBeInTheDocument();
    expect(kit).not.toHaveTextContent('Kit cost');
    expect(kit).not.toHaveTextContent('margin');
    expect(kit).not.toHaveTextContent('markup');
    const name = within(kit).getByText('Wellness Starter Kit');
    expect(name).toHaveClass('min-w-0', 'break-words');
    expect(name.parentElement).toHaveClass('flex-wrap', 'gap-2');
    expect(within(kit).getByText('Unavailable')).toHaveClass('min-w-0', 'break-words', 'max-w-full');
    expect(kit.textContent).not.toMatch(/[\u20b1]|PHP/);
  });

  it.each([0, 100])('preserves legitimate complete bundle pricing at unit cost %i', async (unitCost) => {
    const seed = structuredClone(buildSeed());
    seed.products = seed.products.map((product) => ({ ...product, unitCost }));
    seed.lots = [];
    renderWithProviders(<PricingPage />, { role: 'pricing', repo: makeRepo(seed) });
    const bundles = await screen.findByRole('list', { name: 'Bundles' });
    const kit = within(bundles).getByText('Wellness Starter Kit').closest('li')!;
    expect(kit).not.toHaveTextContent('Unavailable');
    expect(kit).not.toHaveTextContent('Incomplete');
    expect(kit).toHaveTextContent(`Kit cost ${money(unitCost * 3)}`);
    expect(kit).toHaveTextContent('markup 35%');
    expect(kit).not.toHaveTextContent('margin');
    expect(within(kit).getByText(money(Math.round(unitCost * 3 * 1.35 / 10) * 10))).toBeInTheDocument();
  });

  it('shows landed cost table, supplier variance and bundles', async () => {
    renderWithProviders(<PricingPage />, { role: 'pricing' });
    expect(await screen.findByText('Pricing')).toBeInTheDocument();
    expect(screen.getByLabelText('Pricing table')).toBeInTheDocument();
    expect(screen.getByText(/cost variance by supplier/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Bundles')).toBeInTheDocument();
    expect(screen.getByText('Wellness Starter Kit')).toBeInTheDocument();
    expect(screen.getByText('Price context and Product governance')).toBeInTheDocument();
    expect(screen.queryByText('Tap a row to set the sell price')).not.toBeInTheDocument();
    expect(screen.queryByText('Set', { exact: true })).not.toBeInTheDocument();
  });

  it('keeps pricing-only viewers in read-only context without a Product access dead end', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PricingPage />, { role: 'pricing' });
    const table = await screen.findByLabelText('Pricing table');

    await user.click(within(table).getByText(/Doctor Token/i));
    const dialog = await screen.findByRole('dialog', {
      name: /pricing governance/i,
    });
    expect(within(dialog).queryByLabelText(/sell price/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: /open governed pricing/i })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Product team/)).toBeInTheDocument();
    expect(within(dialog).getByText('Current price')).toBeInTheDocument();
  });
});
