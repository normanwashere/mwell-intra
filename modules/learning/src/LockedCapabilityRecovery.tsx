"use client";

import Link from "next/link";
import { Badge, Icon } from "@intra/ui";
import type { Module } from "@intra/rbac";
import { useOptionalLearning } from "./LearningProvider";

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
                ? "Finish the required learning step, then return here to continue."
                : "Refresh your access status. If this continues, contact your department owner."}
          </p>
          {titles.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold">{titles.map((item) => <li key={item}>{item}</li>)}</ul>
          )}
          {reason === "training" && requirementIds[0] && (
            <Link href={`/onboarding?requirement=${encodeURIComponent(requirementIds[0])}`} className="btn-outline btn-sm mt-4 inline-flex">Resume onboarding</Link>
          )}
        </div>
      </div>
    </section>
  );
}
