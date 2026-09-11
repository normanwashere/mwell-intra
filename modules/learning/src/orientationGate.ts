import { sharedCompletionKey } from "./requirementIdentity";
import type { LearningSnapshot, RequirementDefinition } from "./types";

const COMPLETE_STATES = new Set(["passed", "waived"]);

export interface RoleOrientationState {
  readonly required: boolean;
  readonly complete: boolean;
  readonly completed: number;
  readonly total: number;
  readonly pendingRequirementIds: readonly string[];
}

/**
 * Summarizes orientation progress; it does not block workspace navigation.
 * Policy, assessment, and scenario requirements govern their associated actions.
 */
export function roleOrientationState(
  snapshot: LearningSnapshot | null,
): RoleOrientationState {
  if (!snapshot) {
    return {
      required: false,
      complete: false,
      completed: 0,
      total: 0,
      pendingRequirementIds: [],
    };
  }

  const requirements = new Map<string, RequirementDefinition>();
  for (const effective of snapshot.curricula) {
    if (effective.curriculum.audience !== "internal") continue;
    for (const requirement of effective.requirements) {
      if (requirement.kind !== "orientation" || !requirement.mandatory)
        continue;
      requirements.set(sharedCompletionKey(requirement), requirement);
    }
  }

  const progress = new Map(
    snapshot.progress.map((item) => [item.requirementId, item.state]),
  );
  const pendingRequirementIds: string[] = [];
  let completed = 0;
  for (const requirement of requirements.values()) {
    if (COMPLETE_STATES.has(progress.get(requirement.id) ?? "")) completed += 1;
    else pendingRequirementIds.push(requirement.id);
  }

  const total = requirements.size;
  return {
    required: total > 0,
    complete: total > 0 && completed === total,
    completed,
    total,
    pendingRequirementIds,
  };
}

export function sanitizeOnboardingReturnPath(
  value: string | null,
): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex -- Reject control characters in return destinations.
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    // eslint-disable-next-line no-control-regex -- Reject percent-encoded controls as well.
    if (decoded.startsWith("//") || decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded)) return null;
    const base = "https://intra.invalid";
    const destination = new URL(value, base);
    if (destination.origin !== base) return null;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}
