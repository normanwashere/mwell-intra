'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Icon, useToast } from '@intra/ui';
import type { ProcurementExceptionPack, ProcurementMode } from '../types';

interface RpcClient {
  schema(name: string): {
    rpc(name: string, args: { payload: Record<string, unknown> }): PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
}

type ReviewStage = 'procurement' | 'finance' | 'doa';
type Decision = 'approved' | 'rejected';

interface ExceptionWorkspaceState {
  mode: Exclude<ProcurementMode, 'competitive_bidding'>;
  notApplicable?: boolean;
  profile?: {
    id: string;
    code: string;
    version: string;
    repeatOrderMaxAmount: number;
    repeatOrderMaxAgeDays: number;
    pettyCashMaxAmount: number;
  };
  pack?: {
    id: string;
    status: 'under_review' | 'approved' | 'rejected' | 'superseded';
    revision: number;
    evidence?: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
    priceReasonableness?: string;
  } | null;
  blockers: string[];
  recovery: string;
  history: Array<{ stage: string; decision: string; actorId?: string; decidedAt?: string; note?: string; revision?: number }>;
  actions: { canSubmit: boolean; canProcurementReview: boolean; canFinanceReview: boolean; canDoaReview: boolean };
}

function statusTone(status: string | undefined) {
  if (status === 'approved') return 'emerald' as const;
  if (status === 'rejected' || status === 'superseded') return 'rose' as const;
  return 'amber' as const;
}

function readEvidence(initial: ProcurementExceptionPack | undefined): Record<string, unknown> {
  const repeat = initial?.repeatOrder;
  const emergency = initial?.emergency;
  return {
    soleSourceBasis: initial?.soleSourceBasis,
    evidenceReferences: initial?.evidenceReferences ?? [],
    priorRequestId: repeat?.priorRequestId,
    priorSourcingEventId: repeat?.priorSourcingEventId,
    priorAwardId: repeat?.priorAwardId,
    priorPurchaseOrderId: repeat?.priorPurchaseOrderId,
    emergencyBasis: emergency?.basis,
    authorityReference: emergency?.authorityReference,
    commitmentTimestamp: emergency?.commitmentTimestamp,
    minimizedVerbalCommitment: emergency?.minimizedVerbalCommitment === true,
    retrospectivePoDueAt: emergency?.retrospectivePoDueAt,
    splitPurchase: initial?.nonRecurringNonSplitAttested === false,
    recurring: initial?.nonRecurringNonSplitAttested === false,
    receiptPresent: initial?.receiptOrInvoiceSupported === true,
    liquidationRecorded: initial?.liquidationRecorded === true,
    approvedExceptionPackId: initial?.approvedExceptionPackId,
  };
}

function actorStageLabel(stage: string) {
  return stage === 'doa' ? 'DOA' : stage === 'finance' ? 'Finance' : stage === 'procurement' ? 'Procurement' : 'Evidence submitted';
}

export function ExceptionWorkspace({
  requestId,
  mode,
  expectedRouteVersion,
  client,
  initialEvidence,
  onChanged,
}: {
  requestId: string;
  mode: Exclude<ProcurementMode, 'competitive_bidding'>;
  expectedRouteVersion: number;
  client: RpcClient | null;
  initialEvidence?: ProcurementExceptionPack;
  onChanged?: () => Promise<void>;
}) {
  const { success, error } = useToast();
  const [workspace, setWorkspace] = useState<ExceptionWorkspaceState | null>(null);
  const [loading, setLoading] = useState(Boolean(client));
  const [busy, setBusy] = useState(false);
  const [justification, setJustification] = useState(initialEvidence?.justification ?? '');
  const [priceReasonableness, setPriceReasonableness] = useState(initialEvidence?.priceReasonableness ?? '');
  const [evidence, setEvidence] = useState<Record<string, unknown>>(() => readEvidence(initialEvidence));
  const [note, setNote] = useState('');

  const call = useCallback(async (name: string, payload: Record<string, unknown>) => {
    if (!client) throw new Error('Connect to the live database to operate the governed exception workspace.');
    const { data, error: rpcError } = await client.schema('procurement').rpc(name, { payload });
    if (rpcError) throw new Error(rpcError.message);
    return data;
  }, [client]);

  const load = useCallback(async () => {
    if (!client) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await call('exception_workspace', { request_id: requestId, mode });
      const next = data as ExceptionWorkspaceState;
      setWorkspace(next);
      if (next.pack?.evidence) setEvidence((current) => ({ ...current, ...next.pack?.evidence }));
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Could not load the governed exception workspace.');
    } finally { setLoading(false); }
  }, [call, client, error, mode, requestId]);

