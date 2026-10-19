import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/auth/session";
import { useWarehouse } from "@/app/store";
import { Badge, Field, PageHeader, Sheet } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ExternalPOEvidence } from "@/components/ExternalPOEvidence";
import { EvidenceCapture } from "@/components/camera/EvidenceCapture";
import { EvidenceGallery } from "@/components/EvidenceGallery";
import {
  ExternalReceivingError,
  freezeExternalCommand,
  loadExternalReceiving,
  runExternalReceivingCommand,
  shipmentPostingIssue,
  type ExternalCommand,
  type ExternalCommandInput,
  type ExternalOrder,
  type ExternalReceivingWorkspace,
  type ExternalShipment,
  type SaveExternalOrder,
  type SaveExternalShipment,
} from "@/data/externalReceiving";

type PendingAction = { command: ExternalCommand; acknowledged: boolean };
const message = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "External receiving is unavailable. Please retry.";
const orderLabel = (order: ExternalOrder) =>
  order.po_number || "PO number pending";
const statusLabel = (status: ExternalOrder["status"]) =>
  ({
    draft: "Awaiting confirmation",
    confirmed: "Confirmed",
    returned: "Returned for correction",
  })[status];
const pendingKey = (id: string) =>
  `warehouse.external-receiving.pending.v1:${id}`;

function restorePending(key: string): PendingAction | null {
  const saved = sessionStorage.getItem(key);
  if (!saved) return null;
  const value = JSON.parse(saved) as PendingAction;
  if (
    !value?.command ||
    typeof value.acknowledged !== "boolean" ||
    typeof value.command.order_id !== "string" ||
    typeof value.command.idempotency_key !== "string" ||
    ![
      "save_order",
      "save_shipment",
      "confirm_order",
      "return_order",
      "post_shipment",
    ].includes(value.command.action)
  ) {
    throw new Error(
      "The saved action could not be read. Contact support before sending another action.",
    );
  }
  return value;
}

function verifyReadback(
  workspace: ExternalReceivingWorkspace,
  command: ExternalCommand,
) {
  const order = workspace.orders.find((item) => item.id === command.order_id);
  const shipment =
    "shipment_id" in command
      ? order?.shipments.find((item) => item.id === command.shipment_id)
      : undefined;
  const verified =
    command.action === "save_order"
      ? order && order.version > command.version
      : command.action === "confirm_order"
        ? order?.status === "confirmed"
        : command.action === "return_order"
          ? order?.status === "returned"
          : command.action === "save_shipment"
            ? shipment && shipment.version > command.version
            : shipment?.status === "posted" && Boolean(shipment.receipt_id);
  if (!verified)
    throw new Error(
      "The action was accepted, but its saved record is not yet available. Retry verification before continuing.",
    );
}

export function ExternalReceivingPage() {
  const session = useSession();
  const { can } = useWarehouse();
  if (
    !["receive_stock", "inspect_quality", "view_procurement"].some((cap) =>
      can(cap as "receive_stock" | "inspect_quality" | "view_procurement"),
    )
  ) {
    return <p role="alert">You do not have access to external receiving.</p>;
  }
  if (
    session.mode !== "supabase" ||
    !session.profile ||
    !session.supabaseClient
  ) {
    return (
      <div>
        <PageHeader title="External PO receiving" icon="truck" />
        <p role="alert">
          A signed-in live connection is required. No arrival or stock changes
          have been saved.
        </p>
      </div>
    );
  }
  return <LiveExternalReceiving key={session.profile.id} />;
}

