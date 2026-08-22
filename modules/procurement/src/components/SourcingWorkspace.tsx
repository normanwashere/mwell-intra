'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Icon, money, useToast } from '@intra/ui';
import type { ProcurementVendor, SourcingMethod } from '../types';

interface RpcClient {
  schema(name: string): {
    rpc(name: string, args: { payload: Record<string, unknown> }): PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
}

interface SourcingResponse {
  id: string;
  vendorId: string;
  vendorName: string;
  invitedAt?: string;
  receivedAt?: string;
  deadlineCompliant?: boolean;
  proposalReference?: string;
  commercial?: { amount?: number };
  technical?: { score?: number };
  materialExceptions?: string[];
}

interface SourcingEvent {
  id: string;
  status: 'draft' | 'issued' | 'closed' | 'cancelled';
  submissionDeadline?: string;
  intendedResponses?: number;
  selectedVendorId?: string;
  closureNote?: string;
  responses: SourcingResponse[];
}

interface BidException {
  id: string;
  status: 'under_review' | 'approved' | 'rejected';
  justification: string;
  price_reasonableness?: string;
}

export function SourcingWorkspace({
  requestId,
  method,
  canManage,
  canApprove,
  client,
  vendors,
  onChanged,
}: {
  requestId: string;
  method: SourcingMethod;
  canManage: boolean;
  canApprove: boolean;
  client: RpcClient | null;
  vendors: ProcurementVendor[];
  onChanged?: () => Promise<void>;
}) {
  const { success, error } = useToast();
  const [event, setEvent] = useState<SourcingEvent | null>(null);
  const [bidException, setBidException] = useState<BidException | null>(null);
  const [loading, setLoading] = useState(Boolean(client));
  const [busy, setBusy] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [intendedResponses, setIntendedResponses] = useState(3);
  const [vendorId, setVendorId] = useState('');
  const [proposalReference, setProposalReference] = useState('');
  const [quotedAmount, setQuotedAmount] = useState(0);
  const [technicalScore, setTechnicalScore] = useState(0);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [awardRationale, setAwardRationale] = useState('');
  const [exceptionJustification, setExceptionJustification] = useState('');
  const [priceReasonableness, setPriceReasonableness] = useState('');
  const [exceptionReviewNote, setExceptionReviewNote] = useState('');

  const call = useCallback(async (name: string, payload: Record<string, unknown>) => {
    if (!client) throw new Error('The governed sourcing workspace requires the live database.');
    const { data, error: rpcError } = await client.schema('procurement').rpc(name, { payload });
    if (rpcError) throw new Error(rpcError.message);
    return data;
  }, [client]);

  const load = useCallback(async () => {
    if (!client) { setLoading(false); return; }
    setLoading(true);
    try {
      const [data, exception] = await Promise.all([
        call('sourcing_workspace', { request_id: requestId }) as Promise<{ event?: SourcingEvent | null }>,
        call('insufficient_bid_exception', { request_id: requestId }) as Promise<BidException | null>,
      ]);
      setEvent(data.event ?? null);
      setBidException(exception);
      if (data.event?.submissionDeadline) setDeadline(data.event.submissionDeadline.slice(0, 16));
      if (data.event?.intendedResponses) setIntendedResponses(data.event.intendedResponses);
      if (data.event?.selectedVendorId) setSelectedVendorId(data.event.selectedVendorId);
      if (data.event?.closureNote) setAwardRationale(data.event.closureNote);
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Could not load sourcing.');
    } finally { setLoading(false); }
  }, [call, client, error, requestId]);

  useEffect(() => { void load(); }, [load]);

  const received = useMemo(() => event?.responses.filter((item) => item.receivedAt) ?? [], [event]);
  const hasResponseShortfall = Boolean(event?.status === 'issued' && event.intendedResponses && received.length < event.intendedResponses);
  const invitedVendorIds = useMemo(() => new Set(event?.responses.map((item) => item.vendorId) ?? []), [event]);
  const availableVendors = vendors.filter((item) => !invitedVendorIds.has(item.id));

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await action();
      await load();
      await onChanged?.();
      success(message);
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Could not update sourcing.');
    } finally { setBusy(false); }
  }

  async function saveEvent() {
    await run(async () => {
      await call('save_sourcing_event', {
        request_id: requestId,
        submission_deadline: deadline ? new Date(deadline).toISOString() : null,
        intended_responses: intendedResponses,
      });
    }, event ? 'Sourcing plan updated' : 'Sourcing plan created');
  }

  async function inviteVendor() {
    if (!event || !vendorId) return;
    await run(async () => {
      await call('record_sourcing_response', {
        sourcing_event_id: event.id, vendor_id: vendorId,
      });
      setVendorId('');
    }, 'Vendor invitation recorded');
  }

  async function recordResponse() {
    if (!event || !vendorId) return;
    await run(async () => {
      await call('record_sourcing_response', {
        sourcing_event_id: event.id, vendor_id: vendorId,
        received_at: new Date().toISOString(), proposal_storage_path: proposalReference.trim(),
        commercial: { amount: quotedAmount }, technical: { score: technicalScore },
      });
      setVendorId(''); setProposalReference(''); setQuotedAmount(0); setTechnicalScore(0);
    }, 'Vendor response recorded');
  }

  async function submitException() {
    if (!event) return;
    await run(async () => {
      await call('submit_insufficient_bid_exception', {
        sourcing_event_id: event.id,
        justification: exceptionJustification.trim(),
        price_reasonableness: priceReasonableness.trim(),
      });
      setExceptionJustification(''); setPriceReasonableness('');
    }, 'Insufficient-bids exception submitted for independent review');
  }

  async function reviewException(decision: 'approved' | 'rejected') {
    if (!bidException) return;
    await run(async () => {
      await call('review_insufficient_bid_exception', {
        id: bidException.id, decision, note: exceptionReviewNote.trim(),
      });
      setExceptionReviewNote('');
    }, decision === 'approved' ? 'Sourcing exception approved' : 'Sourcing exception rejected');
  }

  if (loading) return <div className="h-32 animate-pulse rounded-lg bg-inset" aria-busy="true" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">{method.toUpperCase()} sourcing event</p>
          <p className="text-xs text-muted">Plan, invite, receive, evaluate, and preserve the award rationale in one record.</p>
        </div>
        <Badge tone={event?.status === 'closed' ? 'emerald' : event?.status === 'issued' ? 'cyan' : 'slate'}>
          {event?.status ?? 'Not started'}
        </Badge>
      </div>

      {!client && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-ink">Connect to the live database to operate governed sourcing.</p>}

      {canManage && (!event || event.status === 'draft') && (
        <section className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <label className="block text-sm font-semibold text-ink">Submission deadline<input type="datetime-local" className="input mt-1.5" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
          <label className="block text-sm font-semibold text-ink">Target responses<input type="number" min={1} className="input mt-1.5" value={intendedResponses} onChange={(e) => setIntendedResponses(Math.max(1, Number(e.target.value) || 1))} /></label>
          <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy || !deadline} onClick={() => void saveEvent()}><Icon name="check" className="h-4 w-4" />{event ? 'Save plan' : 'Create plan'}</button>
        </section>
      )}

      {event && (
        <section className="space-y-3 border-t border-line pt-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:flex sm:gap-8">
            <div><span className="block text-xs text-muted">Invited</span><strong className="text-ink">{event.responses.length}</strong></div>
            <div><span className="block text-xs text-muted">Received</span><strong className="text-ink">{received.length}</strong></div>
            <div><span className="block text-xs text-muted">Target</span><strong className="text-ink">{event.intendedResponses ?? 'Not set'}</strong></div>
            <div><span className="block text-xs text-muted">Deadline</span><strong className="text-ink">{event.submissionDeadline ? new Date(event.submissionDeadline).toLocaleString() : 'Not set'}</strong></div>
          </div>

          {event.responses.length > 0 && <div className="overflow-x-auto rounded-lg border border-line"><table className="min-w-full text-left text-sm"><thead className="bg-inset text-xs text-muted"><tr><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Quote</th><th className="px-3 py-2">Technical</th></tr></thead><tbody className="divide-y divide-line">{event.responses.map((response) => <tr key={response.id}><td className="px-3 py-3 font-medium text-ink">{response.vendorName}</td><td className="px-3 py-3"><Badge tone={response.receivedAt ? response.deadlineCompliant === false ? 'amber' : 'emerald' : 'slate'}>{response.receivedAt ? response.deadlineCompliant === false ? 'Late response' : 'Received' : 'Invited'}</Badge></td><td className="px-3 py-3 text-ink">{response.commercial?.amount ? money(response.commercial.amount) : 'Pending'}</td><td className="px-3 py-3 text-ink">{response.technical?.score ?? 'Pending'}</td></tr>)}</tbody></table></div>}

          {canManage && event.status === 'draft' && <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><select aria-label="Vendor to invite" className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Select vendor to invite</option>{availableVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.legalName}</option>)}</select><button type="button" className="btn-outline w-full sm:w-auto" disabled={busy || !vendorId} onClick={() => void inviteVendor()}><Icon name="plus" className="h-4 w-4" />Record invitation</button></div>}

          {canManage && event.status === 'draft' && <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy || event.responses.length === 0} onClick={() => void run(() => call('transition_sourcing_event', { id: event.id, action: 'issue' }).then(() => undefined), 'Sourcing event issued')}><Icon name="arrowRight" className="h-4 w-4" />Issue to invited vendors</button>}

          {canManage && event.status === 'issued' && <div className="grid gap-3 rounded-lg bg-inset p-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink">Vendor<select aria-label="Invited vendor" className="input mt-1.5" value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Select invited vendor</option>{event.responses.filter((response) => !response.receivedAt).map((response) => <option key={response.vendorId} value={response.vendorId}>{response.vendorName}</option>)}</select></label>
            <label className="block text-sm font-semibold text-ink">Proposal evidence reference<input className="input mt-1.5" value={proposalReference} onChange={(e) => setProposalReference(e.target.value)} /></label>
            <label className="block text-sm font-semibold text-ink">Quoted amount<input type="number" min={0} step="0.01" className="input mt-1.5" value={quotedAmount} onChange={(e) => setQuotedAmount(Math.max(0, Number(e.target.value) || 0))} /></label>
            <label className="block text-sm font-semibold text-ink">Technical score (0-100)<input type="number" min={0} max={100} className="input mt-1.5" value={technicalScore} onChange={(e) => setTechnicalScore(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></label>
            <button type="button" className="btn-primary w-full sm:col-span-2 sm:w-auto" disabled={busy || !vendorId || !proposalReference.trim() || quotedAmount <= 0} onClick={() => void recordResponse()}><Icon name="check" className="h-4 w-4" />Record response</button>
          </div>}

          {canManage && event.status === 'issued' && received.length > 0 && <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink">Recommended vendor<select aria-label="Recommended vendor" className="input mt-1.5" value={selectedVendorId} onChange={(e) => setSelectedVendorId(e.target.value)}><option value="">Select received response</option>{received.map((response) => <option key={response.vendorId} value={response.vendorId}>{response.vendorName}</option>)}</select></label>
            <label className="block text-sm font-semibold text-ink sm:col-span-2">Award rationale<textarea className="input mt-1.5" rows={3} value={awardRationale} onChange={(e) => setAwardRationale(e.target.value)} /></label>
            <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy || !selectedVendorId || !awardRationale.trim() || (hasResponseShortfall && bidException?.status !== 'approved')} onClick={() => void run(() => call('transition_sourcing_event', { id: event.id, action: 'close', selected_vendor_id: selectedVendorId, closure_note: awardRationale.trim() }).then(() => undefined), 'Sourcing event closed and vendor selected')}><Icon name="check" className="h-4 w-4" />Close and select vendor</button>
          </div>}

          {hasResponseShortfall && <section className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-ink">Response target not met</p><p className="text-xs text-muted">{received.length} of {event.intendedResponses} intended responses received. Closing requires an independently approved exception.</p></div>{bidException && <Badge tone={bidException.status === 'approved' ? 'emerald' : bidException.status === 'rejected' ? 'rose' : 'amber'}>{bidException.status.replace('_', ' ')}</Badge>}</div>
            {canManage && (!bidException || bidException.status === 'rejected') && <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold text-ink sm:col-span-2">Why sourcing should proceed<textarea className="input mt-1.5" rows={3} value={exceptionJustification} onChange={(e) => setExceptionJustification(e.target.value)} /></label><label className="block text-sm font-semibold text-ink sm:col-span-2">Price reasonableness evidence<textarea className="input mt-1.5" rows={2} value={priceReasonableness} onChange={(e) => setPriceReasonableness(e.target.value)} /></label><button type="button" className="btn-outline w-full sm:w-auto" disabled={busy || exceptionJustification.trim().length < 20 || priceReasonableness.trim().length < 10} onClick={() => void submitException()}><Icon name="arrowRight" className="h-4 w-4" />Submit exception</button></div>}
            {canApprove && bidException?.status === 'under_review' && <div className="space-y-3 border-t border-amber-500/20 pt-3"><p className="text-sm text-ink">{bidException.justification}</p><label className="block text-sm font-semibold text-ink">Independent review note<textarea className="input mt-1.5" rows={2} value={exceptionReviewNote} onChange={(e) => setExceptionReviewNote(e.target.value)} /></label><div className="grid gap-2 sm:flex"><button type="button" className="btn-outline" disabled={busy || !exceptionReviewNote.trim()} onClick={() => void reviewException('rejected')}>Reject exception</button><button type="button" className="btn-primary" disabled={busy || !exceptionReviewNote.trim()} onClick={() => void reviewException('approved')}><Icon name="check" className="h-4 w-4" />Approve exception</button></div></div>}
          </section>}
        </section>
      )}
    </div>
  );
}
