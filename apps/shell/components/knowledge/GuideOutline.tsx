"use client";

import * as React from "react";

export interface GuideOutlineItem {
  id: string;
  label: string;
}

export function GuideOutline({ items }: { items: GuideOutlineItem[] }) {
  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
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
                className="min-h-9 w-full text-left text-sm text-muted hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
