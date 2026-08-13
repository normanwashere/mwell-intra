"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@intra/auth";
import { can } from "@intra/rbac";
import type {
  PriceProposal,
  PriceProposalDraft,
  ReadinessEvidence,
  ReadinessPackage,
} from "./types";
import {
  canAcknowledgeOperationsHandoff,
  canDecidePriceProposal,
  validatePriceProposal,
  validateReadinessSubmission,
} from "./domain";

type ProductClient = NonNullable<ReturnType<typeof useSession>["supabaseClient"]>;
type UnknownRow = Record<string, unknown>;

export interface ReadinessDraft {
  productId: string;
  title: string;
  conditions: string;
  evidence: ReadinessEvidence[];
}

export interface ProductWorkspaceData {
  readiness: ReadinessPackage[];
  pricing: PriceProposal[];
  warnings: string[];
}

export interface ProductSourceAccess {
  readiness: boolean;
  pricing: boolean;
}

export interface ProductRefreshOptions {
  background?: boolean;
}

const EMPTY_DATA: ProductWorkspaceData = {
  readiness: [],
  pricing: [],
  warnings: [],
};

const MEMORY_DEMO_DATA: ProductWorkspaceData = {
  readiness: [
    {
      id: "readiness-demo-care-kit",
      productId: "kit-demo-001",
      title: "Care kit go-live",
      version: 1,
      status: "submitted",
      evidence: [{ id: "evidence-demo-kit", label: "Kit approval", reference: "KIT-APR-001", required: true, verified: true }],
      kitApproved: true,
      conditions: "Demo-only record. Operations acknowledgement remains required.",
      preparedBy: "product-contributor",
      submittedBy: "product-contributor",
      submittedAt: "2026-08-14T00:00:00.000Z",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      operationsAcknowledgedBy: null,
      operationsAcknowledgedAt: null,
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    },
  ],
  pricing: [],
  warnings: [],
};

