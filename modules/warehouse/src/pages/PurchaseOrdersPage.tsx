import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "@intra/auth";
import { CertifiedAction } from "@intra/learning";
import { useWarehouse } from "@/app/store";
import {
  poProgress,
  poTotalOrdered,
  poTotalReceived,
  poValue,
} from "@/domain/purchaseOrders";
import {
  PO_STATUS_LABELS,
  formatDate,
  formatWhen,
  poNumberMap,
} from "@/domain/format";
import {
  loadProcurementPOs,
  useProcurementPOs,
  type BridgedPO,
} from "@/data/procurementBridge";
import type { POStatus, PurchaseOrder } from "@/domain/types";
import {
  BarRow,
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  ProductSelect,
  QuantityStepper,
  SegmentedControl,
  Sheet,
  money,
  useToast,
  type Tone,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BarcodeScanner } from "@/components/camera/BarcodeScanner";
import { EvidenceCapture } from "@/components/camera/EvidenceCapture";
import { EvidenceGallery } from "@/components/EvidenceGallery";
import { normalizeSafeHttpsUrl } from "@intra/data-kit";
import {
  loadReceivingDraft,
  saveReceivingDraft,
  deleteReceivingDraft,
  ReceivingDraftConflictError,
  type ReceivingDraftRecord,
} from "@/data/receivingDrafts";
import {
  readReceivingProgress,
  type ReceivingProgress,
} from "@/data/receivingProgress";
import {
  ReceiptExceptionDecisionPanel,
  type ReceiptExceptionDecisionInput,
  type ReceiptExceptionDecisionItem,
} from "@/components/ReceiptExceptionDecisionPanel";
import {
  ExcessCustodyDecisionPanel,
  type ExcessCustodyDecisionInput,
  type ExcessCustodyWorkItem,
} from "@/components/ExcessCustodyDecisionPanel";

type POFilter = "all" | "open" | "closed";
type ReceiptOutcome = "clean" | "damaged" | "unidentified" | "short" | "excess";
type PhysicalReceiptOutcome = Exclude<ReceiptOutcome, "short">;
type ReceiptOutcomeQuantities = Record<ReceiptOutcome, number>;
type ReceiptOutcomeSerials = Record<PhysicalReceiptOutcome, string>;

const PHYSICAL_OUTCOMES: readonly PhysicalReceiptOutcome[] = [
  "clean",
  "damaged",
  "unidentified",
  "excess",
];

function parseSerials(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((serial) => serial.trim())
    .filter(Boolean);
}

function initialOutcomeQuantities(expected: number): ReceiptOutcomeQuantities {
  return {
    clean: expected,
    damaged: 0,
    unidentified: 0,
    short: 0,
    excess: 0,
  };
}

function initialOutcomeSerials(): ReceiptOutcomeSerials {
  return { clean: "", damaged: "", unidentified: "", excess: "" };
}

function safeDeliveryEvidence(value: string): boolean {
  const candidate = value.trim();
  if (normalizeSafeHttpsUrl(candidate)) return true;
  return (
    /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+$/.test(candidate) &&
    !candidate.split("/").includes("..")
  );
}

const STATUS_TONE: Record<POStatus, Tone> = {
  draft: "slate",
  ordered: "brand",
  partially_received: "amber",
  received: "emerald",
  cancelled: "rose",
};

function bridgedPoDateLabel(po: BridgedPO): string {
  if (po.expectedDate) return `Expected ${formatDate(po.expectedDate)}`;
  if (po.createdAt && Date.parse(po.createdAt) > Date.UTC(2000, 0, 1)) {
    return `Created ${formatWhen(po.createdAt)}`;
  }
  return "Expected date not set";
}

