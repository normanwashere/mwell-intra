import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { KNOWLEDGE_CONTENT } from "./content";
import {
  evidenceRequirements,
  validateEvidenceRequirements,
} from "./evidenceContract";
import { KNOWLEDGE_GUIDE_CONTENT } from "./guideContent";
import { ROLE_ROUTE_PARENT_PATHS } from "./roles";
import { DOA_CONFIGURATION_ROLE_IDS, DOA_REVIEW_ROLE_IDS } from "./workflows";
import { ADMINISTRATOR_GUIDES } from "./admin";
import {
  GOVERNANCE_GUIDES,
  HANDBOOK_RELEASE_NOTES,
  OPERATIONS_GLOSSARY,
} from "./governance";
import { TROUBLESHOOTING_GUIDES } from "./troubleshooting";
import { searchKnowledge } from "./search";
import {
  validateFeatureSemanticMappings,
  validateKnowledgeBase,
  validateKnowledgeContent,
} from "./validate";

describe("Knowledge Base content", () => {
  it("covers every required administrator control surface with operational detail", () => {
    expect(ADMINISTRATOR_GUIDES.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "admin-users-roles",
        "admin-departments",
        "admin-doa",
        "admin-procurement-thresholds",
        "admin-legal-checklist",
        "admin-warehouse-structure",
        "admin-receiving-routes",
        "admin-evidence-audit",
      ]),
    );
    for (const item of ADMINISTRATOR_GUIDES) {
      expect(
        item.prerequisites.length,
        `${item.id} prerequisites`,
      ).toBeGreaterThan(0);
      expect(item.authority, `${item.id} authority`).toMatch(
        /administrator|administration/i,
      );
      expect(
        item.configurationFields.length,
        `${item.id} fields`,
      ).toBeGreaterThan(0);
      expect(item.validation.length, `${item.id} validation`).toBeGreaterThan(
        0,
      );
      expect(
        item.affectedUsers.length,
        `${item.id} affected users`,
      ).toBeGreaterThan(0);
      expect(item.auditEffect, `${item.id} audit`).toMatch(
        /record|version|preserv/i,
      );
      expect(item.recovery, `${item.id} recovery`).toBeTruthy();
      expect(item.requiredReview, `${item.id} review`).toBeTruthy();
    }
  });

  it("covers common failures by observed symptom with safe recovery and escalation", () => {
    expect(TROUBLESHOOTING_GUIDES.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "trouble-sign-in",
        "trouble-access-denied",
        "trouble-missing-data",
        "trouble-upload",
        "trouble-offline-write",
        "trouble-rejected-request",
        "trouble-quality-hold",
        "trouble-variance",
        "trouble-stale-session",
      ]),
    );
    for (const item of TROUBLESHOOTING_GUIDES) {
      expect(item.likelyCauses.length, `${item.id} causes`).toBeGreaterThan(0);
      expect(item.safeRecovery.length, `${item.id} recovery`).toBeGreaterThan(
        0,
      );
      expect(item.dataImpact, `${item.id} data impact`).toBeTruthy();
      expect(item.escalationOwner, `${item.id} owner`).toBeTruthy();
      expect(
        item.escalationEvidence.length,
        `${item.id} escalation evidence`,
      ).toBeGreaterThan(0);
      expect(
        item.prohibitedWorkarounds.length,
        `${item.id} prohibited`,
      ).toBeGreaterThan(0);
    }
  });

  it("ties governance controls to approved sources and prohibited workarounds", () => {
    expect(GOVERNANCE_GUIDES.map((item) => item.source).join(" ")).toMatch(
      /Procurement Policy/,
    );
    expect(GOVERNANCE_GUIDES.map((item) => item.source).join(" ")).toMatch(
      /LGL004/,
    );
    expect(GOVERNANCE_GUIDES.map((item) => item.source).join(" ")).toMatch(
      /MNDA/,
    );
    for (const item of GOVERNANCE_GUIDES) {
      expect(
        item.operationalControls.length,
        `${item.id} controls`,
      ).toBeGreaterThan(0);
      expect(item.evidence.length, `${item.id} evidence`).toBeGreaterThan(0);
      expect(
        item.prohibitedWorkarounds.length,
        `${item.id} prohibited`,
      ).toBeGreaterThan(0);
    }
  });

  it("separates live guidance from coming-soon roadmap and expands operating terminology", () => {
    expect(KNOWLEDGE_CONTENT.futureFeatures.length).toBeGreaterThanOrEqual(9);
    expect(
      KNOWLEDGE_CONTENT.futureFeatures.every(
        (item) => item.status === "proposed",
      ),
    ).toBe(true);
    expect(OPERATIONS_GLOSSARY.map((item) => item.term)).toEqual(
      expect.arrayContaining([
        "Delegation of Authority",
        "Segregation of duties",
        "Quality hold",
        "Audit trail",
      ]),
    );
    expect(searchKnowledge(KNOWLEDGE_CONTENT, "failed upload")[0]?.type).toBe(
      "procedure",
    );
    expect(searchKnowledge(KNOWLEDGE_CONTENT, "LGL004")[0]?.title).toMatch(
      /Vendor accreditation/i,
    );
    expect(
      searchKnowledge(KNOWLEDGE_CONTENT, "roadmap offline knowledge")[0],
    ).toMatchObject({
      availability: "coming_soon",
    });
    expect(HANDBOOK_RELEASE_NOTES.map((item) => item.availability)).toEqual(
      expect.arrayContaining(["live", "limited"]),
    );
    for (const note of HANDBOOK_RELEASE_NOTES) {
      expect(
        note.changedWorkflowIds.length,
        `${note.id} workflows`,
      ).toBeGreaterThan(0);
      expect(note.affectedRoleIds.length, `${note.id} roles`).toBeGreaterThan(
        0,
      );
      expect(
        note.administratorAction,
        `${note.id} administrator action`,
      ).toBeTruthy();
    }
    for (const article of KNOWLEDGE_CONTENT.articles) {
      for (const route of article.liveRoutes) {
        expect(
          KNOWLEDGE_CONTENT.features.some(
            (feature) =>
              feature.availability !== "coming_soon" &&
              feature.routes.includes(route),
          ),
          `${article.id} registered route ${route}`,
        ).toBe(true);
      }
    }
    expect(
      searchKnowledge(KNOWLEDGE_CONTENT, "Roadmap capability boundary").find(
        (result) => result.id === "release-roadmap-boundary",
      ),
    ).toMatchObject({ availability: "limited" });
    expect(
      searchKnowledge(KNOWLEDGE_CONTENT, "Maintain departments").find(
        (result) => result.id === "admin-departments",
      ),
    ).toMatchObject({ availability: "limited" });
    expect(
      searchKnowledge(KNOWLEDGE_CONTENT, "Department administration").find(
        (result) =>
          result.id === "admin-departments" && result.type === "feature",
      ),
    ).toMatchObject({ availability: "live" });
  });
  it("defines explicit operating data for all 39 role profiles", () => {
    expect(KNOWLEDGE_GUIDE_CONTENT.roles).toHaveLength(39);
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
    ).toBe(39);
  });

  it("defines exact policy and flow relationships for all 65 feature profiles", () => {
    expect(KNOWLEDGE_CONTENT.features).toHaveLength(65);
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
    expect(KNOWLEDGE_CONTENT.roles).toHaveLength(33);
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
      "procedure",
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
      "decision",
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
      type: "workflow",
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
      }).find(
        (item) =>
          ["action", "decision", "system", "exception", "outcome"].includes(
            item.type,
          ) && item.href.includes("step="),
      );

      expect(result).toMatchObject({ module });
      expect(result?.moduleContext).toContain(module);
      expect(result?.roleContext).toContain(roleLabel);
      expect(result?.href).toContain("flow=");
      expect(result?.href).toContain("step=");
    },
  );

  it("keeps future capabilities visibly proposed", () => {
    expect(KNOWLEDGE_CONTENT.futureFeatures.length).toBeGreaterThanOrEqual(9);
    expect(
      KNOWLEDGE_CONTENT.futureFeatures.every(
        (item) => item.status === "proposed",
      ),
    ).toBe(true);
  });

  it("provides reviewed screen evidence for every executable workflow step", () => {
    const requirements = evidenceRequirements(KNOWLEDGE_CONTENT);
    expect(validateEvidenceRequirements(requirements)).toEqual([]);
    const evidenceIds = new Set(
      KNOWLEDGE_CONTENT.evidence.map((item) => item.id),
    );
    for (const flow of KNOWLEDGE_CONTENT.flows.filter(
      (item) => item.availability === "live",
    ))
      for (const node of flow.nodes.filter((item) =>
        ["start", "action", "handoff"].includes(item.type),
      )) {
        expect(node.evidenceId, `${flow.id}:${node.id}`).toBeTruthy();
        expect(evidenceIds.has(node.evidenceId!), `${flow.id}:${node.id}`).toBe(
          true,
        );
      }
    expect(requirements).toHaveLength(42);
    expect(
      KNOWLEDGE_CONTENT.evidence
        .filter((item) => item.featureId)
        .map((item) => item.featureId),
    ).toEqual(["events-workspace", "my-work", "insights-workspace"]);
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

  it("restricts DOA configuration to Platform and Legal administrators", () => {
    const flow = KNOWLEDGE_CONTENT.flows.find(
      (item) => item.id === "doa-governance",
    )!;
    const executableNodes = flow.nodes.filter((node) =>
      ["start", "action", "decision"].includes(node.type),
    );
    const configurationRoles = new Set(DOA_CONFIGURATION_ROLE_IDS);

    for (const node of executableNodes) {
      expect(node.ownerRoleIds.length, node.id).toBeGreaterThan(0);
      expect(
        node.ownerRoleIds.every((roleId) =>
          configurationRoles.has(roleId as never),
        ),
        `${node.id} owners: ${node.ownerRoleIds.join(", ")}`,
      ).toBe(true);
      if (node.type === "decision") {
        expect(configurationRoles.has(node.authorityRoleId as never)).toBe(
          true,
        );
      }
    }

    const administrationFlow = KNOWLEDGE_CONTENT.flows.find(
      (item) => item.id === "administration",
    )!;
    const administrationDoa = administrationFlow.nodes.find(
      (node) => node.id === "admin-doa" && node.type === "decision",
    )!;
    expect(
      administrationDoa.ownerRoleIds.every((roleId) =>
        configurationRoles.has(roleId as never),
      ),
    ).toBe(true);
    if (administrationDoa.type === "decision") {
      expect(
        configurationRoles.has(administrationDoa.authorityRoleId as never),
      ).toBe(true);
    }

    const procurement = KNOWLEDGE_CONTENT.roles.find(
      (role) => role.id === DOA_REVIEW_ROLE_IDS[0],
    )!;
    expect(procurement.authority.canDo.join(" ")).toMatch(/review.*DOA/i);
    expect(procurement.authority.cannotDo.join(" ")).toMatch(
      /do not create, validate, activate, supersede.*DOA/i,
    );
    expect(
      procurement.authority.canDo.some((capability) =>
        /(?:maintain|configure|administer).*DOA/i.test(capability),
      ),
    ).toBe(false);
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
