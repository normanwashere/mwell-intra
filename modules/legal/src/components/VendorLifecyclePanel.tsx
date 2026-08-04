"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useSession } from "@intra/auth";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Icon,
  Sheet,
  useToast,
} from "@intra/ui";

interface VendorOption {
  id: string;
  name: string;
}

interface LifecycleReview {
  id: string;
  vendorId: string;
  reviewType:
    | "renewal"
    | "document_expiry"
    | "performance"
    | "reassessment"
    | "suspension"
    | "offboarding";
  status:
    | "open"
    | "under_review"
    | "approved"
    | "rejected"
    | "completed"
    | "cancelled";
  dueDate?: string;
  riskRating?: string;
  score?: number;
  reason: string;
  evidenceUrl?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mapReview(row: Record<string, unknown>): LifecycleReview {
  return {
    id: text(row.id),
    vendorId: text(row.vendor_id),
    reviewType: text(row.review_type) as LifecycleReview["reviewType"],
    status: text(row.status) as LifecycleReview["status"],
    dueDate: text(row.due_date) || undefined,
    riskRating: text(row.risk_rating) || undefined,
    score: row.score == null ? undefined : Number(row.score),
    reason: text(row.reason),
    evidenceUrl: text(row.evidence_url) || undefined,
  };
}

export function VendorLifecyclePanel({ vendors }: { vendors: VendorOption[] }) {
  const { mode, supabaseClient } = useSession();
  const live = mode === "supabase" ? supabaseClient : null;
  const toast = useToast();
  const [reviews, setReviews] = useState<LifecycleReview[]>([]);
  const [open, setOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    vendorId: vendors[0]?.id ?? "",
    reviewType: "renewal" as LifecycleReview["reviewType"],
    dueDate: "",
    riskRating: "medium",
    score: "",
    reason: "",
    evidenceUrl: "",
  });

