import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWarehouse } from "@/app/store";
import type { ReturnSource } from "@/domain/types";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  SectionTitle,
  useToast,
} from "@/components/ui";
import { formatWhen, statusLabel } from "@/domain/format";
import type { Tone } from "@/components/ui";
import { EvidenceCapture } from "@/components/camera/EvidenceCapture";
import { EvidenceGallery } from "@/components/EvidenceGallery";
import { Icon } from "@/components/Icon";
import { ReturnIntakeProduct } from "./ReturnIntakeProduct";
import {
  parseReturnSerials,
  prepareReturnLines,
  type ReturnIntakeLine,
} from "./returnIntake";

const DISPOSITION_META: Record<
  "quarantine" | "hold" | "restock" | "lost" | "vendor_return",
  { label: string; tone: Tone }
> = {
  quarantine: { label: "Quarantined", tone: "amber" },
  hold: { label: "Quality hold", tone: "amber" },
  restock: { label: "Restocked", tone: "emerald" },
  lost: { label: "Written off", tone: "rose" },
  vendor_return: { label: "To vendor", tone: "amber" },
};

// Stored values stay lowercase (existing data); labels render Title Case to
// match the rest of the module's copy (WH-20).
const REASONS: { value: string; label: string }[] = [
  { value: "defective", label: "Defective" },
  { value: "wrong size", label: "Wrong size" },
  { value: "unused / surplus", label: "Unused / surplus" },
  { value: "damaged in transit", label: "Damaged in transit" },
  { value: "recall", label: "Recall" },
  { value: "other", label: "Other" },
];

