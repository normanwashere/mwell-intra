import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PolicyAcknowledgment } from "./PolicyAcknowledgment";
import { LearningContext, type LearningContextValue } from "./LearningProvider";
import type { RequirementDefinition, RequirementProgress } from "./types";

const requirement: RequirementDefinition = {
  id: "receiving-policy",
  version: 2,
  audience: "internal",
  kind: "policy",
  title: "Receiving custody policy",
  mandatory: true,
  prerequisiteIds: [],
  capabilityOutcomes: [],
};
const progress: RequirementProgress = {
  assignmentRequirementId: "ar-policy",
  requirementId: requirement.id,
  requirementVersion: 2,
  state: "in_progress",
  attemptCount: 0,
  allowsSharedCompletion: true,
  updatedAt: "2026-08-13T00:00:00.000Z",
};

function value(acknowledgePolicy: LearningContextValue["acknowledgePolicy"]): LearningContextValue {
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
    submitAssessment: vi.fn(),
    acknowledgePolicy,
    requestSupport: vi.fn(),
    isLiveCapability: vi.fn().mockReturnValue(false),
    lockedReason: vi.fn().mockReturnValue(null),
  };
}

describe("PolicyAcknowledgment", () => {
  it("requires explicit acceptance and submits the exact controlled version", async () => {
    const acknowledgePolicy = vi.fn().mockResolvedValue(undefined);
    render(
      <LearningContext.Provider value={value(acknowledgePolicy)}>
        <PolicyAcknowledgment
          requirement={requirement}
          progress={progress}
          document={{
            id: "LGL-RCV-004",
            version: "4.2",
            title: "Receiving and custody control",
            owner: "Legal and Compliance",
            effectiveDate: "2026-08-01",
            summary: "Keep received inventory traceable and under controlled custody.",
            sections: ["Capture traceability before stock becomes available."],
            evidenceHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            href: "/knowledge?article=governance-warehouse-receiving",
          }}
        />
      </LearningContext.Provider>,
    );

    expect(screen.getByText("Version 4.2")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Acknowledge policy" });
    expect(submit).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText("I have read and understand this controlled policy version."),
    );
    fireEvent.click(submit);

    await waitFor(() =>
      expect(acknowledgePolicy).toHaveBeenCalledWith({
        assignmentRequirementId: "ar-policy",
        controlledDocumentId: "LGL-RCV-004",
        controlledDocumentVersion: "4.2",
        evidenceHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(screen.getByText("Policy acknowledged")).toBeInTheDocument();
  });
});
