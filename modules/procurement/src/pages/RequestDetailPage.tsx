'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  Badge,
  Card,
  DataTable,
  HeroChipButton,
  HeroStat,
  Icon,
  InfoTip,
  ModuleHero,
  SectionTitle,
  money,
  useToast,
  type Column,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type {
  ApprovalStep,
  ProcurementRequestLine,
  RequestAttachment,
  RequestStatus,
} from '../types';
import {
  useApprovalHistory,
  useProcurementRequests,
  usePurchaseOrders,
} from '../localStore';
import {
  categoryMeta,
  evaluateSubmitReadiness,
  requiredDocumentsStatus,
  sourcingMethodLabel,
  tierLabel,
  type SubmitReadiness,
} from '../policy';
import {
  attachmentKindLabel,
  formatDate,
  formatDateTime,
  statusLabel,
  stepStatusLabel,
} from '../labels';
import {
  createGovernedAttachmentUrl,
  type GovernedAccessClient,
} from '../attachments';

/** Compose a blocking message from an unmet submit-readiness result. */
function readinessMessage(r: SubmitReadiness): string {
  const parts: string[] = [];
  if (r.missingDocs.length > 0) {
    parts.push(`attach ${r.missingDocs.join(', ')}`);
  }
  return `Can't submit yet — ${parts.join('; ')}.`;
}

// Status tones for badges on the porcelain hero surface.
const STATUS_TONE: Record<RequestStatus, 'slate' | 'cyan' | 'amber' | 'emerald' | 'rose'> = {
  draft: 'slate',
  submitted: 'cyan',
  under_review: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  cancelled: 'slate',
};

const DIRECT_AWARD_REASON_LABEL: Record<string, string> = {
  sole_supplier: 'Sole supplier',
  emergency: 'Emergency',
  repeat_continuity: 'Repeat / continuity',
  other: 'Other approved exception',
};

const lineColumns: Column<ProcurementRequestLine>[] = [
  { key: 'description', header: 'Description', render: (r) => r.description },
  { key: 'quantity', header: 'Qty', render: (r) => `${r.quantity} ${r.uom ?? 'ea'}` },
  {
    key: 'unitPrice',
    header: 'Unit price',
    render: (r) => (r.unitPrice != null ? money(r.unitPrice) : '—'),
  },
  {
    key: 'lineTotal',
    header: 'Line total',
    render: (r) => (r.unitPrice != null ? money(r.unitPrice * r.quantity) : '—'),
  },
];

interface ActivityEvent {
  key: string;
  at: string;
  icon: 'pin' | 'rotate' | 'check' | 'x' | 'cart' | 'box';
  tone: 'slate' | 'cyan' | 'emerald' | 'rose' | 'brand';
  label: string;
}