function applyMemoryProductAction(
  data: ProductWorkspaceData,
  fn: string,
  payload: Record<string, unknown>,
  actor: string,
): ProductWorkspaceData {
  const now = new Date().toISOString();
  if (fn === "submit_readiness_package") {
    const draft = payload.readiness as ReadinessDraft;
    const validation = validateReadinessSubmission(draft);
    if (validation.length) throw new Error(validation[0]);
    const kitApproved = draft.evidence.some((item) => /kit approval/i.test(item.label) && item.verified);
    return {
      ...data,
      readiness: [{
        id: `readiness-demo-${Date.now()}`,
        productId: draft.productId,
        title: draft.title,
        version: 1,
        status: "submitted",
        evidence: draft.evidence,
        kitApproved,
        conditions: draft.conditions,
        preparedBy: actor,
        submittedBy: actor,
        submittedAt: now,
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        operationsAcknowledgedBy: null,
        operationsAcknowledgedAt: null,
        createdAt: now,
        updatedAt: now,
      }, ...data.readiness],
    };
  }
  if (fn === "decide_readiness_package") {
    const id = String(payload.id);
    const decision = payload.decision as "approved" | "rejected";
    const note = String(payload.note ?? "").trim();
    const item = data.readiness.find((entry) => entry.id === id);
    if (!item || item.status !== "submitted") throw new Error("Readiness package changed. Refresh before deciding.");
    if (item.preparedBy === actor) throw new Error("The preparer cannot make the go-live decision.");
    if (note.length < 8) throw new Error("Decision note must contain at least 8 characters.");
    return { ...data, readiness: data.readiness.map((entry) => entry.id === id ? { ...entry, status: decision, decidedBy: actor, decidedAt: now, decisionNote: note, updatedAt: now } : entry) };
  }
  if (fn === "acknowledge_operations_handoff") {
    const id = String(payload.id);
    const item = data.readiness.find((entry) => entry.id === id);
    if (!item || !canAcknowledgeOperationsHandoff(item)) throw new Error("The approved kit and verified evidence are required before Operations acknowledgement.");
    return { ...data, readiness: data.readiness.map((entry) => entry.id === id ? { ...entry, operationsAcknowledgedBy: actor, operationsAcknowledgedAt: now, updatedAt: now } : entry) };
  }
  if (fn === "submit_price_proposal") {
    const draft = payload.proposal as PriceProposalDraft;
    const validation = validatePriceProposal(draft);
    if (validation.length) throw new Error(validation[0]);
    return { ...data, pricing: [{ id: `price-demo-${Date.now()}`, productId: draft.productId, productName: draft.productId, version: 1, status: "submitted", currentPrice: 0, proposedPrice: draft.proposedPrice, costBasis: draft.costBasis, reason: draft.reason, effectiveAt: draft.effectiveAt, proposedBy: actor, submittedAt: now, decidedBy: null, decidedAt: null, decisionNote: null, createdAt: now }, ...data.pricing] };
  }
  if (fn === "decide_price_proposal") {
    const id = String(payload.id);
    const item = data.pricing.find((entry) => entry.id === id);
    const note = String(payload.note ?? "").trim();
    if (!item || !canDecidePriceProposal(item, actor) || note.length < 8) throw new Error("Price proposal is not ready for this decision.");
    return { ...data, pricing: data.pricing.map((entry) => entry.id === id ? { ...entry, status: payload.decision as PriceProposal["status"], decidedBy: actor, decidedAt: now, decisionNote: note } : entry) };
  }
  throw new Error("This Product action is not available in demo memory.");
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionalText(value: unknown): string | null {
  const valueText = text(value);
  return valueText || null;
}

function numberValue(value: unknown, fallback = 0): number {
  const result = typeof value === "number" ? value : Number(value ?? fallback);
  return Number.isFinite(result) ? result : fallback;
}

function evidence(value: unknown): ReadinessEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as UnknownRow;
    const label = text(row.label);
    const reference = text(row.reference);
    if (!label || !reference) return [];
    return [
      {
        id: text(row.id, `evidence-${index + 1}`),
        label,
        reference,
        required: row.required !== false,
        verified: row.verified === true,
      },
    ];
  });
}

function mapReadiness(row: UnknownRow): ReadinessPackage | null {
  const id = text(row.id);
  const productId = text(row.product_id);
  if (!id || !productId) return null;
  return {
    id,
    productId,
    title: text(row.title, productId),
    version: numberValue(row.version, 1),
    status: text(row.status, "draft") as ReadinessPackage["status"],
    evidence: evidence(row.evidence),
    conditions: text(row.conditions),
    preparedBy: text(row.prepared_by),
    submittedBy: optionalText(row.submitted_by),
    submittedAt: optionalText(row.submitted_at),
    decidedBy: optionalText(row.decided_by),
    decidedAt: optionalText(row.decided_at),
    decisionNote: optionalText(row.decision_note),
    operationsAcknowledgedBy: optionalText(row.operations_acknowledged_by),
    operationsAcknowledgedAt: optionalText(row.operations_acknowledged_at),
    createdAt: text(row.created_at, new Date(0).toISOString()),
    updatedAt: text(row.updated_at, new Date(0).toISOString()),
  };
}

function mapPrice(row: UnknownRow): PriceProposal | null {
  const id = text(row.id);
  const productId = text(row.product_id);
  if (!id || !productId) return null;
  return {
    id,
    productId,
    productName: text(row.product_name, productId),
    version: numberValue(row.version, 1),
    status: text(row.status, "draft") as PriceProposal["status"],
    currentPrice: numberValue(row.current_price),
    proposedPrice: numberValue(row.proposed_price),
    costBasis: numberValue(row.cost_basis),
    reason: text(row.reason),
    effectiveAt: text(row.effective_at, new Date(0).toISOString()),
    proposedBy: text(row.proposed_by),
    submittedAt: optionalText(row.submitted_at),
    decidedBy: optionalText(row.decided_by),
    decidedAt: optionalText(row.decided_at),
    decisionNote: optionalText(row.decision_note),
    createdAt: text(row.created_at, new Date(0).toISOString()),
  };
}

