"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@intra/auth";
import { can } from "@intra/rbac";
import { FINANCE_DEMO_DATA } from "./seed";
import type {
  FinanceActivity,
  FinanceActivityFilter,
  FinanceActivitySource,
  FinanceData,
  FinanceCloseEntry,
  ManageFinanceCloseEntryInput,
  FinancePaymentItem,
  FinanceSummary,
  PaymentReadinessStatus,
} from "./types";

type FinanceClient = NonNullable<
  ReturnType<typeof useSession>["supabaseClient"]
>;
type UnknownRow = Record<string, unknown>;

export interface FinanceSourceAccess {
  procurement: boolean;
  warehouse: boolean;
}

const ACTIVITY_SOURCES = new Set<FinanceActivitySource>([
  "procurement_po",
  "warehouse_receipt",
  "warehouse_return",
]);

const PAYMENT_STATUSES = new Set<PaymentReadinessStatus>([
  "draft",
  "ready_for_finance",
  "returned",
  "accepted",
  "released",
  "superseded",
]);

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionalText(value: unknown): string | undefined {
  const result = text(value);
  return result || undefined;
}

function amount(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function rows(value: unknown): UnknownRow[] {
  return Array.isArray(value) ? (value as UnknownRow[]) : [];
}

export function summarizeFinanceData(data: FinanceData): FinanceSummary {
  const committedValue = data.activity
    .filter((item) => item.source === "procurement_po")
    .reduce((sum, item) => sum + item.amount, 0);
  const receivedValue = data.activity
    .filter((item) => item.source === "warehouse_receipt")
    .reduce((sum, item) => sum + item.amount, 0);
  const returnedValue = Math.abs(
    data.activity
      .filter((item) => item.source === "warehouse_return")
      .reduce((sum, item) => sum + item.amount, 0),
  );
  return {
    inventoryValue: data.inventoryValue,
    committedValue,
    receivedValue,
    returnedValue,
    netWarehouseValue: receivedValue - returnedValue,
    reviewCount: data.payments.filter(
      (item) => item.status === "ready_for_finance",
    ).length,
    returnedCount: data.payments.filter((item) => item.status === "returned")
      .length,
    acceptedCount: data.payments.filter(
      (item) => item.status === "accepted" || item.status === "released",
    ).length,
  };
}

export function filterFinanceActivity(
  activity: readonly FinanceActivity[],
  filter: FinanceActivityFilter,
): FinanceActivity[] {
  if (filter === "all") return [...activity];
  const source: FinanceActivitySource =
    filter === "procurement"
      ? "procurement_po"
      : filter === "receipts"
        ? "warehouse_receipt"
        : "warehouse_return";
  return activity.filter((item) => item.source === source);
}

export function validateFinanceCloseEntry(
  input: ManageFinanceCloseEntryInput,
): string[] {
  const errors: string[] = [];
  if (input.action === "save" && (!Number.isFinite(input.amount) || Number(input.amount) <= 0)) {
    errors.push("Amount must be greater than zero.");
  }
  if (input.action === "exception" && !input.reconciliationNote?.trim()) {
    errors.push("Provide a correction reason before flagging a close entry.");
  }
  return errors;
}

export function applyMemoryFinanceCloseEntry(
  data: FinanceData,
  input: ManageFinanceCloseEntryInput,
  actor = "finance@mwell.demo",
): FinanceData {
  const errors = validateFinanceCloseEntry(input);
  if (errors.length) throw new Error(errors[0]);
  const now = new Date().toISOString();
  if (input.action === "save") {
    const entry: FinanceCloseEntry = {
      id: input.id ?? `close-demo-${Date.now()}`,
      periodStart: input.periodStart ?? "",
      periodEnd: input.periodEnd ?? "",
      entryType: input.entryType ?? "cost_center",
      sourceModule: input.sourceModule ?? "finance",
      sourceReference: input.sourceReference ?? "memory",
      costCenter: input.costCenter,
      amount: Number(input.amount),
      status: "ready",
      evidenceUrl: input.evidenceUrl,
      reconciliationNote: input.reconciliationNote,
      preparedBy: actor,
      preparedAt: now,
      updatedAt: now,
    };
    return { ...data, closeEntries: [entry, ...data.closeEntries] };
  }
  const entry = data.closeEntries.find((item) => item.id === input.id);
  if (!entry) throw new Error("Finance close entry was not found. Refresh before retrying.");
  if (input.action === "post" && entry.preparedBy === actor) {
    throw new Error("A different Finance user must post a prepared close entry.");
  }
  if (input.action === "reconcile" && entry.postedBy === actor) {
    throw new Error("A different Finance user must reconcile a posted close entry.");
  }
  const status = input.action === "post" ? "posted" : input.action === "reconcile" ? "reconciled" : "exception";
  return {
    ...data,
    closeEntries: data.closeEntries.map((item) => item.id === entry.id ? {
      ...item,
      status,
      reconciliationNote: input.reconciliationNote ?? item.reconciliationNote,
      postedBy: input.action === "post" ? actor : item.postedBy,
      postedAt: input.action === "post" ? now : item.postedAt,
      updatedAt: now,
    } : item),
  };
}

export function scopeFinanceData(
  data: FinanceData,
  access: FinanceSourceAccess,
): FinanceData {
  return {
    activity: data.activity.filter((item) =>
      item.source === "procurement_po" ? access.procurement : access.warehouse,
    ),
    payments: access.procurement ? [...data.payments] : [],
    closeEntries: [...data.closeEntries],
    inventoryValue: access.warehouse ? data.inventoryValue : 0,
    warnings: [...data.warnings],
  };
}

function mapActivity(row: UnknownRow): FinanceActivity | null {
  const source = text(row.source) as FinanceActivitySource;
  const referenceId = text(row.ref_id);
  if (!ACTIVITY_SOURCES.has(source) || !referenceId) return null;
  return {
    id: `${source}:${referenceId}`,
    source,
    referenceId,
    purchaseOrderId: optionalText(row.po_id),
    vendorId: optionalText(row.vendor_id),
    amount: amount(row.amount),
    status: text(row.status, "unknown"),
    occurredAt: text(row.occurred_at, new Date(0).toISOString()),
  };
}

function mapPayment(
  row: UnknownRow,
  purchaseOrders: ReadonlyMap<string, UnknownRow>,
): FinancePaymentItem | null {
  const id = text(row.id);
  const purchaseOrderId = text(row.purchase_order_id);
  const status = text(row.status) as PaymentReadinessStatus;
  if (!id || !purchaseOrderId || !PAYMENT_STATUSES.has(status)) return null;
  const po = purchaseOrders.get(purchaseOrderId);
  return {
    id,
    purchaseOrderId,
    poNumber: text(po?.po_number, purchaseOrderId),
    vendorName: text(po?.vendor_name, "Vendor not available"),
    amount: amount(row.invoice_amount ?? po?.total),
    invoiceNumber: optionalText(row.invoice_number),
    dueDate: optionalText(row.due_date),
    releasedAmount: amount(row.released_amount),
    remainingAmount: Math.max(
      amount(row.invoice_amount ?? po?.total) - amount(row.released_amount),
      0,
    ),
    poStatus: text(po?.status, "unknown"),
    status,
    poMatch: row.po_match === true,
    invoiceReference: optionalText(row.invoice_or_si_storage_path),
    preparedAt: text(row.prepared_at, new Date(0).toISOString()),
    preparedBy: optionalText(row.prepared_by),
    reviewedAt: optionalText(row.finance_reviewed_at),
    reviewedBy: optionalText(row.finance_reviewed_by),
    reviewNote: optionalText(row.finance_note),
  };
}

function mapCloseEntry(row: UnknownRow): FinanceCloseEntry | null {
  const id = text(row.id);
  const entryType = text(row.entry_type) as FinanceCloseEntry["entryType"];
  if (!id || !entryType) return null;
  return {
    id,
    periodStart: text(row.period_start),
    periodEnd: text(row.period_end),
    entryType,
    sourceModule: text(row.source_module),
    sourceReference: text(row.source_reference),
    costCenter: optionalText(row.cost_center),
    amount: amount(row.amount),
    status: text(row.status, "draft") as FinanceCloseEntry["status"],
    evidenceUrl: optionalText(row.evidence_url),
    reconciliationNote: optionalText(row.reconciliation_note),
    preparedBy: text(row.prepared_by),
    preparedAt: text(row.prepared_at),
    postedBy: optionalText(row.posted_by),
    postedAt: optionalText(row.posted_at),
    updatedAt: text(row.updated_at),
  };
}

export async function manageLiveFinanceCloseEntry(
  client: FinanceClient,
  input: ManageFinanceCloseEntryInput,
): Promise<FinanceCloseEntry> {
  const validation = validateFinanceCloseEntry(input);
  if (validation.length) throw new Error(validation[0]);
  const { data, error } = await client
    .schema("core")
    .rpc("manage_finance_close_entry", {
      payload: {
        action: input.action,
        id: input.id ?? null,
        period_start: input.periodStart ?? null,
        period_end: input.periodEnd ?? null,
        entry_type: input.entryType ?? null,
        source_module: input.sourceModule ?? null,
        source_reference: input.sourceReference ?? null,
        cost_center: input.costCenter ?? null,
        amount: input.amount ?? null,
        evidence_url: input.evidenceUrl ?? null,
        reconciliation_note: input.reconciliationNote ?? null,
        expected_updated_at: input.expectedUpdatedAt ?? null,
      },
    });
  if (error) throw error;
  const mapped = mapCloseEntry((data ?? {}) as UnknownRow);
  if (!mapped) throw new Error("Finance close entry could not be read.");
  return mapped;
}
export async function loadLiveFinanceData(
  client: FinanceClient,
  access: FinanceSourceAccess = { procurement: true, warehouse: true },
): Promise<FinanceData> {
  const emptyResult = () =>
    Promise.resolve({
      data: [] as UnknownRow[],
      error: null as { message: string } | null,
    });
  const [
    activityResult,
    purchaseOrderResult,
    paymentResult,
    inventoryResult,
    productResult,
    closeEntryResult,
  ] = await Promise.all([
    access.procurement || access.warehouse
      ? client
          .schema("core")
          .from("v_finance_activity")
          .select("source,ref_id,po_id,vendor_id,amount,status,occurred_at")
          .order("occurred_at", { ascending: false })
          .limit(1000)
      : emptyResult(),
    access.procurement
      ? client
          .schema("procurement")
          .from("purchase_orders")
          .select("id,po_number,vendor_name,total,status,updated_at")
          .order("updated_at", { ascending: false })
          .limit(1000)
      : emptyResult(),
    access.procurement
      ? client
          .schema("procurement")
          .from("payment_readiness_packs")
          .select(
            "id,purchase_order_id,status,po_match,invoice_or_si_storage_path,invoice_number,due_date,invoice_amount,released_amount,prepared_by,prepared_at,finance_reviewed_by,finance_reviewed_at,finance_note",
          )
          .neq("status", "superseded")
          .order("prepared_at", { ascending: false })
          .limit(1000)
      : emptyResult(),
    access.warehouse
      ? client
          .schema("warehouse")
          .from("inventory_position_v1")
          .select("product_id,on_hand")
          .limit(100000)
      : emptyResult(),
    access.warehouse
      ? client
          .schema("warehouse")
          .from("products")
          .select("id,unit_cost")
          .limit(10000)
      : emptyResult(),
    access.procurement || access.warehouse
      ? client
          .schema("core")
          .from("finance_close_entries")
          .select(
            "id,period_start,period_end,entry_type,source_module,source_reference,cost_center,amount,status,evidence_url,reconciliation_note,prepared_by,prepared_at,posted_by,posted_at,updated_at",
          )
          .order("period_end", { ascending: false })
          .limit(1000)
      : emptyResult(),
  ]);

  const warnings: string[] = [];
  if (activityResult.error)
    warnings.push(`Financial activity: ${activityResult.error.message}`);
  if (purchaseOrderResult.error)
    warnings.push(`Purchase orders: ${purchaseOrderResult.error.message}`);
  if (paymentResult.error)
    warnings.push(`Payment readiness: ${paymentResult.error.message}`);
  if (closeEntryResult.error)
    warnings.push("Finance close: " + closeEntryResult.error.message);
  if (inventoryResult.error || productResult.error)
    warnings.push(
      `Inventory valuation: ${inventoryResult.error?.message ?? productResult.error?.message ?? "source unavailable"}`,
    );

  const purchaseOrders = new Map(
    rows(purchaseOrderResult.data).map((row) => [text(row.id), row]),
  );
  const unitCostByProduct = new Map(
    rows(productResult.data).map((row) => [
      text(row.id),
      amount(row.unit_cost),
    ]),
  );
  const inventoryValue = rows(inventoryResult.data).reduce(
    (sum, row) =>
      sum +
      amount(row.on_hand) * (unitCostByProduct.get(text(row.product_id)) ?? 0),
    0,
  );

  return scopeFinanceData(
    {
      activity: rows(activityResult.data)
        .map(mapActivity)
        .filter((item): item is FinanceActivity => item !== null),
      payments: rows(paymentResult.data)
        .map((row) => mapPayment(row, purchaseOrders))
        .filter((item): item is FinancePaymentItem => item !== null),
      closeEntries: rows(closeEntryResult.data)
        .map(mapCloseEntry)
        .filter((item): item is FinanceCloseEntry => item !== null),
      inventoryValue,
      warnings,
    },
    access,
  );
}

export function useFinanceData(): {
  data: FinanceData;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  manageCloseEntry: (
    input: ManageFinanceCloseEntryInput,
  ) => Promise<FinanceCloseEntry>;
  isDemo: boolean;
} {
  const { mode, supabaseClient, userRoles, profile } = useSession();
  const live = mode === "supabase" ? supabaseClient : null;
  const procurementAccess = can(userRoles, "procurement", "view_finance");
  const warehouseAccess = can(userRoles, "warehouse", "view_finance");
  const [data, setData] = useState<FinanceData>(
    live
      ? {
          activity: [],
          payments: [],
          closeEntries: [],
          inventoryValue: 0,
          warnings: [],
        }
      : scopeFinanceData(FINANCE_DEMO_DATA, {
          procurement: procurementAccess,
          warehouse: warehouseAccess,
        }),
  );
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!live) {
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await loadLiveFinanceData(live, {
        procurement: procurementAccess,
        warehouse: warehouseAccess,
      });
      setData(next);
      setError(next.warnings.length > 0 ? next.warnings.join(" ") : null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Finance data could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [live, procurementAccess, warehouseAccess]);

  const manageCloseEntry = useCallback(
    async (input: ManageFinanceCloseEntryInput) => {
      if (!live) {
        let result: FinanceCloseEntry | undefined;
        setData((current) => {
          const next = applyMemoryFinanceCloseEntry(current, input, profile?.email ?? "finance@mwell.demo");
          result = next.closeEntries.find((entry) => entry.id === input.id) ?? next.closeEntries[0];
          return next;
        });
        if (!result) throw new Error("Finance close entry could not be recorded.");
        return result;
      }
      const result = await manageLiveFinanceCloseEntry(live, input);
      await refresh();
      return result;
    },
    [live, refresh, profile?.email],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh, manageCloseEntry, isDemo: !live };
}
