import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InventoryHold, QualityInspection, VendorReturn } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { Badge, EmptyState, PageHeader, SegmentedControl } from '@/components/ui';
import { InspectionSheet } from '@/components/quality/InspectionSheet';
import { HoldReleaseSheet } from '@/components/quality/HoldReleaseSheet';

type QualityTab = 'pending' | 'holds' | 'completed';

interface PendingInspection {
  id: string;
  sourceType: 'receipt' | 'return';
  sourceId: string;
  productId: string;
  quantity: number;
  binId?: string;
  recordedAt: string;
}

export function QualityPage() {
  const {
    data,
    can,
    identityId,
    loadQualityInspections,
    loadHolds,
    loadVendorReturns,
    inspectQuality,
    releaseHold,
    createVendorReturn,
  } = useWarehouse();
  const [tab, setTab] = useState<QualityTab>('pending');
  const [inspections, setInspections] = useState<QualityInspection[]>([]);
  const [holds, setHolds] = useState<InventoryHold[]>([]);
  const [vendorReturns, setVendorReturns] = useState<VendorReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPending, setSelectedPending] = useState<PendingInspection | null>(null);
  const [selectedHold, setSelectedHold] = useState<InventoryHold | null>(null);

  const reloadControls = useCallback(async () => {
    setLoading(true);
    try {
      const [inspectionPage, holdPage, vendorReturnPage] = await Promise.all([
        loadQualityInspections({ limit: 100 }),
        loadHolds({ limit: 100 }),
        loadVendorReturns({ limit: 100 }),
      ]);
      setInspections(inspectionPage.rows);
      setHolds(holdPage.rows);
      setVendorReturns(vendorReturnPage.rows);
    } finally {
      setLoading(false);
    }
  }, [loadHolds, loadQualityInspections, loadVendorReturns]);

  useEffect(() => {
    void reloadControls();
  }, [reloadControls]);

  const pending = useMemo<PendingInspection[]>(() => {
    if (!data) return [];
    const inspectedQuantity = (sourceType: PendingInspection['sourceType'], sourceId: string, productId: string) => inspections
      .filter((inspection) => inspection.sourceType === sourceType
        && inspection.sourceId === sourceId
        && inspection.productId === productId)
      .reduce((sum, inspection) => sum + inspection.quantity, 0);
    const receipts = data.receipts.flatMap((receipt) => receipt.lines.flatMap((line, lineIndex) => {
      const inspected = inspections
        .filter((inspection) => inspection.sourceType === 'receipt'
          && inspection.sourceId === receipt.id
          && inspection.productId === line.productId)
        .reduce((sum, inspection) => sum + inspection.quantity, 0);
      const quantity = Math.max(0, line.quantity - inspected);
      return quantity > 0 ? [{
        id: `${receipt.id}-${line.productId}-${lineIndex}`,
        sourceType: 'receipt' as const,
        sourceId: receipt.id,
        productId: line.productId,
        quantity,
        ...(line.binId ? { binId: line.binId } : {}),
        recordedAt: receipt.createdAt,
      }] : [];
    }));
    const returns = data.returns.flatMap((returned) => returned.lines.flatMap((line, lineIndex) => {
      const quantity = Math.max(0, line.quantity - inspectedQuantity('return', returned.id, line.productId));
      return quantity > 0 ? [{
        id: `${returned.id}-${line.productId}-${lineIndex}`,
        sourceType: 'return' as const,
        sourceId: returned.id,
        productId: line.productId,
        quantity,
        ...(line.binId ? { binId: line.binId } : {}),
        recordedAt: returned.createdAt,
      }] : [];
    }));
    return [...receipts, ...returns];
  }, [data, inspections]);

  if (!data) return null;
  const productName = (productId: string) => data.products.find((product) => product.id === productId)?.name ?? productId;
  const activeHolds = holds.filter((hold) => hold.status === 'active');
  const completed = inspections.filter((inspection) => inspection.disposition !== 'pending');
  const receiptRoute = data.operationRoutes?.find((route) => route.active && route.operationTypeId.includes('receipt'));
  const requiresEvidence = receiptRoute?.requiresEvidence ?? true;
  const mayRelease = can('release_quality_hold');

  const inspect = async (input: Parameters<typeof inspectQuality>[0]) => {
    const ok = await inspectQuality(input);
    if (ok) await reloadControls();
    return ok;
  };
  const release = async (input: Parameters<typeof releaseHold>[0]) => {
    const ok = await releaseHold(input);
    if (ok) await reloadControls();
    return ok;
  };
  const createReturn = async (input: Parameters<typeof createVendorReturn>[0]) => {
    const ok = await createVendorReturn(input);
    if (ok) await reloadControls();
    return ok;
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Quality control" icon="clipboard" subtitle="Inspect receipts, control holds, and preserve custody" />
      <div className="rounded-xl border border-line bg-inset/50 px-4 py-3 text-sm text-muted">
        {!mayRelease ? (
          <>
            <p className="font-semibold text-ink">Record inspection facts.</p>
            <p className="mt-0.5 text-xs">A Warehouse Supervisor decides quarantine or rejection.</p>
          </>
        ) : (
          <>
            <p className="font-semibold text-ink">Controlled exception disposition</p>
            <p className="mt-0.5 text-xs">Review holds, quarantine, rejection, and release without approving your own request.</p>
          </>
        )}
      </div>
      <SegmentedControl<QualityTab>
        ariaLabel="Quality status"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pending', label: 'Pending' },
          { value: 'holds', label: 'Holds' },
          { value: 'completed', label: 'Completed' },
        ]}
      />

      {loading ? (
        <p className="text-sm text-muted">Loading quality controls...</p>
      ) : tab === 'pending' ? (
        pending.length === 0 ? <EmptyState icon="clipboard" title="No inspections waiting" /> : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" aria-label="Pending inspections">
            {pending.map((item) => (
              <li key={item.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{productName(item.productId)}</p>
                  <p className="text-xs text-faint">{item.sourceType === 'receipt' ? 'Receipt' : 'Return'} {item.sourceId} · {item.quantity} unit(s) · {item.recordedAt.slice(0, 10)}</p>
                </div>
                <button type="button" className="btn-primary btn-sm justify-center" onClick={() => setSelectedPending(item)}>Inspect</button>
              </li>
            ))}
          </ul>
        )
      ) : tab === 'holds' ? (
        activeHolds.length === 0 && vendorReturns.length === 0 ? <EmptyState icon="clipboard" title="No active holds" /> : (
          <div className="space-y-4">
          {activeHolds.length > 0 && <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" aria-label="Active holds">
            {activeHolds.map((hold) => (
              <li key={hold.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-ink">{productName(hold.productId)}</p><Badge tone="amber">On hold</Badge></div>
                  <p className="mt-1 text-sm text-muted">{hold.reason}</p>
                  <p className="mt-1 text-xs text-faint">Created by {hold.createdBy} · {hold.createdAt.slice(0, 10)}</p>
                </div>
                {mayRelease && <button type="button" className="btn-ghost btn-sm justify-center" onClick={() => setSelectedHold(hold)}>Review hold</button>}
              </li>
            ))}
          </ul>}
          {vendorReturns.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" aria-label="Vendor returns">
              {vendorReturns.map((vendorReturn) => (
                <li key={vendorReturn.id} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{vendorReturn.reference}</p><p className="text-xs text-faint">{productName(vendorReturn.productId)} · {data.suppliers.find((supplier) => supplier.id === vendorReturn.supplierId)?.name ?? vendorReturn.supplierId}</p></div>
                  <Badge tone="brand">{vendorReturn.status === 'ready' ? 'Ready for handoff' : vendorReturn.status.replace('_', ' ')}</Badge>
                </li>
              ))}
            </ul>
          )}
          </div>
        )
      ) : completed.length === 0 ? <EmptyState icon="clipboard" title="No completed inspections" /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" aria-label="Completed inspections">
          {completed.map((inspection) => (
            <li key={inspection.id} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{productName(inspection.productId)}</p><p className="text-xs text-faint">{inspection.quantity} unit(s) · {inspection.inspectedAt.slice(0, 10)}</p></div>
              <Badge tone={inspection.disposition === 'accepted' ? 'emerald' : 'amber'}>{inspection.disposition.replace('_', ' ')}</Badge>
            </li>
          ))}
        </ul>
      )}

      <InspectionSheet
        target={selectedPending ? {
          sourceType: selectedPending.sourceType,
          sourceId: selectedPending.sourceId,
          productId: selectedPending.productId,
          productName: productName(selectedPending.productId),
          quantity: selectedPending.quantity,
          ...(selectedPending.binId ? { binId: selectedPending.binId } : {}),
        } : null}
        requiresEvidence={requiresEvidence}
        onOpenChange={(open) => { if (!open) setSelectedPending(null); }}
        onSubmit={inspect}
      />
      <HoldReleaseSheet
        hold={selectedHold}
        actor={identityId}
        productName={selectedHold ? productName(selectedHold.productId) : ''}
        mode={inspections.find((inspection) => inspection.id === selectedHold?.inspectionId)?.disposition === 'vendor_return' ? 'vendor_return' : 'release'}
        suppliers={data.suppliers}
        defaultSupplierId={selectedHold ? data.receipts.find((receipt) => receipt.id === inspections.find((inspection) => inspection.id === selectedHold.inspectionId)?.sourceId)?.supplierId : undefined}
        onOpenChange={(open) => { if (!open) setSelectedHold(null); }}
        onRelease={release}
        onCreateVendorReturn={createReturn}
      />
    </div>
  );
}
