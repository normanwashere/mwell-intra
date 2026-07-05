'use client';

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Card,
  EmptyState,
  HeroChipButton,
  Icon,
  InfoTip,
  ModuleHero,
  SectionTitle,
  Sheet,
  SignaturePad,
  money,
  useToast,
  type SignaturePayload,
} from '@intra/ui';
import { Guard, useCan, useSession } from '@intra/auth';
import type { ProcurementRequest } from '../types';
import { useProcurementRequests } from '../localStore';
import { nextPendingStep, sourcingMethodLabel, tierLabel } from '../policy';
import { resolveTiers, type UserRolesShape } from '../tiers';
import { formatDate, formatDateTime, statusLabel } from '../labels';
import { makeTypedSignature } from '../signature';

export function ApprovalInboxPage() {
  const { rows, decide, loading } = useProcurementRequests();
  const { profile, userRoles } = useSession();
  const { success, error } = useToast();
  const [active, setActive] = useState<ProcurementRequest | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  const [note, setNote] = useState('');
  // Captured signature — REQUIRED for approvals (§9 sign-off), optional for
  // rejections (a rejection is a gate, not a binding sign-off).
  const [signature, setSignature] = useState<SignaturePayload | null>(null);

  const myTiers = useMemo(
    () => resolveTiers(userRoles as UserRolesShape),
    [userRoles],
  );
  // PR-11: tier-eligible users (e.g. legal:legal_reviewer on the Legal step)
  // hold no procurement.approve_request cap, so the bare <Guard> bounced
  // them. Admit anyone with the cap OR ≥1 resolved tier.
  const canApproveCap = useCan('procurement', 'approve_request');
  const allowed = canApproveCap || myTiers.length > 0;

  // PR-15/J2-4: a prefilled signer name arms the confirm button without
  // retyping. The frozen SignaturePad only commits typed signatures on an
  // input event, so the sheet seeds its own typed payload from the profile
  // name; any pad interaction replaces it.
  const seededSignature = useMemo(
    () =>
      active && decision === 'approved'
        ? makeTypedSignature(profile?.name)
        : null,
    [active, decision, profile?.name],
  );
  const effectiveSignature = signature ?? seededSignature;

  // Only surface rows whose *next* pending tier matches something the
  // signed-in user is entitled to act on.
  const pending = useMemo(() => {
    return rows.filter((r) => {
      if (r.status !== 'submitted' && r.status !== 'under_review') return false;
      // Legacy rows without a ladder → fall back to the "anyone with approve
      // cap can decide" behaviour of the old inbox. This keeps existing
      // localStorage drafts actionable during the rollout.
      const step = nextPendingStep(r.approvalSteps);
      if (!step) return myTiers.length > 0;
      return myTiers.includes(step.tier);
    });
  }, [rows, myTiers]);

  const pendingValue = useMemo(
    () => pending.reduce((s, r) => s + (r.estimatedAmount ?? 0), 0),
    [pending],
  );

  const waitingElsewhere = useMemo(
    () =>
      rows.filter((r) => {
        if (r.status !== 'submitted' && r.status !== 'under_review') return false;
        const step = nextPendingStep(r.approvalSteps);
        if (!step) return false;
        return !myTiers.includes(step.tier);
      }),
    [rows, myTiers],
  );

  const decidedRecent = useMemo(
    () =>
      rows
        .filter((r) => r.status === 'approved' || r.status === 'rejected')
        .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
        .slice(0, 8),
    [rows],
  );

  if (!allowed) {
    // No cap and no tier → the Guard renders the branded access-denied block.
    return (
      <Guard module="procurement" cap="approve_request">
        {null}
      </Guard>
    );
  }

  function openDecision(req: ProcurementRequest, d: 'approved' | 'rejected') {
    setActive(req);
    setDecision(d);
    setNote('');
    setSignature(null);
  }

  function closeSheet() {
    setActive(null);
    setDecision(null);
    setNote('');
    setSignature(null);
  }

  function submitDecision() {
    if (!active || !decision) return;
    // Prefer a pad-committed signature; fall back to a freshly-timestamped
    // typed signature from the prefilled name (the seed that armed the CTA).
    const sig =
      decision === 'approved'
        ? (signature ?? makeTypedSignature(profile?.name))
        : (signature ?? undefined);
    if (decision === 'approved' && !sig) {
      error('An electronic signature is required to approve.');
      return;
    }
    const step = nextPendingStep(active.approvalSteps);
    const tier = step?.tier ?? myTiers[0];
    if (!tier) {
      error('This request has no pending tier for you to decide on.');
      return;
    }
    if (step && !myTiers.includes(step.tier)) {
      error(`This step is waiting on ${tierLabel(step.tier)} — not your tier.`);
      return;
    }
    const ok = decide(active.id, decision, {
      email: profile?.email,
      note,
      tier,
      signature: sig ?? undefined,
    });
    if (ok) {
      const nowStep = nextPendingStep(ok.approvalSteps);
      if (decision === 'approved' && nowStep) {
        success(`Approved — forwarded to ${tierLabel(nowStep.tier)}.`);
      } else {
        success(decision === 'approved' ? 'Request approved' : 'Request rejected');
      }
      closeSheet();
    } else {
      error('Could not save the decision.');
    }
  }

  const activeStep = active ? nextPendingStep(active.approvalSteps) : undefined;
  const isSelfApproval = Boolean(
    active && profile?.email && active.requesterEmail === profile.email,
  );

  return (
    <div className="space-y-6">
      {/* One KPI surface (PR-13): the hero carries the only counts. */}
      <ModuleHero
        eyebrow={
          myTiers.length > 0
            ? `${myTiers.map(tierLabel).join(' · ')},`
            : 'Approver,'
        }
        title="Approval inbox"
        description="Decide the requests waiting on your tier."
        icon="clipboard"
        action={
          <HeroChipButton href="/procurement" icon="arrowRight">
            Back to requests
          </HeroChipButton>
        }
        accessory={
          <div>
            <p className="text-xs uppercase tracking-wide text-brand-100/70">
              Waiting on you
            </p>
            <p className="tnum text-2xl font-extrabold">{pending.length}</p>
            {pending.length > 0 && (
              <p className="tnum text-xs text-brand-100/70">
                {money(pendingValue)} pending value
              </p>
            )}
          </div>
        }
      />

      <div id="inbox-pending">
        <SectionTitle
          title="Waiting on you"
          subtitle="Requests whose next-step tier matches your role."
          action={
            <InfoTip
              label="How the approval inbox works"
              content="Only requests waiting on your tier appear here. Approving forwards the request to the next tier; rejecting sends it back to the requester."
            />
          }
        />
        {loading ? (
          <div className="h-32 animate-pulse rounded-2xl bg-inset" aria-hidden />
        ) : pending.length === 0 ? (
          <EmptyState
            icon="check"
            title="Inbox zero"
            message="No requests are waiting on your tier right now — new submissions land here automatically."
          />
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <li key={r.id}>
                <PendingCard req={r} onDecide={openDecision} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {waitingElsewhere.length > 0 && (
        <div>
          <SectionTitle
            title="In flight (other tiers)"
            subtitle="Awaiting a different approver — view-only from here."
          />
          <ul className="space-y-2">
            {waitingElsewhere.map((r) => {
              const step = nextPendingStep(r.approvalSteps);
              const total = r.approvalSteps?.length ?? 0;
              return (
                <li key={r.id}>
                  <Card>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to={`/requests/${r.id}`}
                          className="text-sm font-semibold text-ink hover:underline"
                        >
                          {r.title}
                        </Link>
                        <p className="text-xs text-muted">
                          {r.department ?? '—'}
                          {r.estimatedAmount != null
                            ? ` · ${money(r.estimatedAmount)}`
                            : ''}
                          {step && total > 0
                            ? ` · step ${step.order} of ${total}`
                            : ''}
                        </p>
                      </div>
                      <Badge tone="amber">
                        Waiting on {step ? tierLabel(step.tier) : 'next tier'}
                      </Badge>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {decidedRecent.length > 0 && (
        <div>
          <SectionTitle
            title="Recently decided"
            subtitle="Last few approvals and rejections across all tiers."
          />
          <ul className="space-y-2">
            {decidedRecent.map((r) => (
              <li key={r.id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/requests/${r.id}`}
                        className="text-sm font-semibold text-ink hover:underline"
                      >
                        {r.title}
                      </Link>
                      <p className="text-xs text-muted">
                        {formatDateTime(r.decidedAt ?? r.createdAt)}
                        {r.decisionNote ? ` — ${r.decisionNote}` : ''}
                      </p>
                    </div>
                    <Badge tone={r.status === 'approved' ? 'emerald' : 'rose'}>
                      {statusLabel(r.status)}
                    </Badge>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Sheet
        open={Boolean(active && decision)}
        onOpenChange={(v) => {
          if (!v) closeSheet();
        }}
        title={decision === 'approved' ? 'Sign & approve' : 'Reject request'}
        description={active?.title}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeSheet} className="btn-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitDecision}
              disabled={decision === 'approved' && !effectiveSignature}
              className={
                decision === 'approved'
                  ? 'btn-primary disabled:cursor-not-allowed disabled:opacity-60'
                  : 'btn-outline text-rose-700 dark:text-rose-300'
              }
            >
              {decision === 'approved' ? (
                <>
                  <Icon name="signature" className="h-4 w-4" />
                  Sign & approve
                </>
              ) : (
                'Confirm reject'
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-4 p-1">
          {/* PR-12 / Exec #5: the decision context lives IN the sheet — the
              approver never signs sight-unseen. */}
          {active && (
            <DecisionSummary
              req={active}
              stepOrder={activeStep?.order}
              stepTotal={active.approvalSteps?.length ?? 0}
              stepTier={activeStep ? tierLabel(activeStep.tier) : undefined}
              onNavigate={closeSheet}
            />
          )}

          {isSelfApproval && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <span className="font-semibold">You raised this request.</span>{' '}
                Deciding on your own request is flagged on the audit trail.
              </p>
            </div>
          )}

          <p className="text-sm text-muted">
            {decision === 'approved'
              ? activeStep
                ? `Signing here approves as ${tierLabel(activeStep.tier)} and forwards the request to the next tier.`
                : 'Signing here approves the request and unlocks PO authoring against the preferred vendor.'
              : 'Rejecting sends the request back to the requester with your note.'}
          </p>
          <div className="space-y-1">
            <label
              htmlFor="approval-note"
              className="text-xs font-semibold uppercase tracking-wide text-faint"
            >
              Note {decision === 'rejected' ? '(recommended)' : '(optional)'}
            </label>
            <textarea
              id="approval-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="input"
              placeholder="Short reason or context…"
            />
          </div>
          {decision === 'approved' && (
            <div className="space-y-2 rounded-2xl border border-line bg-inset/60 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
                <Icon name="signature" className="h-4 w-4" />
                Electronic signature (required)
                <InfoTip
                  label="About electronic signatures"
                  content="By signing you agree this is your electronic signature and it will be logged on the approval audit trail (RA 8792, DocuSign-equivalent intent)."
                />
              </div>
              <SignaturePad
                defaultSignerName={profile?.name ?? ''}
                onChange={setSignature}
                consentLabel="Your e-signature is logged on the approval audit trail (RA 8792)."
              />
              {!signature && seededSignature && (
                <p className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-800 dark:text-emerald-300">
                  <Icon name="check" className="mr-1 inline h-3.5 w-3.5" />
                  Ready to sign as{' '}
                  <span className="font-semibold">
                    {seededSignature.signerName}
                  </span>{' '}
                  (typed signature) — or draw / re-type to replace it.
                </p>
              )}
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}

/** Compact decision context rendered at the top of the sign-&-approve sheet. */
function DecisionSummary({
  req,
  stepOrder,
  stepTotal,
  stepTier,
  onNavigate,
}: {
  req: ProcurementRequest;
  stepOrder?: number;
  stepTotal: number;
  stepTier?: string;
  onNavigate: () => void;
}) {
  const shownLines = req.lines.slice(0, 3);
  const moreLines = req.lines.length - shownLines.length;
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{req.title}</p>
          <p className="text-xs text-muted">
            {req.requesterName ?? req.requesterEmail ?? 'Requester'}
            {req.department ? ` · ${req.department}` : ''}
          </p>
        </div>
        <p className="tnum shrink-0 font-display text-xl font-extrabold text-ink">
          {money(req.estimatedAmount ?? 0)}
        </p>
      </div>

      {shownLines.length > 0 && (
        <ul className="space-y-1 border-t border-line pt-2 text-xs text-muted">
          {shownLines.map((l) => (
            <li key={l.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{l.description}</span>
              <span className="tnum shrink-0">
                {l.quantity} {l.uom ?? 'ea'}
                {l.unitPrice != null ? ` · ${money(l.unitPrice * l.quantity)}` : ''}
              </span>
            </li>
          ))}
          {moreLines > 0 && (
            <li className="text-faint">
              + {moreLines} more line{moreLines === 1 ? '' : 's'}
            </li>
          )}
        </ul>
      )}

      {req.justification?.need && (
        <p className="border-t border-line pt-2 text-xs text-muted">
          <span className="font-semibold uppercase tracking-wide text-faint">
            Need:{' '}
          </span>
          <span className="line-clamp-2">{req.justification.need}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs">
        <span className="text-muted">
          {req.sourcingMethod ? sourcingMethodLabel(req.sourcingMethod) : 'Sourcing TBD'}
          {stepOrder && stepTotal > 0 && stepTier
            ? ` · Step ${stepOrder} of ${stepTotal} — ${stepTier}`
            : ''}
        </span>
        <Link
          to={`/requests/${req.id}`}
          onClick={onNavigate}
          className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
        >
          Open full request
        </Link>
      </div>
    </div>
  );
}

function PendingCard({
  req,
  onDecide,
}: {
  req: ProcurementRequest;
  onDecide: (r: ProcurementRequest, d: 'approved' | 'rejected') => void;
}) {
  const step = nextPendingStep(req.approvalSteps);
  const total = req.approvalSteps?.length ?? 0;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/requests/${req.id}`}
            className="font-display text-base font-bold text-ink hover:underline"
          >
            {req.title}
          </Link>
          <p className="mt-0.5 text-xs text-muted">
            {req.requesterName ?? req.requesterEmail ?? 'Requester'}
            {req.department ? ` · ${req.department}` : ''}
            {req.costCenter ? ` · ${req.costCenter}` : ''}
            {req.neededBy ? ` · needed ${formatDate(req.neededBy)}` : ''}
          </p>
          {req.vendorName && (
            <p className="mt-0.5 text-xs text-muted">
              Preferred vendor: <span className="font-medium">{req.vendorName}</span>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="cyan">{statusLabel(req.status)}</Badge>
            {step && (
              <Badge tone="amber">
                Step {step.order}
                {total > 0 ? ` of ${total}` : ''} · {tierLabel(step.tier)}
              </Badge>
            )}
            <span className="text-xs text-muted">
              {req.lines.length} line{req.lines.length === 1 ? '' : 's'}
            </span>
            <span className="tnum text-sm font-semibold text-ink">
              {money(req.estimatedAmount ?? 0)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onDecide(req, 'rejected')}
            className="btn-outline btn-sm"
          >
            <Icon name="x" className="h-4 w-4" />
            Reject
          </button>
          <button
            type="button"
            onClick={() => onDecide(req, 'approved')}
            className="btn-primary btn-sm"
          >
            <Icon name="check" className="h-4 w-4" />
            Approve
          </button>
        </div>
      </div>
    </Card>
  );
}
