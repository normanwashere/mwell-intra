'use client';

import { Badge, Icon } from '@intra/ui';
import { evaluateSourcingReadiness } from '../policy';
import { MWELL_OPERATING_PROFILE } from '../policyProfile';

export interface EvaluationMatrixValue {
  intendedResponses: number;
  vendorsInvited: number;
  responsesReceived: number;
}

export function EvaluationMatrix({
  value,
  onChange,
  readOnly = false,
}: {
  value: EvaluationMatrixValue;
  onChange?: (value: EvaluationMatrixValue) => void;
  readOnly?: boolean;
}) {
  const readiness = evaluateSourcingReadiness({
    method: 'rfq',
    invited: value.vendorsInvited,
    usableResponses: value.responsesReceived,
    profile: MWELL_OPERATING_PROFILE,
  });
  const patch = (next: Partial<EvaluationMatrixValue>) => onChange?.({ ...value, ...next });

  return (
    <section className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">Competitive response record</h3>
          <p className="text-xs text-muted">
            Competitive sourcing normally targets 3-4 accredited vendors. Sealed-bid evaluation requires three usable responses unless the governed exception workflow approves otherwise.
          </p>
        </div>
        <Badge tone={readiness.ready ? 'emerald' : 'amber'}>
          {readiness.ready ? 'Ready for evaluation' : readiness.state === 'failed_bid' ? 'Exception workflow required' : 'Invitation minimum required'}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {([
          ['intendedResponses', 'Invitation target (3 or 4)'],
          ['vendorsInvited', 'Vendors invited'],
          ['responsesReceived', 'Usable responses'],
        ] as const).map(([key, label]) => (
          <label key={key} className="text-sm font-semibold text-ink">
            {label}
            <input
              aria-label={label}
              className="input mt-1.5"
              type="number"
              inputMode="numeric"
              min={key === 'intendedResponses' ? 3 : 0}
              max={key === 'intendedResponses' ? 4 : undefined}
              step="1"
              readOnly={readOnly}
              value={value[key]}
              onChange={(event) => patch({ [key]: Math.max(0, Number(event.target.value) || 0) })}
            />
          </label>
        ))}
      </div>

      {!readiness.ready && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-ink">{readiness.blocker} Submit and review an exception from the governed sourcing workspace; this form cannot approve it.</p>}

      <p className="flex gap-2 text-xs text-muted">
        <Icon name="info" className="h-4 w-4 shrink-0" />
        Technical and commercial scoring, clarifications, and award rationale must remain traceable to the same sourcing event.
      </p>
    </section>
  );
}
