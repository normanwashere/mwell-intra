import { capabilityKey } from "./catalog";
import { sharedCompletionKey } from "./requirementIdentity";
import type {
  Certification,
  CurriculumDefinition,
  LearningCapability,
  RequirementDefinition,
  RoleCurriculumDefinition,
} from "./types";

export interface RoleCurriculumInput {
  sourceRoleAssignmentId: string;
  departmentId: string;
  curriculum: RoleCurriculumDefinition;
}

interface ScopedCurriculumInputBase {
  sourceId: string;
  curriculum: CurriculumDefinition;
}

export type ScopedCurriculumInput =
  | (ScopedCurriculumInputBase & { source: "department" | "user" })
  | (ScopedCurriculumInputBase & {
      source: "retraining" | "corrective";
      sourceRoleAssignmentId: string;
    });

export type CapabilityLearningState =
  "certified" | "locked" | "expired" | "retraining_required";

export interface RoleCapabilityState {
  sourceRoleAssignmentId: string;
  departmentId: string;
  module: RoleCurriculumDefinition["module"];
  role: string;
  capability: LearningCapability;
  state: CapabilityLearningState;
  requirementIds: readonly string[];
}

export interface ResolveEffectiveCurriculumInput {
  requirements: readonly RequirementDefinition[];
  roleCurricula: readonly RoleCurriculumInput[];
  departmentAssignments: readonly ScopedCurriculumInput[];
  userAssignments: readonly ScopedCurriculumInput[];
  activeCertifications: readonly Certification[];
  now?: string;
}

export interface ResolvedEffectiveCurriculum {
  requirements: readonly RequirementDefinition[];
  capabilities: readonly RoleCapabilityState[];
}

const requirementKey = (requirement: RequirementDefinition): string =>
  `${requirement.id}:${requirement.version}`;

export function resolveEffectiveCurriculum(
  input: ResolveEffectiveCurriculumInput,
): ResolvedEffectiveCurriculum {
  const requirementById = new Map<string, RequirementDefinition>();
  for (const requirement of input.requirements) {
    const existing = requirementById.get(requirement.id);
    if (existing && existing.version !== requirement.version) {
      throw new Error(
        `Ambiguous learning requirement ${requirement.id} has multiple versions.`,
      );
    }
    requirementById.set(requirement.id, requirement);
  }
  const scopedAssignments = [
    ...input.departmentAssignments,
    ...input.userAssignments,
  ];
  const selectedRequirementIds = [
    ...input.roleCurricula.flatMap(
      ({ curriculum }) => curriculum.requirementIds,
    ),
    ...scopedAssignments.flatMap(({ curriculum }) => curriculum.requirementIds),
  ];
  const selectedRequirements = new Map<string, RequirementDefinition>();
  const selectedSharedKeys = new Set<string>();
  const visiting = new Set<string>();

  const addRequirement = (requirementId: string): void => {
    const requirement = requirementById.get(requirementId);
    if (!requirement) {
      throw new Error(`Unknown learning requirement ${requirementId}.`);
    }
    const key = requirementKey(requirement);
    if (selectedRequirements.has(key)) return;
    if (visiting.has(key)) {
      throw new Error(
        `Learning requirement prerequisite cycle at ${requirementId}.`,
      );
    }
    visiting.add(key);
    for (const prerequisiteId of requirement.prerequisiteIds) {
      addRequirement(prerequisiteId);
    }
    visiting.delete(key);
    const sharedKey = sharedCompletionKey(requirement);
    if (selectedSharedKeys.has(sharedKey)) return;
    selectedSharedKeys.add(sharedKey);
    selectedRequirements.set(key, requirement);
  };

  for (const requirementId of selectedRequirementIds) {
    addRequirement(requirementId);
  }

  const now = new Date(input.now ?? new Date().toISOString()).getTime();
  const retrainingCapabilityKeysByRole = new Map<string, Set<string>>();
  for (const assignment of scopedAssignments) {
    if (
      assignment.source !== "retraining" &&
      assignment.source !== "corrective"
    ) {
      continue;
    }
    const capabilityKeys =
      retrainingCapabilityKeysByRole.get(assignment.sourceRoleAssignmentId) ??
      new Set<string>();
    for (const requirementId of assignment.curriculum.requirementIds) {
      const requirement = requirementById.get(requirementId);
      if (!requirement) {
        throw new Error(`Unknown learning requirement ${requirementId}.`);
      }
      for (const capability of requirement.capabilityOutcomes) {
        capabilityKeys.add(capabilityKey(capability));
      }
    }
    retrainingCapabilityKeysByRole.set(
      assignment.sourceRoleAssignmentId,
      capabilityKeys,
    );
  }
  const capabilities = input.roleCurricula.flatMap((roleInput) => {
    const roleRequirements = roleInput.curriculum.requirementIds.map(
      (requirementId) => {
        const requirement = requirementById.get(requirementId);
        if (!requirement) {
          throw new Error(`Unknown learning requirement ${requirementId}.`);
        }
        return requirement;
      },
    );
    const outcomes = new Map<string, LearningCapability>();
    for (const requirement of roleRequirements) {
      for (const capability of requirement.capabilityOutcomes) {
        outcomes.set(capabilityKey(capability), capability);
      }
    }

    return [...outcomes.values()].map((capability) => {
      const matchingCertifications = input.activeCertifications.filter(
        (certification) =>
          certification.sourceRoleAssignmentId ===
            roleInput.sourceRoleAssignmentId &&
          capabilityKey(certification.capability) === capabilityKey(capability),
      );
      const activeCertification = matchingCertifications.find(
        (certification) =>
          !certification.revokedAt &&
          !certification.supersededAt &&
          new Date(certification.effectiveAt).getTime() <= now &&
          (!certification.expiresAt ||
            new Date(certification.expiresAt).getTime() > now),
      );
      const expiredCertification = matchingCertifications.find(
        (certification) =>
          !certification.revokedAt &&
          !certification.supersededAt &&
          new Date(certification.effectiveAt).getTime() <= now &&
          Boolean(
            certification.expiresAt &&
            new Date(certification.expiresAt).getTime() <= now,
          ),
      );
      const key = capabilityKey(capability);
      const retrainingCapabilityKeys = retrainingCapabilityKeysByRole.get(
        roleInput.sourceRoleAssignmentId,
      );
      return {
        sourceRoleAssignmentId: roleInput.sourceRoleAssignmentId,
        departmentId: roleInput.departmentId,
        module: roleInput.curriculum.module,
        role: roleInput.curriculum.role,
        capability,
        state: retrainingCapabilityKeys?.has(key)
          ? "retraining_required"
          : activeCertification
            ? "certified"
            : expiredCertification
              ? "expired"
              : "locked",
        requirementIds: roleRequirements
          .filter((requirement) =>
            requirement.capabilityOutcomes.some(
              (outcome) => capabilityKey(outcome) === capabilityKey(capability),
            ),
          )
          .map((requirement) => requirement.id),
      } satisfies RoleCapabilityState;
    });
  });

  return {
    requirements: [...selectedRequirements.values()],
    capabilities,
  };
}
