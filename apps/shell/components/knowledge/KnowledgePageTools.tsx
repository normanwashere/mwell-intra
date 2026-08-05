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
  item: { id: string; title: string; href: string; context: string; owner?: string };
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
    await navigator.clipboard.writeText(new URL(item.href, window.location.origin).toString());
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
        setMessage("Feedback could not be submitted. Try again or contact the guide owner.");
        return;
      }
    }
    setMessage(feedback === "outdated" ? "Outdated screen report recorded." : "Feedback recorded. Thank you.");
  };

  return (
    <aside
      aria-label="Knowledge guide tools"
      className="mx-auto mb-4 flex min-w-0 max-w-5xl flex-wrap items-center gap-2 border-y border-line py-3"
    >
      <button
        type="button"
        className="btn-ghost btn-sm h-12 min-w-12 justify-center"
        onClick={() => toggleSaved(item.id)}
        aria-pressed={saved}
        aria-label={saved ? "Remove saved guide" : "Save guide"}
      >
        <Icon name="pin" className="h-4 w-4" />
        {saved ? "Saved" : "Save"}
      </button>
      <button type="button" className="btn-ghost btn-sm h-12 min-w-12 justify-center" onClick={copyLink}>
        <Icon name="arrowRight" className="h-4 w-4" />
        Copy link
      </button>
      <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
      <span className="text-xs font-semibold text-muted">Was this useful?</span>
      {([
        ["helpful", "Helpful", "check"],
        ["needs_improvement", "Needs improvement", "edit"],
        ["outdated", "Screenshot outdated", "camera"],
      ] as const).map(([value, label, icon]) => (
        <button
          key={value}
          type="button"
          className={`btn-ghost btn-sm h-12 min-w-12 justify-center ${selectedFeedback === value ? "bg-brand-50 text-brand-700" : ""}`}
          aria-pressed={selectedFeedback === value}
          onClick={() => void chooseFeedback(value)}
        >
          <Icon name={icon} className="h-4 w-4" />
          {label}
        </button>
      ))}
      <span className="sr-only" role="status" aria-live="polite">
        {message}
      </span>
    </aside>
  );
}
