import { describe, expect, it } from "vitest";

import {
  LEARNING_CATALOG,
  MUTATING_CAPABILITIES,
  capabilityKey,
  internalRequirementIds,
  requiredCurriculaFor,
  vendorRequirementIds,
} from "./catalog";
import { OPERATING_PERSONA_IDS } from "./personas";

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
    expect(new Set(LEARNING_CATALOG.curricula.map((item) => item.personaId))).toEqual(
      new Set(OPERATING_PERSONA_IDS),
    );
    expect(
      internalRequirementIds().some((id) => vendorRequirementIds().includes(id)),
    ).toBe(false);
  });
});
