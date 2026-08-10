"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Icon } from "@intra/ui";
import { useSession } from "@intra/auth";
import {
  useKnowledgePreferences,
  type KnowledgeFeedback,
} from "@shell/lib/knowledge/preferences";

export function KnowledgePageTools({
  userId,
  item,
}: {
  userId: string;
  item: {
    id: string;
    title: string;
    href: string;
    context: string;
    owner?: string;
  };
}) {
  const { mode, supabaseClient } = useSession();
  const { preferences, toggleSaved, recordViewed, setFeedback } =
    useKnowledgePreferences(userId);
  const [message, setMessage] = useState("");
  const saved = preferences.savedIds.includes(item.id);
  const selectedFeedback = preferences.feedback[item.id];

  useEffect(() => {
    recordViewed(item);
  }, [item.id, item.title, item.href, item.context, recordViewed]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(
      new URL(item.href, window.location.origin).toString(),
    );
    setMessage("Guide link copied.");
  };

  const chooseFeedback = async (feedback: KnowledgeFeedback) => {
    setFeedback(item.id, feedback);
    if (mode === "supabase" && supabaseClient) {
      const { error } = await supabaseClient
        .schema("core")
        .from("knowledge_feedback")
        .upsert(
          {
            user_id: userId,
            content_id: item.id,
            content_title: item.title,
            content_type: item.context,
            content_owner: item.owner ?? null,
            feedback,
            page_url: item.href,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,content_id" },
        );
      if (error) {
        setMessage(
          "Feedback could not be submitted. Try again or contact the guide owner.",
        );
        return;
      }
    }
    setMessage(
      feedback === "outdated"
        ? "Outdated screen report recorded."
        : "Feedback recorded. Thank you.",
    );
  };

  return (
    <aside
      aria-label="Knowledge guide tools"
      className="relative z-20 mx-auto mb-2 flex max-w-6xl justify-end"
    >
      <details className="group relative">
        <summary className="btn-ghost btn-sm min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <Icon name="dots" className="h-4 w-4" />
          Guide actions
          <Icon
            name="chevron"
            className="h-4 w-4 rotate-90 transition group-open:-rotate-90"
          />
        </summary>
        <div className="absolute right-0 top-full mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-3 shadow-e2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn-ghost btn-sm min-h-11 justify-start"
              onClick={() => toggleSaved(item.id)}
              aria-pressed={saved}
              aria-label={saved ? "Remove saved guide" : "Save guide"}
            >
              <Icon name="pin" className="h-4 w-4" />
              {saved ? "Saved" : "Save"}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm min-h-11 justify-start"
              onClick={copyLink}
            >
              <Icon name="arrowRight" className="h-4 w-4" />
              Copy link
            </button>
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-xs font-semibold text-muted">
              Was this guide useful?
            </p>
            <div className="mt-2 grid gap-1">
              {(
                [
                  ["helpful", "Helpful", "check"],
                  ["needs_improvement", "Needs improvement", "edit"],
                  ["outdated", "Screenshot outdated", "camera"],
                ] as const
              ).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  className={`btn-ghost btn-sm min-h-11 justify-start ${selectedFeedback === value ? "bg-brand-50 text-brand-700" : ""}`}
                  aria-pressed={selectedFeedback === value}
                  onClick={() => void chooseFeedback(value)}
                >
                  <Icon name={icon} className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          {message && (
            <p
              className="mt-3 border-t border-line pt-3 text-xs text-muted"
              role="status"
              aria-live="polite"
            >
              {message}
            </p>
          )}
        </div>
      </details>
    </aside>
  );
}