  useEffect(() => { void load(); }, [load]);

  const references = useMemo(() => Array.isArray(evidence.evidenceReferences)
    ? evidence.evidenceReferences.filter((item): item is string => typeof item === 'string')
    : [], [evidence.evidenceReferences]);
  const patchEvidence = (patch: Record<string, unknown>) => setEvidence((current) => ({ ...current, ...patch }));

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await action();
      await load();
      await onChanged?.();
      success(message);
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'The governed exception action could not be completed.');
    } finally { setBusy(false); }
  }

  const submit = () => run(
    () => call('submit_policy_exception_pack', {
      request_id: requestId,
      mode,
      expected_route_version: expectedRouteVersion,
      justification: justification.trim(),
      price_reasonableness: priceReasonableness.trim(),
      evidence,
    }).then(() => undefined),
    'Exception evidence submitted for independent review.',
  );
  const review = (stage: ReviewStage, decision: Decision) => workspace?.pack && run(
    () => call('review_policy_exception_pack', {
      id: workspace.pack?.id,
      stage,
      decision,
      expected_revision: workspace.pack?.revision,
      note: note.trim(),
    }).then(() => undefined),
    decision === 'approved' ? `${actorStageLabel(stage)} decision recorded.` : `${actorStageLabel(stage)} rejection recorded.`,
  ).finally(() => setNote(''));

  if (loading) return <div className="h-44 animate-pulse rounded-lg bg-inset" aria-busy="true" />;
  if (!client) return <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-ink"><h2 className="font-semibold">Governed exception workspace</h2><p className="mt-1">Connect to the live database to submit evidence or record independent reviews. Local draft evidence is not an approval.</p></section>;
  if (!workspace || workspace.notApplicable) return null;

  const pack = workspace.pack;
  const activeActions = workspace.actions;
  const staleBinding = workspace.blockers.some((blocker) => blocker.endsWith('_restart_exception'));
  const needsEvidence = !pack || pack.status === 'rejected' || pack.status === 'superseded' || staleBinding;
  return <section className="space-y-4" aria-label="Governed exception workspace">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold text-ink">Governed exception workspace</h2><p className="max-w-3xl text-sm text-muted">This is the authoritative exception record. Requester evidence is separate from Procurement, Finance, and DOA decisions.</p></div>
      <div className="flex items-center gap-2"><button type="button" className="btn-icon" aria-label="Refresh exception workspace" title="Refresh exception workspace" disabled={busy} onClick={() => void load()}><Icon name="rotate" className="h-4 w-4" /></button><Badge tone={statusTone(pack?.status ?? 'under_review')}>{pack?.status?.replaceAll('_', ' ') ?? 'Evidence needed'}</Badge></div>
    </div>

    {workspace.profile && <dl className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-inset p-3 text-sm sm:grid-cols-4"><div><dt className="text-xs text-muted">Policy profile</dt><dd className="font-semibold text-ink">{workspace.profile.code} · {workspace.profile.version}</dd></div><div><dt className="text-xs text-muted">Repeat cap</dt><dd className="font-semibold text-ink">{workspace.profile.repeatOrderMaxAmount.toLocaleString()}</dd></div><div><dt className="text-xs text-muted">Repeat age</dt><dd className="font-semibold text-ink">{workspace.profile.repeatOrderMaxAgeDays} days</dd></div><div><dt className="text-xs text-muted">Petty cash cap</dt><dd className="font-semibold text-ink">{workspace.profile.pettyCashMaxAmount.toLocaleString()}</dd></div></dl>}

    {workspace.blockers.length > 0 && <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" aria-live="polite"><h3 className="font-semibold text-ink">Server blockers</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950 dark:text-amber-100">{workspace.blockers.map((blocker) => <li key={blocker}>{blocker.replaceAll('_', ' ')}</li>)}</ul><p className="mt-2 text-xs text-muted">{workspace.recovery}</p></section>}

    {needsEvidence && activeActions.canSubmit && <section className="space-y-3 rounded-lg border border-line p-3">
      <div><h3 className="font-semibold text-ink">{staleBinding ? 'Replace stale exception evidence' : 'Submit evidence for review'}</h3><p className="text-sm text-muted">Submitting replaces an outdated or rejected pack. The server derives and locks any policy facts it can verify.</p></div>
      <label className="block text-sm font-semibold text-ink">Business justification<textarea className="input mt-1.5" rows={3} value={justification} onChange={(event) => setJustification(event.target.value)} /></label>
      {mode !== 'petty_cash' && <label className="block text-sm font-semibold text-ink">Price reasonableness<textarea className="input mt-1.5" rows={2} value={priceReasonableness} onChange={(event) => setPriceReasonableness(event.target.value)} /></label>}
      {mode === 'sole_source' && <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold text-ink">Sole-source basis<select className="input mt-1.5" value={String(evidence.soleSourceBasis ?? '')} onChange={(event) => patchEvidence({ soleSourceBasis: event.target.value })}><option value="">Select policy basis</option><option value="only_acceptable_source">Only acceptable source</option><option value="compatibility">Compatibility</option><option value="specialization">Specialization</option><option value="unique_capability">Unique capability</option><option value="manufacturer">Manufacturer</option><option value="authorized_distributor">Authorized distributor</option></select></label><label className="block text-sm font-semibold text-ink">Evidence references, one per line<textarea className="input mt-1.5" rows={3} value={references.join('\n')} onChange={(event) => patchEvidence({ evidenceReferences: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></label></div>}
      {mode === 'repeat_order' && <div className="grid gap-3 sm:grid-cols-2">{(['priorRequestId','priorSourcingEventId','priorAwardId','priorPurchaseOrderId'] as const).map((key) => <label key={key} className="block text-sm font-semibold text-ink">{key === 'priorRequestId' ? 'Prior request ID' : key === 'priorSourcingEventId' ? 'Prior sourcing event ID' : key === 'priorAwardId' ? 'Prior award recommendation ID' : 'Prior PO ID'}<input className="input mt-1.5" value={String(evidence[key] ?? '')} onChange={(event) => patchEvidence({ [key]: event.target.value })} /></label>)}</div>}
      {mode === 'emergency_purchase' && <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold text-ink">Emergency basis<select className="input mt-1.5" value={String(evidence.emergencyBasis ?? '')} onChange={(event) => patchEvidence({ emergencyBasis: event.target.value })}><option value="">Select basis</option><option value="life_safety">Life safety</option><option value="environmental">Environmental risk</option><option value="serious_disruption">Serious operational disruption</option></select></label><label className="block text-sm font-semibold text-ink">Authority reference<input className="input mt-1.5" value={String(evidence.authorityReference ?? '')} onChange={(event) => patchEvidence({ authorityReference: event.target.value })} /></label><label className="block text-sm font-semibold text-ink">Commitment time<input className="input mt-1.5" type="datetime-local" value={String(evidence.commitmentTimestamp ?? '')} onChange={(event) => patchEvidence({ commitmentTimestamp: event.target.value })} /></label><label className="block text-sm font-semibold text-ink">Retrospective PO due<input className="input mt-1.5" type="datetime-local" value={String(evidence.retrospectivePoDueAt ?? '')} onChange={(event) => patchEvidence({ retrospectivePoDueAt: event.target.value })} /></label><label className="flex min-h-11 items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" checked={evidence.minimizedVerbalCommitment === true} onChange={(event) => patchEvidence({ minimizedVerbalCommitment: event.target.checked })} />Verbal commitment was limited to emergency containment.</label></div>}
      {mode === 'petty_cash' && <div className="grid gap-2 sm:grid-cols-2">{([['splitPurchase','Not split'],['recurring','Not recurring'],['receiptPresent','Receipt or invoice attached'],['liquidationRecorded','Liquidation recorded']] as const).map(([key,label]) => <label key={key} className="flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm text-ink"><input type="checkbox" checked={key === 'splitPurchase' || key === 'recurring' ? evidence[key] !== true : evidence[key] === true} onChange={(event) => patchEvidence({ [key]: key === 'splitPurchase' || key === 'recurring' ? !event.target.checked : event.target.checked })} />{label}</label>)}</div>}
      {mode === 'approved_exception' && <label className="block text-sm font-semibold text-ink">Immutable approved exception pack ID<input className="input mt-1.5" value={String(evidence.approvedExceptionPackId ?? '')} onChange={(event) => patchEvidence({ approvedExceptionPackId: event.target.value })} /></label>}
      <button type="button" className="btn-primary min-h-11 w-full sm:w-auto" disabled={busy || justification.trim().length < 10} onClick={() => void submit()}><Icon name="arrowRight" className="h-4 w-4" />Submit governed evidence</button>
    </section>}

    {pack && <>
      <section className="rounded-lg border border-line p-3"><h3 className="font-semibold text-ink">Independent decision path</h3><p className="mt-1 text-sm text-muted">Revision {pack.revision}. Each decision uses this exact revision and cannot be replayed after the record changes.</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><StatusCell label="Procurement" done={workspace.history.some((item) => item.stage === 'procurement')} /><StatusCell label="Finance" detail={mode === 'petty_cash' ? undefined : 'Not required'} done={workspace.history.some((item) => item.stage === 'finance')} /><StatusCell label="DOA" done={workspace.history.some((item) => item.stage === 'doa')} /></div></section>
      {(activeActions.canProcurementReview || activeActions.canFinanceReview || activeActions.canDoaReview) && <section className="space-y-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3"><h3 className="font-semibold text-ink">Your independent decision</h3><p className="text-sm text-muted">Your available stage is assigned by the live role and active DOA record. This control never appears as an approval for the submitter.</p><label className="block text-sm font-semibold text-ink">Decision note<textarea className="input mt-1.5" rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="flex flex-wrap gap-2">{(['procurement','finance','doa'] as const).filter((stage) => stage === 'procurement' ? activeActions.canProcurementReview : stage === 'finance' ? activeActions.canFinanceReview : activeActions.canDoaReview).map((stage) => <span key={stage} className="flex gap-2"><button type="button" className="btn-outline min-h-11" disabled={busy || !note.trim()} onClick={() => void review(stage,'rejected')}>Reject as {actorStageLabel(stage)}</button><button type="button" className="btn-primary min-h-11" disabled={busy || !note.trim()} onClick={() => void review(stage,'approved')}><Icon name="check" className="h-4 w-4" />Approve as {actorStageLabel(stage)}</button></span>)}</div></section>}
      <section className="rounded-lg border border-line p-3"><h3 className="font-semibold text-ink">Decision history</h3>{workspace.history.length === 0 ? <p className="mt-2 text-sm text-muted">No governed decision has been recorded.</p> : <ol className="mt-2 space-y-2 text-sm">{workspace.history.map((item,index) => <li key={`${item.stage}-${item.decidedAt ?? index}`} className="border-t border-line pt-2 first:border-0 first:pt-0"><span className="font-medium text-ink">{actorStageLabel(item.stage)}: {item.decision}</span>{item.decidedAt ? <span className="text-muted"> · {new Date(item.decidedAt).toLocaleString()}</span> : null}{item.note ? <span className="block text-muted">{item.note}</span> : null}</li>)}</ol>}</section>
    </>}
  </section>;
}

function StatusCell({ label, done, detail }: { label: string; done: boolean; detail?: string }) {
  return <div className="rounded-md border border-line bg-surface p-3 text-sm"><p className="font-semibold text-ink">{label}</p><p className="mt-1 text-muted">{detail ?? (done ? 'Decision recorded' : 'Pending independent decision')}</p></div>;
}
