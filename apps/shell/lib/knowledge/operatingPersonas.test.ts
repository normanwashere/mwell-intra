import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import {
  OPERATING_PERSONAS,
  OPERATING_PERSONA_GUIDES,
} from "./operatingPersonas";

describe("operating persona guide contracts", () => {
  it("defines one task-first guide for every operating persona", () => {
    expect(OPERATING_PERSONAS).toHaveLength(11);
    expect(Object.keys(OPERATING_PERSONA_GUIDES).sort()).toEqual(
      OPERATING_PERSONAS.map((persona) => persona.id).sort(),
    );
  });

  it("maps every guide to live roles and documented features", () => {
    const roleIds = new Set(KNOWLEDGE_CONTENT.roles.map((role) => role.id));
    const featureIds = new Set(
      KNOWLEDGE_CONTENT.features.map((feature) => feature.id),
    );

    for (const persona of OPERATING_PERSONAS) {
      const guide = OPERATING_PERSONA_GUIDES[persona.id];
      expect(guide, persona.label).toBeDefined();
      expect(guide!.roleIds.length, persona.label).toBeGreaterThan(0);
      expect(guide!.tasks.length, persona.label).toBeGreaterThanOrEqual(3);
      expect(guide!.tasks.length, persona.label).toBeLessThanOrEqual(5);

      for (const roleId of guide!.roleIds) {
        expect(roleIds.has(roleId), `${persona.label}: ${roleId}`).toBe(true);
      }

      for (const task of guide!.tasks) {
        expect(
          featureIds.has(task.featureId),
          `${persona.label}: ${task.featureId}`,
        ).toBe(true);
        expect(task.workspaceHref, `${persona.label}: ${task.title}`).toMatch(
          /^\//,
        );
      }
    }
  });
});
