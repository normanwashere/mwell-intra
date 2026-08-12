import type { CapabilityFor, Module } from "@intra/rbac";

export interface LearningCapability<M extends Module = Module> {
  module: M;
  capability: string;
}

export type RequirementKind =
  "orientation" | "policy" | "tour" | "scenario" | "assessment" | "attestation";

export interface RequirementDefinition {
  id: string;
  version: number;
  audience: "internal" | "vendor";
  kind: RequirementKind;
  title: string;
  mandatory: boolean;
  prerequisiteIds: readonly string[];
  capabilityOutcomes: readonly LearningCapability[];
  simulationId?: string;
  passingScore?: number;
  maxAttempts?: number;
}

export interface CurriculumDefinition {
  id: string;
  version: number;
  personaId: string;
  audience: "internal" | "vendor";
  requirementIds: readonly string[];
}

export interface RoleCurriculumDefinition extends CurriculumDefinition {
  module: Module;
  role: string;
}

export interface SimulationDefinition {
  id: string;
  version: number;
  audience: "internal" | "vendor";
  module: Module;
  title: string;
  checkpointIds: readonly string[];
  capabilityOutcomes: readonly LearningCapability[];
}

export interface EffectiveCurriculum {
  curriculum: CurriculumDefinition;
  requirements: readonly RequirementDefinition[];
  source: "role" | "department" | "assignment";
}

export const REQUIREMENT_PROGRESS_STATES = [
  "not_started",
  "in_progress",
  "passed",
  "failed_retryable",
  "needs_support",
  "expired",
  "waived",
] as const;

export type RequirementProgressState =
  (typeof REQUIREMENT_PROGRESS_STATES)[number];

export type LearningAttemptMode =
  "tour" | "scenario" | "assessment" | "attestation";

export interface ActiveLearningAttempt {
  id: string;
  attemptNumber: number;
  mode: LearningAttemptMode;
  startedAt: string;
}

export interface RequirementProgress {
  assignmentRequirementId: string;
  requirementId: string;
  requirementVersion: number;
  state: RequirementProgressState;
  attemptCount: number;
  activeAttempt?: ActiveLearningAttempt;
  completedAt?: string;
  updatedAt: string;
}

export interface StartRequirementResult {
  progress: RequirementProgress;
  attempt?: ActiveLearningAttempt;
}

export interface SimulationCheckpointInput {
  assignmentRequirementId: string;
  attemptId: string;
  simulationId: string;
  checkpointId: string;
  outcomeId?: string;
  idempotencyKey?: string;
}

export interface AssessmentSubmission {
  assignmentRequirementId: string;
  attemptId: string;
  answers: readonly { questionId: string; answerId: string }[];
  idempotencyKey?: string;
}

export interface StartRequirementInput {
  assignmentRequirementId: string;
  idempotencyKey?: string;
}

export interface PolicyAcknowledgmentInput {
  assignmentRequirementId: string;
  controlledDocumentId: string;
  controlledDocumentVersion: string;
  evidenceHash: string;
  idempotencyKey?: string;
}

export interface SupportRequestInput {
  assignmentRequirementId: string;
  reason: string;
  idempotencyKey?: string;
}

export interface AssessmentResult {
  assignmentRequirementId: string;
  passed: boolean;
  score: number;
  attemptNumber: number;
  state: RequirementProgressState;
  completedAt?: string;
}

export interface Certification {
  id: string;
  userId: string;
  departmentId: string;
  sourceRoleAssignmentId: string;
  capability: LearningCapability;
  curriculumId: string;
  curriculumVersion: number;
  requirementIds: readonly string[];
  issuedAt: string;
  effectiveAt: string;
  expiresAt?: string;
  revokedAt?: string;
  supersededAt?: string;
  issuedBy: string;
  policyVersion?: string;
}

export interface LockedCapability {
  capability: LearningCapability;
  reason:
    "missing_certification" | "expired_certification" | "retraining_required";
  requirementIds: readonly string[];
  canRequestEmergencyException: boolean;
}

export interface LearningSnapshot {
  curricula: readonly EffectiveCurriculum[];
  progress: readonly RequirementProgress[];
  certifications: readonly Certification[];
  lockedCapabilities: readonly LockedCapability[];
  refreshedAt: string;
}

export type CapabilityForLearning<M extends Module> = LearningCapability<M> & {
  capability: CapabilityFor<M>;
};
