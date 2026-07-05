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
import type { ProcurementRequestLine, RequestStatus } from '../types';
import {
  useApprovalHistory,
  useProcurementRequests,
  usePurchaseOrders,
} from '../localStore';

const STATUS_TONE: Record<RequestStatus, 'slate' | 'cyan' | 'amber' | 'emerald' | 'rose'> = {
  draft: 'slate',
  submitted: 'cyan',
  under_review: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  cancelled: 'slate',
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

  // Auto-submit when we arrived from CreateRequest with ?submit=1.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.id, req?.status]);

  const linkedPo = useMemo(
    () => pos.find((p) => p.requestId === id),
    [pos, id],
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
        <div className="h-40 animate-pulse rounded-3xl bg-inset" />
        <div className="h-32 animate-pulse rounded-2xl bg-inset" />
      </div>
    );
  }
  if (!req) return <Navigate to="/" replace />;

  const isRequester = profile?.email && req.requesterEmail === profile.email;

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

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <ModuleHero
        eyebrow={req.title}
        title={req.department ? `${req.department} · ${req.costCenter ?? '—'}` : (req.costCenter ?? 'Request')}
        description={req.description ?? 'No business justification provided.'}
        icon="cart"
        action={
          <div className="flex flex-wrap gap-2">
            <HeroChipButton href="/procurement" icon="arrowRight">
              Back to list
            </HeroChipButton>
          </div>
        }
        accessory={
          <>
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-100/70">Status</p>
              <p className="mt-1"><Badge tone={STATUS_TONE[req.status]}>{req.status}</Badge></p>
            </div>
            <div className="text-right">
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
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetaTile label="Requester" value={req.requesterName ?? req.requesterEmail ?? '—'} />
        <MetaTile label="Vendor" value={req.vendorName ?? 'Open to bids'} />
        <MetaTile label="Needed by" value={req.neededBy ? new Date(req.neededBy).toLocaleDateString() : '—'} />
        <MetaTile label="Created" value={new Date(req.createdAt).toLocaleString()} />
      </div>

      <div>
        <SectionTitle title="Line items" subtitle={`${req.lines.length} line${req.lines.length === 1 ? '' : 's'}`} />
        <DataTable rows={req.lines} columns={lineColumns} keyOf={(r) => r.id} />
      </div>

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
          {req.status === 'submitted' && (
            <Link to="/approvals" className="btn-outline">
              <Icon name="rotate" className="h-4 w-4" />
              Open approval inbox
            </Link>
          )}
          {req.status === 'approved' && !linkedPo && (
            <Guard module="procurement" cap="author_po">
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
                key={h.decidedAt}
                icon={h.decision === 'approved' ? 'check' : 'x'}
                label={`${h.decision === 'approved' ? 'Approved' : 'Rejected'} by ${h.decidedByEmail ?? 'approver'}${h.note ? ` — ${h.note}` : ''}`}
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
