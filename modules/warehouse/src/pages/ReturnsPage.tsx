import { useRef, useState, type SetStateAction } from "react";
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
import { IntakeDraftActions, matchesDraftShape, useIntakeDraft, useIntakeScope } from "@/components/fulfillment/intakeDraft";
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

type ReturnCommand = Parameters<ReturnType<typeof useWarehouse>["recordReturn"]>[0];
interface ReturnDraft {
  source: ReturnSource;
  eventId: string;
  locationId: string;
  binId: string;
  lines: ReturnIntakeLine[];
  evidence: string[];
  pending: ReturnCommand | null;
}

const emptyReturnDraft = (): ReturnDraft => ({
  source: "customer", eventId: "", locationId: "", binId: "", evidence: [], pending: null,
  lines: [{ id: 0, productId: "", quantity: 1, reason: REASONS[0]!.value, serials: "" }],
});

function isReturnDraft(value: unknown): value is ReturnDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as ReturnDraft;
  return matchesDraftShape({ ...draft, pending: null }, { ...emptyReturnDraft(), evidence: [""] }) &&
    ["customer", "vendor", "event"].includes(draft.source) && draft.lines.length > 0 &&
    (draft.pending === null || (
      matchesDraftShape(draft.pending, {
        idempotencyKey: "", source: "", evidenceUrls: [""],
        lines: [{ productId: "", quantity: 1, reason: "", locationId: "", binId: "", disposition: "" }],
      }) && /^return-intake-[A-Za-z0-9-]+$/.test(draft.pending.idempotencyKey ?? "") &&
      draft.pending.lines.length > 0
    ));
}

export function ReturnsPage() {
  const scope = useIntakeScope("return:new");
  return scope ? <ReturnsIntake key={scope} scope={scope} /> : null;
}

