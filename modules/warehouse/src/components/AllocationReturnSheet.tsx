import { useEffect, useRef, useState } from "react";
import { useSession } from "@intra/auth";
import { useWarehouse } from "@/app/store";
import { allConflicts, allPending } from "@/data/outbox";
import type { Allocation } from "@/domain/types";
import { Field, QuantityStepper, Sheet, useToast } from "@/components/ui";
import { EvidenceCapture } from "@/components/camera/EvidenceCapture";
import {
  resolveWarehouseScan,
  WarehouseScanFlow,
} from "@/components/camera/WarehouseScanFlow";

interface AllocationReturnSheetProps {
  allocation: Allocation | null;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AllocationReturnSheet({
  allocation,
  open,
  ...props
}: AllocationReturnSheetProps) {
  // Unmount the draft on close, including scanner and evidence state, even if
  // the next return is for the same partially returned allocation.
  if (!allocation || !open) return null;
  return (
    <AllocationReturnForm
      key={allocation.id}
      allocation={allocation}
      {...props}
    />
  );
}

function AllocationReturnForm({
  allocation,
  productName,
  onOpenChange,
}: Omit<AllocationReturnSheetProps, "allocation" | "open"> & {
  allocation: Allocation;
}) {
  const { data, recordReturn, can, source } = useWarehouse();
  const { mode, supabaseClient } = useSession();
  const toast = useToast();
  const returnedQuantity = (data?.returns ?? []).flatMap(record => record.lines)
    .filter(line => line.allocationId === allocation.id)
    .reduce((sum, line) => sum + line.quantity, 0);
  const [liveRemaining, setLiveRemaining] = useState<number | null>(null);
  const [custodyError, setCustodyError] = useState<string | null>(null);
  const remainingQuantity = mode === 'supabase' ? liveRemaining ?? 0 : Math.max(0, allocation.quantity - returnedQuantity);
  const [quantity, setQuantity] = useState(remainingQuantity);
  useEffect(() => { setQuantity(current => Math.min(current, remainingQuantity)); }, [remainingQuantity]);
  useEffect(() => {
    if (mode !== 'supabase') return;
    let active = true;
    if (!supabaseClient) { setCustodyError('Event custody is unavailable. Reconnect and reopen this return.'); return; }
    void supabaseClient.schema('warehouse').from('allocation_return_totals')
      .select('remaining_units').eq('allocation_id', allocation.id).single().then(({ data: row, error: cause }) => {
        if (!active) return;
        const remaining = Number(row?.remaining_units);
        if (cause || !row || !Number.isSafeInteger(remaining) || remaining < 0) {
          setCustodyError('Event custody is unavailable. Refresh and reopen this return.');
        } else { setLiveRemaining(remaining); setQuantity(remaining); }
      }, () => {
        if (active) setCustodyError('Event custody is unavailable. Refresh and reopen this return.');
      });
    return () => { active = false; };
  }, [mode, supabaseClient, allocation.id]);
  const [reason, setReason] = useState("");
  const [locationId, setLocationId] = useState("");
  const [binId, setBinId] = useState("");
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const product = data?.products.find(
    (item) => item.id === allocation.productId,
  );
  const serialized = product?.serialized ?? false;
  const issuedUnits = (data?.units ?? []).filter(
    (unit) =>
      unit.productId === allocation.productId &&
      unit.status === "issued" &&
      unit.eventId === allocation.eventId,
  );
  const quarantineLocations = (data?.locations ?? []).filter(
    (location) => location.type !== "vendor" && location.active !== false,
  );
  const quarantineBins = (data?.storageAreas ?? [])
    .filter((bin) => bin.locationId === locationId && bin.active !== false)
    .sort((a, b) => a.code.localeCompare(b.code));
  const serialsReady =
    selectedSerials.length > 0 &&
    selectedSerials.length <= remainingQuantity &&
    selectedSerials.every(
      (serialNumber) =>
        data &&
        resolveWarehouseScan({
          data,
          context: "return",
          code: serialNumber,
          expectedProductId: allocation.productId,
          expectedEventId: allocation.eventId,
        }).ok,
    );
  const ready = Boolean(
    product &&
    !custodyError &&
    (mode !== 'supabase' || liveRemaining !== null) &&
    can("manage_returns") &&
    allocation.status === "issued" &&
    quarantineLocations.some((location) => location.id === locationId) &&
    quarantineBins.some((bin) => bin.id === binId) &&
    (serialized
      ? serialsReady
      : Number.isSafeInteger(quantity) &&
        quantity > 0 &&
        quantity <= remainingQuantity),
  );

  const toggleSerial = (serialNumber: string) =>
    setSelectedSerials((current) =>
      current.includes(serialNumber)
        ? current.filter((serial) => serial !== serialNumber)
        : [...current, serialNumber],
    );

  const submit = async () => {
    if (evidenceBusy) return;
    if (!ready || saving.current || locked) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    setLocked(true);
    const hasQueuedReturn = async () => {
      if (source !== "supabase") return false;
      const entries = [...(await allPending()), ...(await allConflicts())];
      return entries.some(
        (entry) =>
          entry.method === "recordReturn" &&
          entry.input.allocationId === allocation.id,
      );
    };
    try {
      if (await hasQueuedReturn()) {
        setError(
          "An earlier return is pending sync or needs review. Check sync status and recorded returns before submitting again.",
        );
        return;
      }
      const baseLine = {
        productId: allocation.productId,
        reason: reason.trim() || "Returned from event",
        disposition: "quarantine" as const,
        locationId,
        binId,
      };
      const lines = serialized
        ? selectedSerials.map((serialNumber) => ({
            ...baseLine,
            quantity: 1,
            serialNumber,
          }))
        : [{ ...baseLine, quantity }];
      const ok = await recordReturn({
        source: "event",
        eventId: allocation.eventId,
        allocationId: allocation.id,
        lines,
        evidenceUrls,
      });
      if (!ok) {
        setError(
          "Return status is unconfirmed. Close this draft and check recorded returns before submitting again.",
        );
        return;
      }
      // The shared mutation pipeline can resolve true for an offline enqueue.
      // A queued intent is not a confirmed inventory or quarantine record.
      if (await hasQueuedReturn()) {
        setError(
          "Return is pending sync; quarantine intake is unconfirmed. Check sync status and recorded returns before submitting again.",
        );
        return;
      }
      toast.success("Return logged in quarantine");
      onOpenChange(false);
    } catch (cause) {
      setError(
        `Return status is unconfirmed. Close this draft and check recorded returns before submitting again. ${cause instanceof Error ? cause.message : "Return response unavailable."}`,
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!saving.current) onOpenChange(open);
      }}
      title="Log return"
      description={productName}
      footer={
        <button
          type="button"
          className="btn-primary w-full justify-center"
          disabled={busy || locked || evidenceBusy || !ready}
          onClick={() => void submit()}
        >
          {busy ? "Saving..." : "Log return"}
        </button>
      }
    >
      <fieldset disabled={busy || locked} className="min-w-0 space-y-3">
        <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-semibold">Quarantine intake</p>
          <p>Pending inspection. Quality controls final disposition.</p>
        </div>
        {serialized ? (
          <Field
            label="Units to return"
            hint={custodyError ?? `${selectedSerials.length} selected; ${remainingQuantity} remaining of ${allocation.quantity} issued`}
            error={
              issuedUnits.length === 0
                ? "No issued units found for this allocation."
                : undefined
            }
          >
            <ul
              className="max-h-56 space-y-1 overflow-y-auto"
              aria-label="Issued units"
            >
              {issuedUnits.map((unit) => (
                <li key={unit.id}>
                  <label className="flex min-h-11 items-center gap-2 rounded-lg bg-inset px-3 py-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 rounded"
                      checked={selectedSerials.includes(unit.serialNumber)}
                      disabled={
                        !selectedSerials.includes(unit.serialNumber) &&
                        selectedSerials.length >= remainingQuantity
                      }
                      onChange={() => toggleSerial(unit.serialNumber)}
                    />
                    <span className="min-w-0 break-all font-mono text-sm text-ink">
                      {unit.serialNumber}
                    </span>
                    {unit.assignedTo && (
                      <span className="ml-auto min-w-0 text-xs text-faint">
                        {unit.assignedTo}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            {data && (
              <div className="mt-3">
                <WarehouseScanFlow
                  data={data}
                  context="return"
                  expectedProductId={allocation.productId}
                  expectedEventId={allocation.eventId}
                  scannedCodes={selectedSerials}
                  label="Scan return serial"
                  onResolved={(resolution) => {
                    const serial = resolution.serialNumber;
                    if (!serial) return;
                    if (selectedSerials.length >= remainingQuantity) {
                      setError(
                        "Selected units exceed the allocation quantity.",
                      );
                      return;
                    }
                    setSelectedSerials((current) =>
                      current.includes(serial) ? current : [...current, serial],
                    );
                    setError(null);
                  }}
                />
              </div>
            )}
          </Field>
        ) : (
          <Field label="Quantity returned" htmlFor="alloc-return-qty" hint={custodyError ?? (mode === 'supabase' && liveRemaining === null ? 'Loading outstanding custody' : `${remainingQuantity} remaining of ${allocation.quantity} issued`)}>
            <QuantityStepper
              id="alloc-return-qty"
              aria-label="Quantity returned"
              value={quantity}
              onChange={setQuantity}
              min={1}
              max={remainingQuantity}
            />
          </Field>
        )}
        <Field label="Quarantine location" htmlFor="alloc-return-loc">
          <select
            id="alloc-return-loc"
            className="input"
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setBinId("");
            }}
          >
            <option value="">Select quarantine location</option>
            {quarantineLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>
        {locationId && (
          <Field
            label="Quarantine bin"
            htmlFor="alloc-return-bin"
            error={
              quarantineBins.length === 0
                ? "No active bins at this location. Select another location or contact a Warehouse Supervisor."
                : undefined
            }
          >
            <select
              id="alloc-return-bin"
              className="input"
              value={binId}
              onChange={(event) => setBinId(event.target.value)}
            >
              <option value="">Select quarantine bin</option>
              {quarantineBins.map((bin) => (
                <option key={bin.id} value={bin.id}>
                  {bin.code}
                  {bin.label ? ` - ${bin.label}` : ""}
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
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Event ended, unused units"
          />
        </Field>
        <EvidenceCapture
          reference={`allocation-return/${allocation.id}`}
          value={evidenceUrls}
          onBusyChange={setEvidenceBusy}
          onChange={setEvidenceUrls}
          label="Attach return evidence"
        />
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}
      </fieldset>
    </Sheet>
  );
}
