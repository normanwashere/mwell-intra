import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReceiptExceptionDecisionPanel } from './ReceiptExceptionDecisionPanel';

vi.mock('./EvidenceGallery', () => ({ EvidenceGallery: ({ urls }: { urls: string[] }) => <div aria-label="Evidence preview">{urls.length} attachments</div> }));
vi.mock('./camera/EvidenceCapture', () => ({ EvidenceCapture: ({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) => <button onClick={() => onBusyChange(true)}>Upload supporting evidence</button> }));

it('opens the exact shortage, selects existing evidence and never counts missing goods as delivered', async () => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(true);
  render(<ReceiptExceptionDecisionPanel reviewerId="lead-1" receiptId="receipt-short" items={[{
    decisionId: 'decision-short', receiptId: 'receipt-short', purchaseOrderId: 'po-1',
    poNumber: 'PO-PARTIAL', requestedDisposition: 'short', requestedBy: 'receiver-1',
    requestedAt: '2026-10-20', reason: 'Four units missing', lines: [],
    evidenceUrls: ['evidence/already-uploaded.jpg'],
  }]} onDecision={onDecision} />);
  const dialog = await screen.findByRole('dialog', { name: /supervisor receipt decision/i });
  expect(within(dialog).queryByRole('textbox', { name: 'Decision evidence' })).not.toBeInTheDocument();
  expect(within(dialog).getByText(/missing goods remain outstanding.*not recorded as received/i)).toBeVisible();
  await user.type(within(dialog).getByLabelText('Decision reason'), 'Accept partial delivery; balance remains due');
  expect(within(dialog).getByRole('button', { name: 'Accept partial receipt' })).toBeDisabled();
  await user.click(within(dialog).getByLabelText('Use receipt evidence 1'));
  await user.click(within(dialog).getByRole('button', { name: 'Accept partial receipt' }));
  expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ decision: 'accept', evidenceUrls: ['evidence/already-uploaded.jpg'] }));
});

it('does not let the receiving actor decide their own receipt even with review capability', async () => {
  render(<ReceiptExceptionDecisionPanel reviewerId="receiver-1" receiptId="receipt-own" items={[{
    decisionId: 'decision-own', receiptId: 'receipt-own', purchaseOrderId: 'po-1',
    poNumber: 'PO-OWN', requestedDisposition: 'short', requestedBy: 'receiver-1',
    requestedAt: '2026-10-20', reason: 'Missing units', lines: [], evidenceUrls: ['evidence/photo.jpg'],
  }]} onDecision={vi.fn()} />);
  const dialog = await screen.findByRole('dialog', { name: /supervisor receipt decision/i });
  expect(within(dialog).getByText(/another authorized Lead must decide/i)).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Accept partial receipt' })).toBeDisabled();
});

it('keeps the decision and evidence draft when a loader callback changes or submission is pending', async () => {
  const user = userEvent.setup();
  let finish!: (value: boolean) => void;
  const onDecision = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const items = [{ decisionId: 'd-lock', receiptId: 'r-lock', purchaseOrderId: 'po-1', poNumber: 'PO-LOCK', requestedDisposition: 'short' as const, requestedBy: 'receiver', requestedAt: '2026-10-20', reason: 'Short', lines: [] }];
  const view = render(<ReceiptExceptionDecisionPanel reviewerId="lead" receiptId="r-lock" items={items} loadEvidence={async () => ['evidence/existing.jpg']} onDecision={onDecision} />);
  const dialog = await screen.findByRole('dialog', { name: /supervisor receipt decision/i });
  await user.click(await within(dialog).findByLabelText('Use receipt evidence 1'));
  await user.type(within(dialog).getByLabelText('Decision reason'), 'Keep this reason');
  view.rerender(<ReceiptExceptionDecisionPanel reviewerId="lead" receiptId="r-lock" items={items} loadEvidence={async () => ['evidence/existing.jpg']} onDecision={onDecision} />);
  expect(within(dialog).getByLabelText('Decision reason')).toHaveValue('Keep this reason');
  expect(within(dialog).getByLabelText('Use receipt evidence 1')).toBeChecked();
  await user.click(within(dialog).getByRole('button', { name: 'Accept partial receipt' }));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(dialog).toBeVisible();
  expect(within(dialog).getByLabelText('Decision reason')).toHaveValue('Keep this reason');
  await act(async () => finish(true));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('cannot dismiss or decide while supporting evidence is uploading', async () => {
  render(<ReceiptExceptionDecisionPanel reviewerId="lead" receiptId="r-upload" items={[{
    decisionId: 'd-upload', receiptId: 'r-upload', purchaseOrderId: 'po-1', poNumber: 'PO-UPLOAD',
    requestedDisposition: 'short', requestedBy: 'receiver', requestedAt: '2026-10-19', reason: 'Short', lines: [],
  }]} onDecision={vi.fn()} />);
  const dialog = await screen.findByRole('dialog', { name: /supervisor receipt decision/i });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Upload supporting evidence' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(dialog).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Accept partial receipt' })).toBeDisabled();
});

