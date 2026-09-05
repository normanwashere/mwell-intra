"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@intra/auth";
import { EVENTS_DEMO_DATA } from "./seed";
import type {
  EventDraft,
  EventFulfillmentRequest,
  EventLifecycle,
  EventManagementInput,
  EventRecord,
  EventReconciliation,
  SaveEventReconciliationInput,
  EventsData,
} from "./types";

type EventsClient = NonNullable<
  ReturnType<typeof useSession>["supabaseClient"]
>;
type UnknownRow = Record<string, unknown>;

const MEMORY_EVENTS_KEY = "intra.events-data.v1";

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function lifecycleForDates(
  startDate: string,
  endDate: string | undefined,
  today = new Date().toISOString().slice(0, 10),
): EventLifecycle {
  if (startDate > today) return "planned";
  if ((endDate ?? startDate) < today) return "completed";
  return "active";
}

export function validateEventDraft(draft: EventDraft): string | null {
  const fields = validateEventDraftFields(draft);
  return fields.name ?? fields.startDate ?? fields.endDate ?? null;
}

export function validateEventDraftFields(
  draft: EventDraft,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "Event name is required.";
  if (!draft.startDate) errors.startDate = "Start date is required.";
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.endDate = "End date cannot be before the start date.";
  }
  return errors;
}

export function validateEventManagementFields(
  action: EventManagementInput["action"],
  draft: Partial<EventDraft>,
  reason: string,
  ownerEmail: string,
  minimumDate?: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (action === "edit" && !draft.name?.trim()) {
    errors.name = "Event name is required.";
  }
  if (action === "reschedule") {
    if (!draft.startDate) {
      errors.startDate = "Start date is required.";
    } else if (minimumDate && draft.startDate < minimumDate) {
      errors.startDate = "Start date cannot be in the past.";
    }
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
      errors.endDate = "End date cannot be before the start date.";
    }
  }
  if (action === "transfer_owner") {
    if (!ownerEmail.trim()) {
      errors.ownerEmail = "New owner email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) {
      errors.ownerEmail = "Enter a valid email address.";
    }
  }
  if (!reason.trim())
    errors.reason = "A reason is required for the event history.";
  return errors;
}

export function validateEventFulfillmentFields(
  input: EventFulfillmentRequest,
  options: {
    minimumDate?: string;
    maximumDate?: string;
    itemClass?: string;
  } = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.requestingDepartment.trim())
    errors.department = "Department is required.";
  if (!input.purpose.trim()) errors.purpose = "Business purpose is required.";
  if (!input.costCenter.trim()) errors.costCenter = "Cost center is required.";
  if (!input.requiredDate) {
    errors.requiredDate = "Required date is required.";
  } else if (options.minimumDate && input.requiredDate < options.minimumDate) {
    errors.requiredDate = "Required date cannot be in the past.";
  } else if (options.maximumDate && input.requiredDate > options.maximumDate) {
    errors.requiredDate = "Required date cannot be after the event end date.";
  }
  if (!input.productId) errors.productId = "Select a product.";
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    errors.quantity = "Enter a positive whole-number quantity.";
  }
  if (
    options.itemClass === "merchandise" &&
    input.expenseTreatment !== "expense"
  ) {
    errors.treatment = "Merchandise must be treated as an expense.";
  }
  return errors;
}

type EventReconciliationTransitionInput = Pick<
  SaveEventReconciliationInput,
  | "action"
  | "soldUnits"
  | "giveawayUnits"
  | "returnedUnits"
  | "lostUnits"
  | "damagedUnits"
  | "rekitUnits"
  | "grossSalesAmount"
  | "financeReference"
  | "evidenceUrl"
>;

export function isSupportedEventEvidenceReference(value?: string): boolean {
  const reference = value?.trim();
  if (!reference) return false;
  if (/^evidence:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(reference)) return true;
  if (/^memory:\/\/event-settlement\/[A-Za-z0-9._/-]+$/.test(reference)) {
    return true;
  }
  try {
    const url = new URL(reference);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password
      && !/\/storage\/v1\/object\/(sign|public)\//i.test(decodeURIComponent(url.pathname))
      && ![...url.searchParams.keys()].some((key) => /^(token|signature|sig|expires|x-amz-.+|x-goog-.+)$/i.test(key));
  } catch {
    return false;
  }
}

