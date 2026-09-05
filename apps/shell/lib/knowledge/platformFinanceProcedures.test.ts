import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { EXPLICIT_FEATURE_DETAILS } from "./featureDetails";

function required<T>(value: T | undefined, label: string): T {
  expect(value, label).toBeDefined();
  if (value === undefined) throw new Error(`Missing required KB definition: ${label}`);
  return value;
}

function controlsFor(id: string) {
  return required(EXPLICIT_FEATURE_DETAILS[id], id).controls;
}

describe("Platform Finance KB procedures", () => {
  it("distinguishes supported manual close sources from reviewable activity", () => {
    const controls = controlsFor("warehouse-finance");
    const prepare = controls.find((item) => item.name === "Prepare close entry")!;
    expect(prepare.behavior).toContain("purchase order, warehouse receipt, or posted payment release");
    expect(prepare.behavior).toContain("business reference");
    expect(prepare.validation).toContain("Returns and adjustments are not manual close sources");
    expect(prepare.validation).toContain("Event settlements remain system-generated");
    expect(prepare.validation).toContain("reauthorized");
    expect(prepare.result).toContain("not transient signed URLs");
    const evidence = KNOWLEDGE_CONTENT.evidence.find((item) => item.id === "ev-role-warehouse-finance")!;
    expect(evidence.featureId).toBe("warehouse-finance");
    expect(evidence.route).toBe("/finance");
    expect(evidence.roleId).toBe("procurement_finance");
    expect(evidence.expectedLandmark).toBe("Prepare close entry");
    expect(required(evidence.hotspots[0], "Finance primary hotspot").instruction).toContain("not every current picker or correction control");
  });

  it("documents same-lineage correction, independent actors and read-only evidence", () => {
    const controls = controlsFor("warehouse-finance");
    const byName = (name: string) => controls.find((item) => item.name === name)!;
    expect(byName("Flag").behavior).toContain("fresh required correction reason");
    expect(byName("Edit and resubmit").behavior).toContain("same ID and expected version");
    expect(byName("Edit and resubmit").validation).toContain("Posted and reconciled entries are immutable");
    expect(byName("Edit and resubmit").validation).toContain("retain entered values");
    expect(byName("Post").validation).toContain("differ from the preparer and any Event settlement approver");
    expect(byName("Reconcile").validation).toContain("preparer, poster, and any Event settlement approver");
    expect(byName("Open evidence").result).toContain("does not enable Prepare, Post, or Reconcile");
    expect(byName("Retry unavailable sources").behavior).toContain("unavailable sources and their required dependencies");
    expect(byName("Retry unavailable sources").behavior).toContain("without reloading successful sources");
  });

  it("documents attributable Product readback and owned follow-up transitions", () => {
    const product = controlsFor("product-governance");
    expect(product.find((item) => item.name === "Decide go-live")!.result).toContain("exact decision reason, actor, and time");
    expect(product.find((item) => item.name === "Acknowledge Operations handoff")!.result).toContain("pending to completed");
    const insights = controlsFor("insights-workspace");
    expect(insights.find((item) => item.name === "Track follow-ups in My Work")!.behavior).toContain("open, acknowledged, and resolved");
    expect(insights.find((item) => item.name === "Acknowledge")!.validation).toContain("requester visibility alone does not permit action");
    expect(insights.find((item) => item.name === "Resolve")!.behavior).toContain("acknowledged follow-up");
    expect(insights.some((item) => item.name === "Acknowledge and resolve follow-up")).toBe(false);
    expect(insights.find((item) => item.name === "Request validation or escalation")!.result).toContain("stable command identity");
    const evidence = KNOWLEDGE_CONTENT.evidence.find((item) => item.id === "ev-insights-workspace")!;
    expect(evidence.capturedAt).toBe("2026-07-14");
    expect(evidence.appCommit).toBe("798798f25fea91ec9c4a5ccba906f3587feb8b12");
  });
});
