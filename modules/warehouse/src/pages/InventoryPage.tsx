import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import { can } from '@/auth/roles';
import { toStockState } from '@/data/repository';
import { availableForProduct, isBelowReorder } from '@/domain/stock';
import { groupProductsByFamily, variantLabel } from '@/domain/inventory';
import type { ItemCategory, Product } from '@/domain/types';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  QuantityStepper,
  SegmentedControl,
  Sheet,
  StaggerGrid,
  StaggerItem,
  useToast,
} from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ProductThumb } from '@/components/ProductThumb';
import { ExpiryBadge } from '@/components/ExpiryStatus';
import { clsx } from 'clsx';

type Filter = 'all' | ItemCategory;

export function InventoryPage() {
  const { data, role, createProduct } = useWarehouse();
  const navigate = useNavigate();
  const toast = useToast();
  const canManageProducts = can(role, 'manage_products');
  // Support dashboard deep-links: /inventory?filter=low|device|merchandise
  const [searchParams] = useSearchParams();
  const initialFilter = searchParams.get('filter');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(
    initialFilter === 'device' || initialFilter === 'merchandise'
      ? initialFilter
      : 'all',
  );
  const [lowOnly, setLowOnly] = useState(initialFilter === 'low');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [addOpen, setAddOpen] = useState(false);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ItemCategory>('merchandise');
  const [serialized, setSerialized] = useState(false);
  const [unitCost, setUnitCost] = useState('0');
  const [reorderPoint, setReorderPoint] = useState('0');
  const [barcode, setBarcode] = useState('');
  const [promotional, setPromotional] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const submitAdd = async () => {
    setAddError(null);
    if (!sku.trim()) {
      setAddError('SKU is required.');
      return;
    }
    if (!name.trim()) {
      setAddError('Name is required.');
      return;
    }
    if (data?.products.some((p) => p.sku.toLowerCase() === sku.trim().toLowerCase())) {
      setAddError(`SKU "${sku.trim()}" already exists.`);
      return;
    }
    const ok = await createProduct({
      sku: sku.trim(),
      name: name.trim(),
      category,
      serialized,
      unitCost: Number(unitCost) || 0,
      reorderPoint: Number(reorderPoint) || 0,
      barcode: barcode.trim() || undefined,
      promotional,
    });
    if (!ok) return;
    toast.success(`Added ${name.trim()}`);
    setAddOpen(false);
    setSku('');
    setName('');
    setCategory('merchandise');
    setSerialized(false);
    setUnitCost('0');
    setReorderPoint('0');
    setBarcode('');
    setPromotional(false);
  };

  const state = useMemo(() => (data ? toStockState(data) : null), [data]);

  const families = useMemo(() => {
    if (!data || !state) return [];
    const q = query.trim().toLowerCase();
    const inScope = data.products.filter(
      (p) => filter === 'all' || p.category === filter,
    );
    return groupProductsByFamily(inScope)
      .map((fam) => {
        let shown = q
          ? fam.variants.filter(
              (p) =>
                p.name.toLowerCase().includes(q) ||
                p.sku.toLowerCase().includes(q) ||
                (p.barcode ?? '').includes(q),
            )
          : fam.variants;
        if (lowOnly) {
          shown = shown.filter((p) =>
            isBelowReorder(p, availableForProduct(state, p.id)),
          );
        }
        return { ...fam, isFamily: fam.variants.length > 1, shown };
      })
      .filter((fam) => fam.shown.length > 0);
  }, [data, query, filter, lowOnly, state]);

  if (!data || !state) return null;
  const searching = query.trim().length > 0;

  const avail = (p: Product) => availableForProduct(state, p.id);
  const skuCount = families.reduce((s, f) => s + f.shown.length, 0);
  const lowCount = families.reduce(
    (s, f) => s + f.shown.filter((v) => isBelowReorder(v, avail(v))).length,
    0,
  );
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        icon="box"
        subtitle="Grouped by product family, with sizes & serials"
        action={
          canManageProducts ? (
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => setAddOpen(true)}
            >
              <Icon name="plus" className="h-4 w-4" /> Add product
            </button>
          ) : undefined
        }
      />

      <Card className="space-y-3">
        <Field label="Search">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
              <Icon name="search" />
            </span>
            <input
              className="input pl-10"
              placeholder="Search name, SKU or barcode"
              aria-label="Search inventory"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </Field>
        <SegmentedControl<Filter>
          ariaLabel="Category filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'device', label: 'Devices' },
            { value: 'merchandise', label: 'Merch' },
          ]}
        />
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            aria-pressed={lowOnly}
            onClick={() => setLowOnly((v) => !v)}
            className={clsx(
              'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition',
              lowOnly
                ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
                : 'bg-inset text-muted hover:text-ink',
            )}
          >
            <Icon name="alert" className="h-4 w-4" /> Low stock only
          </button>
          <p className="text-xs text-faint">
            {skuCount} SKU{skuCount === 1 ? '' : 's'}
            {lowCount > 0 && (
              <>
                {' • '}
                <span className="font-semibold text-rose-600 dark:text-rose-300">
                  {lowCount} low
                </span>
              </>
            )}
          </p>
        </div>
      </Card>

      {families.length === 0 ? (
        <EmptyState
          icon="search"
          title={lowOnly ? 'No low-stock items' : 'No matching items'}
        />
      ) : (
        <StaggerGrid
          className="grid min-w-0 gap-2 lg:grid-cols-2"
          aria-label="Inventory list"
        >
          {families.map((fam) => {
            const total = fam.shown.reduce((s, v) => s + avail(v), 0);
            const anyLow = fam.shown.some((v) => isBelowReorder(v, avail(v)));
            const single = fam.shown[0];
            if (!single) return null;

            // Single-product lines behave as a direct link to the product.
            if (!fam.isFamily) {
              const available = avail(single);
              return (
                <StaggerItem key={fam.key}>
                  <button
                    type="button"
                    onClick={() => navigate(`/inventory/${single.id}`)}
                    className="card flex min-w-0 w-full items-center justify-between gap-2 overflow-hidden p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-e3 sm:gap-3"
                  >
                    <ProductThumb
                      product={single}
                      className="h-10 w-10 sm:h-11 sm:w-11"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{single.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone="slate">
                          <span className="block max-w-[7rem] truncate font-mono sm:max-w-none">
                            {single.sku}
                          </span>
                        </Badge>
                        <Badge tone={single.category === 'device' ? 'brand' : 'cyan'}>
                          {single.category}
                        </Badge>
                        {single.serialized && <Badge tone="slate">serialized</Badge>}
                        {single.promotional && <Badge tone="amber">promo</Badge>}
                        <ExpiryBadge product={single} lots={data.lots} />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-right sm:gap-2">
                      <div>
                        <p
                          className={clsx(
                            'tnum text-lg font-extrabold',
                            isBelowReorder(single, available)
                              ? 'text-rose-600 dark:text-rose-300'
                              : 'text-ink',
                          )}
                        >
                          {available}
                        </p>
                        <p className="text-xs text-faint">available</p>
                      </div>
                      <Icon name="chevron" className="h-4 w-4 text-faint" />
                    </div>
                  </button>
                </StaggerItem>
              );
            }

            const isOpen = searching || lowOnly || expanded.has(fam.key);
            return (
              <StaggerItem key={fam.key}>
                <div className="card min-w-0 overflow-hidden !p-0">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(fam.key)}
                    className="flex min-w-0 w-full items-center justify-between gap-2 p-3.5 text-left transition hover:bg-inset sm:gap-3"
                  >
                    <ProductThumb
                      product={fam.variants[0]!}
                      className="h-10 w-10 sm:h-11 sm:w-11"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{fam.label}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone={fam.category === 'device' ? 'brand' : 'cyan'}>
                          {fam.category}
                        </Badge>
                        <Badge tone="slate">{`${fam.variants.length} sizes`}</Badge>
                        {anyLow && <Badge tone="amber">low stock</Badge>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-right sm:gap-2">
                      <div>
                        <p className="tnum text-lg font-extrabold text-ink">{total}</p>
                        {/* One stock noun module-wide (WH-23). */}
                        <p className="text-xs text-faint">available</p>
                      </div>
                      <Icon
                        name="chevron"
                        className={clsx(
                          'h-4 w-4 text-faint transition-transform',
                          isOpen && 'rotate-90',
                        )}
                      />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-line bg-inset/40 p-3">
                      <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
                        {fam.shown.map((v) => {
                          const a = avail(v);
                          const low = isBelowReorder(v, a);
                          return (
                            <li key={v.id} className="min-w-0">
                              <button
                                type="button"
                                onClick={() => navigate(`/inventory/${v.id}`)}
                                className="flex min-w-0 w-full items-center justify-between gap-2 overflow-hidden rounded-xl bg-surface p-2.5 text-left shadow-e1 ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-e2"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-ink">
                                    {variantLabel(v)}
                                  </span>
                                  <span className="block truncate font-mono text-[0.7rem] text-faint">
                                    {v.sku}
                                  </span>
                                </span>
                                <span
                                  className={clsx(
                                    'tnum shrink-0 text-base font-extrabold',
                                    low ? 'text-rose-600 dark:text-rose-300' : 'text-ink',
                                  )}
                                >
                                  {a}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </StaggerItem>
            );
          })}
        </StaggerGrid>
      )}

      <Sheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add product"
        description="Create a new SKU in the product master."
        footer={
          <button type="button" className="btn-primary w-full" onClick={() => void submitAdd()}>
            Create product
          </button>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU" htmlFor="ap-sku" error={addError ?? undefined}>
              <input
                id="ap-sku"
                className="input"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="e.g. ECG-RING-12"
              />
            </Field>
            <Field label="Barcode" htmlFor="ap-barcode">
              <input
                id="ap-barcode"
                className="input"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="EAN / UPC"
              />
            </Field>
          </div>
          <Field label="Name" htmlFor="ap-name">
            <input
              id="ap-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ECG Ring (Size 12)"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" htmlFor="ap-category">
              <select
                id="ap-category"
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value as ItemCategory)}
              >
                <option value="merchandise">Merchandise</option>
                <option value="device">Device</option>
              </select>
            </Field>
            <Field label="Reorder point" htmlFor="ap-reorder">
              <QuantityStepper
                id="ap-reorder"
                aria-label="Reorder point"
                value={Number(reorderPoint) || 0}
                onChange={(v) => setReorderPoint(String(v))}
                min={0}
              />
            </Field>
          </div>
          <Field label="Unit cost (₱)" htmlFor="ap-cost" hint="Landed cost per unit">
            <input
              id="ap-cost"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className="input"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded"
              checked={serialized}
              onChange={(e) => setSerialized(e.target.checked)}
            />
            <span className="text-sm text-muted">Serialized device (unique serial per unit)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded"
              checked={promotional}
              onChange={(e) => setPromotional(e.target.checked)}
            />
            <span className="text-sm text-muted">Promotional / give-away item</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
