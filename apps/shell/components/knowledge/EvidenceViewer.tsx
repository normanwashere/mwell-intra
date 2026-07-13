"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Icon } from "@intra/ui";
import type { KnowledgeEvidence, KnowledgeFlowNode } from "@shell/lib/knowledge/types";
import { nodePresentation } from "@shell/lib/knowledge/semantics";

export function EvidenceViewer({
  evidence,
  node,
}: {
  evidence?: KnowledgeEvidence;
  node: KnowledgeFlowNode;
}) {
  const [zoom, setZoom] = useState(1);
  const [active, setActive] = useState(evidence?.hotspots[0]?.id ?? "");
  const [mobile, setMobile] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setActive(evidence?.hotspots[0]?.id ?? "");
    setZoom(1);
  }, [evidence?.id]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [expanded]);
  const presentation = nodePresentation(node, evidence);
  if (!evidence)
    return (
      <div className="min-h-72 border border-line bg-inset p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className={`grid h-11 w-11 shrink-0 place-items-center ${presentation.kind === "decision" ? "bg-amber-100 text-amber-800" : presentation.kind === "outcome" ? "bg-emerald-100 text-emerald-800" : presentation.kind === "exception" ? "bg-rose-100 text-rose-800" : "bg-brand-100 text-brand-800"}`}>
            <Icon
              name={presentation.kind === "decision" ? "clipboard" : presentation.kind === "outcome" ? "check" : presentation.kind === "exception" ? "alert" : "rotate"}
              className="h-5 w-5"
            />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase text-muted">{presentation.label}</p>
            <h3 className="mt-1 text-xl font-bold text-ink">{presentation.title}</h3>
            <p className="mt-3 max-w-2xl leading-7 text-muted">{presentation.detail}</p>
          </div>
        </div>
        {node.type === "decision" && (
          <div className="mt-6 border-l-4 border-amber-500 bg-surface p-4">
            <p className="text-xs font-semibold uppercase text-amber-800">Authority required</p>
            <p className="mt-1 text-sm text-muted">The named decision owner must record the supported branch. Documentation does not grant approval authority.</p>
          </div>
        )}
        {node.type === "terminal" && (
          <div className="mt-6 border-l-4 border-emerald-500 bg-surface p-4">
            <p className="text-xs font-semibold uppercase text-emerald-800">Evidence to retain</p>
            <p className="mt-1 text-sm text-muted">Confirm the final status, responsible actor, timestamp, source record, and audit history before treating this workflow as complete.</p>
          </div>
        )}
      </div>
    );
  const activeHotspot = evidence.hotspots.find((item) => item.id === active);
  const currentBuild = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
  const isReferenceBuild = Boolean(
    currentBuild && !currentBuild.startsWith(evidence.appCommit),
  );
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border border-b-0 border-line bg-surface px-3 py-2">
        <span className="text-xs font-semibold text-muted">
          {evidence.environment === "production" ? "Production evidence" : "Demo example"} · Reviewed {evidence.reviewedAt}
        </span>
        <div className="flex gap-1">
          <button
            className="icon-btn h-11 w-11 sm:h-8 sm:w-8"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => setZoom((value) => Math.max(1, value - 0.25))}
          >
            <Icon name="minus" />
          </button>
          <button
            className="icon-btn h-11 w-11 sm:h-8 sm:w-8"
            aria-label="Reset zoom"
            title="Reset zoom"
            onClick={() => setZoom(1)}
          >
            <Icon name="scan" />
          </button>
          <button
            className="icon-btn h-11 w-11 sm:h-8 sm:w-8"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>
      <div className="max-h-[42rem] overflow-auto border border-line bg-white">
        <div
          className="relative origin-top-left transition-transform motion-reduce:transition-none"
          style={{ width: `${zoom * 100}%` }}
        >
          <picture>
            {evidence.mobileSrc && (
              <source media="(max-width: 639px)" srcSet={evidence.mobileSrc} />
            )}
            <img
              src={evidence.desktopSrc}
              alt={evidence.alt}
              className="block h-auto w-full"
            />
          </picture>
          {evidence.hotspots.map((hotspot) => (
            <button
              key={hotspot.id}
              type="button"
              onClick={() => setActive(hotspot.id)}
              aria-label={`${hotspot.number}. ${hotspot.label}`}
              aria-pressed={active === hotspot.id}
              style={{
                left: `${(mobile ? (hotspot.mobileX ?? hotspot.x) : hotspot.x) * 100}%`,
                top: `${(mobile ? (hotspot.mobileY ?? hotspot.y) : hotspot.y) * 100}%`,
              }}
              className={`absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs font-bold text-white shadow-e2 ring-4 ring-white sm:h-8 sm:w-8 ${active === hotspot.id ? "bg-brand-700" : "bg-brand-500"}`}
            >
              {hotspot.number}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="btn-outline mt-2 min-h-11 w-full justify-center sm:hidden"
      >
        <Icon name="camera" className="h-4 w-4" /> View image full screen
      </button>
      {activeHotspot && (
        <div className="border-x border-b border-line bg-brand-50 p-3 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase text-brand-700">
            Where to interact
          </p>
          <span className="font-semibold text-ink">
            {activeHotspot.number}. {activeHotspot.label}
          </span>
          <p className="mt-1 text-muted">{activeHotspot.instruction}</p>
        </div>
      )}
      <div className="border-x border-b border-line bg-surface px-3 py-2 text-xs text-muted">
        Source build {evidence.appCommit.slice(0, 8)} · {evidence.provenance === "documentation" ? "Documentation capture" : "Production capture"}
        {isReferenceBuild ? " · Reference from an earlier build" : ""}
      </div>
      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="evidence-fullscreen-title"
          className="fixed inset-0 z-50 flex flex-col bg-surface"
        >
          <header className="safe-top flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 py-2">
            <div className="min-w-0">
              <p id="evidence-fullscreen-title" className="truncate font-semibold text-ink">
                {node.title}
              </p>
              <p className="text-xs text-muted">Follow the numbered controls in order.</p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="icon-btn shrink-0"
              aria-label="Close full-screen evidence"
            >
              <Icon name="x" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto bg-white p-2">
            <div className="relative mx-auto w-full max-w-5xl">
              <img src={mobile ? evidence.mobileSrc : evidence.desktopSrc} alt={evidence.alt} className="block h-auto w-full" />
              {evidence.hotspots.map((hotspot) => (
                <button
                  key={`expanded-${hotspot.id}`}
                  type="button"
                  onClick={() => setActive(hotspot.id)}
                  aria-label={`${hotspot.number}. ${hotspot.label} in full-screen evidence`}
                  style={{
                    left: `${(mobile ? hotspot.mobileX : hotspot.x) * 100}%`,
                    top: `${(mobile ? hotspot.mobileY : hotspot.y) * 100}%`,
                  }}
                  className="absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white shadow-e2 ring-4 ring-white"
                >
                  {hotspot.number}
                </button>
              ))}
            </div>
          </div>
          {activeHotspot && (
            <footer className="safe-bottom border-t border-line bg-brand-50 p-4">
              <p className="font-semibold text-ink">{activeHotspot.number}. {activeHotspot.label}</p>
              <p className="mt-1 text-sm text-muted">{activeHotspot.instruction}</p>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}