function LiveExternalReceiving() {
  const { supabaseClient, profile } = useSession();
  const { data, can, refresh } = useWarehouse();
  const [workspace, setWorkspace] = useState<ExternalReceivingWorkspace | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<"order" | "shipment" | null>(null);
  const [shipmentDraft, setShipmentDraft] = useState<ExternalShipment | null>(
    null,
  );
  const [reviewNote, setReviewNote] = useState("");
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [recoveryError, setRecoveryError] = useState("");
  const inFlight = useRef(false);
  const alive = useRef(true);
  const errorFeedback = useRef<HTMLParagraphElement>(null);
  const key = pendingKey(profile!.id);
  const selected = workspace?.orders.find((order) => order.id === selectedId);
  const sheetOpen = Boolean(selected || editor);
  const locked =
    busy ||
    evidenceBusy ||
    Boolean(pending) ||
    Boolean(recoveryError) ||
    loading ||
    moreBusy;
  const mayRegister = can("receive_stock");
  const mayReceive = can("receive_stock");

  useEffect(() => {
    if (!actionError && !recoveryError) return;
    errorFeedback.current?.focus({ preventScroll: true });
    errorFeedback.current?.scrollIntoView?.({ block: "nearest" });
  }, [actionError, recoveryError, sheetOpen]);

  useEffect(() => {
    alive.current = true;
    try {
      setPending(restorePending(key));
    } catch (cause) {
      setRecoveryError(message(cause));
    }
    return () => {
      alive.current = false;
    };
  }, [key]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadExternalReceiving(supabaseClient!)
      .then((result) => {
        if (active) {
          setWorkspace(result);
          setReadError("");
        }
      })
      .catch((cause) => {
        if (active) setReadError(message(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [supabaseClient]);

  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  async function reload(more = false) {
    if (inFlight.current) return;
    if (more) setMoreBusy(true);
    else setLoading(true);
    try {
      const next = await loadExternalReceiving(supabaseClient!, {
        offset: more ? (workspace?.next_offset ?? 0) : 0,
      });
      if (!alive.current) return;
      setWorkspace((previous) =>
        more && previous
          ? {
              ...next,
              orders: [
                ...new Map(
                  [...previous.orders, ...next.orders].map((order) => [
                    order.id,
                    order,
                  ]),
                ).values(),
              ],
            }
          : next,
      );
      setReadError("");
    } catch (cause) {
      if (alive.current) setReadError(message(cause));
    } finally {
      if (alive.current) {
        setLoading(false);
        setMoreBusy(false);
      }
    }
  }

  async function execute(input?: ExternalCommandInput) {
    if (inFlight.current || evidenceBusy || recoveryError) return;
    if (input && pending) return;
    let operation = input
      ? { command: freezeExternalCommand(input), acknowledged: false }
      : pending;
    if (!operation) return;
    inFlight.current = true;
    setBusy(true);
    setActionError("");
    setNotice("");
    let persisted = false;
    try {
      // Persist the exact request before sending. A reload must not mint a second command.
      sessionStorage.setItem(key, JSON.stringify(operation));
      persisted = true;
      setPending(operation);
      if (!operation.acknowledged) {
        await runExternalReceivingCommand(supabaseClient!, operation.command);
        operation = { ...operation, acknowledged: true };
        sessionStorage.setItem(key, JSON.stringify(operation));
        if (alive.current) setPending(operation);
      }
      const latest = await loadExternalReceiving(supabaseClient!, {
        order_id: operation.command.order_id,
      });
      verifyReadback(latest, operation.command);
      await refresh();
      sessionStorage.removeItem(key);
      if (!alive.current) return;
      setWorkspace((previous) => ({
        ...previous,
        can_confirm: latest.can_confirm,
        orders: [
          ...new Map(
            [...(previous?.orders ?? []), ...latest.orders].map((order) => [
              order.id,
              order,
            ]),
          ).values(),
        ],
      }));
      setPending(null);
      setEditor(null);
      setSelectedId(operation.command.order_id);
      setReviewNote("");
      setReadError("");
      setNotice(
        operation.command.action === "post_shipment"
          ? "Shipment sent to Quality. Stock remains unavailable until inspection and putaway are complete."
          : "Saved record verified.",
      );
    } catch (cause) {
      if (
        !persisted ||
        (cause instanceof ExternalReceivingError &&
          !cause.uncertain &&
          !operation.acknowledged)
      ) {
        if (persisted) sessionStorage.removeItem(key);
        if (alive.current) setPending(null);
      }
      if (alive.current) setActionError(message(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function changeEditor(next: typeof editor) {
    if (locked) return;
    setEditor(next);
    setActionError("");
    setNotice("");
  }

  const feedback = (
    <div className="space-y-2">
      {(actionError || recoveryError) && (
        <p ref={errorFeedback} role="alert" tabIndex={-1} className="text-sm text-rose-700">
          {actionError || recoveryError}
        </p>
      )}
      {pending && (
        <div className="border-y border-amber-300 py-3 text-sm">
          <p role="status">
            {pending.acknowledged
              ? "Saved action awaiting verification."
              : "An action is awaiting a confirmed response. Its details are locked for a safe retry."}
          </p>
          <button
            type="button"
            className="btn-outline mt-2"
            disabled={busy || loading}
            onClick={() => void execute()}
          >
            <Icon name="rotate" />
            {pending.acknowledged ? "Retry verification" : "Retry saved action"}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
    </div>
  );
  const orders =
    workspace?.orders.filter((order) =>
      `${order.po_number ?? ""} ${order.email_sender} ${data?.suppliers.find((item) => item.id === order.supplier_id)?.name ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="External PO receiving"
        icon="truck"
        subtitle="Emailed purchase orders and delivery arrivals"
        action={
          mayRegister && (
            <>
              <Link to="/purchase-orders" className="btn-ghost btn-sm">
                <Icon name="truck" className="h-4 w-4" />
                Procurement PO receiving
              </Link>
              <button
                type="button"
                className="btn-primary"
                disabled={locked || !workspace}
                onClick={() => {
                  setSelectedId(null);
                  setEditor("order");
                  setActionError("");
                  setNotice("");
                }}
              >
                <Icon name="plus" />
                Register emailed PO
              </button>
            </>
          )
        }
      />
      <ol
        className="grid gap-2 border-y border-line py-3 text-sm sm:grid-cols-2 xl:grid-cols-3"
        aria-label="External receiving workflow"
      >
        {[
          "1. Register emailed PO",
          "2. Operations Lead confirmation",
          "3. Save shipment arrival",
          "4. Post to Quality",
          "5. Quality inspection",
          "6. Putaway",
        ].map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {!sheetOpen && feedback}
      {readError && (
        <div role="alert" className="space-y-2 text-sm text-rose-700">
          <p>{readError}</p>
          <button
            type="button"
            className="btn-outline"
            disabled={busy || loading || moreBusy}
            onClick={() => void reload()}
          >
            Retry loading
          </button>
        </div>
      )}
      {loading && <p role="status">Loading external receiving...</p>}
      {workspace && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full sm:max-w-sm">
              <Field label="Search emailed POs" htmlFor="external-search">
                <input
                  id="external-search"
                  className="input"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </Field>
            </div>
            <button
              type="button"
              className="btn-ghost h-11 w-11"
              title="Refresh orders"
              aria-label="Refresh orders"
              disabled={locked}
              onClick={() => void reload()}
            >
              <Icon name="rotate" />
            </button>
          </div>
          {!orders.length && !readError && (
            <p className="py-6 text-sm text-muted">
              {workspace.orders.length
                ? "No matching emailed POs."
                : "No emailed POs registered"}
            </p>
          )}
          <ul
            aria-label="External purchase orders"
            className="divide-y divide-line border-y border-line"
          >
            {orders.map((order) => (
              <li
                key={order.id}
                className="grid min-w-0 gap-2 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <p className="break-words font-semibold text-ink">
                    {orderLabel(order)}
                  </p>
                  <p className="break-words text-sm text-muted">
                    {data?.suppliers.find(
                      (item) => item.id === order.supplier_id,
                    )?.name ?? order.supplier_id}
                  </p>
                </div>
                <div>
                  <Badge
                    tone={order.status === "confirmed" ? "emerald" : "amber"}
                  >
                    {statusLabel(order.status)}
                  </Badge>
                </div>
                <p className="text-sm text-muted">
                  {
                    order.shipments.filter((item) => item.status === "draft")
                      .length
                  }{" "}
                  pending arrivals
                </p>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={locked}
                  aria-label={`Open ${orderLabel(order)}`}
                  onClick={() => {
                    setSelectedId(order.id);
                    setEditor(null);
                    setReviewNote("");
                    setNotice("");
                    setActionError("");
                  }}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
          {workspace.has_more && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted">
                {workspace.orders.length} records loaded. More orders are
                available.
              </p>
              <button
                type="button"
                className="btn-outline"
                disabled={locked}
                onClick={() => void reload(true)}
              >
                {moreBusy ? "Loading more..." : "Load more orders"}
              </button>
            </div>
          )}
        </>
      )}

      <Sheet
        open={sheetOpen}
        size="wide"
        title={
          editor === "order"
            ? selected
              ? "Edit PO record"
              : "Register emailed PO"
            : editor === "shipment"
              ? "Shipment arrival"
              : selected
                ? orderLabel(selected)
                : "External PO"
        }
        onOpenChange={(open) => {
          if (!open && !busy && !evidenceBusy && !pending) {
            setSelectedId(null);
            setEditor(null);
            setActionError("");
          }
        }}
      >
        <div className="space-y-5">
          {feedback}
          {editor === "order" && (
            <OrderEditor
              key={selected?.id ?? "new"}
              order={selected}
              disabled={locked}
              onBusyChange={setEvidenceBusy}
              onSubmit={(input) => void execute(input)}
            />
          )}
          {editor === "shipment" && selected && (
            <ShipmentEditor
              key={shipmentDraft?.id ?? "new"}
              order={selected}
              shipment={shipmentDraft}
              disabled={locked}
              onBusyChange={setEvidenceBusy}
              onSubmit={(input) => void execute(input)}
            />
          )}
          {!editor && selected && (
            <>
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge
                    tone={selected.status === "confirmed" ? "emerald" : "amber"}
                  >
                    {statusLabel(selected.status)}
                  </Badge>
                  {mayRegister &&
                    selected.created_by === profile!.id &&
                    selected.status !== "confirmed" && (
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={locked}
                        onClick={() => changeEditor("order")}
                      >
                        Edit PO record
                      </button>
                    )}
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">Supplier</dt>
                    <dd>
                      {data?.suppliers.find(
                        (item) => item.id === selected.supplier_id,
                      )?.name ?? selected.supplier_id}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Receiving location</dt>
                    <dd>
                      {data?.locations.find(
                        (item) => item.id === selected.location_id,
                      )?.name ?? selected.location_id}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted">Email sender</dt>
                    <dd className="break-all">
                      {selected.email_sender || "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Email date</dt>
                    <dd>{selected.email_date || "Not recorded"}</dd>
                  </div>
                </dl>
                {selected.notes && (
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {selected.notes}
                  </p>
                )}
                <ExternalPOEvidence value={selected.evidence_urls} />
                <ul
                  className="divide-y divide-line border-y border-line text-sm"
                  aria-label="PO quantities"
                >
                  {selected.lines.map((line) => (
                    <li
                      key={line.id}
                      className="grid gap-1 py-2 sm:grid-cols-2"
                    >
                      <span>
                        {data?.products.find(
                          (product) => product.id === line.product_id,
                        )?.name ?? line.product_id}
                      </span>
                      <span>
                        Ordered {line.quantity} {line.uom} / Received{" "}
                        {line.received_quantity} / Remaining{" "}
                        {Math.max(0, line.quantity - line.received_quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="space-y-3 border-b border-line pb-4">
                <h2 className="text-base font-semibold">
                  Operations Lead confirmation
                </h2>
                <p className="text-sm text-muted">
                  Confirmation checks the emailed PO record; it is not purchase
                  approval.
                </p>
                {selected.review_note && (
                  <p className="whitespace-pre-wrap break-words text-sm">
                    Review note: {selected.review_note}
                  </p>
                )}
                {workspace?.can_confirm &&
                selected.created_by !== profile!.id &&
                selected.status !== "confirmed" ? (
                  <fieldset disabled={locked} className="space-y-3">
                    <Field label="Review note" htmlFor="external-review">
                      <textarea
                        id="external-review"
                        className="input"
                        value={reviewNote}
                        onChange={(event) => setReviewNote(event.target.value)}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={
                          !reviewNote.trim() ||
                          !selected.po_number ||
                          !selected.email_sender ||
                          !selected.email_date ||
                          !selected.evidence_urls.length
                        }
                        onClick={() =>
                          void execute({
                            action: "confirm_order",
                            order_id: selected.id,
                            version: selected.version,
                            review_note: reviewNote.trim(),
                          })
                        }
                      >
                        Confirm PO record
                      </button>
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={!reviewNote.trim()}
                        onClick={() =>
                          void execute({
                            action: "return_order",
                            order_id: selected.id,
                            version: selected.version,
                            review_note: reviewNote.trim(),
                          })
                        }
                      >
                        Return for correction
                      </button>
                    </div>
                  </fieldset>
                ) : (
                  selected.status !== "confirmed" && (
                    <p className="text-sm text-muted">
                      An independent Operations Lead must confirm this record
                      before a shipment can be posted.
                    </p>
                  )
                )}
                {selected.status !== "confirmed" &&
                  (!selected.po_number ||
                    !selected.email_sender ||
                    !selected.email_date ||
                    !selected.evidence_urls.length) && (
                    <p className="text-sm text-muted">
                      Confirmation needs a PO number, email sender, email date
                      and supporting document.
                    </p>
                  )}
              </section>
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold">Saved shipments</h2>
                  {mayReceive && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={locked}
                      onClick={() => {
                        setShipmentDraft(null);
                        changeEditor("shipment");
                      }}
                    >
                      <Icon name="plus" />
                      Record shipment
                    </button>
                  )}
                </div>
                <p className="text-sm text-muted">
                  Draft arrivals are not available stock. Unconfirmed, excess or
                  unidentified goods remain in draft pending document
                  correction.
                </p>
                {!selected.shipments.length && (
                  <p className="text-sm text-muted">
                    No shipment arrivals recorded.
                  </p>
                )}
                <ul
                  className="divide-y divide-line"
                  aria-label="Saved shipments"
                >
                  {selected.shipments.map((shipment) => {
                    const issue = shipmentPostingIssue(
                      selected,
                      shipment,
                      data?.products ?? [],
                    );
                    const ownDraft =
                      mayReceive &&
                      shipment.created_by === profile!.id &&
                      shipment.status === "draft";
                    return (
                      <li key={shipment.id} className="space-y-2 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">
                            {shipment.delivery_reference}
                          </h3>
                          <Badge
                            tone={
                              shipment.status === "posted" ? "emerald" : "amber"
                            }
                          >
                            {shipment.status === "posted"
                              ? "Sent to Quality"
                              : "Saved arrival - not available"}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted">
                          Delivered {shipment.actual_delivery_date} /{" "}
                          {shipment.lines.reduce(
                            (sum, line) => sum + line.quantity,
                            0,
                          )}{" "}
                          units / Receiving custody:{" "}
                          {data?.storageAreas.find(
                            (bin) => bin.id === shipment.bin_id,
                          )?.code ?? shipment.bin_id}
                        </p>
                        {shipment.notes && (
                          <p className="whitespace-pre-wrap break-words text-sm">
                            {shipment.notes}
                          </p>
                        )}
                        <EvidenceGallery
                          urls={shipment.evidence_urls}
                          size="thumb"
                        />
                        {shipment.status === "draft" && issue && (
                          <p className="text-sm text-muted">{issue}</p>
                        )}
                        {ownDraft && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-outline"
                              aria-label={`Resume ${shipment.delivery_reference}`}
                              disabled={locked}
                              onClick={() => {
                                setShipmentDraft(shipment);
                                changeEditor("shipment");
                              }}
                            >
                              Resume shipment
                            </button>
                            <button
                              type="button"
                              className="btn-primary"
                              aria-label={`Post ${shipment.delivery_reference} to Quality`}
                              disabled={locked || Boolean(issue)}
                              onClick={() =>
                                void execute({
                                  action: "post_shipment",
                                  order_id: selected.id,
                                  shipment_id: shipment.id,
                                  version: shipment.version,
                                })
                              }
                            >
                              Post to Quality
                            </button>
                          </div>
                        )}
                        {shipment.receipt_id && (
                          <p className="break-all text-xs text-muted">
                            Receipt: {shipment.receipt_id}
                          </p>
                        )}
                        {shipment.status === "posted" &&
                          shipment.receipt_id &&
                          (can("inspect_quality") ||
                            can("release_quality_hold") ||
                            can("manage_returns")) && (
                            <Link
                              to={`/quality?source=${encodeURIComponent(shipment.receipt_id)}`}
                              className="btn-outline"
                            >
                              Review Quality
                            </Link>
                          )}
                      </li>
                    );
                  })}
                </ul>
              </section>
              <p className="text-sm text-muted">
                Posting sends the delivery to Quality, not to available stock.
                After independent acceptance, complete normal putaway in
                Storage. The arrival bin records receiving custody, not final
                putaway.
              </p>
              <nav
                aria-label="Next receiving steps"
                className="flex flex-wrap gap-2 border-t border-line pt-3"
              >
                {(can("inspect_quality") ||
                  can("release_quality_hold") ||
                  can("manage_returns")) && (
                  <Link to="/quality" className="btn-outline">
                    Open Quality
                  </Link>
                )}
                {(can("transfer_stock") ||
                  can("manage_locations") ||
                  can("cycle_count")) && (
                  <Link to="/storage" className="btn-outline">
                    Open Storage
                  </Link>
                )}
              </nav>
            </>
          )}
          {editor && selected && (
            <button
              type="button"
              className="btn-ghost"
              disabled={locked}
              onClick={() => changeEditor(null)}
            >
              Back to PO record
            </button>
          )}
        </div>
      </Sheet>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  const id = `external-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function OrderEditor({
  order,
  disabled,
  onBusyChange,
  onSubmit,
}: {
  order?: ExternalOrder;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSubmit: (input: SaveExternalOrder) => void;
}) {
  const { data } = useWarehouse();
  const [draft, setDraft] = useState<SaveExternalOrder>(() => ({
    action: "save_order",
    order_id: order?.id ?? crypto.randomUUID(),
    version: order?.version ?? 0,
    po_number: order?.po_number ?? null,
    supplier_id: order?.supplier_id ?? "",
    location_id: order?.location_id ?? "",
    email_sender: order?.email_sender ?? "",
    email_date: order?.email_date ?? null,
    notes: order?.notes ?? "",
    evidence_urls: [...(order?.evidence_urls ?? [])],
    lines: order?.lines.map(({ received_quantity: _received, ...line }) => ({
      ...line,
    })) ?? [{ id: crypto.randomUUID(), product_id: "", quantity: 1, uom: "" }],
  }));
  const [error, setError] = useState("");
  const field = <K extends keyof SaveExternalOrder>(
    key: K,
    value: SaveExternalOrder[K],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    if (
      !draft.lines.length ||
      draft.lines.length > 100 ||
      draft.lines.some(
        (line) =>
          !data?.products.some(
            (product) =>
              product.id === line.product_id &&
              (product.uom || "piece") === line.uom,
          ) ||
          !Number.isSafeInteger(line.quantity) ||
          line.quantity < 1 ||
          line.quantity > 100000,
      )
    ) {
      setError(
        "Select a catalog product and a positive whole quantity for every PO line.",
      );
      return;
    }
    if (
      new Set(draft.lines.map((line) => line.product_id)).size !==
      draft.lines.length
    ) {
      setError("Use one PO line per product.");
      return;
    }
    setError("");
    onSubmit({
      ...draft,
      po_number: draft.po_number?.trim() || null,
      email_sender: draft.email_sender.trim(),
    });
  };
  return (
    <form onSubmit={save} className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="PO number"
            value={draft.po_number ?? ""}
            onChange={(value) => field("po_number", value)}
          />
          <Field label="Supplier" htmlFor="external-supplier">
            <select
              id="external-supplier"
              className="input"
              required
              value={draft.supplier_id}
              onChange={(event) => field("supplier_id", event.target.value)}
            >
              <option value="">Select supplier</option>
              {data?.suppliers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Receiving location" htmlFor="external-location">
            <select
              id="external-location"
              className="input"
              required
              value={draft.location_id}
              onChange={(event) => field("location_id", event.target.value)}
            >
              <option value="">Select warehouse</option>
              {data?.locations
                .filter(
                  (item) => item.type === "warehouse" && item.active !== false,
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
          <TextField
            label="Email sender"
            type="email"
            value={draft.email_sender}
            onChange={(value) => field("email_sender", value)}
          />
          <TextField
            label="Email date"
            type="date"
            value={draft.email_date ?? ""}
            onChange={(value) => field("email_date", value || null)}
          />
        </div>
        <section className="space-y-2">
          <h2 className="text-base font-semibold">PO lines</h2>
          {draft.lines.map((line, index) => (
            <div
              key={line.id}
              className="grid min-w-0 gap-2 border-b border-line py-3 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_auto] sm:items-end"
            >
              <Field
                label={`Product ${index + 1}`}
                htmlFor={`product-${line.id}`}
              >
                <select
                  id={`product-${line.id}`}
                  className="input"
                  required
                  value={line.product_id}
                  onChange={(event) => {
                    const product = data?.products.find(
                      (item) => item.id === event.target.value,
                    );
                    field(
                      "lines",
                      draft.lines.map((item) =>
                        item.id === line.id
                          ? {
                              ...item,
                              product_id: event.target.value,
                              uom: product?.uom || "piece",
                            }
                          : item,
                      ),
                    );
                  }}
                >
                  <option value="">Select product</option>
                  {data?.products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.sku})
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={`Quantity ${index + 1}`}
                htmlFor={`quantity-${line.id}`}
              >
                <input
                  id={`quantity-${line.id}`}
                  className="input"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={line.quantity || ""}
                  onChange={(event) =>
                    field(
                      "lines",
                      draft.lines.map((item) =>
                        item.id === line.id
                          ? { ...item, quantity: Number(event.target.value) }
                          : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label={`UOM ${index + 1}`} htmlFor={`uom-${line.id}`}>
                <input
                  id={`uom-${line.id}`}
                  className="input"
                  readOnly
                  value={line.uom}
                />
              </Field>
              <button
                type="button"
                className="btn-ghost h-11 w-11"
                aria-label={`Remove PO line ${index + 1}`}
                title={`Remove PO line ${index + 1}`}
                onClick={() =>
                  field(
                    "lines",
                    draft.lines.filter((item) => item.id !== line.id),
                  )
                }
              >
                <Icon name="x" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-outline"
            onClick={() =>
              field("lines", [
                ...draft.lines,
                {
                  id: crypto.randomUUID(),
                  product_id: "",
                  quantity: 1,
                  uom: "",
                },
              ])
            }
          >
            <Icon name="plus" />
            Add PO line
          </button>
        </section>
        <Field label="PO notes" htmlFor="external-po-notes">
          <textarea
            id="external-po-notes"
            className="input"
            value={draft.notes}
            onChange={(event) => field("notes", event.target.value)}
          />
        </Field>
      </fieldset>
      <ExternalPOEvidence
        value={draft.evidence_urls}
        disabled={disabled}
        onBusyChange={onBusyChange}
        onChange={(value) => field("evidence_urls", value)}
      />
      {!draft.evidence_urls.length && (
        <p className="text-sm text-muted">
          PO document missing. Arrivals can be recorded, but cannot be posted
          until the document is attached and confirmed.
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={disabled}>
        <Icon name="check" />
        Save PO record
      </button>
    </form>
  );
}

function ShipmentEditor({
  order,
  shipment,
  disabled,
  onBusyChange,
  onSubmit,
}: {
  order: ExternalOrder;
  shipment: ExternalShipment | null;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSubmit: (input: SaveExternalShipment) => void;
}) {
  const { data } = useWarehouse();
  const [draft, setDraft] = useState<SaveExternalShipment>(() => ({
    action: "save_shipment",
    order_id: order.id,
    shipment_id: shipment?.id ?? crypto.randomUUID(),
    version: shipment?.version ?? 0,
    delivery_reference: shipment?.delivery_reference ?? "",
    actual_delivery_date: shipment?.actual_delivery_date ?? "",
    bin_id: shipment?.bin_id ?? "",
    notes: shipment?.notes ?? "",
    evidence_urls: [...(shipment?.evidence_urls ?? [])],
    lines: order.lines.map((line) => ({
      po_line_id: line.id,
      quantity: 0,
      serial_numbers: [],
      ...shipment?.lines.find((item) => item.po_line_id === line.id),
    })),
  }));
  const field = <K extends keyof SaveExternalShipment>(
    key: K,
    value: SaveExternalShipment[K],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));
  const patchLine = (
    id: string,
    patch: Partial<SaveExternalShipment["lines"][number]>,
  ) =>
    field(
      "lines",
      draft.lines.map((line) =>
        line.po_line_id === id ? { ...line, ...patch } : line,
      ),
    );
  const [error, setError] = useState("");
  const [serialText, setSerialText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      draft.lines.map((line) => [
        line.po_line_id,
        line.serial_numbers.join("\n"),
      ]),
    ),
  );
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    if (
      draft.lines.some(
        (line) =>
          !Number.isSafeInteger(line.quantity) ||
          line.quantity < 0 ||
          line.quantity > 100000,
      )
    ) {
      setError("Delivered quantities must be whole numbers from 0 to 100,000.");
      return;
    }
    if (!draft.lines.some((line) => line.quantity > 0)) {
      setError(
        "Match at least one delivered item to a PO line before saving. Ask the PO creator to correct unidentified items.",
      );
      return;
    }
    if (!draft.delivery_reference.trim()) {
      setError("Enter the delivery reference.");
      return;
    }
    setError("");
    onSubmit({
      ...draft,
      delivery_reference: draft.delivery_reference.trim(),
      lines: draft.lines.filter((line) => line.quantity > 0),
    });
  };
  return (
    <form className="space-y-4" onSubmit={save}>
      <p className="text-sm text-muted">
        Arrival record only. Saving does not make stock available. The arrival
        bin records receiving custody. Quality acceptance and normal putaway are
        still required.
      </p>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Delivery reference"
            required
            value={draft.delivery_reference}
            onChange={(value) => field("delivery_reference", value)}
          />
          <TextField
            label="Actual delivery date"
            type="date"
            required
            value={draft.actual_delivery_date}
            onChange={(value) => field("actual_delivery_date", value)}
          />
          <Field label="Arrival bin" htmlFor="external-bin">
            <select
              id="external-bin"
              className="input"
              required
              value={draft.bin_id}
              onChange={(event) => field("bin_id", event.target.value)}
            >
              <option value="">Select bin</option>
              {data?.storageAreas
                .filter(
                  (bin) =>
                    bin.locationId === order.location_id &&
                    bin.active !== false,
                )
                .map((bin) => (
                  <option key={bin.id} value={bin.id}>
                    {bin.code}
                    {bin.label ? ` - ${bin.label}` : ""}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        {draft.lines.map((line) => {
          const poLine = order.lines.find(
            (item) => item.id === line.po_line_id,
          )!;
          const product = data?.products.find(
            (item) => item.id === poLine.product_id,
          );
          const name = product?.name ?? poLine.product_id;
          return (
            <section
              key={line.po_line_id}
              className="space-y-3 border-y border-line py-3"
            >
              <h3 className="text-sm font-semibold">{name}</h3>
              <p className="text-sm text-muted">
                Remaining{" "}
                {Math.max(0, poLine.quantity - poLine.received_quantity)}{" "}
                {poLine.uom}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={`Delivered quantity for ${name}`}
                  htmlFor={`delivered-${line.po_line_id}`}
                >
                  <input
                    id={`delivered-${line.po_line_id}`}
                    type="number"
                    min={0}
                    step={1}
                    className="input"
                    value={line.quantity || ""}
                    onChange={(event) =>
                      patchLine(line.po_line_id, {
                        quantity: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field
                  label={`Lot code for ${name}`}
                  htmlFor={`lot-${line.po_line_id}`}
                >
                  <input
                    id={`lot-${line.po_line_id}`}
                    className="input"
                    value={line.lot_code ?? ""}
                    onChange={(event) =>
                      patchLine(line.po_line_id, {
                        lot_code: event.target.value || undefined,
                      })
                    }
                  />
                </Field>
                <Field
                  label={`Expiry date for ${name}`}
                  htmlFor={`expiry-${line.po_line_id}`}
                >
                  <input
                    id={`expiry-${line.po_line_id}`}
                    className="input"
                    type="date"
                    value={line.expiry_date ?? ""}
                    onChange={(event) =>
                      patchLine(line.po_line_id, {
                        expiry_date: event.target.value || undefined,
                      })
                    }
                  />
                </Field>
                {product?.serialized && (
                  <Field
                    label={`Serial numbers for ${name}`}
                    htmlFor={`serials-${line.po_line_id}`}
                  >
                    <textarea
                      id={`serials-${line.po_line_id}`}
                      className="input"
                      value={serialText[line.po_line_id] ?? ""}
                      onChange={(event) => {
                        setSerialText((previous) => ({
                          ...previous,
                          [line.po_line_id]: event.target.value,
                        }));
                        patchLine(line.po_line_id, {
                          serial_numbers: event.target.value
                            .split(/[\n,]+/)
                            .map((value) => value.trim())
                            .filter(Boolean),
                        });
                      }}
                    />
                  </Field>
                )}
              </div>
            </section>
          );
        })}
        <Field label="Shipment notes" htmlFor="external-shipment-notes">
          <textarea
            id="external-shipment-notes"
            className="input"
            value={draft.notes}
            onChange={(event) => field("notes", event.target.value)}
          />
        </Field>
        <EvidenceCapture
          value={draft.evidence_urls}
          onChange={(value) => field("evidence_urls", value)}
          onBusyChange={onBusyChange}
          reference={`external-shipment/${draft.shipment_id}`}
        />
      </fieldset>
      <button type="submit" className="btn-primary" disabled={disabled}>
        <Icon name="check" />
        Save shipment
      </button>
    </form>
  );
}
