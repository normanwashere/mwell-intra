"use client";

import * as React from "react";
import { Icon } from "@intra/ui";
import { useKnowledgePreferences } from "@shell/lib/knowledge/preferences";

export function PersonalLibrary({
  userId,
  onOpenHref,
}: {
  userId: string;
  onOpenHref: (href: string) => void;
}) {
  const { preferences, toggleSaved } = useKnowledgePreferences(userId);
  const saved = preferences.recent.filter((item) => preferences.savedIds.includes(item.id));
  const recent = preferences.recent.filter((item) => !preferences.savedIds.includes(item.id)).slice(0, 4);
  if (saved.length === 0 && recent.length === 0) return null;

  return (
    <section aria-label="Your Knowledge Base library" className="border-t border-line pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-brand-700">Pick up where you left off</p>
          <h2 className="mt-1 text-xl font-bold text-ink">Your library</h2>
        </div>
        <span className="text-xs text-faint">Saved on this device</span>
      </div>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <LibraryList title="Saved guides" items={saved} empty="Save a guide to keep it here." onOpenHref={onOpenHref} onRemove={toggleSaved} />
        <LibraryList title="Recently viewed" items={recent} empty="Guides you open will appear here." onOpenHref={onOpenHref} />
      </div>
    </section>
  );
}

function LibraryList({
  title,
  items,
  empty,
  onOpenHref,
  onRemove,
}: {
  title: string;
  items: Array<{ id: string; title: string; href: string; context: string }>;
  empty: string;
  onOpenHref: (href: string) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="font-semibold text-ink">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <div className="mt-2 divide-y divide-line border-y border-line">
          {items.map((item) => (
            <div key={item.id} className="flex min-h-14 items-center gap-2 py-2">
              <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" onClick={() => onOpenHref(item.href)}>
                <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
                <span className="block text-xs text-muted">{item.context}</span>
              </button>
              {onRemove && (
                <button type="button" className="icon-btn h-11 w-11" aria-label={`Remove ${item.title} from saved guides`} onClick={() => onRemove(item.id)}>
                  <Icon name="x" className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
