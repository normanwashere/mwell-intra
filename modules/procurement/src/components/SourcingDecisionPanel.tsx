'use client';

import { Badge, Icon } from '@intra/ui';
import type { ProcurementRiskFacts, SourcingMethod } from '../types';
import { sourcingMethodLabel, type SourcingRecommendation } from '../policy';

const RISK_LABELS: Array<[keyof ProcurementRiskFacts, string]> = [
  ['comparable', 'Requirements are clear and comparable'],
  ['complex', 'Complex scope or delivery'],
  ['technical', 'Technical evaluation required'],
  ['strategic', 'Strategic engagement'],
  ['highRisk', 'High operational, financial, or legal risk'],
  ['dataSensitive', 'Personal, health, or sensitive data involved'],
  ['importation', 'Importation or offshore shipment/payment'],
];

const METHODS: SourcingMethod[] = [
  'petty_cash',
  'rfq',
  'rfp',
  'direct_award',
  'repeat_order',
  'emergency',
];

export function SourcingDecisionPanel({
  riskFacts,
  onRiskFactsChange,
  recommendation,
  value,
  onChange,
  canConfirm,
  confirmed,
}: {
  riskFacts: ProcurementRiskFacts;
  onRiskFactsChange: (value: ProcurementRiskFacts) => void;
  recommendation: SourcingRecommendation;
  value: SourcingMethod;
  onChange: (value: SourcingMethod) => void;
  canConfirm: boolean;
  confirmed: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-inset p-3">
        <div>
          <p className="text-xs font-semibold uppercase text-faint">Policy recommendation</p>
          <p className="font-semibold text-ink">{sourcingMethodLabel(recommendation.method)}</p>
        </div>
        <Badge tone={confirmed ? 'emerald' : 'amber'}>
          {confirmed ? 'Procurement confirmed' : 'Procurement confirmation required'}
        </Badge>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">Routing facts</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {RISK_LABELS.map(([key, label]) => (
            <label key={key} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={riskFacts[key]}
                onChange={(event) => onRiskFactsChange({ ...riskFacts, [key]: event.target.checked })}
                className="h-5 w-5 rounded border-line text-brand-600"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm font-semibold text-ink">
        Sourcing method
        <select
          className="input mt-1.5"
          value={value}
          disabled={!canConfirm}
          onChange={(event) => onChange(event.target.value as SourcingMethod)}
        >
          {METHODS.map((method) => <option key={method} value={method}>{sourcingMethodLabel(method)}</option>)}
        </select>
      </label>
      {!canConfirm && (
        <p className="flex gap-2 text-xs text-muted"><Icon name="lock" className="h-4 w-4 shrink-0" />The requester supplies facts. Procurement confirms the final route and any exception before submission.</p>
      )}
    </div>
  );
}
