import { describe, expect, it, vi } from "vitest";

import {
  MemoryLearningRepository,
  SupabaseLearningRepository,
} from "./repository";
import * as publicApi from "./index";
import type {
  AssessmentSubmission,
  Certification,
  EffectiveCurriculum,
  LearningSnapshot,
  RequirementDefinition,
  RequirementProgress,
  SimulationDefinition,
} from "./types";

const now = "2026-08-12T00:00:00.000Z";

const orientation: RequirementDefinition = {
  id: "orientation-v1",
  version: 1,
  audience: "internal",
  kind: "orientation",
  title: "Orientation",
  mandatory: true,
  prerequisiteIds: [],
  capabilityOutcomes: [],
};

const assessment: RequirementDefinition = {
  id: "assessment-v1",
  version: 1,
  audience: "internal",
  kind: "assessment",
  title: "Assessment",
  mandatory: true,
  prerequisiteIds: [orientation.id],
  capabilityOutcomes: [{ module: "warehouse", capability: "receive_stock" }],
  passingScore: 80,
  maxAttempts: 2,
};

const simulation: RequirementDefinition = {
  id: "simulation-v1",
  version: 1,
  audience: "internal",
  kind: "scenario",
  title: "Simulation",
  mandatory: true,
  prerequisiteIds: [orientation.id],
  capabilityOutcomes: [],
  simulationId: "receiving-simulation-v1",
};

const policy: RequirementDefinition = {
  id: "policy-v1",
  version: 1,
  audience: "internal",
  kind: "policy",
  title: "Policy",
  mandatory: true,
  prerequisiteIds: [orientation.id],
  capabilityOutcomes: [],
};

const simulationDefinition: SimulationDefinition = {
  id: "receiving-simulation-v1",
  version: 1,
  audience: "internal",
  module: "warehouse",
  title: "Receiving simulation",
  checkpointIds: ["delivery-recorded"],
  capabilityOutcomes: [],
};

const progress = (
  assignmentRequirementId: string,
  requirementId: string,
  state: RequirementProgress["state"],
): RequirementProgress => ({
  assignmentRequirementId,
  requirementId,
  requirementVersion: 1,
  state,
  attemptCount: 0,
  updatedAt: now,
});

const effectiveCurriculum: EffectiveCurriculum = {
  curriculum: {
    id: "curriculum-v1",
    version: 1,
    personaId: "operations_associate",
    audience: "internal",
    requirementIds: [orientation.id, simulation.id, assessment.id, policy.id],
  },
  requirements: [orientation, simulation, assessment, policy],
  source: "role",
};

const snapshot = (): LearningSnapshot => ({
  curricula: [effectiveCurriculum],
  progress: [
    progress("ar-orientation", orientation.id, "not_started"),
    progress("ar-simulation", simulation.id, "not_started"),
    progress("ar-assessment", assessment.id, "not_started"),
    progress("ar-policy", policy.id, "not_started"),
  ],
  certifications: [],
  lockedCapabilities: [],
  refreshedAt: now,
});

const snapshotWithOrientationPassed = (): LearningSnapshot => {
  const value = snapshot();
  return {
    ...value,
    progress: value.progress.map((item) =>
      item.assignmentRequirementId === "ar-orientation"
        ? { ...item, state: "passed", completedAt: now }
        : item,
    ),
  };
};

const snapshotWithAssessmentPassed = (): LearningSnapshot => {
  const value = snapshot();
  return {
    ...value,
    progress: value.progress.map((item) =>
      item.assignmentRequirementId === "ar-assessment"
        ? { ...item, state: "passed", attemptCount: 1, completedAt: now }
        : item,
    ),
  };
};

