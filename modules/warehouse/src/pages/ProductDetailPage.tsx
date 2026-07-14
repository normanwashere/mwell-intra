import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import { WAREHOUSE_MUTATION_CAPABILITIES } from '@/app/authorization';
import { toStockState } from '@/data/repository';
import { availableForProduct } from '@/domain/stock';
import { stockByLocation, validateTransfer } from '@/domain/transfers';
import { stockByBin } from '@/domain/storage';
import { productMovementHistory, unitTimeline } from '@/domain/traceability';
import {
  actorName,
  formatWhen,
  movementTypeLabel,
  signedQuantity,
  statusLabel,
} from '@/domain/format';
import type { InventoryUnit, UnitStatus } from '@/domain/types';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  QuantityStepper,
  SectionTitle,
  Sheet,
  money,
  useToast,
  type Tone,
} from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ProductThumb } from '@/components/ProductThumb';
import { ExpiryBadge } from '@/components/ExpiryStatus';
import { EvidenceGallery } from '@/components/EvidenceGallery';
import { PriceEditorSheet } from '@/components/PriceEditorSheet';
import { ProductEditorSheet } from '@/components/ProductEditorSheet';
import { WarehouseScanFlow } from '@/components/camera/WarehouseScanFlow';

const UNIT_TONE: Record<UnitStatus, Tone> = {
  in_stock: 'emerald',
  allocated: 'amber',
  issued: 'brand',
  returned: 'slate',
  vendor_return: 'rose',
  lost: 'rose',
};

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data, can, transfer, requestStockChange, relocate } = useWarehouse();
  const toast = useToast();

  const [relocateOpen, setRelocateOpen] = useState(false);
  const [relLoc, setRelLoc] = useState('');
  const [relFrom, setRelFrom] = useState('');
  const [relTo, setRelTo] = useState('');
  const [relQty, setRelQty] = useState(1);
  const [relErr, setRelErr] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [fromLoc, setFromLoc] = useState('');
  const [toLoc, setToLoc] = useState('');
  const [fromBin, setFromBin] = useState('');
  const [toBin, setToBin] = useState('');
  const [qty, setQty] = useState(1);
  const [tErr, setTErr] = useState<string | null>(null);
  const [transferSerials, setTransferSerials] = useState<string[]>([]);
  const [timelineSerial, setTimelineSerial] = useState<string | null>(null);
  const [unitQuery, setUnitQuery] = useState('');
  const [priceOpen, setPriceOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjDir, setAdjDir] = useState<'add' | 'remove'>('remove');
  const [adjQty, setAdjQty] = useState(1);
  const [adjReason, setAdjReason] = useState('');
  const [adjLoc, setAdjLoc] = useState('');
  const [adjBin, setAdjBin] = useState('');
  const [adjErr, setAdjErr] = useState<string | null>(null);

  const product = data?.products.find((p) => p.id === id);

  const locations = useMemo(
    () => (data && product ? stockByLocation(toStockState(data), product.id) : []),
    [data, product],
  );

  if (!data) return null;
  if (!product) {
    return (
      <EmptyState
        icon="search"
        title="Product not found"
        message="It may have been removed."
        action={
          <button type="button" className="btn-ghost" onClick={() => navigate('/inventory')}>
            Back to inventory
          </button>
        }
      />
    );
  }

  const state = toStockState(data);
  const available = availableForProduct(state, product.id);
  const allUnits = data.units.filter((u) => u.productId === product.id);
  const locationName = (lid: string) =>
    data.locations.find((l) => l.id === lid)?.name ?? lid;
  const uq = unitQuery.trim().toLowerCase();
  const units = uq
    ? allUnits.filter(
        (u) =>
          u.serialNumber.toLowerCase().includes(uq) ||
          u.status.toLowerCase().includes(uq) ||
          locationName(u.locationId).toLowerCase().includes(uq) ||
          (u.assignedTo ?? '').toLowerCase().includes(uq),
      )
    : allUnits;
  const history = productMovementHistory(data.movements, product.id);
  const canTransfer = can('transfer_stock');
  const canSetPrice = can('set_pricing');
  const canManageProducts = can('manage_products');
  const canAdjust = can('manage_inventory');
  const canViewFinancials =
    can('view_finance') || can('view_pricing') || can('view_procurement');
  const canRelocate = can(WAREHOUSE_MUTATION_CAPABILITIES.relocate);
  const warehouseIds = new Set(
    data.locations.filter((l) => l.type === 'warehouse').map((l) => l.id),
  );
  const binLabel = (binId?: string) =>
    binId
      ? data.storageAreas.find((b) => b.id === binId)?.code ?? binId
      : 'General area';
  // Bins available for relocation at the chosen warehouse.
  const relBins = data.storageAreas.filter((b) => b.locationId === relLoc);
  // Storage areas at a location (for transfer/adjust bin scoping).
  const binsAt = (locationId: string) =>
    data.storageAreas.filter((b) => b.locationId === locationId);
  // Bin holding the most stock for this product at a location (default source).
  const topBinAt = (locationId: string): string => {
    if (!locationId) return '';
    const byBin = stockByBin(state, product.id, locationId)
      .slice()
      .sort((a, b) => b.quantity - a.quantity);
    return byBin[0]?.binId ?? '';
  };

  const openAdjust = () => {
    const loc = locations[0]?.locationId ?? data.locations[0]?.id ?? '';
    setAdjDir('remove');
    setAdjQty(1);
    setAdjReason('');
    setAdjLoc(loc);
    setAdjBin(topBinAt(loc));
    setAdjErr(null);
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    setAdjErr(null);
    if (!adjLoc) {
      setAdjErr('Choose a location.');
      return;
    }
    if (!adjReason.trim()) {
      setAdjErr('A reason is required.');
      return;
    }
    if (adjQty < 1) {
      setAdjErr('Quantity must be at least 1.');
      return;
    }
    const delta = adjDir === 'add' ? adjQty : -adjQty;
    const ok = await requestStockChange({
      idempotencyKey: `stock-change-${crypto.randomUUID()}`,
      sourceType: adjDir === 'remove' ? 'write_off' : 'adjustment',
      productId: product.id,
      locationId: adjLoc,
      binId: adjBin || undefined,
      quantityDelta: delta,
      reason: adjReason.trim(),
    });
    if (!ok) return;
    toast.success('Stock-change request submitted for independent approval');
    setAdjustOpen(false);
  };

  const openTransfer = () => {
    const from = locations[0]?.locationId ?? data.locations[0]?.id ?? '';
    setFromLoc(from);
    setFromBin(topBinAt(from));
    setToLoc('');
    setToBin('');
    setQty(1);
    setTransferSerials([]);
    setTErr(null);
    setTransferOpen(true);
  };

  const openRelocate = () => {
    const firstWh =
      locations.find((l) => warehouseIds.has(l.locationId))?.locationId ??
      [...warehouseIds][0] ??
      '';
    setRelLoc(firstWh);
    setRelFrom('');
    setRelTo('');
    setRelQty(1);
    setRelErr(null);
    setRelocateOpen(true);
  };

  const submitRelocate = async () => {
    setRelErr(null);
    if (!relLoc) {
      setRelErr('Choose a warehouse.');
      return;
    }
    if ((relFrom || '') === (relTo || '')) {
      setRelErr('Source and destination bins must differ.');
      return;
    }
    const ok = await relocate({
      productId: product.id,
      locationId: relLoc,
      fromBinId: relFrom || undefined,
      toBinId: relTo || undefined,
      quantity: relQty,
    });
    if (!ok) return;
    toast.success(
      `Moved ${relQty}× ${product.name} to ${binLabel(relTo || undefined)}`,
    );
    setRelocateOpen(false);
  };

  const submitTransfer = async () => {
    setTErr(null);
    if (!toLoc) {
      setTErr('Choose a destination.');
      return;
    }
    const result = validateTransfer(state, product.id, fromLoc, toLoc, qty);
    if (!result.ok) {
      setTErr(result.error ?? 'Invalid transfer');
      return;
    }
    // When pulling from a specific source bin, ensure that bin actually holds
    // enough — otherwise the debit would miss and duplicate stock.
    if (fromBin) {
      const inBin = availableForProduct(state, product.id, fromLoc, fromBin);
      if (qty > inBin) {
        setTErr(`Only ${inBin} in ${binLabel(fromBin)} at the source.`);
        return;
      }
    }
    const ok = await transfer({
      productId: product.id,
      fromLocationId: fromLoc,
      toLocationId: toLoc,
      fromBinId: fromBin || undefined,
      toBinId: toBin || undefined,
      quantity: qty,
      serialNumbers: product.serialized ? transferSerials : undefined,
    });
    if (!ok) return;
    toast.success(`Transferred ${qty}× to ${locationName(toLoc)}`);
    setTransferOpen(false);
  };

  const timeline = timelineSerial
    ? unitTimeline(data.movements, timelineSerial, product.id)
    : [];

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"
      >
        <Icon name="chevron" className="h-4 w-4 rotate-180" /> Back
      </button>

      {/* Header */}
      <div className="hero-surface relative overflow-hidden rounded-3xl p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-3xl bg-gradient-to-b from-brand-500 to-brand-700"
        />
        <div className="relative flex items-start justify-between gap-3 pl-2">
          <div className="flex min-w-0 items-start gap-3">
            <ProductThumb product={product} size="lg" />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-extrabold text-ink sm:text-2xl">{product.name}</h1>
            <p className="font-mono text-sm text-muted">{product.sku}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="chip bg-brand-500/10 text-brand-700 dark:text-brand-300">
                {statusLabel(product.category)}
              </span>
              {product.serialized && (
                <span className="chip bg-inset text-muted">Serialized</span>
              )}
              {Object.entries(product.attributes).map(([k, v]) => (
                <span key={k} className="chip bg-inset text-muted">
                  {k}: {v}
                </span>
              ))}
              {product.promotional && (
                <span className="chip bg-amber-500/15 text-amber-800 dark:text-amber-300">Promo</span>
              )}
              <ExpiryBadge product={product} lots={data.lots} />
            </div>
          </div>
          </div>
          <div className="text-right">
            <p className="tnum font-display text-3xl font-extrabold text-ink">{available}</p>
            <p className="text-xs text-faint">available</p>
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 pl-2">
          {canViewFinancials && (
            <span className="text-sm text-muted">
              Landed {money(product.unitCost)}
            </span>
          )}
          <span className="text-sm text-muted">
            Price {product.price != null ? money(product.price) : '—'}
          </span>
          <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center">
            {canManageProducts && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="btn-accent btn-sm min-h-11 w-full justify-center sm:min-h-0 sm:w-auto"
              >
                <Icon name="box" className="h-4 w-4" /> Edit product
              </button>
            )}
            {canSetPrice && (
              <button
                type="button"
                onClick={() => setPriceOpen(true)}
                className="btn-accent btn-sm min-h-11 w-full justify-center sm:min-h-0 sm:w-auto"
              >
                <Icon name="coins" className="h-4 w-4" /> Set price
              </button>
            )}
            {canTransfer && (
              <button
                type="button"
                onClick={openTransfer}
                className="btn-accent btn-sm min-h-11 w-full justify-center sm:min-h-0 sm:w-auto"
              >
                <Icon name="transfer" className="h-4 w-4" /> Transfer
              </button>
            )}
            {canRelocate && (
              <button
                type="button"
                onClick={openRelocate}
                className="btn-accent btn-sm min-h-11 w-full justify-center sm:min-h-0 sm:w-auto"
              >
                <Icon name="pin" className="h-4 w-4" /> Relocate
              </button>
            )}
            {canAdjust && (
              <button
                type="button"
                onClick={openAdjust}
                className="btn-accent btn-sm min-h-11 w-full justify-center sm:min-h-0 sm:w-auto"
              >
                <Icon name="clipboard" className="h-4 w-4" /> Adjust
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      {/* Stock by location + storage area */}
      <Card>
        <SectionTitle title="Stock by location" subtitle="Where this product is stored" />
        {locations.length === 0 ? (
          <EmptyState icon="pin" title="No stock on hand" />
        ) : (
          <ul className="space-y-2" aria-label="Stock by location">
            {locations.map((l) => {
              const bins = warehouseIds.has(l.locationId)
                ? stockByBin(state, product.id, l.locationId)
                : [];
              const showBins =
                bins.length > 1 || (bins.length === 1 && bins[0]!.binId !== undefined);
              return (
                <li key={l.locationId} className="rounded-xl bg-inset p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <Icon name="pin" className="h-4 w-4 text-faint" />
                      {locationName(l.locationId)}
                    </span>
                    <Badge tone="brand">{l.quantity}</Badge>
                  </div>
                  {showBins && (
                    <ul className="mt-2 space-y-1 border-l border-line pl-3">
                      {bins.map((b) => (
                        <li
                          key={b.binId ?? 'general'}
                          className="flex items-center justify-between text-sm text-muted"
                        >
                          <span className="font-mono">{binLabel(b.binId)}</span>
                          <span className="tabular-nums font-medium text-ink">
                            {b.quantity}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Serialized units */}
      {product.serialized && (
        <Card>
          <SectionTitle
            title="Serialized units"
            subtitle="Tap a unit to trace its history"
            action={
              <Badge tone="slate">
                {uq ? `${units.length}/${allUnits.length}` : allUnits.length}
              </Badge>
            }
          />
          {allUnits.length > 6 && (
            <div className="relative mb-3">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
                <Icon name="search" className="h-4 w-4" />
              </span>
              <input
                className="input pl-10"
                placeholder="Filter by serial, status, site or assignee"
                aria-label="Filter serialized units"
                value={unitQuery}
                onChange={(e) => setUnitQuery(e.target.value)}
              />
            </div>
          )}
          {units.length === 0 ? (
            <EmptyState icon="tag" title={uq ? 'No matching units' : 'No units yet'} />
          ) : (
            <ul className="space-y-2" aria-label="Serialized units">
              {units.slice(0, 30).map((u: InventoryUnit) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setTimelineSerial(u.serialNumber)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl bg-inset p-3 text-left hover:bg-line"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-ink">
                        {u.serialNumber}
                      </p>
                      <p className="text-xs text-faint">
                        {locationName(u.locationId)}
                        {u.assignedTo ? ` • ${u.assignedTo}` : ''}
                      </p>
                    </div>
                    <Badge tone={UNIT_TONE[u.status]}>{statusLabel(u.status)}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {units.length > 30 && (
            <p className="mt-2 text-xs text-faint">Showing 30 of {units.length} units.</p>
          )}
        </Card>
      )}

      {/* Movement history */}
      <Card>
        <SectionTitle title="Movement history" subtitle="Most recent first" />
        {history.length === 0 ? (
          <EmptyState icon="history" title="No movements recorded" />
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-4" aria-label="Movement history">
            {history.slice(0, 20).map((m) => (
              <li key={m.id} className="relative">
                <span className="absolute -left-[1.32rem] top-1 grid h-3 w-3 place-items-center rounded-full bg-brand-500 ring-4 ring-white" />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">
                    <span className="font-semibold text-brand-700 dark:text-brand-300">
                      {movementTypeLabel(m.type)}
                    </span>
                    {m.reason ? ` · ${m.reason}` : ''}
                  </p>
                  <span className="tabular-nums text-sm font-semibold text-ink">
                    {signedQuantity(m.type, m.quantity)}
                  </span>
                </div>
                <p className="text-xs text-faint">
                  {actorName(m.actor)} • {formatWhen(m.createdAt)}
                </p>
                {m.evidenceUrls && m.evidenceUrls.length > 0 && (
                  <div className="mt-1.5">
                    <EvidenceGallery urls={m.evidenceUrls} size="thumb" />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      </div>

      {/* Price editor sheet */}
      <PriceEditorSheet product={product} open={priceOpen} onOpenChange={setPriceOpen} />

      {/* Product master editor sheet */}
      <ProductEditorSheet product={product} open={editOpen} onOpenChange={setEditOpen} />

      {/* Governed stock-change request sheet */}
      <Sheet
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        title="Request stock change"
        description={`Request an adjustment or write-off for ${product.name}.`}
        footer={
          <button type="button" className="btn-primary w-full" onClick={() => void submitAdjust()}>
            Submit for approval
          </button>
        }
      >
        <div className="space-y-3">
          <Field label="Direction" htmlFor="adj-dir">
            <select
              id="adj-dir"
              className="input"
              value={adjDir}
              onChange={(e) => setAdjDir(e.target.value as 'add' | 'remove')}
            >
              <option value="remove">Remove / write off (−)</option>
              {/* Serialized surplus can't be fabricated by a number — it must be
                  received/registered as real units. */}
              {!product.serialized && <option value="add">Add / found (+)</option>}
            </select>
          </Field>
          {product.serialized && (
            <p className="text-xs text-faint">
              Serialized items only support write-offs here. Found units must be
              received/registered individually.
            </p>
          )}
          <Field label="Location" htmlFor="adj-loc">
            <select
              id="adj-loc"
              className="input"
              value={adjLoc}
              onChange={(e) => {
                setAdjLoc(e.target.value);
                setAdjBin(topBinAt(e.target.value));
              }}
            >
              {data.locations
                .filter((l) => l.type !== 'vendor')
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({availableForProduct(state, product.id, l.id)})
                  </option>
                ))}
            </select>
          </Field>
          {binsAt(adjLoc).length > 0 && (
            <Field label="Storage area" htmlFor="adj-bin">
              <select
                id="adj-bin"
                className="input"
                value={adjBin}
                onChange={(e) => setAdjBin(e.target.value)}
              >
                <option value="">General area (unassigned)</option>
                {binsAt(adjLoc).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} ({availableForProduct(state, product.id, adjLoc, b.id)})
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Quantity" htmlFor="adj-qty">
            <QuantityStepper
              id="adj-qty"
              aria-label="Adjustment quantity"
              value={adjQty}
              onChange={setAdjQty}
              min={1}
            />
          </Field>
          <Field label="Reason" htmlFor="adj-reason">
            <input
              id="adj-reason"
              className="input"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="e.g. damaged in storage"
            />
          </Field>
          {adjErr && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
              {adjErr}
            </p>
          )}
        </div>
      </Sheet>

      {/* Transfer sheet */}
      <Sheet
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title="Transfer stock"
        description={`Move ${product.name} between sites.`}
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            disabled={product.serialized && transferSerials.length === 0}
            onClick={() => void submitTransfer()}
          >
            Confirm transfer
          </button>
        }
      >
        <div className="space-y-3">
          <Field label="From" htmlFor="tr-from">
            <select
              id="tr-from"
              className="input"
              value={fromLoc}
              onChange={(e) => {
                setFromLoc(e.target.value);
                setFromBin(topBinAt(e.target.value));
                setTransferSerials([]);
                setQty(1);
              }}
            >
              {data.locations
                .filter((l) => l.type !== 'vendor')
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({availableForProduct(state, product.id, l.id)})
                  </option>
                ))}
            </select>
          </Field>
          {binsAt(fromLoc).length > 0 && (
            <Field label="From bin" htmlFor="tr-from-bin">
              <select
                id="tr-from-bin"
                className="input"
                value={fromBin}
                onChange={(e) => {
                  setFromBin(e.target.value);
                  setTransferSerials([]);
                  setQty(1);
                }}
              >
                <option value="">General area (unassigned)</option>
                {binsAt(fromLoc).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} ({availableForProduct(state, product.id, fromLoc, b.id)})
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="To" htmlFor="tr-to">
            <select
              id="tr-to"
              className="input"
              value={toLoc}
              onChange={(e) => {
                setToLoc(e.target.value);
                setToBin('');
              }}
            >
              <option value="">Select destination…</option>
              {data.locations
                .filter((l) => l.id !== fromLoc)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </Field>
          {toLoc && binsAt(toLoc).length > 0 && (
            <Field label="To bin" htmlFor="tr-to-bin">
              <select
                id="tr-to-bin"
                className="input"
                value={toBin}
                onChange={(e) => setToBin(e.target.value)}
              >
                <option value="">General area (unassigned)</option>
                {binsAt(toLoc).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {product.serialized ? (
            <Field label="Serialized units" hint={`${transferSerials.length} selected`}>
              <WarehouseScanFlow
                key={`${fromLoc}:${fromBin || 'general'}`}
                data={data}
                context="transfer"
                expectedProductId={product.id}
                expectedLocationId={fromLoc}
                expectedBinId={fromBin || null}
                scannedCodes={transferSerials}
                label="Scan transfer serial"
                onResolved={(resolution) => {
                  if (!resolution.serialNumber) return;
                  setTransferSerials((current) => [...current, resolution.serialNumber!]);
                  setQty((current) => current + (transferSerials.length === 0 ? 0 : 1));
                }}
              />
            </Field>
          ) : (
            <Field label="Quantity" htmlFor="tr-qty">
              <QuantityStepper
                id="tr-qty"
                aria-label="Transfer quantity"
                value={qty}
                onChange={setQty}
                min={1}
              />
            </Field>
          )}
          {tErr && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
              {tErr}
            </p>
          )}
        </div>
      </Sheet>

      {/* Relocate (bin-to-bin within a warehouse) sheet */}
      <Sheet
        open={relocateOpen}
        onOpenChange={setRelocateOpen}
        title="Relocate stock"
        description={`Move ${product.name} between storage areas.`}
        footer={
          <button type="button" className="btn-primary w-full" onClick={() => void submitRelocate()}>
            Move stock
          </button>
        }
      >
        <div className="space-y-3">
          {warehouseIds.size > 1 && (
            <Field label="Warehouse" htmlFor="rel-wh">
              <select
                id="rel-wh"
                className="input"
                value={relLoc}
                onChange={(e) => {
                  setRelLoc(e.target.value);
                  setRelFrom('');
                  setRelTo('');
                }}
              >
                {data.locations
                  .filter((l) => warehouseIds.has(l.id))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Field label="From bin" htmlFor="rel-from">
            <select
              id="rel-from"
              className="input"
              value={relFrom}
              onChange={(e) => setRelFrom(e.target.value)}
            >
              <option value="">General area (unassigned)</option>
              {relBins.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                  {b.label ? ` · ${b.label}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="To bin" htmlFor="rel-to">
            <select
              id="rel-to"
              className="input"
              value={relTo}
              onChange={(e) => setRelTo(e.target.value)}
            >
              <option value="">General area (unassigned)</option>
              {relBins.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                  {b.label ? ` · ${b.label}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity" htmlFor="rel-qty">
            <QuantityStepper
              id="rel-qty"
              aria-label="Relocate quantity"
              value={relQty}
              onChange={setRelQty}
              min={1}
            />
          </Field>
          {relBins.length === 0 && (
            <p className="text-sm text-muted">
              No storage areas set up for this warehouse yet. Add bins on the
              Storage areas page first.
            </p>
          )}
          {relErr && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
              {relErr}
            </p>
          )}
        </div>
      </Sheet>

      {/* Unit timeline sheet */}
      <Sheet
        open={timelineSerial !== null}
        onOpenChange={(o) => !o && setTimelineSerial(null)}
        title="Unit traceability"
        description={timelineSerial ?? undefined}
        side="right"
      >
        {timeline.length === 0 ? (
          <EmptyState icon="history" title="No history for this unit" />
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-4">
            {timeline.map((m) => (
              <li key={m.id} className="relative">
                <span className="absolute -left-[1.32rem] top-1 grid h-3 w-3 place-items-center rounded-full bg-accent ring-4 ring-white" />
                <p className="text-sm font-medium text-ink">
                  <span className="font-semibold text-brand-700 dark:text-brand-300">
                    {movementTypeLabel(m.type)}
                  </span>
                  {m.reason ? ` · ${m.reason}` : ''}
                </p>
                <p className="text-xs text-faint">{formatWhen(m.createdAt)}</p>
              </li>
            ))}
          </ol>
        )}
      </Sheet>
    </div>
  );
}
