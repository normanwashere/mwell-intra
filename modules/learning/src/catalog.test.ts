import { describe, expect, it } from "vitest";
import {
  CAPABILITY_CLASSIFICATIONS,
  MODULES,
  MODULE_LIST,
  roleCapabilities,
} from "@intra/rbac";

import {
  LEARNING_CATALOG,
  MUTATING_CAPABILITIES,
  CAPABILITY_COVERAGE_CURRICULA,
  ROLE_CURRICULA,
  capabilityKey,
  internalRequirementIds,
  roleCurriculumFor,
  requiredCurriculaFor,
  vendorRequirementIds,
} from "./catalog";
import { OPERATING_PERSONA_IDS } from "./personas";
import { REQUIREMENT_PROGRESS_STATES } from "./types";

const allCurricula = [
  ...LEARNING_CATALOG.curricula,
  ...ROLE_CURRICULA,
  ...CAPABILITY_COVERAGE_CURRICULA,
];

const requirementById = new Map(
  LEARNING_CATALOG.requirements.map((requirement) => [
    requirement.id,
    requirement,
  ]),
);

const requirementCapabilityKeys = (requirementIds: readonly string[]) =>
  requirementIds.flatMap(
    (id) =>
      requirementById
        .get(id)
        ?.capabilityOutcomes.map(capabilityKey) ?? [],
  );

describe("learning catalog", () => {
  it("maps every mutating capability to at least one required curriculum", () => {
    for (const capability of MUTATING_CAPABILITIES) {
      expect(
        requiredCurriculaFor(capability),
        capabilityKey(capability),
      ).not.toHaveLength(0);
    }
  });

  it("defines one audience-safe baseline for every canonical persona", () => {
    for (const personaId of OPERATING_PERSONA_IDS) {
      expect(
        LEARNING_CATALOG.curricula.filter(
          (curriculum) => curriculum.personaId === personaId,
        ),
      ).toHaveLength(1);
    }
    expect(
      internalRequirementIds().some((id) => vendorRequirementIds().includes(id)),
    ).toBe(false);
  });

  it("derives certification paths for every mutating active-role grant", () => {
    const classificationByKey = new Map(
      CAPABILITY_CLASSIFICATIONS.map((item) => [
        capabilityKey(item),
        item.access,
      ]),
    );

    for (const grant of roleCapabilities) {
      const key = `${grant.module}:${grant.cap}`;
      if (classificationByKey.get(key) !== "mutation") continue;

      const curriculum = roleCurriculumFor(grant.module, grant.role);
      expect(curriculum, `${grant.module}:${grant.role}`).toBeDefined();
      expect(
        requirementCapabilityKeys(curriculum?.requirementIds ?? []),
        `${grant.module}:${grant.role} -> ${grant.cap}`,
      ).toContain(key);
    }
  });

  it("keeps known RBAC grants on their authoritative role curriculum", () => {
    expect(
      requirementCapabilityKeys(
        roleCurriculumFor("core", "platform_admin")!.requirementIds,
      ),
    ).toContain("core:manage_vendors");
    expect(
      requirementCapabilityKeys(
        roleCurriculumFor("procurement", "finance")!.requirementIds,
      ),
    ).toContain("procurement:approve_request");
    expect(
      requirementCapabilityKeys(
        roleCurriculumFor("warehouse", "warehouse_supervisor")!.requirementIds,
      ),
    ).toEqual(
      expect.arrayContaining([
        "warehouse:receive_stock",
        "warehouse:manage_inventory",
        "warehouse:approve_stock_adjustment",
      ]),
    );
  });

  it("keeps the Leadership baseline completable without a missing simulation", () => {
    const baseline = LEARNING_CATALOG.curricula.find(
      (curriculum) => curriculum.personaId === "leadership_insights",
    );
    expect(baseline?.requirementIds).toEqual([
      "internal.leadership_insights.orientation.v1",
    ]);
    expect(
      requirementById.get(baseline?.requirementIds[0] ?? "")?.simulationId,
    ).toBeUndefined();
  });

  it("uses the approved shared requirement lifecycle states", () => {
    expect(REQUIREMENT_PROGRESS_STATES).toEqual([
      "not_started",
      "in_progress",
      "passed",
      "failed_retryable",
      "needs_support",
      "expired",
      "waived",
    ]);
  });

  it("keeps mutation classification in parity with the authoritative RBAC registry", () => {
    const registryKeys = MODULE_LIST.flatMap((module) =>
      MODULES[module].capabilities.map(
        (capability) => `${module}:${capability}`,
      ),
    ).sort();
    const classificationKeys = CAPABILITY_CLASSIFICATIONS.map(capabilityKey).sort();

    expect(classificationKeys).toEqual(registryKeys);
    expect(MUTATING_CAPABILITIES.map(capabilityKey).sort()).toEqual(
      CAPABILITY_CLASSIFICATIONS.filter((item) => item.access === "mutation")
        .map(capabilityKey)
        .sort(),
    );
  });

  it("keeps catalog identifiers, audiences, references, prerequisites, and simulations structurally valid", () => {
    const assertUnique = (values: readonly string[], label: string) => {
      expect(new Set(values).size, label).toBe(values.length);
    };
    assertUnique(LEARNING_CATALOG.requirements.map((item) => item.id), "requirements");
    assertUnique(allCurricula.map((item) => item.id), "curricula");
    assertUnique(LEARNING_CATALOG.simulations.map((item) => item.id), "simulations");

    const simulationById = new Map(
      LEARNING_CATALOG.simulations.map((simulation) => [simulation.id, simulation]),
    );
    const classificationByKey = new Map(
      CAPABILITY_CLASSIFICATIONS.map((item) => [capabilityKey(item), item]),
    );

    for (const curriculum of allCurricula) {
      for (const requirementId of curriculum.requirementIds) {
        const requirement = requirementById.get(requirementId);
        expect(requirement, `${curriculum.id}:${requirementId}`).toBeDefined();
        expect(requirement?.audience, `${curriculum.id}:${requirementId}`).toBe(
          curriculum.audience,
        );
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (requirementId: string): void => {
      expect(visiting.has(requirementId), `prerequisite cycle at ${requirementId}`).toBe(false);
      if (visited.has(requirementId)) return;
      const requirement = requirementById.get(requirementId);
      expect(requirement, `missing prerequisite ${requirementId}`).toBeDefined();
      visiting.add(requirementId);
      for (const prerequisiteId of requirement?.prerequisiteIds ?? []) {
        const prerequisite = requirementById.get(prerequisiteId);
        expect(prerequisite, `${requirementId}:${prerequisiteId}`).toBeDefined();
        expect(prerequisite?.audience, `${requirementId}:${prerequisiteId}`).toBe(
          requirement?.audience,
        );
        visit(prerequisiteId);
      }
      visiting.delete(requirementId);
      visited.add(requirementId);
    };

    for (const requirement of LEARNING_CATALOG.requirements) {
      visit(requirement.id);
      for (const outcome of requirement.capabilityOutcomes) {
        expect(classificationByKey.get(capabilityKey(outcome)), capabilityKey(outcome)).toMatchObject({
          access: "mutation",
        });
      }
      if (!requirement.simulationId) continue;
      const simulation = simulationById.get(requirement.simulationId);
      expect(simulation, requirement.id).toBeDefined();
      expect(simulation?.audience, requirement.id).toBe(requirement.audience);
      expect(simulation?.capabilityOutcomes.map(capabilityKey), requirement.id).toEqual(
        requirement.capabilityOutcomes.map(capabilityKey),
      );
    }
  });
});
