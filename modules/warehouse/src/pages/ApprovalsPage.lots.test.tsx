import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CycleCount, StockChangeRequest } from '@intra/data-kit';
import { ApprovalsPage } from './ApprovalsPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

const lotFacts = [
  { lotId: 'lot-loss', expected: 10, counted: 6, delta: -4 },
  { lotId: 'lot-gain', expected: 4, counted: 8, delta: 4 },
  { lotId: 'unknown-lot-reference', expected: 3, counted: 3, delta: 0 },
  { lotId: null, expected: 1, counted: 1, delta: 0 },
];

async function reviewFixture(
  lotCounts: { lotId: string | null; expected?: number; counted: number; delta?: number }[] | undefined = lotFacts,
  overrides: Partial<StockChangeRequest> & { approvalExposure?: number; grossQuantity?: number } = {},
) {
  const data = await makeRepo().getData();
  const product = data.products.find(p => p.id === 'shirt-l')!;
  data.lots = [
    { id: 'lot-loss', productId: product.id, lotCode: 'RECEIPT-LOT-LOSS', unitCost: 70, receivedAt: '2026-11-01T00:00:00Z' },
    { id: 'lot-gain', productId: product.id, lotCode: 'RECEIPT-LOT-GAIN', unitCost: 70, receivedAt: '2026-11-02T00:00:00Z' },
  ];
  data.cycleCounts = [];
  const count: CycleCount = {
    id: 'count-lot-review', locationId: 'loc-wh', actor: 'independent-counter', createdAt: '2026-11-05T00:00:00Z',
    lines: [{ productId: product.id, expected: 18, counted: 18, lotCounts }],
  };
  const request: StockChangeRequest = {
    id: 'request-net-zero', sourceType: 'cycle_count', sourceId: count.id, productId: product.id,
    locationId: count.locationId, quantityDelta: 0, unitCost: 70, financialImpact: 0, approvalExposure: 560, grossQuantity: 8,
    reason: 'Offsetting receipt-lot variances', evidenceUrls: [], status: 'pending_supervisor',
    requestedBy: count.actor, requestedByDisplayName: 'Independent Counter', requestedAt: count.createdAt, canDecide: true,
    ...overrides,
  };
  const repo = makeRepo(data);
  vi.spyOn(repo, 'getData').mockResolvedValue(data);
  const read = vi.spyOn(repo, 'getCycleCount').mockResolvedValue(count);
  vi.spyOn(repo, 'listStockChangeRequests').mockResolvedValue({ rows: [request] });
  const decide = vi.spyOn(repo, 'decideStockChange').mockResolvedValue({ ...request, status: 'approved' });
  return { repo, read, decide, request };
}

async function openReview(repo: ReturnType<typeof makeRepo>, role: 'finance' | 'logistics_supervisor' = 'logistics_supervisor') {
  renderWithProviders(<ApprovalsPage />, { repo, role, source: 'supabase', capabilities: [role === 'finance' ? 'approve_stock_adjustment_finance' : 'approve_stock_adjustment'] });
  await userEvent.click(within(await screen.findByLabelText('Waiting on you approvals')).getByRole('button', { name: 'Review' }));
  return screen.findByRole('dialog', { name: 'Review stock change' });
}

