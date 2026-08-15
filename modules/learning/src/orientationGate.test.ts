import { describe, expect, it } from "vitest";
import type { LearningSnapshot, RequirementProgressState } from "./types";
import {
  roleOrientationState,
  sanitizeOnboardingReturnPath,
} from "./orientationGate";

function snapshot(state?: RequirementProgressState): LearningSnapshot {
  return {
    curricula: [
      {
        curriculum: {
          id: "general-employee",
          version: 1,
          personaId: "general_employee",
          audience: "internal",
          requirementIds: ["role-orientation", "policy"],
        },
        source: "role",
        requirements: [
          {
            id: "role-orientation",
            version: 1,
            audience: "internal",
            kind: "orientation",
            title: "Role orientation",
            mandatory: true,
            prerequisiteIds: [],
            capabilityOutcomes: [],
          },
          {
            id: "policy",
            version: 1,
            audience: "internal",
            kind: "policy",
            title: "Controlled policy",
            mandatory: true,
            prerequisiteIds: ["role-orientation"],
            capabilityOutcomes: [],
          },
        ],
      },
    ],
    progress: state
      ? [
          {
            assignmentRequirementId: "assignment-orientation",
            requirementId: "role-orientation",
            requirementVersion: 1,
            state,
            attemptCount: state === "not_started" ? 0 : 1,
            allowsSharedCompletion: true,
            updatedAt: "2026-08-15T00:00:00.000Z",
          },
        ]
      : [],
    certifications: [],
    lockedCapabilities: [],
    refreshedAt: "2026-08-15T00:00:00.000Z",
  };
}

describe("roleOrientationState", () => {
  it("blocks first entry while mandatory role orientation is incomplete", () => {
    expect(roleOrientationState(snapshot("not_started"))).toEqual({
      required: true,
      complete: false,
      completed: 0,
      total: 1,
      pendingRequirementIds: ["role-orientation"],
    });
  });

  it("opens modules after orientation without waiting for later policies", () => {
    expect(roleOrientationState(snapshot("passed"))).toMatchObject({
      required: true,
      complete: true,
      completed: 1,
      total: 1,
    });
  });

  it("does not invent a gate before a snapshot or assignment exists", () => {
    expect(roleOrientationState(null).required).toBe(false);
    expect(
      roleOrientationState({ ...snapshot(), curricula: [] }).required,
    ).toBe(false);
  });
});

describe("sanitizeOnboardingReturnPath", () => {
  it("accepts an internal app route", () => {
    expect(sanitizeOnboardingReturnPath("/procurement/requests/new")).toBe(
      "/procurement/requests/new",
    );
  });

  it("rejects external and malformed destinations", () => {
    expect(sanitizeOnboardingReturnPath("https://example.com")).toBeNull();
    expect(sanitizeOnboardingReturnPath("//example.com/path")).toBeNull();
    expect(sanitizeOnboardingReturnPath("/warehouse\\redirect")).toBeNull();
  });
});
