"use client";

import { useMemo, useState } from "react";
import { Icon } from "@intra/ui";
import {
  OPERATING_PERSONAS,
  OPERATING_WORKFLOWS,
} from "@shell/lib/knowledge/operatingPersonas";

export function OperatingModel({
  onOpenFlow,
}: {
  onOpenFlow: (flowId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(OPERATING_WORKFLOWS[0]!.id);
  const selected = useMemo(
    () =>
      OPERATING_WORKFLOWS.find((workflow) => workflow.id === selectedId) ??
      OPERATING_WORKFLOWS[0]!,
    [selectedId],
  );
  const personas = new Map(
    OPERATING_PERSONAS.map((persona) => [persona.id, persona]),
  );

  return (
    <section
      aria-labelledby="operating-model-title"
      className="border-y border-line py-7"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
            Lean operating model
          </p>
          <h2
            id="operating-model-title"
            className="mt-1 text-xl font-bold text-ink"
          >
            See who acts, decides, and receives the handoff
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Eleven job-based personas cover the current app. Select a process to
            preview its human handoffs, then open the full decision tree for
            controls, exceptions, evidence, and screenshots.
          </p>
        </div>
        <span className="text-sm font-semibold text-ink">11 personas</span>
      </div>

      <div
        className="mt-5 flex gap-px overflow-x-auto border border-line bg-line"
        role="tablist"
        aria-label="Cross-department workflow"
      >
        {OPERATING_WORKFLOWS.map((workflow) => (
          <button
            key={workflow.id}
            type="button"
            role="tab"
            aria-selected={workflow.id === selected.id}
            onClick={() => setSelectedId(workflow.id)}
            className={`min-h-12 shrink-0 bg-surface px-4 text-sm font-semibold focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
              workflow.id === selected.id
                ? "border-b-2 border-brand-600 text-brand-700"
                : "border-b-2 border-transparent text-muted hover:bg-inset hover:text-ink"
            }`}
          >
            {workflow.label}
          </button>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-line bg-inset p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-ink">{selected.label}</h3>
            <p className="mt-1 text-sm text-muted">{selected.summary}</p>
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm min-h-11"
            onClick={() => onOpenFlow(selected.flowId)}
          >
            Open full decision tree
            <Icon name="chevron" className="h-4 w-4 -rotate-90" />
          </button>
        </div>

        <ol
          className="mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label={`${selected.label} handoff sequence`}
          tabIndex={0}
        >
          {selected.steps.map((step, index) => {
            const persona = personas.get(step.personaId)!;
            return (
              <li
                key={`${selected.id}-${index}`}
                className="relative w-[min(17rem,82vw)] shrink-0 snap-start"
              >
                <div
                  className={`h-full rounded-md border bg-surface p-3 shadow-e1 ${
                    step.decision ? "border-amber-500" : "border-line"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center bg-brand-50 text-xs font-bold text-brand-700">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {persona.department}
                      </p>
                      <p className="mt-0.5 text-sm font-bold text-ink">
                        {persona.label}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-5 text-ink">
                    {step.action}
                  </p>
                  {step.decision && (
                    <p className="mt-3 border-l-2 border-amber-500 pl-2 text-xs font-semibold leading-5 text-amber-900">
                      Decision: {step.decision}
                    </p>
                  )}
                </div>
                {index < selected.steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-5 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-line bg-inset text-brand-600"
                  >
                    <Icon name="chevron" className="h-4 w-4 -rotate-90" />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <details className="mt-4 border-t border-line pt-4">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-brand-700">
          View all 11 personas and responsibilities
        </summary>
        <div className="mt-3 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {OPERATING_PERSONAS.map((persona) => (
            <div key={persona.id} className="bg-surface p-3">
              <p className="text-sm font-bold text-ink">{persona.label}</p>
              <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
                {persona.department}
              </p>
              <p className="mt-2 text-sm leading-5 text-muted">
                {persona.responsibility}
              </p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
