"use client";

import Link from "next/link";
import { Icon } from "@intra/ui";

// Reading guidance is advisory. Only the learning service records readiness.
export function FirstTimeJourney({ onExploreRoles, onPractice, learningHref = "/onboarding" }: {
  userId: string;
  onExploreRoles: () => void;
  onPractice?: () => void;
  learningHref?: string;
}) {
  return (
    <section aria-label="Getting started" className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">New to Intra?</h2>
        <p className="mt-1 text-sm text-muted">Start with your assigned learning and the work your role performs.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost min-h-11 text-sm" onClick={onExploreRoles}>Explore role guides</button>
        {onPractice && <button type="button" className="btn-ghost min-h-11 text-sm" onClick={onPractice}>View a workflow</button>}
        <Link href={learningHref} className="btn-outline min-h-11 gap-2 text-sm">My learning<Icon name="arrowRight" className="h-4 w-4" /></Link>
      </div>
    </section>
  );
}