describe("SupabaseLearningRepository", () => {
  it("exports both repository implementations from the package API", () => {
    expect(publicApi.SupabaseLearningRepository).toBe(
      SupabaseLearningRepository,
    );
    expect(publicApi.MemoryLearningRepository).toBe(MemoryLearningRepository);
  });

  it("uses the exact learning RPC names and learner-safe payload keys", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "evaluate_certifications") return { data: [], error: null };
      if (name === "acknowledge_policy" || name === "request_support") {
        return { data: null, error: null };
      }
      if (name === "my_learning_snapshot" || name === "resolve_assignments") {
        return {
          data:
            name === "my_learning_snapshot"
              ? snapshotWithAssessmentPassed()
              : snapshot(),
          error: null,
        };
      }
      if (name === "submit_assessment") {
        return {
          data: {
            assignment_requirement_id: "ar-assessment",
            status: "passed",
            score: 100,
            attempt_number: 1,
            completed_at: now,
          },
          error: null,
        };
      }
      return { data: {}, error: null };
    });
    const schema = vi.fn(() => ({ rpc }));
    const repository = new SupabaseLearningRepository({ schema });
    const submission: AssessmentSubmission = {
      assignmentRequirementId: "ar-assessment",
      attemptId: "attempt-assessment",
      answers: [{ questionId: "q1", answerId: "a1" }],
      idempotencyKey: "00000000-0000-4000-8000-000000000003",
    };

    await repository.snapshot();
    await repository.resolveAssignments();
    await repository.startRequirement({
      assignmentRequirementId: "ar-simulation",
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    });
    await repository.checkpoint({
      assignmentRequirementId: "ar-simulation",
      attemptId: "attempt-simulation",
      simulationId: "receiving-simulation-v1",
      checkpointId: "delivery-recorded",
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
    });
    expect(await repository.submitAssessment(submission)).toMatchObject({
      assignmentRequirementId: "ar-assessment",
      passed: true,
      state: "passed",
      attemptNumber: 1,
    });
    await repository.acknowledgePolicy({
      assignmentRequirementId: "ar-policy",
      controlledDocumentId: "POL-001",
      controlledDocumentVersion: "1.0",
      evidenceHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      idempotencyKey: "00000000-0000-4000-8000-000000000004",
    });
    await repository.refreshCertifications();
    await repository.requestSupport({
      assignmentRequirementId: "ar-assessment",
      reason: "Need coaching",
      idempotencyKey: "00000000-0000-4000-8000-000000000005",
    });

    expect(schema).toHaveBeenCalledTimes(1);
    expect(schema).toHaveBeenCalledWith("learning");
    expect(rpc.mock.calls).toEqual([
      ["my_learning_snapshot"],
      ["resolve_assignments"],
      [
        "start_requirement",
        {
          payload: {
            assignment_requirement_id: "ar-simulation",
            idempotency_key: "00000000-0000-4000-8000-000000000001",
          },
        },
      ],
      ["my_learning_snapshot"],
      [
        "record_simulation_checkpoint",
        {
          payload: {
            assignment_requirement_id: "ar-simulation",
            attempt_id: "attempt-simulation",
            checkpoint_id: "delivery-recorded",
            idempotency_key: "00000000-0000-4000-8000-000000000002",
          },
        },
      ],
      ["my_learning_snapshot"],
      [
        "submit_assessment",
        {
          payload: {
            assignment_requirement_id: "ar-assessment",
            attempt_id: "attempt-assessment",
            answers: { q1: "a1" },
            idempotency_key: "00000000-0000-4000-8000-000000000003",
          },
        },
      ],
      ["my_learning_snapshot"],
      [
        "acknowledge_policy",
        {
          payload: {
            assignment_requirement_id: "ar-policy",
            controlled_document_id: "POL-001",
            controlled_document_version: "1.0",
            evidence_hash:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            idempotency_key: "00000000-0000-4000-8000-000000000004",
          },
        },
      ],
      ["evaluate_certifications"],
      [
        "request_support",
        {
          payload: {
            assignment_requirement_id: "ar-assessment",
            reason: "Need coaching",
            idempotency_key: "00000000-0000-4000-8000-000000000005",
          },
        },
      ],
    ]);
  });

  it("fails closed when the learning service returns invalid domain values", async () => {
    const invalidResponses = [
      {
        ...snapshot(),
        progress: [{ ...snapshot().progress[0]!, state: "complete" }],
      },
      {
        ...snapshot(),
        curricula: [
          {
            ...effectiveCurriculum,
            requirements: [
              {
                ...orientation,
                capabilityOutcomes: [
                  { module: "unknown", capability: "receive_stock" },
                ],
              },
            ],
          },
        ],
      },
      {
        ...snapshot(),
        curricula: [
          {
            ...effectiveCurriculum,
            requirements: [{ ...orientation, mandatory: "yes" }],
          },
        ],
      },
    ];

    for (const response of invalidResponses) {
      const repository = new SupabaseLearningRepository({
        schema: () => ({
          rpc: async () => ({ data: response, error: null }),
        }),
      });
      await expect(repository.snapshot()).rejects.toThrow(/invalid/i);
    }
  });

  it("rejects forged authoritative learner inputs before making an RPC", async () => {
    const rpc = vi.fn();
    const repository = new SupabaseLearningRepository({
      schema: () => ({ rpc }),
    });

    await expect(
      repository.submitAssessment({
        assignmentRequirementId: "ar-assessment",
        attemptId: "attempt-assessment",
        answers: [{ questionId: "q1", answerId: "a1" }],
        score: 100,
        passed: true,
        answerKey: "secret",
        certificationStatus: "active",
      } as AssessmentSubmission),
    ).rejects.toThrow("authoritative field");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC failures without inventing client-side state", async () => {
    const repository = new SupabaseLearningRepository({
      schema: () => ({
        rpc: async () => ({ data: null, error: { message: "denied" } }),
      }),
    });

    await expect(
      repository.startRequirement({
        assignmentRequirementId: "ar-assessment",
        idempotencyKey: "00000000-0000-4000-8000-000000000006",
      }),
    ).rejects.toThrow("denied");
  });
});

