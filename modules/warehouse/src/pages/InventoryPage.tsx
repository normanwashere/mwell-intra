import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWarehouse } from "@/app/store";
import { isBelowReorder } from "@/domain/stock";
import { useInventoryAvailability } from "@/domain/useInventoryAvailability";
import {
  groupProductsByFamily,
  INVENTORY_CATEGORIES,
  inventoryCategory,
  variantLabel,
  type InventoryCategory,
} from "@/domain/inventory";
import {
  requiredSerializationPolicy,
  type ItemCategory,
  type ItemClass,
  type Product,
} from "@/domain/types";
import {
  Badge,
  EmptyState,
  Field,
  PageHeader,
  QuantityStepper,
  Sheet,
  StaggerGrid,
  StaggerItem,
  useToast,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ProductThumb } from "@/components/ProductThumb";
import { ExpiryBadge } from "@/components/ExpiryStatus";
import { BarcodeLabelSheet } from "@/components/BarcodeLabelSheet";
import { InventoryIntegrityPanel } from "@/components/InventoryIntegrityPanel";
import { clsx } from "clsx";

type Filter =
  "all" | InventoryCategory | "legacy-device" | "legacy-merchandise";

const INVENTORY_BATCH_SIZE = 12;

export function InventoryPage() {
  const { data, createProduct, can } = useWarehouse();
  const { totals: availableByProduct, loading: availabilityLoading, error: availabilityError, refresh: refreshAvailability } = useInventoryAvailability();
  const navigate = useNavigate();
  const toast = useToast();
  const canManageProducts = can("manage_products");
  // Preserve operational dashboard links independently of the browsing taxonomy.
  const [searchParams] = useSearchParams();
  const initialFilter = searchParams.get("filter");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(
    initialFilter === "device" || initialFilter === "merchandise"
      ? `legacy-${initialFilter}`
      : "all",
  );
  const [lowOnly, setLowOnly] = useState(initialFilter === "low");
  const [visibleFamilyCount, setVisibleFamilyCount] =
    useState(INVENTORY_BATCH_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ItemCategory>("merchandise");
  const [itemClass, setItemClass] = useState<ItemClass>("merchandise");
  const [uom, setUom] = useState("piece");
  const [serialized, setSerialized] = useState(false);
  const [unitCost, setUnitCost] = useState("0");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [barcode, setBarcode] = useState("");
  const [promotional, setPromotional] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const submitAdd = async () => {
    setAddError(null);
    if (!sku.trim()) {
      setAddError("SKU is required.");
      return;
    }
    if (!name.trim()) {
      setAddError("Name is required.");
      return;
    }
    if (
      data?.products.some(
        (p) => p.sku.toLowerCase() === sku.trim().toLowerCase(),
      )
    ) {
      setAddError(`SKU "${sku.trim()}" already exists.`);
      return;
    }
    const ok = await createProduct({
      sku: sku.trim(),
      name: name.trim(),
      category,
      itemClass,
      uom,
      serialized,
      unitCost: Number(unitCost) || 0,
      reorderPoint: Number(reorderPoint) || 0,
      barcode: barcode.trim() || undefined,
      promotional,
    });
    if (!ok) return;
    toast.success(`Added ${name.trim()}`);
    setAddOpen(false);
    setSku("");
    setName("");
    setCategory("merchandise");
    setItemClass("merchandise");
    setUom("piece");
    setSerialized(false);
    setUnitCost("0");
    setReorderPoint("0");
    setBarcode("");
    setPromotional(false);
  };

  const families = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const inScope = data.products.filter((p) => {
      if (filter === "all") return true;
      if (filter === "legacy-device") return p.category === "device";
      if (filter === "legacy-merchandise") return p.category === "merchandise";
      return inventoryCategory(p) === filter;
    });
    return groupProductsByFamily(inScope)
      .map((fam) => {
        let shown = q
          ? fam.variants.filter(
              (p) =>
                p.name.toLowerCase().includes(q) ||
                p.sku.toLowerCase().includes(q) ||
                (p.barcode ?? "").toLowerCase().includes(q),
            )
          : fam.variants;
        if (lowOnly) {
          shown = availableByProduct ? shown.filter((p) =>
            isBelowReorder(p, availableByProduct.get(p.id) ?? 0),
          ) : [];
        }
        return { ...fam, isFamily: fam.variants.length > 1, shown };
      })
      .filter((fam) => fam.shown.length > 0);
  }, [data, query, filter, lowOnly, availableByProduct]);

  const visibleFamilies = useMemo(
    () => families.slice(0, visibleFamilyCount),
    [families, visibleFamilyCount],
  );
  const hasMoreFamilies = visibleFamilyCount < families.length;

  useEffect(() => {
    setVisibleFamilyCount(INVENTORY_BATCH_SIZE);
  }, [filter, lowOnly, query]);

  useEffect(() => {
    if (!hasMoreFamilies) return;

    const target = loadMoreRef.current;
    if (!target) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisibleFamilyCount(families.length);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisibleFamilyCount((current) =>
          Math.min(current + INVENTORY_BATCH_SIZE, families.length),
        );
      },
      { rootMargin: "480px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [families.length, hasMoreFamilies]);

  if (!data) return null;

  const avail = (p: Product) => availableByProduct ? availableByProduct.get(p.id) ?? 0 : null;
  const isLow = (p: Product) => {
    const available = avail(p);
    return available !== null && isBelowReorder(p, available);
  };
  const unavailableLabel = availabilityLoading ? "Checking" : "Unverified";
  const skuCount = families.reduce((s, f) => s + f.shown.length, 0);
  const lowCount = families.reduce(
    (s, f) => s + f.shown.filter(isLow).length,
    0,
  );
  const productRow = (product: Product) => {
    const available = avail(product);
    const browseCategory = inventoryCategory(product);
    const categoryLabel = INVENTORY_CATEGORIES.find(
      (category) => category.value === browseCategory,
    )!.label;
    const variant = variantLabel(product);
    return (
      <button
        type="button"
        onClick={() => navigate(`/inventory/${product.id}`)}
        className="flex min-w-0 w-full items-center justify-between gap-2 p-3.5 text-left transition hover:bg-inset focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 sm:gap-3"
      >
        <ProductThumb product={product} className="h-10 w-10 sm:h-11 sm:w-11" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold text-ink [overflow-wrap:anywhere]">
            {product.name}
          </p>
          <p className="mt-1 break-words font-mono text-xs text-muted [overflow-wrap:anywhere]">
            {product.sku}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={browseCategory === "uncategorized" ? "amber" : "cyan"}>
              <span className="whitespace-normal break-words">
                {categoryLabel}
              </span>
            </Badge>
            {variant !== "Standard" && (
              <span className="text-xs text-muted">{variant}</span>
            )}
            {product.serialized && <Badge tone="slate">serialized</Badge>}
            {product.promotional && <Badge tone="amber">promo</Badge>}
            <ExpiryBadge product={product} lots={data.lots} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-right sm:gap-2">
          <div>
            <p
              className={clsx(
                available === null ? "text-xs font-semibold" : "tnum text-lg font-extrabold",
                isLow(product)
                  ? "text-rose-600 dark:text-rose-300"
                  : "text-ink",
              )}
            >
              {available ?? unavailableLabel}
            </p>
            <p className="text-xs text-muted">available</p>
          </div>
          <Icon name="chevron" className="h-4 w-4 text-faint" />
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        icon="box"
        action={
          <div className="flex flex-wrap justify-end gap-2">
            {can("manage_inventory") && (
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() => setLabelsOpen(true)}
              >
                <Icon name="tag" className="h-4 w-4" /> Print barcode sheet
              </button>
            )}
            {canManageProducts && (
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => setAddOpen(true)}
              >
                <Icon name="plus" className="h-4 w-4" /> Add product
              </button>
            )}
          </div>
        }
      />

      <InventoryIntegrityPanel
        products={data.products}
        canManage={can("manage_inventory")}
        canApprove={can("approve_stock_adjustment")}
      />

      <section
        aria-label="Inventory filters"
        className="min-w-0 space-y-2 border-y border-line py-2"
      >
        <div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_240px_auto]">
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <Field label="Search" htmlFor="inventory-search">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
                  <Icon name="search" />
                </span>
                <input
                  id="inventory-search"
                  className="input pl-10"
                  placeholder="Search name, SKU or barcode"
                  aria-label="Search inventory"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </Field>
          </div>
          <Field label="Category" htmlFor="inventory-category">
            <select
              id="inventory-category"
              className="input"
              aria-label="Category filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
            >
              <option value="all">All categories</option>
              {filter === "legacy-device" && (
                <option value="legacy-device">Devices (operational)</option>
              )}
              {filter === "legacy-merchandise" && (
                <option value="legacy-merchandise">
                  Merchandise (operational)
                </option>
              )}
              {INVENTORY_CATEGORIES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            aria-pressed={lowOnly}
            disabled={!availableByProduct}
            onClick={() => setLowOnly((v) => !v)}
            className={clsx(
              "inline-flex min-h-11 items-center justify-self-start gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition",
              lowOnly
                ? "bg-amber-500/20 text-amber-800 dark:text-amber-200"
                : "bg-inset text-muted hover:text-ink",
            )}
          >
            <Icon name="alert" className="h-4 w-4" /> Low stock only
          </button>
        </div>
        <p className="text-xs text-faint">
          {lowOnly && !availableByProduct ? "Low-stock count unverified" : `${skuCount} SKU${skuCount === 1 ? "" : "s"}`}
          {lowCount > 0 && (
            <>
              {" • "}
              <span className="font-semibold text-rose-600 dark:text-rose-300">
                {lowCount} low
              </span>
            </>
          )}
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {availabilityLoading && <p role="status" className="text-sm text-muted">Checking inventory availability...</p>}
        {availabilityError && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{availabilityError}</p>}
        <button type="button" className="btn-ghost btn-sm ml-auto" disabled={availabilityLoading} onClick={refreshAvailability}>
          <Icon name="rotate" className="h-4 w-4" /> Refresh availability
        </button>
      </div>

      {lowOnly && !availableByProduct ? null : families.length === 0 ? (
        <EmptyState
          icon="search"
          title={lowOnly ? "No low-stock items" : "No matching items"}
        />
      ) : (
        <StaggerGrid
          className="grid min-w-0 grid-cols-1 gap-2"
          aria-label="Inventory list"
        >
          {visibleFamilies.map((fam) => {
            const total = availableByProduct ? fam.shown.reduce((s, v) => s + (avail(v) ?? 0), 0) : null;
            const anyLow = fam.shown.some(isLow);
            const single = fam.shown[0];
            if (!single) return null;

            if (!fam.isFamily) {
              return (
                <StaggerItem key={fam.key}>
                  <div className="card min-w-0 !p-0">{productRow(single)}</div>
                </StaggerItem>
              );
            }

            return (
              <StaggerItem key={fam.key}>
                <section className="min-w-0">
                  <div className="flex min-w-0 items-center justify-between gap-3 px-3.5 py-2">
                    <div className="min-w-0 flex-1">
                      <h2 className="break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">
                        {fam.label}
                      </h2>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone="slate">
                          {fam.shown.length === fam.variants.length
                            ? `${fam.shown.length} variants`
                            : `${fam.shown.length} of ${fam.variants.length} variants`}
                        </Badge>
                        {anyLow && <Badge tone="amber">low stock</Badge>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-right sm:gap-2">
                      <div>
                        <p className={total === null ? "text-xs font-semibold text-muted" : "tnum text-lg font-extrabold text-ink"}>
                          {total ?? unavailableLabel}
                        </p>
                        {/* One stock noun module-wide (WH-23). */}
                        <p className="text-xs text-muted">available</p>
                      </div>
                    </div>
                  </div>
                  <ul
                    aria-label={`${fam.label} variants`}
                    className="grid min-w-0 grid-cols-1 divide-y divide-line border-y border-line bg-surface"
                  >
                    {fam.shown.map((product) => (
                      <li key={product.id} className="min-w-0">
                        {productRow(product)}
                      </li>
                    ))}
                  </ul>
                </section>
              </StaggerItem>
            );
          })}
        </StaggerGrid>
      )}

      {hasMoreFamilies && (
        <div
          ref={loadMoreRef}
          className="h-px w-full"
          aria-hidden="true"
          data-testid="inventory-load-sentinel"
        />
      )}

      <Sheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add product"
        description="Create a new SKU in the product master."
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => void submitAdd()}
          >
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Item class" htmlFor="ap-item-class">
              <select
                id="ap-item-class"
                className="input"
                value={itemClass}
                onChange={(event) => {
                  const next = event.target.value as ItemClass;
                  const policy = requiredSerializationPolicy(next);
                  setItemClass(next);
                  setSerialized(
                    policy === "required" || policy === "asset_tag",
                  );
                  setCategory(
                    next === "sellable_sku" || next === "re_kitted_item"
                      ? "device"
                      : "merchandise",
                  );
                }}
              >
                <option value="sellable_sku">Sellable SKU</option>
                <option value="merchandise">Merchandise / giveaway</option>
                <option value="event_material">Event material</option>
                <option value="fulfillment_supply">Fulfillment supply</option>
                <option value="warehouse_tool">Warehouse tool</option>
                <option value="re_kitted_item">
                  Re-kitted / open-box item
                </option>
              </select>
            </Field>
            <Field label="Unit of measure" htmlFor="ap-uom">
              <select
                id="ap-uom"
                className="input"
                value={uom}
                onChange={(event) => setUom(event.target.value)}
              >
                <option value="piece">Piece</option>
                <option value="set">Set</option>
                <option value="box">Box</option>
                <option value="pouch">Pouch</option>
                <option value="roll">Roll</option>
                <option value="sheet">Sheet</option>
              </select>
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
          <Field
            label="Unit cost (₱)"
            htmlFor="ap-cost"
            hint="Landed cost per unit"
          >
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
          <p className="rounded-lg bg-inset px-3 py-2 text-sm text-muted">
            {requiredSerializationPolicy(itemClass) === "required"
              ? "One serial is required for every unit in this item class."
              : requiredSerializationPolicy(itemClass) === "asset_tag"
                ? "Every reusable tool requires its own asset tag."
                : "This item is monitored by quantity and barcode."}
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded"
              checked={promotional}
              onChange={(e) => setPromotional(e.target.checked)}
            />
            <span className="text-sm text-muted">
              Promotional / give-away item
            </span>
          </label>
        </div>
      </Sheet>
      <BarcodeLabelSheet
        open={labelsOpen}
        onOpenChange={setLabelsOpen}
        products={data.products}
      />
    </div>
  );
}
