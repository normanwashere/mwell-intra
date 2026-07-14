import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalsPage } from './ApprovalsPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

async function createVarianceRequest({
  requestedBy = 'demo-counter',
  unitCost,
}: { requestedBy?: string; unitCost?: number } = {}) {
  const source = makeRepo();
  const data = await source.getData();
  const product = data.products.find((row) => row.id === 'shirt-l')!;
  if (unitCost !== undefined) product.unitCost = unitCost;
  const repo = makeRepo(data);
  const location = data.locations.find((row) => row.type === 'warehouse')!;
  const expected = data.stockLevels
    .filter((row) => row.productId === product.id && row.locationId === location.id && !row.binId)
    .reduce((sum, row) => sum + row.quantity, 0);
  const count = await repo.recordCycleCount({
    locationId: location.id,
    category: 'merchandise',
    actor: requestedBy,
    lines: [{ productId: product.id, expected, counted: Math.max(0, expected - 20) }],
  });
  const [request] = await repo.submitCycleCount({
    idempotencyKey: `submit-${requestedBy.replace(/[^A-Za-z0-9_-]/g, '-')}-${unitCost ?? 'default'}`,
    cycleCountId: count.id,
    reason: 'Scheduled control count',
  });
  return { repo, request: request! };
}

describe('ApprovalsPage', () => {
  it.each(['warehouse_operator', 'warehouse_supervisor'] as const)(
    'renders controlled approvals for canonical %s without collapsing delegation',
    async (role) => {
      renderWithProviders(<ApprovalsPage />, { role });
      expect(await screen.findByText(/controlled exceptions/i)).toBeInTheDocument();
      expect(screen.getByText(/delegation never permits the requester/i)).toBeInTheDocument();
    },
  );

  it('identifies the queue as Supervisor-only controlled exceptions', async () => {
    const { repo } = await createVarianceRequest();
    renderWithProviders(<ApprovalsPage />, { repo, role: 'logistics_supervisor' });
    expect(await screen.findByText(/controlled exceptions/i)).toBeInTheDocument();
    expect(screen.getByText(/delegation never permits the requester to approve their own transaction/i)).toBeInTheDocument();
  });

  it('lets the supervisor approve a variance and moves it to recently decided', async () => {
    const user = userEvent.setup();
    const { repo } = await createVarianceRequest();
    renderWithProviders(<ApprovalsPage />, { repo, role: 'logistics_supervisor' });

    const queue = await screen.findByLabelText('Waiting on you approvals');
    expect(within(queue).getByText('Awaiting Warehouse Supervisor')).toBeInTheDocument();
    await user.click(within(queue).getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review stock change' });
    expect(within(dialog).getByText(/separation of duties/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve change' }));

    await user.click(await screen.findByRole('tab', { name: 'Recently decided' }));
    expect(await screen.findByText('Approved')).toBeInTheDocument();
  });

  it('requires Finance after the supervisor approves an impact above PHP 10,000', async () => {
    const { repo, request } = await createVarianceRequest({ unitCost: 600 });
    await repo.decideStockChange({
      idempotencyKey: 'supervisor-high-value',
      requestId: request.id,
      decision: 'approved',
    });
    renderWithProviders(<ApprovalsPage />, { repo, role: 'finance' });

    const queue = await screen.findByLabelText('Waiting on you approvals');
    expect(within(queue).getByText('Awaiting Finance')).toBeInTheDocument();
    expect(within(queue).getByText(/PHP 12,000/)).toBeInTheDocument();
  });

  it('blocks self-approval and requires a note for rejection', async () => {
    const user = userEvent.setup();
    const { repo } = await createVarianceRequest({ requestedBy: 'logistics_supervisor@mwell' });
    renderWithProviders(<ApprovalsPage />, { repo, role: 'logistics_supervisor' });

    await user.click(within(await screen.findByLabelText('Waiting on you approvals')).getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review stock change' });
    expect(within(dialog).getByText(/you requested this change/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Approve change' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Reject change' })).toBeDisabled();
  });

  it('denies approval decisions while the live data source is offline', async () => {
    const user = userEvent.setup();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { repo } = await createVarianceRequest();
    renderWithProviders(<ApprovalsPage />, {
      repo,
      role: 'logistics_supervisor',
      source: 'supabase',
    });

    await user.click(within(await screen.findByLabelText('Waiting on you approvals')).getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review stock change' });
    expect(within(dialog).getByText(/connect to the network/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Approve change' })).toBeDisabled();
    online.mockRestore();
  });
});
