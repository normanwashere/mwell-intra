import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSession } from '@intra/auth';
import { useWarehouse } from '@/app/store';
import {
  poProgress,
  poTotalOrdered,
  poTotalReceived,
  poValue,
} from '@/domain/purchaseOrders';
import {
  PO_STATUS_LABELS,
  formatDate,
  formatWhen,
  poNumberMap,
} from '@/domain/format';
import { useProcurementPOs, type BridgedPO } from '@/data/procurementBridge';
import type { POStatus, PurchaseOrder } from '@/domain/types';
import {
  BarRow,
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  ProductSelect,
  QuantityStepper,
  SegmentedControl,
  Sheet,
  money,
  useToast,
  type Tone,
} from '@/components/ui';
import { Icon } from '@/components/Icon';
import {
  ReceiptExceptionDecisionPanel,
  type ReceiptExceptionDecisionInput,
  type ReceiptExceptionDecisionItem,
} from '@/components/ReceiptExceptionDecisionPanel';
import {
  ExcessCustodyDecisionPanel,
  type ExcessCustodyDecisionInput,
  type ExcessCustodyWorkItem,
} from '@/components/ExcessCustodyDecisionPanel';

type POFilter = 'all' | 'open' | 'closed';
type ReceiptDisposition = 'clean' | 'short' | 'excess' | 'damaged' | 'unidentified';

const STATUS_TONE: Record<POStatus, Tone> = {
  draft: 'slate',
  ordered: 'brand',
  partially_received: 'amber',
  received: 'emerald',
  cancelled: 'rose',
};

