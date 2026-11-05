import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import { toStockState } from '@/data/repository';
import { primaryStockLocation, stockByLocation } from '@/domain/transfers';
import { stockByBin } from '@/domain/storage';
import type { Allocation, AllocationStatus } from '@/domain/types';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  SegmentedControl,
  Sheet,
  useToast,
  type Tone,
} from '@/components/ui';
import { Icon } from '@/components/Icon';
import { EvidenceCapture } from '@/components/camera/EvidenceCapture';
import { WarehouseScanFlow } from '@/components/camera/WarehouseScanFlow';
import { AllocationReturnSheet } from '@/components/AllocationReturnSheet';
import { AllocationReservationSheet } from '@/components/AllocationReservationSheet';

type StatusFilter = 'all' | 'reserved' | 'issued';

const STATUS_TONE: Record<AllocationStatus, Tone> = {
  reserved: 'amber',
  allocated: 'brand',
  issued: 'emerald',
  returned: 'slate',
  cancelled: 'rose',
};

export function AllocationsPage() {
  const { data, issue, cancelAllocation, can, canOpenRoute } = useWarehouse();
  const [params, setParams] = useSearchParams();
  const allocationId = params.get('allocation');
  const hasSelection = params.has('allocation');
  const toast = useToast();
  const canIssue = can('issue_items');
  const canReserve = can('reserve_allocate');
  const canReturn = can('manage_returns');
  const [returnAlloc, setReturnAlloc] = useState<Allocation | null>(null);

  const [open, setOpen] = useState(false);

  const [issuing, setIssuing] = useState<Allocation | null>(null);
  const [assignedTo, setAssignedTo] = useState('');
  const [issueLoc, setIssueLoc] = useState('');
  const [issueBin, setIssueBin] = useState('');
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const issueLocations = useMemo(() => {
    if (!data || !issuing) return [];
    return stockByLocation(toStockState(data), issuing.productId).filter(
      (l) => l.quantity > 0,
    );
  }, [data, issuing]);

  // Bins holding this product at the chosen source location.
  const issueBins = useMemo(() => {
    if (!data || !issuing || !issueLoc) return [];
    return stockByBin(toStockState(data), issuing.productId, issueLoc);
  }, [data, issuing, issueLoc]);

  // In-stock serial units available to issue from the chosen source location/bin.
  const issueUnits = useMemo(() => {
    if (!data || !issuing) return [];
    const product = data.products.find((p) => p.id === issuing.productId);
    if (!product?.serialized) return [];
    return data.units.filter(
      (u) =>
        u.productId === issuing.productId &&
        u.status === 'in_stock' &&
        (!issueLoc || u.locationId === issueLoc) &&
        (!issueBin || (u.binId ?? '') === issueBin),
    );
  }, [data, issuing, issueLoc, issueBin]);

  if (!data) return null;
  if (hasSelection && !canOpenRoute('allocations')) {
    return <EmptyState icon="lock" title="Allocation is unavailable or outside your access" />;
  }
  const allocationLink = (id?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('allocation', id);
    else next.delete('allocation');
    return next.size ? `?${next.toString()}` : '/allocations';
  };
  const eventName = (id: string) => data.events.find((e) => e.id === id)?.name ?? id;
  const eventDate = (id: string) => {
    const ev = data.events.find((e) => e.id === id);
    return ev
      ? new Date(ev.startDate).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })
      : '';
  };
  const productName = (id: string) => data.products.find((p) => p.id === id)?.name ?? id;

  const isReserved = (a: Allocation) =>
    a.status === 'reserved' || a.status === 'allocated';
  const reservedCount = data.allocations.filter(isReserved).length;
  const issuedCount = data.allocations.filter((a) => a.status === 'issued').length;
  const shown = data.allocations.filter((a) =>
    hasSelection ? a.id === allocationId : statusFilter === 'all'
      ? true
      : statusFilter === 'reserved'
        ? isReserved(a)
        : a.status === 'issued',
  );

  const issuingProduct = issuing
    ? data.products.find((p) => p.id === issuing.productId)
    : undefined;
  const issueSerialized = issuingProduct?.serialized ?? false;
  const serialsReady =
    !issueSerialized || selectedSerials.length === (issuing?.quantity ?? 0);

  const inStockSerials = (productId: string, locationId: string, binId: string) =>
    data.units
      .filter(
        (u) =>
          u.productId === productId &&
          u.status === 'in_stock' &&
          (!locationId || u.locationId === locationId) &&
          (!binId || (u.binId ?? '') === binId),
      )
      .map((u) => u.serialNumber);

  // Default selection: the first `quantity` in-stock serials at the location/bin.
  const defaultSerials = (a: Allocation, locationId: string, binId: string) => {
    const product = data.products.find((p) => p.id === a.productId);
    if (!product?.serialized) return [];
    return inStockSerials(a.productId, locationId, binId).slice(0, a.quantity);
  };

  // Bin holding the most stock for a product at a location (default source).
  const topBin = (productId: string, locationId: string): string => {
    if (!locationId) return '';
    const byBin = stockByBin(toStockState(data), productId, locationId)
      .slice()
      .sort((x, y) => y.quantity - x.quantity);
    return byBin[0]?.binId ?? '';
  };

  const toggleSerial = (serialNumber: string) =>
    setSelectedSerials((prev) =>
      prev.includes(serialNumber)
        ? prev.filter((s) => s !== serialNumber)
        : [...prev, serialNumber],
    );

  const closeIssue = () => {
    setIssuing(null);
    setAssignedTo('');
    setIssueLoc('');
    setIssueBin('');
    setSelectedSerials([]);
    setEvidenceUrls([]);
  };

  const confirmIssue = async () => {
    if (!issuing || evidenceBusy) return;
    const ok = await issue({
      allocationId: issuing.id,
      assignedTo: assignedTo.trim() || undefined,
      sourceLocationId: issueLoc || undefined,
      sourceBinId: issueBin || undefined,
      serialNumbers: issueSerialized ? selectedSerials : undefined,
      evidenceUrls: evidenceUrls.length > 0 ? evidenceUrls : undefined,
    });
    if (!ok) return;
    toast.success(
      assignedTo.trim()
        ? `Issued to ${assignedTo.trim()}`
        : 'Allocation issued',
    );
    closeIssue();
  };

  const openIssue = (a: Allocation) => {
    const loc = primaryStockLocation(toStockState(data), a.productId) ?? '';
    const bin = topBin(a.productId, loc);
    setIssuing(a);
    setAssignedTo('');
    setIssueLoc(loc);
    setIssueBin(bin);
    setEvidenceUrls([]);
    setSelectedSerials(defaultSerials(a, loc, bin));
  };

  const changeIssueLoc = (loc: string) => {
    const bin = issuing ? topBin(issuing.productId, loc) : '';
    setIssueLoc(loc);
    setIssueBin(bin);
    if (issuing) setSelectedSerials(defaultSerials(issuing, loc, bin));
  };

  const changeIssueBin = (bin: string) => {
    setIssueBin(bin);
    if (issuing) setSelectedSerials(defaultSerials(issuing, issueLoc, bin));
  };

  const doCancel = async (id: string) => {
    const ok = await cancelAllocation({ allocationId: id });
    if (!ok) return;
    toast.success('Reservation cancelled');
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Allocations"
        icon="tag"
        subtitle="Reserve, issue and track stock for activations"
        action={
          canReserve ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => setOpen(true)}>
              <Icon name="plus" className="h-4 w-4" /> Reserve
            </button>
          ) : undefined
        }
      />

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="w-full sm:w-72">
            <SegmentedControl<StatusFilter>
              ariaLabel="Status filter"
              value={hasSelection ? 'all' : statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                const next = new URLSearchParams(params);
                next.delete('allocation');
                setParams(next);
              }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'reserved', label: 'Reserved' },
                { value: 'issued', label: 'Issued' },
              ]}
            />
          </div>
          <p className="text-xs text-faint">
            <span className="font-semibold text-amber-700 dark:text-amber-300">
              {reservedCount}
            </span>{' '}
            reserved •{' '}
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
              {issuedCount}
            </span>{' '}
            issued
          </p>
        </div>
        {hasSelection && <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm font-semibold text-ink">Selected allocation</p>
          <Link className="btn-ghost btn-sm" to={allocationLink()}>Show all allocations</Link>
        </div>}
        {hasSelection && shown.length === 0 ? (
          <EmptyState icon="tag" title="Allocation is unavailable or outside your access" message="No different allocation was selected." />
        ) : data.allocations.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No allocations yet"
            message="Reserve stock for an upcoming event to get started."
          />
        ) : shown.length === 0 ? (
          <EmptyState icon="calendar" title={`No ${statusFilter} allocations`} />
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2" aria-label="Allocations">
            {shown.map((a) => (
              <li
                key={a.id}
                aria-label={`Allocation ${a.id}`}
                aria-current={allocationId === a.id ? 'true' : undefined}
                className={`grid min-w-0 content-start gap-3 rounded-lg border bg-inset p-3 ${allocationId === a.id ? 'border-brand-600 ring-2 ring-brand-600' : 'border-transparent'}`}
              >
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="font-medium text-ink">
                    {productName(a.productId)}
                  </p>
                  <p className="text-sm text-muted">SKU {data.products.find(p => p.id === a.productId)?.sku ?? 'unavailable'} · Qty {a.quantity}</p>
                  <p className="mt-1 text-xs text-muted">
                    {eventName(a.eventId)} • {eventDate(a.eventId)}
                    {a.promotional ? ' • Giveaway' : ' • Selling'}
                  </p>
                  <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Allocation reference</summary><code>{a.id}</code></details>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                  <Link to={allocationLink(a.id)} className="btn-ghost btn-sm" aria-label={`View allocation ${a.id}`}>View</Link>
                  {(a.status === 'reserved' || a.status === 'allocated') && (
                    <>
                      {canReserve && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => void doCancel(a.id)}
                        >
                          Cancel
                        </button>
                      )}
                      {canIssue && (
                        <button
                          type="button"
                          className="btn-accent btn-sm"
                          onClick={() => openIssue(a)}
                        >
                          Issue
                        </button>
                      )}
                    </>
                  )}
                  {canReturn && a.status === 'issued' && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setReturnAlloc(a)}
                    >
                      Return
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && canReserve && <AllocationReservationSheet onClose={() => setOpen(false)} />}

      <Sheet
        open={issuing !== null}
        onOpenChange={(o) => !o && closeIssue()}
        title="Issue allocation"
        description={
          issuing
            ? `${issuing.quantity}× ${productName(issuing.productId)} → ${eventName(issuing.eventId)}`
            : undefined
        }
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            disabled={!serialsReady || evidenceBusy}
            onClick={() => void confirmIssue()}
          >
            Confirm issue
          </button>
        }
      >
        <div className="space-y-3">
          <Field
            label="Issue from location"
            htmlFor="issue-location"
            hint="Defaults to the site holding stock"
          >
            <select
              id="issue-location"
              className="input"
              value={issueLoc}
              onChange={(e) => changeIssueLoc(e.target.value)}
            >
              {issueLocations.length === 0 && <option value="">—</option>}
              {issueLocations.map((l) => (
                <option key={l.locationId} value={l.locationId}>
                  {data.locations.find((loc) => loc.id === l.locationId)?.name ??
                    l.locationId}{' '}
                  ({l.quantity})
                </option>
              ))}
            </select>
          </Field>
          {issueBins.some((b) => b.binId) && (
            <Field
              label="Issue from bin"
              htmlFor="issue-bin"
              hint="Storage area to pull stock from"
            >
              <select
                id="issue-bin"
                className="input"
                value={issueBin}
                onChange={(e) => changeIssueBin(e.target.value)}
              >
                <option value="">General area</option>
                {issueBins
                  .filter((b) => b.binId)
                  .map((b) => {
                    const area = (data.storageAreas ?? []).find(
                      (s) => s.id === b.binId,
                    );
                    return (
                      <option key={b.binId} value={b.binId}>
                        {area?.code ?? b.binId} ({b.quantity})
                      </option>
                    );
                  })}
              </select>
            </Field>
          )}
          {issueSerialized && (
            <Field
              label="Serial units to issue"
              hint={
                serialsReady
                  ? `${selectedSerials.length} selected`
                  : `Select ${issuing?.quantity ?? 0} of ${issueUnits.length} units`
              }
              error={
                !serialsReady && issueUnits.length < (issuing?.quantity ?? 0)
                  ? 'Not enough in-stock units at this location.'
                  : undefined
              }
            >
              {issueUnits.length === 0 ? (
                <p className="text-sm text-faint">
                  No in-stock units at this location.
                </p>
              ) : (
                <ul
                  className="max-h-56 space-y-1 overflow-y-auto"
                  aria-label="Serial units"
                >
                  {issueUnits.map((u) => (
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
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <WarehouseScanFlow
                  data={data}
                  context="issue"
                  expectedProductId={issuing?.productId}
                  expectedLocationId={issueLoc || undefined}
                  expectedBinId={issueBin || undefined}
                  scannedCodes={selectedSerials}
                  label="Scan issue serial"
                  onResolved={(resolution) => {
                    if (!resolution.serialNumber) return;
                    setSelectedSerials((current) => {
                      if (
                        current.includes(resolution.serialNumber!) ||
                        current.length >= (issuing?.quantity ?? 0)
                      ) {
                        return current;
                      }
                      return [...current, resolution.serialNumber!];
                    });
                  }}
                />
              </div>
            </Field>
          )}
          <Field
            label="Assign to (doctor / user / VIP)"
            htmlFor="issue-assignee"
            hint="Recorded for serialized device traceability"
          >
            <input
              id="issue-assignee"
              className="input"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="e.g. Dr. Santos"
            />
          </Field>
          <Field label="Photo evidence" hint="Optional proof captured at issue">
            <EvidenceCapture reference={`allocation-issue/${issuing?.id ?? 'closed'}`} value={evidenceUrls} onChange={setEvidenceUrls} onBusyChange={setEvidenceBusy} />
          </Field>
        </div>
      </Sheet>

      <AllocationReturnSheet
        allocation={returnAlloc}
        productName={returnAlloc ? productName(returnAlloc.productId) : ''}
        open={Boolean(returnAlloc)}
        onOpenChange={(o) => !o && setReturnAlloc(null)}
      />
    </div>
  );
}
