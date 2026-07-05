'use client';

import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  Badge,
  Card,
  DataTable,
  HeroChipButton,
  Icon,
  ModuleHero,
  SectionTitle,
  Sheet,
  SignaturePad,
  useToast,
  type Column,
  type SignaturePayload,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus } from '../types';
import { isAccredited, useProcurementVendors, usePurchaseOrders } from '../localStore';

const PO_TONE: Record<PurchaseOrderStatus, 'slate' | 'cyan' | 'amber' | 'emerald' | 'rose'> = {
  draft: 'slate',
  pending_approval: 'amber',
  approved: 'cyan',
  issued: 'cyan',
  closed: 'emerald',
  cancelled: 'rose',
};

const lineColumns: Column<PurchaseOrderLine>[] = [
  { key: 'description', header: 'Description', render: (r) => r.description },
  { key: 'quantity', header: 'Ordered', render: (r) => `${r.quantity} ${r.uom ?? 'ea'}` },
  { key: 'received', header: 'Received', render: (r) => `${r.receivedQuantity} / ${r.quantity}` },
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

export function PODetailPage() {
  const { id = '' } = useParams();
  const { rows, approve, issue, cancel, receive, loading } = usePurchaseOrders();
  const vendors = useProcurementVendors();
  const { profile } = useSession();
  const { success, error } = useToast();

  const po: PurchaseOrder | undefined = useMemo(() => rows.find((r) => r.id === id), [rows, id]);
  const vendor = useMemo(
    () => (po ? vendors.find((v) => v.id === po.vendorId) : undefined),
    [po, vendors],
  );

  // Signature-capture sheet state for the award approval flow.
  const [signOpen, setSignOpen] = useState(false);
  const [signature, setSignature] = useState<SignaturePayload | null>(null);
  const [approvalNote, setApprovalNote] = useState('');

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-40 animate-pulse rounded-3xl bg-inset" />
        <div className="h-32 animate-pulse rounded-2xl bg-inset" />
      </div>
    );
  }
  if (!po) return <Navigate to="/purchase-orders" replace />;

  const accreditationOk = vendor ? isAccredited(vendor) : false;
  const fullyReceived = po.lines.every((l) => l.receivedQuantity >= l.quantity);

  function openApprovalSheet() {
    if (!accreditationOk) {
      error('Vendor accreditation must be current to approve this PO.');
      return;
    }
    setSignature(null);
    setApprovalNote('');
    setSignOpen(true);
  }

  function confirmApproval() {
    if (!po || !signature) return;
    const next = approve(po.id, {
      email: profile?.email,
      note: approvalNote || undefined,
      signature,
    });
    if (next) {
      success(`PO ${next.poNumber} approved`);
      setSignOpen(false);
      setSignature(null);
      setApprovalNote('');
    } else {
      error('Could not save the approval.');
    }
  }
  function handleIssue() {
    if (!po) return;
    const next = issue(po.id);
    if (next) success(`PO ${next.poNumber} issued`);
  }
  function handleCancel() {
    if (!po) return;
    const next = cancel(po.id);
    if (next) success(`PO ${next.poNumber} cancelled`);
  }
  function receiveLine(lineId: string, qty: number) {
    if (!po) return;
    const next = receive(po.id, lineId, qty);
    if (next) success(`Recorded ${qty} received`);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModuleHero
        eyebrow={`Purchase order · ${po.poNumber}`}
        title={po.vendorName}
        description={po.notes ?? 'No notes on this PO.'}
        icon="cart"
        action={
          <HeroChipButton href="/purchase-orders" icon="arrowRight">
            Back to POs
          </HeroChipButton>
        }
        accessory={
          <>
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-100/70">Status</p>
              <p className="mt-1"><Badge tone={PO_TONE[po.status]}>{po.status.replace('_', ' ')}</Badge></p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-brand-100/70">Total</p>
              <p className="tnum text-2xl font-extrabold">
                ₱{po.total.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetaTile label="Vendor" value={po.vendorName} />
        <MetaTile
          label="Accreditation"
          value={
            vendor
              ? `${vendor.accreditationStatus}${vendor.accreditationExpiresAt ? ` · exp ${new Date(vendor.accreditationExpiresAt).toLocaleDateString()}` : ''}`
              : '—'
          }
          badgeTone={accreditationOk ? 'emerald' : 'rose'}
        />
        <MetaTile label="Origin" value={po.origin} />
        <MetaTile label="Requested by" value={po.actorEmail ?? '—'} />
      </div>

      {!accreditationOk && (po.status === 'draft' || po.status === 'pending_approval') && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-800 dark:text-rose-300">
              <Icon name="alert" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">Award blocked — vendor accreditation isn&apos;t current.</p>
              <p className="mt-0.5 text-sm text-muted">
                Ask Legal to close the accreditation case (status must be
                <span className="mx-1 font-semibold">approved</span>
                and not expired) before this PO can be approved.
              </p>
            </div>
          </div>
        </Card>
      )}

      <div>
        <SectionTitle title="Line items" subtitle={`${po.lines.length} line${po.lines.length === 1 ? '' : 's'}`} />
        <DataTable rows={po.lines} columns={lineColumns} keyOf={(r) => r.id} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {po.status === 'draft' && (
            <Guard module="procurement" cap="approve_award" fallback={null}>
              <button
                type="button"
                onClick={openApprovalSheet}
                disabled={!accreditationOk}
                className="btn-primary"
              >
                <Icon name="signature" className="h-4 w-4" />
                Sign & approve award
              </button>
            </Guard>
          )}
          {po.status === 'approved' && (
            <button type="button" onClick={handleIssue} className="btn-primary">
              <Icon name="rotate" className="h-4 w-4" />
              Issue to vendor
            </button>
          )}
          {po.status === 'issued' && !fullyReceived && (
            <ReceiveActions po={po} onReceive={receiveLine} />
          )}
          {(po.status === 'draft' || po.status === 'approved' || po.status === 'issued') && (
            <button type="button" onClick={handleCancel} className="btn-outline">
              Cancel PO
            </button>
          )}
          {po.requestId && (
            <Link to={`/requests/${po.requestId}`} className="btn-ghost">
              <Icon name="clipboard" className="h-4 w-4" />
              Source request
            </Link>
          )}
        </div>
      </div>

      {po.approvalSignature && (
        <div>
          <SectionTitle
            title="Award signature"
            subtitle="Legally-binding electronic signature captured at approval time (RA 8792)."
          />
          <SignatureBlock
            sig={po.approvalSignature}
            approvedByEmail={po.approvedByEmail}
            approvedAt={po.approvedAt}
          />
        </div>
      )}

      <Sheet
        open={signOpen}
        onOpenChange={setSignOpen}
        title={`Sign & approve — PO ${po.poNumber}`}
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-muted">
            Approving this award authorises PO {po.poNumber} to be issued to{' '}
            <span className="font-semibold text-ink">{po.vendorName}</span>. Your
            signature is stored on the audit trail alongside the approval.
          </p>
          <div className="space-y-1">
            <label
              htmlFor="po-approval-note"
              className="text-xs font-semibold uppercase tracking-wide text-faint"
            >
              Note (optional)
            </label>
            <textarea
              id="po-approval-note"
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              rows={3}
              className="input"
              placeholder="Add context that should live on the audit trail…"
            />
          </div>
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
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setSignOpen(false)}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmApproval}
              disabled={!signature}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon name="signature" className="h-4 w-4" />
              Sign & approve
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function SignatureBlock({
  sig,
  approvedByEmail,
  approvedAt,
}: {
  sig: NonNullable<PurchaseOrder['approvalSignature']>;
  approvedByEmail?: string;
  approvedAt?: string;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-ink">
            {sig.signerName}
            {approvedByEmail ? (
              <span className="ml-1 text-xs font-normal text-muted">
                &lt;{approvedByEmail}&gt;
              </span>
            ) : null}
          </p>
          <p className="text-xs text-muted">
            Signed{' '}
            {new Date(sig.signedAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            {approvedAt && approvedAt !== sig.signedAt
              ? ` · Approved ${new Date(approvedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}`
              : ''}
            {' · '}
            <span className="uppercase tracking-wide">{sig.method}</span>
          </p>
          <p className="line-clamp-2 text-[0.68rem] text-faint" title={sig.userAgent}>
            {sig.userAgent}
          </p>
        </div>
        <div className="shrink-0 rounded-xl border border-line bg-white p-2">
          <img
            src={sig.dataUrl}
            alt={`Signature of ${sig.signerName}`}
            className="h-16 w-56 object-contain"
          />
        </div>
      </div>
    </Card>
  );
}

function ReceiveActions({
  po,
  onReceive,
}: {
  po: PurchaseOrder;
  onReceive: (lineId: string, qty: number) => void;
}) {
  return (
    <details className="rounded-xl border border-line bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        Record a receipt (mock)
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {po.lines.map((l) => {
          const outstanding = l.quantity - l.receivedQuantity;
          if (outstanding <= 0) return null;
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate">{l.description}</span>
              <span className="text-xs text-muted">outstanding {outstanding}</span>
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() => onReceive(l.id, outstanding)}
              >
                Receive {outstanding}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function MetaTile({
  label,
  value,
  badgeTone,
}: {
  label: string;
  value: string;
  badgeTone?: 'emerald' | 'rose' | 'amber' | 'brand' | 'slate' | 'cyan';
}) {
  return (
    <Card>
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 flex items-center gap-2 truncate text-sm font-semibold text-ink" title={value}>
        {badgeTone && <Badge tone={badgeTone}>{badgeTone === 'emerald' ? 'ok' : 'attention'}</Badge>}
        <span className="min-w-0 truncate">{value}</span>
      </p>
    </Card>
  );
}
