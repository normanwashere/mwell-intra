import { useEffect, useRef, useState } from "react";
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
import type { ReserveBatchInput } from "@intra/data-kit";

type ReservationCommand = Omit<ReserveBatchInput, "actor">;

function loadCommand(key: string): ReservationCommand | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as ReservationCommand;
  if (
    !value ||
    typeof value.eventId !== "string" ||
    !/^[A-Za-z0-9_-]{12,128}$/.test(value.idempotencyKey) ||
    !Array.isArray(value.lines) ||
    !value.lines.length ||
    value.lines.some(
      (line) =>
        !line ||
        typeof line.productId !== "string" ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        typeof line.promotional !== "boolean",
    )
  ) {
    throw new Error(
      "Saved reservation recovery data is invalid. Contact support before creating another reservation.",
    );
  }
  return value;
}

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
  selectedEventId,
}: {
  onClose: () => void;
  selectedEventId?: string;
}) {
  const { source, identityId, data } = useWarehouse();
  const recoveryKey = `warehouse.reservation.v1:${source}:${identityId}`;
  if (!data) return null;
  return (
    <ReservationEditor
      key={`${recoveryKey}:${selectedEventId ?? ""}`}
      {...{ onClose, selectedEventId, recoveryKey }}
    />
  );
}

function ReservationEditor({
  onClose,
  selectedEventId,
  recoveryKey,
}: {
  onClose: () => void;
  selectedEventId?: string;
  recoveryKey: string;
}) {
  const { data, reserveBatch, can } = useWarehouse();
  const toast = useToast();
  const [recovery] = useState(() => {
    try {
      return { command: loadCommand(recoveryKey), error: null };
    } catch (cause) {
      return {
        command: null,
        error:
          cause instanceof Error
            ? cause.message
            : "Reservation recovery storage is unavailable.",
      };
    }
  });
  const [pending, setPending] = useState<ReservationCommand | null>(
    recovery.command,
  );
  const [eventId, setEventId] = useState(
    recovery.command?.eventId ?? selectedEventId ?? data?.events[0]?.id ?? "",
  );
  const [lines, setLines] = useState<ReservationLine[]>(
    () =>
      recovery.command?.lines.map((line, index) => ({
        id: index + 1,
        productId: line.productId,
        quantity: line.quantity,
        purpose: line.promotional ? "giveaway" : "selling",
      })) ?? [emptyLine(1)],
  );
  const nextId = useRef(lines.length + 1);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(recovery.error);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  const [submissionAttempt, setSubmissionAttempt] = useState(0);
  useEffect(() => {
    if (error) errorSummary.current?.focus();
  }, [error, submissionAttempt]);
  const locked = Boolean(pending || recovery.error);
  if (!data) return null;

  const updateLine = (id: number, patch: Partial<ReservationLine>) => {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
    setError(null);
  };

  const submit = async () => {
    if (saving.current || recovery.error || !can("reserve_allocate")) return;
    setSubmissionAttempt((attempt) => attempt + 1);
    setError(null);
    if (!pending) {
      if (!data.events.some((event) => event.id === eventId && !["closed", "cancelled"].includes(event.status ?? "planned"))) {
        setError("Select an open event. Ask the event owner to reopen closed or cancelled events.");
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
    }

    saving.current = true;
    setBusy(true);
    try {
      if (
        pending &&
        window.localStorage.getItem(recoveryKey) !== JSON.stringify(pending)
      ) {
        throw new Error(
          "Reservation recovery changed in another tab. Close and reopen this sheet to load the latest command.",
        );
      }
      const command = pending ??
        loadCommand(recoveryKey) ?? {
          idempotencyKey: `reservation-${crypto.randomUUID()}`,
          eventId,
          lines: lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            promotional: line.purpose === "giveaway",
          })),
        };
      // Persist the immutable intent before dispatch. An uncertain response may
      // only replay this payload, including after navigation or a reload.
      const savedCommand = JSON.stringify(command);
      window.localStorage.setItem(recoveryKey, savedCommand);
      setPending(command);
      setEventId(command.eventId);
      setLines(
        command.lines.map((line, index) => ({
          id: index + 1,
          productId: line.productId,
          quantity: line.quantity,
          purpose: line.promotional ? "giveaway" : "selling",
        })),
      );
      nextId.current = command.lines.length + 1;
      const result = await reserveBatch(command);
      // A late response belongs to this command, not a newer tab's intent.
      if (window.localStorage.getItem(recoveryKey) === savedCommand) {
        window.localStorage.removeItem(recoveryKey);
      } else if (result.status === "rejected") {
        throw new Error(
          "Reservation recovery changed in another tab. Close and reopen this sheet to load the latest command.",
        );
      }
      if (result.status === "rejected") {
        setPending(null);
        setError(`Nothing was reserved. ${result.error}`);
        return;
      }
      toast.success(
        `Reserved ${result.allocations.length} product line${result.allocations.length === 1 ? "" : "s"}`,
      );
      onClose();
    } catch (cause) {
      setError(
        `Reservation not confirmed. Recover the original reservation before starting another. ${cause instanceof Error ? cause.message : "Reservation response unavailable."}`,
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
        <div className="min-w-0 w-full space-y-2">
          {error && (
            <p
              ref={errorSummary}
              tabIndex={-1}
              role="alert"
              className="break-words text-sm text-rose-600 dark:text-rose-300"
            >
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn-primary w-full"
            disabled={
              busy ||
              Boolean(recovery.error) ||
              !can("reserve_allocate") ||
              !eventId ||
              lines.length === 0 ||
              lines.some((line) => !line.productId)
            }
            onClick={() => void submit()}
          >
            {busy
              ? "Reserving..."
              : pending
                ? "Recover reservation"
                : "Reserve"}
          </button>
        </div>
      }
    >
      {pending && (
        <p
          role="status"
          className="mb-3 text-sm text-amber-800 dark:text-amber-200"
        >
          An earlier reservation is awaiting confirmation. Its event and product
          lines are locked until recovery completes.
        </p>
      )}
      <fieldset disabled={busy || locked} className="min-w-0 space-y-4">
        <Field label="Event" htmlFor="alloc-event">
          <select
            id="alloc-event"
            className="input"
            value={eventId}
            disabled={Boolean(selectedEventId)}
            onChange={(event) => setEventId(event.target.value)}
          >
            <option value="">Select event</option>
            {data.events.map((event) => (
              <option key={event.id} value={event.id} disabled={!pending && ["closed", "cancelled"].includes(event.status ?? "planned")}>
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
      </fieldset>
    </Sheet>
  );
}