export function RequestDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { rows, submit, cancel, loading } = useProcurementRequests();
  const { rows: pos, add: addPO } = usePurchaseOrders();
  const history = useApprovalHistory(id);
  const { success, error } = useToast();
  const { profile } = useSession();

  const req = useMemo(() => rows.find((r) => r.id === id), [rows, id]);

  useEffect(() => {
    if (!req) return;
    if (searchParams.get('submit') === '1' && req.status === 'draft') {
      void (async () => {
        const readiness = evaluateSubmitReadiness(req);
        if (!readiness.ok) {
          error(readinessMessage(readiness));
        } else {
          const ok = await submit(req.id);
          if (ok) success('Request submitted for approval');
        }
      })();
      searchParams.delete('submit');
      setSearchParams(searchParams, { replace: true });
    }
  }, [req?.id, req?.status]);

  const linkedPo = useMemo(
    () => pos.find((p) => p.requestId === id),
    [pos, id],
  );

  // Single chronological order, newest first (PR-22) — creation, submission,
  // ladder decisions, and PO lifecycle/receipt events interleaved (J2-6).
  const activity = useMemo<ActivityEvent[]>(() => {
    if (!req) return [];
    const events: ActivityEvent[] = [
      {
        key: 'created',
        at: req.createdAt,
        icon: 'pin',
        tone: 'slate',
        label: `Draft created by ${req.requesterName ?? req.requesterEmail ?? 'requester'}`,
      },
    ];
    if (req.submittedAt) {
      events.push({
        key: 'submitted',
        at: req.submittedAt,
        icon: 'rotate',
        tone: 'cyan',
        label: 'Submitted for approval',
      });
    }
    for (const h of history) {
      events.push({
        key: `decision-${h.decidedAt}-${h.stepId ?? ''}`,
        at: h.decidedAt,
        icon: h.decision === 'approved' ? 'check' : 'x',
        tone: h.decision === 'approved' ? 'emerald' : 'rose',
        label: `${h.decision === 'approved' ? 'Approved' : 'Rejected'}${
          h.tier ? ` by ${tierLabel(h.tier)}` : ''
        }${h.decidedByEmail ? ` (${h.decidedByEmail})` : ''}${h.note ? ` — ${h.note}` : ''}`,
      });
    }
    if (linkedPo) {
      events.push({
        key: 'po-drafted',
        at: linkedPo.createdAt,
        icon: 'cart',
        tone: 'brand',
        label: `Purchase order ${linkedPo.poNumber} drafted`,
      });
      if (linkedPo.approvedAt) {
        events.push({
          key: 'po-approved',
          at: linkedPo.approvedAt,
          icon: 'check',
          tone: 'emerald',
          label: `PO ${linkedPo.poNumber} award approved${
            linkedPo.approvedByEmail ? ` (${linkedPo.approvedByEmail})` : ''
          }`,
        });
      }
      for (const rcpt of linkedPo.receipts ?? []) {
        const units = rcpt.lines.reduce((s, l) => s + l.quantity, 0);
        events.push({
          key: `receipt-${rcpt.id}`,
          at: rcpt.receivedAt,
          icon: 'box',
          tone: 'emerald',
          label: `${rcpt.closedPo ? 'Final receipt' : 'Partial receipt'} on PO ${linkedPo.poNumber} — ${units} unit${units === 1 ? '' : 's'}${
            rcpt.receivedByEmail ? ` (${rcpt.receivedByEmail})` : ''
          }`,
        });
      }
    }
    return events.sort((a, b) => b.at.localeCompare(a.at));
  }, [req, history, linkedPo]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-40 animate-pulse rounded-3xl bg-inset" />
        <div className="h-32 animate-pulse rounded-2xl bg-inset" />
      </div>
    );
  }
  if (!req) return <Navigate to="/" replace />;

  const isRequester = profile?.email && req.requesterEmail === profile.email;
  const cat = categoryMeta(req.category);

  async function handleSubmit() {
    if (!req) return;
    const readiness = evaluateSubmitReadiness(req);
    if (!readiness.ok) {
      error(readinessMessage(readiness));
      return;
    }
    const ok = await submit(req.id);
    if (ok) success('Request submitted for approval');
    else error('Could not submit — try again.');
  }
  async function handleCancel() {
    if (!req) return;
    const ok = await cancel(req.id);
    if (ok) success('Request cancelled');
  }
  async function handleAuthorPO() {
    if (!req || !req.vendorId || !req.vendorName) {
      error('Assign a vendor to this request before authoring a PO.');
      return;
    }
    const po = await addPO({
      requestId: req.id,
      vendorId: req.vendorId,
      vendorName: req.vendorName,
      actorEmail: profile?.email,
      lines: req.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        uom: l.uom,
        unitPrice: l.unitPrice,
      })),
    });
    success(`PO ${po.poNumber} drafted`);
    navigate(`/purchase-orders/${po.id}`);
  }

  // PR-19: checklist joined against real attachments.
  const reqDocs = req.sourcingMethod
    ? requiredDocumentsStatus(
        {
          category: req.category,
          amount: req.estimatedAmount,
          sourcingMethod: req.sourcingMethod,
        },
        req.attachments,
      )
    : [];
  const missingDocs = reqDocs.filter((d) => !d.attached);
  // PR-20: the 10-tile meta grid collapses to one muted line; the full
  // record lives behind the (i).
  const metaLine = [
    req.requesterName ?? req.requesterEmail,
    cat?.label,
    req.sourcingMethod ? sourcingMethodLabel(req.sourcingMethod) : undefined,
    req.vendorName ?? 'Open to bids',
    req.neededBy ? `needed ${formatDate(req.neededBy)}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModuleHero
        eyebrow={
          req.department || req.costCenter
            ? [req.department, req.costCenter].filter(Boolean).join(' \u00b7 ')
            : 'Purchase request'
        }
        title={req.title}
        description={req.description || undefined}
        icon="cart"
        action={
          <HeroChipButton href="/procurement" icon="arrowRight">
            Back to list
          </HeroChipButton>
        }
        accessory={
          <div className="flex flex-wrap items-end gap-3">
            <HeroStat label="Status">
              <Badge tone={STATUS_TONE[req.status]}>{statusLabel(req.status)}</Badge>
            </HeroStat>
            <HeroStat label="Estimated total" align="right">
              <p className="tnum font-display text-2xl font-extrabold text-ink">
                {req.estimatedAmount != null ? money(req.estimatedAmount) : '—'}
              </p>
            </HeroStat>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span>{metaLine}</span>
        <InfoTip
          label="Full request record"
          content={
            <span className="block space-y-0.5">
              <span className="block">Requester: {req.requesterName ?? '—'}{req.requesterEmail ? ` <${req.requesterEmail}>` : ''}</span>
              <span className="block">Category: {cat?.label ?? '—'}</span>
              <span className="block">Sourcing: {req.sourcingMethod ? sourcingMethodLabel(req.sourcingMethod) : '—'}{req.sourcingOverride ? ' (override)' : ''}</span>
              <span className="block">Vendor: {req.vendorName ?? 'Open to bids'}</span>
              <span className="block">Cost center: {req.costCenter ?? '—'}</span>
              <span className="block">Project code: {req.projectCode ?? '—'}</span>
              <span className="block">Budget / GL: {req.budgetCode ?? '—'}</span>
              <span className="block">Needed by: {req.neededBy ? formatDate(req.neededBy) : '—'}</span>
              <span className="block">Created: {formatDateTime(req.createdAt)}</span>
            </span>
          }
        />
      </div>

      {req.justification && (
        <div>
          <SectionTitle
            title="Business justification"
            action={
              <InfoTip
                label="Why this section exists"
                content="Policy §9 — the Award Recommendation is assembled from these fields. Approvers read “need” and “risk if not procured” first."
              />
            }
          />
          <Card>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-faint">Need</dt>
                <dd className="mt-0.5 whitespace-pre-line text-ink">{req.justification.need || '—'}</dd>
              </div>
              {req.justification.alternatives && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-faint">Alternatives considered</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-ink">{req.justification.alternatives}</dd>
                </div>
              )}
              {req.justification.risk && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-faint">Risk if not procured</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-ink">{req.justification.risk}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      )}

      {(req.approvalSteps?.length ?? 0) > 0 && (
        <div>
          <SectionTitle
            title="Approval ladder"
            action={
              <span className="hidden sm:inline-flex">
                <InfoTip
                  label="How the ladder was derived"
                  content="Multi-tier routing derived from category + amount + sourcing method (policy §3, §9). Each tier signs electronically."
                />
              </span>
            }
          />
          <Card>
            <ol className="space-y-3">
              {(req.approvalSteps ?? []).map((s) => (
                <ApprovalStepRow key={s.id} step={s} />
              ))}
            </ol>
          </Card>
        </div>
      )}

      <div>
        <SectionTitle title="Line items" subtitle={`${req.lines.length} line${req.lines.length === 1 ? '' : 's'}`} />
        <DataTable rows={req.lines} columns={lineColumns} keyOf={(r) => r.id} />
      </div>

      {(req.attachments?.length ?? 0) > 0 && (
        <div>
          <SectionTitle
            title="Attachments"
            subtitle={`${req.attachments!.length} file${req.attachments!.length === 1 ? '' : 's'} — evidence for spec / budget / previous cost.`}
          />
          <Card>
            <ul className="space-y-2">
              {req.attachments!.map((a) => (
                <AttachmentRow key={a.id} att={a} />
              ))}
            </ul>
          </Card>
        </div>
      )}

      {reqDocs.length > 0 && (
        <div>
          <SectionTitle
            title="Required documents"
            subtitle={`Checklist for ${sourcingMethodLabel(req.sourcingMethod!)} — matched against the attachments above.`}
          />
          <Card>
            <ul className="space-y-2 text-sm">
              {reqDocs.map((d) => (
                <li key={d.key} className="flex items-start gap-2">
                  {d.attached ? (
                    <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                  ) : (
                    <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">
                      {d.label}{' '}
                      <Badge tone={d.attached ? 'emerald' : 'amber'}>
                        {d.attached ? 'attached' : 'missing'}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted">{d.why}</p>
                  </div>
                </li>
              ))}
            </ul>
            {missingDocs.length > 0 && (
              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <Icon name="alert" className="mr-1 inline h-3.5 w-3.5" />
                {missingDocs.length} required document{missingDocs.length === 1 ? '' : 's'} missing —
                attach and tag {missingDocs.length === 1 ? 'it' : 'them'} so approvers see a complete pack.
              </p>
            )}
            {(req.sourcingMethod === 'rfp' || req.sourcingMethod === 'rfq') && (
              <p className="mt-3 rounded-lg bg-inset px-3 py-2 text-xs text-muted">
                <Icon name="info" className="mr-1 inline h-3.5 w-3.5" />
                Procurement must record invited vendors, responses, and any approved insufficient-bids exception.
              </p>
            )}
          </Card>
        </div>
      )}

      {(req.compliance?.directAwardReason ||
        req.compliance?.philgepsReference ||
        req.compliance?.priceReasonableness) && (
        <div>
          <SectionTitle title="Compliance references" subtitle="Direct-award basis, PhilGEPS, and price reasonableness." />
          <Card>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {req.compliance?.directAwardReason && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-faint">Direct-award reason</dt>
                  <dd className="mt-0.5 text-ink">
                    {DIRECT_AWARD_REASON_LABEL[req.compliance.directAwardReason] ??
                      req.compliance.directAwardReason}
                  </dd>
                </div>
              )}
              {req.compliance?.philgepsReference && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-faint">PhilGEPS reference</dt>
                  <dd className="mt-0.5 text-ink">{req.compliance.philgepsReference}</dd>
                </div>
              )}
              {req.compliance?.priceReasonableness && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-faint">Price reasonableness</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-ink">{req.compliance.priceReasonableness}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {req.status === 'draft' && isRequester && (
            <>
              <button type="button" onClick={handleSubmit} className="btn-primary">
                <Icon name="check" className="h-4 w-4" />
                Submit for approval
              </button>
              <button type="button" onClick={handleCancel} className="btn-outline">
                Cancel request
              </button>
            </>
          )}
          {(req.status === 'submitted' || req.status === 'under_review') && (
            <Link to="/approvals" className="btn-outline">
              <Icon name="rotate" className="h-4 w-4" />
              Open approval inbox
            </Link>
          )}
          {req.status === 'approved' && !linkedPo && (
            <Guard module="procurement" cap="author_po" fallback={null}>
              <button type="button" onClick={handleAuthorPO} className="btn-primary">
                <Icon name="plus" className="h-4 w-4" />
                Author purchase order
              </button>
            </Guard>
          )}
          {linkedPo && (
            <Link to={`/purchase-orders/${linkedPo.id}`} className="btn-primary">
              <Icon name="arrowRight" className="h-4 w-4" />
              View PO {linkedPo.poNumber}
            </Link>
          )}
        </div>
      </div>

      <div>
        <SectionTitle title="Activity" />
        <Card>
          <ol className="space-y-3">
            {activity.map((ev) => (
              <TimelineItem
                key={ev.key}
                icon={ev.icon}
                label={ev.label}
                at={ev.at}
                tone={ev.tone}
              />
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

function ApprovalStepRow({ step }: { step: ApprovalStep }) {
  const label = step.label ?? tierLabel(step.tier);
  const meta = STEP_STATUS[step.status];
  return (
    <li className="flex items-start gap-3">
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${meta.tone}`}
        aria-hidden
      >
        <Icon name={meta.icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          Step {step.order} · {label}
        </p>
        <p className="text-xs text-muted">
          <Badge tone={meta.badge}>{stepStatusLabel(step.status)}</Badge>
          {step.decidedByEmail && <> · {step.decidedByEmail}</>}
          {step.decidedAt && <> · {formatDateTime(step.decidedAt)}</>}
        </p>
        {step.note && (
          <p className="mt-1 whitespace-pre-line text-xs italic text-muted">&ldquo;{step.note}&rdquo;</p>
        )}
        {step.signature && (
          /* Signature artifact — mirrors legal's SignatureArtifact styling
             (bordered PNG + "e-signed by NAME · date · method" caption). */
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <Icon name="signature" className="h-3.5 w-3.5" />
              e-signed by {step.signature.signerName}
            </span>
            <span className="text-muted">
              {formatDateTime(step.signature.signedAt)}
              {' · '}
              <span className="uppercase tracking-wide">{step.signature.method}</span>
            </span>
            <img
              src={step.signature.dataUrl}
              alt={`Signature of ${step.signature.signerName}`}
              className="ml-auto h-10 w-auto max-w-[9rem] rounded border border-line bg-white object-contain"
            />
          </div>
        )}
      </div>
    </li>
  );
}

