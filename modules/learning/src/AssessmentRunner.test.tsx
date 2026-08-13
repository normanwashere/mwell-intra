import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssessmentRunner, type AssessmentQuestion } from "./AssessmentRunner";
import { LearningContext, type LearningContextValue } from "./LearningProvider";
import type { RequirementDefinition, RequirementProgress } from "./types";

const requirement: RequirementDefinition = {
  id: "receiving-check",
  version: 3,
  audience: "internal",
  kind: "assessment",
  title: "Receiving controls check",
  mandatory: true,
  prerequisiteIds: [],
  capabilityOutcomes: [{ module: "warehouse", capability: "receive_stock" }],
  passingScore: 80,
  maxAttempts: 3,
};

const progress: RequirementProgress = {
  assignmentRequirementId: "ar-assessment",
  requirementId: requirement.id,
  requirementVersion: requirement.version,
  state: "in_progress",
  attemptCount: 1,
  allowsSharedCompletion: false,
  activeAttempt: {
    id: "attempt-assessment",
    attemptNumber: 1,
    mode: "assessment",
    startedAt: "2026-08-13T00:00:00.000Z",
  },
  updatedAt: "2026-08-13T00:00:00.000Z",
};

const questions: readonly AssessmentQuestion[] = [
  {
    id: "batch",
    prompt: "What must be captured for a serialized receipt?",
    options: [
      { id: "batch-and-serial", label: "Batch and each unit serial" },
      { id: "quantity", label: "Quantity only" },
    ],
    explanation: "Batch and unit identity preserve traceability.",
  },
  {
    id: "damage",
    prompt: "Where does damaged stock go?",
    options: [
      { id: "available", label: "Available stock" },
      { id: "quality", label: "Controlled quality review" },
    ],
    explanation: "Damaged stock remains controlled until disposition.",
  },
];

function context(overrides: Partial<LearningContextValue> = {}): LearningContextValue {
  return {
    snapshot: null,
    loading: false,
    stale: false,
    error: null,
    resumeRequirementId: null,
    startingRequirementId: null,
    trainingError: null,
    activeTraining: null,
    activeActivity: null,
    refresh: vi.fn(),
    resume: vi.fn(),
    closeTraining: vi.fn(),
    closeActivity: vi.fn(),
    recordCheckpoint: vi.fn(),
    submitAssessment: vi.fn().mockResolvedValue({
      assignmentRequirementId: "ar-assessment",
      passed: false,
      score: 50,
      attemptNumber: 1,
      state: "failed_retryable",
    }),
    acknowledgePolicy: vi.fn(),
    requestSupport: vi.fn(),
    isLiveCapability: vi.fn().mockReturnValue(false),
    lockedReason: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

describe("AssessmentRunner", () => {
  it("shows one question at a time and submits answer identifiers once", async () => {
    const submitAssessment = vi.fn().mockResolvedValue({
      assignmentRequirementId: "ar-assessment",
      passed: true,
      score: 100,
      attemptNumber: 1,
      state: "passed",
      completedAt: "2026-08-13T00:05:00.000Z",
    });
    render(
      <LearningContext.Provider value={context({ submitAssessment })}>
        <AssessmentRunner requirement={requirement} progress={progress} questions={questions} />
      </LearningContext.Provider>,
    );

    expect(screen.getByRole("group", { name: questions[0]!.prompt })).toBeInTheDocument();
    expect(screen.queryByText(questions[1]!.prompt)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Batch and each unit serial"));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.click(screen.getByLabelText("Controlled quality review"));
    const submit = screen.getByRole("button", { name: "Submit answers" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(submitAssessment).toHaveBeenCalledOnce());
    const payload = submitAssessment.mock.calls[0]![0];
    expect(payload).toEqual({
      assignmentRequirementId: "ar-assessment",
      attemptId: "attempt-assessment",
      answers: [
        { questionId: "batch", answerId: "batch-and-serial" },
        { questionId: "damage", answerId: "quality" },
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(/answerKey|correct/i);
    expect(screen.getByText("Assessment passed")).toBeInTheDocument();
    expect(screen.getByText(questions[0]!.explanation!)).toBeInTheDocument();
  });

  it("offers retry and support recovery without exposing an answer key", async () => {
    const requestSupport = vi.fn().mockResolvedValue(undefined);
    render(
      <LearningContext.Provider value={context({ requestSupport })}>
        <AssessmentRunner
          requirement={requirement}
          progress={{ ...progress, state: "needs_support", activeAttempt: undefined, attemptCount: 3 }}
          questions={questions}
        />
      </LearningContext.Provider>,
    );

    expect(screen.getByText("Attempts exhausted")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What support do you need?"), {
      target: { value: "Please review damaged-delivery routing with me." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request support" }));
    await waitFor(() =>
      expect(requestSupport).toHaveBeenCalledWith({
        assignmentRequirementId: "ar-assessment",
        reason: "Please review damaged-delivery routing with me.",
      }),
    );
  });

  it("gives a failed retryable attempt a direct route to a new governed attempt", async () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    const closeActivity = vi.fn();
    render(
      <LearningContext.Provider value={context({ resume, closeActivity })}>
        <AssessmentRunner requirement={requirement} progress={progress} questions={questions} />
      </LearningContext.Provider>,
    );
    fireEvent.click(screen.getByLabelText("Quantity only"));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.click(screen.getByLabelText("Available stock"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    expect(await screen.findByText("Review and try again")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start another attempt" }));
    expect(closeActivity).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledWith("receiving-check");
  });
});
