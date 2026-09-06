import type { RequirementDefinition, RequirementProgress } from "./types";

export function sharedCompletionKey(
  requirement: RequirementDefinition,
): string {
  // Titles and shared training content are not authority to transfer credit.
  return JSON.stringify([
    requirement.audience,
    requirement.id,
    requirement.version,
    requirement.kind,
    requirement.capabilityOutcomes,
    requirement.prerequisiteIds,
    requirement.mandatory,
    requirement.simulationId,
    requirement.passingScore,
    requirement.maxAttempts,
  ]);
}

export function requirementProgress(
  requirement: RequirementDefinition,
  progress: readonly RequirementProgress[],
): RequirementProgress | undefined {
  const matches = progress.filter(
    (item) =>
      item.requirementId === requirement.id &&
      item.requirementVersion === requirement.version,
  );
  // A completed assignment must not hide another outstanding assignment.
  return (
    matches.find((item) => !["passed", "waived"].includes(item.state)) ??
    matches[0]
  );
}

export function requirementsShareCompletion(
  left: RequirementDefinition,
  right: RequirementDefinition,
): boolean {
  return sharedCompletionKey(left) === sharedCompletionKey(right);
}
