import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { FinancePage } from './FinancePage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

async function repositoryWithFinanceApproval() {
  const source = makeRepo();
  const data = await source.getData();
  const product = data.products.find((row) => row.id === 'shirt-l')!;
  product.unitCost = 600;
  const repo = makeRepo(data);
  const location = data.locations.find((row) => row.type === 'warehouse')!;
  const expected = data.stockLevels
    .filter((row) => row.productId === product.id && row.locationId === location.id && !row.binId)
    .reduce((sum, row) => sum + row.quantity, 0);
  const count = await repo.recordCycleCount({
    actor: 'demo-counter',
    locationId: location.id,
    lines: [{ productId: product.id, expected, counted: Math.max(0, expected - 20) }],
  });
  const [request] = await repo.submitCycleCount({
    idempotencyKey: 'finance-page-count-submit',
    cycleCountId: count.id,
    reason: 'Quarterly control count',
  });
  await repo.decideStockChange({
    idempotencyKey: 'finance-page-supervisor-decision',
    requestId: request!.id,
    decision: 'approved',
  });
  return repo;
}

describe('FinancePage', () => {
  it('shows valuation KPIs and audit trail', async () => {
    renderWithProviders(<FinancePage />, { role: 'finance' });
    expect(await screen.findByText('Total value')).toBeInTheDocument();
    expect(screen.getByText('Promo give-aways')).toBeInTheDocument();
    expect(screen.getByText(/valuation by category/i)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Audit trail' })).toBeInTheDocument();
  });

  it('breaks valuation into devices and merchandise', async () => {
    renderWithProviders(<FinancePage />, { role: 'finance' });
    expect(await screen.findByText(/wearable devices/i)).toBeInTheDocument();
    expect(screen.getByText(/marketing merchandise/i)).toBeInTheDocument();
  });

  it('shows high-value stock changes without bypass adjustment actions', async () => {
    const repo = await repositoryWithFinanceApproval();
    renderWithProviders(<FinancePage />, { role: 'finance', repo });
    const controls = await screen.findByLabelText('Finance stock-change controls');
    expect(within(controls).getByText('Awaiting Finance')).toBeInTheDocument();
    expect(within(controls).getByText(/PHP 12,000/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open approvals/i })).toHaveAttribute('href', '/approvals');
    expect(screen.queryByRole('button', { name: /post adjustment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /release hold/i })).not.toBeInTheDocument();
  });
});
