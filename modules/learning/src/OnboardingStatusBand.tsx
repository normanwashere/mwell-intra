"use client";

import Link from "next/link.js";
import { useSession } from "@intra/auth";
import { Button, Icon } from "@intra/ui";
import { useLearning } from "./LearningProvider";
import { OnboardingProgress } from "./OnboardingProgress";
import {
  sharedCompletionKey,
  requirementProgress,
} from "./requirementIdentity";

const DONE_STATES = new Set(["passed", "waived"]);
const BLOCKED_STATES = new Set(["needs_support", "expired"]);
const LEARNING_LOCK_REASONS = new Set([
  "missing_certification",
  "expired_certification",
  "retraining_required",
]);

export function OnboardingStatusBand() {
  const { profile } = useSession();
  const { snapshot, loading, stale, error, refresh } = useLearning();

  if (loading && !snapshot) {
    return (
      <section
        aria-label="Role readiness"
        className="flex min-h-24 items-center gap-3 border-y border-line py-4"
      >
        <Icon name="rotate" className="h-5 w-5 animate-spin text-brand-600" />
        <div>
          <p className="font-semibold text-ink">Checking role readiness</p>
          <p className="text-sm text-muted">
            Confirming your assigned learning and access.
          </p>
        </div>
      </section>
    );
  }

  if (!snapshot || stale || error || !profile) {
    return (
      <section
        role="alert"
        aria-label="Role readiness"
        className="flex min-h-24 flex-col gap-3 border-y border-rose-300 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-rose-800"
      >
        <div>
          <p className="font-semibold text-ink">Role readiness unavailable</p>
          <p className="text-sm text-muted">
            {error ??
              "Current learning and action readiness could not be confirmed. Refresh before relying on this status."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          icon="rotate"
          onClick={() => void refresh()}
        >
          Retry
        </Button>
      </section>
    );
  }

  const requirements = new Map(
    snapshot.curricula
      .filter(
        (effective) =>
          effective.curriculum.audience ===
          (profile.kind === "vendor" ? "vendor" : "internal"),
      )
      .flatMap((effective) =>
        effective.requirements
          .filter(
            (requirement) =>
              requirement.audience === effective.curriculum.audience,
          )
          .map(
            (requirement) =>
              [sharedCompletionKey(requirement), requirement] as const,
          ),
      ),
  );
  const progressFor = (item: Parameters<typeof requirementProgress>[0]) =>
    requirementProgress(item, snapshot?.progress ?? []);
  const required = [...requirements.values()].filter((item) => item.mandatory);
  const completed = required.filter((item) =>
    DONE_STATES.has(progressFor(item)?.state ?? ""),
  ).length;
  const next = required.find((item) => {
    const state = progressFor(item)?.state ?? "not_started";
    return !DONE_STATES.has(state) && !BLOCKED_STATES.has(state);
  });
  const pendingActions = new Set(
    snapshot.lockedCapabilities
      .filter((lock) => LEARNING_LOCK_REASONS.has(lock.reason))
      .map((lock) =>
        JSON.stringify([lock.capability.module, lock.capability.capability]),
      ),
  ).size;

  return (
    <section
      aria-label="Role readiness"
      className="grid gap-4 border-y border-line py-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,1fr)_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
            Action readiness
          </p>
          {stale && (
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              Status unavailable
            </span>
          )}
        </div>
        <p className="mt-1 font-semibold text-ink">
          {next?.title ??
            (required.length === 0
              ? "No required learning assigned"
              : completed === required.length
                ? "Required learning complete"
                : "Learning needs attention")}
        </p>
        <p className="mt-1 text-sm text-muted">
          {pendingActions
            ? `${pendingActions} ${pendingActions === 1 ? "action needs" : "actions need"} learning. Other authorized work remains available.`
            : "No actions are waiting on learning. Existing permissions still apply."}
        </p>
      </div>
      <OnboardingProgress completed={completed} total={required.length} />
      <Link
        href={profile?.kind === "vendor" ? "/vendor/onboarding" : "/onboarding"}
        className="btn-outline btn-sm inline-flex justify-center"
      >
        {next ? "Continue onboarding" : "View onboarding"}
      </Link>
    </section>
  );
}
