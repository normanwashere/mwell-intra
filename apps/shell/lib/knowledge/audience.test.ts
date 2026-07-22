import { describe, expect, it } from "vitest";
import { KNOWLEDGE_GUIDE_CONTENT } from "./guideContent";
import {
  knowledgeAudienceForClaims,
  knowledgeContentForAudience,
} from "./audience";
import { searchKnowledge } from "./search";
import { resolveKnowledgeGuide } from "@shell/components/knowledge/KnowledgeBase";

describe("vendor Knowledge Base audience boundary", () => {
  const vendorContent = knowledgeContentForAudience(
    KNOWLEDGE_GUIDE_CONTENT,
    "vendor",
  );

  it("publishes only external onboarding, evidence, signature, recovery, and policy guidance", () => {
    expect(vendorContent.roles.map((role) => role.id)).toEqual([
      "vendor_portal",
    ]);
    expect(
      new Set(vendorContent.features.map((feature) => feature.module)),
    ).toEqual(new Set(["core", "vendor"]));
    expect(
      vendorContent.articles.some((article) =>
        [
          "admin",
          "warehouse",
          "procurement",
          "finance",
          "insights",
          "events",
        ].includes(article.module),
      ),
    ).toBe(false);
  });

  it("removes internal results from search and direct article resolution", () => {
    expect(searchKnowledge(vendorContent, "finance approval")).toEqual([]);
    expect(
      resolveKnowledgeGuide(vendorContent, "role-platform_admin"),
    ).toBeNull();
    expect(
      resolveKnowledgeGuide(vendorContent, "feature-admin-users"),
    ).toBeNull();
    expect(
      resolveKnowledgeGuide(vendorContent, "feature-vendor-application"),
    ).toMatchObject({ kind: "feature" });
  });
});

describe("knowledge audience claims", () => {
  it("fails closed unless the employee audience is explicit", () => {
    expect(knowledgeAudienceForClaims({ kind: "employee" })).toBe("employee");
    expect(knowledgeAudienceForClaims({ kind: "vendor" })).toBe("vendor");
    expect(knowledgeAudienceForClaims({})).toBe("vendor");
    expect(knowledgeAudienceForClaims(null)).toBe("vendor");
  });
});