it('collects a governed Supervisor quarantine decision with reason and evidence', async () => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(true);
  render(<ReceiptExceptionDecisionPanel reviewerId="lead-1" items={[{
    decisionId: 'decision-1', receiptId: 'receipt-1', purchaseOrderId: 'po-1',
    poNumber: 'PO-001', requestedDisposition: 'damaged', requestedBy: 'operator-1',
    requestedAt: '2026-07-15T01:00:00Z', reason: 'Crushed carton', lines: [], evidenceUrls: ['evidence/supervisor-review.pdf'],
  }]} onDecision={onDecision} />);

  await user.click(screen.getByRole('button', { name: /review controlled receipt/i }));
  const dialog = screen.getByRole('dialog', { name: /supervisor receipt decision/i });
  await user.type(within(dialog).getByLabelText(/decision reason/i), 'Keep isolated pending vendor return');
  await user.click(within(dialog).getByLabelText('Use receipt evidence 1'));
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
  for (const outcome of ['Accept partial receipt', 'Reject shortage decision', 'Record shortage for follow-up', 'Escalate shortage']) {
    expect(within(dialog).getByRole('button', { name: outcome })).toBeInTheDocument();
  }
});

it('requires governed product identification before accepting unidentified custody', async () => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(true);
  render(<ReceiptExceptionDecisionPanel reviewerId="lead-1" items={[{
    decisionId: 'decision-unidentified', receiptId: 'receipt-unidentified', purchaseOrderId: 'po-1',
    poNumber: 'PO-UNIDENTIFIED', requestedDisposition: 'unidentified', requestedBy: 'operator-1',
    requestedAt: '2026-07-15T01:00:00Z', reason: 'Labels do not identify the delivered stock', evidenceUrls: ['evidence/identification.pdf'],
    lines: [{ poLineId: 'line-1', productId: '', actualQuantity: 1, expectedQuantity: 1,
      rawDescription: 'Unlabelled sealed carton' }],
  }]} products={[
    { id: 'known-kit', name: 'Known diagnostic kit', sku: 'KIT-001' },
  ]} onDecision={onDecision} />);

  await user.click(screen.getByRole('button', { name: /review controlled receipt/i }));
  const dialog = screen.getByRole('dialog', { name: /supervisor receipt decision/i });
  await user.type(within(dialog).getByLabelText(/decision reason/i), 'Identified from sealed carton manifest');
  await user.click(within(dialog).getByLabelText('Use receipt evidence 1'));
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

it('keeps an escalated Supervisor decision visible for governed final disposition', async () => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(true);
  render(<ReceiptExceptionDecisionPanel reviewerId="lead-1" items={[{
    decisionId: 'decision-escalated', receiptId: 'receipt-escalated', purchaseOrderId: 'po-1',
    poNumber: 'PO-ESCALATED', requestedDisposition: 'damaged', status: 'escalated',
    requestedBy: 'operator-1', requestedAt: '2026-07-15T01:00:00Z',
    reason: 'Escalated pending evidence', lines: [], evidenceUrls: ['evidence/final-return.pdf'],
  }]} onDecision={onDecision} />);

  expect(screen.getByText(/^escalated$/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /review controlled receipt/i }));
  const dialog = screen.getByRole('dialog', { name: /supervisor receipt decision/i });
  await user.type(within(dialog).getByLabelText(/decision reason/i), 'Final vendor-return disposition');
  await user.click(within(dialog).getByLabelText('Use receipt evidence 1'));
  await user.click(within(dialog).getByRole('button', { name: /reject receipt/i }));

  expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({
    decisionId: 'decision-escalated', decision: 'reject',
  }));
});
