import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserCapabilities } from "@intra/auth";
import type { LearningRepository } from "./repository";
import type { LearningSnapshot } from "./types";
import {
  LearningProvider,
  useLearning,
  type LearningContextValue,
} from "./LearningProvider";
import { clearTrainingAdaptersForTests } from "./training/registry";

const session: {
  mode: "memory" | "supabase";
  profile: { id: string; email: string; kind: "employee" };
  userCapabilities: UserCapabilities;
  userRoles?: Record<string, string[]>;
  refreshCapabilities?: () => Promise<boolean>;
} = {
  mode: "supabase",
  profile: {
    id: "learner-1",
    email: "operator@mwell.test",
    kind: "employee" as const,
  },
  userCapabilities: {
    warehouse: ["view_inventory"],
  } satisfies UserCapabilities,
};

vi.mock("@intra/auth", async () => {
  const actual = await vi.importActual<typeof import("@intra/auth")>(
    "@intra/auth",
  );
  return { ...actual, useSession: () => session };
});

afterEach(() => {
  delete session.refreshCapabilities;
});

const emptySnapshot = (refreshedAt = "2026-08-13T00:00:00.000Z") =>
  ({
    curricula: [],
    progress: [],
    certifications: [],
    lockedCapabilities: [
      {
        capability: { module: "warehouse", capability: "receive_stock" },
        reason: "missing_certification",
        requirementIds: ["receiving-scenario"],
        canRequestEmergencyException: true,
      },
    ],
    refreshedAt,
  }) satisfies LearningSnapshot;

function repository(
  snapshot: LearningSnapshot | (() => Promise<LearningSnapshot>),
): LearningRepository {
  const resolve =
    typeof snapshot === "function"
      ? snapshot
      : vi.fn().mockResolvedValue(snapshot);
  return {
    snapshot: vi.fn(resolve),
    resolveAssignments: vi.fn(resolve),
    startRequirement: vi.fn(),
    checkpoint: vi.fn(),
    submitAssessment: vi.fn(),
    acknowledgePolicy: vi.fn(),
    requestSupport: vi.fn(),
    refreshCertifications: vi.fn(),
  } as LearningRepository;
}

function Probe() {
  const learning = useLearning();
  observedLearning = learning;
  const lock = learning.lockedReason("warehouse", "receive_stock");
  return (
    <div>
      <span data-testid="loading">{String(learning.loading)}</span>
      <span data-testid="error">{learning.error ?? "none"}</span>
      <span data-testid="stale">{String(learning.stale)}</span>
      <span data-testid="snapshot">
        {learning.snapshot?.refreshedAt ?? "none"}
      </span>
      <span data-testid="curricula">
        {learning.snapshot?.curricula.length ?? 0}
      </span>
      <span data-testid="view-live">
        {String(learning.isLiveCapability("warehouse", "view_inventory"))}
      </span>
      <span data-testid="receive-live">
        {String(learning.isLiveCapability("warehouse", "receive_stock"))}
      </span>
      <span data-testid="lock">{lock?.reason ?? "none"}</span>
      <button onClick={() => learning.resume("receiving-scenario")}>Resume</button>
      <span data-testid="resume">{learning.resumeRequirementId ?? "none"}</span>
      <span data-testid="attempt">{learning.activeTraining?.attemptId ?? "none"}</span>
      <span data-testid="activity-kind">{learning.activeActivity?.kind ?? "none"}</span>
      <span data-testid="activity-attempt">{learning.activeActivity?.attemptId ?? "none"}</span>
      <span data-testid="training-error">{learning.trainingError ?? "none"}</span>
      <button onClick={() => void learning.refresh()}>Refresh</button>
    </div>
  );
}

