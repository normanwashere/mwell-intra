import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { searchKnowledge } from "./search";
import { validateKnowledgeBase } from "./validate";

describe("Knowledge Base content", () => {
  it("covers every production persona with valid articles and flows", () => {
    expect(KNOWLEDGE_CONTENT.roles).toHaveLength(20);
    expect(validateKnowledgeBase(KNOWLEDGE_CONTENT)).toEqual([]);
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

  it("contains no credential-like documentation content", () => {
    const rendered = JSON.stringify(KNOWLEDGE_CONTENT);
    expect(rendered).not.toMatch(
      /service_role|AUDIT_PASSWORD|VERCEL_OIDC_TOKEN|eyJ[a-zA-Z0-9_-]{20,}\./,
    );
  });
});