function ReturnsIntake({ scope }: { scope: string }) {
  const { data, recordReturnOutcome, canOpenRoute } = useWarehouse();
  const toast = useToast();
  const draft = useIntakeDraft(scope, emptyReturnDraft(), isReturnDraft, (value) => !!value.pending);
  const { source, eventId, locationId, binId, lines, evidence, pending } = draft.value;
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const evidenceBusyRef = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [savedReturnId, setSavedReturnId] = useState<string | null>(null);
  const [rejectionConfirmed, setRejectionConfirmed] = useState(false);
  const [rejectionMessage, setRejectionMessage] = useState("");
  const locked = submitting || !!pending || draft.needsResume || draft.conflict || confirmed;
  const setField = <K extends keyof ReturnDraft>(key: K, value: SetStateAction<ReturnDraft[K]>) => {
    if (inFlight.current || draft.current.current.pending || confirmed) return;
    draft.update((current) => ({ ...current, [key]: typeof value === "function" ? (value as (previous: ReturnDraft[K]) => ReturnDraft[K])(current[key]) : value }));
  };
  const setLines = (value: SetStateAction<ReturnIntakeLine[]>) => setField("lines", value);
  const changeContext = (changes: Partial<Pick<ReturnDraft, "source" | "eventId" | "locationId" | "binId">>) => {
    if (locked || inFlight.current) return;
    draft.update((current) => ({ ...current, ...changes, evidence: [] }));
  };

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
    (!eventId || data.events.some((event) => event.id === eventId)) &&
    quarantineLocations.some((location) => location.id === locationId) &&
    quarantineBins.some((bin) => bin.id === binId);

  const submit = async () => {
    if (inFlight.current || evidenceBusyRef.current || locked || !canSubmit) return;
    setRejectionMessage("");
    const input: ReturnCommand = {
      idempotencyKey: `return-intake-${crypto.randomUUID()}`,
      source,
      eventId: eventId || undefined,
      evidenceUrls: [...evidence],
      lines: prepared.lines.map((line) => ({ ...line, locationId, binId })),
    };
    // Persist the exact command before any network call, including reload in flight.
    if (!draft.replace({ ...draft.value, pending: input }, true)) return;
    await send(input, false);
  };

  const releaseRejectedDraft = () => {
    const saved = draft.replace({ ...draft.current.current, pending: null }, true);
    setRejectionConfirmed(!saved);
  };

  const send = async (input: ReturnCommand, recovery = true) => {
    if (inFlight.current || evidenceBusyRef.current || draft.conflict || draft.needsResume) return;
    if (!draft.replace({ ...draft.current.current, pending: input }, true)) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const outcome = await recordReturnOutcome(JSON.parse(JSON.stringify(input)) as ReturnCommand);
      if (outcome.status === "rejected") {
        if (!draft.mounted.current) return;
        if (!recovery) {
          setRejectionMessage("Return rejected. Correct the draft before submitting again.");
          releaseRejectedDraft();
        } else {
          setRejectionMessage("Recovery was rejected. The earlier return outcome is still unknown; its original intent remains locked.");
        }
        return;
      }
      if (outcome.status !== "success") return;
      const cleaned = draft.clear({ ...emptyReturnDraft(), source, eventId, locationId, binId });
      if (!draft.mounted.current) return;
      setConfirmed(!cleaned);
      setSavedReturnId(outcome.record.id);
      toast.success("Return logged in inspection staging");
    } catch (error) {
      if (draft.mounted.current) toast.error(error instanceof Error ? error.message : "Return result could not be confirmed.");
    } finally {
      inFlight.current = false;
      if (draft.mounted.current) setSubmitting(false);
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
          <IntakeDraftActions draft={{ ...draft, resume: () => {
            const resumed = draft.resume();
            if (resumed) { setConfirmed(false); setRejectionConfirmed(false); setRejectionMessage(""); }
            return resumed;
          } }} busy={submitting || evidenceBusy} locked={!!pending} />
          {savedReturnId && <a className="text-sm underline" href={`#return-${savedReturnId}`}>View saved return</a>}
          {rejectionMessage && <p role="status" className="text-sm">{rejectionMessage}</p>}
          {pending && <div className="space-y-2" role="status">
            <p className="text-sm">{confirmed ? "Return confirmed. Draft cleanup is still required." : rejectionConfirmed ? "Return rejected. Save the editable draft before continuing." : "Return outcome unknown. The original quantity, serials, and evidence are locked until recovery."}</p>
            <button type="button" className="btn-primary" disabled={submitting || evidenceBusy || draft.conflict} onClick={() => {
              if (confirmed) { if (draft.clear()) setConfirmed(false); }
              else if (rejectionConfirmed) releaseRejectedDraft();
              else void send(pending);
            }}>{submitting ? "Recovering..." : confirmed ? "Retry draft cleanup" : rejectionConfirmed ? "Save rejected draft" : "Recover original result"}</button>
          </div>}
          <fieldset
            disabled={locked}
            className="min-w-0 space-y-3"
            aria-label="Return intake"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Return source" htmlFor="ret-source">
                <select
                  id="ret-source"
                  className="input"
                  value={source}
                  onChange={(e) => changeContext({ source: e.target.value as ReturnSource })}
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
                  onChange={(e) => changeContext({ eventId: e.target.value })}
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
                  changeContext({ locationId: e.target.value, binId: "" });
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
                  onChange={(e) => changeContext({ binId: e.target.value })}
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
                const id = Math.max(...lines.map((line) => line.id)) + 1;
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
              key={draft.generation}
              value={evidence}
              reference={`return-${encodeURIComponent(scope)}-${draft.generation}-${source}-${eventId}-${locationId}-${binId}`}
              label="Attach return evidence"
              onChange={(urls) => setField("evidence", urls)}
              onBusyChange={(busy) => { evidenceBusyRef.current = busy; setEvidenceBusy(busy); }}
            />

            <button
              type="button"
              className="btn-primary w-full"
              disabled={!canSubmit || locked || evidenceBusy}
              onClick={() => void submit()}
            >
              {submitting ? "Recording return..." : "Record return"}
            </button>
          </fieldset>
        </Card>

        <Card>
          <div id="recent-returns" />
          <SectionTitle title="Recent returns" />
          {data.returns.length === 0 ? (
            <EmptyState icon="rotate" title="No returns recorded yet" />
          ) : (
            <ul className="space-y-2" aria-label="Returns">
              {data.returns
                .slice()
                .reverse()
                .map((r) => (
                  <li key={r.id} id={`return-${r.id}`} className="rounded-xl bg-inset p-3">
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