export function ReturnsPage() {
  const { data, recordReturn, canOpenRoute } = useWarehouse();
  const toast = useToast();
  const [source, setSource] = useState<ReturnSource>("customer");
  const [eventId, setEventId] = useState("");
  const nextLineId = useRef(1);
  const intakeKey = useRef<string | null>(null);
  const [lines, setLines] = useState<ReturnIntakeLine[]>([
    {
      id: 0,
      productId: "",
      quantity: 1,
      reason: REASONS[0]!.value,
      serials: "",
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [evidenceKey, setEvidenceKey] = useState(0);
  const [locationId, setLocationId] = useState("");
  const [binId, setBinId] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);

  if (!data) return null;
  const productName = (id: string) =>
    data.products.find((p) => p.id === id)?.name ?? id;
  const quarantineLocations = data.locations.filter(
    (l) => l.type !== "vendor" && l.active !== false,
  );
  const quarantineBins = (data.storageAreas ?? []).filter(
    (b) => b.locationId === locationId && b.active !== false,
  );
  const prepared = prepareReturnLines(data, lines, eventId);
  const scannedCodes = lines.flatMap((line) =>
    parseReturnSerials(line.serials),
  );
  const canSubmit =
    prepared.lines.length > 0 &&
    (source !== "event" || Boolean(eventId)) &&
    quarantineLocations.some((location) => location.id === locationId) &&
    quarantineBins.some((bin) => bin.id === binId);

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      intakeKey.current ??= `return-intake-${crypto.randomUUID()}`;
      const input = {
        idempotencyKey: intakeKey.current,
        source,
        eventId: eventId || undefined,
        evidenceUrls: evidence,
        lines: prepared.lines.map((line) => ({ ...line, locationId, binId })),
      };
      const ok = await recordReturn(input);
      if (!ok) return;
      intakeKey.current = null;
      toast.success("Return logged in inspection staging");
      setLines([
        {
          id: nextLineId.current++,
          productId: "",
          quantity: 1,
          reason: REASONS[0]!.value,
          serials: "",
        },
      ]);
      setEvidence([]);
      setEvidenceKey((key) => key + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Returns receiving"
        icon="rotate"
        subtitle="Receive customer, vendor, and event stock into a controlled inspection location"
      />

      <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Inspection required before putaway</p>
          <p className="text-xs opacity-80">
            Every physical return remains in quality staging. Quality Control
            chooses the final disposition.
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

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card className="space-y-3">
          <fieldset
            disabled={submitting}
            className="min-w-0 space-y-3"
            aria-label="Return intake"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Return source" htmlFor="ret-source">
                <select
                  id="ret-source"
                  className="input"
                  value={source}
                  onChange={(e) => setSource(e.target.value as ReturnSource)}
                >
                  <option value="customer">Customer</option>
                  <option value="vendor">Vendor</option>
                  <option value="event">Specific event</option>
                </select>
              </Field>
              <Field
                label={
                  source === "event"
                    ? "Return from event"
                    : "Related event (optional)"
                }
                htmlFor="ret-event"
              >
                <select
                  id="ret-event"
                  className="input"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                >
                  <option value="">
                    {source === "event" ? "Select the source event" : "None"}
                  </option>
                  {data.events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label="Quarantine location"
              htmlFor="ret-location"
              hint="Physical custody remains unavailable until Quality Control accepts it."
            >
              <select
                id="ret-location"
                className="input"
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setBinId("");
                }}
              >
                <option value="">Select quarantine location</option>
                {quarantineLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            {locationId && quarantineBins.length > 0 && (
              <Field
                label="Quarantine bin"
                htmlFor="ret-bin"
                hint="Select the exact bin holding this return."
              >
                <select
                  id="ret-bin"
                  className="input"
                  value={binId}
                  onChange={(e) => setBinId(e.target.value)}
                >
                  <option value="">Select quarantine bin</option>
                  {quarantineBins.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code}
                      {b.label ? ` · ${b.label}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {lines.map((line, index) => (
              <ReturnIntakeProduct
                key={line.id}
                data={data}
                line={line}
                index={index}
                eventId={eventId}
                reasons={REASONS}
                scannedCodes={scannedCodes}
                error={prepared.errors[index] ?? null}
                canRemove={lines.length > 1}
                onChange={(changes) =>
                  setLines((current) =>
                    current.map((item) =>
                      item.id === line.id ? { ...item, ...changes } : item,
                    ),
                  )
                }
                onRemove={() =>
                  setLines((current) =>
                    current.filter((item) => item.id !== line.id),
                  )
                }
              />
            ))}
            <button
              type="button"
              className="btn-ghost w-full justify-center"
              onClick={() => {
                const id = nextLineId.current++;
                setLines((current) => [
                  ...current,
                  {
                    id,
                    productId: "",
                    quantity: 1,
                    reason: REASONS[0]!.value,
                    serials: "",
                  },
                ]);
              }}
            >
              <Icon name="plus" /> Add product
            </button>

            <EvidenceCapture
              key={evidenceKey}
              onChange={setEvidence}
              label="Attach return evidence"
            />

            <button
              type="button"
              className="btn-primary w-full"
              disabled={!canSubmit || submitting}
              onClick={() => void submit()}
            >
              {submitting ? "Recording return..." : "Record return"}
            </button>
          </fieldset>
        </Card>

        <Card>
          <SectionTitle title="Recent returns" />
          {data.returns.length === 0 ? (
            <EmptyState icon="rotate" title="No returns recorded yet" />
          ) : (
            <ul className="space-y-2" aria-label="Returns">
              {data.returns
                .slice()
                .reverse()
                .map((r) => (
                  <li key={r.id} className="rounded-xl bg-inset p-3">
                    <div className="flex items-center justify-between">
                      <Badge tone={r.source === "vendor" ? "brand" : "cyan"}>
                        {r.source === "vendor"
                          ? "Vendor"
                          : r.source === "event"
                            ? "Event"
                            : "Customer"}
                      </Badge>
                      <span className="text-xs text-faint">
                        {formatWhen(r.createdAt)}
                      </span>
                    </div>
                    {r.eventId && (
                      <p className="mt-2 break-words text-sm text-muted">
                        {data.events.find((event) => event.id === r.eventId)
                          ?.name ?? r.eventId}
                      </p>
                    )}
                    <ul className="mt-2 space-y-1 text-sm text-muted">
                      {r.lines.map((l, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="min-w-0 break-words">
                            {l.quantity}× {productName(l.productId)} —{" "}
                            <span className="text-faint">
                              {statusLabel(l.reason)}
                            </span>
                            {l.serialNumber && (
                              <span className="block break-all font-mono text-xs">
                                {l.serialNumber}
                              </span>
                            )}
                          </span>
                          <Badge
                            tone={
                              DISPOSITION_META[l.disposition ?? "restock"].tone
                            }
                          >
                            {DISPOSITION_META[l.disposition ?? "restock"].label}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                    {r.evidenceUrls && r.evidenceUrls.length > 0 && (
                      <div className="mt-2">
                        <EvidenceGallery urls={r.evidenceUrls} size="thumb" />
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
