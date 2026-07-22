"use client";

import { useRef, useState } from "react";
import { useSession } from "@intra/auth";
import { can } from "@intra/rbac";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  HeroChipButton,
  Icon,
  ModuleHero,
  Sheet,
  SignInPrompt,
  SkeletonList,
  SkeletonStats,
  money,
} from "@intra/ui";
import {
  canAcknowledgeOperationsHandoff,
  canDecidePriceProposal,
} from "./domain";
import { useProductWorkspace } from "./data";
import type { PriceProposal, ReadinessPackage } from "./types";

type Decision = "approved" | "rejected";

interface ActionIssue {
  message: string;
  stale: boolean;
}

function actionIssue(cause: unknown, action: string): ActionIssue {
  const detail = cause instanceof Error ? cause.message.trim() : "";
  if (/action was saved|saved, but/i.test(detail)) {
    return {
      stale: true,
      message: `The action to ${action} was saved, but confirmation could not be loaded. Do not submit it again. Refresh the workspace and verify the record status. Your entries remain available for reference.`,
    };
  }
  if (/not authorized|permission|row-level security|rls/i.test(detail)) {
    return {
      stale: false,
      message: `Could not ${action} because your current role is not authorized. Ask an administrator to verify your Product responsibility. Your entries were not cleared.`,
    };
  }
  const stale = /already|changed|conflict|no longer|not found|stale|unexpected status|must be (submitted|approved)/i.test(
    detail,
  );
  if (stale) {
    return {
      stale: true,
      message: `Could not ${action} because this record changed. The latest state has been loaded; review it before trying another action. Your entries are still available.`,
    };
  }
  if (/fetch|network|offline|timeout|timed out/i.test(detail)) {
    return {
      stale: false,
      message: `Could not ${action}. Check your connection, confirm the record was not saved, then try once. Your entries were not cleared.`,
    };
  }
  return {
    stale: false,
    message: `Could not ${action}. ${detail || "Review the required fields and try again."} Your entries were not cleared.`,
  };
}

