import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { KNOWLEDGE_CONTENT } from "./content";
import { KNOWLEDGE_GUIDE_CONTENT } from "@shell/components/knowledge/KnowledgeBase";
import { ROLE_ROUTE_PARENT_PATHS } from "./roles";
import { searchKnowledge } from "./search";
import {
  validateFeatureSemanticMappings,
  validateKnowledgeBase,
  validateKnowledgeContent,
} from "./validate";

describe("Knowledge Base content", () => {
  it("defines explicit operating data for all 26 role profiles", () => {
    expect(KNOWLEDGE_GUIDE_CONTENT.roles).toHaveLength(26);
    for (const role of KNOWLEDGE_GUIDE_CONTENT.roles) {
      expect(role.dailyTasks.length, `${role.id} daily tasks`).toBeGreaterThan(
        0,
      );
      expect(
        role.responsibilityStages.length,
        `${role.id} responsibility stages`,
      ).toBeGreaterThan(0);
      for (const task of role.dailyTasks) expect(task.trim()).not.toBe("");
      for (const stage of role.responsibilityStages) {
        expect(stage.title.trim(), `${role.id} stage title`).not.toBe("");
        expect(
          stage.responsibility.trim(),
          `${role.id} stage responsibility`,
        ).not.toBe("");
        expect(stage.outcome.trim(), `${role.id} stage outcome`).not.toBe("");
      }
    }
    expect(
      new Set(
        KNOWLEDGE_GUIDE_CONTENT.roles.map((role) =>
          JSON.stringify([role.dailyTasks, role.responsibilityStages]),
        ),
      ).size,
    ).toBe(26);
  });

  it("defines exact policy and flow relationships for all 58 feature profiles", () => {
    expect(KNOWLEDGE_CONTENT.features).toHaveLength(58);
    const flowIds = new Set(KNOWLEDGE_CONTENT.flows.map((flow) => flow.id));
    for (const feature of KNOWLEDGE_CONTENT.features) {
      expect(
        feature.policyBasis.length,
        `${feature.id} policy`,
      ).toBeGreaterThan(0);
      expect(new Set(feature.relatedFlowIds).size).toBe(
        feature.relatedFlowIds.length,
      );
      for (const flowId of feature.relatedFlowIds)
        expect(flowIds.has(flowId), `${feature.id}:${flowId}`).toBe(true);
    }
  });

  it("satisfies semantic policy and workflow mapping rules across all features", () => {
    expect(validateFeatureSemanticMappings(KNOWLEDGE_CONTENT.features)).toEqual(
      [],
    );
  });

  it.each([
    ["warehouse-product-detail", "pricing-and-costing"],
    ["warehouse-finance", "receive-to-putaway"],
    ["warehouse-locations", "event-fulfillment"],
    ["procurement-request-create", "vendor-accreditation"],
    ["warehouse-cycle-counts", "cycle-count-adjustment"],
    ["warehouse-quality", "returns-reconciliation"],
    ["warehouse-exceptions", "exception-and-recovery"],
    ["warehouse-data", "receive-to-putaway"],
    ["warehouse-data", "event-fulfillment"],
    ["warehouse-data", "exception-and-recovery"],
    ["warehouse-data", "returns-reconciliation"],
    ["warehouse-reports", "receive-to-putaway"],
    ["warehouse-reports", "event-fulfillment"],
    ["warehouse-reports", "exception-and-recovery"],
    ["warehouse-reports", "returns-reconciliation"],
  ])("rejects %s when semantic flow %s is omitted", (featureId, flowId) => {
    const feature = structuredClone(
      KNOWLEDGE_CONTENT.features.find((item) => item.id === featureId)!,
    );
    feature.relatedFlowIds = feature.relatedFlowIds.filter(
      (item) => item !== flowId,
    );

    expect(validateFeatureSemanticMappings([feature])).toContain(
      `feature ${featureId} semantic mapping requires flow ${flowId}`,
    );
  });

  it("rejects a governed price revision without pricing policy", () => {
    const feature = structuredClone(
      KNOWLEDGE_CONTENT.features.find(
        (item) => item.id === "warehouse-product-detail",
      )!,
    );
    feature.policyBasis = feature.policyBasis.filter(
      (policy) => !policy.includes("Pricing and valuation policy"),
    );

    expect(validateFeatureSemanticMappings([feature])).toContain(
      "feature warehouse-product-detail semantic mapping requires policy pricing-and-valuation",
    );
  });

  it.each([
    ["warehouse-locations", "Warehouse custody policy", "warehouse-custody"],
    [
      "procurement-request-create",
      "Vendor accreditation policy",
      "vendor-accreditation",
    ],
    [
      "warehouse-cycle-counts",
      "Inventory integrity policy",
      "inventory-integrity",
    ],
    [
      "warehouse-exceptions",
      "Operational resilience",
      "operational-resilience",
    ],
  ])(
    "rejects %s when semantic policy %s is omitted",
    (featureId, policySignal, policyId) => {
      const feature = structuredClone(
        KNOWLEDGE_CONTENT.features.find((item) => item.id === featureId)!,
      );
      feature.policyBasis = feature.policyBasis.filter(
        (policy) => !policy.includes(policySignal),
      );

      expect(validateFeatureSemanticMappings([feature])).toContain(
        `feature ${featureId} semantic mapping requires policy ${policyId}`,
      );
    },
  );

  it("maps every parameterized role route to an explicit concrete parent", () => {
    const parameterizedRoutes = KNOWLEDGE_GUIDE_CONTENT.roles.flatMap((role) =>
      role.authority.accessibleRoutes.filter((route) => route.includes(":")),
    );
    expect(parameterizedRoutes.length).toBeGreaterThan(0);
    for (const route of parameterizedRoutes) {
      expect(ROLE_ROUTE_PARENT_PATHS[route], route).toMatch(/^\/(?!.*:)/);
      expect(ROLE_ROUTE_PARENT_PATHS[route]).not.toBe(route);
    }
  });
  it("covers every production persona with valid articles and flows", () => {
    expect(KNOWLEDGE_CONTENT.roles).toHaveLength(20);
    expect(validateKnowledgeBase(KNOWLEDGE_CONTENT)).toEqual([]);
    expect(validateKnowledgeContent(KNOWLEDGE_CONTENT)).toEqual([]);
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

  it("provides reviewed screen evidence for every executable workflow step", () => {
    const evidenceIds = new Set(
      KNOWLEDGE_CONTENT.evidence.map((item) => item.id),
    );
    for (const flow of KNOWLEDGE_CONTENT.flows)
      for (const node of flow.nodes.filter((item) =>
        ["start", "action", "handoff"].includes(item.type),
      )) {
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

  it("assigns count entry to a role with cycle-count authority", () => {
    const countEntry = KNOWLEDGE_CONTENT.flows
      .flatMap((flow) => flow.nodes)
      .find((node) => node.id === "count-enter")!;
    for (const roleId of countEntry.ownerRoleIds) {
      const role = KNOWLEDGE_CONTENT.roles.find((item) => item.id === roleId)!;
      expect(role.authority.capabilities, roleId).toContain("cycle_count");
    }
  });

  it("keeps evidence capture as one atomic full-regeneration mode", () => {
    const captureSource = readFileSync(
      path.resolve("tests/e2e/capture-knowledge-evidence.spec.ts"),
      "utf8",
    );
    expect(captureSource).not.toContain("CAPTURE_FROM");
    expect(captureSource).not.toContain("REFRESH_HOTSPOTS");
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
