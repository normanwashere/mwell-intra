import type { FinanceCloseEntry } from './types';

export function closeActionReason(entry: FinanceCloseEntry, action: 'save' | 'post' | 'reconcile' | 'exception', actor: string | undefined, capable: boolean): string | undefined {
  if (!capable) return 'Finance close capability and certification required.';
  if (!actor) return 'Your actor identity is unavailable. Refresh your session.';
  if (action === 'save') {
    if (entry.sourceRecordType === 'event_reconciliation') return 'Use the governed Event correction route.';
    if (!['draft', 'ready', 'exception'].includes(entry.status)) return 'Posted and reconciled entries are immutable.';
    return;
  }
  if (action === 'exception') return ['draft', 'ready'].includes(entry.status) ? undefined : 'Only draft and ready entries can be flagged.';
  if (entry.status !== (action === 'post' ? 'ready' : 'posted')) return action === 'post' ? 'A ready entry is required.' : 'Post the entry first.';
  if (entry.preparedBy === actor || entry.settlementApprovedBy === actor || (action === 'reconcile' && entry.postedBy === actor))
    return `An independent Finance user must ${action}; preparers${action === 'reconcile' ? ', posters' : ''} and settlement approvers cannot perform this action.`;
  if (!entry.evidenceUrl?.trim()) return 'Registered source evidence must be available before posting or reconciliation.';
}
