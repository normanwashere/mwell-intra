'use client';

import { useEffect, useMemo } from 'react';
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
  Icon,
  ModuleHero,
  SectionTitle,
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
  minimumQuotes,
  requiredDocuments,
  sourcingMethodLabel,
  tierLabel,
} from '../policy';

// Bright dots for status pills placed on the navy hero (badges with tinted
// backgrounds look faded against the gradient; solid dots read cleanly).
const STATUS_DOT: Record<RequestStatus, string> = {
  draft: 'bg-slate-300',
  submitted: 'bg-cyan-300',
  under_review: 'bg-amber-300',
  approved: 'bg-emerald-300',
  rejected: 'bg-rose-300',
  cancelled: 'bg-slate-400',
};

const lineColumns: Column<ProcurementRequestLine>[] = [
  { key: 'description', header: 'Description', render: (r) => r.description },
  { key: 'quantity', header: 'Qty', render: (r) => `${r.quantity} ${r.uom ?? 'ea'}` },
  {
    key: 'unitPrice',
    header: 'Unit ₱',
    render: (r) =>
      r.unitPrice != null
        ? r.unitPrice.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : '—',
  },
  {
    key: 'lineTotal',
    header: 'Line ₱',
    render: (r) =>
      r.unitPrice != null
        ? (r.unitPrice * r.quantity).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : '—',
  },
];

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
      const ok = submit(req.id);
      if (ok) {
        success('Request submitted for approval');
      }
      searchParams.delete('submit');
      setSearchParams(searchParams, { replace: true });
    }
  }, [req?.id, req?.status]);

  const linkedPo = useMemo(
    () => pos.find((p) => p.requestId === id),
    [pos, id],
  );

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

  function handleSubmit() {
    if (!req) return;
    const ok = submit(req.id);
    if (ok) success('Request submitted for approval');
    else error('Could not submit — try again.');
  }
  function handleCancel() {
    if (!req) return;
    const ok = cancel(req.id);
    if (ok) success('Request cancelled');
  }
  function handleAuthorPO() {
    if (!req || !req.vendorId || !req.vendorName) {
      error('Assign a vendor to this request before authoring a PO.');
      return;
    }
    const po = addPO({
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

  const reqDocs = req.sourcingMethod
    ? requiredDocuments({
        category: req.category,
        amount: req.estimatedAmount,
        sourcingMethod: req.sourcingMethod,
      })
    : [];
  const minQuotes = req.sourcingMethod ? minimumQuotes(req.sourcingMethod) : null;

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
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-100/70">Status</p>
              <p className="mt-1">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white`}
                >
                  <span
                    aria-hidden
                    className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[req.status]}`}
                  />
                  {req.status}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-100/70">Estimated total</p>
              <p className="tnum text-2xl font-extrabold">
                {req.estimatedAmount != null
                  ? `\u20b1${req.estimatedAmount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : '—'}
              </p>
            </div>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetaTile label="Requester" value={req.requesterName ?? req.requesterEmail ?? '—'} />
        <MetaTile label="Category" value={cat?.label ?? '—'} />
        <MetaTile label="Sourcing" value={req.sourcingMethod ? sourcingMethodLabel(req.sourcingMethod) : '—'} />
        <MetaTile label="Vendor" value={req.vendorName ?? 'Open to bids'} />
        <MetaTile label="Cost center" value={req.costCenter ?? '—'} />
        <MetaTile label="Project code" value={req.projectCode ?? '—'} />
        <MetaTile label="Budget / GL" value={req.budgetCode ?? '—'} />
        <MetaTile label="Needed by" value={req.neededBy ? new Date(req.neededBy).toLocaleDateString() : '—'} />
      </div>

      {req.justification && (
        <div>
          <SectionTitle title="Business justification" subtitle="Policy §9 — Award Recommendation basis." />
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
            subtitle="Multi-tier routing derived from category + amount + sourcing (policy §3, §9)."
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
            subtitle={`Checklist for ${sourcingMethodLabel(req.sourcingMethod!)} (policy §6 + Annex B).`}
          />
          <Card>
            <ul className="space-y-2 text-sm">
              {reqDocs.map((d) => (
                <li key={d.key} className="flex items-start gap-2">
                  <Icon name="check" className="mt-0.5 h-4 w-4 text-faint" />
                  <div>
                    <p className="font-semibold text-ink">{d.label}</p>
                    <p className="text-xs text-muted">{d.why}</p>
                  </div>
                </li>
              ))}
            </ul>
            {minQuotes != null && (
              <p className="mt-3 rounded-lg bg-inset px-3 py-2 text-xs text-muted">
                <Icon name="info" className="mr-1 inline h-3.5 w-3.5" />
                {minQuotes} comparable {req.sourcingMethod === 'rfp' ? 'proposals' : 'quotations'} required.
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
                  <dd className="mt-0.5 text-ink">{req.compliance.directAwardReason.replace('_', ' ')}</dd>
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
        <SectionTitle title="Activity" subtitle="Everything that has happened on this request." />
        <Card>
          <ol className="space-y-3">
            <TimelineItem
              icon="pin"
              label={`Draft created by ${req.requesterName ?? req.requesterEmail ?? 'requester'}`}
              at={req.createdAt}
            />
            {req.submittedAt && (
              <TimelineItem
                icon="rotate"
                label="Submitted for approval"
                at={req.submittedAt}
                tone="cyan"
              />
            )}
            {history.map((h) => (
              <TimelineItem
                key={`${h.decidedAt}-${h.stepId ?? ''}`}
                icon={h.decision === 'approved' ? 'check' : 'x'}
                label={`${h.decision === 'approved' ? 'Approved' : 'Rejected'}${
                  h.tier ? ` by ${tierLabel(h.tier)}` : ''
                }${h.decidedByEmail ? ` (${h.decidedByEmail})` : ''}${h.note ? ` — ${h.note}` : ''}`}
                at={h.decidedAt}
                tone={h.decision === 'approved' ? 'emerald' : 'rose'}
              />
            ))}
            {linkedPo && (
              <TimelineItem
                icon="cart"
                label={`Purchase order ${linkedPo.poNumber} drafted`}
                at={linkedPo.createdAt}
                tone="brand"
              />
            )}
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
          Step {step.order}. {label}
        </p>
        <p className="text-xs text-muted">
          <Badge tone={meta.badge}>{step.status.replace('_', ' ')}</Badge>
          {step.decidedByEmail && <> · {step.decidedByEmail}</>}
          {step.decidedAt && <> · {new Date(step.decidedAt).toLocaleString()}</>}
        </p>
        {step.note && (
          <p className="mt-1 whitespace-pre-line text-xs italic text-muted">&ldquo;{step.note}&rdquo;</p>
        )}
        {step.signature && (
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <Icon name="signature" className="h-3.5 w-3.5" />
              e-signed by {step.signature.signerName}
            </span>
            <span className="text-muted">
              {new Date(step.signature.signedAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
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
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink" title={att.filename}>
          {att.filename}
        </p>
        <p className="text-xs text-muted">
          {sizeKb} KB · {att.mimeType}
          {att.uploadedByEmail ? ` · ${att.uploadedByEmail}` : ''}
          · {new Date(att.uploadedAt).toLocaleString()}
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
    </li>
  );
}

function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-faint">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </p>
    </Card>
  );
}

function TimelineItem({
  icon,
  label,
  at,
  tone = 'slate',
}: {
  icon: 'pin' | 'rotate' | 'check' | 'x' | 'cart';
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
        <p className="text-xs text-faint">{new Date(at).toLocaleString()}</p>
      </div>
    </li>
  );
}
