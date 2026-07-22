"use client";

import { useState } from "react";
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

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Product governance"
        title="Product readiness"
        description="Make the final go-live decision from verified evidence, then hand an approved launch to Operations."
        icon="shield"
        action={
          prepareReadiness ? (
            <HeroChipButton icon="plus" onClick={() => setReadinessOpen(true)}>
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
                  setReadinessDecision({ item, decision });
                }}
                onAcknowledge={() => void workspace.acknowledgeHandoff(item.id)}
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
              <button type="button" className="btn-secondary min-h-11" onClick={() => setPriceOpen(true)}>
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
        onNoteChange={setNote}
        onOpenChange={(open) => { if (!open) closeDecision(); }}
        onSubmit={async () => {
          if (!readinessDecision || note.trim().length < 8) return;
          await workspace.decideReadiness(readinessDecision.item.id, readinessDecision.decision, note.trim());
          closeDecision();
        }}
      />
      <DecisionSheet
        open={Boolean(priceDecision)}
        title={priceDecision?.decision === "approved" ? "Approve price" : "Reject price"}
        note={note}
        onNoteChange={setNote}
        onOpenChange={(open) => { if (!open) closeDecision(); }}
        onSubmit={async () => {
          if (!priceDecision || note.trim().length < 8) return;
          await workspace.decidePrice(priceDecision.item.id, priceDecision.decision, note.trim());
          closeDecision();
        }}
      />
      <ReadinessSheet open={readinessOpen} onOpenChange={setReadinessOpen} onSubmit={workspace.createReadiness} />
      <PriceProposalSheet open={priceOpen} onOpenChange={setPriceOpen} onSubmit={workspace.proposePrice} />
    </div>
  );
}

function statusTone(status: ReadinessPackage["status"] | PriceProposal["status"]): "brand" | "emerald" | "rose" | "amber" | "slate" {
  if (status === "approved") return "emerald";
  if (status === "rejected") return "rose";
  if (status === "submitted") return "amber";
  return "slate";
}

function ReadinessCard({ item, canDecide, canAcknowledge, onDecide, onAcknowledge }: {
  item: ReadinessPackage;
  canDecide: boolean;
  canAcknowledge: boolean;
  onDecide: (decision: Decision) => void;
  onAcknowledge: () => void;
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
        <button type="button" className="btn-primary min-h-11 w-full" onClick={onAcknowledge}>
          Acknowledge Operations handoff
        </button>
      )}
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

function DecisionSheet({ open, title, note, onNoteChange, onOpenChange, onSubmit }: {
  open: boolean;
  title: string;
  note: string;
  onNoteChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => Promise<void>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description="The actor, timestamp, version, and decision note are retained in the audit history." footer={
      <button type="button" className="btn-primary min-h-11 w-full" disabled={note.trim().length < 8} onClick={() => void onSubmit()}>{title}</button>
    }>
      <Field label="Decision note" htmlFor={`${title.replace(/\s+/g, "-").toLowerCase()}-note`} hint="Required · at least 8 characters">
        <textarea id={`${title.replace(/\s+/g, "-").toLowerCase()}-note`} className="input min-h-28" value={note} onChange={(event) => onNoteChange(event.target.value)} />
      </Field>
    </Sheet>
  );
}

function ReadinessSheet({ open, onOpenChange, onSubmit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: Parameters<ReturnType<typeof useProductWorkspace>["createReadiness"]>[0]) => Promise<void>;
}) {
  const [productId, setProductId] = useState("");
  const [title, setTitle] = useState("");
  const [conditions, setConditions] = useState("");
  const [evidenceLabel, setEvidenceLabel] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const valid = productId.trim() && title.trim().length >= 6 && evidenceLabel.trim() && evidenceReference.trim();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="New readiness package" description="Submit verified evidence for an independent Product go-live decision." footer={
      <button type="button" className="btn-primary min-h-11 w-full" disabled={!valid} onClick={() => void onSubmit({ productId: productId.trim(), title: title.trim(), conditions: conditions.trim(), evidence: [{ id: crypto.randomUUID(), label: evidenceLabel.trim(), reference: evidenceReference.trim(), required: true, verified: true }] }).then(() => onOpenChange(false))}>Submit package</button>
    }>
      <div className="space-y-4">
        <Field label="Product ID" htmlFor="readiness-product"><input id="readiness-product" className="input" value={productId} onChange={(event) => setProductId(event.target.value)} /></Field>
        <Field label="Readiness title" htmlFor="readiness-title"><input id="readiness-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field label="Evidence name" htmlFor="readiness-evidence"><input id="readiness-evidence" className="input" value={evidenceLabel} onChange={(event) => setEvidenceLabel(event.target.value)} /></Field>
        <Field label="Evidence reference" htmlFor="readiness-reference"><input id="readiness-reference" className="input" value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} /></Field>
        <Field label="Launch conditions" htmlFor="readiness-conditions"><textarea id="readiness-conditions" className="input min-h-24" value={conditions} onChange={(event) => setConditions(event.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

function PriceProposalSheet({ open, onOpenChange, onSubmit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: Parameters<ReturnType<typeof useProductWorkspace>["proposePrice"]>[0]) => Promise<void>;
}) {
  const [productId, setProductId] = useState("");
  const [price, setPrice] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [reason, setReason] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const valid = productId.trim() && Number(price) > 0 && Number(costBasis) >= 0 && reason.trim().length >= 12 && effectiveAt;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Propose price" description="The current price is unchanged until another authorized person approves this revision." footer={
      <button type="button" className="btn-primary min-h-11 w-full" disabled={!valid} onClick={() => void onSubmit({ productId: productId.trim(), proposedPrice: Number(price), costBasis: Number(costBasis), reason: reason.trim(), effectiveAt: new Date(effectiveAt).toISOString() }).then(() => onOpenChange(false))}>Submit price proposal</button>
    }>
      <div className="space-y-4">
        <Field label="Product ID" htmlFor="price-product"><input id="price-product" className="input" value={productId} onChange={(event) => setProductId(event.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proposed price" htmlFor="price-value"><input id="price-value" type="number" min="0.01" step="0.01" className="input" value={price} onChange={(event) => setPrice(event.target.value)} /></Field>
          <Field label="Cost basis" htmlFor="price-cost"><input id="price-cost" type="number" min="0" step="0.01" className="input" value={costBasis} onChange={(event) => setCostBasis(event.target.value)} /></Field>
        </div>
        <Field label="Reason" htmlFor="price-reason"><textarea id="price-reason" className="input min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <Field label="Effective date and time" htmlFor="price-effective"><input id="price-effective" type="datetime-local" className="input" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} /></Field>
      </div>
    </Sheet>
  );
}