  const vendorName = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.id, vendor.name])),
    [vendors],
  );

  const refresh = useCallback(async () => {
    if (!live) return;
    const { data, error } = await live
      .schema("legal")
      .from("vendor_lifecycle_reviews")
      .select(
        "id,vendor_id,review_type,status,due_date,risk_rating,score,reason,evidence_url",
      )
      .order("opened_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error(error.message);
      return;
    }
    setReviews(
      (Array.isArray(data) ? data : []).map((row) =>
        mapReview(row as Record<string, unknown>),
      ),
    );
  }, [live, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (
    review: LifecycleReview,
    action: "start" | "approve" | "reject" | "complete" | "cancel",
  ) => {
    if (!live) return;
    setWorkingId(review.id);
    const { error } = await live
      .schema("legal")
      .rpc("manage_vendor_lifecycle_review", {
        payload: {
          id: review.id,
          action,
          decision_note:
            action + " recorded from the Legal lifecycle workspace",
        },
      });
    setWorkingId(undefined);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vendor lifecycle review updated.");
    await refresh();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!live) return;
    setSaving(true);
    const { error } = await live
      .schema("legal")
      .rpc("manage_vendor_lifecycle_review", {
        payload: {
          action: "open",
          vendor_id: draft.vendorId,
          review_type: draft.reviewType,
          due_date: draft.dueDate || null,
          risk_rating: draft.riskRating,
          score: draft.score || null,
          reason: draft.reason,
          evidence_url: draft.evidenceUrl || null,
        },
      });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vendor lifecycle review opened.");
    setOpen(false);
    setDraft((current) => ({
      ...current,
      reason: "",
      evidenceUrl: "",
      score: "",
    }));
    await refresh();
  };

  if (!live) return null;

  return (
    <section className="space-y-3" aria-labelledby="vendor-lifecycle-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-faint">
            Post-accreditation control
          </p>
          <h2
            id="vendor-lifecycle-title"
            className="font-display text-xl font-bold text-ink"
          >
            Vendor lifecycle
          </h2>
          <p className="text-sm text-muted">
            Renewals, expiry, performance, reassessment, suspension, and
            offboarding.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary w-full sm:w-auto"
          onClick={() => setOpen(true)}
          disabled={vendors.length === 0}
        >
          <Icon name="plus" className="h-4 w-4" /> Open review
        </button>
      </div>
      {reviews.length === 0 ? (
        <EmptyState
          icon="building"
          title="No lifecycle reviews"
          message="Open a renewal, performance, risk, suspension, or offboarding review when required."
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {reviews.map((review) => (
            <Card key={review.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">
                    {vendorName.get(review.vendorId) ?? review.vendorId}
                  </p>
                  <p className="text-xs capitalize text-muted">
                    {review.reviewType.replaceAll("_", " ")}
                    {review.dueDate ? " / due " + review.dueDate : ""}
                  </p>
                </div>
                <Badge
                  tone={
                    review.status === "completed" ||
                    review.status === "approved"
                      ? "emerald"
                      : review.status === "rejected"
                        ? "rose"
                        : "brand"
                  }
                >
                  {review.status}
                </Badge>
              </div>
              <p className="text-sm text-ink">{review.reason}</p>
              <div className="flex flex-wrap gap-2">
                {review.status === "open" && (
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    disabled={workingId === review.id}
                    onClick={() => void act(review, "start")}
                  >
                    Start review
                  </button>
                )}
                {review.status === "under_review" && (
                  <>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={workingId === review.id}
                      onClick={() => void act(review, "approve")}
                    >
                      Approve outcome
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-rose-700 dark:text-rose-300"
                      disabled={workingId === review.id}
                      onClick={() => void act(review, "reject")}
                    >
                      Reject
                    </button>
                  </>
                )}
                {review.status === "approved" && (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={workingId === review.id}
                    onClick={() => void act(review, "complete")}
                  >
                    Complete review
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Open vendor lifecycle review"
        description="Use the smallest review type that matches the control event."
        footer={
          <button
            type="submit"
            form="vendor-lifecycle-form"
            className="btn-primary w-full"
            disabled={saving}
          >
            {saving ? "Opening..." : "Open review"}
          </button>
        }
      >
        <form
          id="vendor-lifecycle-form"
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <Field label="Vendor" htmlFor="lifecycle-vendor">
            <select
              id="lifecycle-vendor"
              className="input"
              value={draft.vendorId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  vendorId: event.target.value,
                }))
              }
              required
            >
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Review type" htmlFor="lifecycle-type">
            <select
              id="lifecycle-type"
              className="input"
              value={draft.reviewType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  reviewType: event.target
                    .value as LifecycleReview["reviewType"],
                }))
              }
            >
              <option value="renewal">Renewal</option>
              <option value="document_expiry">Document expiry</option>
              <option value="performance">Performance</option>
              <option value="reassessment">Reassessment</option>
              <option value="suspension">Suspension</option>
              <option value="offboarding">Offboarding</option>
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due date" htmlFor="lifecycle-due">
              <input
                id="lifecycle-due"
                className="input"
                type="date"
                value={draft.dueDate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    dueDate: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Risk rating" htmlFor="lifecycle-risk">
              <select
                id="lifecycle-risk"
                className="input"
                value={draft.riskRating}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    riskRating: event.target.value,
                  }))
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
          </div>
          <Field label="Performance score" htmlFor="lifecycle-score">
            <input
              id="lifecycle-score"
              className="input"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={draft.score}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  score: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Reason" htmlFor="lifecycle-reason">
            <textarea
              id="lifecycle-reason"
              className="input min-h-24"
              value={draft.reason}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              required
            />
          </Field>
          <Field label="Evidence URL" htmlFor="lifecycle-evidence">
            <input
              id="lifecycle-evidence"
              className="input"
              type="url"
              value={draft.evidenceUrl}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  evidenceUrl: event.target.value,
                }))
              }
            />
          </Field>
        </form>
      </Sheet>
    </section>
  );
}
