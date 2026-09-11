"use client";

import Link from "next/link.js";
import { useEffect, useId, useState } from "react";
import { Badge, Button, Icon, userFacingError } from "@intra/ui";
import type { Module } from "@intra/rbac";
import { useOptionalLearning } from "./LearningProvider";
import { sanitizeOnboardingReturnPath } from "./orientationGate";

const humanize = (value: string) =>
  value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

export type CapabilityLockReason = "role" | "training" | "unavailable";

export function LockedCapabilityRecovery({
  module,
  capability,
  reason,
  requirementIds = [],
}: {
  module: Module;
  capability: string;
  reason: CapabilityLockReason;
  requirementIds?: readonly string[];
}) {
  const learning = useOptionalLearning();
  const newTabHintId = useId();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [returnPath, setReturnPath] = useState<string | null>(null);
  useEffect(() => {
    setReturnPath(sanitizeOnboardingReturnPath(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    ));
  }, []);
  const requirements = learning?.snapshot?.curricula.flatMap((item) => item.requirements) ?? [];
  const titles = requirementIds.flatMap((id) => {
    const title = requirements.find((requirement) => requirement.id === id)?.title;
    return title ? [title] : [];
  });
  const title = reason === "role"
    ? "This action is not assigned to your role"
    : reason === "training"
      ? "Complete onboarding before this action"
      : "This action is temporarily unavailable";
  const audience = requirements.find((item) => item.id === requirementIds[0])?.audience;
  const learningPath = audience === "vendor" ? "/vendor/onboarding" : "/onboarding";
  const learningQuery = new URLSearchParams();
  if (requirementIds[0]) learningQuery.set("requirement", requirementIds[0]);
  if (returnPath) learningQuery.set("next", returnPath);

  return (
    <section role="status" className="border-l-4 border-amber-500 bg-amber-50/80 px-4 py-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <Icon name="lock" className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-bold">{title}</h3>
            <Badge tone="slate">{humanize(module)} | {humanize(capability)}</Badge>
          </div>
          <p className="mt-1 text-sm">
            {reason === "role"
              ? "Ask your department owner or platform administrator to review your assignment."
              : reason === "training"
                ? "Only this action needs the learning listed below. Your other authorized work remains available."
                : "Refresh your access status. If this continues, contact your department owner."}
          </p>
          {titles.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold">{titles.map((item) => <li key={item}>{item}</li>)}</ul>
          )}
          {reason === "training" && requirementIds[0] && (
            <div className="mt-4">
              <Link href={`${learningPath}?${learningQuery.toString()}`} target="_blank" rel="noopener noreferrer" className="btn-outline btn-sm inline-flex" aria-describedby={newTabHintId}>Resume onboarding</Link>
              <p id={newTabHintId} className="mt-2 text-sm">Opens in a new tab so your current form stays open. Return here when finished.</p>
            </div>
          )}
          {(reason === "unavailable" || reason === "training") && learning && (
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  setRefreshError(null);
                  try {
                    if (!(await learning.refreshAccess())) {
                      setRefreshError("Access could not be refreshed. Check your connection and try again.");
                    }
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                {refreshing ? "Refreshing access" : "Refresh access"}
              </Button>
              {refreshError && <p role="alert" className="mt-2 text-sm font-medium">{userFacingError(refreshError)}</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
