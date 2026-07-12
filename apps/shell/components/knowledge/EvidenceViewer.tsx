"use client";

import { useEffect, useState } from "react";
import { Icon } from "@intra/ui";
import type { KnowledgeEvidence } from "@shell/lib/knowledge/types";

export function EvidenceViewer({ evidence }: { evidence?: KnowledgeEvidence }) {
  const [zoom, setZoom] = useState(1);
  const [active, setActive] = useState(evidence?.hotspots[0]?.id ?? "");
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
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
  if (!evidence)
    return (
      <div className="grid min-h-72 place-items-center border border-dashed border-line bg-inset p-8 text-center">
        <div>
          <Icon name="camera" className="mx-auto h-7 w-7 text-faint" />
          <p className="mt-3 font-semibold text-ink">
            Screen evidence is being prepared
          </p>
          <p className="mt-1 text-sm text-muted">
            Use the written control guidance until this verified screen is
            published.
          </p>
        </div>
      </div>
    );
  const activeHotspot = evidence.hotspots.find((item) => item.id === active);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border border-b-0 border-line bg-surface px-3 py-2">
        <span className="text-xs font-semibold text-muted">
          Verified {evidence.reviewedAt}
        </span>
        <div className="flex gap-1">
          <button
            className="icon-btn"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => setZoom((value) => Math.max(1, value - 0.25))}
          >
            <Icon name="minus" />
          </button>
          <button
            className="icon-btn"
            aria-label="Reset zoom"
            title="Reset zoom"
            onClick={() => setZoom(1)}
          >
            <Icon name="scan" />
          </button>
          <button
            className="icon-btn"
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
              className={`absolute grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs font-bold text-white shadow-e2 ring-4 ring-white ${active === hotspot.id ? "bg-brand-700" : "bg-brand-500"}`}
            >
              {hotspot.number}
            </button>
          ))}
        </div>
      </div>
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
    </div>
  );
}
