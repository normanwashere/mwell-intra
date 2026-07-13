import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { WAREHOUSE_ROUTE_CONTRACTS } from "@intra/warehouse";
import { PROCUREMENT_ROUTE_CONTRACTS } from "@intra/procurement";
import { mountLegalRouteContracts } from "@intra/legal";
import { SHELL_PAGE_ROUTE_CONTRACTS } from "../routes";
import { KNOWLEDGE_CONTENT } from "./content";
import { buildKnowledgeCoverage, LIVE_ROUTE_MANIFEST } from "./coverage";
import type { KnowledgeContent } from "./types";

const cloneContent = (): KnowledgeContent => structuredClone(KNOWLEDGE_CONTENT);

function discoverNextPageRoutes(directory = path.resolve("app")): string[] {
  const routes: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      if (!entry.isFile() || entry.name !== "page.tsx") continue;
      const relative = path.relative(directory, current).replaceAll("\\", "/");
      const segments = relative
        .split("/")
        .filter(Boolean)
        .filter((segment) => !segment.startsWith("("));
      const catchAll = segments.findIndex((segment) =>
        segment.startsWith("[[..."),
      );
      const routeSegments =
        catchAll >= 0 ? segments.slice(0, catchAll) : segments;
      routes.push(routeSegments.length ? `/${routeSegments.join("/")}` : "/");
    }
  };
  visit(directory);
  return [...new Set(routes)].sort();
}

const authoritativeRoutes = [
  ...SHELL_PAGE_ROUTE_CONTRACTS,
  ...WAREHOUSE_ROUTE_CONTRACTS.map((entry) => ({
    ...entry,
    route: entry.path === "/" ? "/warehouse" : `/warehouse${entry.path}`,
  })),
  ...PROCUREMENT_ROUTE_CONTRACTS.map((entry) => ({
    ...entry,
    route: entry.path === "/" ? "/procurement" : `/procurement${entry.path}`,
  })),
  ...mountLegalRouteContracts("/legal", "legal"),
  ...mountLegalRouteContracts("/vendor", "vendor"),
];

describe("Knowledge Base live coverage", () => {
  it("matches the Next filesystem in both directions", () => {
    expect(
      SHELL_PAGE_ROUTE_CONTRACTS.map((entry) => entry.route).sort(),
    ).toEqual(discoverNextPageRoutes());
  });

  it("matches every authoritative module route in both directions", () => {
    const expected = [
      ...new Set(authoritativeRoutes.map((entry) => entry.route)),
    ].sort();
    const actual = LIVE_ROUTE_MANIFEST.map((entry) => entry.route).sort();
    expect(actual).toEqual(expected);
    expect(buildKnowledgeCoverage(KNOWLEDGE_CONTENT).errors).toEqual([]);
  });

  it("documents every router page with complete plain-language feature content", () => {
    expect(KNOWLEDGE_CONTENT.features).toHaveLength(58);
    const liveFeatures = KNOWLEDGE_CONTENT.features.filter(
      (feature) => feature.availability !== "coming_soon",
    );
    expect(liveFeatures).toHaveLength(LIVE_ROUTE_MANIFEST.length);
    for (const feature of liveFeatures) {
      const contract = LIVE_ROUTE_MANIFEST.find((entry) =>
        feature.routes.includes(entry.route),
      );
      expect(contract, feature.id).toBeDefined();
      expect(
        feature.purpose.trim().split(/\s+/).length,
        feature.id,
      ).toBeGreaterThan(5);
      expect(feature.roleIds.length, feature.id).toBeGreaterThan(0);
      expect(feature.controls.length, feature.id).toBeGreaterThanOrEqual(
        contract!.minimumControls,
      );
      expect(feature.fields?.length ?? 0, feature.id).toBeGreaterThanOrEqual(
        contract!.minimumFields,
      );
      for (const control of feature.controls) {
        const controlId = `${feature.id}:${control.name}`;
        expect(control.name, controlId).not.toMatch(/,|\band\b/i);
        expect(
          control.behavior.trim().split(/\s+/).length,
          controlId,
        ).toBeGreaterThan(4);
        expect(
          control.validation.trim().split(/\s+/).length,
          controlId,
        ).toBeGreaterThan(4);
        expect(
          control.result.trim().split(/\s+/).length,
          controlId,
        ).toBeGreaterThan(4);
      }
      for (const field of feature.fields ?? []) {
        const fieldId = `${feature.id}:${field.name}`;
        expect(field.name, fieldId).not.toMatch(/,|\band\b/i);
        expect(
          field.purpose.trim().split(/\s+/).length,
          fieldId,
        ).toBeGreaterThan(3);
        expect(
          field.validation.trim().split(/\s+/).length,
          fieldId,
        ).toBeGreaterThan(4);
      }
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

  it("documents DOA controls and fields individually", () => {
    const feature = KNOWLEDGE_CONTENT.features.find(
      (item) => item.id === "admin-doa",
    );
    expect(feature?.controls.map((control) => control.name)).toEqual(
      expect.arrayContaining([
        "Create revision",
        "Activate matrix",
        "Add tier",
        "Remove tier",
        "Save draft",
      ]),
    );
    expect(feature?.fields?.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "Department",
        "Version",
        "Source document",
        "Effective date",
        "Tier",
        "Category",
        "Minimum amount",
        "Maximum amount",
        "Named approver",
      ]),
    );
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
      "live route / capability manage_notifications has no feature documentation",
    );
  });

  it("fails when a feature claims a capability absent from its route contract", () => {
    const content = cloneContent();
    const adminUsers = content.features.find(
      (feature) => feature.id === "admin-users",
    )!;
    adminUsers.capabilityIds.push("record_approval");

    expect(buildKnowledgeCoverage(content).errors).toContain(
      "feature admin-users claims capability record_approval outside route /admin/users",
    );
  });

  it("does not publish unrelated approval capabilities on user administration", () => {
    const adminUsers = KNOWLEDGE_CONTENT.features.find(
      (feature) => feature.id === "admin-users",
    );
    expect(adminUsers?.capabilityIds).toEqual(["manage_rbac"]);
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

  it("fails shallow combined control documentation", () => {
    const content = cloneContent();
    const doa = content.features.find((feature) => feature.id === "admin-doa")!;
    doa.controls = [
      {
        name: "Create revision, activate, and save",
        behavior:
          "Combines several unrelated administration actions into one shallow description.",
        validation:
          "Claims every matrix validation rule applies without naming the actual gate.",
        result:
          "Claims the matrix changes without distinguishing draft or active state.",
      },
    ];

    expect(buildKnowledgeCoverage(content).errors).toContain(
      "live feature admin-doa documents 1 controls; route /admin/doa requires at least 5",
    );
    expect(buildKnowledgeCoverage(content).errors).toContain(
      "live feature admin-doa has combined control name Create revision, activate, and save",
    );
  });

  it("fails shallow combined field documentation", () => {
    const content = cloneContent();
    const doa = content.features.find((feature) => feature.id === "admin-doa")!;
    doa.fields = [
      {
        name: "Department, version, tiers, and approvers",
        purpose: "Combines unrelated matrix inputs into one field description.",
        required: true,
        validation:
          "Claims all values are required without documenting their individual rules.",
      },
    ];

    expect(buildKnowledgeCoverage(content).errors).toContain(
      "live feature admin-doa documents 1 fields; route /admin/doa requires at least 9",
    );
    expect(buildKnowledgeCoverage(content).errors).toContain(
      "live feature admin-doa has combined field name Department, version, tiers, and approvers",
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
