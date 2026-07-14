'use client';

import { useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Icon, PageHeader, useToast } from '@intra/ui';
import { useAcceptanceWorkItem } from '../localStore';

export function AcceptanceWorkItemPage() {
  const { id = '' } = useParams();
  const { item, loading, recordAcceptance } = useAcceptanceWorkItem(id);
  const { success, error } = useToast();
  const [scope, setScope] = useState('Delivered goods match the approved request and QC-accepted quantities.');
  const [exceptions, setExceptions] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const acceptedLines = useMemo(() => item?.lines.map((line) => ({
    poLineId: line.poLineId,
    quantity: Math.min(line.qcAcceptedQuantity, Math.max(0, quantities[line.poLineId] ?? line.qcAcceptedQuantity)),
  })) ?? [], [item, quantities]);

  if (loading) return <p className="p-4 text-sm text-muted">Loading goods acceptance...</p>;
  if (!item) return <Navigate to="/" replace />;

  const submit = async () => {
    try {
      if (await recordAcceptance({
        acceptedScope: scope.trim(), acceptedLines,
        exceptions: exceptions.split('\n').map((value) => value.trim()).filter(Boolean),
      })) success('Goods acceptance recorded');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not record goods acceptance.');
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Goods acceptance" icon="check" subtitle={`${item.poNumber} · Warehouse QC evidence`} />
      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="text-sm text-muted">Latest receipt <strong className="text-ink">{item.latestWarehouseReceiptReference ?? 'Pending'}</strong> · QC {item.latestQcStatus ?? 'pending'}</p>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {item.lines.map((line) => (
          <li key={line.poLineId} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-end">
            <div>
              <p className="font-semibold text-ink">{line.description}</p>
              <p className="text-sm text-muted">Ordered {line.orderedQuantity} {line.uom} · QC accepted {line.qcAcceptedQuantity} · Rejected or quarantined {line.rejectedOrQuarantinedQuantity}</p>
            </div>
            <label className="text-sm font-semibold text-ink">Accept quantity
              <input className="input mt-1" type="number" min={0} max={line.qcAcceptedQuantity} value={quantities[line.poLineId] ?? line.qcAcceptedQuantity} onChange={(event) => setQuantities((current) => ({ ...current, [line.poLineId]: Number(event.target.value) }))} />
            </label>
          </li>
        ))}
      </ul>
      <label className="block text-sm font-semibold text-ink">Accepted scope
        <textarea className="input mt-1 min-h-24" value={scope} onChange={(event) => setScope(event.target.value)} />
      </label>
      <label className="block text-sm font-semibold text-ink">Exceptions
        <textarea className="input mt-1 min-h-20" value={exceptions} onChange={(event) => setExceptions(event.target.value)} />
      </label>
      <button type="button" className="btn-primary" disabled={!scope.trim() || acceptedLines.every((line) => line.quantity <= 0)} onClick={() => void submit()}>
        <Icon name="check" className="h-4 w-4" /> Record goods acceptance
      </button>
    </div>
  );
}
