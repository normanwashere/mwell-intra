import { useRef, useState } from "react";
import { parse } from "csv-parse/browser/esm/sync";
import type { Product } from "@intra/data-kit";
import { EmptyState, Field, Sheet, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { useWarehouse } from "@/app/store";

interface CsvOrderRow {
  order_reference?: string;
  customer_reference?: string;
  product_sku?: string;
  quantity?: string;
  bundle_set_codes?: string;
}

interface ImportRow {
  rowNumber: number;
  orderReference: string;
  customerReference: string;
  productId?: string;
  productName: string;
  productSku: string;
  quantity: number;
  bundleSetCodes: string[];
  error?: string;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("File read failed."));
    reader.readAsText(file);
  });
}

function parseOrderCsv(text: string, products: Product[]): ImportRow[] {
  const records = parse(text, {
    columns: (headers: string[]) => headers.map(normalizeHeader),
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvOrderRow[];
  const productBySku = new Map(
    products.map((product) => [product.sku.trim().toLowerCase(), product]),
  );

  return records.map((record, index) => {
    const orderReference = record.order_reference?.trim() ?? "";
    const productSku = record.product_sku?.trim() ?? "";
    const product = productBySku.get(productSku.toLowerCase());
    const quantity = Number(record.quantity);
    const errors = [
      !orderReference ? "Order reference is required" : "",
      !productSku ? "Product SKU is required" : "",
      productSku && !product ? "SKU was not found" : "",
      !Number.isInteger(quantity) || quantity < 1
        ? "Quantity must be a whole number of 1 or more"
        : "",
    ].filter(Boolean);
    return {
      rowNumber: index + 2,
      orderReference,
      customerReference: record.customer_reference?.trim() ?? "",
      productId: product?.id,
      productName: product?.name ?? "Unknown product",
      productSku,
      quantity,
      bundleSetCodes: (record.bundle_set_codes ?? "")
        .split(/[|;]/)
        .map((value) => value.trim())
        .filter(Boolean),
      error: errors.join("; ") || undefined,
    };
  });
}

export function BulkOrderImportSheet({
  open,
  onOpenChange,
  products,
  locations,
  create,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  locations: Array<{ id: string; name: string; type?: string }>;
  create: ReturnType<typeof useWarehouse>["createFulfillmentOrder"];
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [locationId, setLocationId] = useState(
    locations.find((location) => location.type === "warehouse")?.id ?? "",
  );
  const [parseError, setParseError] = useState("");
  const [saving, setSaving] = useState(false);
  const invalidCount = rows.filter((row) => row.error).length;
  const orderCount = new Set(rows.map((row) => row.orderReference).filter(Boolean))
    .size;

  const readFile = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      const nextRows = parseOrderCsv(await readTextFile(file), products);
      if (nextRows.length === 0) throw new Error("The file contains no order lines.");
      setRows(nextRows);
    } catch (error) {
      setRows([]);
      setParseError(
        error instanceof Error ? error.message : "The CSV could not be read.",
      );
    }
  };

  const importOrders = async () => {
    if (rows.length === 0 || invalidCount > 0) return;
    const grouped = new Map<string, ImportRow[]>();
    for (const row of rows) {
      grouped.set(row.orderReference, [
        ...(grouped.get(row.orderReference) ?? []),
        row,
      ]);
    }
    setSaving(true);
    let imported = 0;
    const importedReferences = new Set<string>();
    for (const [reference, orderRows] of grouped) {
      const first = orderRows[0]!;
      const ok = await create({
        source: "ecommerce",
        externalReference: reference,
        customerReference: first.customerReference || undefined,
        requestingDepartment: "sales_ecommerce",
        sourceLocationId: locationId || undefined,
        lines: orderRows.map((row) => ({
          productId: row.productId!,
          quantity: row.quantity,
          bundleSetCodes: row.bundleSetCodes,
        })),
      });
      if (!ok) break;
      imported += 1;
      importedReferences.add(reference);
    }
    setSaving(false);
    if (imported === grouped.size) {
      toast.success(`${imported} order(s) added to the fulfillment queue.`);
      setRows([]);
      setFileName("");
      onOpenChange(false);
    } else {
      setRows((current) =>
        current.filter((row) => !importedReferences.has(row.orderReference)),
      );
      toast.error(
        `${imported} of ${grouped.size} order(s) imported. Only the unprocessed orders remain available to retry.`,
      );
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Import ecommerce order list"
      description="Use the controlled CSV intake while automated ecommerce ingestion is being completed."
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          disabled={saving || rows.length === 0 || invalidCount > 0}
          onClick={() => void importOrders()}
        >
          {saving ? "Importing..." : `Import ${orderCount} order(s)`}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-line bg-inset p-4 text-sm text-muted">
          <p className="font-semibold text-ink">Required CSV columns</p>
          <p className="mt-1">
            <span className="font-mono">order_reference, product_sku, quantity</span>
          </p>
          <p className="mt-2 text-xs">
            Optional: customer_reference and bundle_set_codes. Repeat an order
            reference on another row to add another product to the same order.
            Separate bundle codes with a semicolon.
          </p>
        </div>
        <Field label="Source warehouse" htmlFor="bulk-order-location">
          <select
            id="bulk-order-location"
            className="input"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value="">Assign during allocation</option>
            {locations
              .filter((location) => location.type === "warehouse")
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
          </select>
        </Field>
        <button
          type="button"
          className="btn-outline w-full"
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="upload" /> {fileName || "Choose CSV order list"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Upload ecommerce order list"
          onChange={(event) => void readFile(event.target.files?.[0])}
        />
        {parseError && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
            {parseError}
          </p>
        )}
        {rows.length === 0 ? (
          <EmptyState icon="list" title="No order list selected" />
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="max-h-80 overflow-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="sticky top-0 bg-inset text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Row</th>
                    <th className="px-3 py-2 font-semibold">Order</th>
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 font-semibold">Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row) => (
                    <tr key={`${row.rowNumber}-${row.orderReference}`}>
                      <td className="px-3 py-2 text-muted">{row.rowNumber}</td>
                      <td className="px-3 py-2 font-medium text-ink">
                        {row.orderReference || "Missing"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="block text-ink">{row.productName}</span>
                        <span className="font-mono text-xs text-faint">
                          {row.productSku || "No SKU"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-ink">
                        {Number.isFinite(row.quantity) ? row.quantity : "-"}
                      </td>
                      <td
                        className={`px-3 py-2 text-xs ${
                          row.error
                            ? "text-rose-600 dark:text-rose-300"
                            : "text-emerald-700 dark:text-emerald-300"
                        }`}
                      >
                        {row.error ?? "Ready"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
