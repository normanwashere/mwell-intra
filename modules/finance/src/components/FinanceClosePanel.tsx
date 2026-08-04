"use client";

import { useState, type FormEvent } from "react";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Icon,
  Sheet,
  money,
  useToast,
} from "@intra/ui";
import type {
  FinanceCloseEntry,
  FinanceCloseEntryType,
  ManageFinanceCloseEntryInput,
} from "../types";

const ENTRY_LABEL: Record<FinanceCloseEntryType, string> = {
  inventory_valuation: "Inventory valuation",
  cogs: "Cost of goods sold",
  merchandise_expense: "Merchandise expense",
  cost_center: "Cost-center posting",
  write_off: "Write-off",
  event_settlement: "Event settlement",
};

export function FinanceClosePanel({
  entries,
  manage,
}: {
  entries: FinanceCloseEntry[];
  manage: (input: ManageFinanceCloseEntryInput) => Promise<FinanceCloseEntry>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const [draft, setDraft] = useState({
    periodStart: monthStart,
    periodEnd: today,
    entryType: "inventory_valuation" as FinanceCloseEntryType,
    sourceModule: "warehouse",
    sourceReference: "",
    costCenter: "",
    amount: 0,
    evidenceUrl: "",
    reconciliationNote: "",
  });

  const transition = async (
    entry: FinanceCloseEntry,
    action: "post" | "reconcile" | "exception",
  ) => {
    setWorkingId(entry.id);
    try {
      await manage({
        action,
        id: entry.id,
        reconciliationNote:
          action === "exception"
            ? "Flagged for correction from Finance close."
            : undefined,
      });
      toast.success(
        action === "post"
          ? "Close entry posted."
          : action === "reconcile"
            ? "Close entry reconciled."
            : "Close exception recorded.",
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Finance close entry could not be updated.",
      );
    } finally {
      setWorkingId(undefined);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await manage({
        action: "save",
        ...draft,
        costCenter: draft.costCenter || undefined,
      });
      toast.success("Finance close entry prepared for independent posting.");
      setOpen(false);
      setDraft((current) => ({
        ...current,
        sourceReference: "",
        amount: 0,
        evidenceUrl: "",
        reconciliationNote: "",
      }));
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Finance close entry could not be prepared.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="finance-close-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-faint">
            Period control
          </p>
          <h2
            id="finance-close-title"
            className="font-display text-xl font-bold text-ink"
          >
            Finance close
          </h2>
          <p className="text-sm text-muted">
            Valuation, COGS, expenses, write-offs, cost centers, and event
            settlement in one governed queue.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary w-full sm:w-auto"
          onClick={() => setOpen(true)}
        >
          <Icon name="plus" className="h-4 w-4" /> Prepare close entry
        </button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon="coins"
          title="No close entries"
          message="Prepare the first evidence-backed period entry. A second Finance user posts it."
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {entries.map((entry) => (
            <Card key={entry.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {ENTRY_LABEL[entry.entryType]}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {entry.sourceModule} / {entry.sourceReference} /{" "}
                    {entry.periodEnd}
                  </p>
                </div>
                <Badge
                  tone={
                    entry.status === "reconciled"
                      ? "emerald"
                      : entry.status === "exception"
                        ? "rose"
                        : "brand"
                  }
                >
                  {entry.status}
                </Badge>
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-faint">Amount</p>
                  <p className="font-display text-lg font-bold text-ink">
                    {money(entry.amount)}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {entry.status === "ready" && (
                    <button
                      type="button"
                      className="btn-outline btn-sm"
                      disabled={workingId === entry.id}
                      onClick={() => void transition(entry, "post")}
                    >
                      Post
                    </button>
                  )}
                  {entry.status === "posted" && (
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={workingId === entry.id}
                      onClick={() => void transition(entry, "reconcile")}
                    >
                      Reconcile
                    </button>
                  )}
                  {!["reconciled", "exception"].includes(entry.status) && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-rose-700 dark:text-rose-300"
                      disabled={workingId === entry.id}
                      onClick={() => void transition(entry, "exception")}
                    >
                      Flag
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Prepare Finance close entry"
        description="Attach source evidence now. Independent posting is enforced after preparation."
        footer={
          <button
            type="submit"
            form="finance-close-form"
            className="btn-primary w-full"
            disabled={saving}
          >
            {saving ? "Preparing..." : "Prepare for posting"}
          </button>
        }
      >
        <form
          id="finance-close-form"
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Period start" htmlFor="close-period-start">
              <input
                id="close-period-start"
                className="input"
                type="date"
                value={draft.periodStart}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    periodStart: event.target.value,
                  }))
                }
                required
              />
            </Field>
            <Field label="Period end" htmlFor="close-period-end">
              <input
                id="close-period-end"
                className="input"
                type="date"
                min={draft.periodStart}
                value={draft.periodEnd}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    periodEnd: event.target.value,
                  }))
                }
                required
              />
            </Field>
          </div>
          <Field label="Entry type" htmlFor="close-entry-type">
            <select
              id="close-entry-type"
              className="input"
              value={draft.entryType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  entryType: event.target.value as FinanceCloseEntryType,
                }))
              }
            >
              {Object.entries(ENTRY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Source module" htmlFor="close-source-module">
              <input
                id="close-source-module"
                className="input"
                value={draft.sourceModule}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sourceModule: event.target.value,
                  }))
                }
                required
              />
            </Field>
            <Field label="Source reference" htmlFor="close-source-reference">
              <input
                id="close-source-reference"
                className="input"
                value={draft.sourceReference}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sourceReference: event.target.value,
                  }))
                }
                required
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cost center" htmlFor="close-cost-center">
              <input
                id="close-cost-center"
                className="input"
                value={draft.costCenter}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    costCenter: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Amount (PHP)" htmlFor="close-amount">
              <input
                id="close-amount"
                className="input"
                type="number"
                step="0.01"
                value={draft.amount}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    amount: Number(event.target.value),
                  }))
                }
                required
              />
            </Field>
          </div>
          <Field label="Evidence URL" htmlFor="close-evidence">
            <input
              id="close-evidence"
              className="input"
              type="url"
              value={draft.evidenceUrl}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  evidenceUrl: event.target.value,
                }))
              }
              required
            />
          </Field>
          <Field label="Reconciliation note" htmlFor="close-note">
            <textarea
              id="close-note"
              className="input min-h-24"
              value={draft.reconciliationNote}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  reconciliationNote: event.target.value,
                }))
              }
            />
          </Field>
        </form>
      </Sheet>
    </section>
  );
}
