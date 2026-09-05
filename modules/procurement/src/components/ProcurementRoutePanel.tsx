'use client';

import { Badge, Icon } from '@intra/ui';
import type {
  ProcurementMode,
  ProcurementPolicyProfile,
  ProcurementRoute,
} from '../types';
import type { ProcurementRouteRecommendation } from '../policyRoute';

const MODE_LABELS: Record<ProcurementMode, string> = {
  competitive_bidding: 'Competitive bidding',
  sole_source: 'Sole source',
  repeat_order: 'Repeat order',
  emergency_purchase: 'Emergency purchase',
  petty_cash: 'Petty cash',
  approved_exception: 'Approved exception',
};

const SOLICITATION_LABELS: Record<ProcurementRoute['solicitationType'], string> = {
  rfq: 'Request for Quotation',
  rfp: 'Request for Proposal',
  none: 'No solicitation document',
};

const TIER_LABELS: Record<ProcurementRoute['governanceTier'], string> = {
  standard: 'Standard controls',
  formal_bid: 'Formal bid controls',
  high_risk: 'High-risk controls',
};

const REASON_LABELS: Record<string, string> = {
  material_requirement: 'Goods or materials requirement',
  service_requirement: 'Service requirement',
  'risk:complex': 'Complex scope or delivery',
  'risk:technical': 'Technical evaluation required',
  'risk:strategic': 'Strategic engagement',
  'risk:high_risk': 'High operational, financial, or legal risk',
  'risk:data_sensitive': 'Sensitive data involved',
  'risk:importation': 'Importation or offshore shipment/payment',
  'scope:not_comparable': 'Requirements are not clear or consistently comparable',
  'solicitation:rfq': 'RFQ selected by the amount and complexity rule',
  'solicitation:rfp': 'RFP selected by the amount and complexity rule',
  'solicitation:none': 'No solicitation document for this supported exception mode',
};

const EXCEPTION_MODES: ProcurementMode[] = [
  'sole_source',
  'repeat_order',
  'emergency_purchase',
  'petty_cash',
  'approved_exception',
];

function reasonLabel(reason: string): string {
  if (REASON_LABELS[reason]) return REASON_LABELS[reason];
  if (reason.startsWith('mode:')) return `Mode: ${MODE_LABELS[reason.slice(5) as ProcurementMode] ?? reason.slice(5)}`;
  if (reason.startsWith('tier:')) return `Control tier: ${TIER_LABELS[reason.slice(5) as ProcurementRoute['governanceTier']] ?? reason.slice(5)}`;
  return reason.replaceAll('_', ' ');
}

export function ProcurementRoutePanel({
  value,
  recommendation,
  profile,
  canConfirm,
  onModeChange,
}: {
  value: ProcurementRoute;
  recommendation: ProcurementRouteRecommendation;
  profile: ProcurementPolicyProfile;
  canConfirm: boolean;
  onModeChange: (mode: ProcurementMode) => void;
}) {
  const exception = EXCEPTION_MODES.includes(value.procurementMode);
  return (
    <section aria-label="Procurement route" className="space-y-3 rounded-lg border border-line bg-inset p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Procurement route</p>
          <p className="mt-0.5 text-xs text-muted">The policy computes the document and control tier. Procurement selects a supported mode.</p>
        </div>
        <Badge tone={recommendation.requiresProcurementConfirmation ? 'amber' : 'emerald'}>
          {recommendation.requiresProcurementConfirmation ? 'Confirmation required' : 'Confirmed'}
        </Badge>
      </div>

      <dl className="grid gap-2 sm:grid-cols-3">
        <RouteRow label="Solicitation document" value={SOLICITATION_LABELS[value.solicitationType]} />
        <RouteRow label="Procurement mode" value={MODE_LABELS[value.procurementMode]} />
        <RouteRow label="Governance tier" value={TIER_LABELS[value.governanceTier]} />
      </dl>

      <label className="block text-sm font-semibold text-ink">
        Requested procurement mode
        <select
          className="input mt-1.5 min-h-11"
          value={value.procurementMode}
          disabled={!canConfirm}
          onChange={(event) => onModeChange(event.target.value as ProcurementMode)}
        >
          {(Object.keys(MODE_LABELS) as ProcurementMode[]).map((mode) => (
            <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>
          ))}
        </select>
      </label>
      {!canConfirm && (
        <p className="flex gap-2 text-xs text-muted"><Icon name="lock" className="h-4 w-4 shrink-0" />Procurement confirms the route. Requesters can review the computed controls and provide evidence.</p>
      )}
      {exception && (
        <div role="note" className="rounded-md border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <strong>Exception evidence is required.</strong> A selected exception is not an approval. Record the policy basis, justification, price reasonableness, and required approver evidence before confirmation.
        </div>
      )}

      <details className="rounded-md border border-line bg-surface p-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">Why this route and policy profile</summary>
        <div className="mt-3 space-y-2 text-xs text-muted">
          <p><strong className="text-ink">Profile:</strong> {profile.name} ({profile.code} {profile.version}) · {profile.status === 'active' ? 'active' : 'draft preview'}</p>
          <p><strong className="text-ink">Source document:</strong> {profile.sourceDocumentStatus === 'approved' ? 'approved' : 'updated visual draft for review'}</p>
          <p><strong className="text-ink">Effective from:</strong> {profile.effectiveFrom}</p>
          <ul className="list-disc space-y-1 pl-5">
            {value.reasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}
          </ul>
        </div>
      </details>
    </section>
  );
}

function RouteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2">
      <dt className="text-xs font-semibold uppercase text-faint">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