export function validateEventReconciliationTransition(
  input: EventReconciliationTransitionInput,
  issuedUnits: number,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const outcomes = [input.soldUnits, input.giveawayUnits, input.returnedUnits, input.lostUnits, input.damagedUnits, input.rekitUnits];
  if (outcomes.some(quantity => !Number.isSafeInteger(quantity) || quantity < 0)) {
    errors.outcomes = "Event outcomes must be nonnegative whole numbers.";
  }
  if (input.action === "save") return errors;

  const accountedUnits =
    input.soldUnits +
    input.giveawayUnits +
    input.returnedUnits +
    input.lostUnits +
    input.damagedUnits +
    input.rekitUnits;
  if (accountedUnits !== issuedUnits) {
    errors.outcomes = `Event outcomes must account for all ${issuedUnits} issued units.`;
  }
  if (!input.evidenceUrl?.trim()) {
    errors.evidenceUrl =
      "Attach event settlement evidence before submitting to Finance.";
  } else if (!isSupportedEventEvidenceReference(input.evidenceUrl)) {
    errors.evidenceUrl =
      "Use a valid HTTPS evidence URL or governed evidence reference.";
  }
  if (input.action === "approve" && !input.financeReference?.trim()) {
    errors.financeReference =
      "Enter the Finance settlement reference before approval.";
  }
  return errors;
}

export function eventReconciliationHandoff(
  reconciliation: EventReconciliation,
  issuedUnits: number,
  access: { mayManage: boolean; mayApprove: boolean },
): {
  stage: string;
  owner: string;
  blockers: string[];
  nextAction: string;
  availableAction?: "save" | "submit" | "approve";
} {
  if (reconciliation.status === "approved") {
    return {
      stage: "Finance close",
      owner: "Finance close manager",
      blockers: [],
      nextAction:
        "Post the generated close entry, then have a different Finance actor reconcile it.",
    };
  }

  const action = reconciliation.status === "submitted" ? "approve" : "submit";
  const validation = validateEventReconciliationTransition(
    { ...reconciliation, action },
    issuedUnits,
  );
  const blockers = [
    validation.outcomes,
    validation.evidenceUrl
      ? "Event settlement evidence is missing."
      : undefined,
    validation.financeReference
      ? "Finance settlement reference is missing."
      : undefined,
  ].filter((blocker): blocker is string => Boolean(blocker));

  if (reconciliation.status === "submitted") {
    return {
      stage: "Finance review",
      owner: "Finance settlement reviewer",
      blockers,
      nextAction: access.mayApprove
        ? "Verify the evidence, add the Finance reference, and approve settlement."
        : "Finance must verify the evidence, add its reference, and approve settlement.",
      availableAction: access.mayApprove ? "approve" : undefined,
    };
  }

  return {
    stage: "Draft reconciliation",
    owner: "Event operations",
    blockers,
    nextAction: access.mayManage
      ? blockers.length
        ? "Resolve the blockers, then submit to Finance."
        : "Submit the reconciliation to Finance."
      : "Event operations must complete and submit the reconciliation.",
    availableAction: access.mayManage ? "submit" : undefined,
  };
}

function lifecycleForRow(row: UnknownRow): EventLifecycle {
  const status = text(row.status);
  if (status === "cancelled" || status === "closed") return status;
  return lifecycleForDates(
    text(row.start_date),
    text(row.end_date) || undefined,
  );
}

function mapEventRow(
  row: UnknownRow,
  totals = { reserved: 0, issued: 0, returned: 0 },
): EventRecord {
  return {
    id: text(row.id),
    name: text(row.name, "Untitled event"),
    type: text(row.type, "corporate"),
    startDate: text(row.start_date),
    endDate: text(row.end_date) || undefined,
    siteLocationId: text(row.site_location_id) || undefined,
    ownerEmail: text(row.owner_email) || undefined,
    updatedAt: text(row.updated_at) || undefined,
    lifecycle: lifecycleForRow(row),
    reservedUnits: totals.reserved,
    issuedUnits: totals.issued,
    returnedUnits: totals.returned,
  };
}

