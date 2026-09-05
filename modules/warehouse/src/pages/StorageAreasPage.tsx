import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { InventoryPosition } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { WAREHOUSE_MUTATION_CAPABILITIES } from '@/app/authorization';
import { toStockState } from '@/data/repository';
import type { StorageArea } from '@/domain/types';
import {
  binContents,
  binsForLocation,
  suggestBinCode,
} from '@/domain/storage';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Sheet,
  useToast,
} from '@/components/ui';
import { Icon } from '@/components/Icon';
import { BarcodeScanner } from '@/components/camera/BarcodeScanner';
import { WarehouseScanFlow } from '@/components/camera/WarehouseScanFlow';
import { knowledgeGuideReturnPath } from '@/lib/knowledgeGuide';
import { loadCompleteControlQueue } from '@/domain/controlQueues';

export function StorageAreasPage() {
  const [searchParams] = useSearchParams();
  const warehouse = useWarehouse();
  const {
    data,
    can,
    createStorageArea,
    updateStorageArea,
    deleteStorageArea,
    relocate,
    loadWarehouseTasks,
    loadQualityInspections,
    loadInventoryPositions,
  } = warehouse;
  const toast = useToast();
  const canManage = can('manage_locations');
  const canPutAway = can(WAREHOUSE_MUTATION_CAPABILITIES.relocate);
  const guideReturnTo = knowledgeGuideReturnPath(searchParams);

  const warehouses = useMemo(
    () => (data?.locations ?? []).filter((l) => l.type === 'warehouse'),
    [data],
  );
  const [warehouseId, setWarehouseId] = useState('');
  const activeWarehouse = warehouseId || warehouses[0]?.id || '';

  const state = useMemo(
    () => (data ? toStockState(data) : { products: [], units: [], stockLevels: [] }),
    [data],
  );

  const bins = useMemo(
    () => binsForLocation(data?.storageAreas ?? [], activeWarehouse),
    [data, activeWarehouse],
  );

  // add / edit sheet
  const [editing, setEditing] = useState<StorageArea | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [zone, setZone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const guideApplied = useRef(false);

  useEffect(() => {
    if (
      guideApplied.current ||
      !canManage ||
      !['setup-start', 'setup-area', 'setup-bin'].includes(
        searchParams.get('guide') ?? '',
      )
    )
      return;
    guideApplied.current = true;
    setEditing(null);
    setCode('');
    setLabel('');
    setZone('');
    setError(null);
    setConfirmDelete(false);
    setOpen(true);
  }, [canManage, searchParams]);

  useEffect(() => {
    if (!open || searchParams.get('guide') !== 'setup-bin') return;
    requestAnimationFrame(() => document.getElementById('sa-code')?.focus());
  }, [open, searchParams]);

  // contents / scan-lookup sheet
  const [viewing, setViewing] = useState<StorageArea | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [putawayOpen, setPutawayOpen] = useState(false);
  const [putawayStock, setPutawayStock] = useState<{
    code: string;
    productId: string;
    serialNumber?: string;
  } | null>(null);
  const [putawayBin, setPutawayBin] = useState<StorageArea | null>(null);
  const [putawayError, setPutawayError] = useState<string | null>(null);
  const [putawayQuantity, setPutawayQuantity] = useState('1');
  const [putawaySaving, setPutawaySaving] = useState(false);
  const putawayInFlight = useRef(false);
  const [discardPutaway, setDiscardPutaway] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [queued, setQueued] = useState(false);
  const command = useRef<{ signature: string; key: string } | null>(null);
  const [positions, setPositions] = useState<InventoryPosition[]>([]);
  const [positionsReady, setPositionsReady] = useState(false);
  const [scanSession, setScanSession] = useState(0);
  const sourceId = searchParams.get('source');
  const [sourceStatus, setSourceStatus] = useState<{ state: 'loading' | 'ready' | 'completed' | 'unavailable'; message: string } | null>(null);
  const appliedSource = useRef<string | null>(null);
  const loaders = useRef({ loadWarehouseTasks, loadQualityInspections, loadInventoryPositions });
  loaders.current = { loadWarehouseTasks, loadQualityInspections, loadInventoryPositions };

  useEffect(() => {
    if (!putawayOpen) return;
    let active = true;
    setPositionsReady(false);
    void loadCompleteControlQueue(loaders.current.loadInventoryPositions).then((rows) => {
      if (active) { setPositions(rows); setPositionsReady(true); }
    }).catch(() => { if (active) setPutawayError('Eligible stock could not be loaded. Close and reopen putaway to retry.'); });
    return () => { active = false; };
  }, [putawayOpen, data]);

  useEffect(() => {
    if (!sourceId) { appliedSource.current = null; setSourceStatus(null); return; }
    if (!data || appliedSource.current === sourceId) return;
    let active = true;
    setSourceStatus({ state: 'loading', message: 'Loading the selected putaway task...' });
    void (async () => {
      const tasks = await loadCompleteControlQueue(loaders.current.loadWarehouseTasks);
      if (!active) return;
      const task = tasks.find((row) => row.type === 'putaway' && (row.sourceId === sourceId || row.id === sourceId));
      if (!canPutAway || !task) throw new Error('The selected putaway task is unavailable or you do not have access.');
      if (task.status === 'completed') {
        setSourceStatus({ state: 'completed', message: `${task.title}: completed.` });
        appliedSource.current = sourceId;
        return;
      }
      if (task.status === 'blocked') throw new Error(`${task.title}: blocked. Resolve its source before putting stock away.`);
      if (task.sourceId.startsWith('staging:')) {
        const identity: unknown = JSON.parse(task.sourceId.slice('staging:'.length));
        if (!Array.isArray(identity) || identity.length !== 2 || identity.some((value) => typeof value !== 'string')) throw new Error('Invalid staging identity. Return to tasks.');
        const [productId, locationId] = identity;
        const product = data.products.find((row) => row.id === productId && !row.serialized);
        const rows = await loadCompleteControlQueue(loaders.current.loadInventoryPositions);
        if (!active) return;
        const remaining = rows.filter((row) => row.productId === productId && row.locationId === locationId && !row.binId).reduce((sum, row) => sum + row.available, 0);
        if (!product || !data.locations.some((row) => row.id === locationId && row.type === 'warehouse') || remaining <= 0) throw new Error('Selected staging stock is completed or unavailable. Return to tasks.');
        setWarehouseId(locationId);
        setPutawayStock({ productId, code: product.sku });
        setPutawayQuantity(String(remaining));
        setPutawayBin(null);
        setPutawayOpen(true);
        setSourceStatus({ state: 'ready', message: `${task.title}: ${remaining} eligible units remaining.` });
        appliedSource.current = sourceId;
        return;
      }
      const unit = data.units.find((row) => row.id === task.sourceId);
      const inspections = unit ? [] : await loadCompleteControlQueue(loaders.current.loadQualityInspections);
      if (!active) return;
      const inspection = inspections.find((row) => row.id === task.sourceId);
      const stockUnit = unit ?? (inspection?.serialNumber ? data.units.find((row) => row.serialNumber === inspection.serialNumber && row.productId === inspection.productId) : undefined);
      if (stockUnit?.binId) {
        setSourceStatus({ state: 'completed', message: `${task.title}: stock is already stored in a bin.` });
        appliedSource.current = sourceId;
        return;
      }
      if ((!unit && inspection?.disposition !== 'accepted') || (stockUnit && stockUnit.status !== 'in_stock')) throw new Error(`${task.title}: source stock is not eligible for putaway.`);
      const productId = stockUnit?.productId ?? inspection?.productId;
      const returnLocations = inspection?.sourceType === 'return'
        ? [...new Set(data.returns.find((row) => row.id === inspection.sourceId)?.lines
          .filter((line) => line.productId === productId && (line.binId ?? '') === (inspection.binId ?? ''))
          .map((line) => line.locationId).filter(Boolean))] : [];
      const locationId = stockUnit?.locationId ?? (inspection?.sourceType === 'receipt'
        ? data.receipts.find((row) => row.id === inspection.sourceId)?.locationId
        : returnLocations.length === 1 ? returnLocations[0] : undefined);
      const product = data.products.find((row) => row.id === productId);
      if (!product || !locationId || (product.serialized && !stockUnit) || inspection?.binId) throw new Error(`${task.title}: exact unbinned stock identity could not be resolved. Return to tasks.`);
      setWarehouseId(locationId);
      setPutawayStock({ productId: product.id, code: stockUnit?.serialNumber ?? product.sku, serialNumber: stockUnit?.serialNumber });
      setPutawayQuantity(String(stockUnit ? 1 : inspection!.quantity));
      setPutawayBin(null);
      setPutawayOpen(true);
      setSourceStatus({ state: 'ready', message: `${task.title}: ${product.name}${stockUnit ? ` / ${stockUnit.serialNumber}` : ` / ${inspection!.quantity} units`}` });
      appliedSource.current = sourceId;
    })().catch((error: unknown) => {
      if (active) { setSourceStatus({ state: 'unavailable', message: error instanceof Error ? error.message : 'The selected putaway task could not be loaded.' }); appliedSource.current = sourceId; }
    });
    return () => { active = false; };
  }, [sourceId, data, canPutAway]);

  if (!data) return null;

  const openAdd = () => {
    setEditing(null);
    setCode('');
    setLabel('');
    setZone('');
    setError(null);
    setConfirmDelete(false);
    setOpen(true);
  };

  const openEdit = (b: StorageArea) => {
    setEditing(b);
    setCode(b.code);
    setLabel(b.label ?? '');
    setZone(b.zone ?? '');
    setError(null);
    setConfirmDelete(false);
    setOpen(true);
  };

  const suggest = () => {
    const wh = warehouses.find((w) => w.id === activeWarehouse);
    setCode(suggestBinCode(wh, label));
  };

  const submit = async () => {
    setError(null);
    if (!code.trim()) {
      setError('A bin code is required.');
      return;
    }
    if (editing) {
      const ok = await updateStorageArea({
        storageAreaId: editing.id,
        code: code.trim(),
        label: label.trim() || undefined,
        zone: zone.trim() || undefined,
      });
      if (!ok) return;
      toast.success(`Updated ${code.trim()}`);
    } else {
      const ok = await createStorageArea({
        locationId: activeWarehouse,
        code: code.trim(),
        label: label.trim() || undefined,
        zone: zone.trim() || undefined,
      });
      if (!ok) return;
      toast.success(`Added ${code.trim()}`);
    }
    setOpen(false);
  };

  const remove = async (b: StorageArea) => {
    const ok = await deleteStorageArea({ storageAreaId: b.id });
    if (!ok) return;
    setOpen(false);
    setEditing(null);
    setConfirmDelete(false);
    toast.success(`Removed ${b.code}`);
  };

  const onScan = (raw: string) => {
    const codeStr = raw.trim().toLowerCase();
    const match = (data?.storageAreas ?? []).find(
      (b) => b.code.toLowerCase() === codeStr || b.id.toLowerCase() === codeStr,
    );
    setScanOpen(false);
    if (!match) {
      toast.error(`No storage area matches "${raw.trim()}".`);
      return;
    }
    if (match.locationId !== activeWarehouse) setWarehouseId(match.locationId);
    setViewing(match);
  };

  const contents = viewing ? binContents(state, viewing.id) : [];

  const openPutaway = () => {
    setPutawayError(null);
    setDiscardPutaway(false);
    setPutawayOpen(true);
  };

  const selectPutawayBin = (raw: string) => {
    const normalized = raw.trim().toLowerCase();
    const match = bins.find(
      (bin) =>
        bin.code.toLowerCase() === normalized || bin.id.toLowerCase() === normalized,
    );
    if (!match || match.active === false) {
      setPutawayBin(null);
      setPutawayError('Scan a destination bin in the selected warehouse.');
      return;
    }
    setPutawayError(null);
    setPutawayBin(match);
  };

  const eligibleQuantity = putawayStock?.serialNumber
    ? (data.units.some((unit) => unit.serialNumber === putawayStock.serialNumber && unit.productId === putawayStock.productId && unit.locationId === activeWarehouse && !unit.binId && unit.status === 'in_stock') ? 1 : 0)
    : positions.filter((row) => row.productId === putawayStock?.productId && row.locationId === activeWarehouse && !row.binId).reduce((sum, row) => sum + row.available, 0);
  const quantity = putawayStock?.serialNumber ? 1 : Number(putawayQuantity);
  const quantityValid = positionsReady && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= eligibleQuantity;
  const closePutaway = () => {
    if (putawayInFlight.current) return;
    if (queued) { setPutawayOpen(false); return; }
    if (putawayStock) setDiscardPutaway(true);
    else setPutawayOpen(false);
  };

  const confirmPutaway = async () => {
    if (putawayInFlight.current || !putawayStock || !putawayBin || (!queued && !quantityValid)) return;
    if (putawayBin.locationId !== activeWarehouse || !bins.some((bin) => bin.id === putawayBin.id && bin.active !== false)) {
      setPutawayError('Scan an active destination bin in the selected warehouse.'); return;
    }
    putawayInFlight.current = true;
    setPutawaySaving(true);
    setUnconfirmed(false);
    setPutawayError(null);
    try {
    const input = {
      productId: putawayStock.productId,
      locationId: activeWarehouse,
      fromBinId: undefined,
      toBinId: putawayBin.id,
      quantity,
      serialNumbers: putawayStock.serialNumber
        ? [putawayStock.serialNumber]
        : undefined,
    };
    const signature = JSON.stringify(input);
    if (!command.current || command.current.signature !== signature) command.current = { signature, key: `putaway-${crypto.randomUUID()}` };
    const ok = await relocate({ ...input, idempotencyKey: command.current.key });
    if (!ok) { const wasQueued = warehouse.lastActionStatus === 'queued'; setQueued((current) => current || wasQueued); setUnconfirmed(true); return; }
    command.current = null;
    setQueued(false);
    toast.success(`Put away ${quantity} unit(s) into ${putawayBin.code}`);
    setPutawayStock(null);
    setPutawayQuantity('1');
    setScanSession((value) => value + 1);
    if (sourceId) {
      try {
      const remaining = await loadCompleteControlQueue(loaders.current.loadWarehouseTasks);
      const pending = remaining.find((row) => row.type === 'putaway' && (row.sourceId === sourceId || row.id === sourceId));
      setSourceStatus(pending && pending.status !== 'completed'
        ? { state: 'ready', message: `${pending.title}: remaining stock is still due. Return to tasks to continue.` }
        : { state: 'completed', message: 'Selected putaway completed.' });
      } catch {
        setSourceStatus({ state: 'unavailable', message: 'Putaway committed. Remaining tasks could not be refreshed; return to tasks to check.' });
      }
      setPutawayOpen(false);
    }
    } catch {
      setPutawayError('Putaway was not acknowledged. Your capture is retained; verify stock before retrying.');
    } finally {
      putawayInFlight.current = false;
      setPutawaySaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Storage areas"
        icon="box"
        subtitle="Scannable bins, shelves & zones"
        action={
          <div className="flex gap-2">
            {canPutAway && (
              <button type="button" className="btn-accent btn-sm" disabled={Boolean(sourceId && (sourceStatus?.state !== 'ready' || !putawayStock))} onClick={openPutaway}>
                <Icon name="pin" /> Put away
              </button>
            )}
            <button
              type="button"
              className="btn-outline btn-sm"
              onClick={() => setScanOpen(true)}
            >
              <Icon name="scan" /> Scan
            </button>
            {canManage && (
              <button type="button" className="btn-primary btn-sm" onClick={openAdd}>
                <Icon name="plus" /> Add bin
              </button>
            )}
          </div>
        }
      />

      {sourceId && <div className="space-y-2 border-b border-line pb-3">
        <p role={sourceStatus?.state === 'unavailable' ? 'alert' : 'status'}>{sourceStatus?.message ?? 'Loading the selected putaway task...'}</p>
        <Link to="/tasks" className="btn-ghost">Back to tasks</Link>
      </div>}

      {warehouses.length > 1 && (
        <Field label="Warehouse" htmlFor="sa-wh">
          <select
            id="sa-wh"
            className="input"
            value={activeWarehouse}
            disabled={putawaySaving || Boolean(putawayStock) || Boolean(sourceId)}
            onChange={(e) => { setWarehouseId(e.target.value); setPutawayBin(null); }}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {bins.length === 0 ? (
        <Card>
          <EmptyState
            icon="pin"
            title="No storage areas yet"
            message={
              canManage
                ? 'Add bins/shelves so you can scan where each order is stored.'
                : 'No bins have been set up for this warehouse yet.'
            }
            action={
              canManage ? (
                <button type="button" className="btn-primary" onClick={openAdd}>
                  <Icon name="plus" /> Add the first bin
                </button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bins.map((b) => {
            const items = binContents(state, b.id);
            const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
            return (
              <Card key={b.id} className="space-y-3 p-4">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setViewing(b)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-base font-bold text-ink">
                        {b.code}
                      </p>
                      {b.label && (
                        <p className="truncate text-sm text-muted">{b.label}</p>
                      )}
                    </div>
                    {b.zone && <Badge tone="slate">{b.zone}</Badge>}
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    {totalUnits > 0 ? (
                      <>
                        <span className="font-semibold text-ink">{totalUnits}</span>{' '}
                        item{totalUnits === 1 ? '' : 's'} across {items.length} SKU
                        {items.length === 1 ? '' : 's'}
                      </>
                    ) : (
                      'Empty'
                    )}
                  </p>
                </button>
                {canManage && (
                  /* Delete moved inside the edit sheet behind a confirm —
                     no permanently visible destructive control (WH-21). */
                  <button
                    type="button"
                    className="btn-ghost btn-sm w-full justify-center"
                    onClick={() => openEdit(b)}
                  >
                    Edit
                  </button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / edit bin */}
      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setConfirmDelete(false);
        }}
        title={editing ? 'Edit storage area' : 'Add storage area'}
        footer={
          <div className="space-y-2">
            <button
              type="button"
              className="btn-primary w-full justify-center"
              onClick={() => void submit()}
            >
              {editing ? 'Save' : 'Add bin'}
            </button>
            {editing &&
              (confirmDelete ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-ghost flex-1 justify-center"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep bin
                  </button>
                  <button
                    type="button"
                    className="btn-outline flex-1 justify-center text-rose-500"
                    onClick={() => editing && void remove(editing)}
                  >
                    Confirm delete
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-ghost w-full justify-center text-rose-500"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon name="x" className="h-4 w-4" /> Delete bin…
                </button>
              ))}
          </div>
        }
      >
        <div className="space-y-3">
          {guideReturnTo && (
            <a
              href={guideReturnTo}
              className="btn-ghost btn-sm w-full justify-center"
            >
              Back to workflow guide
            </a>
          )}
          <Field
            label="Bin code"
            htmlFor="sa-code"
            hint="Printed & stuck on the shelf. Staff scan or type it during putaway."
          >
            <div className="flex gap-2">
              <input
                id="sa-code"
                className="input font-mono"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. PASIG-A-12"
              />
              <button
                type="button"
                className="btn-outline btn-sm shrink-0"
                onClick={suggest}
              >
                Suggest
              </button>
            </div>
          </Field>
          <Field label="Label (optional)" htmlFor="sa-label">
            <input
              id="sa-label"
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Aisle A · Rack 12"
            />
          </Field>
          <Field label="Zone (optional)" htmlFor="sa-zone">
            <input
              id="sa-zone"
              className="input"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="e.g. Devices, Apparel, Cold storage"
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>
      </Sheet>

      {/* Bin contents (scan result) */}
      <Sheet
        open={viewing !== null}
        onOpenChange={(o) => !o && setViewing(null)}
        title={viewing ? `Bin ${viewing.code}` : 'Bin'}
      >
        {viewing && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-inset p-4 text-center">
              <p className="font-mono text-2xl font-bold text-ink">{viewing.code}</p>
              {viewing.label && (
                <p className="mt-1 text-sm text-muted">{viewing.label}</p>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">Stored here</p>
              {contents.length === 0 ? (
                <EmptyState
                  icon="box"
                  title="Empty"
                  message="Nothing is stored in this bin yet. Put stock away here from Receiving or a product's page."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {contents.map((c) => (
                    <li
                      key={c.productId}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {c.productName}
                        </p>
                        <p className="font-mono text-xs text-faint">{c.sku}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-ink">
                        {c.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Sheet>

      {/* Scan-to-putaway */}
      <Sheet
        open={putawayOpen}
        onOpenChange={(next) => { if (!next) closePutaway(); }}
        title="Put away stock"
        description="Scan eligible stock from the general receiving area, then scan its destination bin."
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            disabled={putawaySaving || !putawayStock || !putawayBin || (!queued && !quantityValid)}
            onClick={() => void confirmPutaway()}
          >
            {putawaySaving ? 'Saving putaway...' : 'Confirm putaway'}
          </button>
        }
      >
        <div className="space-y-5">
          {sourceId && <p className="break-words text-sm font-semibold">{sourceStatus?.message}</p>}
          {unconfirmed && <p role="status">{queued ? 'Putaway queued for sync, not yet committed. Capture is retained and locked until committed.' : 'Putaway was not committed. Capture is retained; review the error before retrying.'}</p>}
          {discardPutaway && <div role="alert" className="space-y-2">
            <p>Discard local putaway capture?</p>
            <button className="btn-primary" type="button" onClick={() => setDiscardPutaway(false)}>Keep capturing</button>
            <button className="btn-ghost" type="button" disabled={putawaySaving} onClick={() => { setPutawayStock(null); setPutawayQuantity('1'); setDiscardPutaway(false); setPutawayOpen(false); setScanSession((value) => value + 1); }}>Discard capture</button>
          </div>}
          <Field label="1. Stock identity" hint="Serialized devices require the individual serial.">
            <WarehouseScanFlow
              key={`${activeWarehouse}:${scanSession}`}
              data={data}
              context="putaway"
              expectedLocationId={activeWarehouse}
              expectedBinId={null}
              expectedProductId={sourceId ? putawayStock?.productId : undefined}
              complete={putawaySaving || queued || Boolean(sourceId && putawayStock)}
              scannedCodes={putawayStock ? [putawayStock.code] : []}
              label="Scan stock to put away"
              manualLabel="Enter stock code manually"
              manualActionLabel="Add stock"
              onResolved={(stock) => { setPutawayStock(stock); setPutawayQuantity('1'); setPutawayError(null); }}
            />
          </Field>
          {putawayStock && <div className="space-y-2">
            <p className="break-words font-semibold">{data.products.find((product) => product.id === putawayStock.productId)?.name} / {putawayStock.serialNumber ?? putawayStock.code}</p>
            {putawayStock.serialNumber ? <p>1 serialized unit: {putawayStock.serialNumber}</p> : <Field label="Quantity to put away" htmlFor="putaway-quantity">
              <input id="putaway-quantity" className="input" type="number" inputMode="numeric" min={1} max={eligibleQuantity} step={1} value={putawayQuantity} disabled={putawaySaving || queued} onChange={(event) => setPutawayQuantity(event.target.value)} />
            </Field>}
            <p role="status">{positionsReady ? `${eligibleQuantity} eligible unit(s) in the general area` : 'Checking eligible stock...'}</p>
            {positionsReady && !quantityValid && <p role="alert">Enter a whole quantity from 1 to {eligibleQuantity}. Unavailable stock cannot be moved.</p>}
            {putawayBin && quantityValid && <p className="font-semibold">Move {quantity} unit(s) to {putawayBin.code}</p>}
          </div>}
          <Field
            label="2. Destination bin"
            hint={putawayBin ? `Selected ${putawayBin.code}` : 'Must belong to the selected warehouse.'}
          >
            <BarcodeScanner
              disabled={putawaySaving || queued}
              onDetected={selectPutawayBin}
              label="Scan destination bin"
              manualLabel="Enter destination bin manually"
              manualActionLabel="Add bin"
            />
          </Field>
          {putawayError && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
              {putawayError}
            </p>
          )}
        </div>
      </Sheet>

      {/* Scan-to-find */}
      <Sheet
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Scan a storage area"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Scan or type a bin code to see everything stored there.
          </p>
          <BarcodeScanner onDetected={onScan} label="Scan bin label" />
        </div>
      </Sheet>
    </div>
  );
}
