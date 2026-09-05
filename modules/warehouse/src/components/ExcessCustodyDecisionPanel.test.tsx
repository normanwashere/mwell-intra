import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSession } from '@intra/auth';
import { ExcessCustodyDecisionPanel } from './ExcessCustodyDecisionPanel';

vi.mock('@intra/auth', () => ({ useSession: vi.fn() }));
const upload = vi.fn();
const createSignedUrl = vi.fn();
const from = vi.fn(() => ({ upload, createSignedUrl }));
const client = { storage: { from } };
beforeEach(() => {
  vi.clearAllMocks();
  upload.mockResolvedValue({ error: null });
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/authorized-preview' }, error: null });
  vi.mocked(useSession).mockReturnValue({ mode: 'supabase', supabaseClient: client } as unknown as ReturnType<typeof useSession>);
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) vi.stubEnv(key, '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

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
  await user.type(within(dialog).getByLabelText(/evidence url/i), 'https://example.com/amendment.pdf');
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

it('uploads PNG evidence with the authenticated shell client when standalone browser env is absent', async () => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(true);
  render(<ExcessCustodyDecisionPanel items={[item]} onDecision={onDecision} />);
  await user.click(screen.getByRole('button', { name: /review excess custody/i }));
  await user.type(screen.getByLabelText(/decision reason/i), 'Return excess stock');
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'excess-custody.png', { type: 'image/png' });
  await user.upload(screen.getByLabelText('Upload evidence'), file);
  expect(await screen.findByText(file.name, { exact: true })).toBeVisible();
  expect(from).toHaveBeenCalledWith('evidence');
  expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^excess-custody\/custody-1\/[0-9a-f-]+\.png$/), file,
    { contentType: 'image/png', upsert: false });
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  await user.click(screen.getByRole('button', { name: 'Open evidence' }));
  expect(createSignedUrl).toHaveBeenCalledWith(upload.mock.calls[0]![0], 300);
  expect(open).toHaveBeenCalledWith('https://storage.test/authorized-preview', '_blank', 'noopener,noreferrer');
  await user.click(screen.getByRole('button', { name: /record final disposition/i }));
  expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({
    custodyId: item.custodyId, outcome: 'vendor_return', evidenceUrls: [upload.mock.calls[0]![0]],
  }));
});

it('reports a missing session locally and does not attempt a storage upload', async () => {
  vi.mocked(useSession).mockReturnValue({ mode: 'supabase', supabaseClient: null } as unknown as ReturnType<typeof useSession>);
  const user = userEvent.setup();
  render(<ExcessCustodyDecisionPanel items={[item]} onDecision={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /review excess custody/i }));
  await user.upload(screen.getByLabelText('Upload evidence'), new File(['png'], 'proof.png', { type: 'image/png' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Private evidence uploads require a signed-in connection.');
  expect(upload).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Evidence URL')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: /record final disposition/i })).toBeDisabled();
});

it('keeps preview mode read-only even when a client object is present', async () => {
  vi.mocked(useSession).mockReturnValue({ mode: 'memory', supabaseClient: client } as unknown as ReturnType<typeof useSession>);
  const user = userEvent.setup();
  render(<ExcessCustodyDecisionPanel items={[item]} onDecision={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /review excess custody/i }));
  await user.upload(screen.getByLabelText('Upload evidence'), new File(['png'], 'proof.png', { type: 'image/png' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Private evidence uploads require a signed-in connection.');
  expect(from).not.toHaveBeenCalled();
});

it('preserves the storage error message and permits retry without recording disposition', async () => {
  upload.mockResolvedValueOnce({ error: { message: 'Storage policy denied upload' } });
  const user = userEvent.setup();
  const onDecision = vi.fn();
  render(<ExcessCustodyDecisionPanel items={[item]} onDecision={onDecision} />);
  await user.click(screen.getByRole('button', { name: /review excess custody/i }));
  await user.upload(screen.getByLabelText('Upload evidence'), new File(['png'], 'proof.png', { type: 'image/png' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Evidence upload failed: Storage policy denied upload');
  expect(onDecision).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Retry upload' }));
  expect(await screen.findByText('proof.png', { exact: true })).toBeVisible();
  expect(upload).toHaveBeenCalledTimes(2);
});
