'use client';

import { useMemo, useState } from 'react';
import { Badge, Icon, money, useToast } from '@intra/ui';
import { validateAwardRecommendation } from '../policy';
import type {
  AwardRecommendation,
  CommercialTabulation,
  EvaluationCriterionKey,
  RecommendationVarianceDecision,
  SourcingEventStatus,
  TechnicalEvaluation,
} from '../types';

interface RpcClient {
  schema(name: string): {
    rpc(name: string, args: { payload: Record<string, unknown> }): PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
}

interface SourcingResponse {
  vendorId: string;
  vendorName: string;
  receivedAt?: string;
  deadlineCompliant?: boolean;
  commercial?: { amount?: number };
}

interface EvaluationWorkspace {
  commercialTabulations?: CommercialTabulation[];
  technicalEvaluations?: TechnicalEvaluation[];
  awardRecommendation?: AwardRecommendation | null;
  varianceDecisions?: RecommendationVarianceDecision[];
}

interface EvaluationEvent extends EvaluationWorkspace {
  id: string;
  status: SourcingEventStatus;
  responses: SourcingResponse[];
}

const criteria: Array<{ key: EvaluationCriterionKey; label: string }> = [
  { key: 'technicalCompliance', label: 'Technical compliance' },
  { key: 'quality', label: 'Quality' },
  { key: 'leadTime', label: 'Lead time' },
  { key: 'totalLifecycleCost', label: 'Total lifecycle cost' },
  { key: 'warranty', label: 'Warranty and support' },
  { key: 'support', label: 'Support' },
  { key: 'price', label: 'Price' },
  { key: 'paymentTerms', label: 'Payment terms' },
  { key: 'training', label: 'Training' },
];

function scoreRecord(): Record<EvaluationCriterionKey, number> {
  return Object.fromEntries(criteria.map(({ key }) => [key, 0])) as Record<EvaluationCriterionKey, number>;
}

function latestSubmitted<T extends { status: string; version: number }>(rows: readonly T[] | undefined) {
  return [...(rows ?? [])]
    .filter((row) => row.status === 'submitted')
    .sort((left, right) => right.version - left.version)[0];
}

export function BestValueEvaluation({
  requestId,
  event,
  canManage,
  canReview,
  client,
  onChanged,
}: {
  requestId: string;
  event: EvaluationEvent;
  canManage: boolean;
  canReview: boolean;
  client: RpcClient | null;
  onChanged?: () => Promise<void>;
}) {
  const { error, success } = useToast();
  const [busy, setBusy] = useState(false);
  const [tabulationEvidence, setTabulationEvidence] = useState('');
  const [tabulationComments, setTabulationComments] = useState('');
  const [technicalVendorId, setTechnicalVendorId] = useState('');
  const [technicalEvidence, setTechnicalEvidence] = useState('');
  const [technicalComments, setTechnicalComments] = useState('');
  const [scores, setScores] = useState(scoreRecord);
  const [recommendedVendorId, setRecommendedVendorId] = useState('');
  const [recommendationRationale, setRecommendationRationale] = useState('');
  const [riskEvidenceReference, setRiskEvidenceReference] = useState('');
  const [varianceJustification, setVarianceJustification] = useState('');
  const [varianceNote, setVarianceNote] = useState('');

  const received = useMemo(
    () => event.responses.filter((response) => response.receivedAt && response.deadlineCompliant !== false),
    [event.responses],
  );
  const tabulation = latestSubmitted(event.commercialTabulations);
  const technicalEvaluations = useMemo(
    () => (event.technicalEvaluations ?? []).filter((item) => item.status === 'submitted'),
    [event.technicalEvaluations],
  );
  const evaluatedVendorId = useMemo(
    () => [...technicalEvaluations].sort((left, right) => right.totalScore - left.totalScore)[0]?.vendorId ?? '',
    [technicalEvaluations],
  );
  const selectedTechnicalEvaluation = technicalEvaluations.find((item) => item.vendorId === recommendedVendorId);
  const recommendation = event.awardRecommendation ?? null;
  const pendingVariance = recommendation?.status === 'pending_variance';

  async function call(name: string, payload: Record<string, unknown>) {
    if (!client) throw new Error('The governed best-value workspace requires the live database.');
    const result = await client.schema('procurement').rpc(name, { payload });
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      await onChanged?.();
      success(message);
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Could not update the best-value evaluation.');
    } finally {
      setBusy(false);
    }
  }

