import * as React from "react";
import type { GlossaryEntry } from "@shell/lib/knowledge/types";

export function GlossaryTerms({
  entries,
  text,
}: {
  entries: GlossaryEntry[];
  text: string;
}) {
  const normalized = text.toLowerCase();
  const relevant = entries
    .filter((entry) =>
      [entry.term, ...entry.aliases].some((term) =>
        normalized.includes(term.toLowerCase()),
      ),
    )
    .slice(0, 8);
  if (relevant.length === 0) return null;

  return (
    <details className="mt-5 border-y border-line py-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        Plain-language terms used in this guide ({relevant.length})
      </summary>
      <dl className="grid gap-4 pb-3 pt-2 sm:grid-cols-2">
        {relevant.map((entry) => (
          <div key={entry.term}>
            <dt className="font-semibold text-ink">
              <abbr title={entry.definition} className="cursor-help no-underline">
                {entry.term}
              </abbr>
            </dt>
            <dd className="mt-1 text-sm leading-6 text-muted">{entry.definition}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
