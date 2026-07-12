'use client';

import { Badge, Icon } from '@intra/ui';
import { evaluateSourcingReadiness } from '../policy';

export interface EvaluationMatrixValue {
  intendedResponses: number;
  vendorsInvited: number;
  responsesReceived: number;
  insufficientBidsExceptionApproved: boolean;
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
    intendedResponses: value.intendedResponses,
    invited: value.vendorsInvited,
    responses: value.responsesReceived,
    insufficientBidsExceptionApproved: value.insufficientBidsExceptionApproved,
  });
  const patch = (next: Partial<EvaluationMatrixValue>) => onChange?.({ ...value, ...next });

  return (
    <section className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">Competitive response record</h3>
          <p className="text-xs text-muted">
            Record the intended response count, actual outreach, and usable responses. Policy does not impose a fixed quote count.
          </p>
        </div>
        <Badge tone={readiness.ready ? 'emerald' : 'amber'}>
          {readiness.ready ? 'Ready for evaluation' : 'Exception required'}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {([
          ['intendedResponses', 'Intended responses'],
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
              min="0"
              step="1"
              readOnly={readOnly}
              value={value[key]}
              onChange={(event) => patch({ [key]: Math.max(0, Number(event.target.value) || 0) })}
            />
          </label>
        ))}
      </div>

      {!readiness.ready && (
        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={value.insufficientBidsExceptionApproved}
            disabled={readOnly}
            onChange={(event) => patch({ insufficientBidsExceptionApproved: event.target.checked })}
          />
          Approved insufficient-bids exception is attached to the sourcing record
        </label>
      )}

      <p className="flex gap-2 text-xs text-muted">
        <Icon name="info" className="h-4 w-4 shrink-0" />
        Technical and commercial scoring, clarifications, and award rationale must remain traceable to the same sourcing event.
      </p>
    </section>
  );
}
