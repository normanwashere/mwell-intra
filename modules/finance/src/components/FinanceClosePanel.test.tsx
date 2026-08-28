import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '@intra/ui';
import { FinanceClosePanel } from './FinanceClosePanel';

afterEach(() => localStorage.clear());
const manage = vi.fn();
function Panel({ actor = 'finance-A' }: { actor?: string }) {
  return <ToastProvider><FinanceClosePanel entries={[]} manage={manage} openEvidence={vi.fn()}
    canManage currentActorId={actor} /></ToastProvider>;
}
function open() { fireEvent.click(screen.getByRole('button', { name: /Prepare close entry/i })); }

it('offers explicit same-user browser draft recovery without submitting or persisting evidence secrets', async () => {
  const first = render(<Panel />);
  open();
  fireEvent.change(screen.getByLabelText('Canonical source ID'), { target: { value: 'PO-A' } });
  fireEvent.change(screen.getByLabelText('Reconciliation note'), { target: { value: 'Awaiting independent review' } });
  fireEvent.change(screen.getByLabelText(/Evidence URL/), { target: { value: 'https://example.com/private?token=secret' } });
  await screen.findByText('Saved on this browser');
  expect(Object.values(localStorage).join('')).not.toContain('secret');
  first.unmount();
  render(<Panel />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Resume draft' }));
  expect(screen.getByLabelText('Canonical source ID')).toHaveValue('PO-A');
  expect(screen.getByLabelText('Reconciliation note')).toHaveValue('Awaiting independent review');
  expect(screen.getByLabelText(/Evidence URL/)).toHaveValue('');
  expect(manage).not.toHaveBeenCalled();
});

it('isolates drafts and in-memory fields when the actor changes, and supports discard', async () => {
  const view = render(<Panel />);
  open();
  fireEvent.change(screen.getByLabelText('Canonical source ID'), { target: { value: 'PO-A' } });
  await screen.findByText('Saved on this browser');
  view.rerender(<Panel actor="finance-B" />);
  expect(screen.queryByRole('button', { name: 'Resume draft' })).not.toBeInTheDocument();
  open();
  expect(screen.getByLabelText('Canonical source ID')).toHaveValue('');
  view.rerender(<Panel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Discard draft' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume draft' })).not.toBeInTheDocument());
  expect(localStorage.getItem('intra.finance-close-draft.v1.finance-A')).toBeNull();
});

it('rejects private paths and credential-bearing links before preparing a close entry', () => {
  render(<Panel />);
  open();
  fireEvent.change(screen.getByLabelText(/Evidence URL/), { target: { value: 'evidence/private.pdf' } });
  expect(screen.getByRole('alert')).toHaveTextContent('HTTPS');
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
  expect(manage).not.toHaveBeenCalled();
});