export async function loadLiveProductWorkspace(
  client: ProductClient,
  access: ProductSourceAccess = { readiness: true, pricing: true },
): Promise<ProductWorkspaceData> {
  const emptyResult = () =>
    Promise.resolve({
      data: [] as UnknownRow[],
      error: null as { message: string } | null,
    });
  const [readinessResult, pricingResult] = await Promise.all([
    access.readiness
      ? client
          .schema("product")
          .from("readiness_packages")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(250)
      : emptyResult(),
    access.pricing
      ? client
          .schema("product")
          .from("price_proposals")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(250)
      : emptyResult(),
  ]);
  const warnings = [readinessResult.error, pricingResult.error]
    .filter((error): error is { message: string } => Boolean(error))
    .map((error) => error.message);
  return {
    readiness: (readinessResult.data ?? [])
      .map((row) => mapReadiness(row as UnknownRow))
      .filter((row): row is ReadinessPackage => Boolean(row)),
    pricing: (pricingResult.data ?? [])
      .map((row) => mapPrice(row as UnknownRow))
      .filter((row): row is PriceProposal => Boolean(row)),
    warnings,
  };
}

async function callProductRpc(
  client: ProductClient,
  fn: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.schema("product").rpc(fn, { payload });
  if (error) throw new Error(error.message);
}

export function useProductWorkspace() {
  const { supabaseClient, userRoles, profile } = useSession();
  const sourceAccess = {
    readiness: can(userRoles, "product", "view_readiness"),
    pricing: can(userRoles, "product", "view_pricing"),
  };
  const [data, setData] = useState<ProductWorkspaceData>(supabaseClient ? EMPTY_DATA : MEMORY_DEMO_DATA);
  const [loading, setLoading] = useState(Boolean(supabaseClient));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (options: ProductRefreshOptions = {}) => {
    const background = options.background === true;
    if (!supabaseClient) {
      setLoading(false);
      setRefreshing(false);
      return true;
    }
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const next = await loadLiveProductWorkspace(supabaseClient, sourceAccess);
      setData(next);
      setError(next.warnings.length ? next.warnings.join(" ") : null);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Product workspace could not be loaded.",
      );
      return false;
    } finally {
      if (background) setRefreshing(false);
      else setLoading(false);
    }
  }, [sourceAccess.pricing, sourceAccess.readiness, supabaseClient]);

  const run = useCallback(
    async (fn: string, payload: Record<string, unknown>) => {
      if (!supabaseClient) {
        setData((current) => applyMemoryProductAction(current, fn, payload, profile?.id ?? "product-demo-user"));
        return;
      }
      await callProductRpc(supabaseClient, fn, payload);
      const readbackSucceeded = await refresh({ background: true });
      if (!readbackSucceeded) {
        throw new Error(
          "The Product action was saved, but the latest state could not be loaded.",
        );
      }
    },
    [profile?.id, refresh, supabaseClient],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data,
    loading,
    refreshing,
    error,
    refresh,
    createReadiness: (draft: ReadinessDraft) =>
      run("submit_readiness_package", { readiness: draft }),
    decideReadiness: (
      id: string,
      decision: "approved" | "rejected",
      note: string,
    ) => run("decide_readiness_package", { id, decision, note }),
    acknowledgeHandoff: (id: string) =>
      run("acknowledge_operations_handoff", { id }),
    proposePrice: (draft: PriceProposalDraft) =>
      run("submit_price_proposal", { proposal: draft }),
    decidePrice: (
      id: string,
      decision: "approved" | "rejected",
      note: string,
    ) => run("decide_price_proposal", { id, decision, note }),
    isDemo: !supabaseClient,
  };
}
