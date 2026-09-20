import { expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { InspectionSheet } from './InspectionSheet';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/components/camera/EvidenceCapture', () => ({ EvidenceCapture: ({ onChange }: { onChange: (urls: string[]) => void }) =>
  <button type="button" onClick={() => onChange(['stored/inspection.jpg'])}>Attach test evidence</button> }));

it('requires exact-item confirmation and evidence; retries the same payload with the same key', async () => {
  const first = { sourceType: 'receipt' as const, sourceId: 'receipt', productId: 'device', productName: 'Watch',
    quantity: 1, procurementPoLineId: 'po-line', lotId: 'lot-1', serialNumber: 'S1' };
  const submit = vi.fn().mockResolvedValue(false);
  const single = vi.fn();
  renderWithProviders(<InspectionSheet target={first} batchTargets={[first,{...first,serialNumber:'S2'}]}
    requiresEvidence={false} onSubmit={single} onSubmitBatch={submit} onOpenChange={() => undefined} />);
  const user = userEvent.setup();
  const selectedList = screen.getByRole('list', { name: 'Selected inspection items' });
  expect(selectedList.tagName).toBe('UL');
  expect(selectedList).toHaveAttribute('tabindex', '0');
  act(() => selectedList.focus());
  expect(selectedList).toHaveFocus();
  const button = screen.getByRole('button', {name: 'Submit 2 inspections'});
  expect(button).toBeDisabled();
  await user.click(screen.getByRole('checkbox', {name: 'I inspected all 2 selected items'}));
  expect(button).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Attach test evidence'}));
  await user.click(button);
  await user.click(button);
  expect(single).not.toHaveBeenCalled();
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0]);
  expect(submit.mock.calls[0]![0].items).toEqual([
    expect.objectContaining({serialNumber:'S1',lotId:'lot-1',procurementPoLineId:'po-line'}),
    expect.objectContaining({serialNumber:'S2',lotId:'lot-1',procurementPoLineId:'po-line'}),
  ]);
});

it.each([true, false])('keeps the original uncertain command immutable across edits, close/reopen and queue refresh (batch=%s)', async (batch) => {
  const first = { sourceType: 'receipt' as const, sourceId: 'receipt-A', productId: 'device', productName: 'Watch', quantity: 1, serialNumber: 'S1' };
  const original = [first, { ...first, serialNumber: 'S2' }];
  const replacement = [{ ...first, sourceId: 'receipt-B', serialNumber: 'S3' }];
  let update!: (items: typeof original | null) => void;
  let respond!: (ok: boolean) => void;
  const response = new Promise<boolean>(resolve => { respond = resolve; });
  const submit = vi.fn().mockReturnValueOnce(response).mockResolvedValueOnce(true);
  const pendingChanged = vi.fn();
  function Harness() {
    const [items, setItems] = useState<typeof original | null>(original);
    update = setItems;
    return <InspectionSheet target={items?.[0] ?? null} batchTargets={batch ? items ?? undefined : undefined}
      requiresEvidence onSubmit={submit} onSubmitBatch={batch ? submit : undefined} onPendingChange={pendingChanged} onOpenChange={open => { if (!open) setItems(null); }} />;
  }
  renderWithProviders(<Harness />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Disposition'), 'hold');
  await user.type(screen.getByLabelText('Reason'), 'Original inspection evidence');
  if (batch) await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Attach test evidence' }));
  await user.click(screen.getByRole('button', { name: batch ? 'Submit 2 inspections' : 'Submit inspection' }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(pendingChanged).toHaveBeenLastCalledWith(true);
  const payload = structuredClone(submit.mock.calls[0]![0]);
  expect(screen.getByLabelText('Disposition')).toBeDisabled();
  expect(screen.getByLabelText('Reason')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Attach test evidence' })).toBeDisabled();
  await act(async () => { respond(false); await response; });
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not confirm/i);
  fireEvent.change(screen.getByLabelText('Disposition'), { target: { value: 'damaged' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Changed details' } });
  await user.click(screen.getByRole('button', { name: 'Attach test evidence' }));
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Review unconfirmed inspection' })).toBeInTheDocument();
  expect(pendingChanged).toHaveBeenLastCalledWith(true);
  await act(async () => update(replacement));
  expect(screen.getByLabelText('Disposition')).toHaveValue('hold');
  expect(screen.getByLabelText('Reason')).toHaveValue('Original inspection evidence');
  expect(screen.getByLabelText('Reason')).toBeDisabled();
  await act(async () => update(null));
  await user.click(screen.getByRole('button', { name: 'Review unconfirmed inspection' }));
  await user.click(screen.getByRole('button', { name: 'Retry original inspection' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[1]![0]).toEqual(payload);
  await waitFor(() => expect(pendingChanged).toHaveBeenLastCalledWith(false));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Review unconfirmed inspection' })).not.toBeInTheDocument();
  await act(async () => update(replacement));
  expect(screen.getByLabelText('Disposition')).toBeEnabled();
  expect(screen.getByLabelText('Disposition')).toHaveValue('accepted');
});

it('retains the original batch after a thrown response loss and never reports success', async () => {
  const first = { sourceType: 'receipt' as const, sourceId: 'receipt-A', productId: 'device', productName: 'Watch', quantity: 1 };
  const submit = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(false);
  const close = vi.fn();
  renderWithProviders(<InspectionSheet target={first} batchTargets={[first]} requiresEvidence onSubmit={vi.fn()} onSubmitBatch={submit} onOpenChange={close} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Attach test evidence' }));
  await user.click(screen.getByRole('button', { name: 'Submit 1 inspection' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not confirm/i);
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Retry original inspection' }));
  expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0]);
  expect(close).not.toHaveBeenCalled();
});

it('unlocks a definitively rejected first attempt for correction, but not an uncertain earlier save', async () => {
  const first = {sourceType:'receipt' as const,sourceId:'A',productId:'device',productName:'Watch',quantity:1};
  const submit = vi.fn().mockResolvedValueOnce({status:'rejected',stage:'rolled-back',code:'42501',message:'Upload inspection evidence using your account.'})
    .mockResolvedValueOnce({status:'uncertain',message:'Response lost'})
    .mockResolvedValueOnce({status:'rejected',stage:'not-sent',code:'42501',message:'Your access changed.'});
  const pending = vi.fn();
  renderWithProviders(<InspectionSheet target={first} batchTargets={[first]} requiresEvidence onSubmit={vi.fn()} onSubmitBatch={submit} onOpenChange={() => undefined} onPendingChange={pending} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button',{name:'Attach test evidence'}));
  await user.click(screen.getByRole('button',{name:'Submit 1 inspection'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('This inspection was not saved.');
  expect(screen.getByLabelText('Disposition')).toBeEnabled();
  expect(pending).toHaveBeenLastCalledWith(false);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button',{name:'Submit 1 inspection'}));
  expect(submit.mock.calls[1]![0].idempotencyKey).not.toBe(submit.mock.calls[0]![0].idempotencyKey);
  await user.click(screen.getByRole('button',{name:'Retry original inspection'}));
  expect(submit.mock.calls[2]![0]).toEqual(submit.mock.calls[1]![0]);
  expect(screen.getByLabelText('Disposition')).toBeDisabled();
  expect(screen.getByText(/This retry was blocked/)).toBeInTheDocument();
  expect(pending).toHaveBeenLastCalledWith(true);
});
