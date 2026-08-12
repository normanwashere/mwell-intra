import type {
  AssessmentResult,
  AssessmentSubmission,
  Certification,
  LearningSnapshot,
  RequirementDefinition,
  RequirementProgress,
  SimulationCheckpointInput,
  SimulationDefinition,
} from "./types";

export interface LearningRepository {
  snapshot(): Promise<LearningSnapshot>;
  resolveAssignments(): Promise<LearningSnapshot>;
  startRequirement(requirementVersionId: string): Promise<RequirementProgress>;
  checkpoint(input: SimulationCheckpointInput): Promise<RequirementProgress>;
  submitAssessment(input: AssessmentSubmission): Promise<AssessmentResult>;
  acknowledgePolicy(
    requirementVersionId: string,
    evidenceHash: string,
  ): Promise<void>;
  requestSupport(
    assignmentRequirementId: string,
    reason: string,
  ): Promise<void>;
  refreshCertifications(): Promise<readonly Certification[]>;
}

interface RpcResult {
  data: unknown;
  error: unknown;
}

interface LearningSchemaClient {
  rpc(
    name: string,
    parameters?: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

export interface LearningRpcClient {
  schema(name: string): LearningSchemaClient;
}

const forbiddenLearnerFields = new Set([
  "answerkey",
  "certificationstatus",
  "passed",
  "score",
]);

function assertLearnerSafe(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertLearnerSafe(item);
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.replaceAll("_", "").toLowerCase();
    if (forbiddenLearnerFields.has(normalizedKey)) {
      throw new Error(`Learner input contains authoritative field ${key}.`);
    }
    assertLearnerSafe(nestedValue);
  }
}

const messageForRpcError = (error: unknown): string => {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Learning service request failed.";
};

export class SupabaseLearningRepository implements LearningRepository {
  private readonly learning: LearningSchemaClient;

  constructor(client: LearningRpcClient) {
    this.learning = client.schema("learning");
  }

  private async rpc<T>(
    name: string,
    parameters?: Record<string, unknown>,
  ): Promise<T> {
    assertLearnerSafe(parameters);
    const result = parameters
      ? await this.learning.rpc(name, parameters)
      : await this.learning.rpc(name);
    if (result.error) throw new Error(messageForRpcError(result.error));
    return result.data as T;
  }

  snapshot(): Promise<LearningSnapshot> {
    return this.rpc<LearningSnapshot>("my_learning_snapshot");
  }

  resolveAssignments(): Promise<LearningSnapshot> {
    return this.rpc<LearningSnapshot>("resolve_assignments");
  }

  startRequirement(
    requirementVersionId: string,
  ): Promise<RequirementProgress> {
    return this.rpc<RequirementProgress>("start_requirement", {
      requirement_version_id: requirementVersionId,
    });
  }

  async checkpoint(
    input: SimulationCheckpointInput,
  ): Promise<RequirementProgress> {
    assertLearnerSafe(input);
    return await this.rpc<RequirementProgress>("record_simulation_checkpoint", {
      assignment_requirement_id: input.assignmentRequirementId,
      simulation_id: input.simulationId,
      checkpoint_id: input.checkpointId,
      completed_at: input.completedAt,
    });
  }

  async submitAssessment(
    input: AssessmentSubmission,
  ): Promise<AssessmentResult> {
    assertLearnerSafe(input);
    return await this.rpc<AssessmentResult>("submit_assessment", {
      assignment_requirement_id: input.assignmentRequirementId,
      requirement_version_id: input.requirementVersionId,
      answers: input.answers.map((answer) => ({
        question_id: answer.questionId,
        answer_id: answer.answerId,
      })),
      submitted_at: input.submittedAt,
    });
  }

  acknowledgePolicy(
    requirementVersionId: string,
    evidenceHash: string,
  ): Promise<void> {
    return this.rpc<void>("acknowledge_policy", {
      requirement_version_id: requirementVersionId,
      evidence_hash: evidenceHash,
    });
  }

  requestSupport(
    assignmentRequirementId: string,
    reason: string,
  ): Promise<void> {
    return this.rpc<void>("request_support", {
      assignment_requirement_id: assignmentRequirementId,
      reason,
    });
  }

