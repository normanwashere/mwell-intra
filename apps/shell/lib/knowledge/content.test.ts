import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { KNOWLEDGE_CONTENT } from "./content";
import { searchKnowledge } from "./search";
import { validateKnowledgeBase, validateKnowledgeContent } from "./validate";

describe("Knowledge Base content", () => {
  it("covers every production persona with valid articles and flows", () => {
    expect(KNOWLEDGE_CONTENT.roles).toHaveLength(20);
    expect(validateKnowledgeBase(KNOWLEDGE_CONTENT)).toEqual([]);
    // Tasks 4 and 8 restore strict aggregate validation after workflows and
    // application evidence have been migrated to the Task 1 contracts.
    expect(
      validateKnowledgeContent(KNOWLEDGE_CONTENT, {
        enforceEvidence: false,
      }),
    ).toEqual([]);
  });

  it("resolves task language and common aliases", () => {
    expect(
      searchKnowledge(KNOWLEDGE_CONTENT, "receive stock")[0]?.title,
    ).toMatch(/Receive|Warehouse/i);
    expect(
      searchKnowledge(KNOWLEDGE_CONTENT, "PR").some((item) =>
        item.title.includes("Purchase request"),
      ),
    ).toBe(true);
    expect(searchKnowledge(KNOWLEDGE_CONTENT, "DOA")[0]?.title).toMatch(
      /DOA|department/i,
    );
  });

  it("keeps future capabilities visibly proposed", () => {
    expect(KNOWLEDGE_CONTENT.futureFeatures.length).toBeGreaterThanOrEqual(10);
    expect(
      KNOWLEDGE_CONTENT.futureFeatures.every(
        (item) => item.status === "proposed",
      ),
    ).toBe(true);
  });

  it("provides reviewed screen evidence for every workflow step", () => {
    const evidenceIds = new Set(
      KNOWLEDGE_CONTENT.evidence.map((item) => item.id),
    );
    for (const flow of KNOWLEDGE_CONTENT.flows)
      for (const node of flow.nodes) {
        expect(node.evidenceId, `${flow.id}:${node.id}`).toBeTruthy();
        expect(evidenceIds.has(node.evidenceId!), `${flow.id}:${node.id}`).toBe(
          true,
        );
      }
    expect(
      KNOWLEDGE_CONTENT.evidence.every((item) => item.sensitiveDataReviewed),
    ).toBe(true);
    for (const item of KNOWLEDGE_CONTENT.evidence) {
      expect(
        existsSync(path.resolve("public", item.desktopSrc.replace(/^\//, ""))),
        item.desktopSrc,
      ).toBe(true);
      if (item.mobileSrc)
        expect(
          existsSync(path.resolve("public", item.mobileSrc.replace(/^\//, ""))),
          item.mobileSrc,
        ).toBe(true);
    }
  });

  it("searches governed branches and screenshot instructions", () => {
    expect(
      searchKnowledge(KNOWLEDGE_CONTENT, "return to vendor").some((item) =>
        item.href.includes("flow="),
      ),
    ).toBe(true);
    expect(
      searchKnowledge(KNOWLEDGE_CONTENT, "quality hold").some((item) =>
        item.href.includes("step="),
      ),
    ).toBe(true);
    expect(
      searchKnowledge(KNOWLEDGE_CONTENT, "assigned Mwell email").some((item) =>
        item.href.includes("access-start"),
      ),
    ).toBe(true);
  });

  it("opens glossary terms as detail pages instead of self-filtering cards", () => {
    const accreditation = searchKnowledge(KNOWLEDGE_CONTENT, "Accreditation", {
      type: "glossary",
    })[0];
    expect(accreditation?.href).toBe("/knowledge?glossary=Accreditation");
  });

  it("contains no credential-like documentation content", () => {
    const rendered = JSON.stringify(KNOWLEDGE_CONTENT);
    expect(rendered).not.toMatch(
      /service_role|AUDIT_PASSWORD|VERCEL_OIDC_TOKEN|eyJ[a-zA-Z0-9_-]{20,}\./,
    );
  });
});
