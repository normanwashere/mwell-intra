import { describe, expect, it } from "vitest";
import { MODULES as WAREHOUSE_MODULES } from "../../../../modules/warehouse/src/app/modules";
import {
  ADMIN_NAV,
  DOA_NAV,
  FINANCE_NAV,
  KNOWLEDGE_NAV,
  MODULE_NAV,
  VENDOR_NAV,
} from "../navigation";
import { KNOWLEDGE_CONTENT } from "./content";
import { buildKnowledgeCoverage, LIVE_ROUTE_MANIFEST } from "./coverage";
import type { KnowledgeContent } from "./types";

const cloneContent = (): KnowledgeContent => structuredClone(KNOWLEDGE_CONTENT);

describe("Knowledge Base live coverage", () => {
  it("covers independently maintained shell and warehouse destinations", () => {
    const manifestRoutes = new Set(
      LIVE_ROUTE_MANIFEST.map((item) => item.route),
    );
    const independentShellRoutes = [
      ...MODULE_NAV.map((item) => item.href),
      VENDOR_NAV.href,
      FINANCE_NAV.href,
      ADMIN_NAV.href,
      DOA_NAV.href,
      KNOWLEDGE_NAV.href,
    ];
    const independentWarehouseRoutes = WAREHOUSE_MODULES.map(({ path }) =>
      path === "/" ? "/warehouse" : `/warehouse${path}`,
    );

    for (const route of [
      ...independentShellRoutes,
      ...independentWarehouseRoutes,
    ]) {
      expect(manifestRoutes.has(route), route).toBe(true);
    }
    expect(buildKnowledgeCoverage(KNOWLEDGE_CONTENT).errors).toEqual([]);
  });

  it("documents every router page with complete plain-language feature content", () => {
    expect(LIVE_ROUTE_MANIFEST).toHaveLength(48);
    expect(KNOWLEDGE_CONTENT.features).toHaveLength(LIVE_ROUTE_MANIFEST.length);
    for (const feature of KNOWLEDGE_CONTENT.features) {
      expect(
        feature.purpose.trim().split(/\s+/).length,
        feature.id,
      ).toBeGreaterThan(5);
      expect(feature.roleIds.length, feature.id).toBeGreaterThan(0);
      expect(feature.controls.length, feature.id).toBeGreaterThan(0);
      expect(feature.fields?.length ?? 0, feature.id).toBeGreaterThan(0);
      expect(feature.reads.length, feature.id).toBeGreaterThan(0);
      expect(feature.writes.length, feature.id).toBeGreaterThan(0);
      expect(feature.statuses.length, feature.id).toBeGreaterThan(0);
      expect(feature.notifications?.length ?? 0, feature.id).toBeGreaterThan(0);
      expect(feature.exceptions.length, feature.id).toBeGreaterThan(0);
      expect(
        feature.completionEvidence?.length ?? 0,
        feature.id,
      ).toBeGreaterThan(0);
      expect(feature.owner.trim(), feature.id).not.toBe("");
      expect(feature.reviewedAt, feature.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        KNOWLEDGE_CONTENT.articles.some(
          (article) => article.id === `feature-${feature.id}`,
        ),
        feature.id,
      ).toBe(true);
    }
  });

  it("fails when a live route is undocumented", () => {
    const content = cloneContent();
    content.features = content.features.filter(
      (feature) => !feature.routes.includes("/procurement/requests/new"),
    );

    expect(buildKnowledgeCoverage(content).errors).toContain(
      "live route /procurement/requests/new has no live feature documentation",
    );
  });

  it("fails when a current role capability is undocumented", () => {
    const content = cloneContent();
    for (const feature of content.features) {
      feature.capabilityIds = feature.capabilityIds.filter(
        (capability) => capability !== "manage_notifications",
      );
    }

    expect(buildKnowledgeCoverage(content).errors).toContain(
      "live capability manage_notifications has no live feature documentation",
    );
  });

  it("fails when an administrator surface lacks an authorized administrator", () => {
    const content = cloneContent();
    const adminUsers = content.features.find((feature) =>
      feature.routes.includes("/admin/users"),
    );
    expect(adminUsers).toBeDefined();
    adminUsers!.roleIds = ["core_staff_only"];

    expect(buildKnowledgeCoverage(content).errors).toContain(
      "administrator route /admin/users is not assigned to an authorized administrator role",
    );
  });

  it("fails a live feature that omits controls", () => {
    const content = cloneContent();
    content.features[0]!.controls = [];

    expect(buildKnowledgeCoverage(content).errors).toContain(
      `live feature ${content.features[0]!.id} has no documented controls`,
    );
  });

  it("warns about coming-soon entries without allowing them to cover live routes", () => {
    const content = cloneContent();
    const route = "/admin/doa";
    const feature = content.features.find((item) =>
      item.routes.includes(route),
    );
    expect(feature).toBeDefined();
    feature!.availability = "coming_soon";

    const report = buildKnowledgeCoverage(content);
    expect(report.warnings).toContain(
      `coming-soon feature ${feature!.id} references live route ${route}`,
    );
    expect(report.errors).toContain(
      `live route ${route} has no live feature documentation`,
    );
  });

  it("normalizes optional trailing slashes and parameterized detail routes", () => {
    const content = cloneContent();
    const feature = content.features.find((item) =>
      item.routes.includes("/procurement/requests/:id"),
    );
    expect(feature).toBeDefined();
    feature!.routes = ["/procurement/requests/request-123/"];

    const report = buildKnowledgeCoverage(content);
    expect(report.errors).not.toContain(
      "live route /procurement/requests/:id has no live feature documentation",
    );
    expect(report.routeCoverage.get("/procurement/requests/:id")).toContain(
      feature!.id,
    );
  });
});
