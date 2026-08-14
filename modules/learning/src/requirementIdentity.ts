import type { RequirementDefinition } from "./types";

const normalizeTitle = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");

export function sharedCompletionKey(
  requirement: RequirementDefinition,
): string {
  if (requirement.kind === "orientation") {
    return `${requirement.audience}:orientation:${normalizeTitle(requirement.title)}`;
  }
  return `${requirement.id}:${requirement.version}`;
}

export function requirementsShareCompletion(
  left: RequirementDefinition,
  right: RequirementDefinition,
): boolean {
  return sharedCompletionKey(left) === sharedCompletionKey(right);
}