  refreshCertifications(): Promise<readonly Certification[]> {
    return this.rpc<readonly Certification[]>("evaluate_certifications");
  }
}

export interface MemoryLearningRepositoryOptions {
  snapshot: LearningSnapshot;
  runtime?: "development" | "test" | "production";
  now?: () => string;
  simulations?: readonly SimulationDefinition[];
  assess?: (
    input: AssessmentSubmission,
    requirement: RequirementDefinition,
  ) => { score: number };
  evaluateCertifications?: (
    snapshot: LearningSnapshot,
  ) => readonly Certification[];
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryLearningRepository implements LearningRepository {
  private state: LearningSnapshot;
  private readonly now: () => string;
  private readonly assess?: MemoryLearningRepositoryOptions["assess"];
  private readonly evaluateCertifications?: MemoryLearningRepositoryOptions["evaluateCertifications"];
  private readonly simulations: ReadonlyMap<string, SimulationDefinition>;
  private readonly completedCheckpoints = new Map<string, Set<string>>();

  constructor(options: MemoryLearningRepositoryOptions) {
    const runtime = options.runtime ?? process.env.NODE_ENV;
    if (runtime === "production") {
      throw new Error("MemoryLearningRepository is disabled in production.");
    }
    this.state = clone(options.snapshot);
    this.now = options.now ?? (() => new Date().toISOString());
    this.assess = options.assess;
    this.evaluateCertifications = options.evaluateCertifications;
    this.simulations = new Map(
      (options.simulations ?? []).map((simulation) => [simulation.id, simulation]),
    );
  }

  async snapshot(): Promise<LearningSnapshot> {
    return clone(this.state);
  }

  async resolveAssignments(): Promise<LearningSnapshot> {
    return this.snapshot();
  }

  private progressFor(assignmentRequirementId: string): RequirementProgress {
    const progress = this.state.progress.find(
      (item) => item.assignmentRequirementId === assignmentRequirementId,
    );
    if (!progress) {
      throw new Error(
        `Unknown assignment requirement ${assignmentRequirementId}.`,
      );
    }
    return progress;
  }

  private requirementFor(requirementId: string): RequirementDefinition {
    const requirement = this.state.curricula
      .flatMap((curriculum) => curriculum.requirements)
      .find((item) => item.id === requirementId);
    if (!requirement) {
      throw new Error(`Unknown requirement ${requirementId}.`);
    }
    return requirement;
  }

  private assertPrerequisites(requirement: RequirementDefinition): void {
    for (const prerequisiteId of requirement.prerequisiteIds) {
      const complete = this.state.progress.some(
        (item) =>
          item.requirementId === prerequisiteId &&
          (item.state === "passed" || item.state === "waived"),
      );
      if (!complete) {
        throw new Error(`Requirement prerequisite ${prerequisiteId} is incomplete.`);
      }
    }
  }

  private replaceProgress(next: RequirementProgress): RequirementProgress {
    this.state = {
      ...this.state,
      progress: this.state.progress.map((item) =>
        item.assignmentRequirementId === next.assignmentRequirementId
          ? next
          : item,
      ),
      refreshedAt: this.now(),
    };
    return clone(next);
  }

  async startRequirement(
    requirementVersionId: string,
  ): Promise<RequirementProgress> {
    const current = this.state.progress.find(
      (item) => item.requirementId === requirementVersionId,
    );
    if (!current) {
      throw new Error(`Unknown requirement ${requirementVersionId}.`);
    }
    const requirement = this.requirementFor(current.requirementId);
    this.assertPrerequisites(requirement);
    if (current.state === "needs_support") {
      throw new Error("Requirement needs support before it can be retried.");
    }
    if (current.state === "passed" || current.state === "waived") {
      throw new Error("Requirement is already complete.");
    }
    if (current.state === "expired") {
      throw new Error("Requirement is expired.");
    }
    if (current.state === "in_progress") return clone(current);
    return this.replaceProgress({
      ...current,
      state: "in_progress",
      updatedAt: this.now(),
    });
  }

  async checkpoint(
    input: SimulationCheckpointInput,
  ): Promise<RequirementProgress> {
    assertLearnerSafe(input);
    const current = this.progressFor(input.assignmentRequirementId);
    const requirement = this.requirementFor(current.requirementId);
    if (current.state !== "in_progress") {
      throw new Error("Requirement must be in progress before a checkpoint.");
    }
    if (!requirement.simulationId || requirement.simulationId !== input.simulationId) {
      throw new Error("Checkpoint does not match the assigned simulation.");
    }
    const simulation = this.simulations.get(input.simulationId);
    if (!simulation) {
      throw new Error(`Unknown simulation ${input.simulationId}.`);
    }
    if (!simulation.checkpointIds.includes(input.checkpointId)) {
      throw new Error(`Unknown simulation checkpoint ${input.checkpointId}.`);
    }
    const completed = this.completedCheckpoints.get(
      input.assignmentRequirementId,
    ) ?? new Set<string>();
    completed.add(input.checkpointId);
    this.completedCheckpoints.set(input.assignmentRequirementId, completed);
    const passed = simulation.checkpointIds.every((checkpointId) =>
      completed.has(checkpointId),
    );
    return this.replaceProgress({
      ...current,
      state: passed ? "passed" : "in_progress",
      completedAt: passed ? this.now() : undefined,
      updatedAt: this.now(),
    });
  }

  async submitAssessment(input: AssessmentSubmission): Promise<AssessmentResult> {
    assertLearnerSafe(input);
    const current = this.progressFor(input.assignmentRequirementId);
    const requirement = this.requirementFor(current.requirementId);
    if (requirement.id !== input.requirementVersionId) {
      throw new Error("Assessment does not match the assigned requirement.");
    }
    if (requirement.kind !== "assessment") {
      throw new Error("Assigned requirement is not an assessment.");
    }
    if (current.state !== "in_progress") {
      throw new Error("Assessment must be in progress before submission.");
    }
    if (!this.assess) {
      throw new Error("Memory assessment scoring is not configured.");
    }
    const { score } = this.assess(clone(input), clone(requirement));
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error("Assessment scorer returned an invalid score.");
    }
    const attemptNumber = current.attemptCount + 1;
    const passed = score >= (requirement.passingScore ?? 100);
    const state = passed
      ? "passed"
      : attemptNumber >= (requirement.maxAttempts ?? 1)
        ? "needs_support"
        : "failed_retryable";
    const completedAt = passed ? this.now() : undefined;
    this.replaceProgress({
      ...current,
      state,
      attemptCount: attemptNumber,
      completedAt,
      updatedAt: this.now(),
    });
    return {
      assignmentRequirementId: current.assignmentRequirementId,
      passed,
      score,
      attemptNumber,
      state,
      completedAt,
    };
  }

