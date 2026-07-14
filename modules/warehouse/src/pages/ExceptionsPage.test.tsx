import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExceptionsPage } from './ExceptionsPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

async function repositoryWithException(unitCost: number) {
  const source = makeRepo();
  const data = await source.getData();
  const product = data.products.find((row) => row.id === 'shirt-l')!;
  product.unitCost = unitCost;
  const repo = makeRepo(data);
  const location = data.locations.find((row) => row.type === 'warehouse')!;
  const expected = data.stockLevels
    .filter((row) => row.productId === product.id && row.locationId === location.id && !row.binId)
    .reduce((sum, row) => sum + row.quantity, 0);
  const count = await repo.recordCycleCount({
    locationId: location.id,
    actor: 'demo-counter',
    lines: [{ productId: product.id, expected, counted: Math.max(0, expected - 20) }],
  });
  await repo.submitCycleCount({
    idempotencyKey: `exception-${unitCost}`,
    cycleCountId: count.id,
    reason: 'Variance investigation',
  });
  return repo;
}

describe('ExceptionsPage', () => {
  it('preserves query-string filters and never offers waive for a P1 exception', async () => {
    const repo = await repositoryWithException(600);
    renderWithProviders(<ExceptionsPage />, {
      repo,
      role: 'logistics_supervisor',
      route: '/exceptions?severity=P1&status=open',
    });

    expect(await screen.findByLabelText('Severity')).toHaveValue('P1');
    expect(screen.getByLabelText('Status')).toHaveValue('open');
    const queue = await screen.findByLabelText('Warehouse exceptions');
    expect(within(queue).getByText('P1')).toBeInTheDocument();
    expect(within(queue).queryByRole('button', { name: /waive/i })).not.toBeInTheDocument();
  });

  it('requires resolution text before resolving a P2 exception', async () => {
    const user = userEvent.setup();
    const repo = await repositoryWithException(100);
    renderWithProviders(<ExceptionsPage />, { repo, role: 'logistics_supervisor' });

    const queue = await screen.findByLabelText('Warehouse exceptions');
    await user.click(within(queue).getByRole('button', { name: 'Review exception' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolve exception' });
    expect(within(dialog).getByRole('button', { name: 'Resolve' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Resolution'), 'Verified recount and documented root cause');
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Resolve exception' })).not.toBeInTheDocument());
    expect(await screen.findByText(/no exceptions match/i)).toBeInTheDocument();
  });

  it('keeps exception controls read-only for operations users', async () => {
    const repo = await repositoryWithException(100);
    renderWithProviders(<ExceptionsPage />, { repo, role: 'operations' });

    const queue = await screen.findByLabelText('Warehouse exceptions');
    expect(within(queue).getByText('P2')).toBeInTheDocument();
    expect(within(queue).queryByRole('button')).not.toBeInTheDocument();
  });
});
