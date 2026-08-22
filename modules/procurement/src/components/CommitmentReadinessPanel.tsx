'use client';

import { useState } from 'react';
import { Badge, Icon } from '@intra/ui';
import type { CommitmentEvidenceRequirement } from '../policy';

export interface PurchaseOrderLifecycleProjection {
  revision: number;
  issuedAt?: string;
  acknowledgementDueAt?: string;
  acknowledgementStatus: 'pending' | 'acknowledged' | 'overdue';
  deliveryNoticeStatus: 'pending' | 'recorded' | 'late';
  qualityRecoveryStatus: 'none' | 'vendor_notice' | 'replacement_rma' | 'payment_hold' | 'resolved';
  closureStatus: 'open' | 'ready' | 'blocked' | 'closed';
}

export interface OpenPurchaseOrderMonitoringItem {
  id: string;
  kind: string;
  owner: string;
  dueAt?: string;
  ageHours?: number;
  lastNoticeAt?: string;
  nextAction: string;
}

export function CommitmentReadinessPanel({
  readiness,
  lifecycle,
  monitoring = [],
  canAcknowledge,
  canRecordDeliveryNotice,
  onAcknowledge,
  onRecordDeliveryNotice,
}: {
  readiness: { ready: boolean; blockers: string[]; requiredEvidence: CommitmentEvidenceRequirement[] };
  lifecycle?: PurchaseOrderLifecycleProjection;
  monitoring?: OpenPurchaseOrderMonitoringItem[];
  canAcknowledge: boolean;
  canRecordDeliveryNotice: boolean;
  onAcknowledge: (reference: string) => Promise<void>;
  onRecordDeliveryNotice: (reference: string) => Promise<void>;
}) {
  const [acknowledgementReference, setAcknowledgementReference] = useState('');
  const [deliveryReference, setDeliveryReference] = useState('');
  const acknowledgementOverdue = lifecycle?.acknowledgementStatus === 'overdue';

  return (
    <section className="space-y-3" aria-label="PO commitment readiness">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">PO commitment and delivery control</h3>
          <p className="text-xs text-muted">The server owns issue, acceptance, quality recovery, and closure decisions.</p>
        </div>
        <Badge tone={readiness.ready ? 'emerald' : 'amber'}>{readiness.ready ? 'Package ready' : `${readiness.blockers.length} package blocker${readiness.blockers.length === 1 ? '' : 's'}`}</Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {readiness.requiredEvidence.map((item) => (
          <div key={item.kind} className="min-h-11 rounded-lg border border-line px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2"><span className="font-medium text-ink">{item.label}</span><Badge tone={item.status === 'present' ? 'emerald' : 'amber'}>{item.status}</Badge></div>
            <p className="mt-1 text-xs text-muted">{item.basis} / {item.source}</p>
            <p className="text-xs text-muted">Owner: {item.owner}. {item.recovery}</p>
          </div>
        ))}
      </div>
      {readiness.blockers.length > 0 && <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-200">{readiness.blockers.map((blocker) => <li key={blocker} className="flex gap-2"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />{blocker}</li>)}</ul>}

      {lifecycle && <div className="grid gap-2 rounded-lg border border-line bg-inset p-3 text-sm sm:grid-cols-2">
        <p><span className="font-semibold text-ink">48-hour acknowledgement threshold</span><br /><span className="text-muted">{lifecycle.acknowledgementDueAt ? new Date(lifecycle.acknowledgementDueAt).toLocaleString() : 'Starts only after governed issue.'}</span></p>
        <p><span className="font-semibold text-ink">Quality recovery</span><br /><span className="text-muted">{lifecycle.qualityRecoveryStatus.replaceAll('_', ' ')}</span>{lifecycle.qualityRecoveryStatus === 'payment_hold' ? <span className="ml-2"><Badge tone="rose">Payment hold</Badge></span> : null}</p>
        <p><span className="font-semibold text-ink">Delivery notice</span><br /><span className="text-muted">{lifecycle.deliveryNoticeStatus}</span></p>
        <p><span className="font-semibold text-ink">Closure</span><br /><span className="text-muted">{lifecycle.closureStatus}</span></p>
      </div>}

      {(canAcknowledge || canRecordDeliveryNotice) && <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
        {canAcknowledge && <label className="text-sm font-semibold text-ink">Vendor acknowledgement reference<input className="input mt-1.5" value={acknowledgementReference} onChange={(event) => setAcknowledgementReference(event.target.value)} /><button type="button" className="btn-outline mt-2 w-full" disabled={!acknowledgementReference.trim()} onClick={() => void onAcknowledge(acknowledgementReference.trim())}>Record vendor acknowledgement</button></label>}
        {canRecordDeliveryNotice && <label className="text-sm font-semibold text-ink">Vendor delivery notice reference<input className="input mt-1.5" value={deliveryReference} onChange={(event) => setDeliveryReference(event.target.value)} /><button type="button" className="btn-outline mt-2 w-full" disabled={!deliveryReference.trim()} onClick={() => void onRecordDeliveryNotice(deliveryReference.trim())}>Record delivery notice</button></label>}
      </div>}

      {monitoring.length > 0 && <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Open PO monitoring queue">{monitoring.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"><span><strong className="text-ink">{item.nextAction}</strong><span className="block text-xs text-muted">{item.owner}{item.ageHours != null ? ` / ${item.ageHours}h open` : ''}</span></span><Badge tone={acknowledgementOverdue || item.kind.includes('overdue') ? 'rose' : 'amber'}>{item.dueAt ? new Date(item.dueAt).toLocaleDateString() : 'Review weekly'}</Badge></li>)}</ul>}
    </section>
  );
}
