import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
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

export function StorageAreasPage() {
  const [searchParams] = useSearchParams();
  const {
    data,
    can,
    createStorageArea,
    updateStorageArea,
    deleteStorageArea,
    relocate,
  } = useWarehouse();
  const toast = useToast();
  const canManage = can('manage_locations');
  const canPutAway = can('receive_stock') || can('transfer_stock');
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
    setPutawayStock(null);
    setPutawayBin(null);
    setPutawayError(null);
    setPutawayOpen(true);
  };

  const selectPutawayBin = (raw: string) => {
    const normalized = raw.trim().toLowerCase();
    const match = bins.find(
      (bin) =>
        bin.code.toLowerCase() === normalized || bin.id.toLowerCase() === normalized,
    );
    if (!match) {
      setPutawayError('Scan a destination bin in the selected warehouse.');
      return;
    }
    setPutawayError(null);
    setPutawayBin(match);
  };

  const confirmPutaway = async () => {
    if (!putawayStock || !putawayBin) return;
    const ok = await relocate({
      productId: putawayStock.productId,
      locationId: activeWarehouse,
      fromBinId: undefined,
      toBinId: putawayBin.id,
      quantity: 1,
      serialNumbers: putawayStock.serialNumber
        ? [putawayStock.serialNumber]
        : undefined,
    });
    if (!ok) return;
    toast.success(`Put away into ${putawayBin.code}`);
    setPutawayOpen(false);
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
              <button type="button" className="btn-accent btn-sm" onClick={openPutaway}>
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

      {warehouses.length > 1 && (
        <Field label="Warehouse" htmlFor="sa-wh">
          <select
            id="sa-wh"
            className="input"
            value={activeWarehouse}
            onChange={(e) => setWarehouseId(e.target.value)}
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
        onOpenChange={setPutawayOpen}
        title="Put away stock"
        description="Scan eligible stock from the general receiving area, then scan its destination bin."
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            disabled={!putawayStock || !putawayBin}
            onClick={() => void confirmPutaway()}
          >
            Confirm putaway
          </button>
        }
      >
        <div className="space-y-5">
          <Field label="1. Stock identity" hint="Serialized devices require the individual serial.">
            <WarehouseScanFlow
              data={data}
              context="putaway"
              expectedLocationId={activeWarehouse}
              expectedBinId={null}
              scannedCodes={putawayStock ? [putawayStock.code] : []}
              label="Scan stock to put away"
              manualLabel="Enter stock code manually"
              manualActionLabel="Add stock"
              onResolved={setPutawayStock}
            />
          </Field>
          <Field
            label="2. Destination bin"
            hint={putawayBin ? `Selected ${putawayBin.code}` : 'Must belong to the selected warehouse.'}
          >
            <BarcodeScanner
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
