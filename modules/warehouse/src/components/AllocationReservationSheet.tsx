import { useRef, useState } from "react";
import { useWarehouse } from "@/app/store";
import { toStockState } from "@/data/repository";
import {
  uncommittedAvailable,
  validateReservation,
} from "@/domain/allocations";
import {
  Field,
  ProductSelect,
  QuantityStepper,
  Sheet,
  useToast,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { expiryStatusForProduct } from "@/components/ExpiryStatus";

type ReservationLine = {
  id: number;
  productId: string;
  quantity: number;
  purpose: "selling" | "giveaway";
};

const emptyLine = (id: number): ReservationLine => ({
  id,
  productId: "",
  quantity: 1,
  purpose: "selling",
});

export function AllocationReservationSheet({
  onClose,
}: {
  onClose: () => void;
}) {
  const { data, reserve, can } = useWarehouse();
  const toast = useToast();
  const [eventId, setEventId] = useState(data?.events[0]?.id ?? "");
  const [lines, setLines] = useState<ReservationLine[]>([emptyLine(1)]);
  const nextId = useRef(2);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;

  const updateLine = (id: number, patch: Partial<ReservationLine>) => {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
    setError(null);
  };

  const submit = async () => {
    if (saving.current || locked || !can("reserve_allocate")) return;
    setError(null);
    if (!data.events.some((event) => event.id === eventId)) {
      setError("Select an event.");
      return;
    }
    const totals = new Map<string, number>();
    for (const [index, line] of lines.entries()) {
      if (!data.products.some((product) => product.id === line.productId)) {
        setError(`Line ${index + 1}: select a product.`);
        return;
      }
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
        setError(
          `Line ${index + 1}: quantity must be a positive whole number.`,
        );
        return;
      }
      totals.set(
        line.productId,
        (totals.get(line.productId) ?? 0) + line.quantity,
      );
    }
    for (const [productId, quantity] of totals) {
      const result = validateReservation(
        toStockState(data),
        data.allocations,
        productId,
        quantity,
      );
      if (!result.ok) {
        setError(
          `${data.products.find((product) => product.id === productId)?.name}: ${result.error}`,
        );
        return;
      }
    }

    saving.current = true;
    setBusy(true);
    setLocked(true);
    let saved = 0;
    try {
      // This API has no stable retry key. Keep uncertain drafts locked until
      // the user closes them and reconciles the recorded allocations.
      for (const line of lines) {
        const ok = await reserve({
          eventId,
          productId: line.productId,
          quantity: line.quantity,
          promotional: line.purpose === "giveaway",
        });
        if (!ok) {
          setError(
            `${saved} line(s) confirmed saved. Remaining lines are unconfirmed. Close this draft and check allocations before creating another reservation.`,
          );
          return;
        }
        saved++;
        setLines((current) => current.filter((item) => item.id !== line.id));
      }
      toast.success(`Reserved ${saved} product line${saved === 1 ? "" : "s"}`);
      onClose();
    } catch (cause) {
      setError(
        `${saved} line(s) confirmed saved. Remaining lines are unconfirmed. Close this draft and check allocations before creating another reservation. ${cause instanceof Error ? cause.message : "Reservation response unavailable."}`,
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving.current) onClose();
      }}
      title="New reservation"
      description="Event stock reservation"
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          disabled={
            busy ||
            locked ||
            !can("reserve_allocate") ||
            !eventId ||
            lines.length === 0 ||
            lines.some((line) => !line.productId)
          }
          onClick={() => void submit()}
        >
          {busy ? "Reserving..." : "Reserve"}
        </button>
      }
    >
      <fieldset disabled={busy || locked} className="min-w-0 space-y-4">
        <Field label="Event" htmlFor="alloc-event">
          <select
            id="alloc-event"
            className="input"
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
          >
            <option value="">Select event</option>
            {data.events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </Field>
        <ol className="divide-y divide-line" aria-label="Reservation lines">
          {lines.map((line, index) => {
            const product = data.products.find(
              (item) => item.id === line.productId,
            );
            const expiry = expiryStatusForProduct(product, data.lots);
            const available = uncommittedAvailable(
              toStockState(data),
              data.allocations,
              line.productId,
            );
            const otherQuantity = lines
              .filter(
                (item) =>
                  item.id !== line.id && item.productId === line.productId,
              )
              .reduce((sum, item) => sum + item.quantity, 0);
            return (
              <li key={line.id} className="space-y-3 py-3 first:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">
                    Product {index + 1}
                  </p>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={lines.length === 1}
                    aria-label={`Remove product ${index + 1}`}
                    title={`Remove product ${index + 1}`}
                    onClick={() =>
                      setLines((current) =>
                        current.filter((item) => item.id !== line.id),
                      )
                    }
                  >
                    <Icon name="x" className="h-4 w-4" />
                  </button>
                </div>
                <Field label="Product" htmlFor={`alloc-product-${line.id}`}>
                  <ProductSelect
                    id={`alloc-product-${line.id}`}
                    products={data.products}
                    value={line.productId}
                    onChange={(productId) => updateLine(line.id, { productId })}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Quantity"
                    htmlFor={`alloc-qty-${line.id}`}
                    hint={
                      line.productId
                        ? `${Math.max(0, available - otherQuantity)} available to reserve`
                        : undefined
                    }
                  >
                    <QuantityStepper
                      id={`alloc-qty-${line.id}`}
                      aria-label="Quantity"
                      value={line.quantity}
                      onChange={(quantity) => updateLine(line.id, { quantity })}
                      min={1}
                    />
                  </Field>
                  <Field label="Purpose" htmlFor={`alloc-purpose-${line.id}`}>
                    <select
                      id={`alloc-purpose-${line.id}`}
                      className="input"
                      value={line.purpose}
                      onChange={(event) =>
                        updateLine(line.id, {
                          purpose: event.target
                            .value as ReservationLine["purpose"],
                        })
                      }
                    >
                      <option value="selling">Selling</option>
                      <option value="giveaway">Giveaway</option>
                    </select>
                  </Field>
                </div>
                {expiry?.risk === "expired" && (
                  <p
                    role="status"
                    className="text-sm text-rose-700 dark:text-rose-300"
                  >
                    Expired lot on hand. Reservation remains available in W1;
                    verify the lot before issue.
                  </p>
                )}
                {expiry?.risk === "warning" && (
                  <p
                    role="status"
                    className="text-sm text-amber-800 dark:text-amber-200"
                  >
                    Near-expiry lot on hand. Verify the lot before issue.
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() =>
            setLines((current) => [...current, emptyLine(nextId.current++)])
          }
        >
          <Icon name="plus" className="h-4 w-4" /> Add product
        </button>
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}
      </fieldset>
    </Sheet>
  );
}
