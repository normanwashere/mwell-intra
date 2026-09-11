import { useRef, useState } from 'react';
import { userFacingError } from '@intra/ui';
import type { InventoryHold, Product, WarehouseData } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { WAREHOUSE_MUTATION_CAPABILITIES } from '@/app/authorization';
import { useSession } from '@/auth/session';
import { Icon } from '@/components/Icon';
import { Field, QuantityStepper, Sheet, useToast } from '@/components/ui';
import { BarcodeScanner } from '@/components/camera/BarcodeScanner';
import { resolveWarehouseScan } from '@/components/camera/WarehouseScanFlow';
import { matchesDraftShape, useIntakeDraft } from '@/components/fulfillment/intakeDraft';
import { loadCompleteControlQueue } from '@/domain/controlQueues';

interface RelocationDraft {
  locationId: string;
  fromBinId: string;
  toBinId: string;
  quantity: number;
  serials: string[];
}

interface Props {
  product: Product;
  data: WarehouseData;
  initialLocationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const recoveryMessage = 'Move not confirmed. Your draft is saved. Reopen inventory and check the selected units and movement history before trying again, so the same stock is not moved twice. If the result is still unclear, ask your warehouse supervisor to check it.';

export function RelocationSheet(props: Props) {
  const { profile, mode } = useSession();
  const { source, actor } = useWarehouse();
  const scope = profile
    ? `intra.warehouse-relocation.v1:${JSON.stringify([mode, source, profile.id, actor, props.product.id])}`
    : null;
  return scope ? <ScopedRelocationSheet key={scope} {...props} scope={scope} /> : null;
}

function ScopedRelocationSheet({ product, data, initialLocationId, open, onOpenChange, scope }: Props & { scope: string }) {
  const { relocate, loadHolds, can, source } = useWarehouse();
  const toast = useToast();
  const [initial] = useState<RelocationDraft>(() => ({ locationId: initialLocationId, fromBinId: '', toBinId: '', quantity: 1, serials: [] }));
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const latest = useRef({ data, can });
  latest.current = { data, can };
  const draft = useIntakeDraft(scope, initial, (value): value is RelocationDraft =>
    matchesDraftShape(value, { ...initial, serials: [''] }) &&
    Number.isInteger((value as RelocationDraft).quantity) && (value as RelocationDraft).quantity > 0 &&
    new Set((value as RelocationDraft).serials).size === (value as RelocationDraft).serials.length,
    undefined, saving,
  );
  const { locationId, fromBinId, toBinId, quantity, serials } = draft.value;
  const warehouses = data.locations.filter(location => location.type === 'warehouse');
  const bins = data.storageAreas.filter(bin => bin.locationId === locationId);
  const locked = saving || confirmed || draft.needsResume || draft.conflict;
  const update = (patch: Partial<RelocationDraft>) => {
    if (inFlight.current || locked) return;
    setError(null);
    draft.update(current => ({ ...current, ...patch }));
  };

  const submit = async () => {
    if (inFlight.current || locked || !can(WAREHOUSE_MUTATION_CAPABILITIES.relocate)) return;
    setError(null);
    // Hold RLS uses these capabilities; an invisible population is not empty.
    if (source === 'supabase' && !can('inspect_quality') && !can('view_exceptions') && !can('view_finance')) {
      setError('Active holds cannot be verified with your current access. No move was submitted. Ask Quality or a warehouse supervisor to review the retained draft.');
      return;
    }
    const selected = draft.current.current;
    const count = product.serialized ? selected.serials.length : selected.quantity;
    if (!warehouses.some(location => location.id === selected.locationId)) {
      setError('Choose a current warehouse.');
      return;
    }
    if ([selected.fromBinId, selected.toBinId].some(id => id && !bins.some(bin => bin.id === id))) {
      setError('A selected storage area is no longer at this warehouse. Choose the current source and destination.');
      return;
    }
    if (selected.fromBinId === selected.toBinId) {
      setError('Source and destination bins must differ.');
      return;
    }
    if (!Number.isInteger(count) || count < 1) {
      setError(product.serialized ? 'Scan the exact units to move.' : 'Quantity must be a positive whole number.');
      return;
    }
    if (!draft.replace(selected, true)) return;
    inFlight.current = true;
    setSaving(true);
    let submitted = false;
    try {
      let holds: InventoryHold[];
      try {
        holds = await loadCompleteControlQueue(query => loadHolds({ ...query, status: 'active' }));
      } catch {
        setError('Stock holds could not be checked. Nothing was moved. Your draft is saved. Check your connection and try Move stock again.');
        return;
      }
      // Scope changes or another tab's draft must not submit a stale operator's selection.
      if (!draft.mounted.current || !latest.current.can(WAREHOUSE_MUTATION_CAPABILITIES.relocate) || !draft.replace(selected, true)) return;
      const currentData = latest.current.data;
      const sourceHolds = holds.filter(hold => hold.status === 'active' && hold.productId === product.id &&
        hold.locationId === selected.locationId && (hold.binId ?? '') === selected.fromBinId);
      if (product.serialized) {
        for (const code of selected.serials) {
          const result = resolveWarehouseScan({ data: currentData, context: 'transfer', code,
            expectedProductId: product.id, expectedLocationId: selected.locationId, expectedBinId: selected.fromBinId || null });
          if (!result.ok) { setError(`${code}: ${result.message} Review the retained selection before retrying.`); return; }
          const unit = currentData.units.find(unit => unit.serialNumber === code && unit.productId === product.id)!;
          const blockingHold = sourceHolds.find(hold => hold.serialNumber === code && (hold.lotId ?? '') === (unit.lotId ?? ''));
          if (blockingHold) {
            setError(blockingHold.reason === 'Awaiting independent quality inspection'
              ? `${code} is waiting for inspection. Nothing was moved. Ask an authorized person other than the receiver to inspect it in Quality Control > Pending. Keep it in its current bin until accepted. Remove this unit from the selection to move the others.`
              : `${code} cannot be moved because it is on hold. Nothing was moved. Keep it in its current bin and ask your warehouse supervisor to review the hold in Quality Control. Remove this unit from the selection to move the others. Do not remove the hold just to move stock.`);
            return;
          }
        }
      } else {
        const sourceStock = currentData.stockLevels.filter(row => row.productId === product.id &&
          row.locationId === selected.locationId && (row.binId ?? '') === selected.fromBinId);
        const available = sourceStock.reduce((sum, row) => {
          const held = sourceHolds.filter(hold => !hold.serialNumber && (hold.lotId ?? '') === (row.lotId ?? ''))
            .reduce((total, hold) => total + hold.quantity, 0);
          // Pending bulk stock already includes held units in unavailable.
          return sum + Math.max(0, row.quantity - Math.max(row.unavailable ?? 0, held));
        }, 0);
        if (count > available) {
          setError(`Only ${available} units are available in the exact source bin after active holds and unavailable stock. Review the quantity or request Quality review; do not release a hold just to complete a move.`);
          return;
        }
      }
      submitted = true;
      const ok = await relocate({ productId: product.id, locationId: selected.locationId,
        fromBinId: selected.fromBinId || undefined, toBinId: selected.toBinId || undefined,
        quantity: count, serialNumbers: product.serialized ? selected.serials : undefined });
      if (!ok) { setError(recoveryMessage); return; }
      setConfirmed(true);
      toast.success(`Moved ${count}x ${product.name} to ${data.storageAreas.find(bin => bin.id === selected.toBinId)?.code ?? 'General area'}`);
      if (draft.clear()) {
        setConfirmed(false);
        if (draft.mounted.current) onOpenChange(false);
      }
    } catch {
      setError(submitted ? recoveryMessage : 'The stock check could not be completed. Nothing was moved. Your draft is saved. Reopen inventory and check the selected stock before trying again.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const discard = () => {
    if (inFlight.current || confirmed) return;
    if (draft.clear()) setError(null);
  };

  return (
    <Sheet open={open} onOpenChange={next => { if (!inFlight.current) onOpenChange(next); }}
      title="Relocate stock" description={`Move ${product.name} between storage areas.`}
      footer={<button type="button" className="btn-primary w-full" disabled={locked || (product.serialized && serials.length === 0)} onClick={() => void submit()}>Move stock</button>}>
      <div className="space-y-3">
        {draft.error && <p role="alert" className="text-sm text-amber-700">{draft.error}</p>}
        {draft.reviewRequired && <p role="status" className="text-sm text-amber-700">This draft is over 30 days old. Review the source, destination and selected stock before submitting.</p>}
        <div className="flex flex-wrap gap-2">
          {(draft.needsResume || draft.conflict) && <button type="button" className="btn-ghost" disabled={saving || confirmed} onClick={() => { if (draft.resume()) setError(null); }}>{draft.conflict ? 'Load latest draft' : 'Resume draft'}</button>}
          {draft.dirty && !draft.conflict && !confirmed && <button type="button" className="btn-ghost" disabled={saving} onClick={discard}>Discard draft</button>}
          {confirmed && <button type="button" className="btn-ghost" onClick={() => { if (draft.clear()) { setConfirmed(false); onOpenChange(false); } }}>Clear confirmed draft</button>}
        </div>
        <fieldset className="space-y-3" disabled={locked}>
          {warehouses.length > 1 && <Field label="Warehouse" htmlFor="rel-wh">
            <select id="rel-wh" className="input" value={locationId} onChange={event => update({ locationId: event.target.value, fromBinId: '', toBinId: '', serials: [] })}>
              {warehouses.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </Field>}
          <Field label="From bin" htmlFor="rel-from">
            <select id="rel-from" className="input" value={fromBinId} onChange={event => update({ fromBinId: event.target.value, serials: [] })}>
              <option value="">General area (unassigned)</option>
              {bins.map(bin => <option key={bin.id} value={bin.id}>{bin.code}{bin.label ? ` - ${bin.label}` : ''}</option>)}
            </select>
          </Field>
          <Field label="To bin" htmlFor="rel-to">
            <select id="rel-to" className="input" value={toBinId} onChange={event => update({ toBinId: event.target.value })}>
              <option value="">General area (unassigned)</option>
              {bins.map(bin => <option key={bin.id} value={bin.id}>{bin.code}{bin.label ? ` - ${bin.label}` : ''}</option>)}
            </select>
          </Field>
          {product.serialized ? <Field label="Serialized units" hint={`${serials.length} selected`}>
            <BarcodeScanner key={`${open}:${locationId}:${fromBinId}:${draft.generation}`} label="Scan relocation serial" mode="batch" disabled={locked || !open}
              onDetected={code => {
                if (inFlight.current || locked) return;
                const current = draft.current.current;
                const result = resolveWarehouseScan({ data, context: 'transfer', code, scannedCodes: current.serials,
                  expectedProductId: product.id, expectedLocationId: current.locationId, expectedBinId: current.fromBinId || null });
                if (!result.ok) { setError(result.message); return; }
                if (result.serialNumber) update({ serials: [...current.serials, result.serialNumber] });
              }} />
            {serials.length > 0 && <ul className="mt-3 space-y-2" aria-label="Accepted scans">
              {serials.map(serial => <li key={serial} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-inset pl-3">
                <span className="min-w-0 break-all font-mono text-sm">{serial}</span>
                <button type="button" className="btn-ghost min-h-11 min-w-11 shrink-0" aria-label={`Remove ${serial}`} title={`Remove ${serial}`}
                  onClick={() => update({ serials: draft.current.current.serials.filter(value => value !== serial) })}><Icon name="x" className="h-4 w-4" /></button>
              </li>)}
            </ul>}
          </Field> : <Field label="Quantity" htmlFor="rel-qty">
            <QuantityStepper id="rel-qty" aria-label="Relocate quantity" value={quantity} onChange={quantity => update({ quantity })} min={1} />
          </Field>}
          {bins.length === 0 && <p className="text-sm text-muted">No storage areas set up for this warehouse yet. Add bins on the Storage areas page first.</p>}
        </fieldset>
        {saving && <p role="status" className="text-sm text-muted">Checking holds and confirming the move...</p>}
        {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">{userFacingError(error)}</p>}
      </div>
    </Sheet>
  );
}