describe('F02 lot review', () => {
  it('shows normalized lot facts and server gross exposure for a net-zero count without mutating on open', async () => {
    const { repo, read, decide, request } = await reviewFixture();
    const dialog = await openReview(repo);
    const rows = within(await within(dialog).findByRole('list', { name: 'Lot count rows' })).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    const expected = [
      ['RECEIPT-LOT-LOSS', '10', '6', '-4'],
      ['RECEIPT-LOT-GAIN', '4', '8', '+4'],
      ['unknown-lot-reference', '3', '3', '0'],
      ['Unlotted', '1', '1', '0'],
    ];
    rows.forEach((row, index) => {
      expect(within(row).getByText(expected[index]![0]!)).toBeVisible();
      expect(within(row).getAllByRole('definition').map(node => node.textContent)).toEqual(expected[index]!.slice(1));
    });
    const exposure = within(dialog).getByText('Approval exposure (gross)').parentElement!;
    expect(exposure).toHaveTextContent('PHP 560');
    expect(within(dialog).getByText('Gross quantity').parentElement).toHaveTextContent('8');
    expect(within(dialog).getByText('Net financial impact').parentElement).toHaveTextContent('PHP 0');
    expect(within(dialog).getByText('Unit cost').parentElement).toHaveTextContent('PHP 70');
    expect(within(dialog).getByText('Net change').parentElement).toHaveTextContent('0');
    expect(screen.getByLabelText('Waiting on you approvals')).toHaveTextContent('0 net units');
    expect(screen.getByLabelText('Waiting on you approvals')).toHaveTextContent('PHP 560 gross approval exposure');
    expect(read).toHaveBeenCalledWith(request.sourceId);
    expect(within(dialog).getByRole('button', { name: 'Approve change' })).toBeEnabled();
    expect(within(dialog).getByRole('region', { name: 'Lot count review' }).querySelector('input, select, textarea, button')).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it('preserves explicit zero exposure and gross quantity instead of falling back to net impact', async () => {
    const { repo } = await reviewFixture([], { approvalExposure: 0, grossQuantity: 0, financialImpact: 700 });
    const dialog = await openReview(repo);
    await within(dialog).findByLabelText('Stock change identity');
    expect(within(dialog).getByText('Approval exposure (gross)').parentElement).toHaveTextContent('PHP 0');
    expect(within(dialog).getByText('Gross quantity').parentElement).toHaveTextContent('0');
    expect(within(dialog).getByText('Net financial impact').parentElement).toHaveTextContent('PHP 700');
    expect(screen.getByLabelText('Waiting on you approvals')).toHaveTextContent('PHP 0 gross approval exposure');
  });

  it('shows the actual gross value in a Finance-eligible net-zero request', async () => {
    const { repo, decide } = await reviewFixture(lotFacts, { status: 'pending_finance', unitCost: 1400, approvalExposure: 11200 });
    const dialog = await openReview(repo, 'finance');
    await within(dialog).findByLabelText('Stock change identity');
    expect(screen.getByLabelText('Waiting on you approvals')).toHaveTextContent('Awaiting Finance');
    expect(screen.getByLabelText('Waiting on you approvals')).toHaveTextContent('PHP 11,200 gross approval exposure');
    expect(within(dialog).getByText('Approval exposure (gross)').parentElement).toHaveTextContent('PHP 11,200');
    expect(within(dialog).getByText('Net financial impact').parentElement).toHaveTextContent('PHP 0');
    expect(within(dialog).getByRole('button', { name: 'Approve change' })).toBeEnabled();
    expect(decide).not.toHaveBeenCalled();
  });

  it('uses financial impact only as the legacy adjustment exposure fallback', async () => {
    const { repo } = await reviewFixture([], { sourceType: 'adjustment', approvalExposure: undefined, grossQuantity: undefined, financialImpact: 700 });
    const dialog = await openReview(repo);
    expect(within(dialog).getByText('Approval exposure').parentElement).toHaveTextContent('PHP 700');
    expect(within(dialog).queryByText('Gross quantity')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Waiting on you approvals')).toHaveTextContent('PHP 700 approval exposure');
  });

  it('does not invent missing expected/delta values or approve an incomplete lot snapshot', async () => {
    const { repo, decide } = await reviewFixture([{ lotId: 'lot-loss', counted: 6 }]);
    const dialog = await openReview(repo);
    const row = await within(dialog).findByRole('listitem');
    expect(within(row).getAllByRole('definition').map(node => node.textContent)).toEqual(['Unavailable', '6', 'Unavailable']);
    expect(within(dialog).getByText(/lot review facts are incomplete/i)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Approve change' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve change' }));
    expect(decide).not.toHaveBeenCalled();
  });

  it('submits only the existing decision command, never client lot values or recalculated exposure', async () => {
    const { repo, decide, request } = await reviewFixture();
    const dialog = await openReview(repo);
    await within(dialog).findByRole('list', { name: 'Lot count rows' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve change' }));
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]![0]).toEqual({
      idempotencyKey: expect.stringMatching(/^stock-change-request-net-zero-approved-/),
      requestId: request.id, decision: 'approved',
    });
  });
});