export async function manageLiveEvent(
  client: EventsClient,
  input: EventManagementInput,
): Promise<EventRecord> {
  const validation = validateEventManagementFields(
    input.action,
    input.changes ?? { name: "", type: "corporate", startDate: "" },
    input.reason,
    input.changes?.ownerEmail ?? "",
  );
  const firstError = Object.values(validation)[0];
  if (firstError) throw new Error(firstError);
  const changes = input.changes ?? {};
  const { data, error } = await client.schema("warehouse").rpc("manage_event", {
    payload: {
      event_id: input.eventId,
      action: input.action,
      reason: input.reason.trim(),
      expected_updated_at: input.expectedUpdatedAt,
      changes: {
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.type !== undefined ? { type: changes.type } : {}),
        ...(changes.startDate !== undefined
          ? { start_date: changes.startDate }
          : {}),
        ...(changes.endDate !== undefined
          ? { end_date: changes.endDate || null }
          : {}),
        ...(changes.siteLocationId !== undefined
          ? { site_location_id: changes.siteLocationId || null }
          : {}),
        ...(changes.ownerEmail !== undefined
          ? { owner_email: changes.ownerEmail.trim() }
          : {}),
      },
    },
  });
  if (error) throw error;
  return mapEventRow((data ?? {}) as UnknownRow);
}

export async function requestEventFulfillment(
  client: EventsClient,
  input: EventFulfillmentRequest,
): Promise<{ id: string; eventId: string }> {
  if (!input.eventId) throw new Error("Event is required.");
  const validation = validateEventFulfillmentFields(input);
  const firstError = Object.values(validation)[0];
  if (firstError) throw new Error(firstError);
  const { data, error } = await client
    .schema("warehouse")
    .rpc("request_event_fulfillment", {
      payload: {
        event_id: input.eventId,
        requesting_department: input.requestingDepartment.trim(),
        purpose: input.purpose.trim(),
        cost_center: input.costCenter.trim(),
        required_date: input.requiredDate,
        expense_treatment: input.expenseTreatment,
        lines: [{ productId: input.productId, quantity: input.quantity }],
        idempotency_key: input.idempotencyKey,
      },
    });
  if (error) throw error;
  const row = (data ?? {}) as UnknownRow;
  return { id: text(row.id), eventId: text(row.event_id) };
}

function mapReconciliationRow(row: UnknownRow): EventReconciliation {
  return {
    eventId: text(row.event_id),
    status: text(row.status, "draft") as EventReconciliation["status"],
    soldUnits: count(row.sold_units),
    giveawayUnits: count(row.giveaway_units),
    returnedUnits: count(row.returned_units),
    lostUnits: count(row.lost_units),
    damagedUnits: count(row.damaged_units),
    rekitUnits: count(row.rekit_units),
    grossSalesAmount: count(row.gross_sales_amount),
    financeReference: text(row.finance_reference) || undefined,
    evidenceUrl: text(row.evidence_url) || undefined,
    note: text(row.note) || undefined,
    preparedBy: text(row.prepared_by) || undefined,
    approvedAt: text(row.approved_at) || undefined,
    updatedAt: text(row.updated_at),
  };
}

export async function saveLiveEventReconciliation(
  client: EventsClient,
  input: SaveEventReconciliationInput,
): Promise<EventReconciliation> {
  const { data, error } = await client
    .schema("warehouse")
    .rpc("save_event_reconciliation", {
      payload: {
        event_id: input.eventId,
        action: input.action,
        sold_units: input.soldUnits,
        giveaway_units: input.giveawayUnits,
        returned_units: input.returnedUnits,
        lost_units: input.lostUnits,
        damaged_units: input.damagedUnits,
        rekit_units: input.rekitUnits,
        gross_sales_amount: input.grossSalesAmount,
        finance_reference: input.financeReference?.trim() || null,
        evidence_url: input.evidenceUrl?.trim() || null,
        note: input.note?.trim() || null,
        expected_updated_at: input.expectedUpdatedAt ?? null,
      },
    });
  if (error) throw error;
  return mapReconciliationRow((data ?? {}) as UnknownRow);
}

