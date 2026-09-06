import { describe, expect, it } from "vitest";
import { projectTaskLearning } from "./taskReadiness";
import type { LearningSnapshot, RequirementDefinition } from "./types";
import { OPERATING_PERSONAS } from "./personas";

const receive = { module: "warehouse" as const, capability: "receive_stock" };
const requirement = (
  id: string,
  prerequisites: string[] = [],
  selected = false,
): RequirementDefinition => ({
  id,
  version: 1,
  audience: "internal",
  kind: "scenario",
  title: "Shared title",
  mandatory: true,
  prerequisiteIds: prerequisites,
  capabilityOutcomes: selected ? [receive] : [],
});
const snapshot = (
  items = [
    requirement("orientation"),
    requirement("policy", ["orientation"]),
    requirement("receive", ["policy"], true),
    requirement("finance"),
  ],
): LearningSnapshot => ({
  curricula: [
    {
      curriculum: {
        id: "assigned",
        version: 1,
        personaId: "operations_associate",
        audience: "internal",
        requirementIds: items.map((r) => r.id),
      },
      source: "role",
      requirements: items,
    },
  ],
  progress: items.map((r) => ({
    requirementId: r.id,
    requirementVersion: r.version,
    assignmentRequirementId: r.id,
    state: "not_started",
    attemptCount: 0,
    allowsSharedCompletion: false,
    updatedAt: "2026-09-06",
  })),
  certifications: [],
  lockedCapabilities: [],
  refreshedAt: "2026-09-06",
});

describe("projectTaskLearning", () => {
  it("orders transitive prerequisites before the selected action without mutating input", () => {
    const input = snapshot();
    const before = structuredClone(input);
    const result = projectTaskLearning(input, "internal", [receive], false);
    expect(result.status).toBe("known");
    expect(result.neededNow.map((r) => r.id)).toEqual([
      "orientation",
      "policy",
      "receive",
    ]);
    expect(result.otherRequired.map((r) => r.id)).toEqual(["finance"]);
    expect(input).toEqual(before);
  });
  it("does not require orientation for a task with no action capabilities", () => {
    expect(
      projectTaskLearning(snapshot(), "internal", [], false).neededNow,
    ).toEqual([]);
    expect(
      projectTaskLearning(snapshot(), "internal", [], false).otherRequired,
    ).toHaveLength(4);
  });
  it("does not impose orientation on a known read-only action", () => {
    const result = projectTaskLearning(
      snapshot(),
      "internal",
      [{ module: "warehouse", capability: "view_inventory" }],
      false,
    );
    expect(result.status).toBe("known");
    expect(result.neededNow).toEqual([]);
  });
  it("never matches progress across ambiguous audiences", () => {
    const input = snapshot();
    const vendor = structuredClone(input.curricula[0]!);
    vendor.curriculum.audience = "vendor";
    vendor.requirements.forEach((r) => {
      r.audience = "vendor";
    });
    input.curricula = [...input.curricula, vendor];
    expect(
      projectTaskLearning(input, "internal", [receive], false).status,
    ).toBe("unavailable");
  });
  it.each(["missing", "cycle", "version", "revoked", "audience", "stale"])(
    "fails closed for %s",
    (failure) => {
      const input = snapshot();
      if (failure === "missing")
        input.curricula[0]!.requirements[2]!.prerequisiteIds = ["missing"];
      if (failure === "cycle")
        input.curricula[0]!.requirements[0]!.prerequisiteIds = ["receive"];
      if (failure === "version")
        input.curricula[0]!.requirements[1]!.version = 2;
      if (failure === "revoked") input.curricula = [];
      expect(
        projectTaskLearning(
          input,
          failure === "audience" ? "vendor" : "internal",
          [receive],
          failure === "stale",
        ).status,
      ).toBe("unavailable");
    },
  );
  it("does not treat missing snapshot or unknown capability as ready", () => {
    expect(projectTaskLearning(null, "internal", [], false).status).toBe(
      "unavailable",
    );
    expect(
      projectTaskLearning(
        snapshot(),
        "internal",
        [{ module: "core", capability: "unknown" }],
        false,
      ).status,
    ).toBe("unavailable");
  });
  it.each(["expired", "needs_support", "failed_retryable"] as const)(
    "retains %s steps",
    (state) => {
      const input = snapshot();
      input.progress[0]!.state = state;
      input.progress[0]!.attemptCount = 3;
      expect(
        projectTaskLearning(input, "internal", [receive], false).neededNow[0]!
          .id,
      ).toBe("orientation");
    },
  );
  it("deduplicates exact multi-role definitions but never competing versions", () => {
    const input = snapshot();
    input.curricula = [
      ...input.curricula,
      structuredClone(input.curricula[0]!),
    ];
    expect(
      projectTaskLearning(input, "internal", [receive], false).neededNow,
    ).toHaveLength(3);
    input.curricula[1]!.requirements[0]!.version = 2;
    expect(
      projectTaskLearning(input, "internal", [receive], false).status,
    ).toBe("unavailable");
  });
  it("requires refresh when server locks disagree with passed progress", () => {
    const input = snapshot();
    input.progress.forEach((p) => {
      p.state = "passed";
    });
    input.lockedCapabilities = [
      {
        capability: receive,
        reason: "expired_certification",
        requirementIds: ["receive"],
        canRequestEmergencyException: false,
      },
    ];
    expect(
      projectTaskLearning(input, "internal", [receive], false).status,
    ).toBe("unavailable");
  });
  it.each(OPERATING_PERSONAS)("uses exact scope for $label", (persona) => {
    const input = snapshot();
    const audience =
      persona.id === "vendor_representative" ? "vendor" : "internal";
    input.curricula[0]!.curriculum.audience = audience;
    input.curricula[0]!.curriculum.personaId = persona.id;
    input.curricula[0]!.requirements.forEach((r) => {
      r.audience = audience;
    });
    expect(
      projectTaskLearning(input, audience, [receive], false).neededNow,
    ).toHaveLength(3);
  });
});
