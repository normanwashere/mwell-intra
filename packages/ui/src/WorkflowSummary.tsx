import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface WorkflowSummaryProps {
  status: string;
  owner: string;
  nextStep: string;
  blocker?: string;
  tone?: 'neutral' | 'warning' | 'success';
  children?: ReactNode;
}

/** Describes the source workflow; never grants access or decides a transition. */
export function WorkflowSummary({ status, owner, nextStep, blocker, tone = 'neutral', children }: WorkflowSummaryProps) {
  const blockingReason = blocker?.trim();
  const statusTone = blockingReason || tone === 'warning'
    ? 'text-amber-800 dark:text-amber-200'
    : tone === 'success' ? 'text-emerald-800 dark:text-emerald-200' : 'text-ink';
  return (
    <section aria-label="Workflow status" className="my-4 min-w-0 border-y border-line py-3 sm:my-5 sm:py-4">
      <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-muted">Current status</dt>
          <dd className={`mt-1 break-words text-sm font-semibold [overflow-wrap:anywhere] ${statusTone}`}>{status.trim() || 'Status not confirmed'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-muted">Next responsibility</dt>
          <dd className="mt-1 break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">{owner.trim() || 'Not confirmed'}</dd>
        </div>
        <div className="col-span-2 min-w-0 lg:col-span-1">
          <dt className="text-xs font-semibold text-muted">Next step</dt>
          <dd className="mt-1 break-words text-sm text-ink [overflow-wrap:anywhere]">{nextStep.trim() || 'Review the record to confirm the next step.'}</dd>
        </div>
      </dl>
      {blockingReason && (
        <p className="mt-3 flex min-w-0 items-start gap-2 border-l-2 border-amber-500 pl-3 text-sm text-amber-900 dark:text-amber-100">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]"><strong>Needs attention: </strong>{blockingReason}</span>
        </p>
      )}
      {children && <div className="mt-3 flex min-w-0 flex-wrap items-center gap-3">{children}</div>}
    </section>
  );
}
