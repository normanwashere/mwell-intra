import type { WorkflowSummaryProps } from '@intra/ui';
import { closeActionReason } from './closeEligibility';
import { isSupportedFinanceEvidenceReference } from './data';
import type { FinanceCloseEntry } from './types';

export function closeWorkflowSummary(entry: FinanceCloseEntry, actor: string | undefined, canManage: boolean): Omit<WorkflowSummaryProps, 'children'> {
  if (entry.status === 'reconciled') return { status: 'Reconciled', owner: 'No further close action', nextStep: 'Review the retained source evidence and actor lineage. This entry is immutable.', tone: 'success' };
  if (!['draft', 'ready', 'posted', 'exception'].includes(entry.status)) return { status: 'Status unrecognized', owner: 'Finance', nextStep: 'Verify the entry status before proceeding.', blocker: 'The next close action cannot be determined from this status.', tone: 'warning' };
  const action = entry.status === 'ready' ? 'post' : entry.status === 'posted' ? 'reconcile' : 'save';
  const eventCorrection = action === 'save' && entry.sourceRecordType === 'event_reconciliation';
  const evidenceBlocker = action === 'post' && entry.sourceRecordType === 'event_reconciliation' && !isSupportedFinanceEvidenceReference(entry.evidenceUrl)
    ? 'Supported registered Event evidence is required before posting.' : undefined;
  const blocker = closeActionReason(entry, action, actor, canManage) ?? evidenceBlocker;
  return {
    status: entry.status === 'ready' ? 'Ready for independent posting' : entry.status === 'posted' ? 'Posted / locked' : entry.status === 'exception' ? 'Correction required' : 'Draft',
    owner: eventCorrection ? 'Event correction owner' : action === 'post' ? 'Independent Finance poster' : action === 'reconcile' ? 'Independent Finance reconciler' : 'Finance preparer',
    nextStep: eventCorrection ? 'Use the governed Event correction route for this source.' : action === 'post' ? 'Review the source and evidence before independent posting.' : action === 'reconcile' ? 'Review and reconcile the posted entry; posted values cannot be edited.' : 'Review the source and evidence, then edit and resubmit for independent posting.',
    blocker: blocker ?? (entry.status === 'exception' ? entry.reconciliationNote || 'Resolve the recorded exception before resubmission.' : undefined),
    tone: blocker || entry.status === 'exception' ? 'warning' : 'neutral',
  };
}
