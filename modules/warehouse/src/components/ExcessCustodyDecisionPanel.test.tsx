import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ExcessCustodyDecisionPanel } from './ExcessCustodyDecisionPanel';

const item = {
  custodyId: 'custody-1', receiptId: 'receipt-1', purchaseOrderId: 'po-1',
  poLineId: 'line-1', poNumber: 'PO-2026-0001', productName: 'Diagnostic kit',
  orderedQuantity: 4, excessQuantity: 2, status: 'held' as const,
  eligibleApprovedAmendments: [{
    id: 'amendment-1', previousQuantity: 4, amendedQuantity: 6,
    approvedAt: '2026-07-15T10:00:00.000Z',
  }],
};

it('requires an approved amendment identity for excess acceptance', async () => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(true);
  render(<ExcessCustodyDecisionPanel items={[item]} onDecision={onDecision} />);

  await user.click(screen.getByRole('button', { name: /review excess custody/i }));
  const dialog = screen.getByRole('dialog', { name: /final excess custody disposition/i });
  await user.selectOptions(within(dialog).getByLabelText(/governed outcome/i), 'accepted_amendment');
  await user.type(within(dialog).getByLabelText(/decision reason/i), 'Approved PO line growth covers custody');
  await user.type(within(dialog).getByLabelText(/evidence url/i), 'evidence/amendment.pdf');
  expect(within(dialog).getByRole('button', { name: /record final disposition/i })).toBeDisabled();
  expect(within(dialog).queryByLabelText(/approved amendment id/i)).not.toBeInTheDocument();
  await user.selectOptions(within(dialog).getByLabelText(/approved quantity amendment/i), 'amendment-1');
  await user.click(within(dialog).getByRole('button', { name: /record final disposition/i }));

  expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({
    custodyId: 'custody-1', outcome: 'accepted_amendment', approvedAmendmentId: 'amendment-1',
  }));
});

it.each(['vendor_return', 'written_off'] as const)('offers Supervisor %s final disposition', async (outcome) => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(true);
  render(<ExcessCustodyDecisionPanel items={[item]} onDecision={onDecision} />);
  await user.click(screen.getByRole('button', { name: /review excess custody/i }));
  const dialog = screen.getByRole('dialog', { name: /final excess custody disposition/i });
  await user.selectOptions(within(dialog).getByLabelText(/governed outcome/i), outcome);
  expect(within(dialog).queryByLabelText(/approved quantity amendment/i)).not.toBeInTheDocument();
});
