import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReceiptExceptionDecisionPanel } from './ReceiptExceptionDecisionPanel';

it('collects a governed Supervisor quarantine decision with reason and evidence', async () => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(true);
  render(<ReceiptExceptionDecisionPanel items={[{
    decisionId: 'decision-1', receiptId: 'receipt-1', purchaseOrderId: 'po-1',
    poNumber: 'PO-001', requestedDisposition: 'damaged', requestedBy: 'operator-1',
    requestedAt: '2026-07-15T01:00:00Z', reason: 'Crushed carton',
  }]} onDecision={onDecision} />);

  await user.click(screen.getByRole('button', { name: /review controlled receipt/i }));
  const dialog = screen.getByRole('dialog', { name: /supervisor receipt decision/i });
  await user.type(within(dialog).getByLabelText(/decision reason/i), 'Keep isolated pending vendor return');
  await user.type(within(dialog).getByLabelText(/decision evidence/i), 'evidence/supervisor-review.pdf');
  await user.click(within(dialog).getByRole('button', { name: /confirm quarantine/i }));

  expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({
    decisionId: 'decision-1', decision: 'quarantine',
    reason: 'Keep isolated pending vendor return',
    evidenceUrls: ['evidence/supervisor-review.pdf'],
  }));
});
