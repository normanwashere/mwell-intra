"use client";

import { useRef, useState } from "react";
import { Badge, Button, Icon } from "@intra/ui";
import { useLearning } from "./LearningProvider";
import type { RequirementDefinition, RequirementProgress } from "./types";

export interface ControlledPolicyDocument {
  id: string;
  version: string;
  title: string;
  owner: string;
  effectiveDate: string;
  summary: string;
  sections: readonly string[];
  evidenceHash: string;
  href: string;
}

export function PolicyAcknowledgment({
  requirement,
  progress,
  document,
}: {
  requirement: RequirementDefinition;
  progress: RequirementProgress;
  document: ControlledPolicyDocument;
}) {
  const { acknowledgePolicy } = useLearning();
  const [accepted, setAccepted] = useState(false);
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const documentKey = `${progress.assignmentRequirementId}:${requirement.version}:${document.id}:${document.version}`;
  const complete = ["passed", "waived"].includes(progress.state) || acknowledgedKey === documentKey;

  return (
    <section aria-labelledby="policy-title" className="space-y-5">
      <header className="border-b border-line pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">Controlled policy</Badge>
          <Badge tone="slate">Version {document.version}</Badge>
        </div>
        <h2 id="policy-title" className="mt-3 font-display text-xl font-bold text-ink">{document.title}</h2>
        <p className="mt-1 text-sm text-muted">{requirement.title}</p>
      </header>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-muted">Owner</dt><dd className="mt-1 text-ink">{document.owner}</dd></div>
        <div><dt className="font-semibold text-muted">Effective date</dt><dd className="mt-1 text-ink">{document.effectiveDate}</dd></div>
      </dl>
      <p className="border-l-4 border-brand-500 bg-brand-500/5 px-4 py-3 text-sm text-ink">{document.summary}</p>
      <ol className="space-y-3 border-y border-line py-4 text-sm text-ink">
        {document.sections.map((section, index) => (
          <li key={section} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
            <span className="tnum font-semibold text-brand-700 dark:text-brand-300">{index + 1}</span>
            <span>{section}</span>
          </li>
        ))}
      </ol>
      <a href={document.href} target="_blank" rel="noreferrer" className="btn-outline inline-flex">
        Open controlled policy
      </a>
      {complete ? (
        <div role="status" className="flex items-center gap-2 border-t border-line pt-4 font-semibold text-emerald-700 dark:text-emerald-300">
          <Icon name="check" className="h-5 w-5" /> Policy acknowledged
        </div>
      ) : (
        <>
          <label className="flex cursor-pointer items-start gap-3 border-t border-line pt-4 text-sm font-medium text-ink">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" />
            <span>I have read and understand this controlled policy version.</span>
          </label>
          <Button
            disabled={!accepted || pending}
            onClick={async () => {
              if (inFlight.current) return;
              inFlight.current = true;
              setPending(true);
              setError(null);
              try {
                await acknowledgePolicy({
                  assignmentRequirementId: progress.assignmentRequirementId,
                  controlledDocumentId: document.id,
                  controlledDocumentVersion: document.version,
                  evidenceHash: document.evidenceHash,
                });
                setAcknowledgedKey(documentKey);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Policy acknowledgment could not be recorded.");
              } finally {
                inFlight.current = false;
                setPending(false);
              }
            }}
          >Acknowledge policy</Button>
        </>
      )}
      {error && <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>}
    </section>
  );
}
