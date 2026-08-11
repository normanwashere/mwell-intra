import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@intra/auth";
import { Badge, Card, EmptyState, useToast } from "@/components/ui";

export interface ReplenishmentCandidate {
  productId: string;
  productName: string;
  recommendedQuantity: number;
  onHand: number;
  reorderPoint: number;
  leadTimeDays: number;
  stockoutRisk: "low" | "medium" | "high" | "critical";
  rationale: string;
}

interface SavedRecommendation extends ReplenishmentCandidate {
  id: string;
  status: "recommended" | "accepted" | "handed_off" | "dismissed" | "ordered";
  procurementRequestId?: string;
  purchaseOrderId?: string;
  expectedArrivalAt?: string;
}

const RISK_ORDER: Record<ReplenishmentCandidate['stockoutRisk'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortReplenishmentCandidates(
  candidates: readonly ReplenishmentCandidate[],
): ReplenishmentCandidate[] {
  return [...candidates].sort(
    (left, right) =>
      RISK_ORDER[left.stockoutRisk] - RISK_ORDER[right.stockoutRisk] ||
      Math.max(0, right.reorderPoint - right.onHand) -
        Math.max(0, left.reorderPoint - left.onHand) ||
      right.leadTimeDays - left.leadTimeDays ||
      left.productName.localeCompare(right.productName),
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function ReplenishmentControlPanel({
  candidates,
}: {
  candidates: ReplenishmentCandidate[];
}) {
  const { mode, supabaseClient } = useSession();
  const live = mode === "supabase" ? supabaseClient : null;
  const toast = useToast();
  const [rows, setRows] = useState<SavedRecommendation[]>([]);
  const [workingId, setWorkingId] = useState<string>();
  const visibleCandidates = useMemo(
    () =>
      sortReplenishmentCandidates(
        candidates.filter(
          (candidate) =>
            !rows.some(
              (row) =>
                row.productId === candidate.productId &&
                !["dismissed", "ordered"].includes(row.status),
            ),
        ),
      ),
    [candidates, rows],
  );

  const refresh = useCallback(async () => {
    if (!live) return;
    const { data, error } = await live
      .schema("procurement")
      .from("replenishment_recommendations")
      .select(
        "id,product_id,recommended_quantity,on_hand,reorder_point,lead_time_days,status,stockout_risk,rationale,procurement_request_id,purchase_order_id,expected_arrival_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows(
      (Array.isArray(data) ? data : []).map((row) => ({
        id: text(row.id),
        productId: text(row.product_id),
        productName:
          candidates.find((candidate) => candidate.productId === row.product_id)
            ?.productName ?? text(row.product_id),
        recommendedQuantity: Number(row.recommended_quantity),
        onHand: Number(row.on_hand),
        reorderPoint: Number(row.reorder_point),
        leadTimeDays: Number(row.lead_time_days ?? 0),
        status: text(row.status) as SavedRecommendation["status"],
        stockoutRisk: text(
          row.stockout_risk,
        ) as SavedRecommendation["stockoutRisk"],
        rationale: text(row.rationale),
        procurementRequestId: text(row.procurement_request_id) || undefined,
        purchaseOrderId: text(row.purchase_order_id) || undefined,
        expectedArrivalAt: text(row.expected_arrival_at) || undefined,
      })),
    );
  }, [candidates, live, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recommend = async (candidate: ReplenishmentCandidate) => {
    if (!live) return;
    setWorkingId(candidate.productId);
    const { error } = await live
      .schema("procurement")
      .rpc("manage_replenishment_recommendation", {
        payload: {
          action: "recommend",
          product_id: candidate.productId,
          recommended_quantity: candidate.recommendedQuantity,
          on_hand: candidate.onHand,
          reorder_point: candidate.reorderPoint,
          lead_time_days: candidate.leadTimeDays,
          stockout_risk: candidate.stockoutRisk,
          rationale: candidate.rationale,
        },
      });
    setWorkingId(undefined);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Replenishment recommendation saved.");
    await refresh();
  };

  const transition = async (
    record: SavedRecommendation,
    action: "accept" | "handoff" | "dismiss",
  ) => {
    if (!live) return;
    setWorkingId(record.id);
    const { error } = await live
      .schema("procurement")
      .rpc("manage_replenishment_recommendation", {
        payload: { id: record.id, action },
      });
    setWorkingId(undefined);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      action === "handoff"
        ? "Draft Procurement request created and linked."
        : "Replenishment status updated.",
    );
    await refresh();
  };

  if (!live) return null;

  return (
    <section
      className="space-y-3"
      aria-labelledby="replenishment-control-title"
    >
      <div>
        <p className="text-xs font-semibold uppercase text-faint">
          Procurement handoff
        </p>
        <h2
          id="replenishment-control-title"
          className="font-display text-lg font-bold text-ink"
        >
          Replenishment control
        </h2>
        <p className="text-sm text-muted">
          Save the recommendation, accept it, hand it to Procurement, then link
          the order outcome.
        </p>
        {(visibleCandidates.length > 0 || rows.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="rose">
              {visibleCandidates.filter((candidate) => candidate.stockoutRisk === 'critical').length} critical
            </Badge>
            <Badge tone="slate">{visibleCandidates.length} new</Badge>
            <Badge tone="brand">{rows.filter((row) => !['ordered', 'dismissed'].includes(row.status)).length} in progress</Badge>
          </div>
        )}
      </div>
      {rows.length === 0 && candidates.length === 0 ? (
        <EmptyState icon="check" title="No replenishment demand" />
      ) : (
        <div className="space-y-2">
          {visibleCandidates.map((candidate) => (
              <Card key={candidate.productId} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">
                      {candidate.productName}
                    </p>
                    <p className="text-xs text-muted">{candidate.rationale}</p>
                  </div>
                  <Badge
                    tone={
                      candidate.stockoutRisk === "critical" ||
                      candidate.stockoutRisk === "high"
                        ? "rose"
                        : "amber"
                    }
                  >
                    {candidate.stockoutRisk}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-xs">
                    <div><dt className="text-faint">On hand</dt><dd className="font-semibold text-ink">{candidate.onHand}</dd></div>
                    <div><dt className="text-faint">Minimum</dt><dd className="font-semibold text-ink">{candidate.reorderPoint}</dd></div>
                    <div><dt className="text-faint">Lead time</dt><dd className="font-semibold text-ink">{candidate.leadTimeDays}d</dd></div>
                  </dl>
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    disabled={workingId === candidate.productId}
                    onClick={() => void recommend(candidate)}
                  >
                    Save +{candidate.recommendedQuantity}
                  </button>
                </div>
              </Card>
            ))}
          {rows.map((record) => (
            <Card key={record.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{record.productName}</p>
                  <p className="text-xs text-muted">
                    +{record.recommendedQuantity} units / {record.leadTimeDays}{" "}
                    day lead time
                    {record.expectedArrivalAt
                      ? " / expected " + record.expectedArrivalAt
                      : ""}
                  </p>
                </div>
                <Badge
                  tone={
                    record.status === "ordered"
                      ? "emerald"
                      : record.status === "dismissed"
                        ? "slate"
                        : "brand"
                  }
                >
                  {record.status}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {record.status === "recommended" && (
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    disabled={workingId === record.id}
                    onClick={() => void transition(record, "accept")}
                  >
                    Accept
                  </button>
                )}
                {record.status === "accepted" && (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={workingId === record.id}
                    onClick={() => void transition(record, "handoff")}
                  >
                    Hand off to Procurement
                  </button>
                )}
                {record.procurementRequestId && (
                  <a
                    className="btn-outline btn-sm"
                    href={
                      "/procurement/requests/" + record.procurementRequestId
                    }
                  >
                    Open Procurement request
                  </a>
                )}
                {record.purchaseOrderId && (
                  <a
                    className="btn-primary btn-sm"
                    href={
                      "/procurement/purchase-orders/" + record.purchaseOrderId
                    }
                  >
                    Open purchase order
                  </a>
                )}
                {!["ordered", "dismissed"].includes(record.status) && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={workingId === record.id}
                    onClick={() => void transition(record, "dismiss")}
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
