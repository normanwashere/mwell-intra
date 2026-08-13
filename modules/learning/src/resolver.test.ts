import { describe, expect, it } from "vitest";

import { resolveEffectiveCurriculum } from "./resolver";
import * as publicApi from "./index";
import type {
  Certification,
  CurriculumDefinition,
  RequirementDefinition,
  RoleCurriculumDefinition,
} from "./types";

const orientation: RequirementDefinition = {
  id: "internal.shared.orientation.v1",
  version: 1,
  audience: "internal",
  kind: "orientation",
  title: "Shared orientation",
  mandatory: true,
  prerequisiteIds: [],
  capabilityOutcomes: [],
};

const financePractice: RequirementDefinition = {
  id: "internal.finance.practice.v1",
  version: 1,
  audience: "internal",
  kind: "scenario",
  title: "Finance practice",
  mandatory: true,
  prerequisiteIds: [orientation.id],
  capabilityOutcomes: [
    { module: "procurement", capability: "approve_request" },
  ],
};

const operationsPractice: RequirementDefinition = {
  id: "internal.operations.practice.v1",
  version: 1,
  audience: "internal",
  kind: "scenario",
  title: "Operations practice",
  mandatory: true,
  prerequisiteIds: [orientation.id],
  capabilityOutcomes: [
    { module: "warehouse", capability: "receive_stock" },
  ],
};

const sharedPolicy: RequirementDefinition = {
  id: "internal.shared.policy.v1",
  version: 1,
  audience: "internal",
  kind: "policy",
  title: "Shared policy",
  mandatory: true,
  prerequisiteIds: [orientation.id],
  capabilityOutcomes: [],
};

const correctiveReceiving: RequirementDefinition = {
  id: "internal.receiving.corrective.v2",
  version: 2,
  audience: "internal",
  kind: "scenario",
  title: "Corrective receiving practice",
  mandatory: true,
  prerequisiteIds: [sharedPolicy.id],
  capabilityOutcomes: [
    { module: "warehouse", capability: "receive_stock" },
  ],
};

const roleCurriculum = (
  id: string,
  module: RoleCurriculumDefinition["module"],
  role: string,
  requirementId: string,
): RoleCurriculumDefinition => ({
  id,
  version: 1,
  personaId: role,
  audience: "internal",
  module,
  role,
  requirementIds: [orientation.id, requirementId],
});

const curriculum = (
  id: string,
  requirementIds: readonly string[],
): CurriculumDefinition => ({
  id,
  version: 1,
  personaId: "operations_associate",
  audience: "internal",
  requirementIds,
});

const certification = (
  sourceRoleAssignmentId: string,
  module: Certification["capability"]["module"],
  capability: string,
): Certification => ({
  id: `cert-${sourceRoleAssignmentId}-${capability}`,
  userId: "user-1",
  departmentId: "department-1",
  sourceRoleAssignmentId,
  capability: { module, capability },
  curriculumId: "curriculum-1",
  curriculumVersion: 1,
  requirementIds: [orientation.id],
  issuedAt: "2026-08-01T00:00:00.000Z",
  effectiveAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-09-01T00:00:00.000Z",
  issuedBy: "learning-service",
});