describe("MemoryLearningRepository", () => {
  it("cannot be constructed for a production runtime", () => {
    expect(
      () =>
        new MemoryLearningRepository({
          snapshot: snapshot(),
          runtime: "production",
        }),
    ).toThrow("production");
  });

  it("enforces prerequisites before start and accepts guarded simulation progress", async () => {
    const blockedRepository = new MemoryLearningRepository({
      snapshot: snapshot(),
      runtime: "test",
      now: () => now,
      simulations: [simulationDefinition],
    });
    await expect(
      blockedRepository.startRequirement({
        assignmentRequirementId: "ar-simulation",
      }),
    ).rejects.toThrow("prerequisite");

    const repository = new MemoryLearningRepository({
      snapshot: snapshotWithOrientationPassed(),
      runtime: "test",
      now: () => now,
      simulations: [simulationDefinition],
    });

    await repository.startRequirement({
      assignmentRequirementId: "ar-simulation",
    });
    await expect(
      repository.checkpoint({
        assignmentRequirementId: "ar-simulation",
        attemptId: "attempt-simulation",
        simulationId: "wrong-simulation",
        checkpointId: "delivery-recorded",
      }),
    ).rejects.toThrow("simulation");

    const updated = await repository.checkpoint({
      assignmentRequirementId: "ar-simulation",
      attemptId: "attempt-simulation",
      simulationId: "receiving-simulation-v1",
      checkpointId: "delivery-recorded",
    });
    expect(updated.state).toBe("passed");
    expect(updated.completedAt).toBe(now);
  });

  it("acknowledges only assigned policies and records support through guarded states", async () => {
    const repository = new MemoryLearningRepository({
      snapshot: snapshotWithOrientationPassed(),
      runtime: "test",
      now: () => now,
    });

    await expect(
      repository.acknowledgePolicy({
        assignmentRequirementId: "ar-policy",
        controlledDocumentId: "POL-001",
        controlledDocumentVersion: "1.0",
        evidenceHash: " ",
      }),
    ).rejects.toThrow("evidence hash");
    await repository.acknowledgePolicy({
      assignmentRequirementId: "ar-policy",
      controlledDocumentId: "POL-001",
      controlledDocumentVersion: "1.0",
      evidenceHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(
      (await repository.snapshot()).progress.find(
        (item) => item.requirementId === policy.id,
      )?.state,
    ).toBe("passed");
    await repository.requestSupport({
      assignmentRequirementId: "ar-assessment",
      reason: "Need coaching",
    });
    expect(
      (await repository.snapshot()).progress.find(
        (item) => item.assignmentRequirementId === "ar-assessment",
      )?.state,
    ).toBe("needs_support");
    await expect(
      repository.requestSupport({
        assignmentRequirementId: "ar-policy",
        reason: "Already complete",
      }),
    ).rejects.toThrow("Completed");
  });

  it("scores assessments through trusted configuration and exhausts retries", async () => {
    const repository = new MemoryLearningRepository({
      snapshot: snapshotWithOrientationPassed(),
      runtime: "test",
      now: () => now,
      assess: () => ({ score: 40 }),
    });
    await repository.startRequirement({
      assignmentRequirementId: "ar-assessment",
    });
    const submission: AssessmentSubmission = {
      assignmentRequirementId: "ar-assessment",
      attemptId: "attempt-assessment",
      answers: [{ questionId: "q1", answerId: "a1" }],
    };

    expect((await repository.submitAssessment(submission)).state).toBe(
      "failed_retryable",
    );
    await repository.startRequirement({
      assignmentRequirementId: "ar-assessment",
    });
    expect((await repository.submitAssessment(submission)).state).toBe(
      "needs_support",
    );
    await expect(
      repository.startRequirement({ assignmentRequirementId: "ar-assessment" }),
    ).rejects.toThrow("needs support");
  });

  it("updates only through repository transitions and returns defensive snapshots", async () => {
    const issued: Certification = {
      id: "cert-1",
      userId: "user-1",
      departmentId: "department-1",
      sourceRoleAssignmentId: "role-1",
      capability: { module: "warehouse", capability: "receive_stock" },
      curriculumId: "curriculum-v1",
      curriculumVersion: 1,
      requirementIds: [assessment.id],
      issuedAt: now,
      effectiveAt: now,
      issuedBy: "memory-learning-service",
    };
    const repository = new MemoryLearningRepository({
      snapshot: snapshot(),
      runtime: "test",
      now: () => now,
      evaluateCertifications: () => [issued],
    });

    const first = await repository.snapshot();
    (first.progress as RequirementProgress[])[0]!.state = "passed";
    expect((await repository.snapshot()).progress[0]?.state).toBe(
      "not_started",
    );
    expect(await repository.refreshCertifications()).toEqual([issued]);
    expect((await repository.snapshot()).certifications).toEqual([issued]);
  });
});
