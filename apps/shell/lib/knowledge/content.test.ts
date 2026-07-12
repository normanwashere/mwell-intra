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

  it.each([
    [
      "task",
      "Receive, inspect, and put away stock",
      "task",
      /Receive, inspect, and put away stock/i,
    ],
    ["role", "Warehouse operations", "role", /Warehouse operations/i],
    ["page", "Inventory browser", "feature", /Inventory browser/i],
    ["control", "Place hold", "feature", /Quality control/i],
    [
      "field",
      "Destination bin",
      "feature",
      /Warehouse (receiving|product detail)/i,
    ],
    ["status", "partially authorized", "feature", /Intra home/i],
    ["problem", "expected module is absent", "feature", /Intra home/i],
    [
      "policy term",
      "least privilege",
      "task",
      /permissions correct|access authorized/i,
    ],
    ["glossary alias", "PR", "glossary", /Purchase request/i],
  ])(
    "indexes %s language with typed operational context",
    (_surface, query, type, title) => {
      const result = searchKnowledge(KNOWLEDGE_CONTENT, query)[0];

      expect(result).toMatchObject({
        type,
        availability: "live",
      });
      expect(result?.title).toMatch(title);
      expect(result?.destinationContext).toBeTruthy();
      expect(result?.roleContext).toBeInstanceOf(Array);
    },
  );

  it("retains a cross-module flow when any applicable module is filtered", () => {
    const flow = searchKnowledge(KNOWLEDGE_CONTENT, "Procure to pay", {
      module: "procurement",
    }).find((item) => item.href === "/knowledge?flow=procure-to-pay");

    expect(flow).toMatchObject({
      type: "task",
      module: "procurement",
      destinationContext: "End-to-end workflow",
    });
    expect(flow?.moduleContext).toEqual(
      expect.arrayContaining(["procurement", "warehouse", "legal"]),
    );
    expect(flow?.roleContext).toContain("Procurement officer");
  });

  it("ranks usable guidance above roadmap matches unless roadmap is requested", () => {
    const normal = searchKnowledge(KNOWLEDGE_CONTENT, "offline knowledge");
    expect(normal.some((item) => item.availability === "coming_soon")).toBe(
      true,
    );
    expect(normal[0]?.availability).toBe("live");

    const roadmap = searchKnowledge(
      KNOWLEDGE_CONTENT,
      "roadmap offline knowledge",
    );
    expect(roadmap[0]).toMatchObject({
      type: "roadmap",
      availability: "coming_soon",
    });
  });

  it("lists roadmap entries for the legacy future filter without a query", () => {
    const roadmap = searchKnowledge(KNOWLEDGE_CONTENT, "", {
      type: "future",
    });

    expect(roadmap).toHaveLength(KNOWLEDGE_CONTENT.futureFeatures.length);
    expect(roadmap.every((item) => item.type === "roadmap")).toBe(true);
    expect(roadmap.every((item) => item.availability === "coming_soon")).toBe(
      true,
    );
  });

  it.each([
    ["procurement", "Which value threshold applies?", "Procurement officer"],
    [
      "warehouse",
      "What is the inspection disposition?",
      "Warehouse operations",
    ],
    [
      "core",
      "Are department and task permissions correct?",
      "Platform administrator",
    ],
  ] as const)(
    "retains %s workflow steps with substantive module and role context",
    (module, query, roleLabel) => {
      const result = searchKnowledge(KNOWLEDGE_CONTENT, query, {
        module,
      }).find((item) => item.type === "task" && item.href.includes("step="));

      expect(result).toMatchObject({ type: "task", module });
      expect(result?.moduleContext).toContain(module);
      expect(result?.roleContext).toContain(roleLabel);
      expect(result?.href).toContain("flow=");
      expect(result?.href).toContain("step=");
    },
  );

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