describe("resolveEffectiveCurriculum", () => {
  it("is available from the learning package public API", () => {
    expect(publicApi.resolveEffectiveCurriculum).toBe(
      resolveEffectiveCurriculum,
    );
  });

  it("deduplicates shared requirements and preserves independent multi-role certification", () => {
    const result = resolveEffectiveCurriculum({
      requirements: [orientation, financePractice, operationsPractice],
      roleCurricula: [
        {
          sourceRoleAssignmentId: "finance-role-1",
          departmentId: "department-1",
          curriculum: roleCurriculum(
            "finance-curriculum",
            "procurement",
            "finance",
            financePractice.id,
          ),
        },
        {
          sourceRoleAssignmentId: "operations-role-1",
          departmentId: "department-1",
          curriculum: roleCurriculum(
            "operations-curriculum",
            "warehouse",
            "warehouse_operator",
            operationsPractice.id,
          ),
        },
      ],
      departmentAssignments: [],
      userAssignments: [],
      activeCertifications: [
        certification(
          "finance-role-1",
          "procurement",
          "approve_request",
        ),
      ],
      now: "2026-08-12T00:00:00.000Z",
    });

    expect(result.requirements.map((requirement) => requirement.id)).toEqual([
      orientation.id,
      financePractice.id,
      operationsPractice.id,
    ]);
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRoleAssignmentId: "finance-role-1",
          state: "certified",
        }),
        expect.objectContaining({
          sourceRoleAssignmentId: "operations-role-1",
          state: "locked",
        }),
      ]),
    );
  });

  it("shows one semantic orientation when multiple personas assign equivalent orientation records", () => {
    const secondOrientation: RequirementDefinition = {
      ...orientation,
      id: "internal.second-persona.orientation.v1",
    };
    const result = resolveEffectiveCurriculum({
      requirements: [orientation, secondOrientation],
      roleCurricula: [
        {
          sourceRoleAssignmentId: "role-1",
          departmentId: "department-1",
          curriculum: {
            id: "multi-persona",
            version: 1,
            personaId: "multi-persona",
            audience: "internal",
            module: "warehouse",
            role: "business_unit",
            requirementIds: [orientation.id, secondOrientation.id],
          },
        },
      ],
      departmentAssignments: [],
      userAssignments: [],
      activeCertifications: [],
    });

    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]?.id).toBe(orientation.id);
  });

  it("combines role, department, and user assignments in prerequisite order", () => {
    const result = resolveEffectiveCurriculum({
      requirements: [
        correctiveReceiving,
        sharedPolicy,
        operationsPractice,
        orientation,
      ],
      roleCurricula: [
        {
          sourceRoleAssignmentId: "operations-role-1",
          departmentId: "department-1",
          curriculum: roleCurriculum(
            "operations-curriculum",
            "warehouse",
            "warehouse_operator",
            operationsPractice.id,
          ),
        },
      ],
      departmentAssignments: [
        {
          sourceId: "department-assignment-1",
          source: "department",
          curriculum: curriculum("department-policy", [sharedPolicy.id]),
        },
      ],
      userAssignments: [
        {
          sourceId: "user-assignment-1",
          source: "user",
          curriculum: curriculum("user-corrective", [
            sharedPolicy.id,
            correctiveReceiving.id,
          ]),
        },
      ],
      activeCertifications: [],
    });

    expect(result.requirements.map((requirement) => requirement.id)).toEqual([
      orientation.id,
      operationsPractice.id,
      sharedPolicy.id,
      correctiveReceiving.id,
    ]);
    expect(
      result.requirements.filter(
        (requirement) => requirement.id === sharedPolicy.id,
      ),
    ).toHaveLength(1);
  });

  it("marks only the affected role capability as retraining required", () => {
    const result = resolveEffectiveCurriculum({
      requirements: [orientation, financePractice, operationsPractice, correctiveReceiving, sharedPolicy],
      roleCurricula: [
        {
          sourceRoleAssignmentId: "finance-role-1",
          departmentId: "department-1",
          curriculum: roleCurriculum(
            "finance-curriculum",
            "procurement",
            "finance",
            financePractice.id,
          ),
        },
        {
          sourceRoleAssignmentId: "operations-role-1",
          departmentId: "department-1",
          curriculum: roleCurriculum(
            "operations-curriculum",
            "warehouse",
            "warehouse_operator",
            operationsPractice.id,
          ),
        },
      ],
      departmentAssignments: [],
      userAssignments: [
        {
          sourceId: "retraining-1",
          source: "retraining",
          sourceRoleAssignmentId: "operations-role-1",
          curriculum: curriculum("receiving-retraining", [correctiveReceiving.id]),
        },
      ],
      activeCertifications: [
        certification(
          "finance-role-1",
          "procurement",
          "approve_request",
        ),
        certification(
          "operations-role-1",
          "warehouse",
          "receive_stock",
        ),
      ],
      now: "2026-08-12T00:00:00.000Z",
    });

    expect(
      result.capabilities.find(
        (item) => item.sourceRoleAssignmentId === "finance-role-1",
      )?.state,
    ).toBe("certified");
    expect(
      result.capabilities.find(
        (item) => item.sourceRoleAssignmentId === "operations-role-1",
      )?.state,
    ).toBe("retraining_required");
  });

  it("keeps retraining isolated when two role assignments grant the same capability", () => {
    const firstRole = roleCurriculum(
      "operations-curriculum-a",
      "warehouse",
      "warehouse_operator",
      operationsPractice.id,
    );
    const secondRole = roleCurriculum(
      "operations-curriculum-b",
      "warehouse",
      "warehouse_supervisor",
      operationsPractice.id,
    );
    const result = resolveEffectiveCurriculum({
      requirements: [orientation, operationsPractice, sharedPolicy, correctiveReceiving],
      roleCurricula: [
        {
          sourceRoleAssignmentId: "operations-role-1",
          departmentId: "department-1",
          curriculum: firstRole,
        },
        {
          sourceRoleAssignmentId: "operations-role-2",
          departmentId: "department-1",
          curriculum: secondRole,
        },
      ],
      departmentAssignments: [],
      userAssignments: [
        {
          sourceId: "retraining-1",
          source: "retraining",
          sourceRoleAssignmentId: "operations-role-1",
          curriculum: curriculum("receiving-retraining", [correctiveReceiving.id]),
        },
      ],
      activeCertifications: [
        certification(
          "operations-role-1",
          "warehouse",
          "receive_stock",
        ),
        certification(
          "operations-role-2",
          "warehouse",
          "receive_stock",
        ),
      ],
      now: "2026-08-12T00:00:00.000Z",
    });

    expect(
      result.capabilities.find(
        (item) => item.sourceRoleAssignmentId === "operations-role-1",
      )?.state,
    ).toBe("retraining_required");
    expect(
      result.capabilities.find(
        (item) => item.sourceRoleAssignmentId === "operations-role-2",
      )?.state,
    ).toBe("certified");
  });

  it("distinguishes an expired exact-role certificate from a missing certificate", () => {
    const expired = certification(
      "operations-role-1",
      "warehouse",
      "receive_stock",
    );
    const result = resolveEffectiveCurriculum({
      requirements: [orientation, operationsPractice],
      roleCurricula: [
        {
          sourceRoleAssignmentId: "operations-role-1",
          departmentId: "department-1",
          curriculum: roleCurriculum(
            "operations-curriculum",
            "warehouse",
            "warehouse_operator",
            operationsPractice.id,
          ),
        },
      ],
      departmentAssignments: [],
      userAssignments: [],
      activeCertifications: [
        { ...expired, expiresAt: "2026-08-10T00:00:00.000Z" },
      ],
      now: "2026-08-12T00:00:00.000Z",
    });

    expect(result.capabilities[0]?.state).toBe("expired");
  });

  it("fails closed when an assignment references an unknown requirement", () => {
    expect(() =>
      resolveEffectiveCurriculum({
        requirements: [orientation],
        roleCurricula: [],
        departmentAssignments: [
          {
            sourceId: "department-assignment-1",
            source: "department",
            curriculum: curriculum("broken", ["missing-requirement"]),
          },
        ],
        userAssignments: [],
        activeCertifications: [],
      }),
    ).toThrow("Unknown learning requirement missing-requirement");
  });

  it("fails closed on cyclic or ambiguous requirement versions", () => {
    const cyclicA = {
      ...orientation,
      id: "cyclic-a",
      prerequisiteIds: ["cyclic-b"],
    };
    const cyclicB = {
      ...orientation,
      id: "cyclic-b",
      prerequisiteIds: ["cyclic-a"],
    };
    expect(() =>
      resolveEffectiveCurriculum({
        requirements: [cyclicA, cyclicB],
        roleCurricula: [],
        departmentAssignments: [
          {
            sourceId: "department-assignment-1",
            source: "department",
            curriculum: curriculum("cyclic", [cyclicA.id]),
          },
        ],
        userAssignments: [],
        activeCertifications: [],
      }),
    ).toThrow("cycle");

    expect(() =>
      resolveEffectiveCurriculum({
        requirements: [orientation, { ...orientation, version: 2 }],
        roleCurricula: [],
        departmentAssignments: [],
        userAssignments: [],
        activeCertifications: [],
      }),
    ).toThrow("Ambiguous learning requirement");
  });
});