  async acknowledgePolicy(
    requirementVersionId: string,
    evidenceHash: string,
  ): Promise<void> {
    if (!evidenceHash.trim()) throw new Error("Policy evidence hash is required.");
    const current = this.state.progress.find(
      (item) => item.requirementId === requirementVersionId,
    );
    if (!current) throw new Error(`Unknown requirement ${requirementVersionId}.`);
    const requirement = this.requirementFor(current.requirementId);
    if (requirement.kind !== "policy" && requirement.kind !== "attestation") {
      throw new Error("Assigned requirement is not a policy acknowledgment.");
    }
    this.assertPrerequisites(requirement);
    this.replaceProgress({
      ...current,
      state: "passed",
      completedAt: this.now(),
      updatedAt: this.now(),
    });
  }

  async requestSupport(
    assignmentRequirementId: string,
    reason: string,
  ): Promise<void> {
    if (!reason.trim()) throw new Error("Support reason is required.");
    const current = this.progressFor(assignmentRequirementId);
    if (current.state === "passed" || current.state === "waived") {
      throw new Error("Completed requirements do not need support.");
    }
    this.replaceProgress({
      ...current,
      state: "needs_support",
      updatedAt: this.now(),
    });
  }

  async refreshCertifications(): Promise<readonly Certification[]> {
    if (this.evaluateCertifications) {
      const certifications = this.evaluateCertifications(await this.snapshot());
      this.state = {
        ...this.state,
        certifications: clone(certifications),
        refreshedAt: this.now(),
      };
    }
    return clone(this.state.certifications);
  }
}
