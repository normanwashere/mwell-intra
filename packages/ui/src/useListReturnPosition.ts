"use client";
import { useEffect, useRef, type MouseEvent } from "react";

// Only offsets are retained per tab. No rows, search text, or draft values are stored.
function viewHash(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function useListReturnPosition(scope: string, view: string, ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `intra.list-return:${scope}:${viewHash(view)}`;
  const scrollElement = () => {
    let parent: HTMLElement | null = ref.current?.parentElement ?? null;
    while (parent) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
      parent = parent.parentElement;
    }
    return null;
  };
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as { top: number; at: number };
      if (!Number.isFinite(saved.top) || saved.top < 0 || !Number.isFinite(saved.at) || Date.now() - saved.at > 30 * 60_000) { sessionStorage.removeItem(key); return; }
      frame = requestAnimationFrame(() => {
        const parent = scrollElement();
        if (parent) parent.scrollTop = saved.top;
        else window.scrollTo({ top: saved.top, behavior: "instant" });
        try { sessionStorage.removeItem(key); } catch { /* Storage can become unavailable after capture. */ }
      });
    } catch { /* An unavailable checkpoint must never block navigation. */ }
    return () => cancelAnimationFrame(frame);
  }, [key, ready]);

  const remember = () => {
    try {
      sessionStorage.setItem(key, JSON.stringify({ top: scrollElement()?.scrollTop ?? window.scrollY, at: Date.now() }));
    } catch { /* Navigation works without browser storage. */ }
  };
  const onClickCapture = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (link && (!link.target || link.target === '_self') && !link.hasAttribute('download') && new URL(link.href).origin === window.location.origin) remember();
  };
  return { ref, remember, onClickCapture };
}