  const varianceRequired = Boolean(evaluatedVendorId && recommendedVendorId && evaluatedVendorId !== recommendedVendorId);
  const recommendationBlockers = validateAwardRecommendation({
    evaluatedVendorId,
    recommendedVendorId,
    rationale: recommendationRationale,
    commercialTabulationId: tabulation?.id,
    technicalEvaluationId: selectedTechnicalEvaluation?.id,
    riskEvidenceReference,
    varianceJustification,
  });

  if (event.status !== 'evaluation' && !recommendation) return null;

  return (
    <section className="space-y-4 border-t border-line pt-4" aria-label="Best-value evaluation">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">Best-value evaluation</h3>
          <p className="max-w-3xl text-sm text-muted">
            Compare the complete commercial and technical record. Scores rank an evaluation; a separate governed recommendation and approval record are required before award.
          </p>
        </div>
        <Badge tone={recommendation?.status === 'approved' ? 'emerald' : pendingVariance ? 'amber' : 'slate'}>
          {recommendation?.status?.replaceAll('_', ' ') ?? 'Evidence in progress'}
        </Badge>
      </div>

      <section className="space-y-3 rounded-lg border border-line p-3" aria-label="Commercial tabulation">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h4 className="font-semibold text-ink">Commercial tabulation</h4><p className="text-xs text-muted">A versioned tabulation is due within the active policy’s 48-hour response-closure SLA.</p></div>
          {tabulation && <Badge tone={tabulation.escalationStatus === 'on_track' ? 'emerald' : 'amber'}>{tabulation.escalationStatus.replaceAll('_', ' ')}</Badge>}
        </div>
        <div className="overflow-x-auto rounded border border-line"><table className="min-w-[42rem] w-full text-left text-sm"><thead className="bg-inset text-xs text-muted"><tr><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Quote</th><th className="px-3 py-2">Evidence</th></tr></thead><tbody className="divide-y divide-line">{received.map((response) => <tr key={response.vendorId}><td className="px-3 py-2 font-medium text-ink">{response.vendorName}</td><td className="px-3 py-2 text-ink">{response.commercial?.amount ? money(response.commercial.amount) : 'Not recorded'}</td><td className="px-3 py-2 text-muted">Controlled proposal record</td></tr>)}</tbody></table></div>
        {canManage && !tabulation && <div className="grid gap-3 md:grid-cols-2"><label className="block text-sm font-semibold text-ink">Tabulation evidence reference<input aria-label="Tabulation evidence reference" className="input mt-1.5" value={tabulationEvidence} onChange={(event) => setTabulationEvidence(event.target.value)} /></label><label className="block text-sm font-semibold text-ink">Commercial comparison notes<textarea aria-label="Commercial comparison notes" className="input mt-1.5" rows={2} value={tabulationComments} onChange={(event) => setTabulationComments(event.target.value)} /></label><button type="button" className="btn-outline min-h-11 w-full md:w-auto" disabled={busy || !tabulationEvidence.trim() || received.length === 0} onClick={() => void run(() => call('save_commercial_tabulation', { sourcing_event_id: event.id, evidence_reference: tabulationEvidence.trim(), comments: tabulationComments.trim(), entries: received.map((response) => ({ vendor_id: response.vendorId, quoted_amount: response.commercial?.amount ?? null, evidence_reference: response.commercial?.amount ? 'Recorded proposal commercial value' : '' })) }), 'Commercial tabulation submitted for the governed record')}><Icon name="check" className="h-4 w-4" />Save commercial tabulation</button></div>}
      </section>

      <section className="space-y-3 rounded-lg border border-line p-3" aria-label="Technical evaluation">
        <div><h4 className="font-semibold text-ink">Technical evaluation</h4><p className="text-xs text-muted">Each reviewer records the criterion scores, evidence, comments, and delivery SLA. The working-day due date follows Asia/Manila and configured policy holidays.</p></div>
        {technicalEvaluations.length > 0 && <div className="overflow-x-auto rounded border border-line"><table className="min-w-[42rem] w-full text-left text-sm"><thead className="bg-inset text-xs text-muted"><tr><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">SLA</th></tr></thead><tbody className="divide-y divide-line">{technicalEvaluations.map((item) => <tr key={item.id}><td className="px-3 py-2 text-ink">{received.find((response) => response.vendorId === item.vendorId)?.vendorName ?? item.vendorId}</td><td className="px-3 py-2 font-semibold text-ink">{item.totalScore.toFixed(1)}</td><td className="px-3 py-2 text-muted">{new Date(item.dueAt).toLocaleDateString()}</td><td className="px-3 py-2"><Badge tone={item.escalationStatus === 'on_track' ? 'emerald' : 'amber'}>{item.escalationStatus.replaceAll('_', ' ')}</Badge></td></tr>)}</tbody></table></div>}
        {canManage && tabulation && <div className="grid gap-3 md:grid-cols-2"><label className="block text-sm font-semibold text-ink">Vendor under review<select aria-label="Technical evaluation vendor" className="input mt-1.5" value={technicalVendorId} onChange={(event) => setTechnicalVendorId(event.target.value)}><option value="">Select vendor</option>{received.map((response) => <option key={response.vendorId} value={response.vendorId}>{response.vendorName}</option>)}</select></label><label className="block text-sm font-semibold text-ink">Technical evidence reference<input aria-label="Technical evidence reference" className="input mt-1.5" value={technicalEvidence} onChange={(event) => setTechnicalEvidence(event.target.value)} /></label><label className="block text-sm font-semibold text-ink md:col-span-2">Technical review comments<textarea aria-label="Technical review comments" className="input mt-1.5" rows={2} value={technicalComments} onChange={(event) => setTechnicalComments(event.target.value)} /></label><div className="grid gap-2 md:col-span-2 sm:grid-cols-3">{criteria.map((criterion) => <label key={criterion.key} className="block text-xs font-semibold text-ink">{criterion.label}<input aria-label={`${criterion.label} score`} type="number" min={0} max={100} className="input mt-1" value={scores[criterion.key]} onChange={(event) => setScores((current) => ({ ...current, [criterion.key]: Math.min(100, Math.max(0, Number(event.target.value) || 0)) }))} /></label>)}</div><button type="button" className="btn-outline min-h-11 w-full md:w-auto" disabled={busy || !technicalVendorId || !technicalEvidence.trim()} onClick={() => void run(() => call('submit_technical_evaluation', { sourcing_event_id: event.id, vendor_id: technicalVendorId, evidence_reference: technicalEvidence.trim(), comments: technicalComments.trim(), criteria: criteria.map(({ key }) => ({ criterion: key, score: scores[key], evidence_reference: technicalEvidence.trim(), comments: technicalComments.trim() })) }), 'Technical evaluation submitted with evidence')}><Icon name="check" className="h-4 w-4" />Submit technical evaluation</button></div>}
      </section>

      <section className="space-y-3 rounded-lg border border-line p-3" aria-label="Award recommendation">
        <div><h4 className="font-semibold text-ink">Award recommendation</h4><p className="text-xs text-muted">The highest evaluated score is shown as the evaluation reference. Choosing another vendor requires a written variance and independent Department Head plus Finance review.</p></div>
        <p className="text-sm text-ink">Evaluated reference: <strong>{received.find((response) => response.vendorId === evaluatedVendorId)?.vendorName ?? 'Complete technical evaluation first'}</strong></p>
        {canManage && !recommendation && <div className="grid gap-3 md:grid-cols-2"><label className="block text-sm font-semibold text-ink">Recommended vendor<select aria-label="Best-value recommended vendor" className="input mt-1.5" value={recommendedVendorId} onChange={(event) => setRecommendedVendorId(event.target.value)}><option value="">Select evaluated vendor</option>{technicalEvaluations.map((item) => <option key={item.id} value={item.vendorId}>{received.find((response) => response.vendorId === item.vendorId)?.vendorName ?? item.vendorId}</option>)}</select></label><label className="block text-sm font-semibold text-ink">Risk evidence reference<input aria-label="Risk evidence reference" className="input mt-1.5" value={riskEvidenceReference} onChange={(event) => setRiskEvidenceReference(event.target.value)} /></label><label className="block text-sm font-semibold text-ink md:col-span-2">Recommendation rationale<textarea aria-label="Best-value rationale" className="input mt-1.5" rows={3} value={recommendationRationale} onChange={(event) => setRecommendationRationale(event.target.value)} /></label>{varianceRequired && <label className="block text-sm font-semibold text-ink md:col-span-2">Written variance justification<textarea aria-label="Written variance justification" className="input mt-1.5" rows={3} value={varianceJustification} onChange={(event) => setVarianceJustification(event.target.value)} /></label>}<button type="button" className="btn-primary min-h-11 w-full md:w-auto" disabled={busy || recommendationBlockers.length > 0} onClick={() => void run(() => call('submit_award_recommendation', { sourcing_event_id: event.id, evaluated_vendor_id: evaluatedVendorId, recommended_vendor_id: recommendedVendorId, rationale: recommendationRationale.trim(), commercial_tabulation_id: tabulation?.id, technical_evaluation_id: selectedTechnicalEvaluation?.id, risk_evidence_reference: riskEvidenceReference.trim(), variance_justification: varianceJustification.trim() }), varianceRequired ? 'Variance recommendation submitted for independent approval' : 'Best-value recommendation submitted')}><Icon name="check" className="h-4 w-4" />Submit recommendation</button>{recommendationBlockers.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300 md:col-span-2">{recommendationBlockers.join(' ')}</p>}</div>}
        {recommendation && <div className="rounded bg-inset p-3 text-sm text-ink"><p><strong>Recommended vendor:</strong> {received.find((response) => response.vendorId === recommendation.recommendedVendorId)?.vendorName ?? recommendation.recommendedVendorId}</p><p className="mt-1 text-muted">{recommendation.rationale}</p></div>}
        {pendingVariance && canReview && <div className="grid gap-3 border-t border-line pt-3 md:grid-cols-[1fr_auto_auto]"><label className="block text-sm font-semibold text-ink md:col-span-3">Independent decision note<textarea aria-label="Variance approval note" className="input mt-1.5" rows={2} value={varianceNote} onChange={(event) => setVarianceNote(event.target.value)} /></label><button type="button" className="btn-outline min-h-11" disabled={busy || !varianceNote.trim()} onClick={() => void run(() => call('review_recommendation_variance', { award_recommendation_id: recommendation.id, expected_version: recommendation.version, decision: 'rejected', note: varianceNote.trim() }), 'Variance recommendation rejected')}><Icon name="x" className="h-4 w-4" />Reject variance</button><button type="button" className="btn-primary min-h-11" disabled={busy || !varianceNote.trim()} onClick={() => void run(() => call('review_recommendation_variance', { award_recommendation_id: recommendation.id, expected_version: recommendation.version, decision: 'approved', note: varianceNote.trim() }), 'Independent variance decision recorded')}><Icon name="check" className="h-4 w-4" />Record approval</button></div>}
      </section>
    </section>
  );
}