export async function openLiveEventReconciliationEvidence(
  client: EventsClient,
  eventId: string,
): Promise<string> {
  const { data, error } = await client
    .schema("warehouse")
    .rpc("open_event_reconciliation_evidence", {
      payload: { event_id: eventId },
    });
  if (error) throw error;
  const evidenceUrl = text((data as UnknownRow | null)?.evidence_url);
  if (evidenceUrl.startsWith('evidence://')) {
    const response = await fetch('/api/evidence', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'open', reference: evidenceUrl }) });
    const result = await response.json();
    if (!response.ok || typeof result.url !== 'string') throw new Error(result.error || 'Evidence access denied.');
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid evidence preview.');
    return result.url;
  }
  if (!isSupportedEventEvidenceReference(evidenceUrl)) {
    throw new Error("Event reconciliation evidence could not be retrieved.");
  }
  return evidenceUrl;
}
export async function loadLiveEvents(
  client: EventsClient,
): Promise<EventsData> {
  const [
    eventResult,
    allocationResult,
    productResult,
    reconciliationResult,
    departmentResult,
    costCenterResult,
  ] =
    await Promise.all([
      client
        .schema("warehouse")
        .from("events")
        .select(
          "id,name,type,site_location_id,start_date,end_date,status,owner_email,updated_at",
        )
        .order("start_date", { ascending: false })
        .limit(1000),
      client
        .schema("warehouse")
        .from("event_custody_totals")
        .select("event_id,reserved_units,issued_units,returned_units,outstanding_units")
        .limit(10000),
      client
        .schema("warehouse")
        .from("products")
        .select("id,name,item_class")
        .in("item_class", ["sellable_sku", "merchandise"])
        .order("name", { ascending: true })
        .limit(1000),
      client
        .schema("warehouse")
        .from("event_reconciliations")
        .select(
          "event_id,status,sold_units,giveaway_units,returned_units,lost_units,damaged_units,rekit_units,gross_sales_amount,finance_reference,evidence_url,note,prepared_by,approved_at,updated_at",
        )
        .limit(1000),
      client
        .schema("core")
        .from("departments")
        .select("id,code,name,is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
        .limit(1000),
      client
        .schema("core")
        .from("department_cost_centers")
        .select("department_id,code,name,is_active")
        .eq("is_active", true)
        .order("code", { ascending: true })
        .limit(1000),
    ]);
  const warnings: string[] = [];
  if (allocationResult.error) throw new Error(`Event custody unavailable: ${allocationResult.error.message}`);
  if (eventResult.error) warnings.push(`Events: ${eventResult.error.message}`);
  if (productResult.error)
    warnings.push("Products: " + productResult.error.message);
  if (reconciliationResult.error)
    warnings.push(
      "Event reconciliation: " + reconciliationResult.error.message,
    );
  if (departmentResult.error)
    warnings.push("Departments: " + departmentResult.error.message);
  if (costCenterResult.error)
    warnings.push("Cost centers: " + costCenterResult.error.message);
  const allocations = Array.isArray(allocationResult.data)
    ? (allocationResult.data as UnknownRow[])
    : [];
  const totals = new Map<
    string,
    { reserved: number; issued: number; returned: number }
  >();
  for (const row of allocations) {
    const eventId = text(row.event_id);
    totals.set(eventId, {
      reserved: count(row.reserved_units),
      issued: count(row.issued_units),
      returned: count(row.returned_units),
    });
  }
  const rows = Array.isArray(eventResult.data)
    ? (eventResult.data as UnknownRow[])
    : [];
  const costCenters = Array.isArray(costCenterResult.data)
    ? (costCenterResult.data as UnknownRow[])
    : [];
  return {
    events: rows.map((row): EventRecord => {
      const id = text(row.id);
      const total = totals.get(id) ?? { reserved: 0, issued: 0, returned: 0 };
      return mapEventRow(row, total);
    }),
    products: (Array.isArray(productResult.data)
      ? (productResult.data as UnknownRow[])
      : []
    ).map((row) => ({
      id: text(row.id),
      name: text(row.name, "Unnamed product"),
      itemClass: text(row.item_class),
    })),
    departments: (Array.isArray(departmentResult.data)
      ? (departmentResult.data as UnknownRow[])
      : []
    ).map((row) => ({
      id: text(row.id),
      code: text(row.code),
      name: text(row.name, text(row.code)),
      costCenters: costCenters
        .filter((costCenter) => text(costCenter.department_id) === text(row.id))
        .map((costCenter) => ({
          code: text(costCenter.code),
          name: text(costCenter.name, text(costCenter.code)),
        })),
    })),
    reconciliations: (Array.isArray(reconciliationResult.data)
      ? (reconciliationResult.data as UnknownRow[])
      : []
    ).map(mapReconciliationRow),
    warnings,
  };
}

export async function createLiveEvent(
  client: EventsClient,
  draft: EventDraft,
): Promise<void> {
  const validation = validateEventDraft(draft);
  if (validation) throw new Error(validation);
  const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await client.schema("warehouse").rpc("create_event", {
    payload: {
      event: {
        id,
        name: draft.name.trim(),
        type: draft.type,
        start_date: draft.startDate,
        end_date: draft.endDate || null,
        site_location_id: draft.siteLocationId || null,
      },
    },
  });
  if (error) throw error;
}

export function loadMemoryEvents(
  storage: Pick<Storage, "getItem">,
): EventsData {
  const stored = storage.getItem(MEMORY_EVENTS_KEY);
  if (!stored) return EVENTS_DEMO_DATA;
  try {
    const parsed = JSON.parse(stored) as Partial<EventsData>;
    return Array.isArray(parsed.events)
      ? {
          events: parsed.events as EventRecord[],
          products: EVENTS_DEMO_DATA.products,
          departments: EVENTS_DEMO_DATA.departments,
          reconciliations: Array.isArray(parsed.reconciliations)
            ? parsed.reconciliations as EventReconciliation[]
            : [],
          fulfillmentHandoffs: Array.isArray(parsed.fulfillmentHandoffs)
            ? parsed.fulfillmentHandoffs as NonNullable<EventsData["fulfillmentHandoffs"]>
            : [],
          warnings: [],
        }
      : EVENTS_DEMO_DATA;
  } catch {
    return EVENTS_DEMO_DATA;
  }
}

export function saveMemoryEvents(
  storage: Pick<Storage, "setItem">,
  data: EventsData,
): void {
  storage.setItem(MEMORY_EVENTS_KEY, JSON.stringify({
    events: data.events,
    reconciliations: data.reconciliations ?? [],
    fulfillmentHandoffs: data.fulfillmentHandoffs ?? [],
  }));
}

export function applyMemoryEventReconciliation(
  data: EventsData,
  input: SaveEventReconciliationInput,
): EventsData {
  const event = data.events.find((item) => item.id === input.eventId);
  if (!event) throw new Error("Event was not found. Refresh before retrying.");
  const errors = validateEventReconciliationTransition(input, event.issuedUnits);
  const firstError = Object.values(errors)[0];
  if (firstError) throw new Error(firstError);
  const current = data.reconciliations?.find(
    (item) => item.eventId === input.eventId,
  );
  if (input.action === "approve" && current?.status !== "submitted") {
    throw new Error("Submit the event reconciliation before Finance approval.");
  }
  const now = new Date().toISOString();
  const status = input.action === "save" ? "draft" : input.action === "submit" ? "submitted" : "approved";
  const next: EventReconciliation = {
    eventId: input.eventId,
    status,
    soldUnits: input.soldUnits,
    giveawayUnits: input.giveawayUnits,
    returnedUnits: input.returnedUnits,
    lostUnits: input.lostUnits,
    damagedUnits: input.damagedUnits,
    rekitUnits: input.rekitUnits,
    grossSalesAmount: input.grossSalesAmount,
    financeReference:
      input.action === "approve"
        ? input.financeReference?.trim() || undefined
        : undefined,
    evidenceUrl: input.evidenceUrl?.trim() || undefined,
    note: input.note?.trim() || undefined,
    preparedBy: current?.preparedBy ?? "events@mwell.demo",
    approvedAt: input.action === "approve" ? now : undefined,
    updatedAt: now,
  };
  const reconciliations = (data.reconciliations ?? []).filter((item) => item.eventId !== input.eventId);
  return { ...data, reconciliations: [next, ...reconciliations] };
}

export function useEventsData() {
  const { mode, supabaseClient } = useSession();
  const live = mode === "supabase" ? supabaseClient : null;
  const [data, setData] = useState<EventsData>(
    live ? { events: [], warnings: [] } : EVENTS_DEMO_DATA,
  );
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!live) {
      setData(loadMemoryEvents(window.sessionStorage));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await loadLiveEvents(live);
      setData(next);
      setError(next.warnings.length ? next.warnings.join(" ") : null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Events could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [live]);

  const createEvent = useCallback(
    async (draft: EventDraft) => {
      if (live) {
        await createLiveEvent(live, draft);
        await refresh();
        return;
      }
      const next: EventRecord = {
        id: `evt-demo-${Date.now()}`,
        ...draft,
        name: draft.name.trim(),
        lifecycle: lifecycleForDates(draft.startDate, draft.endDate),
        reservedUnits: 0,
        issuedUnits: 0,
        returnedUnits: 0,
      };
      setData((current) => {
        const updated = { ...current, events: [next, ...current.events] };
        saveMemoryEvents(window.sessionStorage, updated);
        return updated;
      });
    },
    [live, refresh],
  );

  const manageEvent = useCallback(
    async (input: EventManagementInput) => {
      if (!live) {
        let updated: EventRecord | undefined;
        setData((current) => {
          const event = current.events.find((item) => item.id === input.eventId);
          if (!event) throw new Error("Event was not found. Refresh before retrying.");
          const lifecycle = input.action === "cancel" ? "cancelled" : input.action === "close" ? "closed" : input.action === "reopen" ? "planned" : event.lifecycle;
          updated = {
            ...event,
            ...input.changes,
            lifecycle,
            ownerEmail: input.changes?.ownerEmail ?? event.ownerEmail,
            updatedAt: new Date().toISOString(),
          };
          const next = { ...current, events: current.events.map((item) => item.id === event.id ? updated! : item) };
          saveMemoryEvents(window.sessionStorage, next);
          return next;
        });
        return updated;
      }
      const updated = await manageLiveEvent(live, input);
      await refresh();
      return updated;
    },
    [live, refresh],
  );

  const requestFulfillment = useCallback(
    async (input: EventFulfillmentRequest) => {
      if (!live) {
        const id = `event-fulfillment-demo-${Date.now()}`;
        setData((current) => {
          const next = {
            ...current,
            fulfillmentHandoffs: [
              { id, eventId: input.eventId, status: "demo_recorded" as const, createdAt: new Date().toISOString() },
              ...(current.fulfillmentHandoffs ?? []),
            ],
          };
          saveMemoryEvents(window.sessionStorage, next);
          return next;
        });
        return { id, eventId: input.eventId };
      }
      return requestEventFulfillment(live, input);
    },
    [live],
  );

  const saveReconciliation = useCallback(
    async (input: SaveEventReconciliationInput) => {
      if (!live) {
        let result: EventReconciliation | undefined;
        setData((current) => {
          const next = applyMemoryEventReconciliation(current, input);
          result = next.reconciliations?.find((item) => item.eventId === input.eventId);
          saveMemoryEvents(window.sessionStorage, next);
          return next;
        });
        if (!result) throw new Error("Event reconciliation could not be saved.");
        return result;
      }
      const result = await saveLiveEventReconciliation(live, input);
      await refresh();
      return result;
    },
    [live, refresh],
  );
  const openReconciliationEvidence = useCallback(
    async (eventId: string) => {
      if (live) return openLiveEventReconciliationEvidence(live, eventId);
      const evidenceUrl = data.reconciliations?.find(
        (item) => item.eventId === eventId,
      )?.evidenceUrl;
      if (!isSupportedEventEvidenceReference(evidenceUrl)) {
        throw new Error("Event reconciliation evidence could not be retrieved.");
      }
      return evidenceUrl!.trim();
    },
    [data.reconciliations, live],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return {
    data,
    loading,
    error,
    refresh,
    createEvent,
    manageEvent,
    requestFulfillment,
    saveReconciliation,
    openReconciliationEvidence,
    isDemo: !live,
  };
}
