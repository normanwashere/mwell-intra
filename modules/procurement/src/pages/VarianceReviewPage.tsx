'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Card, ModuleHero, money } from '@intra/ui';
import { useSession } from '@intra/auth';
import { BestValueEvaluation } from '../components/BestValueEvaluation';
import type {
  AwardRecommendation,
  CommercialTabulation,
  RecommendationVarianceDecision,
  SourcingEventStatus,
  TechnicalEvaluation,
  VarianceReviewEligibility,
} from '../types';

interface VarianceResponse {
  vendorId: string;
  vendorName: string;
  receivedAt?: string;
  deadlineCompliant?: boolean;
  commercial?: { amount?: number };
}

interface VarianceEvent {
  id: string;
  status: SourcingEventStatus;
  responses: VarianceResponse[];
  commercialTabulations?: CommercialTabulation[];
  technicalEvaluations?: TechnicalEvaluation[];
  awardRecommendation?: AwardRecommendation | null;
  varianceDecisions?: RecommendationVarianceDecision[];
  varianceEligibility?: VarianceReviewEligibility;
}

interface VarianceRequestSummary {
  id: string;
  title?: string;
  department?: string;
  costCenter?: string;
  category?: string;
  estimatedAmount?: number;
  status?: string;
}

interface VarianceWorkspace {
  request?: VarianceRequestSummary;
  event?: VarianceEvent | null;
  commercialTabulations?: CommercialTabulation[];
  technicalEvaluations?: TechnicalEvaluation[];
  awardRecommendation?: AwardRecommendation | null;
  varianceDecisions?: RecommendationVarianceDecision[];
  varianceEligibility?: VarianceReviewEligibility;
}

/**
 * This route deliberately does not use the normal request list adapter. A
 * non-Procurement DOA holder gets only the exact server-governed request and
 * the one variance decision that is currently eligible for them.
 */
export function VarianceReviewPage() {
  const { id = '' } = useParams();
  const { mode, supabaseClient } = useSession();
  const [workspace, setWorkspace] = useState<VarianceWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState('');
  const admittedRef = useRef(false);

  const load = useCallback(async () => {
    if (mode !== 'supabase' || !supabaseClient || !id) {
      setDenied('A governed live workspace is required for variance review.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabaseClient
        .schema('procurement')
        .rpc('evaluation_workspace', { payload: { request_id: id } });
      if (error) throw new Error(error.message);
      const next = (data ?? {}) as VarianceWorkspace;
      if (next.varianceEligibility?.canReview) admittedRef.current = true;
      if (!admittedRef.current) {
        setDenied('No governed variance decision is assigned to this account for this request.');
        setWorkspace(null);
        return;
      }
      setWorkspace({
        ...next,
        event: next.event
          ? {
              ...next.event,
              commercialTabulations: next.commercialTabulations,
              technicalEvaluations: next.technicalEvaluations,
              awardRecommendation: next.awardRecommendation,
              varianceDecisions: next.varianceDecisions,
              varianceEligibility: next.varianceEligibility,
            }
          : null,
      });
      setDenied('');
    } catch {
      if (!admittedRef.current) {
        setDenied('No governed variance decision is assigned to this account for this request.');
        setWorkspace(null);
      }
    } finally {
      setLoading(false);
    }
  }, [id, mode, supabaseClient]);

  useEffect(() => {
    admittedRef.current = false;
    void load();
  }, [load]);

  if (loading) {
    return <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6" aria-busy="true"><div className="h-40 animate-pulse rounded-2xl bg-inset" /></div>;
  }

  if (denied || !workspace?.event) {
    return <div role="alert" className="grid min-h-[60vh] place-items-center bg-app p-6 text-center"><div className="max-w-sm space-y-3"><h1 className="text-lg font-bold text-ink">No procurement access</h1><p className="text-sm text-muted">{denied || 'This governed review is not available.'}</p><a href="/" className="btn-primary min-h-11">Back to dashboard</a></div></div>;
  }

  const request = workspace.request;
  const eligibility = workspace.varianceEligibility;
  const stage = eligibility?.nextStage === 'department_head' ? 'Department Head' : 'Finance';
  const event = workspace.event;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6" aria-label="Governed variance review">
      <ModuleHero
        eyebrow="Procurement / governed variance"
        title={request?.title ?? 'Award recommendation variance'}
        description="Read the evidence pack and record only the independent decision assigned to you. Procurement authoring and sourcing actions are unavailable here."
        icon="check"
        accessory={<Badge tone={eligibility?.canReview ? 'amber' : 'emerald'}>{eligibility?.canReview ? `${stage} decision required` : 'Decision recorded'}</Badge>}
      />

      <Card aria-label="Read-only request summary" className="p-4 sm:p-5">
        <h2 className="text-base font-semibold text-ink">Request summary</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-muted">Department</dt><dd className="font-semibold text-ink">{request?.department ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted">Cost center</dt><dd className="font-semibold text-ink">{request?.costCenter ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted">Category</dt><dd className="font-semibold text-ink">{request?.category ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted">Estimated total</dt><dd className="font-semibold text-ink">{request?.estimatedAmount != null ? money(request.estimatedAmount) : '—'}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted">Server-scoped request {request?.id ?? id} · DOA matrix {eligibility?.doaMatrixVersion ?? 'verified when the decision is recorded'}.</p>
      </Card>

      <Card className="p-4 sm:p-5">
        <BestValueEvaluation
          requestId={id}
          event={event}
          canManage={false}
          client={supabaseClient}
          onChanged={load}
        />
      </Card>
    </div>
  );
}
