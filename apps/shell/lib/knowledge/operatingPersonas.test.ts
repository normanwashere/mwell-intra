import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import {
  OPERATING_PERSONAS,
  OPERATING_PERSONA_GUIDES,
} from "./operatingPersonas";

describe("operating persona guide contracts", () => {
  it("defines one task-first guide for every operating persona", () => {
    expect(OPERATING_PERSONAS).toHaveLength(11);
    expect(Object.keys(OPERATING_PERSONA_GUIDES).sort()).toEqual(
      OPERATING_PERSONAS.map((persona) => persona.id).sort(),
    );
  });

  it("maps every guide to live roles and documented features", () => {
    const roleIds = new Set(KNOWLEDGE_CONTENT.roles.map((role) => role.id));
    const featureIds = new Set(
      KNOWLEDGE_CONTENT.features.map((feature) => feature.id),
    );

    for (const persona of OPERATING_PERSONAS) {
      const guide = OPERATING_PERSONA_GUIDES[persona.id];
      expect(guide, persona.label).toBeDefined();
      expect(guide!.roleIds.length, persona.label).toBeGreaterThan(0);
      expect(guide!.tasks.length, persona.label).toBeGreaterThanOrEqual(3);
      expect(guide!.tasks.length, persona.label).toBeLessThanOrEqual(5);

      for (const roleId of guide!.roleIds) {
        expect(roleIds.has(roleId), `${persona.label}: ${roleId}`).toBe(true);
      }

      for (const task of guide!.tasks) {
        expect(
          featureIds.has(task.featureId),
          `${persona.label}: ${task.featureId}`,
        ).toBe(true);
        expect(task.workspaceHref, `${persona.label}: ${task.title}`).toMatch(
          /^\//,
        );
      }
    }
  });

  it("routes audited persona tasks to their implemented workspaces", () => {
    const taskHref = (personaId: string, taskId: string) =>
      OPERATING_PERSONA_GUIDES[personaId]?.tasks.find(
        (task) => task.id === taskId,
      )?.workspaceHref;

    expect(taskHref("general_employee", "request-stock")).toBe(
      "/warehouse/fulfillment",
    );
    expect(taskHref("operations_lead", "review-adjustment")).toBe(
      "/warehouse/approvals",
    );
    expect(taskHref("legal_compliance_lead", "invite-vendor")).toBe(
      "/legal/invites/new",
    );
  });

  it("provides reviewed screen evidence for every persona task", () => {
    const featureById = new Map(
      KNOWLEDGE_CONTENT.features.map((feature) => [feature.id, feature]),
    );
    const routeMatches = (featureRoute: string, evidenceRoute: string) => {
      const featureSegments = featureRoute.split("/").filter(Boolean);
      const evidenceSegments = evidenceRoute
        .split(/[?#]/, 1)[0]!
        .split("/")
        .filter(Boolean);
      if (featureSegments.some((segment) => segment.startsWith(":")))
        return (
          featureSegments.length === evidenceSegments.length &&
          featureSegments.every(
            (segment, index) =>
              segment.startsWith(":") || segment === evidenceSegments[index],
          )
        );
      return (
        evidenceRoute === featureRoute ||
        evidenceRoute.startsWith(`${featureRoute}/`)
      );
    };

    for (const persona of OPERATING_PERSONAS) {
      for (const task of OPERATING_PERSONA_GUIDES[persona.id]!.tasks) {
        const feature = featureById.get(task.featureId)!;
        expect(
          KNOWLEDGE_CONTENT.evidence.some(
            (item) =>
              item.featureId === feature.id ||
              feature.routes.some((route) => routeMatches(route, item.route)),
          ),
          `${persona.label}: ${task.title}`,
        ).toBe(true);
      }
    }
  });

  it("keeps event, finance, and product guidance aligned with implemented controls", () => {
    const marketingTasks =
      OPERATING_PERSONA_GUIDES.marketing_events_lead!.tasks;
    expect(marketingTasks.map((task) => task.workspaceHref)).toEqual([
      "/events",
      "/events",
      "/events",
      "/events",
    ]);
    expect(
      marketingTasks.find((task) => task.id === "reconcile-event")?.summary,
    ).toMatch(/Finance approval before closure/i);

    const financeTasks = OPERATING_PERSONA_GUIDES.finance_controller!.tasks;
    expect(
      financeTasks.find((task) => task.id === "review-finance-work")?.summary,
    ).toMatch(/valuation, COGS, expense, write-off, and event-settlement/i);
    expect(
      financeTasks.find((task) => task.id === "review-warehouse")
        ?.workspaceHref,
    ).toBe("/finance");
    expect(
      financeTasks.find((task) => task.id === "review-count")?.workspaceHref,
    ).toBe("/finance");
    expect(
      financeTasks.find((task) => task.id === "review-count")?.featureId,
    ).toBe("warehouse-finance");

    expect(
      OPERATING_PERSONA_GUIDES.product_owner!.tasks.find(
        (task) => task.id === "decide-launch",
      )?.summary,
    ).toMatch(/Approve or reject launch/i);
  });

  it("teaches the released custody, correction, and source-routing boundaries", () => {
    const taskSummary = (personaId: string, taskId: string) =>
      OPERATING_PERSONA_GUIDES[personaId]?.tasks.find(
        (task) => task.id === taskId,
      )?.summary;

    expect(taskSummary("operations_associate", "receive-stock")).toMatch(
      /pending[- ]inspection.*unavailable/i,
    );
    expect(taskSummary("operations_associate", "process-return")).toMatch(
      /quarantine.*Quality/i,
    );
    expect(taskSummary("legal_compliance_lead", "review-case")).toMatch(
      /versioned correction request/i,
    );
    expect(taskSummary("vendor_representative", "correct-requirement")).toMatch(
      /requested revision.*resubmit/i,
    );
    expect(taskSummary("general_employee", "track-work")).toMatch(
      /effective capabilities.*Open source/i,
    );
  });
});
