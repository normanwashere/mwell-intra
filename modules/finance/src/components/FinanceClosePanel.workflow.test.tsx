import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ToastProvider } from '@intra/ui';
import type { FinanceCloseEntry } from '../types';
import { FinanceClosePanel } from './FinanceClosePanel';

const base: FinanceCloseEntry = {
  id: 'close-kept', periodStart: '2026-09-01', periodEnd: '2026-09-30', entryType: 'cost_center',
  sourceModule: 'procurement', sourceReference: 'PO-KEPT', sourceRecordType: 'purchase_order', sourceRecordId: 'po-kept',
  amount: 100, status: 'ready', preparedBy: 'preparer', preparedAt: '2026-09-01T00:00:00Z',
  postedBy: 'poster', updatedAt: '2026-09-01T00:00:00Z', evidenceUrl: 'https://example.com/evidence.pdf',
};
function panel(entry: FinanceCloseEntry, actor = 'independent', canManage = true) {
  const manage = vi.fn();
  render(<ToastProvider><FinanceClosePanel entries={[entry]} manage={manage} openEvidence={vi.fn()} canManage={canManage} currentActorId={actor} /></ToastProvider>);
  return manage;
}
function details() {
  const control = screen.getByText('Workflow details for PO-KEPT');
  fireEvent.click(control);
  return within(control.closest('details')!);
}
it('wraps long source references and keeps actions with the amount', () => {
  const sourceReference = `PO-${'long-reference-'.repeat(12)}`;
  panel({ ...base, sourceReference });
  const reference = screen.getByText(`procurement / ${sourceReference} / ${base.periodEnd}`);
  expect(reference).not.toHaveClass('truncate');
  expect(reference).toHaveClass('[overflow-wrap:anywhere]');
  expect(screen.getByRole('button', { name: 'Post' }).parentElement?.parentElement).toHaveClass('flex-wrap');
});
it.each([
  ['draft', 'Finance preparer'], ['ready', 'Independent Finance poster'], ['posted', 'Independent Finance reconciler'],
  ['reconciled', 'No further close action'], ['exception', 'Finance preparer'], ['unknown', 'Finance'],
])('shows selected %s responsibility without mutating', (status, owner) => {
  const manage = panel({ ...base, status: status as FinanceCloseEntry['status'] });
  const selected = details();
  expect(selected.getByText('Next responsibility')).toBeInTheDocument();
  expect(selected.getByText(owner)).toBeInTheDocument();
  expect(document.getElementById('close-close-kept')).toBeInTheDocument();
  expect(manage).not.toHaveBeenCalled();
});
it('shows the independence blocker and keeps posting disabled for the preparer', () => {
  const manage = panel(base, 'preparer');
  expect(details().getByText(/independent Finance user must post/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
  expect(manage).not.toHaveBeenCalled();
});
it('keeps posted values locked and explains poster/reconciler separation', () => {
  panel({ ...base, status: 'posted' }, 'poster');
  const selected = details();
  expect(selected.getByText('Posted / locked')).toBeInTheDocument();
  expect(selected.getByText(/posters/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reconcile' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Edit and resubmit' })).not.toBeInTheDocument();
});
it('shows read-only scope without adding posting or editing actions', () => {
  panel(base, 'reader', false);
  expect(details().getByText(/capability and certification/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
});
it('preserves a known Event source ID and removes a dead correction link when it is absent', () => {
  panel({ ...base, status: 'exception', sourceRecordType: 'event_reconciliation', sourceRecordId: 'event-kept' });
  expect(screen.getByRole('link', { name: 'Open governed Event correction' })).toHaveAttribute('href', '/events/event-kept');
});
it('provides recovery guidance instead of an identity-free Event link', () => {
  panel({ ...base, status: 'exception', sourceRecordType: 'event_reconciliation', sourceRecordId: undefined });
  expect(screen.queryByRole('link', { name: 'Open governed Event correction' })).not.toBeInTheDocument();
  expect(screen.getByText(/Event source identity is unavailable/)).toBeInTheDocument();
});
it('shows the same record summary in the selected correction sheet', () => {
  const manage = panel(base);
  fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
  expect(within(screen.getByRole('dialog')).getByText('Independent Finance poster')).toBeInTheDocument();
  expect(manage).not.toHaveBeenCalled();
});
