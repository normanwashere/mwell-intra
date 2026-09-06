"use client";

import * as React from "react";

export interface GuideOutlineItem {
  id: string;
  label: string;
}

export function GuideOutline({ items }: { items: GuideOutlineItem[] }) {
  const goTo = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    for (let ancestor: HTMLElement | null = target; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    }
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${encodeURIComponent(id)}`);
  };

  return (
    <>
      <label className="block text-xs font-semibold text-muted lg:hidden">
        Jump to section
        <select
          className="input-base mt-1 min-h-12 w-full text-sm"
          defaultValue=""
          onChange={(event) => event.target.value && goTo(event.target.value)}
        >
          <option value="" disabled>Select a section</option>
          {items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <nav aria-label="On this page" className="sticky top-24 hidden border-l border-line pl-4 lg:block">
        <p className="text-xs font-semibold uppercase text-faint">On this page</p>
        <ol className="mt-3 space-y-1">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => goTo(item.id)}
                className="min-h-11 w-full text-left text-sm text-muted hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <span className="mr-2 text-xs text-faint">{index + 1}</span>{item.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
