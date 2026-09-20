import { userFacingError } from '@intra/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { tasksReturnPath } from '@/domain/taskNavigation';
import type { InventoryHold, QualityInspectionSummary, VendorReturn } from '@intra/data-kit';
import { qualityBatchGroup, type InspectQualityBatchInput } from '@intra/data-kit';
import { useSession } from '@intra/auth';
import { useWarehouse } from '@/app/store';
import { WAREHOUSE_MUTATION_CAPABILITIES } from '@/app/authorization';
import { Badge, EmptyState, PageHeader, SegmentedControl } from '@/components/ui';
import { InspectionSheet } from '@/components/quality/InspectionSheet';
import { HoldReleaseSheet } from '@/components/quality/HoldReleaseSheet';
import { InspectionEvidence } from '@/components/quality/InspectionEvidence';
import { pendingQualityWork, type PendingInspection } from '@/domain/controlQueues';
import { loadQualityControlPopulation } from '@/domain/qualityControlLoad';

type QualityTab = 'pending' | 'holds' | 'completed';

export function QualityPage() {
  const {
    data,
    can,
    capabilities,
    identityId,
    loadQualityInspectionSummaries: loadQualityInspections,
    loadHolds,
    loadVendorReturns,
    submitQualityInspection,
    submitQualityBatch,
    releaseHold,
    createVendorReturn,
  } = useWarehouse();
  const { mode, supabaseClient } = useSession();
  const [tab, setTab] = useState<QualityTab>('pending');
  const [inspections, setInspections] = useState<QualityInspectionSummary[]>([]);
  const [holds, setHolds] = useState<InventoryHold[]>([]);
  const [vendorReturns, setVendorReturns] = useState<VendorReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPending, setSelectedPending] = useState<PendingInspection | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [singlePending, setSinglePending] = useState(false);
  const [batchPending, setBatchPending] = useState(false);
  const inspectionPending = singlePending || batchPending;
  const [selectedHold, setSelectedHold] = useState<InventoryHold | null>(null);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const selectedSource = params.get('source') ?? params.get('inspection');
  const openedSource = useRef<string | null>(null);
  const loaders = useRef({ inspections: loadQualityInspections, holds: loadHolds, vendorReturns: loadVendorReturns });
  const loadSequence = useRef(0);
  const activeLoad = useRef<AbortController | null>(null);
  const accessScope = [...capabilities].sort().join('|');
  useEffect(() => {
    loaders.current = { inspections: loadQualityInspections, holds: loadHolds, vendorReturns: loadVendorReturns };
  });

  const reloadControls = useCallback(async () => {
    const sequence = ++loadSequence.current;
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const [inspectionPage, holdPage, vendorReturnPage] = await loadQualityControlPopulation(loaders.current, controller.signal);
      if (sequence !== loadSequence.current) return;
      setInspections(inspectionPage);
      setHolds(holdPage);
      setVendorReturns(vendorReturnPage);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setSelectedPending(null);
      setLoadError(error instanceof Error ? error.message : 'Quality controls could not be loaded.');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [identityId, mode, supabaseClient]);

  useEffect(() => {
    // Bootstrap replaces data once ready. Starting early downloads and then
    // discards the same evidence-heavy population before that replacement.
    if (!data) return;
    void reloadControls();
    return () => {
      loadSequence.current += 1;
      activeLoad.current?.abort();
    };
  }, [reloadControls, data, accessScope]);

  const projection = useMemo(() => {
    try {
      return { pending: data ? pendingQualityWork(data, inspections) : [], error: null };
    } catch (error) {
      return { pending: [], error: error instanceof Error ? error.message : 'Quality queue could not be reconciled.' };
    }
  }, [data, inspections]);
  const pending = projection.pending;
  const queueError = loadError ?? projection.error;
  const queueBlocked = loading || Boolean(queueError);
  useEffect(() => {
    if (queueError) {
      setSelectedPending(null);
      setSelectedHold(null);
      setSelectedIds([]);
      setBatchOpen(false);
    }
  }, [queueError]);
  useEffect(() => {
    if (!selectedSource || queueBlocked || inspectionPending || openedSource.current === selectedSource) return;
    openedSource.current = selectedSource;
    const item = pending.find(i => i.id === selectedSource);
    if (item) { setTab('pending'); if (can(WAREHOUSE_MUTATION_CAPABILITIES.inspectQuality)) setSelectedPending(item); else setSearch(selectedSource); return; }
    const hold = holds.find(h => h.id === selectedSource || h.inspectionId === selectedSource);
    if (hold && hold.status === 'active' && hold.reason !== 'Awaiting independent quality inspection') {
      setTab('holds'); setSearch(selectedSource); return;
    }
    const inspection = inspections.find(i => i.id === selectedSource);
    if (inspection && inspection.disposition !== 'pending') setTab('completed');
    setSearch(selectedSource);
  }, [selectedSource, queueBlocked, inspectionPending, pending, holds, inspections, can]);

  if (!data) return null;
  const productName = (productId: string) => data.products.find((product) => product.id === productId)?.name ?? productId;
  const matches = (...values: (string | undefined)[]) => values.join(' ').toLowerCase().includes(search.trim().toLowerCase());
  const shownPending = pending.filter(i => matches(i.id, i.sourceId, i.serialNumber, productName(i.productId)));
  const selectedItems = pending.filter(item => selectedIds.includes(item.id));
  const selectedGroup = selectedItems[0] ? qualityBatchGroup(selectedItems[0]) : null;
  const toggleSelected = (item: PendingInspection) => setSelectedIds(ids => ids.includes(item.id)
    ? ids.filter(id => id !== item.id)
    : ids.length < 50 && (!selectedGroup || selectedGroup === qualityBatchGroup(item)) ? [...ids, item.id] : ids);
  const groups = new Map<string, PendingInspection[]>();
  for (const item of shownPending) {
    const key = qualityBatchGroup(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const allActiveHolds = holds.filter((hold) =>
    hold.status === 'active' && hold.reason !== 'Awaiting independent quality inspection');
  const activeHolds = allActiveHolds.filter((hold) =>
    matches(hold.id, hold.inspectionId, hold.serialNumber, hold.reason, productName(hold.productId)));
  const allCompleted = inspections.filter((inspection) => inspection.disposition !== 'pending');
  const completed = allCompleted.filter((inspection) =>
    matches(inspection.id, inspection.sourceId, inspection.serialNumber, productName(inspection.productId)));
  const count = tab === 'pending' ? { shown: shownPending.length, total: pending.length, label: 'pending inspections' }
    : tab === 'holds' ? { shown: activeHolds.length, total: allActiveHolds.length, label: 'active holds' }
    : { shown: completed.length, total: allCompleted.length, label: 'completed inspections' };
  const receiptRoute = data.operationRoutes?.find((route) => route.active && route.operationTypeId.includes('receipt'));
  const requiresEvidence = receiptRoute?.requiresEvidence ?? true;
  const mayInspect = can(WAREHOUSE_MUTATION_CAPABILITIES.inspectQuality);
  const mayRelease = can(WAREHOUSE_MUTATION_CAPABILITIES.releaseHold);
  const mayCreateVendorReturn = can(WAREHOUSE_MUTATION_CAPABILITIES.createVendorReturn);
  const holdMode = (hold: InventoryHold) =>
    inspections.find((inspection) => inspection.id === hold.inspectionId)?.disposition === 'vendor_return'
      ? 'vendor_return' as const
      : 'release' as const;
  const mayReviewHold = (hold: InventoryHold) =>
    holdMode(hold) === 'vendor_return' ? mayCreateVendorReturn : mayRelease;

  const inspect = async (input: Parameters<typeof submitQualityInspection>[0]) => {
    if (batchPending || (queueBlocked && !singlePending)) return {status:'rejected' as const,stage:'not-sent' as const,code:'QUEUE_NOT_READY',message:'Wait for the current inspection or refresh the Quality queue before starting another.'};
    const result = await submitQualityInspection(input);
    if (result.status === 'committed') await reloadControls();
    return result;
  };
  const release = async (input: Parameters<typeof releaseHold>[0]) => {
    if (queueBlocked) return false;
    const ok = await releaseHold(input);
    if (ok) await reloadControls();
    return ok;
  };
  const inspectBatch = async (input: InspectQualityBatchInput) => {
    // An uncertain command must be replayable even after the pending queue changes.
    // Its pinned payload still passes the repository's authoritative checks.
    if (singlePending || (!batchPending && (queueBlocked || selectedItems.length !== selectedIds.length))) return {status:'rejected' as const,stage:'not-sent' as const,code:'QUEUE_CHANGED',message:'The selection changed. Refresh the Quality queue and select the pending items again.'};
    const result = await submitQualityBatch(input);
    if (result.status === 'committed') { setSelectedIds([]); setBatchOpen(false); await reloadControls(); }
    return result;
  };
  const createReturn = async (input: Parameters<typeof createVendorReturn>[0]) => {
    if (queueBlocked) return false;
    const ok = await createVendorReturn(input);
    if (ok) await reloadControls();
    return ok;
  };
  const rejectToVendor = async (input: Parameters<typeof createVendorReturn>[0]) => {
    if (queueBlocked || mode !== 'supabase' || !supabaseClient) return false;
    const { error } = await supabaseClient.schema('warehouse').rpc('reject_quality_hold_to_vendor', {
      payload: {
        idempotency_key: input.idempotencyKey,
        hold_id: input.holdId,
        supplier_id: input.supplierId,
        reason: input.reason,
        reference: input.reference,
        evidence_urls: input.evidenceUrls ?? [],
      },
    });
    if (error) return false;
    await reloadControls();
    return true;
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
        <label className="min-w-0 flex-1 text-sm font-medium">Find receipt, product or serial
          <input type="search" className="input mt-1 w-full" value={search} onChange={e => setSearch(e.target.value)} />
        </label>
        {!queueBlocked && <p className="text-sm text-muted sm:py-3">{search.trim() ? `${count.shown} of ${count.total} ${count.label}` : `${count.total} ${count.label}`}</p>}
      </div>
      {tab === 'pending' && mayInspect && selectedIds.length > 0 && !queueBlocked && <div className="flex flex-wrap items-center gap-3 border-y border-line bg-inset p-3" aria-label="Inspection selection">
        <p className="mr-auto text-sm font-semibold">{selectedItems.length} selected</p>
        <button type="button" className="btn-ghost min-h-11" disabled={inspectionPending} onClick={() => setSelectedIds([])}>Clear selection</button>
        <button type="button" className="btn-primary min-h-11" disabled={inspectionPending || selectedItems.length !== selectedIds.length || !selectedItems.length} onClick={() => setBatchOpen(true)}>Review selected inspections</button>
        {selectedItems.length !== selectedIds.length && <p role="status" className="w-full text-sm">{inspectionPending ? 'An inspection still needs confirmation. Review the unconfirmed inspection before selecting more items.' : 'Some selected items changed. Clear the selection and choose the remaining inspections.'}</p>}
      </div>}
      {selectedSource && <div className="space-y-1 rounded-lg border border-line p-3 text-sm">
        <p className="break-all">Selected source: {selectedSource}</p>
        {!queueBlocked && !pending.some(i => i.id === selectedSource || i.sourceId === selectedSource)
          && !holds.some(h => h.id === selectedSource || h.inspectionId === selectedSource)
          && <p role="status">{inspections.some(i => i.id === selectedSource) ? 'This inspection is already recorded. Review its disposition below.' : 'This source is unavailable or outside your access. No different item was selected.'}</p>}
        <Link to={tasksReturnPath(params)} className="btn-ghost btn-sm">Back to tasks</Link>
      </div>}

      {queueError ? <div role="alert" className="rounded-lg border border-rose-400 p-4"><p>{userFacingError(queueError)}</p><button type="button" disabled={loading} className="btn-ghost mt-2" onClick={() => void reloadControls()}>Retry quality queue</button></div> : loading ? (
        <p className="text-sm text-muted">Loading quality controls...</p>
      ) : tab === 'pending' ? (
        shownPending.length === 0 ? <EmptyState icon="clipboard" title={search ? 'No matching inspections' : 'No inspections waiting'} /> : (
          <ul className="space-y-3" aria-label="Pending inspections">
            {[...groups.entries()].map(([key, items]) => <li key={key}><details open={Boolean(search) || groups.size < 5} className="rounded-lg border border-line bg-surface">
              <summary className="cursor-pointer p-4 text-sm font-semibold">{productName(items[0]!.productId)} <span className="ml-2 font-normal text-muted">{items.length} inspection(s) · {items[0]!.recordedAt.slice(0, 10)}</span><span className="mt-1 block break-all text-xs font-normal text-muted">{items[0]!.sourceType} {items[0]!.sourceId}</span></summary>
              <div className="flex flex-wrap items-center justify-between gap-2 border-y border-line bg-inset px-4 py-2 text-xs">
                <span className="min-w-0 break-words">{[items[0]!.procurementPoLineId && `PO line ${items[0]!.procurementPoLineId}`, items[0]!.binId && `Bin ${items[0]!.binId}`, items[0]!.lotId && `Lot ${items[0]!.lotId}`].filter(Boolean).join(' / ') || 'General receiving area'}</span>
                {mayInspect && <button type="button" className="btn-ghost min-h-11" disabled={inspectionPending} onClick={() => setSelectedIds(items.slice(0, 50).map(item => item.id))}>{items.length > 50 ? 'Select first 50' : 'Select group'}</button>}
              </div>
              <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  {mayInspect && <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
                    <input type="checkbox" aria-label={`Select ${item.serialNumber ?? item.id}`} checked={selectedIds.includes(item.id)}
                      disabled={inspectionPending || (!selectedIds.includes(item.id) && (selectedIds.length >= 50 || Boolean(selectedGroup && selectedGroup !== key)))}
                      onChange={() => toggleSelected(item)} />
                  </label>}
                  <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-ink">{item.serialNumber ? `Serial ${item.serialNumber}` : productName(item.productId)}</p>
                  <p className="text-xs text-muted">{item.quantity} unit(s) · {item.recordedAt.slice(0, 10)}</p>
                  </div>
                </div>
                {mayInspect && <button type="button" className="btn-primary btn-sm min-h-11 justify-center" disabled={inspectionPending} onClick={() => setSelectedPending(item)}>Inspect</button>}
              </li>
            ))}
              </ul></details></li>)}
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
                {mayReviewHold(hold) && <button type="button" className="btn-ghost btn-sm justify-center" disabled={inspectionPending} onClick={() => setSelectedHold(hold)}>Review hold</button>}
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
            <li key={inspection.id} aria-label={`Inspection ${inspection.id}`} className="grid min-w-0 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-ink">{productName(inspection.productId)}</p>
                <p className="text-xs text-faint">{inspection.quantity} unit(s) · <time dateTime={inspection.inspectedAt}>{inspection.inspectedAt.slice(0, 10)}</time></p>
                <p className="break-all text-xs text-muted">{inspection.sourceType}: {inspection.sourceId}</p>
                <p className="break-all text-xs text-muted">Inspection: {inspection.id}</p>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <Badge tone={inspection.disposition === 'accepted' ? 'emerald' : 'amber'}>{inspection.disposition.replace('_', ' ')}</Badge>
                <InspectionEvidence key={`${identityId}:${mode}:${accessScope}:${inspection.id}:${inspection.inspectedAt}`} inspectionId={inspection.id} evidenceCount={inspection.evidenceCount} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <InspectionSheet
        target={!queueBlocked && selectedPending ? {
          sourceType: selectedPending.sourceType,
          sourceId: selectedPending.sourceId,
          productId: selectedPending.productId,
          productName: productName(selectedPending.productId),
          quantity: selectedPending.quantity,
          ...(selectedPending.binId ? { binId: selectedPending.binId } : {}),
          ...(selectedPending.lotId ? { lotId: selectedPending.lotId } : {}),
          ...(selectedPending.procurementPoLineId ? { procurementPoLineId: selectedPending.procurementPoLineId } : {}),
          ...(selectedPending.serialNumber ? { serialNumber: selectedPending.serialNumber } : {}),
        } : null}
        requiresEvidence={requiresEvidence}
        onOpenChange={(open) => { if (!open) setSelectedPending(null); }}
        onSubmit={inspect}
        onPendingChange={setSinglePending}
      />
      <InspectionSheet
        target={batchOpen && !queueBlocked && selectedItems[0] ? { ...selectedItems[0], productName: productName(selectedItems[0].productId) } : null}
        batchTargets={batchOpen ? selectedItems.map(item => ({ ...item, productName: productName(item.productId) })) : undefined}
        requiresEvidence
        onOpenChange={setBatchOpen}
        onSubmit={inspect}
        onSubmitBatch={inspectBatch}
        onPendingChange={setBatchPending}
      />
      <HoldReleaseSheet
        hold={queueBlocked ? null : selectedHold}
        actor={identityId}
        productName={selectedHold ? productName(selectedHold.productId) : ''}
        mode={selectedHold ? holdMode(selectedHold) : 'release'}
        suppliers={data.suppliers}
        defaultSupplierId={selectedHold ? data.receipts.find((receipt) => receipt.id === inspections.find((inspection) => inspection.id === selectedHold.inspectionId)?.sourceId)?.supplierId : undefined}
        onOpenChange={(open) => { if (!open) setSelectedHold(null); }}
        onRelease={release}
        onCreateVendorReturn={createReturn}
        onRejectToVendor={rejectToVendor}
      />
    </div>
  );
}