let observedLearning: LearningContextValue | null = null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const assignedOrientation = (): LearningSnapshot => ({
  ...emptySnapshot(),
  curricula: [
    {
      curriculum: {
        id: "ops",
        version: 1,
        personaId: "operations_associate",
        audience: "internal",
        requirementIds: ["receiving-scenario"],
      },
      source: "role",
      requirements: [
        {
          id: "receiving-scenario",
          version: 1,
          audience: "internal",
          kind: "orientation",
          title: "Receiving practice",
          mandatory: true,
          prerequisiteIds: [],
          capabilityOutcomes: [],
          simulationId: "receiving-sim",
        },
      ],
    },
  ],
  progress: [
    {
      assignmentRequirementId: "assignment-1",
      requirementId: "receiving-scenario",
      requirementVersion: 1,
      state: "not_started",
      attemptCount: 0,
      allowsSharedCompletion: false,
      updatedAt: "2026-08-13T00:00:00.000Z",
    },
  ],
});

const assignedActivity = (kind: "assessment" | "policy"): LearningSnapshot => {
  const requirementId = `${kind}-1`;
  return {
    ...emptySnapshot(),
    curricula: [
      {
        curriculum: {
          id: `${kind}-curriculum`,
          version: 1,
          personaId: "operations_associate",
          audience: "internal",
          requirementIds: [requirementId],
        },
        source: "role",
        requirements: [
          {
            id: requirementId,
            version: 1,
            audience: "internal",
            kind,
            title: kind === "assessment" ? "Knowledge check" : "Controlled policy",
            mandatory: true,
            prerequisiteIds: [],
            capabilityOutcomes: [],
            ...(kind === "assessment" ? { passingScore: 80, maxAttempts: 3 } : {}),
          },
        ],
      },
    ],
    progress: [
      {
        assignmentRequirementId: `${kind}-assignment`,
        requirementId,
        requirementVersion: 1,
        state: "not_started",
        attemptCount: 0,
        allowsSharedCompletion: false,
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
    ],
  };
};

describe("LearningProvider", () => {
  it("loads resolved assignments and exposes fail-closed capability helpers", async () => {
    const learningRepository = repository(emptySnapshot());
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );

    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    await waitFor(() =>
      expect(screen.getByTestId("snapshot")).toHaveTextContent(
        "2026-08-13T00:00:00.000Z",
      ),
    );
    expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("view-live")).toHaveTextContent("true");
    expect(screen.getByTestId("receive-live")).toHaveTextContent("false");
    expect(screen.getByTestId("lock")).toHaveTextContent(
      "missing_certification",
    );

    await act(async () => screen.getByRole("button", { name: "Resume" }).click());
    expect(screen.getByTestId("resume")).toHaveTextContent(
      "receiving-scenario",
    );
  });

  it("keeps the previous read-only snapshot visible but marks it stale after refresh failure", async () => {
    let calls = 0;
    const learningRepository = repository(async () => {
      calls += 1;
      if (calls === 1) return emptySnapshot();
      throw new Error("Learning service unavailable");
    });
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await screen.findByText("2026-08-13T00:00:00.000Z");

    await act(async () =>
      screen.getByRole("button", { name: "Refresh" }).click(),
    );

    expect(screen.getByTestId("snapshot")).toHaveTextContent(
      "2026-08-13T00:00:00.000Z",
    );
    expect(screen.getByTestId("stale")).toHaveTextContent("true");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "Learning service unavailable",
    );
  });

  it("starts the governed requirement attempt before opening training", async () => {
    const assigned = assignedOrientation();
    const learningRepository = repository(assigned);
    vi.mocked(learningRepository.startRequirement).mockResolvedValue({
      progress: {
        ...assigned.progress[0]!,
        state: "in_progress",
        attemptCount: 1,
        activeAttempt: {
          id: "attempt-1",
          attemptNumber: 1,
          mode: "scenario",
          startedAt: "2026-08-13T01:00:00.000Z",
        },
      },
      attempt: {
        id: "attempt-1",
        attemptNumber: 1,
        mode: "scenario",
        startedAt: "2026-08-13T01:00:00.000Z",
      },
    });

    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await screen.findByText("2026-08-13T00:00:00.000Z");
    await act(async () => screen.getByRole("button", { name: "Resume" }).click());

    expect(learningRepository.startRequirement).toHaveBeenCalledWith({
      assignmentRequirementId: "assignment-1",
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
    expect(screen.getByTestId("attempt")).toHaveTextContent("attempt-1");
    expect(screen.getByTestId("training-error")).toHaveTextContent("none");
  });

  it.each(["assessment", "policy"] as const)(
    "opens an assigned %s as a reachable governed activity",
    async (kind) => {
      const assigned = assignedActivity(kind);
      const learningRepository = repository(assigned);
      vi.mocked(learningRepository.startRequirement).mockResolvedValue({
        progress: {
          ...assigned.progress[0]!,
          state: "in_progress",
          attemptCount: kind === "assessment" ? 1 : 0,
        },
        attempt:
          kind === "assessment"
            ? {
                id: "assessment-attempt-1",
                attemptNumber: 1,
                mode: "assessment",
                startedAt: "2026-08-13T01:00:00.000Z",
              }
            : undefined,
      });

      render(
        <LearningProvider repository={learningRepository}>
          <Probe />
        </LearningProvider>,
      );
      await screen.findByText("2026-08-13T00:00:00.000Z");
      await act(async () => observedLearning!.resume(`${kind}-1`));

      await waitFor(() =>
        expect(screen.getByTestId("activity-kind")).toHaveTextContent(kind),
      );
      expect(screen.getByTestId("activity-attempt")).toHaveTextContent(
        kind === "assessment" ? "assessment-attempt-1" : "none",
      );
      expect(screen.getByTestId("training-error")).toHaveTextContent("none");
    },
  );

  it("refreshes when the window regains focus", async () => {
    const learningRepository = repository(emptySnapshot());
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await waitFor(() =>
      expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(1),
    );

    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(2),
    );
  });

  it("refreshes when the active role assignment changes", async () => {
    const learningRepository = repository(emptySnapshot());
    const { rerender } = render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await waitFor(() =>
      expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(1),
    );

    session.userRoles = { warehouse: ["operations"] };
    rerender(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );

    await waitFor(() =>
      expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(2),
    );
    session.userRoles = undefined;
  });

  it("derives a role-accurate preview snapshot in local memory mode", async () => {
    session.mode = "memory";
    session.userRoles = {
      core: ["staff"],
      warehouse: ["operations"],
    };
    render(
      <LearningProvider>
        <Probe />
      </LearningProvider>,
    );

    await waitFor(() =>
      expect(Number(screen.getByTestId("curricula").textContent)).toBeGreaterThan(0),
    );
    expect(screen.getByTestId("lock")).toHaveTextContent("none");
    session.userRoles = undefined;
    session.mode = "supabase";
  });

  it("hides principal-bound state synchronously when the authenticated profile changes", async () => {
    const nextSnapshot = deferred<LearningSnapshot>();
    const learningRepository = repository(emptySnapshot());
    vi.mocked(learningRepository.resolveAssignments)
      .mockResolvedValueOnce(emptySnapshot())
      .mockImplementationOnce(() => nextSnapshot.promise);
    const { rerender } = render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await screen.findByText("2026-08-13T00:00:00.000Z");

    session.profile = {
      id: "learner-2",
      email: "other@mwell.test",
      kind: "employee",
    };
    rerender(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );

    expect(screen.getByTestId("snapshot")).toHaveTextContent("none");
    nextSnapshot.resolve(emptySnapshot("2026-08-13T02:00:00.000Z"));
    await screen.findByText("2026-08-13T02:00:00.000Z");
    session.profile = {
      id: "learner-1",
      email: "operator@mwell.test",
      kind: "employee",
    };
  });

  it("rejects an operational scenario when no domain adapter is registered", async () => {
    clearTrainingAdaptersForTests();
    const orientation = assignedOrientation();
    const assigned: LearningSnapshot = {
      ...orientation,
      curricula: orientation.curricula.map((curriculum) => ({
        ...curriculum,
        requirements: curriculum.requirements.map((requirement) => ({
          ...requirement,
          kind: "scenario" as const,
        })),
      })),
    };
    const learningRepository = repository(assigned);
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await screen.findByText("2026-08-13T00:00:00.000Z");

    await act(async () => screen.getByRole("button", { name: "Resume" }).click());

    expect(learningRepository.startRequirement).not.toHaveBeenCalled();
    expect(screen.getByTestId("training-error")).toHaveTextContent(
      "Guided practice for this step is being prepared",
    );
  });

  it("rejects checkpoint completion after the principal changes", async () => {
    const assigned = assignedOrientation();
    const learningRepository = repository(assigned);
    vi.mocked(learningRepository.startRequirement).mockResolvedValue({
      progress: {
        ...assigned.progress[0]!,
        state: "in_progress",
        attemptCount: 1,
      },
      attempt: {
        id: "attempt-1",
        attemptNumber: 1,
        mode: "scenario",
        startedAt: "2026-08-13T01:00:00.000Z",
      },
    });
    const checkpoint = deferred<LearningSnapshot["progress"][number]>();
    vi.mocked(learningRepository.checkpoint).mockImplementation(
      () => checkpoint.promise,
    );
    const { rerender } = render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await screen.findByText("2026-08-13T00:00:00.000Z");
    await act(async () => screen.getByRole("button", { name: "Resume" }).click());

    const completion = observedLearning!.recordCheckpoint({
      assignmentRequirementId: "assignment-1",
      attemptId: "attempt-1",
      scenarioId: "receiving-sim",
      checkpointId: "complete",
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      terminal: true,
    });
    session.profile = {
      id: "learner-2",
      email: "other@mwell.test",
      kind: "employee",
    };
    rerender(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    checkpoint.resolve({
      ...assigned.progress[0]!,
      state: "passed",
      completedAt: "2026-08-13T02:00:00.000Z",
    });
    await expect(completion).rejects.toThrow(
      "Training authority changed before progress was confirmed",
    );
    session.profile = {
      id: "learner-1",
      email: "operator@mwell.test",
      kind: "employee",
    };
  });

  it("rejects a terminal checkpoint when canonical readback is not terminal", async () => {
    const assigned = assignedOrientation();
    const inProgress = {
      ...assigned.progress[0]!,
      state: "in_progress" as const,
      attemptCount: 1,
      activeAttempt: {
        id: "attempt-1",
        attemptNumber: 1,
        mode: "scenario" as const,
        startedAt: "2026-08-13T01:00:00.000Z",
      },
    };
    const learningRepository = repository(assigned);
    vi.mocked(learningRepository.startRequirement).mockResolvedValue({
      progress: inProgress,
      attempt: inProgress.activeAttempt,
    });
    vi.mocked(learningRepository.checkpoint).mockResolvedValue({
      ...inProgress,
      state: "passed",
      completedAt: "2026-08-13T02:00:00.000Z",
      activeAttempt: undefined,
    });
    vi.mocked(learningRepository.resolveAssignments)
      .mockResolvedValueOnce(assigned)
      .mockResolvedValueOnce({
        ...assigned,
        progress: [{ ...inProgress, state: "passed" as const }],
      });
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await screen.findByText("2026-08-13T00:00:00.000Z");
    await act(async () => screen.getByRole("button", { name: "Resume" }).click());

    await expect(
      observedLearning!.recordCheckpoint({
        assignmentRequirementId: "assignment-1",
        attemptId: "attempt-1",
        scenarioId: "receiving-sim",
        checkpointId: "complete",
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
        terminal: true,
      }),
    ).rejects.toThrow("Training completion is not terminal in canonical readback");
  });

  it("confirms assessment, policy, and support commands through canonical readback", async () => {
    const initial = emptySnapshot();
    const confirmed = {
      ...emptySnapshot("2026-08-13T03:00:00.000Z"),
      progress: [
        {
          assignmentRequirementId: "assessment-1",
          requirementId: "assessment",
          requirementVersion: 1,
          state: "passed" as const,
          attemptCount: 1,
          allowsSharedCompletion: false,
          completedAt: "2026-08-13T03:00:00.000Z",
          updatedAt: "2026-08-13T03:00:00.000Z",
        },
        {
          assignmentRequirementId: "policy-1",
          requirementId: "policy",
          requirementVersion: 1,
          state: "passed" as const,
          attemptCount: 0,
          allowsSharedCompletion: true,
          completedAt: "2026-08-13T03:00:00.000Z",
          updatedAt: "2026-08-13T03:00:00.000Z",
        },
      ],
    } satisfies LearningSnapshot;
    const supportConfirmed = {
      ...confirmed,
      progress: confirmed.progress.map((item) =>
        item.assignmentRequirementId === "assessment-1"
          ? { ...item, state: "needs_support" as const, completedAt: undefined }
          : item,
      ),
    } satisfies LearningSnapshot;
    const learningRepository = repository(initial);
    vi.mocked(learningRepository.resolveAssignments)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(confirmed)
      .mockResolvedValueOnce(confirmed)
      .mockResolvedValueOnce(supportConfirmed);
    vi.mocked(learningRepository.submitAssessment).mockResolvedValue({
      assignmentRequirementId: "assessment-1",
      passed: true,
      score: 100,
      attemptNumber: 1,
      state: "passed",
    });
    vi.mocked(learningRepository.acknowledgePolicy).mockResolvedValue(undefined);
    vi.mocked(learningRepository.requestSupport).mockResolvedValue(undefined);
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await screen.findByText("2026-08-13T00:00:00.000Z");

    await act(async () => {
      await observedLearning!.submitAssessment({
        assignmentRequirementId: "assessment-1",
        attemptId: "attempt-1",
        answers: [{ questionId: "q1", answerId: "a1" }],
      });
      await observedLearning!.acknowledgePolicy({
        assignmentRequirementId: "policy-1",
        controlledDocumentId: "policy",
        controlledDocumentVersion: "4.2",
        evidenceHash: "sha256:evidence",
      });
      await observedLearning!.requestSupport({
        assignmentRequirementId: "assessment-1",
        reason: "Please provide coaching.",
      });
    });

    expect(learningRepository.submitAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentRequirementId: "assessment-1",
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      }),
    );
    expect(learningRepository.acknowledgePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        controlledDocumentVersion: "4.2",
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      }),
    );
    expect(learningRepository.requestSupport).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Please provide coaching.",
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      }),
    );
    expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId("snapshot")).toHaveTextContent(
      "2026-08-13T03:00:00.000Z",
    );
  });

  it("does not publish an assessment result that canonical readback cannot confirm", async () => {
    const initial = emptySnapshot();
    const learningRepository = repository(initial);
    vi.mocked(learningRepository.resolveAssignments)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial);
    vi.mocked(learningRepository.submitAssessment).mockResolvedValue({
      assignmentRequirementId: "assessment-1",
      passed: true,
      score: 100,
      attemptNumber: 1,
      state: "passed",
    });
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await screen.findByText("2026-08-13T00:00:00.000Z");

    await expect(
      observedLearning!.submitAssessment({
        assignmentRequirementId: "assessment-1",
        attemptId: "attempt-1",
        answers: [{ questionId: "q1", answerId: "a1" }],
      }),
    ).rejects.toThrow("Assessment result could not be confirmed by readback");
    expect(screen.getByTestId("snapshot")).toHaveTextContent(
      "2026-08-13T00:00:00.000Z",
    );
  });

  it("marks access stale when the governed capability projection cannot refresh", async () => {
    const initial = emptySnapshot();
    const learningRepository = repository(initial);
    session.refreshCapabilities = vi.fn().mockResolvedValue(false);
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await screen.findByText("2026-08-13T00:00:00.000Z");

    await expect(observedLearning!.refreshAccess()).resolves.toBe(false);
    await waitFor(() => {
      expect(screen.getByTestId("stale")).toHaveTextContent("true");
      expect(screen.getByTestId("error")).toHaveTextContent(
        "Your access status could not be refreshed",
      );
    });
  });
});
