'use client';

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge,
  Card,
  EmptyState,
  HeroChipButton,
  Icon,
  ModuleHero,
  SectionTitle,
  Sheet,
  SignaturePad,
  StatCard,
  useToast,
  type SignaturePayload,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type { ApproverTier, ProcurementRequest } from '../types';
import { useProcurementRequests } from '../localStore';
import { nextPendingStep, tierLabel } from '../policy';

// ---------------------------------------------------------------------------
// Tier resolution
// ---------------------------------------------------------------------------
// Demo profiles carry procurement / warehouse / legal roles. We map each role
// combination onto the approval tier(s) the profile can act on. This keeps
// the RBAC package untouched (see task guardrails) while letting the inbox
// filter by tier.
//
// TODO(rbac): once DOA integration lands, replace this heuristic with a
// direct lookup of `core.role_capabilities` (or a new `procurement.approver_
// tier_assignments` table) so tiers are data-driven per user.

interface UserRolesShape {
  procurement?: readonly string[];
  legal?: readonly string[];
  core?: readonly string[];
  warehouse?: readonly string[];
}

function resolveTiers(userRoles: UserRolesShape | null | undefined): ApproverTier[] {
  if (!userRoles) return [];
  const tiers = new Set<ApproverTier>();
  const proc = userRoles.procurement ?? [];
  const legal = userRoles.legal ?? [];
  const core = userRoles.core ?? [];
  const warehouse = userRoles.warehouse ?? [];

  // procurement:approver acts as the Department Head / BU SPOC tier — the
  // first sign-off on the ladder (policy §3).
  if (proc.includes('approver')) {
    tiers.add('dept_head');
  }
  // procurement:procurement_officer → Procurement Head sourcing/AR review.
  if (proc.includes('procurement_officer')) {
    tiers.add('procurement_head');
  }
  // procurement:admin doubles as CFO / BU head / DOA final approver in the
  // demo. Also covers procurement_head so a solo admin can walk the ladder.
  if (proc.includes('admin')) {
    tiers.add('procurement_head');
    tiers.add('final_approver');
  }
  // Finance seat — dedicated procurement:finance is preferred; warehouse:
  // finance is the legacy fallback for demos that predate procurement roles.
  if (proc.includes('finance') || warehouse.includes('finance')) {
    tiers.add('finance');
  }
  // Legal reviewers pick up the contract-review tier.
  if (legal.includes('legal_reviewer')) {
    tiers.add('legal');
  }
  // Platform admins act as system-of-last-resort across every tier.
  if (core.includes('platform_admin')) {
    (['dept_head', 'procurement_head', 'finance', 'legal', 'final_approver'] as ApproverTier[])
      .forEach((t) => tiers.add(t));
  }

  return Array.from(tiers);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  const navigate = useNavigate();

  const myTiers = useMemo(() => resolveTiers(userRoles as UserRolesShape), [userRoles]);

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
    if (decision === 'approved' && !signature) {
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
      signature: signature ?? undefined,
    });
    if (ok) {
      const nowStep = nextPendingStep(ok.approvalSteps);
      if (decision === 'approved' && nowStep) {
        success(`Approved — forwarded to ${tierLabel(nowStep.tier)}.`);
      } else {
        success(`Request ${decision}`);
      }
      closeSheet();
    } else {
      error('Could not save the decision.');
    }
  }

  return (
    <Guard module="procurement" cap="approve_request">
      <div className="space-y-6">
        <ModuleHero
          eyebrow={
            myTiers.length > 0
              ? `${myTiers.map(tierLabel).join(' · ')},`
              : 'Approver,'
          }
          title="Approval inbox"
          description="Only requests waiting on your tier appear here. Approving forwards to the next tier; rejecting sends the request back to the requester."
          icon="clipboard"
          action={
            <HeroChipButton href="/procurement" icon="arrowRight">
              Back to requests
            </HeroChipButton>
          }
          accessory={
            <>
              <div>
                <p className="text-xs uppercase tracking-wide text-brand-100/70">Waiting on you</p>
                <p className="tnum text-2xl font-extrabold">{pending.length}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-brand-100/70">In flight elsewhere</p>
                <p className="tnum text-2xl font-extrabold">{waitingElsewhere.length}</p>
              </div>
            </>
          }
        />

        <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Pending (you)"
            value={pending.length}
            icon="rotate"
            tone="cyan"
            hint="Scroll to the list below"
            onClick={() => {
              document
                .getElementById('inbox-pending')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />
          <StatCard
            label="Total value"
            value={`₱${pending
              .reduce((s, r) => s + (r.estimatedAmount ?? 0), 0)
              .toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            icon="coins"
            tone="brand"
            hint="Sum of pending requests"
          />
          <StatCard
            label="Approved"
            value={rows.filter((r) => r.status === 'approved').length}
            icon="check"
            tone="emerald"
            hint="Cleared for PO"
            onClick={() => navigate('/?filter=approved')}
          />
          <StatCard
            label="Rejected"
            value={rows.filter((r) => r.status === 'rejected').length}
            icon="x"
            tone="rose"
            hint="Sent back to requester"
            onClick={() => navigate('/?filter=rejected')}
          />
        </div>

        <div id="inbox-pending">
          <SectionTitle
            title="Waiting on you"
            subtitle="Requests whose next-step tier matches your role."
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
                return (
                  <li key={r.id}>
                    <Card>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link to={`/requests/${r.id}`} className="font-semibold text-ink hover:underline">
                            {r.title}
                          </Link>
                          <p className="text-xs text-muted">
                            Waiting on {step ? tierLabel(step.tier) : 'unknown tier'} · {r.department ?? '—'}
                          </p>
                        </div>
                        <Badge tone="amber">step {step?.order ?? '?'}</Badge>
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
            <SectionTitle title="Recently decided" subtitle="Last few approvals and rejections across all tiers." />
            <ul className="space-y-2">
              {decidedRecent.map((r) => (
                <li key={r.id}>
                  <Card>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={`/requests/${r.id}`} className="font-semibold text-ink hover:underline">
                          {r.title}
                        </Link>
                        <p className="text-xs text-muted">
                          {new Date(r.decidedAt ?? r.createdAt).toLocaleString()}
                          {r.decisionNote ? ` — ${r.decisionNote}` : ''}
                        </p>
                      </div>
                      <Badge tone={r.status === 'approved' ? 'emerald' : 'rose'}>{r.status}</Badge>
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
          title={
            decision === 'approved'
              ? `Sign & approve — ${active?.title ?? ''}`
              : `Reject — ${active?.title ?? ''}`
          }
        >
          <div className="space-y-4 p-1">
            <p className="text-sm text-muted">
              {decision === 'approved'
                ? active && nextPendingStep(active.approvalSteps)
                  ? `Signing here approves as ${tierLabel(nextPendingStep(active.approvalSteps)!.tier)} and forwards the request to the next tier.`
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
                </div>
                <SignaturePad
                  defaultSignerName={profile?.name ?? ''}
                  onChange={setSignature}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeSheet} className="btn-ghost">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDecision}
                disabled={decision === 'approved' && !signature}
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
          </div>
        </Sheet>
      </div>
    </Guard>
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
            {req.neededBy ? ` · needed ${new Date(req.neededBy).toLocaleDateString()}` : ''}
          </p>
          {req.vendorName && (
            <p className="mt-0.5 text-xs text-muted">
              Preferred vendor: <span className="font-medium">{req.vendorName}</span>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="cyan">{req.status}</Badge>
            {step && <Badge tone="amber">step {step.order} · {tierLabel(step.tier)}</Badge>}
            <span className="text-xs text-muted">
              {req.lines.length} line{req.lines.length === 1 ? '' : 's'}
            </span>
            <span className="tnum text-sm font-semibold text-ink">
              ₱{(req.estimatedAmount ?? 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link to={`/requests/${req.id}`} className="btn-ghost btn-sm">
            <Icon name="search" className="h-4 w-4" />
            Review
          </Link>
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
