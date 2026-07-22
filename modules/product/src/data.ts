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

const EMPTY_DATA: ProductWorkspaceData = {
  readiness: [],
  pricing: [],
  warnings: [],
};

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
  const { supabaseClient, userRoles } = useSession();
  const sourceAccess = {
    readiness: can(userRoles, "product", "view_readiness"),
    pricing: can(userRoles, "product", "view_pricing"),
  };
  const [data, setData] = useState<ProductWorkspaceData>(EMPTY_DATA);
  const [loading, setLoading] = useState(Boolean(supabaseClient));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabaseClient) {
      setData(EMPTY_DATA);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await loadLiveProductWorkspace(supabaseClient, sourceAccess);
      setData(next);
      setError(next.warnings.length ? next.warnings.join(" ") : null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Product workspace could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [sourceAccess.pricing, sourceAccess.readiness, supabaseClient]);

  const run = useCallback(
    async (fn: string, payload: Record<string, unknown>) => {
      if (!supabaseClient)
        throw new Error("Live Product actions require Supabase.");
      await callProductRpc(supabaseClient, fn, payload);
      await refresh();
    },
    [refresh, supabaseClient],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data,
    loading,
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
  };
}
