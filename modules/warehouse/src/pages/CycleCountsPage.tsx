import { Fragment, useMemo, useRef, useState } from 'react';
import { userFacingError } from '@intra/ui';
import { Link, useSearchParams } from 'react-router-dom';
import { tasksReturnPath } from '@/domain/taskNavigation';
import { clsx } from 'clsx';
import { useWarehouse } from '@/app/store';
import { toStockState } from '@/data/repository';
import { stockByBin } from '@/domain/storage';
import { groupProductsByFamily, variantLabel } from '@/domain/inventory';
import type { ItemCategory } from '@/domain/types';
import { Badge, Card, Field, PageHeader, SectionTitle, useToast } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { WarehouseScanFlow } from '@/components/camera/WarehouseScanFlow';
import { EvidenceCapture } from '@/components/camera/EvidenceCapture';
import { useCycleCountRecord } from '@/domain/useCycleCountRecord';
import { completeCycleCountIntent, cycleCountIntentKey, readCycleCountIntent, retainCycleCountIntent, type CycleCountCommand } from '@/domain/cycleCountIntent';

export function CycleCountsPage() {
  const { source, identityId } = useWarehouse();
  return <CycleCountSheet key={`${source}:${identityId}`} />;
}

function CycleCountSheet() {
  const { data, submitNewCycleCount, getCycleCount, source, identityId, actor } = useWarehouse();
  const toast = useToast();
  const storageKey = cycleCountIntentKey(source, identityId);
  const [recovery] = useState(() => {
    try { return { command: readCycleCountIntent(storageKey), error: '' }; }
    catch (error) { return { command: null, error: error instanceof Error ? error.message : 'Saved count is unavailable.' }; }
  });
  const [pending, setPending] = useState<CycleCountCommand | null>(recovery.command);
  const pendingRef = useRef(pending);
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [rejection, setRejection] = useState('');
  const locked = Boolean(pending) || Boolean(recovery.error);
  const warehouses = useMemo(
    () => data?.locations.filter((l) => l.type === 'warehouse') ?? [],
    [data],
  );
  const [locationId, setLocationId] = useState(pending?.locationId ?? '');
  const [binId, setBinId] = useState(pending?.binId ?? '');
  const [category, setCategory] = useState<ItemCategory>(pending?.category ?? 'merchandise');
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(
    pending?.lines.filter(line => !line.serialNumbers).map(line => [line.productId, line.counted]) ?? [],
  ));
  const [serialInputs, setSerialInputs] = useState<Record<string, string>>(() => Object.fromEntries(
    pending?.lines.filter(line => line.serialNumbers).map(line => [line.productId, line.serialNumbers!.join(', ')]) ?? [],
  ));
  const [lotInputs, setLotInputs] = useState<Record<string, Record<string, number>>>(() => Object.fromEntries(
    pending?.lines.filter(line => line.lotCounts).map(line => [line.productId,
      Object.fromEntries(line.lotCounts!.map(lot => [JSON.stringify(lot.lotId), lot.counted])),
    ]) ?? [],
  ));
  const [blind, setBlind] = useState(pending?.reason === 'Blind cycle count');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>(pending?.evidenceUrls ?? []);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceVersion, setEvidenceVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [searchParams] = useSearchParams();
  const [variancesOnly, setVariancesOnly] = useState(
    searchParams.get('filter') === 'variances',
  );
  const sourceId = searchParams.get('count') ?? searchParams.get('source');
  const sourceCount = useCycleCountRecord(sourceId);

  if (!data) return null;
  if (sourceId) {
    const record = sourceCount.record;
    return <div className="space-y-4">
      <PageHeader title="Cycle count record" icon="clipboard" subtitle={sourceId} />
      <Link className="btn-ghost" to={tasksReturnPath(searchParams)}>Back to tasks</Link>
      {sourceCount.loading ? <p role="status">Loading source count...</p> : sourceCount.error ? <div role="alert"><p>{sourceCount.error}</p><button type="button" className="btn-ghost mt-2" onClick={sourceCount.retry}>Retry source count</button></div> : record ? <section className="rounded-lg border border-line bg-surface p-4">
        <p className="font-semibold">{data.locations.find(l => l.id === record.locationId)?.name ?? record.locationId} · {record.status ?? 'Recorded'}</p>
        <p className="mt-1 break-all text-sm text-muted">{record.actor} · {record.createdAt.slice(0, 10)}</p>
        <ul className="mt-4 divide-y divide-line">{record.lines.map((line, index) => <li key={`${line.productId}-${index}`} className="py-3">
          <p className="font-medium">{data.products.find(p => p.id === line.productId)?.name ?? line.productId}</p>
          <p className="text-sm">Expected {line.expected} · Counted {line.counted} · Variance {line.counted - line.expected}</p>
        </li>)}</ul>
      </section> : <p role="status">This count is unavailable or outside your access. No new count was opened.</p>}
    </div>;
  }
  const activeLocation = locationId || warehouses[0]?.id || '';
  const state = toStockState(data);
  const bins = (data.storageAreas ?? []).filter(
    (b) => b.locationId === activeLocation,
  );
  const activeBin = pending ? pending.binId ?? '' : bins.some((b) => b.id === binId) ? binId : '';
  const scope = activeBin || undefined;
  const lotsFor = (productId: string): (string | null)[] => {
    const retained = pending?.lines.find(line => line.productId === productId)?.lotCounts;
    if (retained) return retained.map(lot => lot.lotId);
    return [...new Set(data.stockLevels.filter(row => row.productId === productId
      && row.locationId === activeLocation && (row.binId ?? undefined) === scope)
      .map(row => row.lotId ?? null))];
  };
  const needsLotCounts = (id: string) => lotsFor(id).length > 1;

  // Expected reflects the selected storage-area scope (bin, or the general area).
  const expectedForScope = (productId: string): number => {
    const retainedLine = pending?.lines.find(line => line.productId === productId);
    if (retainedLine) return retainedLine.expected;
    const product = data.products.find((row) => row.id === productId);
    if (product?.serialized) {
      return data.units.filter((unit) =>
        unit.productId === productId &&
        unit.locationId === activeLocation &&
        (unit.binId ?? undefined) === scope &&
        ['in_stock', 'returned'].includes(unit.status)).length;
    }
    const byBin = stockByBin(state, productId, activeLocation);
    return byBin.find((b) => (b.binId ?? undefined) === scope)?.quantity ?? 0;
  };

  const items = data.products
    .filter((p) => p.category === category)
    .map((p) => ({
      product: p,
      expected: expectedForScope(p.id),
    }));

  const setCount = (id: string, v: number) =>
    setCounts((prev) => ({ ...prev, [id]: v }));
  const clearCount = (id: string) =>
    setCounts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  // Counted quantities NEVER prefill with the expected number — a count must
  // be an explicit entry, otherwise one tap submits a fake "perfect count"
  // (WH-18). Clearing the input un-counts the row in every mode.
  const onCountChange = (productId: string, raw: string) => {
    if (raw === '') {
      clearCount(productId);
      return;
    }
    const n = Number(raw);
    setCount(productId, n);
  };
  const onSerialChange = (productId: string, raw: string) => {
    setSerialInputs((previous) => {
      const next = { ...previous };
      if (raw.split(/[\s,]+/).some(Boolean)) next[productId] = raw.toUpperCase();
      else delete next[productId];
      return next;
    });
  };

  const serialTokens = (id: string) => (serialInputs[id] ?? '')
    .split(/[\s,]+/)
    .map((serial) => serial.trim())
    .filter(Boolean);
  const isSerialized = (id: string) => data.products.find((product) => product.id === id)?.serialized ?? false;
  const isCounted = (id: string) => isSerialized(id)
    ? Object.prototype.hasOwnProperty.call(serialInputs, id)
    : needsLotCounts(id) ? lotsFor(id).every(lotId => lotInputs[id]?.[JSON.stringify(lotId)] !== undefined)
    : counts[id] !== undefined;
  const countedFor = (id: string, _expected: number) => isSerialized(id)
    ? serialTokens(id).length
    : needsLotCounts(id) ? lotsFor(id).reduce((total, lotId) => total + (lotInputs[id]?.[JSON.stringify(lotId)] ?? 0), 0)
    : (counts[id] ?? 0);
  const incompleteLots = items.some(({ product }) => !product.serialized && needsLotCounts(product.id)
    && lotsFor(product.id).some(lotId => lotInputs[product.id]?.[JSON.stringify(lotId)] !== undefined) && !isCounted(product.id));
  const invalidQuantities = [...Object.values(counts), ...Object.values(lotInputs).flatMap(Object.values)]
    .some(value => !Number.isSafeInteger(value) || value < 0);
  const hasLotVariance = (id: string) => !isSerialized(id) && needsLotCounts(id) && isCounted(id)
    && lotsFor(id).some(lotId => lotInputs[id]?.[JSON.stringify(lotId)] !== data.stockLevels
      .filter(row => row.productId === id && row.locationId === activeLocation
        && (row.binId ?? undefined) === scope && (row.lotId ?? null) === lotId)
      .reduce((sum, row) => sum + row.quantity, 0));
  const hasVariance = (id: string, expected: number) => countedFor(id, expected) !== expected || hasLotVariance(id);
  const expectedSerials = (id: string) => new Set(data.units
    .filter((unit) => unit.productId === id && unit.locationId === activeLocation
      && (unit.binId ?? undefined) === scope && ['in_stock', 'returned'].includes(unit.status))
    .map((unit) => unit.serialNumber));
  const serialIssues = pending ? [] : items.flatMap(({ product }) => {
    if (!product.serialized || !isCounted(product.id)) return [];
    const tokens = serialTokens(product.id);
    const duplicates = tokens.filter((serial, index) => tokens.indexOf(serial) !== index);
    const expectedSet = expectedSerials(product.id);
    const unexpected = tokens.filter((serial) => !expectedSet.has(serial));
    return [...new Set([...duplicates, ...unexpected])].map((serial) => ({ product: product.name, serial }));
  });
  const firstMissing = items.find(({ product, expected }) =>
    product.serialized && isCounted(product.id) && countedFor(product.id, expected) < expected);
  // Blank rows are not observations, in either normal or blind mode.
  const lines = items
    .filter(({ product }) => isCounted(product.id))
    .map(({ product, expected }) => ({
      productId: product.id,
      expected,
      counted: countedFor(product.id, expected),
      ...(product.serialized ? { serialNumbers: serialTokens(product.id) } : {}),
      ...(!product.serialized && needsLotCounts(product.id) ? {
        lotCounts: lotsFor(product.id).map(lotId => ({ lotId, counted: lotInputs[product.id]![JSON.stringify(lotId)]! })),
      } : {}),
    }));
  const variances = lines.filter((line) => hasVariance(line.productId, line.expected));
  const enteredCount = items.filter((i) => isCounted(i.product.id)).length;
  const uncounted = items.length - enteredCount;

  const q = search.trim().toLowerCase();
  const isVisible = (id: string, name: string, sku: string, expected: number) => {
    if (q && !(name.toLowerCase().includes(q) || sku.toLowerCase().includes(q)))
      return false;
    if (!blind && variancesOnly && (!isCounted(id) || !hasVariance(id, expected))) return false;
    return true;
  };

  const expectedById = new Map(items.map((i) => [i.product.id, i.expected]));
  const families = groupProductsByFamily(items.map((i) => i.product));
  const lotCountControls = (id: string, name: string) => <div className="min-w-0 space-y-2">
    {lotsFor(id).map(lotId => {
      const key = JSON.stringify(lotId);
      const label = lotId === null ? 'Unlotted' : data.lots.find(lot => lot.id === lotId)?.lotCode ?? lotId;
      return <label key={key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-left text-xs">
        <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{label}</span>
        <input type="number" inputMode="numeric" min={0} step={1}
          className="input min-h-11 w-24 text-right" aria-label={`${name} lot ${label} counted`}
          value={lotInputs[id]?.[key] ?? ''} placeholder="Count"
          onChange={event => {
            const raw = event.target.value;
            setLotInputs(previous => {
              const next = { ...previous[id] };
              if (raw === '') delete next[key];
              else next[key] = Number(raw);
              return { ...previous, [id]: next };
            });
          }} />
      </label>;
    })}
  </div>;
  const zeroSerialControl = (id: string, name: string) => <label className="mt-1 flex min-h-11 items-center gap-2 text-xs text-muted">
    <input type="checkbox" aria-label={`${name} no units found`} checked={isCounted(id) && serialTokens(id).length === 0}
      onChange={(event) => {
        if (event.target.checked) setSerialInputs(previous => ({ ...previous, [id]: '' }));
        else onSerialChange(id, '');
      }} />
    No units found
  </label>;

  const submit = async () => {
    if (sendingRef.current || evidenceBusy || recovery.error) return;
    if (!pendingRef.current && (enteredCount === 0 || incompleteLots || invalidQuantities || serialIssues.length > 0 || evidenceUrls.length === 0)) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const command = retainCycleCountIntent(storageKey, pendingRef.current ?? {
        idempotencyKey: `atomic-count-${crypto.randomUUID()}`,
        cycleCountId: `cc-${crypto.randomUUID()}`,
        actor,
        requesterId: identityId,
        locationId: activeLocation,
        binId: scope,
        category,
        lines,
        reason: blind ? 'Blind cycle count' : 'Scheduled cycle count',
        evidenceUrls,
      });
      pendingRef.current = command;
      setPending(command);
      setRejection('');
      const outcome = await submitNewCycleCount(command);
      if (outcome.status === 'rejected') {
        completeCycleCountIntent(storageKey, command);
        pendingRef.current = null;
        setPending(null);
        setRejection(userFacingError(outcome.message));
        return;
      }
      if (outcome.status !== 'committed') return;
      const saved = await getCycleCount(command.cycleCountId);
      if (!saved && source === 'supabase') {
        throw new Error('Count accepted, but its saved record could not be read. Retry this same count to confirm its status.');
      }
      completeCycleCountIntent(storageKey, command);
      const varianceCount = command.lines.filter(line => line.counted !== line.expected).length;
      toast.success(saved?.status === 'rejected' ? 'Saved count was rejected. No new count was submitted.'
        : saved?.status === 'pending_approval' || saved?.status === 'submitted' ? 'Count saved · Awaiting Warehouse Supervisor'
        : saved?.status === 'approved' && varianceCount > 0 ? 'Saved count was already approved. No new adjustment was requested.'
        : varianceCount > 0
        ? `${varianceCount} variance(s) · Awaiting Warehouse Supervisor`
        : 'Count completed · balanced');
      pendingRef.current = null;
      setPending(null);
      setCounts({});
      setLotInputs({});
      setSerialInputs({});
      setEvidenceUrls([]);
      setEvidenceVersion((version) => version + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not retain the count. No new command was created.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cycle Counts"
        icon="clipboard"
        subtitle="Count by category & reconcile variances"
      />

      <div className="rounded-xl border border-line bg-inset/50 px-4 py-3 text-sm text-muted">
        <p className="font-semibold text-ink">Balanced counts close without approval.</p>
        <p className="mt-0.5 text-xs">A material variance requires a different Warehouse Supervisor; the counter cannot approve it, including through delegation.</p>
      </div>

      {recovery.error && <p role="alert">{recovery.error}</p>}
      {rejection && <p role="alert" className="break-words text-sm text-danger">Count not submitted. {rejection}</p>}
      {pending && <div role="status" className="break-words rounded-lg border border-amber-500/40 p-3 text-sm">
        <p>{sending ? 'Confirming saved count...' : 'Count outcome unconfirmed. Retry the saved count before starting another.'}</p>
        <p className="break-all font-mono text-xs">{pending.cycleCountId}</p>
      </div>}
      <fieldset disabled={locked} className="min-w-0 space-y-4">
      <Card className="grid gap-3 sm:grid-cols-2">
        <Field label="Location" htmlFor="cc-location">
          <select
            id="cc-location"
            className="input"
            value={activeLocation}
            onChange={(e) => {
              setLocationId(e.target.value);
              setBinId('');
              setCounts({});
              setLotInputs({});
              setSerialInputs({});
              setEvidenceUrls([]);
              setEvidenceVersion((version) => version + 1);
            }}
          >
            {warehouses.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category" htmlFor="cc-category">
          <select
            id="cc-category"
            className="input"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as ItemCategory);
              setCounts({});
              setLotInputs({});
              setSerialInputs({});
              setEvidenceUrls([]);
              setEvidenceVersion((version) => version + 1);
            }}
          >
            <option value="merchandise">Merchandise</option>
            <option value="device">Devices</option>
          </select>
        </Field>
        {category === 'device' && (
          <div
            role="note"
            className="sm:col-span-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Devices are serialized. A short count writes off the missing
              serial(s) on reconciliation; extra units found must be
              received/registered individually — they can't be added by a number.
            </span>
          </div>
        )}
        {category === 'device' && !locked && (
          <div className="sm:col-span-2">
            <WarehouseScanFlow
              key={`${activeLocation}:${scope ?? 'general'}:${evidenceVersion}`}
              data={data}
              context="count"
              expectedLocationId={activeLocation}
              expectedBinId={scope ?? null}
              scannedCodes={Object.values(serialInputs).flatMap((value) =>
                value.split(/[\s,]+/).filter(Boolean),
              )}
              label="Scan counted device"
              onResolved={(resolution) => {
                if (!resolution.serialNumber) return;
                setSerialInputs((current) => {
                  const existing = current[resolution.productId]?.trim();
                  return {
                    ...current,
                    [resolution.productId]: existing
                      ? `${existing}, ${resolution.serialNumber}`
                      : resolution.serialNumber!,
                  };
                });
              }}
            />
          </div>
        )}
        {bins.length > 0 && (
          <div className="sm:col-span-2">
            <Field
              label="Storage area"
              htmlFor="cc-bin"
              hint="Count one bin at a time for accurate per-bin quantities."
            >
              <select
                id="cc-bin"
                className="input"
                value={activeBin}
                onChange={(e) => {
                  setBinId(e.target.value);
                  setEvidenceUrls([]);
                  setEvidenceVersion((version) => version + 1);
                  setCounts({});
                  setLotInputs({});
                  setSerialInputs({});
                }}
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
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Count sheet"
          action={
            // "Balanced" is only earned by real entries — before anyone
            // counts, the sheet is simply "not started" (WH-18).
            blind ? (
              <Badge tone="slate">{enteredCount > 0 ? 'in progress' : 'not started'}</Badge>
            ) : variances.length > 0 ? (
              <Badge tone="amber">{variances.length} variance(s)</Badge>
            ) : enteredCount > 0 ? (
              <Badge tone="emerald">balanced</Badge>
            ) : (
              <Badge tone="slate">not started</Badge>
            )
          }
        />

        <div className="mb-3 space-y-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <input
              className="input pl-10"
              placeholder="Find an item by name or SKU"
              aria-label="Search count sheet"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={blind}
                onClick={() => setBlind((v) => !v)}
                className={clsx(
                  'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition',
                  blind
                    ? 'bg-brand-500/20 text-brand-800 dark:text-brand-200'
                    : 'bg-inset text-muted hover:text-ink',
                )}
              >
                <Icon name="clipboard" className="h-4 w-4" /> Blind count
              </button>
              {!blind && <button
                type="button"
                aria-pressed={variancesOnly}
                onClick={() => setVariancesOnly((v) => !v)}
                className={clsx(
                  'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition',
                  variancesOnly
                    ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
                    : 'bg-inset text-muted hover:text-ink',
                )}
              >
                <Icon name="alert" className="h-4 w-4" /> Variances only
              </button>}
            </div>
            <p className="text-xs text-faint">
              {enteredCount}/{items.length} counted
            </p>
          </div>
          {serialIssues.length > 0 ? (
            <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300">
              Unexpected serial {serialIssues[0]!.serial} for {serialIssues[0]!.product}. Receive or relocate it before submitting this count.
            </p>
          ) : !blind && firstMissing ? (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200">
              {firstMissing.expected - countedFor(firstMissing.product.id, firstMissing.expected)} missing for {firstMissing.product.name}.
            </p>
          ) : null}
        </div>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Expected</th>
                <th className="py-2 text-right">Counted</th>
                {!blind && <th className="py-2 text-right">Var.</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {families.map((fam) => {
                const grouped = fam.variants.length > 1;
                const visible = fam.variants.filter((p) =>
                  isVisible(p.id, p.name, p.sku, expectedById.get(p.id) ?? 0),
                );
                if (visible.length === 0) return null;
                return (
                  <Fragment key={fam.key}>
                    {grouped && (
                      <tr>
                        <td
                          colSpan={blind ? 3 : 4}
                          className="bg-inset/60 py-1.5 pl-1 text-xs font-semibold uppercase tracking-wide text-muted"
                        >
                          {fam.label}
                        </td>
                      </tr>
                    )}
                    {visible.map((product) => {
                      const expected = expectedById.get(product.id) ?? 0;
                      const has = isCounted(product.id);
                      const variance = countedFor(product.id, expected) - expected;
                      return (
                        <tr key={product.id}>
                          <td className={grouped ? 'py-2 pl-3 pr-2' : 'py-2 pr-2'}>
                            <span className="block font-medium text-ink">
                              {grouped ? variantLabel(product) : product.name}
                            </span>
                            <span className="font-mono text-xs text-faint">
                              {product.sku}
                            </span>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {blind ? '—' : expected}
                          </td>
                          <td className="py-2 pl-3 text-right">
                            {product.serialized ? (
                              <div>
                              <input
                                type="text"
                                className="input min-w-52 py-1.5"
                                aria-label={`Scanned serials ${product.name}`}
                                placeholder="Scan or enter serials"
                                value={serialInputs[product.id] ?? ''}
                                onChange={(e) => onSerialChange(product.id, e.target.value)}
                              />
                              {zeroSerialControl(product.id, product.name)}
                              </div>
                            ) : needsLotCounts(product.id) ? lotCountControls(product.id, product.name) : (
                              <input
                                type="number"
                                inputMode="numeric"
                                className="input w-24 py-1.5 text-right"
                                aria-label={`Counted ${product.name}`}
                                placeholder={blind ? '—' : 'Count'}
                                value={counts[product.id] ?? ''}
                                min={0}
                                onChange={(e) => onCountChange(product.id, e.target.value)}
                              />
                            )}
                          </td>
                          {!blind && <td
                            className={
                              !has || !hasVariance(product.id, expected)
                                ? 'py-2 text-right tabular-nums text-faint'
                                : 'py-2 text-right font-semibold tabular-nums text-rose-600 dark:text-rose-300'
                            }
                          >
                            {!has ? '—' : variance === 0 ? hasLotVariance(product.id) ? 'Lot differences' : '±0' : variance > 0 ? `+${variance}` : variance}
                          </td>}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile: stacked cards so counting on a phone doesn't require
            horizontal-scrolling a table while editing tiny inputs. */}
        <ul className="space-y-2 sm:hidden" aria-label="Count sheet">
          {families.map((fam) => {
            const grouped = fam.variants.length > 1;
            const visible = fam.variants.filter((p) =>
              isVisible(p.id, p.name, p.sku, expectedById.get(p.id) ?? 0),
            );
            if (visible.length === 0) return null;
            return (
              <Fragment key={fam.key}>
                {grouped && (
                  <li className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {fam.label}
                  </li>
                )}
                {visible.map((product) => {
                  const expected = expectedById.get(product.id) ?? 0;
                  const has = isCounted(product.id);
                  const variance = countedFor(product.id, expected) - expected;
                  return (
                    <li
                      key={product.id}
                      className="rounded-xl border border-line bg-inset/40 p-3"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-ink">
                            {grouped ? variantLabel(product) : product.name}
                          </span>
                          <span className="font-mono text-xs text-faint">
                            {product.sku}
                          </span>
                        </div>
                        {!blind && <span
                          className={clsx(
                            'shrink-0 rounded-md px-2 py-1 text-xs font-semibold tabular-nums',
                            !has || !hasVariance(product.id, expected)
                              ? 'bg-inset text-faint'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
                          )}
                          aria-label="Variance"
                        >
                          {!has ? 'Var —' : variance === 0 ? hasLotVariance(product.id) ? 'Lot differences' : '±0' : variance > 0 ? `+${variance}` : variance}
                        </span>}
                      </div>
                      <div className={clsx('flex gap-3', !product.serialized && needsLotCounts(product.id) ? 'flex-col' : 'items-center justify-between')}>
                        <span className="text-xs text-faint">
                          Expected{' '}
                          <span className="font-semibold tabular-nums text-muted">
                            {blind ? '—' : expected}
                          </span>
                        </span>
                        <div className={clsx('flex min-w-0 gap-2', !product.serialized && needsLotCounts(product.id) ? 'w-full flex-col' : 'items-center')}>
                          <span className="text-xs text-faint">Counted</span>
                          {product.serialized ? (
                            <div className="min-w-0 flex-1">
                            <input
                              type="text"
                              className="input min-h-11 w-full min-w-0"
                              aria-label={`${product.name} scanned serials`}
                              placeholder="Scan serials"
                              value={serialInputs[product.id] ?? ''}
                              onChange={(e) => onSerialChange(product.id, e.target.value)}
                            />
                            {zeroSerialControl(product.id, product.name)}
                            </div>
                          ) : needsLotCounts(product.id) ? lotCountControls(product.id, product.name) : (
                            <input
                              type="number"
                              inputMode="numeric"
                              className="input min-h-11 w-24 text-right"
                              aria-label={`${product.name} counted quantity`}
                              placeholder={blind ? '—' : 'Count'}
                              value={counts[product.id] ?? ''}
                              min={0}
                              onChange={(e) => onCountChange(product.id, e.target.value)}
                            />
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </Fragment>
            );
          })}
        </ul>
      </Card>

      <Card className="space-y-2">
        <SectionTitle title="Count evidence" />
        <p className="text-sm text-muted">
          Attach a clear photo of the count sheet, rack, or bin before submitting.
        </p>
        <EvidenceCapture
          reference={`cycle-count/${activeLocation}/${scope ?? 'general'}/${evidenceVersion}`}
          value={evidenceUrls}
          onBusyChange={setEvidenceBusy}
          key={evidenceVersion}
          label="Attach cycle-count evidence"
          onChange={(urls) => {
            setEvidenceUrls(urls);
          }}
        />
        {evidenceUrls.length === 0 && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
            Evidence is required to create and submit this count atomically.
          </p>
        )}
      </Card>
      </fieldset>

      <div className="space-y-2">
        {invalidQuantities && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">Enter whole-number quantities of zero or more.</p>}
        {incompleteLots && <p role="alert" className="text-sm text-amber-800 dark:text-amber-200">Enter each receipt-lot count for the started item, including zero when none were found.</p>}
        {uncounted > 0 && <p className="text-sm text-muted">{uncounted} row{uncounted === 1 ? '' : 's'} not counted. Only entered observations will be submitted.</p>}
        <button
          type="button"
          className="btn-primary w-full shadow-pop"
          // An explicit entry is always required — no more one-tap "perfect
          // count" (WH-18).
          disabled={sending || Boolean(recovery.error) || evidenceBusy || (!pending && (enteredCount === 0 || incompleteLots || invalidQuantities || serialIssues.length > 0 || evidenceUrls.length === 0))}
          onClick={() => void submit()}
        >
          {sending ? 'Confirming count...' : pending ? 'Retry saved count' : `Submit count (${enteredCount}/${items.length})`}
        </button>
      </div>
    </div>
  );
}
