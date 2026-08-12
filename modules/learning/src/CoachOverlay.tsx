"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Button, Icon } from "@intra/ui";
import type { TrainingPlacement, TrainingStep } from "./training/types";

interface AnchorLayout {
  target: HTMLElement | null;
  placement: TrainingPlacement;
  style: CSSProperties;
  valid: boolean;
}

const COACH_WIDTH = 320;
const COACH_HEIGHT = 260;
const GAP = 16;

const visible = (element: Element): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getClientRects().length > 0
  );
};

function locate(anchor: string): AnchorLayout {
  let matches: HTMLElement[];
  try {
    matches = [...document.querySelectorAll(anchor)].filter(visible);
  } catch {
    return { target: null, placement: "sheet", style: {}, valid: false };
  }
  if (matches.length !== 1) {
    return { target: null, placement: "sheet", style: {}, valid: false };
  }
  const target = matches[0]!;
  if (window.innerWidth < 768) {
    return { target, placement: "sheet", style: {}, valid: true };
  }
  const rect = target.getBoundingClientRect();
  const rightSpace = window.innerWidth - rect.right - GAP;
  const leftSpace = rect.left - GAP;
  const bottomSpace = window.innerHeight - rect.bottom - GAP;
  const placement: TrainingPlacement =
    rightSpace >= COACH_WIDTH
      ? "right"
      : leftSpace >= COACH_WIDTH
        ? "left"
        : bottomSpace >= COACH_HEIGHT
          ? "bottom"
          : "top";
  const top = Math.max(GAP, Math.min(rect.top, window.innerHeight - COACH_HEIGHT - GAP));
  const left =
    placement === "right"
      ? rect.right + GAP
      : placement === "left"
        ? rect.left - COACH_WIDTH - GAP
        : Math.max(GAP, Math.min(rect.left, window.innerWidth - COACH_WIDTH - GAP));
  const verticalTop =
    placement === "bottom"
      ? rect.bottom + GAP
      : placement === "top"
        ? Math.max(GAP, rect.top - COACH_HEIGHT - GAP)
        : top;
  return {
    target,
    placement,
    valid: true,
    style: { left, top: verticalTop, width: COACH_WIDTH },
  };
}

export function CoachOverlay({
  step,
  canGoBack,
  onBack,
  onExit,
  onResumeLater,
  onContinue,
  continueLabel = "Continue",
  continueDisabled = false,
  error,
}: {
  step: TrainingStep;
  canGoBack: boolean;
  onBack(): void;
  onExit(): void;
  onResumeLater(): void;
  onContinue?(): void;
  continueLabel?: string;
  continueDisabled?: boolean;
  error?: string | null;
}) {
  const [layout, setLayout] = useState<AnchorLayout>(() => locate(step.anchor));
  const [collapsed, setCollapsed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const update = () => setLayout(locate(step.anchor));
    update();
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.anchor, step.id]);

  useLayoutEffect(() => {
    headingRef.current?.focus();
  }, [step.id, layout.valid]);

  useLayoutEffect(() => {
    const target = layout.target;
    if (!target) return;
    target.dataset.trainingTarget = "true";
    return () => {
      delete target.dataset.trainingTarget;
    };
  }, [layout.target]);

  useEffect(() => {
    if (error) setCollapsed(false);
  }, [error]);

  useEffect(() => {
    const pauseOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onResumeLater();
    };
    window.addEventListener("keydown", pauseOnEscape);
    return () => window.removeEventListener("keydown", pauseOnEscape);
  }, [onResumeLater]);

  const sheet = layout.placement === "sheet";
  if (sheet && collapsed) {
    return (
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="training-coach-title"
        data-placement="sheet"
        data-collapsed="true"
        className="fixed inset-x-0 bottom-0 z-[80] flex items-center justify-between gap-3 border-t border-cyan-400 bg-surface px-4 py-3 shadow-2xl"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
            Guided practice
          </p>
          <h2
            id="training-coach-title"
            ref={headingRef}
            tabIndex={-1}
            className="truncate font-semibold text-ink outline-none"
          >
            {layout.valid ? step.title : "Training needs an update"}
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCollapsed(false)}
          aria-label="Expand training coach"
        >
          Expand
        </Button>
      </div>
    );
  }
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="training-coach-title"
      data-placement={layout.placement}
      className={
        sheet
          ? "fixed inset-x-0 bottom-0 z-[80] max-h-[70dvh] overflow-y-auto border-t border-line bg-surface p-5 shadow-2xl"
          : "fixed z-[80] rounded-lg border border-line bg-surface p-5 shadow-2xl"
      }
      style={sheet ? undefined : layout.style}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500/10 text-brand-700 dark:text-brand-300">
          <Icon name={layout.valid ? "clipboard" : "alert"} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
            Guided practice
          </p>
          {error && (
            <p role="alert" className="mt-3 border-l-2 border-rose-500 pl-3 text-sm font-semibold text-rose-800 dark:text-rose-200">
              {error}
            </p>
          )}
          <h2
            id="training-coach-title"
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 font-display text-lg font-bold text-ink outline-none"
          >
            {layout.valid ? step.title : "Training needs an update"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {layout.valid
              ? step.instruction
              : "The highlighted control is missing or appears more than once."}
          </p>
        </div>
        {sheet && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(true)}
            aria-label="Minimize training coach"
          >
            Minimize
          </Button>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
        {onContinue && layout.valid && (
          <Button size="sm" iconRight="arrowRight" disabled={continueDisabled} onClick={onContinue}>
            {continueLabel}
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={!canGoBack} onClick={onBack}>
          Back
        </Button>
        <Button variant="ghost" size="sm" onClick={onResumeLater}>
          Resume later
        </Button>
        <Button variant="ghost" size="sm" onClick={onExit}>
          Exit training
        </Button>
      </div>
    </div>
  );
}
