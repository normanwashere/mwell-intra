import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { useWarehouse } from '@/app/store';
import { toStockState } from '@/data/repository';
import { stockByBin } from '@/domain/storage';
import { groupProductsByFamily, variantLabel } from '@/domain/inventory';
import type { ItemCategory } from '@/domain/types';
import { Badge, Card, Field, PageHeader, SectionTitle, useToast } from '@/components/ui';
import { Icon } from '@/components/Icon';

export function CycleCountsPage() {
  const { data, submitNewCycleCount } = useWarehouse();
  const toast = useToast();
  const warehouses = useMemo(
    () => data?.locations.filter((l) => l.type === 'warehouse') ?? [],
    [data],
  );
  const [locationId, setLocationId] = useState('');
  const [binId, setBinId] = useState('');
  const [category, setCategory] = useState<ItemCategory>('merchandise');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [serialInputs, setSerialInputs] = useState<Record<string, string>>({});
  const [blind, setBlind] = useState(false);
  const [confirmUncounted, setConfirmUncounted] = useState(false);
  const [search, setSearch] = useState('');
  const [searchParams] = useSearchParams();
  const [variancesOnly, setVariancesOnly] = useState(
    searchParams.get('filter') === 'variances',
  );

  if (!data) return null;
  const activeLocation = locationId || warehouses[0]?.id || '';
  const state = toStockState(data);
  const bins = (data.storageAreas ?? []).filter(
    (b) => b.locationId === activeLocation,
  );
  const activeBin = bins.some((b) => b.id === binId) ? binId : '';
  const scope = activeBin || undefined;

  // Expected reflects the selected storage-area scope (bin, or the general area).
  const expectedForScope = (productId: string): number => {
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
    setCount(productId, Number.isNaN(n) ? 0 : Math.max(0, n));
  };
  const onSerialChange = (productId: string, raw: string) => {
    setSerialInputs((previous) => ({ ...previous, [productId]: raw.toUpperCase() }));
  };

  const serialTokens = (id: string) => (serialInputs[id] ?? '')
    .split(/[\s,]+/)
    .map((serial) => serial.trim())
    .filter(Boolean);
  const isSerialized = (id: string) => data.products.find((product) => product.id === id)?.serialized ?? false;
  const isCounted = (id: string) => isSerialized(id)
    ? Object.prototype.hasOwnProperty.call(serialInputs, id)
    : counts[id] !== undefined;
  const countedFor = (id: string, expected: number) => isSerialized(id)
    ? (isCounted(id) ? serialTokens(id).length : expected)
    : (counts[id] ?? expected);
  const expectedSerials = (id: string) => new Set(data.units
    .filter((unit) => unit.productId === id && unit.locationId === activeLocation
      && (unit.binId ?? undefined) === scope && ['in_stock', 'returned'].includes(unit.status))
    .map((unit) => unit.serialNumber));
  const serialIssues = items.flatMap(({ product }) => {
    if (!product.serialized || !isCounted(product.id)) return [];
    const tokens = serialTokens(product.id);
    const duplicates = tokens.filter((serial, index) => tokens.indexOf(serial) !== index);
    const expectedSet = expectedSerials(product.id);
    const unexpected = tokens.filter((serial) => !expectedSet.has(serial));
    return [...new Set([...duplicates, ...unexpected])].map((serial) => ({ product: product.name, serial }));
  });
  const firstMissing = items.find(({ product, expected }) =>
    product.serialized && isCounted(product.id) && countedFor(product.id, expected) < expected);
  // Blind mode records only entered rows. In normal mode the whole sheet is
  // recorded — untouched rows fall back to expected, which the submit flow
  // makes the operator explicitly confirm below.
  const lines = items
    .filter(({ product }) => (blind || product.serialized) ? isCounted(product.id) : true)
    .map(({ product, expected }) => ({
      productId: product.id,
      expected,
      counted: countedFor(product.id, expected),
      ...(product.serialized ? { serialNumbers: serialTokens(product.id) } : {}),
    }));
  const variances = lines.filter((l) => l.counted !== l.expected);
  const enteredCount = items.filter((i) => isCounted(i.product.id)).length;
  const uncounted = items.length - enteredCount;

  const q = search.trim().toLowerCase();
  const isVisible = (id: string, name: string, sku: string, expected: number) => {
    if (q && !(name.toLowerCase().includes(q) || sku.toLowerCase().includes(q)))
      return false;
    if (variancesOnly && (!isCounted(id) || countedFor(id, expected) === expected)) return false;
    return true;
  };

  const expectedById = new Map(items.map((i) => [i.product.id, i.expected]));
  const families = groupProductsByFamily(items.map((i) => i.product));

  const submit = async () => {
    const ok = await submitNewCycleCount({
      locationId: activeLocation,
      binId: scope,
      category,
      lines,
      reason: blind ? 'Blind cycle count' : 'Scheduled cycle count',
    });
    if (!ok) return;
    toast.success(
      variances.length > 0
        ? `${variances.length} variance(s) · Awaiting Warehouse Supervisor`
        : 'Count completed · balanced',
    );
    setCounts({});
    setSerialInputs({});
    setConfirmUncounted(false);
  };

  // Submitting with silently-uncounted rows needs an explicit confirmation
  // ("8 rows not counted — submit anyway?", WH-18).
  const onSubmitClick = () => {
    if (!blind && category !== 'device' && uncounted > 0) {
      setConfirmUncounted(true);
      return;
    }
    void submit();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cycle Counts"
        icon="clipboard"
        subtitle="Count by category & reconcile variances"
      />

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
              setSerialInputs({});
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
              setSerialInputs({});
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
                  setCounts({});
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
            variances.length > 0 ? (
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
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                  blind
                    ? 'bg-brand-500/20 text-brand-800 dark:text-brand-200'
                    : 'bg-inset text-muted hover:text-ink',
                )}
              >
                <Icon name="clipboard" className="h-4 w-4" /> Blind count
              </button>
              <button
                type="button"
                aria-pressed={variancesOnly}
                onClick={() => setVariancesOnly((v) => !v)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                  variancesOnly
                    ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
                    : 'bg-inset text-muted hover:text-ink',
                )}
              >
                <Icon name="alert" className="h-4 w-4" /> Variances only
              </button>
            </div>
            <p className="text-xs text-faint">
              {enteredCount}/{items.length} counted
            </p>
          </div>
          {serialIssues.length > 0 ? (
            <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300">
              Unexpected serial {serialIssues[0]!.serial} for {serialIssues[0]!.product}. Receive or relocate it before submitting this count.
            </p>
          ) : firstMissing ? (
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
                <th className="py-2 text-right">Var.</th>
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
                          colSpan={4}
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
                          <td className="py-2 text-right">
                            {product.serialized ? (
                              <input
                                type="text"
                                className="input min-w-52 py-1.5"
                                aria-label={`Scanned serials ${product.name}`}
                                placeholder="Scan or enter serials"
                                value={serialInputs[product.id] ?? ''}
                                onChange={(e) => onSerialChange(product.id, e.target.value)}
                              />
                            ) : (
                              <input
                                type="number"
                                inputMode="numeric"
                                className="input w-24 py-1.5 text-right"
                                aria-label={`Counted ${product.name}`}
                                placeholder={blind ? '—' : `Exp. ${expected}`}
                                value={counts[product.id] ?? ''}
                                min={0}
                                onChange={(e) => onCountChange(product.id, e.target.value)}
                              />
                            )}
                          </td>
                          <td
                            className={
                              !has || variance === 0
                                ? 'py-2 text-right tabular-nums text-faint'
                                : 'py-2 text-right font-semibold tabular-nums text-rose-600 dark:text-rose-300'
                            }
                          >
                            {!has ? '—' : variance === 0 ? '±0' : variance > 0 ? `+${variance}` : variance}
                          </td>
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
                        <span
                          className={clsx(
                            'shrink-0 rounded-md px-2 py-1 text-xs font-semibold tabular-nums',
                            !has || variance === 0
                              ? 'bg-inset text-faint'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
                          )}
                          aria-label="Variance"
                        >
                          {!has ? 'Var —' : variance === 0 ? '±0' : variance > 0 ? `+${variance}` : variance}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-faint">
                          Expected{' '}
                          <span className="font-semibold tabular-nums text-muted">
                            {blind ? '—' : expected}
                          </span>
                        </span>
                        <label className="flex items-center gap-2">
                          <span className="text-xs text-faint">Counted</span>
                          {product.serialized ? (
                            <input
                              type="text"
                              className="input min-h-11 min-w-0 flex-1"
                              aria-label={`${product.name} scanned serials`}
                              placeholder="Scan serials"
                              value={serialInputs[product.id] ?? ''}
                              onChange={(e) => onSerialChange(product.id, e.target.value)}
                            />
                          ) : (
                            <input
                              type="number"
                              inputMode="numeric"
                              className="input min-h-11 w-24 text-right"
                              aria-label={`${product.name} counted quantity`}
                              placeholder={blind ? '—' : `Exp. ${expected}`}
                              value={counts[product.id] ?? ''}
                              min={0}
                              onChange={(e) => onCountChange(product.id, e.target.value)}
                            />
                          )}
                        </label>
                      </div>
                    </li>
                  );
                })}
              </Fragment>
            );
          })}
        </ul>
      </Card>

      <div className="space-y-2">
        {confirmUncounted && (
          <div
            role="alertdialog"
            aria-label="Confirm uncounted rows"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 shadow-pop backdrop-blur"
          >
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {uncounted} row{uncounted === 1 ? '' : 's'} not counted — they
              will be recorded at the expected quantity. Submit anyway?
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm flex-1 justify-center"
                onClick={() => setConfirmUncounted(false)}
              >
                Keep counting
              </button>
              <button
                type="button"
                className="btn-primary btn-sm flex-1 justify-center"
                onClick={() => void submit()}
              >
                Submit anyway
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          className="btn-primary w-full shadow-pop"
          // An explicit entry is always required — no more one-tap "perfect
          // count" (WH-18).
          disabled={enteredCount === 0 || serialIssues.length > 0}
          onClick={onSubmitClick}
        >
          Submit count ({enteredCount}/{items.length})
        </button>
      </div>
    </div>
  );
}