const STEP_STATUS: Record<
  ApprovalStep['status'],
  { icon: 'rotate' | 'check' | 'x' | 'pin'; tone: string; badge: 'slate' | 'cyan' | 'emerald' | 'rose' | 'amber' }
> = {
  pending: { icon: 'rotate', tone: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300', badge: 'cyan' },
  approved: { icon: 'check', tone: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300', badge: 'emerald' },
  rejected: { icon: 'x', tone: 'bg-rose-500/15 text-rose-800 dark:text-rose-300', badge: 'rose' },
  skipped: { icon: 'pin', tone: 'bg-slate-500/15 text-slate-800 dark:text-slate-300', badge: 'slate' },
};

function AttachmentRow({ att }: { att: RequestAttachment }) {
  const sizeKb = (att.sizeBytes / 1024).toFixed(1);
  const { mode, supabaseClient } = useSession();
  const { error } = useToast();
  const [downloading, setDownloading] = useState(false);

  async function downloadLiveAttachment() {
    if (mode !== 'supabase' || !supabaseClient || !att.storagePath) return;
    setDownloading(true);
    try {
      const prepared = await createGovernedAttachmentUrl(
        supabaseClient as unknown as GovernedAccessClient,
        att.id,
      );
      const anchor = document.createElement('a');
      anchor.href = prepared.url;
      anchor.download = prepared.filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Could not download the attachment.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink" title={att.filename}>
          {att.filename}{' '}
          <Badge tone="slate">{attachmentKindLabel(att.kind)}</Badge>
        </p>
        <p className="text-xs text-muted">
          {sizeKb} KB · {att.mimeType}
          {att.uploadedByEmail ? ` · ${att.uploadedByEmail}` : ''}
          {' · '}
          {formatDateTime(att.uploadedAt)}
        </p>
      </div>
      {att.dataUrl && (
        <a
          href={att.dataUrl}
          download={att.filename}
          className="btn-ghost btn-sm"
          aria-label={`Download ${att.filename}`}
        >
          <Icon name="download" className="h-4 w-4" />
          Download
        </a>
      )}
      {!att.dataUrl && att.storagePath && (
        <button
          type="button"
          className="btn-ghost btn-sm min-h-11"
          aria-label={`Download ${att.filename}`}
          disabled={downloading}
          onClick={downloadLiveAttachment}
        >
          <Icon name="download" className="h-4 w-4" />
          {downloading ? 'Preparing...' : 'Download'}
        </button>
      )}
    </li>
  );
}

function TimelineItem({
  icon,
  label,
  at,
  tone = 'slate',
}: {
  icon: 'pin' | 'rotate' | 'check' | 'x' | 'cart' | 'box';
  label: string;
  at: string;
  tone?: 'slate' | 'cyan' | 'emerald' | 'rose' | 'brand';
}) {
  const cls: Record<typeof tone, string> = {
    slate: 'bg-inset text-muted',
    cyan: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300',
    emerald: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
    rose: 'bg-rose-500/15 text-rose-800 dark:text-rose-300',
    brand: 'bg-brand-500/15 text-brand-700 dark:text-brand-300',
  };
  return (
    <li className="flex items-start gap-3">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${cls[tone]}`}>
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{label}</p>
        <p className="text-xs text-faint">{formatDateTime(at)}</p>
      </div>
    </li>
  );
}
