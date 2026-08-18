import { useRef, useState } from "react";
import type { Product } from "@intra/data-kit";
import { EmptyState, Field, Sheet, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { useWarehouse } from "@/app/store";
import {
  groupEcommerceImportRows,
  parseEcommerceOrderCsv,
  type EcommerceImportRow,
} from "@/domain/ecommerceOrderImport";
import { trackerTemplateCsv } from "@/domain/orderIntakeOptions";

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed."));
    reader.readAsText(file);
  });
}

export function BulkOrderImportSheet({
  open,
  onOpenChange,
  products,
  locations,
  existingReferences,
  create,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  locations: Array<{ id: string; name: string; type?: string }>;
  existingReferences: string[];
  create: ReturnType<typeof useWarehouse>["createFulfillmentOrder"];
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<EcommerceImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [locationId, setLocationId] = useState(
    locations.find((location) => location.type === "warehouse")?.id ?? "",
  );
  const [parseError, setParseError] = useState("");
  const [saving, setSaving] = useState(false);
  const invalidCount = rows.filter((row) => row.error).length;
  const orderCount = new Set(
    rows.map((row) => row.orderReference).filter(Boolean),
  ).size;

  const readFile = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      const nextRows = parseEcommerceOrderCsv(
        await readTextFile(file),
        products,
        existingReferences,
      );
      if (nextRows.length === 0)
        throw new Error("The file contains no order lines.");
      setRows(nextRows);
    } catch (error) {
      setRows([]);
      setParseError(
        error instanceof Error ? error.message : "The CSV could not be read.",
      );
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(
      new Blob([trackerTemplateCsv()], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "mwell-intra-ecommerce-order-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const importOrders = async () => {
    if (rows.length === 0 || invalidCount > 0) return;
    const grouped = groupEcommerceImportRows(rows);
    setSaving(true);
    let imported = 0;
    const importedReferences = new Set<string>();
    for (const order of grouped) {
      const ok = await create({
        source: "ecommerce",
        ...order,
        requestingDepartment: "sales_ecommerce",
        sourceLocationId: locationId || undefined,
      });
      if (!ok) break;
      imported += 1;
      importedReferences.add(order.externalReference);
    }
    setSaving(false);
    if (imported === grouped.length) {
      toast.success(`${imported} order(s) added to the fulfillment queue.`);
      setRows([]);
      setFileName("");
      onOpenChange(false);
    } else {
      setRows((current) =>
        current.filter((row) => !importedReferences.has(row.orderReference)),
      );
      toast.error(
        `${imported} of ${grouped.length} order(s) imported. Only the unprocessed orders remain available to retry.`,
      );
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Import ecommerce order list"
      description="Use CSV only to migrate existing tracker records. New orders should be created directly in Intra."
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
          <p className="font-semibold text-ink">
            Transition existing tracker records
          </p>
          <p className="mt-1 text-xs leading-5">
            Required: order reference, channel, customer name and contact,
            complete delivery address, payment status, product SKU, and
            quantity. Accepted payment states are paid, authorized, and COD.
          </p>
          <p className="mt-2 text-xs">
            Tracker headings such as Order No, Date, Customer, Contact No, Area
            of Delivery, Event Name, SKU, Qty, Price, RRN, Maya Method and
            Status, Other Fees, Courier, Tracking No, and Delivery Link are
            recognized. Repeat an order number for each item. After migration,
            Intra is the authoritative order record.
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
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className="btn-outline w-full"
            onClick={downloadTemplate}
          >
            <Icon name="download" /> Download CSV template
          </button>
          <button
            type="button"
            className="btn-outline w-full"
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" /> {fileName || "Choose exported tracker CSV"}
          </button>
        </div>
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
              <table className="w-full min-w-[58rem] text-left text-sm">
                <thead className="sticky top-0 bg-inset text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Row</th>
                    <th className="px-3 py-2 font-semibold">Order</th>
                    <th className="px-3 py-2 font-semibold">Channel</th>
                    <th className="px-3 py-2 font-semibold">Customer</th>
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 font-semibold">
                      Commercial / dispatch
                    </th>
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
                      <td className="px-3 py-2 text-ink">
                        {row.ecommerceChannel || "Missing"}
                      </td>
                      <td className="px-3 py-2 text-ink">
                        <span className="block">
                          {row.customerName || "Missing"}
                        </span>
                        <span className="text-xs text-faint">
                          {row.paymentStatus || "No payment status"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="block text-ink">
                          {row.productName}
                        </span>
                        <span className="font-mono text-xs text-faint">
                          {row.productSku || "No SKU"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-ink">
                        {Number.isFinite(row.quantity) ? row.quantity : "-"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">
                        <span className="block">
                          {row.reportedTotalAmount !== undefined
                            ? `PHP ${row.reportedTotalAmount.toLocaleString("en-PH")}`
                            : "Calculated after import"}
                        </span>
                        <span className="block text-faint">
                          {[row.courier, row.waybillNumber]
                            .filter(Boolean)
                            .join(" / ") || "Dispatch pending"}
                        </span>
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
