import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSession } from "@intra/auth";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Sheet,
  useToast,
} from "@/components/ui";
import { Icon } from "@/components/Icon";

interface IntegrityCase {
  id: string;
  caseType: string;
  productId?: string;
  status: string;
  severity: string;
  reason: string;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function InventoryIntegrityPanel({
  products,
  canManage,
  canApprove,
}: {
  products: Array<{ id: string; name: string }>;
  canManage: boolean;
  canApprove: boolean;
}) {
  const { mode, supabaseClient } = useSession();
  const live = mode === "supabase" ? supabaseClient : null;
  const toast = useToast();
  const [cases, setCases] = useState<IntegrityCase[]>([]);
  const [open, setOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string>();
  const [draft, setDraft] = useState({
    caseType: "recall",
    productId: products[0]?.id ?? "",
    severity: "high",
    reason: "",
    evidenceUrl: "",
  });

  const refresh = useCallback(async () => {
    if (!live) return;
    const { data, error } = await live
      .schema("warehouse")
      .from("inventory_integrity_cases")
      .select("id,case_type,product_id,status,severity,reason")
      .order("opened_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCases(
      (Array.isArray(data) ? data : []).map((row) => ({
        id: readText(row.id),
        caseType: readText(row.case_type),
        productId: readText(row.product_id) || undefined,
        status: readText(row.status),
        severity: readText(row.severity),
        reason: readText(row.reason),
      })),
    );
  }, [live, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (
    record: IntegrityCase,
    action: "contain" | "submit" | "resolve" | "cancel",
  ) => {
    if (!live) return;
    setWorkingId(record.id);
    const { error } = await live
      .schema("warehouse")
      .rpc("manage_inventory_integrity_case", {
        payload: {
          id: record.id,
          action,
          resolution_reference:
            action === "resolve"
              ? "INV-" + new Date().toISOString().slice(0, 10)
              : null,
        },
      });
    setWorkingId(undefined);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Inventory integrity case updated.");
    await refresh();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!live) return;
    const { error } = await live
      .schema("warehouse")
      .rpc("manage_inventory_integrity_case", {
        payload: {
          action: "open",
          case_type: draft.caseType,
          product_id: draft.productId || null,
          severity: draft.severity,
          reason: draft.reason,
          evidence_url: draft.evidenceUrl || null,
        },
      });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Inventory integrity case opened.");
    setOpen(false);
    setDraft((current) => ({ ...current, reason: "", evidenceUrl: "" }));
    await refresh();
  };

  if (!live || !canManage) return null;

  return (
    <section className="space-y-3" aria-labelledby="integrity-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-faint">
            Inventory control
          </p>
          <h2
            id="integrity-title"
            className="font-display text-lg font-bold text-ink"
          >
            Integrity cases
          </h2>
          <p className="text-sm text-muted">
            Counts, expiry, recalls, damage, and serial reconciliation with
            approval evidence.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary w-full sm:w-auto"
          onClick={() => setOpen(true)}
        >
          <Icon name="plus" className="h-4 w-4" /> Open case
        </button>
      </div>
      {cases.length === 0 ? (
        <EmptyState icon="check" title="No integrity exceptions" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {cases.map((record) => (
            <Card key={record.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold capitalize text-ink">
                    {record.caseType.replaceAll("_", " ")}
                  </p>
                  <p className="text-xs text-muted">
                    {products.find((product) => product.id === record.productId)
                      ?.name ?? "Multiple inventory records"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge
                    tone={
                      record.severity === "critical"
                        ? "rose"
                        : record.severity === "high"
                          ? "amber"
                          : "slate"
                    }
                  >
                    {record.severity}
                  </Badge>
                  <Badge
                    tone={record.status === "resolved" ? "emerald" : "brand"}
                  >
                    {record.status}
                  </Badge>
                </div>
              </div>
              <p className="text-sm text-ink">{record.reason}</p>
              <div className="flex flex-wrap gap-2">
                {record.status === "open" && (
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    disabled={workingId === record.id}
                    onClick={() => void act(record, "contain")}
                  >
                    Contain
                  </button>
                )}
                {record.status === "contained" && (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={workingId === record.id}
                    onClick={() => void act(record, "submit")}
                  >
                    Submit approval
                  </button>
                )}
                {record.status === "pending_approval" && canApprove && (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={workingId === record.id}
                    onClick={() => void act(record, "resolve")}
                  >
                    Approve resolution
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
        title="Open inventory integrity case"
        description="Start with containment when stock may be unsafe or inaccurate."
        footer={
          <button
            type="submit"
            form="integrity-form"
            className="btn-primary w-full"
          >
            Open case
          </button>
        }
      >
        <form
          id="integrity-form"
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <Field label="Case type" htmlFor="integrity-type">
            <select
              id="integrity-type"
              className="input"
              value={draft.caseType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  caseType: event.target.value,
                }))
              }
            >
              <option value="cycle_count">Cycle count</option>
              <option value="expiry">Expiry</option>
              <option value="recall">Recall</option>
              <option value="damage">Damage</option>
              <option value="serial_reconciliation">
                Serial reconciliation
              </option>
            </select>
          </Field>
          <Field label="Product" htmlFor="integrity-product">
            <select
              id="integrity-product"
              className="input"
              value={draft.productId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  productId: event.target.value,
                }))
              }
            >
              <option value="">Multiple inventory records</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Severity" htmlFor="integrity-severity">
            <select
              id="integrity-severity"
              className="input"
              value={draft.severity}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  severity: event.target.value,
                }))
              }
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </Field>
          <Field label="Reason" htmlFor="integrity-reason">
            <textarea
              id="integrity-reason"
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
          <Field label="Evidence URL" htmlFor="integrity-evidence">
            <input
              id="integrity-evidence"
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
