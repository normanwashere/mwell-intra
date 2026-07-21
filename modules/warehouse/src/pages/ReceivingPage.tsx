import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { Link } from "react-router-dom";
import { useWarehouse } from "@/app/store";
import { actorName, formatWhen } from "@/domain/format";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  ProductSelect,
  QuantityStepper,
  SectionTitle,
  useToast,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BarcodeScanner } from "@/components/camera/BarcodeScanner";
import { EvidenceCapture } from "@/components/camera/EvidenceCapture";
import { EvidenceGallery } from "@/components/EvidenceGallery";

interface Line {
  productId: string;
  quantity: number;
  serials: string[];
  unitCost: string;
  lotCode: string;
  batchNumber: string;
  deviceTestStatus: "not_tested" | "passed" | "failed" | "not_required";
  expiryDate: string;
}

export function ReceivingPage() {
  const { data, receiveStock, canOpenRoute } = useWarehouse();
  const toast = useToast();
  const warehouses = useMemo(
    () => data?.locations.filter((l) => l.type === "warehouse") ?? [],
    [data],
  );
  const [locationId, setLocationId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [actualDeliveryDate, setActualDeliveryDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [deliveryReference, setDeliveryReference] = useState("");
  const [courierOrDriver, setCourierOrDriver] = useState("");
  const [binId, setBinId] = useState("");
  // 390px is scan-first (WH-11): context selects collapse into a summary chip
  // so "Scan to receive" sits above the fold. Desktop always shows them.
  const [contextOpen, setContextOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [newQty, setNewQty] = useState(1);
  const [lines, setLines] = useState<Line[]>([]);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [lastReceiptStaged, setLastReceiptStaged] = useState(false);

  if (!data) return null;
  const products = data.products;
  const activeLocation = locationId || warehouses[0]?.id || "";
  const bins = (data.storageAreas ?? []).filter(
    (b) => b.locationId === activeLocation,
  );
  // Guard against a bin selected for a different warehouse after switching.
  const activeBin = bins.some((b) => b.id === binId) ? binId : "";
  const productById = (id: string) => products.find((p) => p.id === id);
  const selectedProduct = productById(selectedProductId);
  const totalItems = lines.reduce((s, l) => s + l.quantity, 0);

  const addOrIncrement = (productId: string, qty = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === productId ? { ...l, quantity: l.quantity + qty } : l,
        );
      }
      return [
        ...prev,
        {
          productId,
          quantity: qty,
          serials: [],
          unitCost: "",
          lotCode: "",
          batchNumber: "",
          deviceTestStatus: "not_tested",
          expiryDate: "",
        },
      ];
    });
  };

  const setLineField = (
    productId: string,
    field:
      | "unitCost"
      | "lotCode"
      | "batchNumber"
      | "deviceTestStatus"
      | "expiryDate",
    value: string,
  ) => {
    setLines((prev) =>
      prev.map((l) =>
        l.productId === productId ? { ...l, [field]: value } : l,
      ),
    );
  };

  const setLineQuantity = (productId: string, quantity: number) => {
    if (Number.isNaN(quantity) || quantity < 1) return;
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, quantity } : l)),
    );
  };

  const addSelected = () => {
    if (!selectedProduct) return;
    addOrIncrement(selectedProduct.id, Math.max(1, newQty));
    toast.success(`Added ${newQty} × ${selectedProduct.name}`);
    setNewQty(1);
  };

  const addSerial = (productId: string, serial: string) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        if (existing.serials.includes(serial)) return prev;
        const serials = [...existing.serials, serial];
        return prev.map((l) =>
          l.productId === productId
            ? { ...l, serials, quantity: serials.length }
            : l,
        );
      }
      return [
        ...prev,
        {
          productId,
          quantity: 1,
          serials: [serial],
          unitCost: "",
          lotCode: "",
          batchNumber: "",
          deviceTestStatus: "not_tested",
          expiryDate: "",
        },
      ];
    });
  };

  const handleScan = (code: string) => {
    const matched = products.find((p) => p.barcode === code);
    if (matched) {
      setSelectedProductId(matched.id);
      addOrIncrement(matched.id, 1);
      toast.success(`Added ${matched.name}`);
      return;
    }
    const selected = productById(selectedProductId);
    if (selected?.serialized) {
      addSerial(selected.id, code);
      toast.success(`Serial ${code} → ${selected.name}`);
      return;
    }
    toast.error(`Unknown barcode "${code}". Pick a product first.`);
  };

  const removeLine = (productId: string) =>
    setLines((prev) => prev.filter((l) => l.productId !== productId));

  const submit = async () => {
    if (lines.length === 0 || !activeLocation) return;
    const ok = await receiveStock({
      locationId: activeLocation,
      supplierId: supplierId || undefined,
      actualDeliveryDate: actualDeliveryDate || undefined,
      deliveryReference: deliveryReference.trim() || undefined,
      courierOrDriver: courierOrDriver.trim() || undefined,
      evidenceUrls: evidence,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        serialNumbers: l.serials.length ? l.serials : undefined,
        unitCost:
          l.unitCost.trim() !== "" && !Number.isNaN(Number(l.unitCost))
            ? Number(l.unitCost)
            : undefined,
        lotCode: l.lotCode.trim() || undefined,
        batchNumber: l.batchNumber.trim() || undefined,
        deviceTestStatus: l.deviceTestStatus,
        expiryDate: l.expiryDate || undefined,
        binId: activeBin || undefined,
      })),
    });
    if (!ok) return;
    toast.success(`Received ${totalItems} item(s) into inspection staging`);
    setLastReceiptStaged(true);
    setLines([]);
    setEvidence([]);
  };

  return (
    <div
      className={clsx(
        "space-y-4 overflow-x-clip",
        lines.length > 0 && "pb-24 md:pb-0",
      )}
    >
      <PageHeader
        title="Receiving"
        icon="truck"
        subtitle="Scan & tag incoming inventory"
        action={
          canOpenRoute("purchase-orders") ? (
            <Link to="/purchase-orders" className="btn-ghost btn-sm">
              <Icon name="cart" className="h-4 w-4" /> Approved POs
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Clean receipt</p>
          <p className="text-xs opacity-80">
            Accepted quantity and condition need no supervisor approval.
          </p>
        </div>
        {canOpenRoute("storage") && (
          <Link
            to="/storage"
            className="btn-ghost btn-sm shrink-0 justify-center"
          >
            Continue to put away
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Inspection required</p>
          <p className="text-xs opacity-80">
            Damage, shortage, unidentified stock, rejection, or quarantine
            routes to Supervisor control.
          </p>
        </div>
        {canOpenRoute("quality") && (
          <Link
            to="/quality"
            className="btn-ghost btn-sm shrink-0 justify-center"
          >
            Open quality queue
          </Link>
        )}
      </div>
      {lastReceiptStaged && (
        <p
          role="status"
          className="rounded-xl bg-brand-500/10 px-4 py-3 text-sm font-medium text-brand-800 dark:text-brand-200"
        >
          Receipt saved in inspection staging and is ready for quality review.
        </p>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2 lg:items-start">
        {/* Left: capture controls — scan-first (WH-11): the scanner card
            leads; where/who selects collapse into a summary chip on mobile. */}
        <div className="min-w-0 space-y-4">
          <button
            type="button"
            className="flex min-h-11 w-full max-w-full items-start justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-sm lg:hidden"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen((v) => !v)}
          >
            <span className="min-w-0 break-words leading-snug text-muted">
              Receiving into:{" "}
              <span className="font-semibold text-ink">
                {warehouses.find((l) => l.id === activeLocation)?.name ?? "—"}
                {" · "}
                {activeBin
                  ? bins.find((b) => b.id === activeBin)?.code
                  : "General area"}
              </span>
              {supplierId
                ? ` · ${data.suppliers.find((s) => s.id === supplierId)?.name ?? ""}`
                : ""}
            </span>
            <Icon
              name="chevron"
              className={clsx(
                "h-4 w-4 shrink-0 text-faint transition",
                contextOpen ? "-rotate-90" : "rotate-90",
              )}
            />
          </button>

          <Card className="min-w-0 space-y-3 overflow-hidden">
            <Field
              label="Product"
              htmlFor="rcv-product"
              hint="Pick a product and quantity, or scan a barcode. For serialized devices, scan each unit's serial."
            >
              <ProductSelect
                id="rcv-product"
                products={products}
                value={selectedProductId}
                onChange={setSelectedProductId}
              />
            </Field>

            {selectedProduct?.serialized ? (
              <p className="rounded-xl bg-inset px-3 py-2 text-xs text-faint">
                Serialized device — scan each unit's serial below to add it.
              </p>
            ) : (
              <div className="grid min-w-0 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
                <div className="min-w-0">
                  <Field label="Quantity" htmlFor="rcv-qty">
                    <QuantityStepper
                      id="rcv-qty"
                      aria-label="Quantity to add"
                      value={newQty}
                      onChange={setNewQty}
                      min={1}
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className="btn-primary min-w-0 whitespace-nowrap px-3"
                  disabled={!selectedProductId}
                  onClick={addSelected}
                >
                  <Icon name="plus" /> Add to receipt
                </button>
              </div>
            )}

            <BarcodeScanner onDetected={handleScan} label="Scan to receive" />
          </Card>

          <Card
            className={clsx(
              "grid gap-3 sm:grid-cols-2",
              !contextOpen && "hidden lg:grid",
            )}
          >
            <Field label="Receive into" htmlFor="rcv-location">
              <select
                id="rcv-location"
                className="input"
                value={activeLocation}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {warehouses.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Supplier (optional)" htmlFor="rcv-supplier">
              <select
                id="rcv-supplier"
                className="input"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">—</option>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Actual delivery date" htmlFor="rcv-delivery-date">
              <input
                id="rcv-delivery-date"
                type="date"
                className="input"
                value={actualDeliveryDate}
                onChange={(event) => setActualDeliveryDate(event.target.value)}
              />
            </Field>
            <Field label="Delivery reference" htmlFor="rcv-delivery-reference">
              <input
                id="rcv-delivery-reference"
                className="input"
                value={deliveryReference}
                onChange={(event) => setDeliveryReference(event.target.value)}
                placeholder="DR / invoice / shipment number"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Courier or driver" htmlFor="rcv-courier-driver">
                <input
                  id="rcv-courier-driver"
                  className="input"
                  value={courierOrDriver}
                  onChange={(event) => setCourierOrDriver(event.target.value)}
                  placeholder="Courier, driver, or vehicle reference"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field
                label="Put away to"
                htmlFor="rcv-bin"
                hint={
                  bins.length === 0
                    ? "No storage areas set up for this warehouse — stock goes to the general area."
                    : "Scannable bin/shelf where this delivery is stored."
                }
              >
                <select
                  id="rcv-bin"
                  className="input"
                  value={activeBin}
                  onChange={(e) => setBinId(e.target.value)}
                  disabled={bins.length === 0}
                >
                  <option value="">General area (unassigned)</option>
                  {bins.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code}
                      {b.label ? ` · ${b.label}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>
        </div>

        {/* Right: running receipt + evidence */}
        <div className="min-w-0 space-y-4">
          <Card>
            <SectionTitle
              title="Receipt lines"
              action={
                totalItems > 0 ? (
                  <Badge tone="brand">{totalItems} pcs</Badge>
                ) : undefined
              }
            />
            {lines.length === 0 ? (
              <EmptyState icon="truck" title="Nothing scanned yet" />
            ) : (
              <ul className="space-y-2" aria-label="Receipt lines">
                {lines.map((l) => {
                  const p = productById(l.productId)!;
                  return (
                    <li
                      key={l.productId}
                      className="flex items-start justify-between gap-3 rounded-xl bg-inset p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">
                          {p.name}
                        </p>
                        <p className="font-mono text-xs text-faint">{p.sku}</p>
                        {p.serialized ? (
                          <p className="mt-0.5 text-xs text-faint">
                            Qty {l.quantity} • serialized
                          </p>
                        ) : (
                          <div className="mt-2">
                            <QuantityStepper
                              aria-label={`Quantity for ${p.name}`}
                              value={l.quantity}
                              onChange={(q) => setLineQuantity(l.productId, q)}
                              min={1}
                            />
                          </div>
                        )}
                        {l.serials.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {l.serials.map((s) => (
                              <Badge key={s} tone="brand">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <Field
                            label="Unit cost (₱)"
                            htmlFor={`rcv-cost-${l.productId}`}
                          >
                            <input
                              id={`rcv-cost-${l.productId}`}
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              className="input"
                              value={l.unitCost}
                              onChange={(e) =>
                                setLineField(
                                  l.productId,
                                  "unitCost",
                                  e.target.value,
                                )
                              }
                              placeholder={String(p.unitCost)}
                            />
                          </Field>
                          <Field
                            label="Lot code"
                            htmlFor={`rcv-lot-${l.productId}`}
                          >
                            <input
                              id={`rcv-lot-${l.productId}`}
                              className="input"
                              value={l.lotCode}
                              onChange={(e) =>
                                setLineField(
                                  l.productId,
                                  "lotCode",
                                  e.target.value,
                                )
                              }
                              placeholder="optional"
                            />
                          </Field>
                          <Field
                            label="Batch number"
                            htmlFor={`rcv-batch-${l.productId}`}
                          >
                            <input
                              id={`rcv-batch-${l.productId}`}
                              className="input"
                              value={l.batchNumber}
                              onChange={(event) =>
                                setLineField(
                                  l.productId,
                                  "batchNumber",
                                  event.target.value,
                                )
                              }
                              placeholder="Supplier batch"
                            />
                          </Field>
                          <Field
                            label="Device test result"
                            htmlFor={`rcv-test-${l.productId}`}
                          >
                            <select
                              id={`rcv-test-${l.productId}`}
                              className="input"
                              value={l.deviceTestStatus}
                              onChange={(event) =>
                                setLineField(
                                  l.productId,
                                  "deviceTestStatus",
                                  event.target.value,
                                )
                              }
                            >
                              <option value="not_tested">Not tested</option>
                              <option value="passed">Passed</option>
                              <option value="failed">
                                Failed - send to hold
                              </option>
                              <option value="not_required">Not required</option>
                            </select>
                          </Field>
                          {p.expiryTracked && (
                            <div className="sm:col-span-2">
                              <Field
                                label={`Expiry date for ${p.name}`}
                                htmlFor={`rcv-expiry-${l.productId}`}
                              >
                                <input
                                  id={`rcv-expiry-${l.productId}`}
                                  type="date"
                                  className="input"
                                  value={l.expiryDate}
                                  onChange={(event) =>
                                    setLineField(
                                      l.productId,
                                      "expiryDate",
                                      event.target.value,
                                    )
                                  }
                                />
                              </Field>
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-rose-500"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => removeLine(l.productId)}
                      >
                        <Icon name="x" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="space-y-3">
            <SectionTitle
              title="Photo evidence"
              subtitle="Delivery / packing proof"
            />
            <EvidenceCapture onChange={setEvidence} />
          </Card>
        </div>
      </div>

      {/* Sticky action bar */}
      {lines.length > 0 && (
        <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-line bg-surface/95 p-2 shadow-e3 backdrop-blur md:bottom-4">
          <button
            type="button"
            className="btn-primary min-h-12 w-full shadow-pop"
            onClick={() => void submit()}
          >
            Receive {totalItems} item(s)
          </button>
        </div>
      )}

      {/* Receipt history — parity with the Returns recent list. */}
      <Card>
        <SectionTitle
          title="Recent receipts"
          subtitle="Latest deliveries & their evidence"
        />
        {data.receipts.length === 0 ? (
          <EmptyState icon="truck" title="No receipts recorded yet" />
        ) : (
          <ul className="space-y-2" aria-label="Receipts">
            {data.receipts
              .slice()
              .reverse()
              .slice(0, 8)
              .map((r) => {
                const loc = data.locations.find((l) => l.id === r.locationId);
                const sup = data.suppliers.find((s) => s.id === r.supplierId);
                const total = r.lines.reduce((s, l) => s + l.quantity, 0);
                return (
                  <li key={r.id} className="rounded-xl bg-inset p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm font-medium text-ink">
                        {total} item(s) into {loc?.name ?? r.locationId}
                      </span>
                      <span className="text-xs text-faint">
                        {formatWhen(r.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-faint">
                      {sup ? sup.name : "No supplier"} · by {actorName(r.actor)}
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-muted">
                      {r.lines.map((l, i) => {
                        const p = data.products.find(
                          (x) => x.id === l.productId,
                        );
                        return (
                          <li
                            key={i}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="min-w-0 truncate">
                              {l.quantity}× {p?.name ?? l.productId}
                            </span>
                            {l.lotCode && (
                              <Badge tone="slate">{l.lotCode}</Badge>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {r.evidenceUrls && r.evidenceUrls.length > 0 && (
                      <div className="mt-2">
                        <EvidenceGallery urls={r.evidenceUrls} size="thumb" />
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </Card>
    </div>
  );
}
