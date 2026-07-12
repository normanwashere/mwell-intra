"use client";

import React, { useRef, type KeyboardEvent } from "react";

export type WorkflowView = "flow" | "steps" | "roles" | "exceptions";

const VIEWS: Array<{ id: WorkflowView; label: string }> = [
  { id: "flow", label: "Flow" },
  { id: "steps", label: "Step-by-step" },
  { id: "roles", label: "Roles involved" },
  { id: "exceptions", label: "Exceptions" },
];

export function WorkflowNavigator({
  activeView,
  onSelectView,
}: {
  activeView: WorkflowView;
  onSelectView: (view: WorkflowView) => void;
}) {
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % VIEWS.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + VIEWS.length) % VIEWS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = VIEWS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    tabsRef.current[nextIndex]?.focus();
    onSelectView(VIEWS[nextIndex]!.id);
  };

  return (
    <nav aria-label="Workflow views" className="border-b border-line">
      <div
        role="tablist"
        aria-label="Workflow views"
        className="grid grid-cols-2 gap-1 min-[640px]:flex min-[640px]:min-w-max"
      >
        {VIEWS.map((view, index) => {
          const selected = view.id === activeView;
          return (
            <button
              ref={(element) => {
                tabsRef.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`workflow-tab-${view.id}`}
              aria-selected={selected}
              aria-controls={`workflow-panel-${view.id}`}
              tabIndex={selected ? 0 : -1}
              key={view.id}
              onClick={() => onSelectView(view.id)}
              onKeyDown={(event) => move(event, index)}
              className={`min-h-11 border-b-2 px-2 text-sm font-semibold min-[640px]:px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${selected ? "border-brand-600 text-brand-800" : "border-transparent text-muted hover:text-ink"}`}
            >
              {view.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
