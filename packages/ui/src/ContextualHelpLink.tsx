"use client";

import { Icon } from "./Icon";
import { useTaskHelp } from "./TaskHelpContext";

export function ContextualHelpLink({
  articleId,
  title,
  className = "",
}: {
  articleId: string;
  title: string;
  className?: string;
}) {
  const label = `Help for ${title}`;
  const help = useTaskHelp();
  return (
    <a
      href={`/knowledge?article=${encodeURIComponent(articleId)}`}
      aria-label={label}
      title={label}
      onClick={(event) => {
        if (!help || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        // Keep normal navigation when another modal owns focus.
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        event.preventDefault();
        help.openHelp({ articleId, title }, event.currentTarget);
      }}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${className}`}
    >
      <Icon name="info" className="h-5 w-5" />
    </a>
  );
}
