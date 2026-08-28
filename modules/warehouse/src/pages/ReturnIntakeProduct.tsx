import { useState } from "react";
import type { WarehouseData } from "@/data/repository";
import { Field, ProductSelect, QuantityStepper } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { WarehouseScanFlow } from "@/components/camera/WarehouseScanFlow";
import type { ReturnIntakeLine } from "./returnIntake";

interface ReturnIntakeProductProps {
  data: WarehouseData;
  line: ReturnIntakeLine;
  index: number;
  eventId: string;
  reasons: readonly { value: string; label: string }[];
  scannedCodes: readonly string[];
  error: string | null;
  canRemove: boolean;
  onChange: (changes: Partial<ReturnIntakeLine>) => void;
  onRemove: () => void;
}

export function ReturnIntakeProduct({
  data,
  line,
  index,
  eventId,
  reasons,
  scannedCodes,
  error,
  canRemove,
  onChange,
  onRemove,
}: ReturnIntakeProductProps) {
  const [scanRevision, setScanRevision] = useState(0);
  const product = data.products.find((item) => item.id === line.productId);
  const prefix = `ret-line-${line.id}`;
  const showError = Boolean(
    error && line.productId && (line.serials.trim() || !product?.serialized),
  );
  return (
    <fieldset
      className="min-w-0 space-y-3 border-t border-line pt-3"
      aria-label={`Return product ${index + 1}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          Product {index + 1}
        </span>
        <button
          type="button"
          className="btn-ghost min-h-11 min-w-11 justify-center"
          aria-label={`Remove product ${index + 1}`}
          title={`Remove product ${index + 1}`}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Icon name="trash" />
        </button>
      </div>
      <Field label="Product" htmlFor={`${prefix}-product`}>
        <ProductSelect
          id={`${prefix}-product`}
          products={data.products}
          value={line.productId}
          onChange={(productId) => onChange({ productId, serials: "" })}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quantity" htmlFor={`${prefix}-qty`}>
          <QuantityStepper
            id={`${prefix}-qty`}
            aria-label="Quantity"
            value={line.quantity}
            onChange={(quantity) => onChange({ quantity })}
            min={1}
          />
        </Field>
        <Field label="Reason" htmlFor={`${prefix}-reason`}>
          <select
            id={`${prefix}-reason`}
            className="input"
            value={line.reason}
            onChange={(event) => onChange({ reason: event.target.value })}
          >
            {reasons.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {product?.serialized && (
        <Field
          label={line.quantity === 1 ? "Serial number" : "Serial numbers"}
          htmlFor={`${prefix}-serial`}
        >
          <textarea
            id={`${prefix}-serial`}
            className="input min-w-0"
            rows={line.quantity === 1 ? 2 : 3}
            value={line.serials}
            aria-invalid={Boolean(error)}
            aria-describedby={showError ? `${prefix}-error` : undefined}
            onChange={(event) => {
              onChange({ serials: event.target.value });
              // Manual corrections replace the scanner's accepted-code history.
              setScanRevision((revision) => revision + 1);
            }}
          />
          <div className="mt-2">
            <WarehouseScanFlow
              key={`${line.productId}-${eventId}-${scanRevision}`}
              data={data}
              context="return"
              expectedProductId={product.id}
              expectedEventId={eventId || undefined}
              scannedCodes={scannedCodes}
              label="Scan return serial"
              onResolved={(resolution) => {
                if (resolution.serialNumber)
                  onChange({
                    serials: [line.serials.trim(), resolution.serialNumber]
                      .filter(Boolean)
                      .join("\n"),
                  });
              }}
            />
          </div>
        </Field>
      )}
      {showError && (
        <p
          id={`${prefix}-error`}
          role="alert"
          className="break-words text-sm text-rose-600 dark:text-rose-300"
        >
          {error}
        </p>
      )}
    </fieldset>
  );
}
