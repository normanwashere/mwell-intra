import {
  sharedCompletionKey,
  requirementProgress,
} from "./requirementIdentity";
import { REQUIREMENT_PROGRESS_STATES } from "./types";
import type {
  LearningCapability,
  LearningSnapshot,
  RequirementDefinition,
} from "./types";

export interface SelectedLearningTask {
  id: string;
  title: string;
  outcome: string;
  actionCapabilities: readonly LearningCapability[];
}

export interface TaskLearningProjection {
  status: "known" | "unavailable";
  neededNow: readonly RequirementDefinition[];
  otherRequired: readonly RequirementDefinition[];
  optional: readonly RequirementDefinition[];
}

const capabilityKey = (item: LearningCapability) =>
  JSON.stringify([item.module, item.capability]);
const done = new Set(["passed", "waived"]);
const learningReasons = new Set([
  "missing_certification",
  "expired_certification",
  "retraining_required",
]);

/** Presentation only. Absence of learning blockers never establishes action authority. */
export function projectTaskLearning(
  snapshot: LearningSnapshot | null,
  audience: "internal" | "vendor",
  capabilities: readonly LearningCapability[],
  stale: boolean,
): TaskLearningProjection {
  const unavailable: TaskLearningProjection = {
    status: "unavailable",
    neededNow: [],
    otherRequired: [],
    optional: [],
  };
  if (!snapshot || stale) return unavailable;
  const definitions = new Map<string, RequirementDefinition>();
  for (const effective of snapshot.curricula) {
    if (effective.curriculum.audience !== audience) continue;
    for (const item of effective.requirements) {
      if (item.audience !== audience) return unavailable;
      definitions.set(sharedCompletionKey(item), item);
    }
  }
  const all = [...definitions.values()];
  const byId = new Map<string, RequirementDefinition[]>();
  for (const item of all)
    byId.set(item.id, [...(byId.get(item.id) ?? []), item]);
  const selected = new Set(capabilities.map(capabilityKey));
  const roots = new Set<RequirementDefinition>();
  const forced = new Set<string>();
  for (const capability of selected) {
    const matching = all.filter((item) =>
      item.capabilityOutcomes.some(
        (outcome) => capabilityKey(outcome) === capability,
      ),
    );
    const locks = snapshot.lockedCapabilities.filter(
      (lock) => capabilityKey(lock.capability) === capability,
    );
    if (!matching.length && !locks.length) {
      const action = capabilities.find(
        (item) => capabilityKey(item) === capability,
      )!;
      const classification = capabilityClassificationFor(
        action.module,
        action.capability,
      );
      if (!classification || classification.access === "mutation")
        return unavailable;
    }
    for (const item of matching) roots.add(item);
    for (const lock of locks) {
      if (!learningReasons.has(lock.reason) || !lock.requirementIds.length)
        return unavailable;
      for (const id of lock.requirementIds) {
        const candidates = byId.get(id);
        if (candidates?.length !== 1) return unavailable;
        roots.add(candidates[0]!);
        forced.add(sharedCompletionKey(candidates[0]!));
      }
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: RequirementDefinition[] = [];
  const visit = (item: RequirementDefinition): boolean => {
    const key = sharedCompletionKey(item);
    if (visiting.has(key)) return false;
    if (visited.has(key)) return true;
    // IDs alone cannot resolve competing versions or obligations safely.
    if (byId.get(item.id)?.length !== 1) return false;
    if (
      snapshot.curricula.some(
        (effective) =>
          effective.curriculum.audience !== audience &&
          effective.requirements.some(
            (other) => other.id === item.id && other.version === item.version,
          ),
      )
    )
      return false;
    const progress = requirementProgress(item, snapshot.progress);
    if (!progress || !REQUIREMENT_PROGRESS_STATES.includes(progress.state))
      return false;
    if (done.has(progress.state) && forced.has(key)) return false;
    visiting.add(key);
    for (const id of item.prerequisiteIds) {
      const candidates = byId.get(id);
      if (candidates?.length !== 1 || !visit(candidates[0]!)) return false;
    }
    visiting.delete(key);
    visited.add(key);
    if (!done.has(progress.state) || forced.has(key)) ordered.push(item);
    return true;
  };
  for (const root of roots) if (!visit(root)) return unavailable;
  const neededKeys = new Set(ordered.map(sharedCompletionKey));
  return {
    status: "known",
    neededNow: ordered,
    otherRequired: all.filter(
      (item) => item.mandatory && !neededKeys.has(sharedCompletionKey(item)),
    ),
    optional: all.filter(
      (item) => !item.mandatory && !neededKeys.has(sharedCompletionKey(item)),
    ),
  };
}
import { capabilityClassificationFor } from "@intra/rbac";
