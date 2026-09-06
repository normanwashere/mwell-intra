"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "@intra/auth";
import { Button, Sheet, TaskHelpProvider, type TaskHelpRequest } from "@intra/ui";

interface HelpGuide {
  title: string;
  purpose: string;
  controls: { name: string; behavior: string; validation: string; result: string }[];
  exceptions: string[];
  completionEvidence: string[];
}

function parseGuide(value: unknown): HelpGuide | null {
  if (!value || typeof value !== "object") return null;
  const guide = value as Partial<HelpGuide>;
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === "string");
  if (typeof guide.title !== "string" || typeof guide.purpose !== "string" || !strings(guide.exceptions) || !strings(guide.completionEvidence) || !Array.isArray(guide.controls)) return null;
  if (!guide.controls.every((item) => item && [item.name, item.behavior, item.validation, item.result].every((text) => typeof text === "string"))) return null;
  return guide as HelpGuide;
}

export function ContextualTaskHelp({ children }: { children: ReactNode }) {
  const { profile, userRoles } = useSession();
  const principal = JSON.stringify([profile?.id, profile?.kind, userRoles]);
  const [request, setRequest] = useState<(TaskHelpRequest & { principal: string }) | null>(null);
  const [guide, setGuide] = useState<HelpGuide | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [wide, setWide] = useState(false);
  const launcher = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const active = request?.principal === principal ? request : null;
  const closeHelp = useCallback(() => {
    setRequest(null);
    requestAnimationFrame(() => {
      if (launcher.current?.isConnected) launcher.current.focus();
    });
  }, []);
  const openHelp = useCallback((next: TaskHelpRequest, origin?: HTMLElement) => {
    launcher.current = origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setGuide(null);
    setLoading(true);
    setRequest({ ...next, principal });
  }, [principal]);
  const controller = useMemo(() => ({ openHelp, closeHelp }), [openHelp, closeHelp]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1600px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    let current = true;
    setLoading(true);
    setGuide(null);
    const timeout = window.setTimeout(() => abort.abort(), 10_000);
    void fetch(`/api/knowledge/context?article=${encodeURIComponent(active.articleId)}`, {
      signal: abort.signal, cache: "no-store", credentials: "same-origin",
    }).then(async (response) => {
      if (!response.ok) throw new Error("Help unavailable");
      const body = await response.json() as { guide?: unknown };
      if (current) setGuide(parseGuide(body.guide));
    }).catch(() => {
      if (current) setGuide(null);
    }).finally(() => {
      window.clearTimeout(timeout);
      if (current) setLoading(false);
    });
    return () => { current = false; abort.abort(); window.clearTimeout(timeout); };
  }, [active, attempt]);

  useEffect(() => {
    if (!active || !wide) return;
    heading.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="dialog"][aria-modal="true"]')) closeHelp();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [active, wide, closeHelp]);

  const body = <div className="space-y-5">
    {loading ? <p role="status">Loading task help</p> : guide ? <>
      <p>{guide.purpose}</p>
      <ol className="space-y-4">{guide.controls.map((control, index) => <li key={index}>
        <h3 className="font-semibold">{control.name}</h3>
        <p>{control.behavior}</p><p>{control.validation}</p><p>{control.result}</p>
      </li>)}</ol>
      {guide.exceptions.length > 0 && <section><h3 className="font-semibold">Exceptions</h3><ul>{guide.exceptions.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
      {guide.completionEvidence.length > 0 && <section><h3 className="font-semibold">Completion evidence</h3><ul>{guide.completionEvidence.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    </> : <div role="status"><p>Task help is unavailable. Your work remains open.</p><Button className="mt-3 min-h-11" onClick={() => setAttempt((value) => value + 1)}>Retry help</Button></div>}
    <a className="inline-flex min-h-11 items-center text-brand-700 underline" href={`/knowledge?article=${encodeURIComponent(active?.articleId ?? "")}`} target="_blank" rel="noopener noreferrer">Open full guide in a new tab</a>
  </div>;

  return <TaskHelpProvider controller={controller}>
    <div className={active && wide ? "min-w-0 pr-[24rem]" : "min-w-0"}>{children}</div>
    {active && wide && <aside aria-label="Task help" className="fixed inset-y-0 right-0 z-40 w-96 overflow-y-auto border-l border-line bg-surface p-5 text-sm text-ink">
      <div className="mb-5 flex items-start justify-between gap-3"><h2 ref={heading} tabIndex={-1} className="text-lg font-semibold">{guide?.title ?? active.title ?? "Task help"}</h2><Button aria-label="Close task help" icon="x" className="min-h-11 min-w-11" onClick={closeHelp} /></div>
      {body}
    </aside>}
    <Sheet open={Boolean(active) && !wide} onOpenChange={(open) => { if (!open) closeHelp(); }} title={guide?.title ?? active?.title ?? "Task help"} description="Guidance for your current work" side="right">{body}</Sheet>
  </TaskHelpProvider>;
}
