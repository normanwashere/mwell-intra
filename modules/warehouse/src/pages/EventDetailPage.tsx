import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import { can } from '@/auth/roles';
import { toStockState } from '@/data/repository';
import { uncommittedAvailable, validateReservation } from '@/domain/allocations';
import { eventCosting, eventSummary } from '@/domain/events';
import { primaryStockLocation, stockByLocation } from '@/domain/transfers';
import { stockByBin } from '@/domain/storage';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  ProductSelect,
  QuantityStepper,
  SectionTitle,
  Sheet,
  StatCard,
  money,
  useToast,
  type Tone,
} from '@/components/ui';
import { Icon } from '@/components/Icon';
import { AllocationReturnSheet } from '@/components/AllocationReturnSheet';
import type { Allocation, AllocationStatus } from '@/domain/types';

const STATUS_TONE: Record<AllocationStatus, Tone> = {
  reserved: 'amber',
  allocated: 'brand',
  issued: 'emerald',
  returned: 'slate',
  cancelled: 'rose',
};

export function EventDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data, role, reserve, issue, cancelAllocation } = useWarehouse();
  const toast = useToast();
  const canReserve = can(role, 'reserve_allocate');
  const canIssue = can(role, 'issue_items');
  const canCancel = can(role, 'reserve_allocate');
  const canReturn = can(role, 'manage_returns');
  const [returnAlloc, setReturnAlloc] = useState<Allocation | null>(null);

  const [reserveOpen, setReserveOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [promotional, setPromotional] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Issue sheet state.
  const [issueAlloc, setIssueAlloc] = useState<Allocation | null>(null);
  const [assignedTo, setAssignedTo] = useState('');
  const [issueLoc, setIssueLoc] = useState('');
  const [issueBin, setIssueBin] = useState('');
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [issuing, setIssuing] = useState(false);

  const available = useMemo(() => {
    if (!data || !productId) return 0;
    return uncommittedAvailable(toStockState(data), data.allocations, productId);
  }, [data, productId]);

  // Locations holding this allocation's product (with quantities).
  const issueLocations = useMemo(() => {
    if (!data || !issueAlloc) return [];
    return stockByLocation(toStockState(data), issueAlloc.productId).filter(
      (l) => l.quantity > 0,
    );
  }, [data, issueAlloc]);

  // Bins holding this product at the chosen source location.
  const issueBins = useMemo(() => {
    if (!data || !issueAlloc || !issueLoc) return [];
    return stockByBin(toStockState(data), issueAlloc.productId, issueLoc);
  }, [data, issueAlloc, issueLoc]);

  // In-stock serial units available at the chosen source location/bin.
  const issueUnits = useMemo(() => {
    if (!data || !issueAlloc) return [];
    const product = data.products.find((p) => p.id === issueAlloc.productId);
    if (!product?.serialized) return [];
    return data.units.filter(
      (u) =>
        u.productId === issueAlloc.productId &&
        u.status === 'in_stock' &&
        (!issueLoc || u.locationId === issueLoc) &&
        (!issueBin || (u.binId ?? '') === issueBin),
    );
  }, [data, issueAlloc, issueLoc, issueBin]);

  if (!data) return null;
  const event = data.events.find((e) => e.id === id);
  if (!event) {
    return (
      <EmptyState
        icon="calendar"
        title="Event not found"
        action={
          <button type="button" className="btn-ghost" onClick={() => navigate('/events')}>
            Back to events
          </button>
        }
      />
    );
  }

  const summary = eventSummary(data.allocations, data.movements, event.id);
  const costing = eventCosting(data.movements, data.products, event.id);
  const allocations = data.allocations.filter((a) => a.eventId === event.id);
  const productName = (pid: string) =>
    data.products.find((p) => p.id === pid)?.name ?? pid;

  const submitReserve = async () => {
    setError(null);
    if (!productId) {
      setError('Select a product.');
      return;
    }
    const result = validateReservation(
      toStockState(data),
      data.allocations,
      productId,
      quantity,
    );
    if (!result.ok) {
      setError(result.error ?? 'Invalid reservation');
      return;
    }
    const ok = await reserve({ eventId: event.id, productId, quantity, promotional });
    if (!ok) return;
    toast.success(`Reserved ${quantity}× ${productName(productId)}`);
    setReserveOpen(false);
    setProductId('');
    setQuantity(1);
    setPromotional(false);
  };

  // Bin holding the most stock for a product at a location (default source).
  const topBin = (pid: string, locationId: string): string => {
    if (!locationId) return '';
    const byBin = stockByBin(toStockState(data), pid, locationId)
      .slice()
      .sort((x, y) => y.quantity - x.quantity);
    return byBin[0]?.binId ?? '';
  };

  const inStockSerials = (pid: string, locationId: string, binId: string) =>
    data.units
      .filter(
        (u) =>
          u.productId === pid &&
          u.status === 'in_stock' &&
          (!locationId || u.locationId === locationId) &&
          (!binId || (u.binId ?? '') === binId),
      )
      .map((u) => u.serialNumber);

  const defaultSerials = (a: Allocation, locationId: string, binId: string) => {
    const product = data.products.find((p) => p.id === a.productId);
    if (!product?.serialized) return [];
    return inStockSerials(a.productId, locationId, binId).slice(0, a.quantity);
  };

  const toggleSerial = (serialNumber: string) =>
    setSelectedSerials((prev) =>
      prev.includes(serialNumber)
        ? prev.filter((s) => s !== serialNumber)
        : [...prev, serialNumber],
    );

  const openIssue = (a: Allocation) => {
    const loc = primaryStockLocation(toStockState(data), a.productId) ?? '';
    const bin = topBin(a.productId, loc);
    setIssueAlloc(a);
    setAssignedTo('');
    setIssueLoc(loc);
    setIssueBin(bin);
    setSelectedSerials(defaultSerials(a, loc, bin));
    setError(null);
  };

  const changeIssueLoc = (loc: string) => {
    const bin = issueAlloc ? topBin(issueAlloc.productId, loc) : '';
    setIssueLoc(loc);
    setIssueBin(bin);
    if (issueAlloc) setSelectedSerials(defaultSerials(issueAlloc, loc, bin));
  };

  const changeIssueBin = (bin: string) => {
    setIssueBin(bin);
    if (issueAlloc) setSelectedSerials(defaultSerials(issueAlloc, issueLoc, bin));
  };

  const confirmIssue = async () => {
    if (!issueAlloc) return;
    setIssuing(true);
    const ok = await issue({
      allocationId: issueAlloc.id,
      assignedTo: assignedTo.trim() || undefined,
      sourceLocationId: issueLoc || undefined,
      sourceBinId: issueBin || undefined,
      serialNumbers: issueSerialized ? selectedSerials : undefined,
    });
    setIssuing(false);
    if (!ok) return;
    toast.success(
      assignedTo.trim() ? `Issued to ${assignedTo.trim()}` : 'Allocation issued',
    );
    setIssueAlloc(null);
  };

  const doCancel = async (a: Allocation) => {
    const ok = await cancelAllocation({ allocationId: a.id });
    if (!ok) return;
    toast.success('Reservation cancelled');
  };

  const issueProduct = issueAlloc
    ? data.products.find((p) => p.id === issueAlloc.productId)
    : undefined;
  const issueSerialized = issueProduct?.serialized ?? false;
  const serialsReady =
    !issueSerialized || selectedSerials.length === (issueAlloc?.quantity ?? 0);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate('/events')}
        className="flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"
      >
        <Icon name="chevron" className="h-4 w-4 rotate-180" /> Events
      </button>

      <div className="overflow-hidden rounded-3xl bg-brand-grad p-5 text-white shadow-navy">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-extrabold sm:text-2xl">{event.name}</h1>
            <p className="text-sm text-brand-100/80">
              {event.type.replace('_', ' ')} · {event.startDate}
              {event.endDate ? ` – ${event.endDate}` : ''}
            </p>
          </div>
          {canReserve && (
            <button
              type="button"
              className="btn-accent btn-sm shrink-0"
              onClick={() => setReserveOpen(true)}
            >
              <Icon name="tag" className="h-4 w-4" /> Reserve for this event
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Reserved" value={summary.reserved} icon="tag" tone="amber" />
        <StatCard label="Issued" value={summary.issued} icon="truck" tone="brand" />
        <StatCard label="Returned" value={summary.returned} icon="rotate" tone="slate" />
        <StatCard label="Consumed" value={summary.consumed} icon="check" tone="emerald" />
      </div>

      <Card>
        <SectionTitle title="Event costing" subtitle="Sold/used vs promotional give-aways" />
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-inset p-3">
            <dt className="text-xs text-faint">Consumed value</dt>
            <dd className="tnum text-lg font-extrabold text-ink">{money(costing.consumedValue)}</dd>
          </div>
          <div className="rounded-xl bg-inset p-3">
            <dt className="text-xs text-faint">Promo give-aways</dt>
            <dd className="tnum text-lg font-extrabold text-amber-800 dark:text-amber-300">
              {money(costing.promoValue)}
            </dd>
          </div>
          <div className="rounded-xl bg-inset p-3">
            <dt className="text-xs text-faint">Sold / used</dt>
            <dd className="tnum text-lg font-extrabold text-ink">{money(costing.soldValue)}</dd>
          </div>
          <div className="rounded-xl bg-inset p-3">
            <dt className="text-xs text-faint">Returned value</dt>
            <dd className="tnum text-lg font-extrabold text-ink">{money(costing.returnedValue)}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <SectionTitle title="Allocations" />
        {allocations.length === 0 ? (
          <EmptyState icon="tag" title="No allocations for this event" />
        ) : (
          <ul className="space-y-2" aria-label="Event allocations">
            {allocations.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-inset p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{productName(a.productId)}</p>
                  <p className="text-xs text-faint">
                    Qty {a.quantity}
                    {a.promotional ? ' · promo' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                  {canIssue && a.status === 'reserved' && (
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => openIssue(a)}
                    >
                      Issue
                    </button>
                  )}
                  {canCancel && a.status === 'reserved' && (
                    <button
                      type="button"
                      className="btn-outline btn-sm text-rose-500"
                      onClick={() => void doCancel(a)}
                    >
                      Cancel
                    </button>
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

      <Sheet
        open={reserveOpen}
        onOpenChange={setReserveOpen}
        title="Reserve for this event"
        description={event.name}
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            disabled={!productId}
            onClick={() => void submitReserve()}
          >
            Reserve
          </button>
        }
      >
        <div className="space-y-3">
          <Field label="Product" htmlFor="evt-reserve-product">
            <ProductSelect
              id="evt-reserve-product"
              products={data.products}
              value={productId}
              onChange={setProductId}
            />
          </Field>
          <Field
            label="Quantity"
            htmlFor="evt-reserve-qty"
            hint={productId ? `${available} available to reserve` : undefined}
          >
            <QuantityStepper
              id="evt-reserve-qty"
              aria-label="Quantity"
              value={quantity}
              onChange={setQuantity}
              min={1}
            />
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded"
              checked={promotional}
              onChange={(e) => setPromotional(e.target.checked)}
            />
            <span className="text-sm text-muted">Promotional / give-away</span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>
      </Sheet>

      {/* Issue sheet — issue a reservation directly from the event. */}
      <Sheet
        open={Boolean(issueAlloc)}
        onOpenChange={(o) => !o && setIssueAlloc(null)}
        title="Issue allocation"
        description={issueAlloc ? productName(issueAlloc.productId) : ''}
        footer={
          <button
            type="button"
            className="btn-primary w-full justify-center"
            disabled={issuing || !serialsReady}
            onClick={() => void confirmIssue()}
          >
            {issuing ? 'Issuing…' : 'Confirm issue'}
          </button>
        }
      >
        {issueAlloc && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Qty {issueAlloc.quantity}
              {issueSerialized ? ' · serialized' : ''}
            </p>
            <Field
              label="Issue from location"
              htmlFor="evt-issue-loc"
              hint="Defaults to the site holding stock"
            >
              <select
                id="evt-issue-loc"
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
                htmlFor="evt-issue-bin"
                hint="Storage area to pull stock from"
              >
                <select
                  id="evt-issue-bin"
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
                    : `Select ${issueAlloc.quantity} of ${issueUnits.length} units`
                }
                error={
                  !serialsReady && issueUnits.length < issueAlloc.quantity
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
              </Field>
            )}
            <Field label="Assignee (optional)" htmlFor="evt-issue-assignee">
              <input
                id="evt-issue-assignee"
                className="input"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="e.g. J. Reyes"
              />
            </Field>
          </div>
        )}
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
