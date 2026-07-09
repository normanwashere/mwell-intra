import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import { can } from '@/auth/roles';
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

type POFilter = 'all' | 'open' | 'closed';

const STATUS_TONE: Record<POStatus, Tone> = {
  draft: 'slate',
  ordered: 'brand',
  partially_received: 'amber',
  received: 'emerald',
  cancelled: 'rose',
};

interface DraftLine {
  productId: string;
  quantityOrdered: number;
}

export function PurchaseOrdersPage() {
  const { data, role, createPurchaseOrder, receiveAgainstPO, cancelPurchaseOrder } =
    useWarehouse();
  const toast = useToast();
  const navigate = useNavigate();
  // Procurement plans & cancels POs; the warehouse (receive_stock) can receive
  // against them. Either capability lands here via the route guard.
  const canManagePOs = can(role, 'view_procurement');
  const canReceive = canManagePOs || can(role, 'receive_stock');

  // Procurement-module POs (issued/approved) read from their localStorage
  // contract — read-only visibility across the module seam (J1-6).
  const bridgedPOs = useProcurementPOs();

  const [createOpen, setCreateOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [lineProduct, setLineProduct] = useState('');
  const [lineQty, setLineQty] = useState(10);

  // Row-as-target (WH-27): tapping a PO opens its detail sheet; Receive and
  // Cancel live INSIDE the sheet instead of repeating on every card.
  const [detailPOId, setDetailPOId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [receiveLoc, setReceiveLoc] = useState('');
  const [receiveBin, setReceiveBin] = useState('');
  const [filter, setFilter] = useState<POFilter>('all');

  const poNumbers = useMemo(
    () => poNumberMap(data?.purchaseOrders ?? []),
    [data],
  );

  if (!data) return null;
  const supplierName = (id: string) => data.suppliers.find((s) => s.id === id)?.name ?? id;
  const productName = (id: string) => data.products.find((p) => p.id === id)?.name ?? id;
  const warehouses = data.locations.filter((l) => l.type === 'warehouse');
  const poNo = (po: PurchaseOrder) => poNumbers.get(po.id) ?? po.id;

  const isOpenPO = (po: PurchaseOrder) =>
    po.status !== 'received' && po.status !== 'cancelled';
  const isReceivable = (po: PurchaseOrder) =>
    // A draft was never ordered — receiving against it would fake supply
    // (WH-25). Receivable = ordered or partially received.
    po.status === 'ordered' || po.status === 'partially_received';
  const openCount = data.purchaseOrders.filter(isOpenPO).length;
  const openValue = data.purchaseOrders
    .filter(isOpenPO)
    .reduce((s, po) => s + poValue(po, data.products), 0);
  const shownPOs = data.purchaseOrders
    .slice()
    .sort((a, b) => Number(isOpenPO(b)) - Number(isOpenPO(a)))
    .filter((po) =>
      filter === 'all' ? true : filter === 'open' ? isOpenPO(po) : !isOpenPO(po),
    );
  // Bridged procurement POs are by definition open (issued/approved).
  const shownBridged: BridgedPO[] = filter === 'closed' ? [] : bridgedPOs;

  const detailPO = detailPOId
    ? data.purchaseOrders.find((po) => po.id === detailPOId) ?? null
    : null;

  const addDraftLine = () => {
    if (!lineProduct) return;
    setDraftLines((prev) => {
      if (prev.some((l) => l.productId === lineProduct)) return prev;
      return [...prev, { productId: lineProduct, quantityOrdered: lineQty }];
    });
    setLineProduct('');
    setLineQty(10);
  };

  const submitCreate = async () => {
    const supplier = supplierId || data.suppliers[0]?.id;
    if (!supplier) {
      toast.error('Add a supplier first.');
      return;
    }
    if (draftLines.length === 0) return;
    const ok = await createPurchaseOrder({ supplierId: supplier, lines: draftLines });
    if (!ok) return;
    toast.success('Purchase order created');
    setCreateOpen(false);
    setDraftLines([]);
    setSupplierId('');
  };

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
    toast.success('Stock received against PO');
    setReceivePO(null);
  };

  const cancel = async (po: PurchaseOrder) => {
    const ok = await cancelPurchaseOrder({ poId: po.id });
    if (!ok) return;
    setConfirmCancel(false);
    setDetailPOId(null);
    toast.success('Purchase order cancelled');
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Orders"
        icon="cart"
        subtitle={canManagePOs ? 'Supplier sourcing & receiving' : 'Receive incoming supplier orders'}
        action={
          canManagePOs ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" className="h-4 w-4" /> New PO
            </button>
          ) : undefined
        }
      />

      {data.purchaseOrders.length === 0 && bridgedPOs.length === 0 ? (
        <EmptyState
          icon="cart"
          title="No purchase orders"
          message={
            canManagePOs
              ? 'Create a PO to plan replenishment with suppliers.'
              : 'When procurement raises a PO it will appear here to receive against.'
          }
          action={
            canManagePOs ? (
              <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                <Icon name="plus" className="h-4 w-4" /> New PO
              </button>
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
                            {PO_STATUS_LABELS[po.status as POStatus] ?? po.status}
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
                        {/* Receiving stays in the module that owns the PO —
                            deep link instead of a half-wired local receive. */}
                        <a href={po.href} className="btn-accent btn-sm shrink-0">
                          <Icon name="truck" className="h-4 w-4" /> Receive in procurement
                        </a>
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
                  <Icon name="truck" className="h-4 w-4" /> Receive
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

      {/* Create PO sheet */}
      <Sheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New purchase order"
        description="Order stock from a supplier."
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            disabled={draftLines.length === 0}
            onClick={() => void submitCreate()}
          >
            Create PO
          </button>
        }
      >
        <div className="space-y-3">
          {data.suppliers.length === 0 ? (
            <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              <p>You need a supplier before raising a PO.</p>
              <button
                type="button"
                className="btn-primary btn-sm mt-2"
                onClick={() => {
                  setCreateOpen(false);
                  navigate('/suppliers');
                }}
              >
                Add a supplier
              </button>
            </div>
          ) : (
            <Field label="Supplier" htmlFor="po-supplier">
              <select
                id="po-supplier"
                className="input"
                value={supplierId || data.suppliers[0]?.id || ''}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="Product" htmlFor="po-line-product">
              <ProductSelect
                id="po-line-product"
                products={data.products}
                value={lineProduct}
                onChange={setLineProduct}
                placeholder="Select…"
              />
            </Field>
            <Field label="Qty" htmlFor="po-line-qty">
              <QuantityStepper
                id="po-line-qty"
                aria-label="Order quantity"
                value={lineQty}
                onChange={setLineQty}
                min={1}
              />
            </Field>
          </div>
          <button type="button" className="btn-ghost w-full" onClick={addDraftLine} disabled={!lineProduct}>
            <Icon name="plus" className="h-4 w-4" /> Add line
          </button>

          {draftLines.length > 0 && (
            <ul className="space-y-2" aria-label="Draft lines">
              {draftLines.map((l) => (
                <li
                  key={l.productId}
                  className="flex items-center justify-between rounded-xl bg-inset p-3 text-sm"
                >
                  <span className="font-medium text-ink">{productName(l.productId)}</span>
                  <span className="text-muted">×{l.quantityOrdered}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
                  label="Put away to"
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
    </div>
  );
}
