import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LockedCapabilityRecovery } from "./LockedCapabilityRecovery";
import { LearningContext, type LearningContextValue } from "./LearningProvider";

const value: LearningContextValue = {
  snapshot: {
    curricula: [{
      curriculum: { id: "ops", version: 1, personaId: "operations_associate", audience: "internal", requirementIds: ["receiving"] },
      source: "role",
      requirements: [{
        id: "receiving", version: 1, audience: "internal", kind: "scenario", title: "Receive and inspect controlled stock", mandatory: true, prerequisiteIds: [], capabilityOutcomes: [{ module: "warehouse", capability: "receive_stock" }], simulationId: "warehouse-receiving-v1",
      }],
    }],
    progress: [], certifications: [], lockedCapabilities: [], refreshedAt: "2026-08-13T00:00:00.000Z",
  },
  loading: false, stale: false, error: null, resumeRequirementId: null,
  startingRequirementId: null, trainingError: null, activeTraining: null, activeActivity: null,
  refresh: vi.fn(), resume: vi.fn(), closeTraining: vi.fn(), closeActivity: vi.fn(), recordCheckpoint: vi.fn(),
  submitAssessment: vi.fn(), acknowledgePolicy: vi.fn(), requestSupport: vi.fn(),
  isLiveCapability: vi.fn().mockReturnValue(false), lockedReason: vi.fn().mockReturnValue(null),
};

describe("LockedCapabilityRecovery", () => {
  it("distinguishes a role denial from an onboarding lock", () => {
    const { rerender } = render(
      <LearningContext.Provider value={value}>
        <LockedCapabilityRecovery module="warehouse" capability="receive_stock" reason="role" />
      </LearningContext.Provider>,
    );
    expect(screen.getByText("This action is not assigned to your role")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /resume/i })).not.toBeInTheDocument();

    rerender(
      <LearningContext.Provider value={value}>
        <LockedCapabilityRecovery
          module="warehouse"
          capability="receive_stock"
          reason="training"
          requirementIds={["receiving"]}
        />
      </LearningContext.Provider>,
    );
    expect(screen.getByText("Complete onboarding before this action")).toBeInTheDocument();
    expect(screen.getByText("Receive and inspect controlled stock")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resume onboarding" })).toHaveAttribute(
      "href",
      "/onboarding?requirement=receiving",
    );
  });
});