export function ProductApp() {
  const { profile, userRoles, loading: sessionLoading } = useSession();
  const workspace = useProductWorkspace();
  const [readinessDecision, setReadinessDecision] = useState<{
    item: ReadinessPackage;
    decision: Decision;
  } | null>(null);
  const [priceDecision, setPriceDecision] = useState<{
    item: PriceProposal;
    decision: Decision;
  } | null>(null);
  const [note, setNote] = useState("");
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [pendingActions, setPendingActions] = useState<Record<string, true>>({});
  const [actionIssues, setActionIssues] = useState<Record<string, ActionIssue>>(
    {},
  );
  const inFlightActions = useRef(new Set<string>());

  if (sessionLoading || (profile && workspace.loading)) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading Product">
        <SkeletonStats />
        <SkeletonList rows={5} />
      </div>
    );
  }
  if (!profile) return <SignInPrompt module="Product" basename="/product" />;

  const viewReadiness = can(userRoles, "product", "view_readiness");
  if (!viewReadiness) {
    return (
      <div role="alert" className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <Icon name="lock" className="mx-auto h-8 w-8 text-faint" />
          <h1 className="font-display text-lg font-bold text-ink">No Product access</h1>
          <p className="text-sm text-muted">
            Your account needs a Product role. Ask an administrator to assign the appropriate responsibility.
          </p>
          <a href="/" className="btn-primary">Back to dashboard</a>
        </div>
      </div>
    );
  }

  const prepareReadiness = can(userRoles, "product", "prepare_readiness");
  const decideGoLive = can(userRoles, "product", "decide_go_live");
  const acknowledgeHandoff = can(
    userRoles,
    "product",
    "acknowledge_operations_handoff",
  );
  const viewPricing = can(userRoles, "product", "view_pricing");
  const proposePricing = can(userRoles, "product", "propose_pricing");
  const approvePricing = can(userRoles, "product", "approve_pricing");

  const closeDecision = () => {
    setReadinessDecision(null);
    setPriceDecision(null);
    setNote("");
  };

  const clearActionIssue = (key: string) => {
    setActionIssues((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const runProductAction = async (
    key: string,
    label: string,
    action: () => Promise<void>,
  ): Promise<boolean> => {
    if (inFlightActions.current.has(key)) return false;
    inFlightActions.current.add(key);
    setPendingActions((current) => ({ ...current, [key]: true }));
    clearActionIssue(key);
    try {
      await action();
      return true;
    } catch (cause) {
      const issue = actionIssue(cause, label);
      if (issue.stale) await workspace.refresh({ background: true });
      setActionIssues((current) => ({ ...current, [key]: issue }));
      return false;
    } finally {
      inFlightActions.current.delete(key);
      setPendingActions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const readinessDecisionKey = readinessDecision
    ? `readiness:${readinessDecision.item.id}:decision`
    : "readiness:decision";
  const currentReadinessDecision = readinessDecision
    ? workspace.data.readiness.find(
        (item) => item.id === readinessDecision.item.id,
      )
    : null;
  const readinessDecisionStale = Boolean(
    readinessDecision &&
      (!currentReadinessDecision ||
        currentReadinessDecision.version !== readinessDecision.item.version ||
        currentReadinessDecision.updatedAt !== readinessDecision.item.updatedAt ||
        currentReadinessDecision.status !== "submitted"),
  );
  const priceDecisionKey = priceDecision
    ? `pricing:${priceDecision.item.id}:decision`
    : "pricing:decision";
  const currentPriceDecision = priceDecision
    ? workspace.data.pricing.find((item) => item.id === priceDecision.item.id)
    : null;
  const priceDecisionStale = Boolean(
    priceDecision &&
      (!currentPriceDecision ||
        currentPriceDecision.version !== priceDecision.item.version ||
        currentPriceDecision.status !== "submitted"),
  );

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Product governance"
        title="Product readiness"
        description="Make the final go-live decision from verified evidence, then hand an approved launch to Operations."
        icon="shield"
        action={
          prepareReadiness ? (
            <HeroChipButton
              icon="plus"
              onClick={() => {
                if (!actionIssues["readiness:create"]?.stale)
                  clearActionIssue("readiness:create");
                setReadinessOpen(true);
              }}
            >
              New readiness package
            </HeroChipButton>
          ) : undefined
        }
        accessory={
          <div className="flex flex-wrap gap-2">
            <Badge tone="brand">
              {workspace.data.readiness.filter((item) => item.status === "submitted").length} awaiting decision
            </Badge>
            <Badge tone="emerald">
              {workspace.data.readiness.filter((item) => item.status === "approved").length} approved
            </Badge>
          </div>
        }
      />

      {workspace.error && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <p>{workspace.error}</p>
          <button type="button" className="btn-ghost min-h-11" onClick={() => void workspace.refresh()}>
            <Icon name="rotate" className="h-4 w-4" /> Retry
          </button>
        </div>
      )}

      <section aria-labelledby="readiness-queue-title" className="space-y-3">
        <div>
          <h2 id="readiness-queue-title" className="font-display text-lg font-bold text-ink">
            Go-live queue
          </h2>
          <p className="text-sm text-muted">Evidence, decision history, conditions, and Operations acknowledgement remain together.</p>
        </div>
        {workspace.data.readiness.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No readiness packages"
            message="Submitted packages will appear here for Product decision and Operations handoff."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workspace.data.readiness.map((item) => (
              <ReadinessCard
                key={item.id}
                item={item}
                canDecide={decideGoLive}
                canAcknowledge={acknowledgeHandoff}
                onDecide={(decision) => {
                  setNote("");
                  clearActionIssue(`readiness:${item.id}:decision`);
                  setReadinessDecision({ item, decision });
                }}
                handoffPending={Boolean(
                  pendingActions[`readiness:${item.id}:handoff`],
                )}
                handoffIssue={actionIssues[`readiness:${item.id}:handoff`]}
                onAcknowledge={() =>
                  runProductAction(
                    `readiness:${item.id}:handoff`,
                    "acknowledge the Operations handoff",
                    () => workspace.acknowledgeHandoff(item.id),
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      {viewPricing && (
        <section aria-labelledby="pricing-governance-title" className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="pricing-governance-title" className="font-display text-lg font-bold text-ink">
                Pricing governance
              </h2>
              <p className="text-sm text-muted">Effective-dated proposals retain cost basis, reason, independent approval, and history.</p>
            </div>
            {proposePricing && (
              <button
                type="button"
                className="btn-secondary min-h-11"
                onClick={() => {
                  if (!actionIssues["pricing:create"]?.stale)
                    clearActionIssue("pricing:create");
                  setPriceOpen(true);
                }}
              >
                <Icon name="plus" className="h-4 w-4" /> Propose price
              </button>
            )}
          </div>
          {workspace.data.pricing.length === 0 ? (
            <EmptyState
              icon="tag"
              title="No price proposals"
              message="Price history will appear after a contributor submits a governed revision."
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {workspace.data.pricing.map((item) => (
                <PriceCard
                  key={item.id}
                  item={item}
                  canDecide={approvePricing && canDecidePriceProposal(item, profile.id)}
                  onDecide={(decision) => {
                    setNote("");
                    clearActionIssue(`pricing:${item.id}:decision`);
                    setPriceDecision({ item, decision });
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <DecisionSheet
        open={Boolean(readinessDecision)}
        title={readinessDecision?.decision === "approved" ? "Approve go-live" : "Reject go-live"}
        note={note}
        pending={Boolean(pendingActions[readinessDecisionKey])}
        issue={actionIssues[readinessDecisionKey]}
        stale={
          readinessDecisionStale ||
          Boolean(actionIssues[readinessDecisionKey]?.stale)
        }
        onNoteChange={setNote}
        onOpenChange={(open) => {
          if (!open && !pendingActions[readinessDecisionKey]) closeDecision();
        }}
        onSubmit={async () => {
          if (!readinessDecision || note.trim().length < 8) return;
          const succeeded = await runProductAction(
            readinessDecisionKey,
            `${readinessDecision.decision === "approved" ? "approve" : "reject"} go-live`,
            () =>
              workspace.decideReadiness(
                readinessDecision.item.id,
                readinessDecision.decision,
                note.trim(),
              ),
          );
          if (succeeded) closeDecision();
        }}
      />
      <DecisionSheet
        open={Boolean(priceDecision)}
        title={priceDecision?.decision === "approved" ? "Approve price" : "Reject price"}
        note={note}
        pending={Boolean(pendingActions[priceDecisionKey])}
        issue={actionIssues[priceDecisionKey]}
        stale={
          priceDecisionStale || Boolean(actionIssues[priceDecisionKey]?.stale)
        }
        onNoteChange={setNote}
        onOpenChange={(open) => {
          if (!open && !pendingActions[priceDecisionKey]) closeDecision();
        }}
        onSubmit={async () => {
          if (!priceDecision || note.trim().length < 8) return;
          const succeeded = await runProductAction(
            priceDecisionKey,
            `${priceDecision.decision === "approved" ? "approve" : "reject"} the price proposal`,
            () =>
              workspace.decidePrice(
                priceDecision.item.id,
                priceDecision.decision,
                note.trim(),
              ),
          );
          if (succeeded) closeDecision();
        }}
      />
      <ReadinessSheet
        open={readinessOpen}
        pending={Boolean(pendingActions["readiness:create"])}
        issue={actionIssues["readiness:create"]}
        onOpenChange={(open) => {
          if (!open && !pendingActions["readiness:create"]) setReadinessOpen(false);
        }}
        onSubmit={(draft) =>
          runProductAction("readiness:create", "submit the readiness package", () =>
            workspace.createReadiness(draft),
          )
        }
      />
      <PriceProposalSheet
        open={priceOpen}
        pending={Boolean(pendingActions["pricing:create"])}
        issue={actionIssues["pricing:create"]}
        onOpenChange={(open) => {
          if (!open && !pendingActions["pricing:create"]) setPriceOpen(false);
        }}
        onSubmit={(draft) =>
          runProductAction("pricing:create", "submit the price proposal", () =>
            workspace.proposePrice(draft),
          )
        }
      />
    </div>
  );
}

function statusTone(status: ReadinessPackage["status"] | PriceProposal["status"]): "brand" | "emerald" | "rose" | "amber" | "slate" {
  if (status === "approved") return "emerald";
  if (status === "rejected") return "rose";
  if (status === "submitted") return "amber";
  return "slate";
}

function ReadinessCard({
  item,
  canDecide,
  canAcknowledge,
  handoffPending,
  handoffIssue,
  onDecide,
  onAcknowledge,
}: {
  item: ReadinessPackage;
  canDecide: boolean;
  canAcknowledge: boolean;
  handoffPending: boolean;
  handoffIssue?: ActionIssue;
  onDecide: (decision: Decision) => void;
  onAcknowledge: () => Promise<boolean>;
}) {
  const handoffReady = canAcknowledge && canAcknowledgeOperationsHandoff(item);
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-faint">Version {item.version}</p>
          <h3 className="mt-1 font-display text-base font-bold text-ink">{item.title}</h3>
          <p className="text-sm text-muted">Product {item.productId}</p>
        </div>
        <Badge tone={statusTone(item.status)}>{item.status}</Badge>
      </div>
      <ul className="space-y-2" aria-label="Readiness evidence">
        {item.evidence.map((evidenceItem) => (
          <li key={evidenceItem.id} className="flex items-start gap-2 text-sm text-muted">
            <Icon name={evidenceItem.verified ? "check" : "alert"} className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong className="font-semibold text-ink">{evidenceItem.label}</strong> · {evidenceItem.reference}</span>
          </li>
        ))}
      </ul>
      {item.conditions && <p className="rounded-lg bg-inset p-3 text-sm text-muted"><strong className="text-ink">Conditions:</strong> {item.conditions}</p>}
      {canDecide && item.status === "submitted" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary min-h-11" onClick={() => onDecide("approved")}>Approve go-live</button>
          <button type="button" className="btn-secondary min-h-11" onClick={() => onDecide("rejected")}>Reject go-live</button>
        </div>
      )}
      {handoffReady && (
        <button
          type="button"
          className="btn-primary min-h-11 w-full"
          disabled={handoffPending || handoffIssue?.stale}
          aria-busy={handoffPending}
          onClick={() => void onAcknowledge()}
        >
          {handoffPending
            ? "Acknowledging Operations handoff..."
            : "Acknowledge Operations handoff"}
        </button>
      )}
      {handoffIssue && <ActionFeedback issue={handoffIssue} />}
    </Card>
  );
}

function PriceCard({ item, canDecide, onDecide }: {
  item: PriceProposal;
  canDecide: boolean;
  onDecide: (decision: Decision) => void;
}) {
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-faint">{item.productName} · Version {item.version}</p>
          <h3 className="mt-1 font-display text-base font-bold text-ink">{money(item.currentPrice)} → {money(item.proposedPrice)}</h3>
        </div>
        <Badge tone={statusTone(item.status)}>{item.status}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-faint">Cost basis</dt><dd className="font-semibold text-ink">{money(item.costBasis)}</dd></div>
        <div><dt className="text-faint">Effective</dt><dd className="font-semibold text-ink">{new Date(item.effectiveAt).toLocaleDateString()}</dd></div>
      </dl>
      <p className="text-sm text-muted">{item.reason}</p>
      {canDecide && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary min-h-11" onClick={() => onDecide("approved")}>Approve price</button>
          <button type="button" className="btn-secondary min-h-11" onClick={() => onDecide("rejected")}>Reject price</button>
        </div>
      )}
    </Card>
  );
}

function ActionFeedback({ issue }: { issue: ActionIssue }) {
  return (
    <div
      role="alert"
      className={`rounded-lg border px-3 py-2 text-sm ${
        issue.stale
          ? "border-amber-300 bg-amber-50 text-amber-950"
          : "border-rose-300 bg-rose-50 text-rose-950"
      }`}
    >
      {issue.message}
    </div>
  );
}

function DecisionSheet({ open, title, note, pending, issue, stale, onNoteChange, onOpenChange, onSubmit }: {
  open: boolean;
  title: string;
  note: string;
  pending: boolean;
  issue?: ActionIssue;
  stale: boolean;
  onNoteChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => Promise<void>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description="The actor, timestamp, version, and decision note are retained in the audit history." footer={
      <button
        type="button"
        className="btn-primary min-h-11 w-full"
        disabled={note.trim().length < 8 || pending || stale}
        aria-busy={pending}
        onClick={() => void onSubmit()}
      >
        {pending ? `${title}...` : title}
      </button>
    }>
      <div className="space-y-4" aria-busy={pending}>
        <Field label="Decision note" htmlFor={`${title.replace(/\s+/g, "-").toLowerCase()}-note`} hint="Required - at least 8 characters">
          <textarea
            id={`${title.replace(/\s+/g, "-").toLowerCase()}-note`}
            className="input min-h-28"
            value={note}
            disabled={pending}
            onChange={(event) => onNoteChange(event.target.value)}
          />
        </Field>
        {stale && !issue && (
          <ActionFeedback
            issue={{
              stale: true,
              message:
                "This record no longer matches the version you opened. Close this decision and review the latest status before taking another action. Your note remains available until you close it.",
            }}
          />
        )}
        {issue && <ActionFeedback issue={issue} />}
      </div>
    </Sheet>
  );
}

function ReadinessSheet({ open, pending, issue, onOpenChange, onSubmit }: {
  open: boolean;
  pending: boolean;
  issue?: ActionIssue;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: Parameters<ReturnType<typeof useProductWorkspace>["createReadiness"]>[0]) => Promise<boolean>;
}) {
  const [productId, setProductId] = useState("");
  const [title, setTitle] = useState("");
  const [conditions, setConditions] = useState("");
  const [evidenceLabel, setEvidenceLabel] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const valid = productId.trim() && title.trim().length >= 6 && evidenceLabel.trim() && evidenceReference.trim();
  const submit = async () => {
    const succeeded = await onSubmit({
      productId: productId.trim(),
      title: title.trim(),
      conditions: conditions.trim(),
      evidence: [
        {
          id: crypto.randomUUID(),
          label: evidenceLabel.trim(),
          reference: evidenceReference.trim(),
          required: true,
          verified: true,
        },
      ],
    });
    if (!succeeded) return;
    setProductId("");
    setTitle("");
    setConditions("");
    setEvidenceLabel("");
    setEvidenceReference("");
    onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="New readiness package" description="Submit verified evidence for an independent Product go-live decision." footer={
      <button
        type="button"
        className="btn-primary min-h-11 w-full"
        disabled={!valid || pending || issue?.stale}
        aria-busy={pending}
        onClick={() => void submit()}
      >
        {pending ? "Submitting package..." : "Submit package"}
      </button>
    }>
      <fieldset className="space-y-4" disabled={pending} aria-busy={pending}>
        <Field label="Product ID" htmlFor="readiness-product"><input id="readiness-product" className="input" value={productId} onChange={(event) => setProductId(event.target.value)} /></Field>
        <Field label="Readiness title" htmlFor="readiness-title"><input id="readiness-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field label="Evidence name" htmlFor="readiness-evidence"><input id="readiness-evidence" className="input" value={evidenceLabel} onChange={(event) => setEvidenceLabel(event.target.value)} /></Field>
        <Field label="Evidence reference" htmlFor="readiness-reference"><input id="readiness-reference" className="input" value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} /></Field>
        <Field label="Launch conditions" htmlFor="readiness-conditions"><textarea id="readiness-conditions" className="input min-h-24" value={conditions} onChange={(event) => setConditions(event.target.value)} /></Field>
        {issue && <ActionFeedback issue={issue} />}
      </fieldset>
    </Sheet>
  );
}

function PriceProposalSheet({ open, pending, issue, onOpenChange, onSubmit }: {
  open: boolean;
  pending: boolean;
  issue?: ActionIssue;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: Parameters<ReturnType<typeof useProductWorkspace>["proposePrice"]>[0]) => Promise<boolean>;
}) {
  const [productId, setProductId] = useState("");
  const [price, setPrice] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [reason, setReason] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const valid = productId.trim() && Number(price) > 0 && Number(costBasis) >= 0 && reason.trim().length >= 12 && effectiveAt;
  const submit = async () => {
    const succeeded = await onSubmit({
      productId: productId.trim(),
      proposedPrice: Number(price),
      costBasis: Number(costBasis),
      reason: reason.trim(),
      effectiveAt: new Date(effectiveAt).toISOString(),
    });
    if (!succeeded) return;
    setProductId("");
    setPrice("");
    setCostBasis("");
    setReason("");
    setEffectiveAt("");
    onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Propose price" description="The current price is unchanged until another authorized person approves this revision." footer={
      <button
        type="button"
        className="btn-primary min-h-11 w-full"
        disabled={!valid || pending || issue?.stale}
        aria-busy={pending}
        onClick={() => void submit()}
      >
        {pending ? "Submitting price proposal..." : "Submit price proposal"}
      </button>
    }>
      <fieldset className="space-y-4" disabled={pending} aria-busy={pending}>
        <Field label="Product ID" htmlFor="price-product"><input id="price-product" className="input" value={productId} onChange={(event) => setProductId(event.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proposed price" htmlFor="price-value"><input id="price-value" type="number" min="0.01" step="0.01" className="input" value={price} onChange={(event) => setPrice(event.target.value)} /></Field>
          <Field label="Cost basis" htmlFor="price-cost"><input id="price-cost" type="number" min="0" step="0.01" className="input" value={costBasis} onChange={(event) => setCostBasis(event.target.value)} /></Field>
        </div>
        <Field label="Reason" htmlFor="price-reason"><textarea id="price-reason" className="input min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <Field label="Effective date and time" htmlFor="price-effective"><input id="price-effective" type="datetime-local" className="input" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} /></Field>
        {issue && <ActionFeedback issue={issue} />}
      </fieldset>
    </Sheet>
  );
}
