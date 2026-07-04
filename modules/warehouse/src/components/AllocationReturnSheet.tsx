import { useState } from 'react';
import { useWarehouse } from '@/app/store';
import type { Allocation } from '@/domain/types';
import { Field, QuantityStepper, Sheet, useToast } from '@/components/ui';

const DISPOSITIONS: { value: 'restock' | 'lost' | 'vendor_return'; label: string }[] = [
  { value: 'restock', label: 'Restock (back to inventory)' },
  { value: 'lost', label: 'Lost / damaged' },
  { value: 'vendor_return', label: 'Return to vendor' },
];

/**
 * Compact return flow launched from an *issued* allocation. Records the return
 * against the allocation so its lifecycle closes (status -> returned) instead of
 * leaving the allocation stuck at "issued" with no next step.
 */
export function AllocationReturnSheet({
  allocation,
  productName,
  open,
  onOpenChange,
}: {
  allocation: Allocation | null;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, recordReturn } = useWarehouse();
  const toast = useToast();
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [disposition, setDisposition] =
    useState<'restock' | 'lost' | 'vendor_return'>('restock');
  const [locationId, setLocationId] = useState('');
  const [binId, setBinId] = useState('');
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const product = allocation
    ? data?.products.find((p) => p.id === allocation.productId)
    : undefined;
  const serialized = product?.serialized ?? false;

  // Serialized units currently issued for this allocation's event/product —
  // the candidates the user can return.
  const issuedUnits =
    allocation && serialized
      ? (data?.units ?? []).filter(
          (u) =>
            u.productId === allocation.productId &&
            u.status === 'issued' &&
            (allocation.eventId ? u.eventId === allocation.eventId : true),
        )
      : [];

  const restockLocations =
    data?.locations.filter((l) => l.type !== 'vendor') ?? [];
  const restockBins = (data?.storageAreas ?? [])
    .filter((b) => b.locationId === locationId)
    .sort((a, b) => a.code.localeCompare(b.code));

  // Reset the form each time a new allocation opens the sheet.
  const [lastId, setLastId] = useState<string | null>(null);
  if (allocation && allocation.id !== lastId) {
    setLastId(allocation.id);
    setQuantity(allocation.quantity);
    setReason('');
    setDisposition('restock');
    setLocationId('');
    setBinId('');
    // Pre-select the first `quantity` issued serials for serialized products.
    const preset = serialized
      ? (data?.units ?? [])
          .filter(
            (u) =>
              u.productId === allocation.productId &&
              u.status === 'issued' &&
              (allocation.eventId ? u.eventId === allocation.eventId : true),
          )
          .slice(0, allocation.quantity)
          .map((u) => u.serialNumber)
      : [];
    setSelectedSerials(preset);
  }

  const toggleSerial = (serialNumber: string) =>
    setSelectedSerials((prev) =>
      prev.includes(serialNumber)
        ? prev.filter((s) => s !== serialNumber)
        : [...prev, serialNumber],
    );

  const serialsReady = !serialized || selectedSerials.length > 0;

  const submit = async () => {
    if (!allocation) return;
    setBusy(true);
    const restockLoc =
      disposition === 'restock' && locationId ? locationId : undefined;
    const restockBin =
      disposition === 'restock' && locationId && binId ? binId : undefined;
    // Serialized returns record one line per selected serial so each unit's
    // status (and location/bin on restock) is updated individually.
    const lines = serialized
      ? selectedSerials.map((serialNumber) => ({
          productId: allocation.productId,
          quantity: 1,
          reason: reason.trim() || 'Returned from event',
          disposition,
          serialNumber,
          locationId: restockLoc,
          binId: restockBin,
        }))
      : [
          {
            productId: allocation.productId,
            quantity,
            reason: reason.trim() || 'Returned from event',
            disposition,
            locationId: restockLoc,
            binId: restockBin,
          },
        ];
    const ok = await recordReturn({
      source: 'customer',
      eventId: allocation.eventId,
      allocationId: allocation.id,
      lines,
    });
    setBusy(false);
    if (!ok) return;
    toast.success('Return logged & allocation closed');
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Log return"
      description={productName}
      footer={
        <button
          type="button"
          className="btn-primary w-full justify-center"
          disabled={busy || !serialsReady}
          onClick={() => void submit()}
        >
          {busy ? 'Saving…' : 'Log return'}
        </button>
      }
    >
      {allocation && (
        <div className="space-y-3">
          {serialized ? (
            <Field
              label="Units to return"
              hint={`${selectedSerials.length} selected`}
              error={
                issuedUnits.length === 0
                  ? 'No issued units found for this allocation.'
                  : undefined
              }
            >
              {issuedUnits.length === 0 ? (
                <p className="text-sm text-faint">
                  Nothing to return — units may already be back in stock.
                </p>
              ) : (
                <ul
                  className="max-h-56 space-y-1 overflow-y-auto"
                  aria-label="Issued units"
                >
                  {issuedUnits.map((u) => (
                    <li key={u.id}>
                      <label className="flex min-h-11 items-center gap-2 rounded-lg bg-inset px-3 py-3">
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0 rounded"
                          checked={selectedSerials.includes(u.serialNumber)}
                          onChange={() => toggleSerial(u.serialNumber)}
                        />
                        <span className="min-w-0 truncate font-mono text-sm text-ink">
                          {u.serialNumber}
                        </span>
                        {u.assignedTo && (
                          <span
                            className="ml-auto shrink-0 truncate text-xs text-faint"
                            title={u.assignedTo}
                          >
                            {u.assignedTo}
                          </span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          ) : (
            <Field label="Quantity returned" htmlFor="alloc-return-qty">
              <QuantityStepper
                id="alloc-return-qty"
                aria-label="Quantity returned"
                value={quantity}
                onChange={setQuantity}
                min={1}
                max={allocation.quantity}
              />
            </Field>
          )}
          <Field label="Disposition" htmlFor="alloc-return-disp">
            <select
              id="alloc-return-disp"
              className="input"
              value={disposition}
              onChange={(e) =>
                setDisposition(e.target.value as 'restock' | 'lost' | 'vendor_return')
              }
            >
              {DISPOSITIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          {disposition === 'restock' && (
            <Field label="Restock into" htmlFor="alloc-return-loc">
              <select
                id="alloc-return-loc"
                className="input"
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setBinId('');
                }}
              >
                <option value="">Auto (site holding stock)</option>
                {restockLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {disposition === 'restock' && locationId && restockBins.length > 0 && (
            <Field label="Restock bin" htmlFor="alloc-return-bin">
              <select
                id="alloc-return-bin"
                className="input"
                value={binId}
                onChange={(e) => setBinId(e.target.value)}
              >
                <option value="">General area</option>
                {restockBins.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Reason (optional)" htmlFor="alloc-return-reason">
            <input
              id="alloc-return-reason"
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Event ended, unused units"
            />
          </Field>
        </div>
      )}
    </Sheet>
  );
}
