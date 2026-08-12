import type {
  ActiveLearningAttempt,
  AssessmentResult,
  AssessmentSubmission,
  Certification,
  CurriculumDefinition,
  EffectiveCurriculum,
  LearningCapability,
  LearningSnapshot,
  LockedCapability,
  PolicyAcknowledgmentInput,
  RequirementDefinition,
  RequirementProgress,
  RequirementProgressState,
  SimulationCheckpointInput,
  SimulationDefinition,
  StartRequirementInput,
  StartRequirementResult,
  SupportRequestInput,
} from "./types";
import { MODULE_LIST } from "@intra/rbac";

export interface LearningRepository {
  snapshot(): Promise<LearningSnapshot>;
  resolveAssignments(): Promise<LearningSnapshot>;
  startRequirement(
    input: StartRequirementInput,
  ): Promise<StartRequirementResult>;
  checkpoint(input: SimulationCheckpointInput): Promise<RequirementProgress>;
  submitAssessment(input: AssessmentSubmission): Promise<AssessmentResult>;
  acknowledgePolicy(input: PolicyAcknowledgmentInput): Promise<void>;
  requestSupport(input: SupportRequestInput): Promise<void>;
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

const progressStates = new Set<RequirementProgressState>([
  "not_started",
  "in_progress",
  "passed",
  "failed_retryable",
  "needs_support",
  "expired",
  "waived",
]);
const audiences = new Set<RequirementDefinition["audience"]>([
  "internal",
  "vendor",
]);
const requirementKinds = new Set<RequirementDefinition["kind"]>([
  "orientation",
  "policy",
  "tour",
  "scenario",
  "assessment",
  "attestation",
]);
const curriculumSources = new Set<EffectiveCurriculum["source"]>([
  "role",
  "department",
  "assignment",
]);
const lockReasons = new Set<LockedCapability["reason"]>([
  "missing_certification",
  "expired_certification",
  "retraining_required",
]);
const assessmentAttemptStatuses = new Set(["passed", "failed"] as const);
const attemptModes = new Set<ActiveLearningAttempt["mode"]>([
  "tour",
  "scenario",
  "assessment",
  "attestation",
]);
const modules = new Set<LearningCapability["module"]>(MODULE_LIST);

const forbiddenLearnerFields = new Set([
  "answerkey",
  "certificationstate",
  "certificationstatus",
  "passed",
  "score",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Learning service returned invalid ${key}.`);
  }
  return value;
}

function optionalString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Learning service returned invalid ${key}.`);
  }
  return value;
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Learning service returned invalid ${key}.`);
  }
  return value;
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new Error(`Learning service returned invalid ${key}.`);
  }
  return value;
}

function requiredArray(row: Record<string, unknown>, key: string): unknown[] {
  const value = row[key];
  if (!Array.isArray(value)) {
    throw new Error(`Learning service returned invalid ${key}.`);
  }
  return value;
}

function requiredEnum<T extends string>(
  row: Record<string, unknown>,
  key: string,
  values: ReadonlySet<T>,
): T {
  const value = requiredString(row, key);
  if (!values.has(value as T)) {
    throw new Error(`Learning service returned invalid ${key}.`);
  }
  return value as T;
}

function parseCapability(value: unknown): LearningCapability {
  if (!isRecord(value))
    throw new Error("Learning service returned invalid capability.");
  return {
    module: requiredEnum(value, "module", modules),
    capability: requiredString(value, "capability"),
  };
}

function parseRequirement(value: unknown): RequirementDefinition {
  if (!isRecord(value))
    throw new Error("Learning service returned invalid requirement.");
  const kind = requiredEnum(value, "kind", requirementKinds);
  const audience = requiredEnum(value, "audience", audiences);
  return {
    id: requiredString(value, "id"),
    version: requiredNumber(value, "version"),
    audience,
    kind,
    title: requiredString(value, "title"),
    mandatory: requiredBoolean(value, "mandatory"),
    prerequisiteIds: requiredArray(value, "prerequisiteIds").map((item) => {
      if (typeof item !== "string") throw new Error("Invalid prerequisite ID.");
      return item;
    }),
    capabilityOutcomes: requiredArray(value, "capabilityOutcomes").map(
      parseCapability,
    ),
    simulationId: optionalString(value, "simulationId"),
    passingScore:
      value.passingScore == null
        ? undefined
        : requiredNumber(value, "passingScore"),
    maxAttempts:
      value.maxAttempts == null
        ? undefined
        : requiredNumber(value, "maxAttempts"),
  };
}

function parseCurriculum(value: unknown): CurriculumDefinition {
  if (!isRecord(value))
    throw new Error("Learning service returned invalid curriculum.");
  return {
    id: requiredString(value, "id"),
    version: requiredNumber(value, "version"),
    personaId: requiredString(value, "personaId"),
    audience: requiredEnum(value, "audience", audiences),
    requirementIds: requiredArray(value, "requirementIds").map((item) => {
      if (typeof item !== "string")
        throw new Error("Invalid curriculum requirement ID.");
      return item;
    }),
  };
}

function parseEffectiveCurriculum(value: unknown): EffectiveCurriculum {
  if (!isRecord(value))
    throw new Error("Learning service returned invalid effective curriculum.");
  const source = requiredEnum(value, "source", curriculumSources);
  return {
    curriculum: parseCurriculum(value.curriculum),
    requirements: requiredArray(value, "requirements").map(parseRequirement),
    source,
  };
}

function parseProgress(value: unknown): RequirementProgress {
  if (!isRecord(value))
    throw new Error("Learning service returned invalid progress.");
  const state = requiredEnum(value, "state", progressStates);
  return {
    assignmentRequirementId: requiredString(value, "assignmentRequirementId"),
    requirementId: requiredString(value, "requirementId"),
    requirementVersion: requiredNumber(value, "requirementVersion"),
    state,
    attemptCount: requiredNumber(value, "attemptCount"),
    allowsSharedCompletion: requiredBoolean(value, "allowsSharedCompletion"),
    activeAttempt:
      value.activeAttempt == null
        ? undefined
        : parseActiveAttempt(value.activeAttempt),
    completedAt: optionalString(value, "completedAt"),
    updatedAt: requiredString(value, "updatedAt"),
  };
}

function parseActiveAttempt(value: unknown): ActiveLearningAttempt {
  if (!isRecord(value))
    throw new Error("Learning service returned invalid active attempt.");
  return {
    id: requiredString(value, "id"),
    attemptNumber: requiredNumber(value, "attemptNumber"),
    mode: requiredEnum(value, "mode", attemptModes),
    startedAt: requiredString(value, "startedAt"),
  };
}

function parseRawActiveAttempt(
  value: unknown,
): ActiveLearningAttempt | undefined {
  if (value == null) return undefined;
  if (!isRecord(value))
    throw new Error("Learning service returned invalid started attempt.");
  return {
    id: requiredString(value, "id"),
    attemptNumber: requiredNumber(value, "attempt_number"),
    mode: requiredEnum(value, "mode", attemptModes),
    startedAt: requiredString(value, "started_at"),
  };
}

function parseStartRequirement(value: unknown): {
  assignmentRequirementId: string;
  attempt?: ActiveLearningAttempt;
} {
  if (!isRecord(value))
    throw new Error("Learning service returned invalid start result.");
  if (!isRecord(value.assignment_requirement)) {
    throw new Error("Learning service omitted the started requirement.");
  }
  return {
    assignmentRequirementId: requiredString(value.assignment_requirement, "id"),
    attempt: parseRawActiveAttempt(value.attempt),
  };
}

function parseCertification(value: unknown): Certification {
  if (!isRecord(value))
    throw new Error("Learning service returned invalid certification.");
  return {
    id: requiredString(value, "id"),
    userId: requiredString(value, "userId"),
    departmentId: requiredString(value, "departmentId"),
    sourceRoleAssignmentId: requiredString(value, "sourceRoleAssignmentId"),
    capability: parseCapability(value.capability),
    curriculumId: requiredString(value, "curriculumId"),
    curriculumVersion: requiredNumber(value, "curriculumVersion"),
    requirementIds: requiredArray(value, "requirementIds").map((item) => {
      if (typeof item !== "string")
        throw new Error("Invalid certification requirement ID.");
      return item;
    }),
    issuedAt: requiredString(value, "issuedAt"),
    effectiveAt: requiredString(value, "effectiveAt"),
    expiresAt: optionalString(value, "expiresAt"),
    revokedAt: optionalString(value, "revokedAt"),
    supersededAt: optionalString(value, "supersededAt"),
    issuedBy: requiredString(value, "issuedBy"),
    policyVersion: optionalString(value, "policyVersion"),
  };
}

function parseLock(value: unknown): LockedCapability {
  if (!isRecord(value))
    throw new Error("Learning service returned invalid capability lock.");
  return {
    capability: parseCapability(value.capability),
    reason: requiredEnum(value, "reason", lockReasons),
    requirementIds: requiredArray(value, "requirementIds").map((item) => {
      if (typeof item !== "string")
        throw new Error("Invalid lock requirement ID.");
      return item;
    }),
    canRequestEmergencyException: requiredBoolean(
      value,
      "canRequestEmergencyException",
    ),
  };
}

function parseSnapshot(value: unknown): LearningSnapshot {
  if (!isRecord(value))
    throw new Error("Learning service returned an invalid snapshot.");
  return {
    curricula: requiredArray(value, "curricula").map(parseEffectiveCurriculum),
    progress: requiredArray(value, "progress").map(parseProgress),
    certifications: requiredArray(value, "certifications").map(
      parseCertification,
    ),
    lockedCapabilities: requiredArray(value, "lockedCapabilities").map(
      parseLock,
    ),
    refreshedAt: requiredString(value, "refreshedAt"),
  };
}

interface AssessmentRpcResult {
  assignmentRequirementId: string;
  passed: boolean;
  score: number;
  attemptNumber: number;
  completedAt?: string;
}

function parseAssessment(value: unknown): AssessmentRpcResult {
  if (!isRecord(value))
    throw new Error("Learning service returned invalid assessment result.");
  const status = requiredEnum(value, "status", assessmentAttemptStatuses);
  const passed = status === "passed";
  const attemptNumber = requiredNumber(value, "attempt_number");
  const score = requiredNumber(value, "score");
  return {
    assignmentRequirementId: requiredString(value, "assignment_requirement_id"),
    passed,
    score,
    attemptNumber,
    completedAt: optionalString(value, "completed_at"),
  };
}

function assertLearnerSafe(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertLearnerSafe(item);
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (forbiddenLearnerFields.has(key.replaceAll("_", "").toLowerCase())) {
      throw new Error(`Learner input contains authoritative field ${key}.`);
    }
    assertLearnerSafe(nestedValue);
  }
}

const messageForRpcError = (error: unknown): string =>
  isRecord(error) && typeof error.message === "string"
    ? error.message
    : "Learning service request failed.";

const defaultIdempotencyKey = (): string => {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error(
      "A secure UUID generator is required for learning commands.",
    );
  }
  return globalThis.crypto.randomUUID();
};

export class SupabaseLearningRepository implements LearningRepository {
  private readonly learning: LearningSchemaClient;
  private readonly createIdempotencyKey: () => string;

  constructor(
    client: LearningRpcClient,
    createIdempotencyKey = defaultIdempotencyKey,
  ) {
    this.learning = client.schema("learning");
    this.createIdempotencyKey = createIdempotencyKey;
  }

  private async rpc(
    name: string,
    parameters?: Record<string, unknown>,
  ): Promise<unknown> {
    assertLearnerSafe(parameters);
    const result = parameters
      ? await this.learning.rpc(name, parameters)
      : await this.learning.rpc(name);
    if (result.error) throw new Error(messageForRpcError(result.error));
    return result.data;
  }

  private commandPayload(payload: Record<string, unknown>): {
    payload: Record<string, unknown>;
  } {
    return { payload };
  }

  private key(key?: string): string {
    return key ?? this.createIdempotencyKey();
  }

  async snapshot(): Promise<LearningSnapshot> {
    return parseSnapshot(await this.rpc("my_learning_snapshot"));
  }

  async resolveAssignments(): Promise<LearningSnapshot> {
    return parseSnapshot(await this.rpc("resolve_assignments"));
  }

  async startRequirement(
    input: StartRequirementInput,
  ): Promise<StartRequirementResult> {
    assertLearnerSafe(input);
    const started = parseStartRequirement(
      await this.rpc(
        "start_requirement",
        this.commandPayload({
          assignment_requirement_id: input.assignmentRequirementId,
          idempotency_key: this.key(input.idempotencyKey),
        }),
      ),
    );
    if (started.assignmentRequirementId !== input.assignmentRequirementId) {
      throw new Error("Learning service started a different requirement.");
    }
    const progress = await this.progressAfter(input.assignmentRequirementId);
    if (started.attempt && progress.activeAttempt?.id !== started.attempt.id) {
      throw new Error("Learning snapshot omitted the active started attempt.");
    }
    return { progress, attempt: progress.activeAttempt ?? started.attempt };
  }

  async checkpoint(
    input: SimulationCheckpointInput,
  ): Promise<RequirementProgress> {
    assertLearnerSafe(input);
    await this.rpc(
      "record_simulation_checkpoint",
      this.commandPayload({
        assignment_requirement_id: input.assignmentRequirementId,
        attempt_id: input.attemptId,
        checkpoint_id: input.checkpointId,
        ...(input.outcomeId ? { outcome_id: input.outcomeId } : {}),
        idempotency_key: this.key(input.idempotencyKey),
      }),
    );
    let progress = await this.progressAfter(input.assignmentRequirementId);
    if (progress.state === "passed") {
      await this.syncSharedCompletions();
      progress = await this.progressAfter(input.assignmentRequirementId);
    }
    return progress;
  }

  async submitAssessment(
    input: AssessmentSubmission,
  ): Promise<AssessmentResult> {
    assertLearnerSafe(input);
    const answers: Record<string, string> = {};
    for (const answer of input.answers) {
      if (Object.hasOwn(answers, answer.questionId)) {
        throw new Error(`Duplicate assessment answer ${answer.questionId}.`);
      }
      answers[answer.questionId] = answer.answerId;
    }
    const result = parseAssessment(
      await this.rpc(
        "submit_assessment",
        this.commandPayload({
          assignment_requirement_id: input.assignmentRequirementId,
          attempt_id: input.attemptId,
          answers,
          idempotency_key: this.key(input.idempotencyKey),
        }),
      ),
    );
    let progress = await this.progressAfter(input.assignmentRequirementId);
    if (progress.state === "passed") {
      await this.syncSharedCompletions();
      progress = await this.progressAfter(input.assignmentRequirementId);
    }
    return {
      ...result,
      state: progress.state,
      completedAt: progress.completedAt ?? result.completedAt,
    };
  }

  async acknowledgePolicy(input: PolicyAcknowledgmentInput): Promise<void> {
    assertLearnerSafe(input);
    await this.rpc(
      "acknowledge_policy",
      this.commandPayload({
        assignment_requirement_id: input.assignmentRequirementId,
        controlled_document_id: input.controlledDocumentId,
        controlled_document_version: input.controlledDocumentVersion,
        evidence_hash: input.evidenceHash,
        idempotency_key: this.key(input.idempotencyKey),
      }),
    );
    await this.syncSharedCompletions();
  }

  async requestSupport(input: SupportRequestInput): Promise<void> {
    assertLearnerSafe(input);
    await this.rpc(
      "request_support",
      this.commandPayload({
        assignment_requirement_id: input.assignmentRequirementId,
        reason: input.reason,
        idempotency_key: this.key(input.idempotencyKey),
      }),
    );
  }

  async refreshCertifications(): Promise<readonly Certification[]> {
    await this.syncSharedCompletions();
    await this.rpc("evaluate_certifications");
    return (await this.snapshot()).certifications;
  }

  private async syncSharedCompletions(): Promise<void> {
    const value = await this.rpc("sync_shared_completions");
    if (
      !isRecord(value) ||
      typeof value.propagated_count !== "number" ||
      !Number.isInteger(value.propagated_count) ||
      value.propagated_count < 0
    ) {
      throw new Error("Learning service returned invalid completion sync.");
    }
  }

  private async progressAfter(
    assignmentRequirementId: string,
  ): Promise<RequirementProgress> {
    const progress = (await this.snapshot()).progress.find(
      (item) => item.assignmentRequirementId === assignmentRequirementId,
    );
    if (!progress)
      throw new Error("Learning service omitted updated requirement progress.");
    return progress;
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
    if (runtime === "production")
      throw new Error("MemoryLearningRepository is disabled in production.");
    this.state = clone(options.snapshot);
    this.now = options.now ?? (() => new Date().toISOString());
    this.assess = options.assess;
    this.evaluateCertifications = options.evaluateCertifications;
    this.simulations = new Map(
      (options.simulations ?? []).map((item) => [item.id, item]),
    );
  }

  async snapshot(): Promise<LearningSnapshot> {
    return clone(this.state);
  }
  private convergeSharedCompletions(): void {
    const roots = this.state.progress.filter(
      (item) => item.state === "passed" && item.allowsSharedCompletion,
    );
    for (const root of roots) this.replaceProgress(root);
  }
  async resolveAssignments(): Promise<LearningSnapshot> {
    this.convergeSharedCompletions();
    return this.snapshot();
  }

  private progressFor(id: string): RequirementProgress {
    const progress = this.state.progress.find(
      (item) => item.assignmentRequirementId === id,
    );
    if (!progress) throw new Error(`Unknown assignment requirement ${id}.`);
    return progress;
  }

  private requirementFor(id: string): RequirementDefinition {
    const requirement = this.state.curricula
      .flatMap((item) => item.requirements)
      .find((item) => item.id === id);
    if (!requirement) throw new Error(`Unknown requirement ${id}.`);
    return requirement;
  }

  private assertPrerequisites(requirement: RequirementDefinition): void {
    for (const id of requirement.prerequisiteIds) {
      if (
        !this.state.progress.some(
          (item) =>
            item.requirementId === id &&
            ["passed", "waived"].includes(item.state),
        )
      ) {
        throw new Error(`Requirement prerequisite ${id} is incomplete.`);
      }
    }
  }

  private replaceProgress(next: RequirementProgress): RequirementProgress {
    const sharedCompletion =
      next.state === "passed" && next.allowsSharedCompletion;
    this.state = {
      ...this.state,
      progress: this.state.progress.map((item) =>
        item.assignmentRequirementId === next.assignmentRequirementId
          ? next
          : sharedCompletion &&
              item.allowsSharedCompletion &&
              item.requirementId === next.requirementId &&
              item.requirementVersion === next.requirementVersion &&
              !["passed", "waived", "expired"].includes(item.state)
            ? {
                ...item,
                state: "passed",
                activeAttempt: undefined,
                completedAt: this.now(),
                updatedAt: this.now(),
              }
            : item,
      ),
      refreshedAt: this.now(),
    };
    return clone(next);
  }

  async startRequirement(
    input: StartRequirementInput,
  ): Promise<StartRequirementResult> {
    this.convergeSharedCompletions();
    const current = this.progressFor(input.assignmentRequirementId);
    const requirement = this.requirementFor(current.requirementId);
    if (["passed", "waived"].includes(current.state)) {
      return { progress: clone(current), attempt: undefined };
    }
    this.assertPrerequisites(requirement);
    if (current.state === "needs_support")
      throw new Error("Requirement needs support before it can be retried.");
    if (current.state === "expired") throw new Error("Requirement is expired.");
    if (current.state === "in_progress") {
      return {
        progress: clone(current),
        attempt: clone(current.activeAttempt),
      };
    }
    const mode =
      requirement.kind === "tour" ||
      requirement.kind === "scenario" ||
      requirement.kind === "assessment" ||
      requirement.kind === "attestation"
        ? requirement.kind
        : requirement.kind === "orientation"
          ? "attestation"
          : undefined;
    const attemptNumber = current.attemptCount + (mode ? 1 : 0);
    const activeAttempt = mode
      ? {
          id: `memory:${input.assignmentRequirementId}:${attemptNumber}`,
          attemptNumber,
          mode,
          startedAt: this.now(),
        }
      : undefined;
    const progress = this.replaceProgress({
      ...current,
      state: "in_progress",
      attemptCount: attemptNumber,
      activeAttempt,
      updatedAt: this.now(),
    });
    return { progress, attempt: clone(activeAttempt) };
  }

  async checkpoint(
    input: SimulationCheckpointInput,
  ): Promise<RequirementProgress> {
    assertLearnerSafe(input);
    const current = this.progressFor(input.assignmentRequirementId);
    const requirement = this.requirementFor(current.requirementId);
    if (current.state !== "in_progress")
      throw new Error("Requirement must be in progress before a checkpoint.");
    if (current.activeAttempt?.id !== input.attemptId)
      throw new Error("Checkpoint attempt is not active for this requirement.");
    if (
      !requirement.simulationId ||
      requirement.simulationId !== input.simulationId
    )
      throw new Error("Checkpoint does not match the assigned simulation.");
    const simulation = this.simulations.get(input.simulationId);
    if (!simulation || !simulation.checkpointIds.includes(input.checkpointId))
      throw new Error("Unknown simulation checkpoint.");
    const completed =
      this.completedCheckpoints.get(input.assignmentRequirementId) ??
      new Set<string>();
    completed.add(input.checkpointId);
    this.completedCheckpoints.set(input.assignmentRequirementId, completed);
    const passed = simulation.checkpointIds.every((id) => completed.has(id));
    return this.replaceProgress({
      ...current,
      state: passed ? "passed" : "in_progress",
      activeAttempt: passed ? undefined : current.activeAttempt,
      completedAt: passed ? this.now() : undefined,
      updatedAt: this.now(),
    });
  }

  async submitAssessment(
    input: AssessmentSubmission,
  ): Promise<AssessmentResult> {
    assertLearnerSafe(input);
    const current = this.progressFor(input.assignmentRequirementId);
    const requirement = this.requirementFor(current.requirementId);
    if (requirement.kind !== "assessment")
      throw new Error("Assigned requirement is not an assessment.");
    if (current.state !== "in_progress")
      throw new Error("Assessment must be in progress before submission.");
    if (current.activeAttempt?.id !== input.attemptId)
      throw new Error("Assessment attempt is not active for this requirement.");
    if (!this.assess)
      throw new Error("Memory assessment scoring is not configured.");
    const { score } = this.assess(clone(input), clone(requirement));
    if (!Number.isFinite(score) || score < 0 || score > 100)
      throw new Error("Assessment scorer returned an invalid score.");
    const attemptNumber = current.activeAttempt.attemptNumber;
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
      activeAttempt: undefined,
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

  async acknowledgePolicy(input: PolicyAcknowledgmentInput): Promise<void> {
    if (!input.evidenceHash.trim())
      throw new Error("Policy evidence hash is required.");
    const current = this.progressFor(input.assignmentRequirementId);
    if (current.state !== "in_progress") {
      throw new Error(
        "Policy requirement must be started before acknowledgment.",
      );
    }
    const requirement = this.requirementFor(current.requirementId);
    if (requirement.kind !== "policy")
      throw new Error("Assigned requirement is not a policy acknowledgment.");
    this.assertPrerequisites(requirement);
    this.replaceProgress({
      ...current,
      state: "passed",
      completedAt: this.now(),
      updatedAt: this.now(),
    });
  }

  async requestSupport(input: SupportRequestInput): Promise<void> {
    if (!input.reason.trim()) throw new Error("Support reason is required.");
    const current = this.progressFor(input.assignmentRequirementId);
    if (
      !["in_progress", "failed_retryable", "needs_support"].includes(
        current.state,
      )
    ) {
      throw new Error(
        "Only active or retryable requirements can request support.",
      );
    }
    if (["passed", "waived"].includes(current.state))
      throw new Error("Completed requirements do not need support.");
    this.replaceProgress({
      ...current,
      state: "needs_support",
      updatedAt: this.now(),
    });
  }

  async refreshCertifications(): Promise<readonly Certification[]> {
    if (this.evaluateCertifications) {
      this.state = {
        ...this.state,
        certifications: clone(
          this.evaluateCertifications(await this.snapshot()),
        ),
        refreshedAt: this.now(),
      };
    }
    return clone(this.state.certifications);
  }
}