export function PurchaseOrdersPage() {
  const {
    data,
    source,
    can,
    receiveAgainstPO,
    cancelPurchaseOrder,
    loadReceivableProcurementPOs,
    receiveProcurementPO,
    canOpenRoute,
  } = useWarehouse();
  const toast = useToast();
  const { mode, supabaseClient, profile } = useSession();
  const [searchParams] = useSearchParams();
  const handoffPoId = searchParams.get("po");
  const openedHandoffRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const canManagePOs = can("view_procurement");
  const canReceive = can("receive_stock");

  // Procurement-module POs (issued/approved) read from their localStorage
  // contract — read-only visibility across the module seam (J1-6).
  const [bridgeReload, setBridgeReload] = useState(0);
  const bridgedPOs = useProcurementPOs(
    source,
    loadReceivableProcurementPOs,
    bridgeReload,
  );

  // Row-as-target (WH-27): tapping a PO opens its detail sheet; Receive and
  // Cancel live INSIDE the sheet instead of repeating on every card.
  const [detailPOId, setDetailPOId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [receiveLoc, setReceiveLoc] = useState("");
  const [receiveBin, setReceiveBin] = useState("");
  const [filter, setFilter] = useState<POFilter>("all");
  const [bridgeReceivePO, setBridgeReceivePO] = useState<BridgedPO | null>(
    null,
  );
  const receivingSessionRef = useRef(0);
  const [receivingRequest, setReceivingRequest] = useState<{
    po: BridgedPO;
    session: number;
    load: typeof loadReceivableProcurementPOs;
  } | null>(null);
  const receiptAttemptRef = useRef<{ payload: string; key: string } | null>(
    null,
  );
  const [bridgeProducts, setBridgeProducts] = useState<Record<string, string>>(
    {},
  );
  const [bridgeObservedDescriptions, setBridgeObservedDescriptions] = useState<
    Record<string, string>
  >({});
  const [bridgeObservedIdentifiers, setBridgeObservedIdentifiers] = useState<
    Record<string, string>
  >({});
  const [bridgeOutcomes, setBridgeOutcomes] = useState<
    Record<string, ReceiptOutcomeQuantities>
  >({});
  const [bridgeSerials, setBridgeSerials] = useState<
    Record<string, ReceiptOutcomeSerials>
  >({});
  const [bridgeLocation, setBridgeLocation] = useState("");
  const [bridgeBin, setBridgeBin] = useState("");
  const [bridgeEvidence, setBridgeEvidence] = useState("");
  const [bridgePhotos, setBridgePhotos] = useState<string[]>([]);
  const [bridgeSelected, setBridgeSelected] = useState<Record<string, boolean>>(
    {},
  );
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const bridgeSubmitting = useRef(false);
  const [serialTarget, setSerialTarget] = useState<string | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [draftSaveError, setDraftSaveError] = useState("");
  const [draftConflict, setDraftConflict] = useState(false);
  const [confirmDraftReload, setConfirmDraftReload] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [restoredPhotos, setRestoredPhotos] = useState<string[]>([]);
  const receivingStateRef = useRef({
    bridgeSerials,
    bridgeOutcomes,
    bridgeSelected,
    restoredPhotos,
  });
  receivingStateRef.current = {
    bridgeSerials,
    bridgeOutcomes,
    bridgeSelected,
    restoredPhotos,
  };
  const draftKey = `intra.receiving-draft.v1:${profile?.id ?? "anonymous"}:${bridgeReceivePO?.id ?? ""}`;
  const bridgeEvidenceError =
    bridgeEvidence.trim() && !safeDeliveryEvidence(bridgeEvidence)
      ? "Use a secure HTTPS link, or upload a photo of the delivery note. HTTP links are not accepted."
      : "";
  const bridgeEvidenceUrls = [
    ...bridgePhotos,
    ...(bridgeEvidence.trim() && !bridgeEvidenceError
      ? [bridgeEvidence.trim()]
      : []),
  ];
  const [bridgeExceptionReason, setBridgeExceptionReason] = useState("");
  const [exceptionDecisions, setExceptionDecisions] = useState<
    ReceiptExceptionDecisionItem[]
  >([]);
  const [excessCustodyItems, setExcessCustodyItems] = useState<
    ExcessCustodyWorkItem[]
  >([]);
  const warehouses = useMemo(
    () =>
      data?.locations.filter((location) => location.type === "warehouse") ?? [],
    [data],
  );

  useEffect(() => {
    if (!receivingRequest || !profile) return;
    const { po, session, load } = receivingRequest;
    let cancelled = false;
    setDraftLoading(true);
    setDraftError("");
    setDraftSaveError("");
    setDraftConflict(false);
    setConfirmDraftReload(false);
    setDraftSavedAt(null);
    setRestoredPhotos([]);
    setDraftVersion(0);
    const restore = async () => {
      try {
        const currentPO = (await loadProcurementPOs(source, load)).find(
          (current) => current.id === po.id,
        );
        if (!currentPO)
          throw new Error("This PO is no longer available for receiving.");
        let record: ReceivingDraftRecord;
        if (mode === "supabase") {
          if (!supabaseClient)
            throw new Error(
              "Receiving progress is unavailable until your connection is restored.",
            );
          record = await loadReceivingDraft(supabaseClient, po.id);
        } else {
          const saved = localStorage.getItem(draftKey);
          record = saved
            ? (JSON.parse(saved) as ReceivingDraftRecord)
            : {
                poId: po.id,
                body: null,
                version: 0,
                updatedAt: null,
              };
        }
        if (cancelled || receivingSessionRef.current !== session) return;
        const progress = record.body
          ? readReceivingProgress(record.body)
          : null;
        setBridgeReceivePO(currentPO);
        setDraftVersion(record.version);
        if (progress) {
          setBridgeLocation(progress.locationId);
          setBridgeBin(progress.binId);
          setBridgeEvidence(progress.evidenceLink);
          setBridgePhotos(progress.evidencePhotos);
          setRestoredPhotos(progress.evidencePhotos);
          setBridgeExceptionReason(progress.reason);
          setBridgeProducts(
            Object.fromEntries(
              progress.lines.map((line) => [line.id, line.productId]),
            ),
          );
          setBridgeOutcomes(
            Object.fromEntries(
              progress.lines.map((line) => [line.id, line.outcomes]),
            ),
          );
          setBridgeSerials(
            Object.fromEntries(
              progress.lines.map((line) => [line.id, line.serials]),
            ),
          );
          setBridgeObservedDescriptions(
            Object.fromEntries(
              progress.lines.map((line) => [line.id, line.description]),
            ),
          );
          setBridgeObservedIdentifiers(
            Object.fromEntries(
              progress.lines.map((line) => [line.id, line.identifiers]),
            ),
          );
          setBridgeSelected(
            Object.fromEntries(
              currentPO.lines.map((line) => {
                const saved = progress.lines.find(
                  (item) => item.id === line.id,
                );
                return [
                  line.id,
                  !!saved?.selected &&
                    saved.expected ===
                      Math.max(0, line.quantity - line.receivedQuantity),
                ];
              }),
            ),
          );
          const changed = progress.lines.some(
            (saved) =>
              saved.selected &&
              !currentPO.lines.some(
                (line) =>
                  line.id === saved.id &&
                  Math.max(0, line.quantity - line.receivedQuantity) ===
                    saved.expected,
              ),
          );
          if (changed)
            toast.error(
              "PO balances changed since this draft. Changed items are deselected; review their remaining quantities before receiving.",
            );
          setDraftSavedAt(record.updatedAt);
        } else {
          setBridgeSelected(
            Object.fromEntries(currentPO.lines.map((line) => [line.id, true])),
          );
          setBridgeProducts(
            Object.fromEntries(
              currentPO.lines.map((line) => [line.id, line.productId ?? ""]),
            ),
          );
          setBridgeObservedDescriptions(
            Object.fromEntries(
              currentPO.lines.map((line) => [line.id, line.description]),
            ),
          );
          setBridgeOutcomes(
            Object.fromEntries(
              currentPO.lines.map((line) => [
                line.id,
                initialOutcomeQuantities(
                  Math.max(0, line.quantity - line.receivedQuantity),
                ),
              ]),
            ),
          );
          setBridgeSerials(
            Object.fromEntries(
              currentPO.lines.map((line) => [line.id, initialOutcomeSerials()]),
            ),
          );
        }
      } catch (error) {
        if (!cancelled && receivingSessionRef.current === session)
          setDraftError(
            error instanceof Error
              ? error.message
              : "Could not load receiving progress.",
          );
      } finally {
        if (!cancelled && receivingSessionRef.current === session)
          setDraftLoading(false);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [
    receivingRequest,
    draftKey,
    mode,
    profile?.id,
    supabaseClient,
    source,
    toast,
  ]);

  const mayResolveReceiptExceptions =
    can("release_quality_hold") && can("resolve_exceptions");
  const refreshReceiptAuthorityQueues =
    useCallback(async (): Promise<boolean> => {
      if (
        mode !== "supabase" ||
        !supabaseClient ||
        !mayResolveReceiptExceptions
      ) {
        if (mountedRef.current) {
          setExceptionDecisions([]);
          setExcessCustodyItems([]);
        }
        return true;
      }
      const [parentQueue, custodyQueue] = await Promise.all([
        supabaseClient
          .schema("warehouse")
          .rpc("procurement_receipt_exception_work_items", { payload: {} }),
        supabaseClient
          .schema("warehouse")
          .rpc("procurement_receipt_excess_work_items", { payload: {} }),
      ]);
      if (!mountedRef.current) return false;
      if (parentQueue.error || custodyQueue.error) {
        setExceptionDecisions([]);
        setExcessCustodyItems([]);
        toast.error(
          parentQueue.error?.message ??
            custodyQueue.error?.message ??
            "Receipt authority readback failed",
        );
        return false;
      }
      {
        const rows = parentQueue.data;
        setExceptionDecisions(
          ((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
            decisionId: String(row.decision_id),
            receiptId: String(row.receipt_id),
            purchaseOrderId: String(row.purchase_order_id),
            poNumber: String(row.po_number),
            requestedDisposition:
              row.requested_disposition as ReceiptExceptionDecisionItem["requestedDisposition"],
            status: row.status as ReceiptExceptionDecisionItem["status"],
            requestedBy: String(row.requested_by),
            requestedAt: String(row.requested_at),
            reason: String(row.reason ?? ""),
            lines: (row.lines ?? []) as ReceiptExceptionDecisionItem["lines"],
          })),
        );
      }
      {
        const rows = custodyQueue.data;
        setExcessCustodyItems(
          ((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
            custodyId: String(row.custody_id),
            receiptId: String(row.receipt_id),
            purchaseOrderId: String(row.purchase_order_id),
            poLineId: String(row.po_line_id),
            poNumber: String(row.po_number),
            productName: row.product_name
              ? String(row.product_name)
              : undefined,
            orderedQuantity: Number(row.ordered_quantity),
            excessQuantity: Number(row.excess_quantity),
            status: row.status as ExcessCustodyWorkItem["status"],
            eligibleApprovedAmendments: (
              (row.eligible_approved_amendments ?? []) as Array<
                Record<string, unknown>
              >
            ).map((amendment) => ({
              id: String(amendment.id),
              previousQuantity: Number(amendment.previousQuantity),
              amendedQuantity: Number(amendment.amendedQuantity),
              approvedAt: String(amendment.approvedAt),
            })),
          })),
        );
      }
      return true;
    }, [mayResolveReceiptExceptions, mode, supabaseClient, toast]);

  useEffect(() => {
    void refreshReceiptAuthorityQueues();
  }, [refreshReceiptAuthorityQueues]);

  const decideReceiptException = async (
    input: ReceiptExceptionDecisionInput,
  ) => {
    if (!supabaseClient) return false;
    const { error: rpcError } = await supabaseClient
      .schema("warehouse")
      .rpc("resolve_procurement_po_exception", {
        payload: {
          idempotency_key: crypto.randomUUID(),
          decision_id: input.decisionId,
          decision: input.decision,
          reason: input.reason,
          evidence_urls: input.evidenceUrls,
          identifications:
            input.identifications?.map((identification) => ({
              po_line_id: identification.poLineId,
              product_id: identification.productId,
            })) ?? [],
        },
      });
    if (rpcError) {
      toast.error(rpcError.message);
      return false;
    }
    // Reconcile both receipt authority queues after either resolver; parent and custody
    // lifecycle transitions can make the other queue stale in the same transaction.
    if (!(await refreshReceiptAuthorityQueues())) return false;
    toast.success(
      input.decision === "escalate"
        ? "Receipt remains actionable in the escalated queue"
        : "Controlled receipt decision recorded",
    );
    return true;
  };

  const decideExcessCustody = async (input: ExcessCustodyDecisionInput) => {
    if (!supabaseClient) return false;
    const { error: rpcError } = await supabaseClient
      .schema("warehouse")
      .rpc("resolve_procurement_receipt_excess", {
        payload: {
          idempotency_key: crypto.randomUUID(),
          custody_id: input.custodyId,
          outcome: input.outcome,
          approved_amendment_id: input.approvedAmendmentId ?? null,
          reason: input.reason,
          evidence_urls: input.evidenceUrls,
        },
      });
    if (rpcError) {
      toast.error(rpcError.message);
      return false;
    }
    if (!(await refreshReceiptAuthorityQueues())) return false;
    toast.success("Excess custody disposition recorded");
    return true;
  };

  useEffect(() => {
    if (!handoffPoId || openedHandoffRef.current === handoffPoId) return;
    const handoff = bridgedPOs.find((po) => po.id === handoffPoId);
    if (!handoff) return;
    openedHandoffRef.current = handoffPoId;
    setReceivingRequest({
      po: handoff,
      session: ++receivingSessionRef.current,
      load: loadReceivableProcurementPOs,
    });
    setDraftLoading(true);
    receiptAttemptRef.current = null;
    setBridgeReceivePO(handoff);
    setBridgeLocation(warehouses[0]?.id ?? "");
    setBridgeBin("");
    setBridgeEvidence("");
    setBridgePhotos([]);
    setSerialTarget(null);
    setBridgeSelected(
      Object.fromEntries(handoff.lines.map((line) => [line.id, true])),
    );
    setBridgeExceptionReason("");
    setBridgeProducts(
      Object.fromEntries(
        handoff.lines.map((line) => [line.id, line.productId ?? ""]),
      ),
    );
    setBridgeObservedDescriptions(
      Object.fromEntries(
        handoff.lines.map((line) => [line.id, line.description]),
      ),
    );
    setBridgeObservedIdentifiers({});
    setBridgeOutcomes(
      Object.fromEntries(
        handoff.lines.map((line) => [
          line.id,
          initialOutcomeQuantities(
            Math.max(0, line.quantity - line.receivedQuantity),
          ),
        ]),
      ),
    );
    setBridgeSerials(
      Object.fromEntries(
        handoff.lines.map((line) => [line.id, initialOutcomeSerials()]),
      ),
    );
  }, [bridgedPOs, handoffPoId, warehouses, loadReceivableProcurementPOs]);

  const poNumbers = useMemo(
    () => poNumberMap(data?.purchaseOrders ?? []),
    [data],
  );

  const bridgeReceiptValidation = useMemo(() => {
    if (!bridgeReceivePO) {
      return {
        valid: false,
        hasExceptions: false,
        errors: {} as Record<string, string[]>,
      };
    }
    const errors: Record<string, string[]> = {};
    const commandSerials: string[] = [];
    let hasExceptions = false;
    for (const line of bridgeReceivePO.lines) {
      if (!bridgeSelected[line.id]) continue;
      const expected = Math.max(0, line.quantity - line.receivedQuantity);
      const quantities =
        bridgeOutcomes[line.id] ?? initialOutcomeQuantities(expected);
      const lineErrors: string[] = [];
      const reconciled =
        quantities.clean +
        quantities.damaged +
        quantities.unidentified +
        quantities.short;
      if (reconciled !== expected) {
        lineErrors.push(
          `Outcomes must reconcile to ${expected} expected units.`,
        );
      }
      const productId = bridgeProducts[line.id] ?? "";
      if (
        quantities.clean + quantities.damaged + quantities.excess > 0 &&
        !productId
      ) {
        lineErrors.push(
          "Map physical identified units to a Warehouse product.",
        );
      }
      if (quantities.unidentified > 0) {
        hasExceptions = true;
        if (!bridgeObservedDescriptions[line.id]?.trim()) {
          lineErrors.push(
            "Observed description is required for unidentified units.",
          );
        }
      }
      if (
        quantities.damaged > 0 ||
        quantities.short > 0 ||
        quantities.excess > 0
      ) {
        hasExceptions = true;
      }
      const product = data?.products.find((item) => item.id === productId);
      if (product?.serialized) {
        const lineSerials: string[] = [];
        for (const outcome of PHYSICAL_OUTCOMES) {
          const serials = parseSerials(bridgeSerials[line.id]?.[outcome] ?? "");
          if (serials.length !== quantities[outcome]) {
            lineErrors.push(
              `${quantities[outcome]} ${outcome} physical units require ${quantities[outcome]} serials.`,
            );
          }
          lineSerials.push(...serials);
        }
        if (new Set(lineSerials).size !== lineSerials.length) {
          lineErrors.push("Serial numbers must be unique across outcomes.");
        }
        commandSerials.push(...lineSerials);
      }
      if (lineErrors.length > 0) errors[line.id] = lineErrors;
    }
    if (new Set(commandSerials).size !== commandSerials.length) {
      errors.command = ["Serial numbers must be unique across receipt lines."];
    }
    if (!bridgeReceivePO.lines.some((line) => bridgeSelected[line.id])) {
      errors.command = ["Select at least one item to receive."];
    }
    return {
      valid: Object.keys(errors).length === 0,
      hasExceptions,
      errors,
    };
  }, [
    bridgeObservedDescriptions,
    bridgeOutcomes,
    bridgeProducts,
    bridgeReceivePO,
    bridgeSerials,
    bridgeSelected,
    data?.products,
  ]);

  if (!data) return null;
  // Live Warehouse consumes the governed Procurement handoff only. Seeded
  // Warehouse-origin POs remain available solely in memory-mode demonstrations.
  const warehousePOs = source === "memory" ? data.purchaseOrders : [];
  const supplierName = (id: string) =>
    data.suppliers.find((s) => s.id === id)?.name ?? id;
  const productName = (id: string) =>
    data.products.find((p) => p.id === id)?.name ?? id;
  const poNo = (po: PurchaseOrder) => poNumbers.get(po.id) ?? po.id;

  const isOpenPO = (po: PurchaseOrder) =>
    po.status !== "received" && po.status !== "cancelled";
  const isReceivable = (po: PurchaseOrder) =>
    // A draft was never ordered — receiving against it would fake supply
    // (WH-25). Receivable = ordered or partially received.
    po.status === "ordered" || po.status === "partially_received";
  const openCount = warehousePOs.filter(isOpenPO).length;
  const openValue = warehousePOs
    .filter(isOpenPO)
    .reduce((s, po) => s + poValue(po, data.products), 0);
  const shownPOs = warehousePOs
    .slice()
    .sort((a, b) => Number(isOpenPO(b)) - Number(isOpenPO(a)))
    .filter((po) =>
      filter === "all"
        ? true
        : filter === "open"
          ? isOpenPO(po)
          : !isOpenPO(po),
    );
  // Bridged procurement POs are by definition open (issued/approved).
  const shownBridged: BridgedPO[] = filter === "closed" ? [] : bridgedPOs;

  const detailPO = detailPOId
    ? (warehousePOs.find((po) => po.id === detailPOId) ?? null)
    : null;

  const openReceive = (po: PurchaseOrder) => {
    setDetailPOId(null);
    setReceivePO(po);
    setReceiveLoc(warehouses[0]?.id ?? "");
    setReceiveBin("");
    setReceiveQty(
      Object.fromEntries(
        po.lines.map((l) => [
          l.productId,
          Math.max(0, l.quantityOrdered - l.quantityReceived),
        ]),
      ),
    );
  };

  const submitReceive = async () => {
    if (!receivePO || !receiveLoc) return;
    const lines = receivePO.lines
      .map((l) => ({
        productId: l.productId,
        quantityReceived: receiveQty[l.productId] ?? 0,
      }))
      .filter((l) => l.quantityReceived > 0);
    if (lines.length === 0) return;
    const ok = await receiveAgainstPO({
      poId: receivePO.id,
      lines,
      locationId: receiveLoc,
      binId: receiveBin || undefined,
    });
    if (!ok) return;
    toast.success("Received against PO into inspection staging");
    setReceivePO(null);
  };

  const cancel = async (po: PurchaseOrder) => {
    const ok = await cancelPurchaseOrder({ poId: po.id });
    if (!ok) return;
    setConfirmCancel(false);
    setDetailPOId(null);
    toast.success("Purchase order cancelled");
  };

  const openBridgeReceive = (po: BridgedPO) => {
    if (bridgeSubmitting.current) return;
    setReceivingRequest({
      po,
      session: ++receivingSessionRef.current,
      load: loadReceivableProcurementPOs,
    });
    setDraftLoading(true);
    receiptAttemptRef.current = null;
    setBridgeReceivePO(po);
    setBridgeLocation(warehouses[0]?.id ?? "");
    setBridgeBin("");
    setBridgeEvidence("");
    setBridgePhotos([]);
    setSerialTarget(null);
    setBridgeSelected(
      Object.fromEntries(po.lines.map((line) => [line.id, true])),
    );
    setBridgeExceptionReason("");
    setBridgeProducts(
      Object.fromEntries(
        po.lines.map((line) => [line.id, line.productId ?? ""]),
      ),
    );
    setBridgeObservedDescriptions(
      Object.fromEntries(po.lines.map((line) => [line.id, line.description])),
    );
    setBridgeObservedIdentifiers({});
    setBridgeOutcomes(
      Object.fromEntries(
        po.lines.map((line) => [
          line.id,
          initialOutcomeQuantities(
            Math.max(0, line.quantity - line.receivedQuantity),
          ),
        ]),
      ),
    );
    setBridgeSerials(
      Object.fromEntries(
        po.lines.map((line) => [line.id, initialOutcomeSerials()]),
      ),
    );
  };

  const closeBridgeReceive = () => {
    receivingSessionRef.current += 1;
    setReceivingRequest(null);
    setBridgeReceivePO(null);
  };

  const receivingProgress = (): ReceivingProgress => ({
    version: 1,
    locationId: bridgeLocation,
    binId: bridgeBin,
    evidenceLink: bridgeEvidence,
    evidencePhotos: bridgePhotos,
    reason: bridgeExceptionReason,
    lines: (bridgeReceivePO?.lines ?? []).map((line) => ({
      id: line.id,
      expected: Math.max(0, line.quantity - line.receivedQuantity),
      selected: !!bridgeSelected[line.id],
      productId: bridgeProducts[line.id] ?? "",
      description: bridgeObservedDescriptions[line.id] ?? line.description,
      identifiers: bridgeObservedIdentifiers[line.id] ?? "",
      outcomes:
        bridgeOutcomes[line.id] ??
        initialOutcomeQuantities(
          Math.max(0, line.quantity - line.receivedQuantity),
        ),
      serials: bridgeSerials[line.id] ?? initialOutcomeSerials(),
    })),
  });

  const persistProgress = async (body: ReceivingProgress | null) => {
    if (!bridgeReceivePO) return;
    // Version zero means no saved record exists; positive null-body versions are tombstones.
    if (!body && draftVersion === 0) return;
    let record: ReceivingDraftRecord;
    if (mode === "supabase") {
      if (!supabaseClient)
        throw new Error(
          "Receiving progress cannot be saved while disconnected.",
        );
      record = body
        ? await saveReceivingDraft(
            supabaseClient,
            bridgeReceivePO.id,
            body,
            draftVersion,
          )
        : await deleteReceivingDraft(
            supabaseClient,
            bridgeReceivePO.id,
            draftVersion,
          );
    } else {
      record = {
        poId: bridgeReceivePO.id,
        body,
        version: draftVersion + 1,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(draftKey, JSON.stringify(record));
    }
    setDraftVersion(record.version);
    setDraftSavedAt(body ? record.updatedAt : null);
  };

  const saveProgress = async () => {
    if (bridgeSubmitting.current || draftLoading || draftError) return;
    bridgeSubmitting.current = true;
    setBridgeBusy(true);
    try {
      setDraftSaveError("");
      await persistProgress(receivingProgress());
      setDraftConflict(false);
      toast.success(
        "Receiving progress saved. No stock has been received yet.",
      );
    } catch (error) {
      setDraftConflict(error instanceof ReceivingDraftConflictError);
      setDraftSaveError(
        error instanceof Error
          ? error.message
          : "Could not save receiving progress.",
      );
    } finally {
      bridgeSubmitting.current = false;
      setBridgeBusy(false);
    }
  };

  const submitBridgeReceive = async () => {
    if (
      !bridgeReceivePO ||
      !bridgeLocation ||
      !bridgeEvidenceUrls.length ||
      bridgeEvidenceError ||
      bridgeSubmitting.current ||
      draftLoading ||
      draftError
    )
      return;
    if (!bridgeReceiptValidation.valid) return;
    if (
      bridgeReceiptValidation.hasExceptions &&
      !bridgeExceptionReason.trim()
    ) {
      return;
    }
    const lines = bridgeReceivePO.lines
      .filter((line) => bridgeSelected[line.id])
      .map((line) => {
        const expectedQuantity = Math.max(
          0,
          line.quantity - line.receivedQuantity,
        );
        const outcomes =
          bridgeOutcomes[line.id] ?? initialOutcomeQuantities(expectedQuantity);
        const serials = bridgeSerials[line.id] ?? initialOutcomeSerials();
        return {
          mode: "breakdown" as const,
          lineId: line.id,
          productId: bridgeProducts[line.id] ?? "",
          expectedQuantity,
          outcomes: {
            clean: {
              quantity: outcomes.clean,
              serialNumbers: parseSerials(serials.clean),
            },
            damaged: {
              quantity: outcomes.damaged,
              serialNumbers: parseSerials(serials.damaged),
            },
            unidentified: {
              quantity: outcomes.unidentified,
              serialNumbers: parseSerials(serials.unidentified),
              observedDescription:
                bridgeObservedDescriptions[line.id]?.trim() ?? line.description,
              observedIdentifiers:
                bridgeObservedIdentifiers[line.id]?.trim() || undefined,
            },
            short: { quantity: outcomes.short },
            excess: {
              quantity: outcomes.excess,
              serialNumbers: parseSerials(serials.excess),
            },
          },
        };
      })
      .filter((line) => {
        const outcomes = line.outcomes;
        return (
          outcomes.clean.quantity +
            outcomes.damaged.quantity +
            outcomes.unidentified.quantity +
            outcomes.short.quantity +
            outcomes.excess.quantity >
          0
        );
      });
    if (lines.length === 0) return;
    bridgeSubmitting.current = true;
    setBridgeBusy(true);
    const input = {
      mode: "breakdown" as const,
      poId: bridgeReceivePO.id,
      locationId: bridgeLocation,
      binId: bridgeBin || undefined,
      lines,
      exceptionReason: bridgeExceptionReason.trim() || undefined,
      evidenceUrls: bridgeEvidenceUrls,
    };
    const payload = JSON.stringify(input);
    if (receiptAttemptRef.current?.payload !== payload) {
      receiptAttemptRef.current = { payload, key: crypto.randomUUID() };
    }
    try {
      const ok = await receiveProcurementPO({
        ...input,
        idempotencyKey: receiptAttemptRef.current.key,
      });
      if (!ok) return;
      try {
        const remaining = receivingProgress();
        remaining.lines = remaining.lines.filter(
          (line) => !bridgeSelected[line.id],
        );
        await persistProgress(remaining.lines.length ? remaining : null);
      } catch {
        toast.error(
          "Receipt succeeded, but saved progress could not be updated. Reopen the PO and review current balances before retrying anything.",
        );
      }
      toast.success(
        bridgeReceiptValidation.hasExceptions
          ? "Receipt breakdown sent to inspection staging and the Supervisor queue"
          : "Procurement PO received into inspection staging",
      );
      receiptAttemptRef.current = null;
      closeBridgeReceive();
      setBridgeReload((value) => value + 1);
    } finally {
      bridgeSubmitting.current = false;
      setBridgeBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Orders"
        icon="cart"
        subtitle={
          canManagePOs
            ? "Supplier sourcing & receiving"
            : "Receive incoming supplier orders"
        }
        action={
          canManagePOs ? (
            <a href="/procurement/requests" className="btn-primary btn-sm">
              <Icon name="cart" className="h-4 w-4" /> Open Procurement requests
            </a>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Receive and inspect</p>
          <p className="text-xs opacity-80">
            Clean accepted stock continues to putaway; shortages, damage,
            rejection, and quarantine create Supervisor exceptions.
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

      <section
        className="rounded-xl border border-line bg-surface p-4"
        aria-labelledby="po-receiving-flow"
      >
        <h2 id="po-receiving-flow" className="font-semibold text-ink">
          From rider arrival to available stock
        </h2>
        <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {[
            "1. Open the matching approved PO",
            "2. Compare PO, delivery receipt, and physical count",
            "3. Receive into inspection and scan traceability",
            "4. Accept, assign a bin, and complete putaway",
          ].map((step) => (
            <li key={step} className="rounded-lg bg-inset px-3 py-2 text-muted">
              {step}
            </li>
          ))}
        </ol>
      </section>

      {mayResolveReceiptExceptions && (
        <>
          <ReceiptExceptionDecisionPanel
            items={exceptionDecisions}
            products={data.products}
            onDecision={decideReceiptException}
          />
          <ExcessCustodyDecisionPanel
            items={excessCustodyItems}
            onDecision={decideExcessCustody}
          />
        </>
      )}

      {warehousePOs.length === 0 && bridgedPOs.length === 0 ? (
        <EmptyState
          icon="cart"
          title="No purchase orders"
          message={
            canManagePOs
              ? "This is the PO checking and receiving queue. Approved Procurement POs appear here; select one to compare the PO, delivery receipt, and physical count before inspection."
              : "This is the PO checking and receiving queue. When Procurement issues an approved PO, select it here before accepting the supplier delivery."
          }
          action={
            canManagePOs ? (
              <a href="/procurement/requests" className="btn-primary">
                <Icon name="cart" className="h-4 w-4" /> Open Procurement
                requests
              </a>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-full sm:w-72">
              <SegmentedControl<POFilter>
                ariaLabel="PO status filter"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "open", label: "Open" },
                  { value: "closed", label: "Closed" },
                ]}
              />
            </div>
            <p className="text-xs text-faint">
              <span className="font-semibold text-brand-700 dark:text-brand-300">
                {openCount}
              </span>{" "}
              open • {money(openValue)} on order
              {bridgedPOs.length > 0 && (
                <> • {bridgedPOs.length} from procurement</>
              )}
            </p>
          </div>
          {shownPOs.length === 0 && shownBridged.length === 0 ? (
            <EmptyState icon="cart" title={`No ${filter} purchase orders`} />
          ) : (
            <ul
              className="grid gap-3 lg:grid-cols-2"
              aria-label="Purchase orders"
            >
              {shownPOs.map((po) => (
                <li key={po.id}>
                  <button
                    type="button"
                    onClick={() => setDetailPOId(po.id)}
                    className="card block w-full space-y-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-e3 sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">
                          {poNo(po)} · {supplierName(po.supplierId)}
                        </p>
                        <p className="text-xs text-faint">
                          {formatWhen(po.createdAt)}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONE[po.status]}>
                        {PO_STATUS_LABELS[po.status]}
                      </Badge>
                    </div>
                    <BarRow
                      label={`Received ${poTotalReceived(po)} / ${poTotalOrdered(po)}`}
                      value={poProgress(po)}
                      max={100}
                      suffix="%"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted">
                        {po.lines.length} line(s) •{" "}
                        {money(poValue(po, data.products))}
                      </span>
                      <span aria-hidden className="text-faint">
                        <Icon name="chevron" className="h-4 w-4" />
                      </span>
                    </div>
                  </button>
                </li>
              ))}

              {/* Procurement-issued POs (read-only bridge, J1-6). */}
              {shownBridged.map((po) => {
                const pct =
                  po.totalOrdered > 0
                    ? Math.round((po.totalReceived / po.totalOrdered) * 100)
                    : 0;
                return (
                  <li key={`bridged-${po.id}`}>
                    <Card className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <a
                            href={po.warehouseHref}
                            className="flex min-h-11 max-w-full items-center font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
                            title="Open Warehouse receiving details"
                          >
                            <span className="truncate">{po.poNumber}</span>
                          </a>
                          <p className="truncate text-sm text-ink">
                            {po.vendorName}
                          </p>
                          <p className="text-xs text-faint">
                            {bridgedPoDateLabel(po)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge tone="cyan">From Procurement</Badge>
                          <Badge
                            tone={po.status === "issued" ? "brand" : "emerald"}
                          >
                            {po.totalReceived > 0
                              ? "Partially received"
                              : (PO_STATUS_LABELS[po.status as POStatus] ??
                                po.status)}
                          </Badge>
                        </div>
                      </div>
                      <BarRow
                        label={`Received ${po.totalReceived} / ${po.totalOrdered}`}
                        value={pct}
                        max={100}
                        suffix="%"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted">
                          {po.lines.length} line(s) • {money(po.value)}
                        </span>
                        {canReceive && po.status === "issued" ? (
                          <button
                            type="button"
                            className="btn-accent btn-sm shrink-0"
                            onClick={() => openBridgeReceive(po)}
                          >
                            <Icon name="truck" className="h-4 w-4" /> Receive
                            and inspect
                          </button>
                        ) : (
                          <span className="text-xs font-medium text-faint">
                            Warehouse handoff status
                          </span>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* PO detail sheet — the row's single target; actions live here. */}
      <Sheet
        open={detailPO !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDetailPOId(null);
            setConfirmCancel(false);
          }
        }}
        title={
          detailPO
            ? `${poNo(detailPO)} · ${supplierName(detailPO.supplierId)}`
            : "Purchase order"
        }
        description={
          detailPO ? `Created ${formatDate(detailPO.createdAt)}` : undefined
        }
        footer={
          detailPO && (canReceive || canManagePOs) && isOpenPO(detailPO) ? (
            <div className="flex gap-2">
              {canManagePOs && !confirmCancel && (
                <button
                  type="button"
                  className="btn-ghost flex-1 justify-center"
                  onClick={() => setConfirmCancel(true)}
                >
                  Cancel PO
                </button>
              )}
              {canReceive && isReceivable(detailPO) && !confirmCancel && (
                <button
                  type="button"
                  className="btn-primary flex-1 justify-center"
                  onClick={() => openReceive(detailPO)}
                >
                  <Icon name="truck" className="h-4 w-4" /> Receive and inspect
                </button>
              )}
              {confirmCancel && (
                <>
                  <button
                    type="button"
                    className="btn-ghost flex-1 justify-center"
                    onClick={() => setConfirmCancel(false)}
                  >
                    Keep PO
                  </button>
                  <button
                    type="button"
                    className="btn-primary flex-1 justify-center bg-rose-600 hover:bg-rose-700"
                    onClick={() => detailPO && void cancel(detailPO)}
                  >
                    Confirm cancel
                  </button>
                </>
              )}
            </div>
          ) : undefined
        }
      >
        {detailPO && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge tone={STATUS_TONE[detailPO.status]}>
                {PO_STATUS_LABELS[detailPO.status]}
              </Badge>
              <span className="text-sm font-semibold text-ink">
                {money(poValue(detailPO, data.products))}
              </span>
            </div>
            {detailPO.status === "draft" && (
              <p className="rounded-xl bg-inset px-3 py-2 text-xs text-muted">
                Draft — not yet ordered from the supplier. Receiving unlocks
                once the PO is ordered.
              </p>
            )}
            <ul className="space-y-2" aria-label="PO lines">
              {detailPO.lines.map((l) => (
                <li
                  key={l.productId}
                  className="flex items-center justify-between gap-3 rounded-xl bg-inset p-3"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-ink">
                    {productName(l.productId)}
                  </span>
                  <span className="shrink-0 text-xs text-faint">
                    {l.quantityReceived}/{l.quantityOrdered} received
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Sheet>

      {/* Receive against PO sheet */}
      <Sheet
        open={receivePO !== null}
        onOpenChange={(o) => !o && setReceivePO(null)}
        title="Receive against PO"
        description={
          receivePO
            ? `${poNo(receivePO)} · ${supplierName(receivePO.supplierId)}`
            : undefined
        }
        footer={
          <CertifiedAction module="warehouse" capability="receive_stock">
            {({ execute, pending }) => (
              <button
                type="button"
                className="btn-primary w-full sm:w-auto"
                onClick={() => void execute(submitReceive)}
                disabled={pending}
              >
                Confirm receipt
              </button>
            )}
          </CertifiedAction>
        }
      >
        {receivePO && (
          <div className="space-y-3">
            <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200">
              Inspection required. Choose a receiving-staging location; accepted
              stock moves to putaway after review.
            </p>
            <Field label="Receive into" htmlFor="po-rcv-loc">
              <select
                id="po-rcv-loc"
                className="input"
                value={receiveLoc}
                onChange={(e) => {
                  setReceiveLoc(e.target.value);
                  setReceiveBin("");
                }}
              >
                {warehouses.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            {(() => {
              const bins = (data.storageAreas ?? []).filter(
                (b) => b.locationId === receiveLoc,
              );
              if (bins.length === 0) return null;
              return (
                <Field
                  label="Receiving staging bin"
                  htmlFor="po-rcv-bin"
                  hint="Optional — pick the bin/shelf this stock is stored in."
                >
                  <select
                    id="po-rcv-bin"
                    className="input"
                    value={receiveBin}
                    onChange={(e) => setReceiveBin(e.target.value)}
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
              );
            })()}
            <ul className="space-y-2">
              {receivePO.lines.map((l) => {
                const outstanding = l.quantityOrdered - l.quantityReceived;
                return (
                  <li key={l.productId} className="rounded-xl bg-inset p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">
                        {productName(l.productId)}
                      </span>
                      <span className="text-xs text-faint">
                        {l.quantityReceived}/{l.quantityOrdered} · {outstanding}{" "}
                        left
                      </span>
                    </div>
                    <QuantityStepper
                      aria-label={`Receive ${productName(l.productId)}`}
                      min={0}
                      max={outstanding}
                      value={receiveQty[l.productId] ?? 0}
                      onChange={(v) =>
                        setReceiveQty((prev) => ({ ...prev, [l.productId]: v }))
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Sheet>

      <Sheet
        open={bridgeReceivePO !== null}
        onOpenChange={(open) => !open && !bridgeBusy && closeBridgeReceive()}
        title="Receive approved procurement PO"
        description={bridgeReceivePO?.poNumber}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={
                bridgeBusy || draftLoading || !!draftError || draftConflict
              }
              onClick={() => void saveProgress()}
            >
              {draftSaveError && !draftConflict
                ? "Retry save progress"
                : "Save progress"}
            </button>
            <button
              type="button"
              className="btn-primary w-full"
              disabled={
                !bridgeLocation ||
                !bridgeEvidenceUrls.length ||
                !!bridgeEvidenceError ||
                bridgeBusy ||
                draftLoading ||
                !!draftError ||
                !bridgeReceiptValidation.valid ||
                (bridgeReceiptValidation.hasExceptions &&
                  !bridgeExceptionReason.trim())
              }
              onClick={() => void submitBridgeReceive()}
            >
              Confirm governed receipt
            </button>
          </div>
        }
      >
        {bridgeReceivePO && (
          <div className="space-y-3">
            {draftLoading && (
              <p role="status" className="text-sm text-muted">
                Loading your saved receiving progress...
              </p>
            )}
            {draftSavedAt && (
              <p role="status" className="text-sm text-muted">
                Your saved progress: {formatWhen(draftSavedAt)}. Stock changes
                only after confirmation.
              </p>
            )}
            {draftError && (
              <div
                role="alert"
                className="space-y-2 text-sm text-rose-700 dark:text-rose-300"
              >
                <p>{draftError}</p>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => openBridgeReceive(bridgeReceivePO)}
                >
                  Reload saved progress
                </button>
              </div>
            )}
            {draftSaveError && (
              <div
                role="alert"
                className="space-y-2 text-sm text-rose-700 dark:text-rose-300"
              >
                <p>{draftSaveError}</p>
                {draftConflict && !confirmDraftReload && (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={bridgeBusy}
                    onClick={() => setConfirmDraftReload(true)}
                  >
                    Reload saved progress
                  </button>
                )}
                {draftConflict && confirmDraftReload && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setConfirmDraftReload(false)}
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={bridgeBusy}
                      onClick={() => openBridgeReceive(bridgeReceivePO)}
                    >
                      Discard unsaved changes and reload
                    </button>
                  </div>
                )}
              </div>
            )}
            <fieldset
              disabled={draftLoading || bridgeBusy || !!draftError}
              className="min-w-0 space-y-3"
            >
              <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200">
                Inspection required before putaway or allocation.
              </p>
              <p className="text-sm text-muted">
                Select the items you are receiving. Other operators can receive
                the remaining items with their own accounts.
              </p>
              <Field label="Receive into" htmlFor="bridge-receive-location">
                <select
                  id="bridge-receive-location"
                  className="input"
                  value={bridgeLocation}
                  onChange={(event) => {
                    setBridgeLocation(event.target.value);
                    setBridgeBin("");
                  }}
                >
                  {warehouses.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Receiving staging bin" htmlFor="bridge-receive-bin">
                <select
                  id="bridge-receive-bin"
                  className="input"
                  value={bridgeBin}
                  onChange={(event) => setBridgeBin(event.target.value)}
                >
                  <option value="">General area</option>
                  {data.storageAreas
                    .filter(
                      (bin) =>
                        bin.locationId === bridgeLocation &&
                        bin.active !== false,
                    )
                    .map((bin) => (
                      <option key={bin.id} value={bin.id}>
                        {bin.code}
                      </option>
                    ))}
                </select>
              </Field>
              <EvidenceCapture
                key={receivingRequest?.session}
                reference={`procurement-receiving/${bridgeReceivePO.id}`}
                label="Upload or photograph delivery note"
                onChange={(photos) => {
                  if (
                    !mountedRef.current ||
                    receivingRequest?.session !== receivingSessionRef.current
                  )
                    return;
                  setBridgePhotos([
                    ...receivingStateRef.current.restoredPhotos,
                    ...photos,
                  ]);
                }}
              />
              {restoredPhotos.length > 0 && (
                <div className="space-y-2">
                  <EvidenceGallery urls={restoredPhotos} />
                  {restoredPhotos.map((photo, index) => (
                    <button
                      key={photo}
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        setRestoredPhotos((current) =>
                          current.filter((value) => value !== photo),
                        );
                        setBridgePhotos((current) =>
                          current.filter((value) => value !== photo),
                        );
                      }}
                    >
                      <Icon name="x" /> Remove saved photo {index + 1}
                    </button>
                  ))}
                </div>
              )}
              <Field
                label="Delivery evidence URL"
                htmlFor="bridge-receive-evidence"
              >
                <input
                  id="bridge-receive-evidence"
                  className="input"
                  value={bridgeEvidence}
                  onChange={(event) => setBridgeEvidence(event.target.value)}
                  placeholder="Optional HTTPS link to a delivery document"
                />
              </Field>
              {bridgeEvidenceError && (
                <p
                  role="alert"
                  className="text-sm text-rose-700 dark:text-rose-300"
                >
                  {bridgeEvidenceError}
                </p>
              )}
              {bridgeReceiptValidation.hasExceptions && (
                <Field
                  label="Exception reason"
                  htmlFor="bridge-exception-reason"
                >
                  <textarea
                    id="bridge-exception-reason"
                    className="input"
                    rows={3}
                    value={bridgeExceptionReason}
                    onChange={(event) =>
                      setBridgeExceptionReason(event.target.value)
                    }
                  />
                </Field>
              )}
              <ul
                className="space-y-3"
                aria-label="Procurement PO receipt lines"
              >
                {bridgeReceivePO.lines.map((line) => {
                  const remaining = Math.max(
                    0,
                    line.quantity - line.receivedQuantity,
                  );
                  const quantities =
                    bridgeOutcomes[line.id] ??
                    initialOutcomeQuantities(remaining);
                  const serials =
                    bridgeSerials[line.id] ?? initialOutcomeSerials();
                  const mappedProduct = data.products.find(
                    (product) => product.id === bridgeProducts[line.id],
                  );
                  const physical =
                    quantities.clean +
                    quantities.damaged +
                    quantities.unidentified +
                    quantities.excess;
                  const lineErrors =
                    bridgeReceiptValidation.errors[line.id] ?? [];
                  return (
                    <li
                      key={line.id}
                      className="space-y-3 rounded-lg bg-inset p-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
                          <input
                            type="checkbox"
                            checked={!!bridgeSelected[line.id]}
                            aria-label={`Receive ${line.description}`}
                            onChange={(event) =>
                              setBridgeSelected((current) => ({
                                ...current,
                                [line.id]: event.target.checked,
                              }))
                            }
                          />
                          {line.description}
                        </label>
                        <p className="text-xs text-muted">
                          {remaining} expected · {physical} physical ·{" "}
                          {quantities.short} short · {quantities.excess} excess
                        </p>
                      </div>
                      <fieldset
                        disabled={!bridgeSelected[line.id] || bridgeBusy}
                        className="min-w-0 space-y-3 disabled:opacity-50"
                      >
                        <ProductSelect
                          aria-label={`Map ${line.description}`}
                          products={data.products}
                          value={bridgeProducts[line.id] ?? ""}
                          onChange={(productId) =>
                            setBridgeProducts((current) => ({
                              ...current,
                              [line.id]: productId,
                            }))
                          }
                          placeholder="Map identified units to Warehouse product"
                        />
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {(
                            [
                              "clean",
                              "damaged",
                              "unidentified",
                              "short",
                              "excess",
                            ] as const
                          ).map((outcome) => (
                            <Field
                              key={outcome}
                              label={`${outcome[0]!.toUpperCase()}${outcome.slice(1)}`}
                              htmlFor={`${outcome}-quantity-${line.id}`}
                            >
                              <input
                                id={`${outcome}-quantity-${line.id}`}
                                aria-label={`${outcome} quantity for ${line.description}`}
                                className="input text-center"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={
                                  outcome === "excess" ? undefined : remaining
                                }
                                value={quantities[outcome]}
                                onChange={(event) => {
                                  const next = Number(event.target.value);
                                  setBridgeOutcomes((current) => ({
                                    ...current,
                                    [line.id]: {
                                      ...quantities,
                                      [outcome]: Number.isFinite(next)
                                        ? Math.max(0, Math.trunc(next))
                                        : 0,
                                    },
                                  }));
                                }}
                              />
                            </Field>
                          ))}
                        </div>
                        {mappedProduct?.serialized && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {PHYSICAL_OUTCOMES.filter(
                              (outcome) => quantities[outcome] > 0,
                            ).map((outcome) => (
                              <Field
                                key={outcome}
                                label={`${outcome[0]!.toUpperCase()}${outcome.slice(1)} serials (${quantities[outcome]})`}
                                htmlFor={`${outcome}-serials-${line.id}`}
                              >
                                <button
                                  type="button"
                                  className="btn-ghost w-full mb-2"
                                  aria-expanded={
                                    serialTarget === `${line.id}:${outcome}`
                                  }
                                  onClick={() =>
                                    setSerialTarget((current) =>
                                      current === `${line.id}:${outcome}`
                                        ? null
                                        : `${line.id}:${outcome}`,
                                    )
                                  }
                                >
                                  <Icon name="scan" /> Scan {outcome} serials
                                  for {line.description}
                                </button>
                                {serialTarget === `${line.id}:${outcome}` && (
                                  <BarcodeScanner
                                    label="Start camera scan"
                                    manualLabel={`Serial for ${outcome} ${line.description}`}
                                    manualActionLabel="Add serial"
                                    onDetected={(code) => {
                                      if (
                                        !mountedRef.current ||
                                        receivingRequest?.session !==
                                          receivingSessionRef.current ||
                                        bridgeSubmitting.current
                                      )
                                        return;
                                      const latest = receivingStateRef.current;
                                      if (!latest.bridgeSelected[line.id])
                                        return;
                                      const value = code.trim();
                                      if (!value) return;
                                      const existing = Object.values(
                                        latest.bridgeSerials,
                                      ).flatMap((group) =>
                                        Object.values(group).flatMap(
                                          parseSerials,
                                        ),
                                      );
                                      if (existing.includes(value)) {
                                        toast.error(
                                          "Serial already scanned in this receipt.",
                                        );
                                        return;
                                      }
                                      const currentGroup =
                                        latest.bridgeSerials[line.id] ??
                                        initialOutcomeSerials();
                                      const currentSerials = parseSerials(
                                        currentGroup[outcome],
                                      );
                                      if (
                                        currentSerials.length >=
                                        (latest.bridgeOutcomes[line.id]?.[
                                          outcome
                                        ] ?? 0)
                                      ) {
                                        toast.error(
                                          "This outcome already has all required serials.",
                                        );
                                        return;
                                      }
                                      const next = {
                                        ...latest.bridgeSerials,
                                        [line.id]: {
                                          ...currentGroup,
                                          [outcome]: [
                                            ...currentSerials,
                                            value,
                                          ].join("\n"),
                                        },
                                      };
                                      receivingStateRef.current.bridgeSerials =
                                        next;
                                      setBridgeSerials(next);
                                    }}
                                  />
                                )}
                                <textarea
                                  id={`${outcome}-serials-${line.id}`}
                                  aria-label={`${outcome} serials for ${line.description}`}
                                  className="input min-h-24 resize-y font-mono text-sm"
                                  rows={Math.min(
                                    6,
                                    Math.max(2, quantities[outcome]),
                                  )}
                                  value={serials[outcome]}
                                  onChange={(event) =>
                                    setBridgeSerials((current) => ({
                                      ...current,
                                      [line.id]: {
                                        ...serials,
                                        [outcome]: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </Field>
                            ))}
                          </div>
                        )}
                        {quantities.unidentified > 0 && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Field
                              label={`Observed description for ${line.description}`}
                              htmlFor={`observed-description-${line.id}`}
                            >
                              <input
                                id={`observed-description-${line.id}`}
                                className="input"
                                value={
                                  bridgeObservedDescriptions[line.id] ?? ""
                                }
                                onChange={(event) =>
                                  setBridgeObservedDescriptions((current) => ({
                                    ...current,
                                    [line.id]: event.target.value,
                                  }))
                                }
                              />
                            </Field>
                            <Field
                              label={`Observed identifiers for ${line.description}`}
                              htmlFor={`observed-identifiers-${line.id}`}
                            >
                              <input
                                id={`observed-identifiers-${line.id}`}
                                className="input"
                                value={bridgeObservedIdentifiers[line.id] ?? ""}
                                onChange={(event) =>
                                  setBridgeObservedIdentifiers((current) => ({
                                    ...current,
                                    [line.id]: event.target.value,
                                  }))
                                }
                              />
                            </Field>
                          </div>
                        )}
                        {lineErrors.length > 0 && (
                          <ul className="space-y-1 text-xs font-medium text-rose-700 dark:text-rose-300">
                            {lineErrors.map((error) => (
                              <li key={error}>{error}</li>
                            ))}
                          </ul>
                        )}
                      </fieldset>
                    </li>
                  );
                })}
              </ul>
              {bridgeReceiptValidation.errors.command?.map((error) => (
                <p
                  key={error}
                  className="text-xs font-medium text-rose-700 dark:text-rose-300"
                >
                  {error}
                </p>
              ))}
            </fieldset>
          </div>
        )}
      </Sheet>
    </div>
  );
}