export function PurchaseOrdersPage() {
  const {
    data, source, can, receiveAgainstPO, cancelPurchaseOrder,
    loadReceivableProcurementPOs, receiveProcurementPO, canOpenRoute,
  } = useWarehouse();
  const toast = useToast();
  const { mode, supabaseClient } = useSession();
  const [searchParams] = useSearchParams();
  const handoffPoId = searchParams.get('po');
  const openedHandoffRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const canManagePOs = can('view_procurement');
  const canReceive = can('receive_stock');

  // Procurement-module POs (issued/approved) read from their localStorage
  // contract — read-only visibility across the module seam (J1-6).
  const [bridgeReload, setBridgeReload] = useState(0);
  const bridgedPOs = useProcurementPOs(
    source,
    loadReceivableProcurementPOs,
    bridgeReload,
  );

  // Row-as-target (WH-27): tapping a PO opens its detail sheet; Receive and
  // Cancel live INSIDE the sheet instead of repeating on every card.
  const [detailPOId, setDetailPOId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [receiveLoc, setReceiveLoc] = useState('');
  const [receiveBin, setReceiveBin] = useState('');
  const [filter, setFilter] = useState<POFilter>('all');
  const [bridgeReceivePO, setBridgeReceivePO] = useState<BridgedPO | null>(null);
  const [bridgeProducts, setBridgeProducts] = useState<Record<string, string>>({});
  const [bridgeObservedDescriptions, setBridgeObservedDescriptions] = useState<Record<string, string>>({});
  const [bridgeObservedIdentifiers, setBridgeObservedIdentifiers] = useState<Record<string, string>>({});
  const [bridgeQty, setBridgeQty] = useState<Record<string, number>>({});
  const [bridgeLocation, setBridgeLocation] = useState('');
  const [bridgeBin, setBridgeBin] = useState('');
  const [bridgeEvidence, setBridgeEvidence] = useState('');
  const [bridgeDisposition, setBridgeDisposition] = useState<ReceiptDisposition>('clean');
  const [bridgeExceptionReason, setBridgeExceptionReason] = useState('');
  const [exceptionDecisions, setExceptionDecisions] = useState<ReceiptExceptionDecisionItem[]>([]);
  const [excessCustodyItems, setExcessCustodyItems] = useState<ExcessCustodyWorkItem[]>([]);
  const warehouses = useMemo(
    () => data?.locations.filter((location) => location.type === 'warehouse') ?? [],
    [data],
  );

  const mayResolveReceiptExceptions = can('release_quality_hold') && can('resolve_exceptions');
  const refreshReceiptAuthorityQueues = useCallback(async (): Promise<boolean> => {
    if (mode !== 'supabase' || !supabaseClient || !mayResolveReceiptExceptions) {
      if (mountedRef.current) { setExceptionDecisions([]); setExcessCustodyItems([]); }
      return true;
    }
    const [parentQueue, custodyQueue] = await Promise.all([
      supabaseClient.schema('warehouse').rpc('procurement_receipt_exception_work_items', { payload: {} }),
      supabaseClient.schema('warehouse').rpc('procurement_receipt_excess_work_items', { payload: {} }),
    ]);
    if (!mountedRef.current) return false;
    if (parentQueue.error || custodyQueue.error) {
      setExceptionDecisions([]);
      setExcessCustodyItems([]);
      toast.error(parentQueue.error?.message ?? custodyQueue.error?.message ?? 'Receipt authority readback failed');
      return false;
    }
    {
      const rows = parentQueue.data;
      setExceptionDecisions(((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        decisionId: String(row.decision_id),
        receiptId: String(row.receipt_id),
        purchaseOrderId: String(row.purchase_order_id),
        poNumber: String(row.po_number),
        requestedDisposition: row.requested_disposition as ReceiptExceptionDecisionItem['requestedDisposition'],
        status: row.status as ReceiptExceptionDecisionItem['status'],
        requestedBy: String(row.requested_by),
        requestedAt: String(row.requested_at),
        reason: String(row.reason ?? ''),
        lines: ((row.lines ?? []) as ReceiptExceptionDecisionItem['lines']),
      })));
    }
    {
      const rows = custodyQueue.data;
      setExcessCustodyItems(((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        custodyId: String(row.custody_id),
        receiptId: String(row.receipt_id),
        purchaseOrderId: String(row.purchase_order_id),
        poLineId: String(row.po_line_id),
        poNumber: String(row.po_number),
        productName: row.product_name ? String(row.product_name) : undefined,
        orderedQuantity: Number(row.ordered_quantity),
        excessQuantity: Number(row.excess_quantity),
        status: row.status as ExcessCustodyWorkItem['status'],
        eligibleApprovedAmendments: ((row.eligible_approved_amendments ?? []) as Array<Record<string, unknown>>).map((amendment) => ({
          id: String(amendment.id),
          previousQuantity: Number(amendment.previousQuantity),
          amendedQuantity: Number(amendment.amendedQuantity),
          approvedAt: String(amendment.approvedAt),
        })),
      })));
    }
    return true;
  }, [mayResolveReceiptExceptions, mode, supabaseClient, toast]);

  useEffect(() => {
    void refreshReceiptAuthorityQueues();
  }, [refreshReceiptAuthorityQueues]);

  const decideReceiptException = async (input: ReceiptExceptionDecisionInput) => {
    if (!supabaseClient) return false;
    const { error: rpcError } = await supabaseClient.schema('warehouse').rpc('resolve_procurement_po_exception', {
      payload: {
        idempotency_key: crypto.randomUUID(),
        decision_id: input.decisionId,
        decision: input.decision,
        reason: input.reason,
        evidence_urls: input.evidenceUrls,
        identifications: input.identifications?.map((identification) => ({
          po_line_id: identification.poLineId,
          product_id: identification.productId,
        })) ?? [],
      },
    });
    if (rpcError) { toast.error(rpcError.message); return false; }
    // Reconcile both receipt authority queues after either resolver; parent and custody
    // lifecycle transitions can make the other queue stale in the same transaction.
    if (!await refreshReceiptAuthorityQueues()) return false;
    toast.success(input.decision === 'escalate'
      ? 'Receipt remains actionable in the escalated queue'
      : 'Controlled receipt decision recorded');
    return true;
  };

  const decideExcessCustody = async (input: ExcessCustodyDecisionInput) => {
    if (!supabaseClient) return false;
    const { error: rpcError } = await supabaseClient.schema('warehouse').rpc('resolve_procurement_receipt_excess', {
      payload: {
        idempotency_key: crypto.randomUUID(), custody_id: input.custodyId,
        outcome: input.outcome, approved_amendment_id: input.approvedAmendmentId ?? null,
        reason: input.reason, evidence_urls: input.evidenceUrls,
      },
    });
    if (rpcError) { toast.error(rpcError.message); return false; }
    if (!await refreshReceiptAuthorityQueues()) return false;
    toast.success('Excess custody disposition recorded');
    return true;
  };

  useEffect(() => {
    if (!handoffPoId || openedHandoffRef.current === handoffPoId) return;
    const handoff = bridgedPOs.find((po) => po.id === handoffPoId);
    if (!handoff) return;
    openedHandoffRef.current = handoffPoId;
    setBridgeReceivePO(handoff);
    setBridgeLocation(warehouses[0]?.id ?? '');
    setBridgeBin('');
    setBridgeEvidence('');
    setBridgeDisposition('clean');
    setBridgeExceptionReason('');
    setBridgeProducts(Object.fromEntries(handoff.lines.map((line) => [line.id, line.productId ?? ''])));
    setBridgeObservedDescriptions(Object.fromEntries(handoff.lines.map((line) => [line.id, line.description])));
    setBridgeObservedIdentifiers({});
    setBridgeQty(Object.fromEntries(handoff.lines.map((line) => [
      line.id, Math.max(0, line.quantity - line.receivedQuantity),
    ])));
  }, [bridgedPOs, handoffPoId, warehouses]);

  const poNumbers = useMemo(
    () => poNumberMap(data?.purchaseOrders ?? []),
    [data],
  );

  if (!data) return null;
  // Live Warehouse consumes the governed Procurement handoff only. Seeded
  // Warehouse-origin POs remain available solely in memory-mode demonstrations.
  const warehousePOs = source === 'memory' ? data.purchaseOrders : [];
  const supplierName = (id: string) => data.suppliers.find((s) => s.id === id)?.name ?? id;
  const productName = (id: string) => data.products.find((p) => p.id === id)?.name ?? id;
  const poNo = (po: PurchaseOrder) => poNumbers.get(po.id) ?? po.id;

  const isOpenPO = (po: PurchaseOrder) =>
    po.status !== 'received' && po.status !== 'cancelled';
  const isReceivable = (po: PurchaseOrder) =>
    // A draft was never ordered — receiving against it would fake supply
    // (WH-25). Receivable = ordered or partially received.
    po.status === 'ordered' || po.status === 'partially_received';
  const openCount = warehousePOs.filter(isOpenPO).length;
  const openValue = warehousePOs
    .filter(isOpenPO)
    .reduce((s, po) => s + poValue(po, data.products), 0);
  const shownPOs = warehousePOs
    .slice()
    .sort((a, b) => Number(isOpenPO(b)) - Number(isOpenPO(a)))
    .filter((po) =>
      filter === 'all' ? true : filter === 'open' ? isOpenPO(po) : !isOpenPO(po),
    );
  // Bridged procurement POs are by definition open (issued/approved).
  const shownBridged: BridgedPO[] = filter === 'closed' ? [] : bridgedPOs;

  const detailPO = detailPOId
    ? warehousePOs.find((po) => po.id === detailPOId) ?? null
    : null;

  const openReceive = (po: PurchaseOrder) => {
    setDetailPOId(null);
    setReceivePO(po);
    setReceiveLoc(warehouses[0]?.id ?? '');
    setReceiveBin('');
    setReceiveQty(
      Object.fromEntries(
        po.lines.map((l) => [l.productId, Math.max(0, l.quantityOrdered - l.quantityReceived)]),
      ),
    );
  };

  const submitReceive = async () => {
    if (!receivePO || !receiveLoc) return;
    const lines = receivePO.lines
      .map((l) => ({ productId: l.productId, quantityReceived: receiveQty[l.productId] ?? 0 }))
      .filter((l) => l.quantityReceived > 0);
    if (lines.length === 0) return;
    const ok = await receiveAgainstPO({
      poId: receivePO.id,
      lines,
      locationId: receiveLoc,
      binId: receiveBin || undefined,
    });
    if (!ok) return;
    toast.success('Received against PO into inspection staging');
    setReceivePO(null);
  };

  const cancel = async (po: PurchaseOrder) => {
    const ok = await cancelPurchaseOrder({ poId: po.id });
    if (!ok) return;
    setConfirmCancel(false);
    setDetailPOId(null);
    toast.success('Purchase order cancelled');
  };

  const openBridgeReceive = (po: BridgedPO) => {
    setBridgeReceivePO(po);
    setBridgeLocation(warehouses[0]?.id ?? '');
    setBridgeBin('');
    setBridgeEvidence('');
    setBridgeDisposition('clean');
    setBridgeExceptionReason('');
    setBridgeProducts(Object.fromEntries(po.lines.map((line) => [line.id, line.productId ?? ''])));
    setBridgeObservedDescriptions(Object.fromEntries(po.lines.map((line) => [line.id, line.description])));
    setBridgeObservedIdentifiers({});
    setBridgeQty(Object.fromEntries(po.lines.map((line) => [
      line.id, Math.max(0, line.quantity - line.receivedQuantity),
    ])));
  };

  const submitBridgeReceive = async () => {
    if (!bridgeReceivePO || !bridgeLocation || !bridgeEvidence.trim()) return;
    const lines = bridgeReceivePO.lines
      .map((line) => ({
        lineId: line.id,
        productId: bridgeProducts[line.id] ?? '',
        quantity: bridgeQty[line.id] ?? 0,
      }))
      .filter((line) => line.quantity > 0 && (bridgeDisposition === 'unidentified' || line.productId));
    if (lines.length === 0) return;
    const idempotencyKey = crypto.randomUUID();
    if (bridgeDisposition === 'clean') {
      const ok = await receiveProcurementPO({ idempotencyKey, poId: bridgeReceivePO.id,
        locationId: bridgeLocation, binId: bridgeBin || undefined, lines,
        evidenceUrls: [bridgeEvidence.trim()] });
      if (!ok) return;
      toast.success('Procurement PO received into inspection staging');
    } else {
      if (mode !== 'supabase' || !supabaseClient) {
        toast.error('Exception receipts require the connected Warehouse authority.');
        return;
      }
      const { error: rpcError } = await supabaseClient.schema('warehouse').rpc('receive_procurement_po_exception', { payload: {
        idempotency_key: idempotencyKey, po_id: bridgeReceivePO.id, location_id: bridgeLocation,
        lines: lines.map((line) => {
          const source = bridgeReceivePO.lines.find((candidate) => candidate.id === line.lineId)!;
          return { line_id: line.lineId,
            product_id: bridgeDisposition === 'unidentified' ? null : line.productId,
            actual_quantity: line.quantity,
            expected_quantity: Math.max(0, source.quantity - source.receivedQuantity),
            raw_description: bridgeDisposition === 'unidentified'
              ? bridgeObservedDescriptions[line.lineId]?.trim()
              : source.description,
            observed_identifiers: bridgeDisposition === 'unidentified'
              ? { operator_entry: bridgeObservedIdentifiers[line.lineId]?.trim() ?? '' }
              : {},
            bin_id: bridgeBin || null };
        }),
        evidence_urls: [bridgeEvidence.trim()], exception_type: bridgeDisposition,
        reason: bridgeExceptionReason.trim(),
      } });
      if (rpcError) { toast.error(rpcError.message); return; }
      toast.success('Receipt exception sent to the Supervisor queue');
    }
    setBridgeReceivePO(null);
    setBridgeReload((value) => value + 1);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Orders"
        icon="cart"
        subtitle={canManagePOs ? 'Supplier sourcing & receiving' : 'Receive incoming supplier orders'}
        action={
          canManagePOs ? (
            <a href="/procurement/requests" className="btn-primary btn-sm">
              <Icon name="cart" className="h-4 w-4" /> Open Procurement requests
            </a>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="font-semibold">Receive and inspect</p><p className="text-xs opacity-80">Clean accepted stock continues to putaway; shortages, damage, rejection, and quarantine create Supervisor exceptions.</p></div>
        {canOpenRoute('quality') && (
          <Link to="/quality" className="btn-ghost btn-sm shrink-0 justify-center">Open quality queue</Link>
        )}
      </div>

      {mayResolveReceiptExceptions && (
        <>
          <ReceiptExceptionDecisionPanel items={exceptionDecisions} products={data.products} onDecision={decideReceiptException} />
          <ExcessCustodyDecisionPanel items={excessCustodyItems} onDecision={decideExcessCustody} />
        </>
      )}

      {warehousePOs.length === 0 && bridgedPOs.length === 0 ? (
        <EmptyState
          icon="cart"
          title="No purchase orders"
          message={
            canManagePOs
              ? 'Approved Procurement POs appear here for controlled receiving.'
              : 'When procurement raises a PO it will appear here to receive against.'
          }
          action={
            canManagePOs ? (
              <a href="/procurement/requests" className="btn-primary">
                <Icon name="cart" className="h-4 w-4" /> Open Procurement requests
              </a>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-full sm:w-72">
              <SegmentedControl<POFilter>
                ariaLabel="PO status filter"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'open', label: 'Open' },
                  { value: 'closed', label: 'Closed' },
                ]}
              />
            </div>
            <p className="text-xs text-faint">
              <span className="font-semibold text-brand-700 dark:text-brand-300">
                {openCount}
              </span>{' '}
              open • {money(openValue)} on order
              {bridgedPOs.length > 0 && (
                <> • {bridgedPOs.length} from procurement</>
              )}
            </p>
          </div>
          {shownPOs.length === 0 && shownBridged.length === 0 ? (
            <EmptyState icon="cart" title={`No ${filter} purchase orders`} />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2" aria-label="Purchase orders">
              {shownPOs.map((po) => (
                <li key={po.id}>
                  <button
                    type="button"
                    onClick={() => setDetailPOId(po.id)}
                    className="card block w-full space-y-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-e3 sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">
                          {poNo(po)} · {supplierName(po.supplierId)}
                        </p>
                        <p className="text-xs text-faint">{formatWhen(po.createdAt)}</p>
                      </div>
                      <Badge tone={STATUS_TONE[po.status]}>
                        {PO_STATUS_LABELS[po.status]}
                      </Badge>
                    </div>
                    <BarRow
                      label={`Received ${poTotalReceived(po)} / ${poTotalOrdered(po)}`}
                      value={poProgress(po)}
                      max={100}
                      suffix="%"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted">
                        {po.lines.length} line(s) • {money(poValue(po, data.products))}
                      </span>
                      <span aria-hidden className="text-faint">
                        <Icon name="chevron" className="h-4 w-4" />
                      </span>
                    </div>
                  </button>
                </li>
              ))}

              {/* Procurement-issued POs (read-only bridge, J1-6). */}
              {shownBridged.map((po) => {
                const pct =
                  po.totalOrdered > 0
                    ? Math.round((po.totalReceived / po.totalOrdered) * 100)
                    : 0;
                return (
                  <li key={`bridged-${po.id}`}>
                    <Card className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <a
                            href={po.href}
                            className="truncate font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
                            title="Open in procurement"
                          >
                            {po.poNumber}
                          </a>
                          <p className="truncate text-sm text-ink">{po.vendorName}</p>
                          <p className="text-xs text-faint">
                            {po.expectedDate
                              ? `Expected ${formatDate(po.expectedDate)}`
                              : formatWhen(po.createdAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge tone="cyan">From Procurement</Badge>
                          <Badge tone={po.status === 'issued' ? 'brand' : 'emerald'}>
                            {po.totalReceived > 0
                              ? 'Partially received'
                              : (PO_STATUS_LABELS[po.status as POStatus] ?? po.status)}
                          </Badge>
                        </div>
                      </div>
                      <BarRow
                        label={`Received ${po.totalReceived} / ${po.totalOrdered}`}
                        value={pct}
                        max={100}
                        suffix="%"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted">
                          {po.lines.length} line(s) • {money(po.value)}
                        </span>
                        {canReceive && po.status === 'issued' ? (
                          <button
                            type="button"
                            className="btn-accent btn-sm shrink-0"
                            onClick={() => openBridgeReceive(po)}
                          >
                            <Icon name="truck" className="h-4 w-4" /> Receive and inspect
                          </button>
                        ) : (
                          <span className="text-xs font-medium text-faint">Warehouse handoff status</span>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* PO detail sheet — the row's single target; actions live here. */}
      <Sheet
        open={detailPO !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDetailPOId(null);
            setConfirmCancel(false);
          }
        }}
        title={detailPO ? `${poNo(detailPO)} · ${supplierName(detailPO.supplierId)}` : 'Purchase order'}
        description={detailPO ? `Created ${formatDate(detailPO.createdAt)}` : undefined}
        footer={
          detailPO && (canReceive || canManagePOs) && isOpenPO(detailPO) ? (
            <div className="flex gap-2">
              {canManagePOs && !confirmCancel && (
                <button
                  type="button"
                  className="btn-ghost flex-1 justify-center"
                  onClick={() => setConfirmCancel(true)}
                >
                  Cancel PO
                </button>
              )}
              {canReceive && isReceivable(detailPO) && !confirmCancel && (
                <button
                  type="button"
                  className="btn-primary flex-1 justify-center"
                  onClick={() => openReceive(detailPO)}
                >
                  <Icon name="truck" className="h-4 w-4" /> Receive and inspect
                </button>
              )}
              {confirmCancel && (
                <>
                  <button
                    type="button"
                    className="btn-ghost flex-1 justify-center"
                    onClick={() => setConfirmCancel(false)}
                  >
                    Keep PO
                  </button>
                  <button
                    type="button"
                    className="btn-primary flex-1 justify-center bg-rose-600 hover:bg-rose-700"
                    onClick={() => detailPO && void cancel(detailPO)}
                  >
                    Confirm cancel
                  </button>
                </>
              )}
            </div>
          ) : undefined
        }
      >
        {detailPO && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge tone={STATUS_TONE[detailPO.status]}>
                {PO_STATUS_LABELS[detailPO.status]}
              </Badge>
              <span className="text-sm font-semibold text-ink">
                {money(poValue(detailPO, data.products))}
              </span>
            </div>
            {detailPO.status === 'draft' && (
              <p className="rounded-xl bg-inset px-3 py-2 text-xs text-muted">
                Draft — not yet ordered from the supplier. Receiving unlocks
                once the PO is ordered.
              </p>
            )}
            <ul className="space-y-2" aria-label="PO lines">
              {detailPO.lines.map((l) => (
                <li
                  key={l.productId}
                  className="flex items-center justify-between gap-3 rounded-xl bg-inset p-3"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-ink">
                    {productName(l.productId)}
                  </span>
                  <span className="shrink-0 text-xs text-faint">
                    {l.quantityReceived}/{l.quantityOrdered} received
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Sheet>

      {/* Receive against PO sheet */}
      <Sheet
        open={receivePO !== null}
        onOpenChange={(o) => !o && setReceivePO(null)}
        title="Receive against PO"
        description={
          receivePO ? `${poNo(receivePO)} · ${supplierName(receivePO.supplierId)}` : undefined
        }
        footer={
          <button type="button" className="btn-primary w-full" onClick={() => void submitReceive()}>
            Confirm receipt
          </button>
        }
      >
        {receivePO && (
          <div className="space-y-3">
            <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200">
              Inspection required. Choose a receiving-staging location; accepted stock moves to putaway after review.
            </p>
            <Field label="Receive into" htmlFor="po-rcv-loc">
              <select
                id="po-rcv-loc"
                className="input"
                value={receiveLoc}
                onChange={(e) => {
                  setReceiveLoc(e.target.value);
                  setReceiveBin('');
                }}
              >
                {warehouses.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            {(() => {
              const bins = (data.storageAreas ?? []).filter(
                (b) => b.locationId === receiveLoc,
              );
              if (bins.length === 0) return null;
              return (
                <Field
                  label="Receiving staging bin"
                  htmlFor="po-rcv-bin"
                  hint="Optional — pick the bin/shelf this stock is stored in."
                >
                  <select
                    id="po-rcv-bin"
                    className="input"
                    value={receiveBin}
                    onChange={(e) => setReceiveBin(e.target.value)}
                  >
                    <option value="">General area (unassigned)</option>
                    {bins.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code}
                        {b.label ? ` · ${b.label}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })()}
            <ul className="space-y-2">
              {receivePO.lines.map((l) => {
                const outstanding = l.quantityOrdered - l.quantityReceived;
                return (
                  <li key={l.productId} className="rounded-xl bg-inset p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">
                        {productName(l.productId)}
                      </span>
                      <span className="text-xs text-faint">
                        {l.quantityReceived}/{l.quantityOrdered} · {outstanding} left
                      </span>
                    </div>
                    <QuantityStepper
                      aria-label={`Receive ${productName(l.productId)}`}
                      min={0}
                      max={outstanding}
                      value={receiveQty[l.productId] ?? 0}
                      onChange={(v) =>
                        setReceiveQty((prev) => ({ ...prev, [l.productId]: v }))
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Sheet>

      <Sheet
        open={bridgeReceivePO !== null}
        onOpenChange={(open) => !open && setBridgeReceivePO(null)}
        title="Receive approved procurement PO"
        description={bridgeReceivePO?.poNumber}
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            disabled={!bridgeLocation || !bridgeEvidence.trim()}
            onClick={() => void submitBridgeReceive()}
          >
            Confirm governed receipt
          </button>
        }
      >
        {bridgeReceivePO && (
          <div className="space-y-3">
            <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200">
              Inspection required before putaway or allocation.
            </p>
            <SegmentedControl<ReceiptDisposition>
              ariaLabel="Receipt disposition" value={bridgeDisposition} onChange={setBridgeDisposition}
              options={[
                { value: 'clean', label: 'Clean receipt' },
                { value: 'short', label: 'Short' },
                { value: 'excess', label: 'Excess' },
                { value: 'damaged', label: 'Damaged' },
                { value: 'unidentified', label: 'Unidentified' },
              ]}
            />
            <Field label="Receive into" htmlFor="bridge-receive-location">
              <select
                id="bridge-receive-location"
                className="input"
                value={bridgeLocation}
                onChange={(event) => {
                  setBridgeLocation(event.target.value);
                  setBridgeBin('');
                }}
              >
                {warehouses.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Receiving staging bin" htmlFor="bridge-receive-bin">
              <select
                id="bridge-receive-bin"
                className="input"
                value={bridgeBin}
                onChange={(event) => setBridgeBin(event.target.value)}
              >
                <option value="">General area</option>
                {data.storageAreas
                  .filter((bin) => bin.locationId === bridgeLocation && bin.active !== false)
                  .map((bin) => <option key={bin.id} value={bin.id}>{bin.code}</option>)}
              </select>
            </Field>
            <Field label="Delivery evidence URL" htmlFor="bridge-receive-evidence">
              <input
                id="bridge-receive-evidence"
                className="input"
                value={bridgeEvidence}
                onChange={(event) => setBridgeEvidence(event.target.value)}
                placeholder="evidence/delivery-note.jpg"
              />
            </Field>
            {bridgeDisposition !== 'clean' && (
              <Field label="Exception reason" htmlFor="bridge-exception-reason">
                <textarea id="bridge-exception-reason" className="input" rows={3}
                  value={bridgeExceptionReason} onChange={(event) => setBridgeExceptionReason(event.target.value)} />
              </Field>
            )}
            <ul className="space-y-3" aria-label="Procurement PO receipt lines">
              {bridgeReceivePO.lines.map((line) => {
                const remaining = line.quantity - line.receivedQuantity;
                return (
                  <li key={line.id} className="space-y-2 rounded-xl bg-inset p-3">
                    <p className="text-sm font-medium text-ink">{line.description}</p>
                    {bridgeDisposition === 'unidentified' ? (
                      <>
                        <Field label={`Observed description for ${line.description}`} htmlFor={`observed-description-${line.id}`}>
                          <input
                            id={`observed-description-${line.id}`}
                            className="input"
                            value={bridgeObservedDescriptions[line.id] ?? ''}
                            onChange={(event) => setBridgeObservedDescriptions((current) => ({
                              ...current, [line.id]: event.target.value,
                            }))}
                          />
                        </Field>
                        <Field label={`Observed identifiers for ${line.description}`} htmlFor={`observed-identifiers-${line.id}`}>
                          <input
                            id={`observed-identifiers-${line.id}`}
                            className="input"
                            value={bridgeObservedIdentifiers[line.id] ?? ''}
                            onChange={(event) => setBridgeObservedIdentifiers((current) => ({
                              ...current, [line.id]: event.target.value,
                            }))}
                          />
                        </Field>
                      </>
                    ) : (
                      <ProductSelect
                        aria-label={`Map ${line.description}`}
                        products={data.products}
                        value={bridgeProducts[line.id] ?? ''}
                        onChange={(productId) => setBridgeProducts((current) => ({
                          ...current,
                          [line.id]: productId,
                        }))}
                        placeholder="Map to Warehouse product"
                      />
                    )}
                    <QuantityStepper
                      aria-label={`Receive ${line.description}`}
                      min={0}
                      max={bridgeDisposition === 'excess' ? undefined : remaining}
                      value={bridgeQty[line.id] ?? 0}
                      onChange={(quantity) => setBridgeQty((current) => ({
                        ...current,
                        [line.id]: quantity,
                      }))}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Sheet>
    </div>
  );
}
