"use client";

import { useEffect, useState } from "react";
import { Icon } from "@intra/ui";
import { cx } from "@shell/lib/cx";

export interface BoundedLoadingStateProps {
  label: string;
  timeoutMs?: number;
  recoveryOwner?: string;
  className?: string;
}

export function BoundedLoadingState({
  label,
  timeoutMs = 8000,
  recoveryOwner = "Platform Support",
  className,
}: BoundedLoadingStateProps) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [timeoutMs]);

  if (timedOut) {
    return (
      <div
        className={cx("mx-auto max-w-md py-10 text-center", className)}
        role="alert"
      >
        <Icon name="alert" className="mx-auto h-6 w-6 text-amber-600" />
        <p className="mt-3 font-semibold text-ink">
          Loading is taking longer than expected
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">
          Recovery owner: {recoveryOwner}. Reload once. If loading remains
          blocked, send the page address and time to that owner.
        </p>
        <button
          type="button"
          className="btn-primary mt-4 min-h-11"
          onClick={() => window.location.reload()}
        >
          <Icon name="rotate" className="h-4 w-4" />
          Reload page
        </button>
      </div>
    );
  }

  return (
    <div
      className={cx("grid place-items-center py-10 text-muted", className)}
      role="status"
      aria-live="polite"
    >
      <Icon name="rotate" className="h-6 w-6 animate-spin" />
      <span className="mt-2 text-sm">{label}</span>
    </div>
  );
}
