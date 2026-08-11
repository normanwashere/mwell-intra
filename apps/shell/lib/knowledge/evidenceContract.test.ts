import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import {
  KNOWLEDGE_CAPTURE_VIEWPORTS,
  evidenceRequirements,
  validateEvidenceRequirements,
} from "./evidenceContract";

describe("Knowledge Base evidence contract", () => {
  it("requires desktop and mobile evidence with explicit provenance", () => {
    const requirements = evidenceRequirements(KNOWLEDGE_CONTENT);
    const executableLiveNodes = KNOWLEDGE_CONTENT.flows.flatMap((flow) =>
      flow.availability === "live"
        ? flow.nodes.filter((node) =>
            ["start", "action", "handoff"].includes(node.type),
          )
        : [],
    );
    const featureEvidence = KNOWLEDGE_CONTENT.evidence.filter(
      (item) => item.featureId,
    );

    expect(requirements).toHaveLength(
      executableLiveNodes.length + featureEvidence.length,
    );
    expect(
      requirements
        .filter((item) => item.featureId)
        .map((item) => item.featureId),
    ).toEqual(featureEvidence.map((item) => item.featureId));
    expect(
      requirements.filter((item) => item.environment === "production"),
    ).toHaveLength(
      requirements.length -
        requirements.filter((item) => item.environment === "documentation")
          .length,
    );
    expect(
      requirements.filter((item) => item.environment === "documentation"),
    ).toHaveLength(featureEvidence.length);
    expect(requirements.every((item) => item.desktop && item.mobile)).toBe(
      true,
    );
    expect(requirements.every((item) => item.hotspots.length > 0)).toBe(true);
    expect(
      requirements.every((item) => item.expectedLandmark.trim().length > 0),
    ).toBe(true);
    expect(new Set(requirements.map((item) => item.evidenceId)).size).toBe(
      requirements.length,
    );
    expect(KNOWLEDGE_CAPTURE_VIEWPORTS).toEqual({
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 },
    });
  });

  it("never schedules limited workflow guidance for screenshot capture", () => {
    const requirements = evidenceRequirements(KNOWLEDGE_CONTENT);
    const limitedNodeIds = new Set(
      KNOWLEDGE_CONTENT.flows
        .filter((flow) => flow.availability === "limited")
        .flatMap((flow) => flow.nodes.map((node) => node.id)),
    );

    expect(
      requirements.some(
        (item) => item.nodeId && limitedNodeIds.has(item.nodeId),
      ),
    ).toBe(false);
  });

  it("rejects stale or structurally incomplete promoted evidence", () => {
    const requirements = evidenceRequirements(KNOWLEDGE_CONTENT);
    const first = requirements[0]!;
    expect(
      validateEvidenceRequirements(
        [
          {
            ...first,
            sourceCommit: "0".repeat(40),
            hotspots: [],
          },
        ],
        { deployedCommit: "1".repeat(40) },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("source commit"),
        expect.stringContaining("hotspot"),
      ]),
    );
  });

  it("blocks release verification when the deployed commit is unknown", () => {
    const requirements = evidenceRequirements(KNOWLEDGE_CONTENT);

    expect(
      validateEvidenceRequirements(requirements, {
        requireDeployedCommit: true,
      }),
    ).toContain(
      "DEPLOYED_COMMIT is required for release evidence verification",
    );
  });
});
