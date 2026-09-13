import { describe, expect, it } from "vitest";
import { warehouseModule } from "@intra/rbac";
import { KNOWLEDGE_CONTENT } from "./content";
import { KNOWLEDGE_ROLES } from "./roles";
import { validateTaskCoverage } from "./coverage";

const feature = KNOWLEDGE_CONTENT.features.find(item => item.id === "warehouse-product-detail")!;
const control = (name: string) => feature.controls.find(item => item.name === name)!;
const field = (name: string) => feature.fields!.find(item => item.name === name)!;
const article = KNOWLEDGE_CONTENT.articles.find(item => item.id === "feature-warehouse-product-detail")!;
const steps = article.sections.find(item => item.id === "controls")!.steps!;

describe("inventory recommendation guidance", () => {
  it.each(["Recommend replenishment", "Save recommendation"])("restricts %s actors without narrowing page readers", name => {
    const owners = KNOWLEDGE_ROLES.filter(role => role.rbacModule === "warehouse" && role.rbacRole &&
      warehouseModule.roles[role.rbacRole as keyof typeof warehouseModule.roles]?.capabilities.includes("recommend_replenishment"))
      .map(role => role.id).sort();
    expect(owners).toEqual(["warehouse_operations"]);
    expect(control(name)).toBeDefined();
    expect(control(name).ownerRoleIds).toEqual(owners);
    expect(steps.find(step => step.title === name)!.ownerRoleIds).toEqual(owners);
    expect(control(name).validation).toContain("Viewing inventory alone does not allow recommendations");
    expect(control(name).validation).toContain("current recommendation permission and any required training");
    for (const reader of ["warehouse_operator", "warehouse_supervisor", "warehouse_admin", "warehouse_finance", "warehouse_procurement"]) {
      expect(feature.roleIds).toContain(reader);
      expect(control(name).ownerRoleIds).not.toContain(reader);
    }
  });

  it.each([
    [["warehouse_operations"], true],
    [["warehouse_operations", "warehouse_operator"], true],
    [["warehouse_operations", "warehouse_supervisor"], true],
    [["warehouse_operator"], false],
    [["warehouse_supervisor"], false],
    [["warehouse_admin"], false],
    [["warehouse_finance", "warehouse_procurement"], false],
  ] as const)("represents role alternatives for %j, not a new session grant", (roles, expected) => {
    expect(control("Save recommendation")).toBeDefined();
    expect(roles.some(role => control("Save recommendation").ownerRoleIds!.includes(role))).toBe(expected);
  });

  it("preserves the reader fallback for cancel and every unrelated control", () => {
    expect(control("Cancel")).toBeDefined();
    expect(control("Cancel").ownerRoleIds).toBeUndefined();
    for (const item of feature.controls.filter(item => !["Recommend replenishment", "Save recommendation"].includes(item.name))) {
      expect(steps.find(step => step.title === item.name)!.ownerRoleIds).toEqual(feature.roleIds);
    }
    for (const other of KNOWLEDGE_CONTENT.features.filter(item => item.id !== feature.id)) {
      expect(other.controls.every(item => item.ownerRoleIds === undefined)).toBe(true);
    }
    expect(feature.routes).toEqual(["/warehouse/inventory/:id"]);
    expect(feature.capabilityIds).not.toContain("recommend_replenishment");
  });

  it("keeps release labels out of instructions and separates save from Procurement and stock commands", () => {
    expect(JSON.stringify(feature)).not.toMatch(/local candidate|candidate recommendation|deployed-UI claim/);
    expect(JSON.stringify(KNOWLEDGE_CONTENT.features.find(item => item.id === "warehouse-inventory"))).not.toMatch(/local candidate|deployed-UI claim/);
    expect(control("Recommend replenishment").result).toContain("No recommendation is saved by opening");
    expect(control("Save recommendation").result).toContain("Recommendation saved");
    expect(control("Save recommendation").result).toContain("does not accept or hand off");
    expect(feature.writes.join(" ")).toContain("does not create a purchase request or purchase order");
    expect(feature.writes.join(" ")).toContain("does not move stock");
    expect(feature.exceptions.join(" ")).toContain("no Procurement links");
    expect(feature.exceptions.join(" ")).toContain("not available in demo mode");
    expect(control("Cancel").result).toContain("does not undo an already submitted recommendation");
  });

  it("documents editable inputs and honest planning assumptions", () => {
    expect(field("Recommended quantity")).toMatchObject({ required: true });
    expect(field("Recommended quantity").validation).toContain("positive whole number");
    expect(field("Planning assumption (days)")).toMatchObject({ required: true });
    expect(field("Planning assumption (days)").purpose).toContain("starts at 14");
    expect(field("Planning assumption (days)").purpose).toContain("not a demand forecast or a confirmed supplier lead time");
    expect(field("Planning assumption (days)").validation).toContain("zero or a positive whole number");
    expect(field("Rationale")).toMatchObject({ required: true });
    expect(field("Rationale").validation).toContain("non-blank");
    expect(field("Available inventory").purpose).toContain("not physical on-hand");
    expect(field("Minimum stock").validation).toContain("read-only");
  });

  it("keeps advanced statuses read-only and uncertain saves out of blind retries", () => {
    expect(field("Recommendation status").purpose).toContain("No active recommendation");
    expect(field("Recommendation status").validation).toContain("accepted or handed_off is read-only");
    expect(field("Recommendation status").validation).toContain("Planning inputs and Save are hidden");
    expect(field("Recommendation status").validation).toContain("approved recommendation details are not fetched or displayed");
    expect(control("Recommend replenishment").result).toContain("Planning inputs and Save appear only with no active recommendation or recommended status");
    expect(control("Save recommendation").validation).toContain("inputs and Save are hidden");
    expect(control("Save recommendation").validation).toContain("fresh status check");
    expect(control("Save recommendation").validation).toContain("only no active recommendation or recommended");
    expect(feature.exceptions.join(" ")).toContain("Close and reopen to verify its status before retrying");
    expect(feature.exceptions.join(" ")).toContain("unverified status is not proof that no recommendation exists");
  });

  it("adds no screenshot or live signoff credit for the documented controls", () => {
    const coverage = validateTaskCoverage(KNOWLEDGE_CONTENT);
    for (const name of ["Recommend replenishment", "Save recommendation", "Cancel"]) {
      const key = `${feature.id}:${name}`;
      expect(coverage.inventory.find(item => item.key === key)).toMatchObject({ evidenceIds: [], unverified: true });
      expect(coverage.missingActionEvidence).toContain(key);
    }
    expect(coverage.counts.controlEvidenceMatches).toBe(0);
  });

  it("aligns the existing planning panel's recommendation and Procurement decision sequence", () => {
    const planning = KNOWLEDGE_CONTENT.features.find(item => item.id === "warehouse-procurement-planning")!;
    const save = planning.controls.find(item => item.name === "Save recommendation")!;
    const handoff = planning.controls.find(item => item.name === "Hand to Procurement")!;
    expect(save.validation).toContain("current Warehouse recommendation permission");
    expect(save.validation).toContain("update an existing recommended record");
    expect(save.validation).toContain("cannot overwrite accepted or handed_off");
    expect(save.validation).not.toContain("cannot duplicate an active recommendation");
    expect(handoff.behavior).toContain("Procurement Officer or Procurement Administrator");
    expect(handoff.behavior).toContain("Accept");
    expect(handoff.behavior).toContain("Complete Procurement request");
    expect(handoff.behavior).toContain("Create draft & complete handoff");
    expect(handoff.validation).toContain("request-creation permission");
    expect(handoff.validation).toContain("specification and budget evidence");
    expect(handoff.result).toContain("Confirm procurement route");
    expect(handoff.result).toContain("Back to recommendation");
    expect(handoff.result).toContain("If the initial check fails");
    expect(handoff.result).toContain("If saving stops, reopen Warehouse replenishment planning");
    expect(handoff.validation).toContain("current Procurement replenishment-management permission");
    expect(handoff.validation).toContain("Operations recommendation permission alone is not enough");
    expect(handoff.behavior).not.toContain("after Operations accepts");
    expect(handoff.result).toContain("draft purchase request");
    expect(handoff.result).toContain("not an issued purchase order");
    expect(planning.exceptions.join(" ")).toContain("page access does not grant recommendation or acceptance authority");
  });

  it("keeps Procurement acceptance and draft completion distinct from Operations recommendation", () => {
    const article = KNOWLEDGE_CONTENT.articles.find(item => item.id === "warehouse-replenishment-handoff")!;
    const text = JSON.stringify(article);
    expect(text).not.toContain("authorized Operations owner");
    expect(text).toContain("authorized Procurement decision maker");
    expect(text).toContain("Complete Procurement request");
    expect(text).toContain("Create draft & complete handoff");
    expect(text).toContain("Confirm procurement route");
    expect(text).toContain("not a submission or approval");
    expect(text).toContain("Do not recreate an earlier linked draft");
    expect(text).toContain("If saving stops, reopen Warehouse replenishment planning");
  });
});
