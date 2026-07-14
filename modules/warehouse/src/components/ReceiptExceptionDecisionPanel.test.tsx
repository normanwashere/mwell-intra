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
    requestedAt: '2026-07-15T01:00:00Z', reason: 'Crushed carton', lines: [],
  }]} onDecision={onDecision} />);

  await user.click(screen.getByRole('button', { name: /review controlled receipt/i }));
  const dialog = screen.getByRole('dialog', { name: /supervisor receipt decision/i });
  await user.type(within(dialog).getByLabelText(/decision reason/i), 'Keep isolated pending vendor return');
  await user.type(within(dialog).getByLabelText(/decision evidence/i), 'evidence/supervisor-review.pdf');
  await user.click(within(dialog).getByRole('button', { name: /quarantine receipt/i }));

  expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({
    decisionId: 'decision-1', decision: 'quarantine',
    reason: 'Keep isolated pending vendor return',
    evidenceUrls: ['evidence/supervisor-review.pdf'],
  }));
});

it('offers all governed outcomes for short excess damaged and unidentified facts', async () => {
  const user = userEvent.setup();
  const dispositions = ['short', 'excess', 'damaged', 'unidentified'] as const;
  render(<ReceiptExceptionDecisionPanel items={dispositions.map((requestedDisposition, index) => ({
    decisionId: `decision-${index}`, receiptId: `receipt-${index}`, purchaseOrderId: 'po-1',
    poNumber: `PO-00${index + 1}`, requestedDisposition, requestedBy: 'operator-1',
    requestedAt: '2026-07-15T01:00:00Z', reason: `${requestedDisposition} facts`, lines: [],
  }))} onDecision={vi.fn().mockResolvedValue(true)} />);

  expect(screen.getByText(/short facts/i)).toBeInTheDocument();
  expect(screen.getByText(/excess facts/i)).toBeInTheDocument();
  expect(screen.getByText(/damaged facts/i)).toBeInTheDocument();
  expect(screen.getByText(/unidentified facts/i)).toBeInTheDocument();
  await user.click(screen.getAllByRole('button', { name: /review controlled receipt/i })[0]!);
  const dialog = screen.getByRole('dialog', { name: /supervisor receipt decision/i });
  for (const outcome of ['Accept receipt', 'Reject receipt', 'Quarantine receipt', 'Escalate receipt']) {
    expect(within(dialog).getByRole('button', { name: outcome })).toBeInTheDocument();
  }
});

it('requires governed product identification before accepting unidentified custody', async () => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(true);
  render(<ReceiptExceptionDecisionPanel items={[{
    decisionId: 'decision-unidentified', receiptId: 'receipt-unidentified', purchaseOrderId: 'po-1',
    poNumber: 'PO-UNIDENTIFIED', requestedDisposition: 'unidentified', requestedBy: 'operator-1',
    requestedAt: '2026-07-15T01:00:00Z', reason: 'Labels do not identify the delivered stock',
    lines: [{ poLineId: 'line-1', productId: '', actualQuantity: 1, expectedQuantity: 1,
      rawDescription: 'Unlabelled sealed carton' }],
  }]} products={[
    { id: 'known-kit', name: 'Known diagnostic kit', sku: 'KIT-001' },
  ]} onDecision={onDecision} />);

  await user.click(screen.getByRole('button', { name: /review controlled receipt/i }));
  const dialog = screen.getByRole('dialog', { name: /supervisor receipt decision/i });
  await user.type(within(dialog).getByLabelText(/decision reason/i), 'Identified from sealed carton manifest');
  await user.type(within(dialog).getByLabelText(/decision evidence/i), 'evidence/identification.pdf');
  expect(within(dialog).getByRole('button', { name: /accept receipt/i })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: /quarantine receipt/i })).toBeDisabled();

  await user.selectOptions(within(dialog).getByLabelText(/identify unlabelled sealed carton/i), 'known-kit');
  await user.click(within(dialog).getByRole('button', { name: /quarantine receipt/i }));

  expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({
    decisionId: 'decision-unidentified',
    decision: 'quarantine',
    identifications: [{ poLineId: 'line-1', productId: 'known-kit' }],
  }));
});
