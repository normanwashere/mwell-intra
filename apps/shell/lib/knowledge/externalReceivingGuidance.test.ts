import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { buildKnowledgeCoverage, validateTaskCoverage } from "./coverage";
import { featureGuideForPathname } from "./context";
import { CONTEXTUAL_FEATURE_GUIDES } from "./contextIndex";
import { KNOWLEDGE_ROLES } from "./roles";

const featureId = "warehouse-external-receiving";
const feature = () => KNOWLEDGE_CONTENT.features.find(item => item.id === featureId)!;
const control = (name: string) => feature().controls.find(item => item.name === name)!;
const procedure = () => KNOWLEDGE_CONTENT.articles.find(item => item.id === featureId)!;

describe("external PO receiving transition guidance (verification tracked separately)", () => {
  it("covers the route with limited guidance and the existing alternative access gates", () => {
    expect(feature()).toMatchObject({
      availability: "limited", routes: ["/warehouse/external-receiving"], reviewedAt: "2026-10-19",
    });
    expect(feature().capabilityIds).toEqual(["receive_stock", "inspect_quality", "view_procurement"]);
    const coverage = buildKnowledgeCoverage(KNOWLEDGE_CONTENT);
    expect(coverage.routeCoverage.get("/warehouse/external-receiving")).toEqual([featureId]);
    expect(coverage.errors.filter(error => error.includes(featureId) || error.includes("/warehouse/external-receiving"))).toEqual([]);
    expect(featureGuideForPathname(CONTEXTUAL_FEATURE_GUIDES, "/warehouse/external-receiving")?.id).toBe(featureId);
    const article = KNOWLEDGE_CONTENT.articles.find(item => item.id === `feature-${featureId}`)!;
    expect(article.availability).toBe("limited");
    expect(article.summary).toMatch(/October 19 transition update/i);
    expect(article.summary).toMatch(/verification.*release record/i);
    expect(article.summary).not.toMatch(/local candidate|not deployed|is live|is certified/i);
    expect(JSON.stringify(article)).toContain("Required training");
  });

  it("separates evidence confirmation from purchase approval and forbids self-confirmation", () => {
    const confirm = control("Confirm PO record");
    expect(confirm.ownerRoleIds).toEqual(["warehouse_supervisor", "warehouse_logistics_supervisor"]);
    expect(confirm.ownerRoleIds).not.toContain("warehouse_operator");
    expect(confirm.validation).toMatch(/not.*creator/i);
    expect(confirm.validation).toContain("can_confirm");
    expect(confirm.behavior).toMatch(/not purchase approval/i);
    expect(control("Save PO record").validation).toMatch(/creator.*confirmed.*immutable/i);
    expect(control("Return for correction").ownerRoleIds).toEqual(confirm.ownerRoleIds);
  });

  it("keeps custody command owners narrower than workspace readers without granting training", () => {
    const receivers = KNOWLEDGE_ROLES.filter(role => role.module === "warehouse" && role.authority.capabilities.includes("receive_stock"))
      .map(role => role.id).sort();
    for (const name of ["Register emailed PO", "Save PO record", "Attach PO documents", "Record shipment", "Save shipment", "Resume shipment", "Post to Quality", "Retry saved action", "Retry verification"]) {
      expect([...control(name).ownerRoleIds!].sort()).toEqual(receivers);
      expect(control(name).ownerRoleIds).not.toContain("warehouse_procurement");
    }
    expect(feature().roleIds).toContain("warehouse_procurement");
    expect(JSON.stringify(feature())).toMatch(/training.*does not record completion/i);
  });

  it("keeps pending arrivals distinct from posted quantities and stock availability", () => {
    expect(control("Save shipment").behavior).toMatch(/before.*confirmation/i);
    expect(control("Save shipment").result).toMatch(/draft.*no stock/i);
    expect(control("Save shipment").validation).toMatch(/shipment creator/i);
    const post = control("Post to Quality");
    expect(post.validation).toMatch(/confirmed PO.*remaining.*image evidence.*serial/i);
    expect(post.result).toMatch(/held stock.*unassigned staging/i);
    expect(JSON.stringify(feature())).toContain("supplier batch metadata");
    expect(JSON.stringify(feature())).toMatch(/remaining.*ordered.*posted/i);
    expect(JSON.stringify(feature())).toMatch(/excess.*draft/i);
  });

  it("documents independent Quality followed by normal putaway without replacing Procurement", () => {
    expect(procedure().availability).toBe("limited");
    const steps = procedure().sections.find(section => section.id === "procedure")!.steps!;
    expect(steps.map(step => step.title)).toEqual([
      "Register emailed PO", "Save arrival", "Confirm evidence", "Post to Quality",
      "Independent Quality inspection", "Normal putaway",
    ]);
    expect(steps[4]!.instruction).toMatch(/different.*receiver/i);
    expect(steps[5]!.instruction).toMatch(/posted shipment's Open Storage link.*relevant product/);
    expect(steps[5]!.instruction).toContain("retained warehouse, receipt and product context");
    expect(steps[5]!.instruction).toContain("Invalid or unavailable receipt context does not select another warehouse");
    expect(JSON.stringify(procedure())).toMatch(/arrival bin.*custody.*not final putaway/i);
    expect(JSON.stringify(procedure())).toContain("SMTP is unchanged");
    expect(KNOWLEDGE_CONTENT.features.find(item => item.id === "procurement-purchase-orders")!.routes)
      .toEqual(["/procurement/purchase-orders"]);
    expect(KNOWLEDGE_CONTENT.features.find(item => item.id === "warehouse-receiving")!.routes)
      .toEqual(["/warehouse/receiving"]);
    expect(JSON.stringify(procedure())).toMatch(/Procurement.*separate/i);
  });

  it("documents private attachments and same-action recovery without inventing evidence", () => {
    const documents = control("Attach PO documents");
    expect(documents.validation).toMatch(/PDF.*PNG.*JPEG.*WebP.*8 MiB.*HTML.*SVG.*EML/i);
    expect(documents.result).toContain("warehouse-po-evidence");
    expect(documents.result).toMatch(/signed.*no public/i);
    expect(control("Retry saved action").behavior).toMatch(/same.*key.*payload/i);
    expect(control("Retry verification").behavior).toMatch(/readback.*without.*resend/i);
    expect(control("Load more orders").result).toMatch(/not.*empty/i);
    expect(KNOWLEDGE_CONTENT.evidence.filter(item => item.featureId === featureId)).toEqual([]);
    const rows = validateTaskCoverage(KNOWLEDGE_CONTENT).inventory.filter(item => item.featureId === featureId);
    expect(rows).toHaveLength(feature().controls.length);
    expect(rows.every(row => row.unverified && row.evidenceIds.length === 0)).toBe(true);
  });

  it("keeps transitional external receiving alongside available in-app Procurement receiving", () => {
    const manual = readFileSync(new URL("../../../../docs/manual/MWELL_INTRA_USER_MANUAL.md", import.meta.url), "utf8");
    const plan = readFileSync(new URL("../../../../docs/superpowers/plans/2026-10-19-wms-external-po-launch.md", import.meta.url), "utf8");
    const external = manual.split("### External PO Receiving")[1]!.split("\n### ")[0]!;
    for (const [name, text] of Object.entries({ feature: JSON.stringify(feature()), procedure: JSON.stringify(procedure()), manual: external, plan })) {
      expect(text, name).toMatch(/transitional coexistence/i);
      expect(text, name).toMatch(/in-app Procurement.*receiving.*remain[s]? available/i);
      expect(text, name).toMatch(/Procurement is not removed or replaced/i);
    }
    expect(plan).not.toMatch(/without requiring Procurement screens/i);
  });

  it("retains source evidence for future reconciliation without duplicate receiving or invented linking", () => {
    const manual = readFileSync(new URL("../../../../docs/manual/MWELL_INTRA_USER_MANUAL.md", import.meta.url), "utf8");
    const plan = readFileSync(new URL("../../../../docs/superpowers/plans/2026-10-19-wms-external-po-launch.md", import.meta.url), "utf8");
    const external = manual.split("### External PO Receiving")[1]!.split("\n### ")[0]!;
    for (const [name, text] of Object.entries({ feature: JSON.stringify(feature()), procedure: JSON.stringify(procedure()), manual: external, plan })) {
      for (const reference of ["source email", "PO number", "delivery reference", "receipt reference", "evidence"]) {
        expect(text, `${name}: ${reference}`).toContain(reference);
      }
      expect(text, name).toMatch(/future reconciliation.*must not double-receive/i);
      expect(text, name).toMatch(/not retroactive purchase approval/i);
      expect(text, name).toMatch(/no automatic linking or reconciliation is implemented/i);
    }
  });

  it("explains Procurement-emailed documents and both cross-source rejection recovery paths", () => {
    const manual = readFileSync(new URL("../../../../docs/manual/MWELL_INTRA_USER_MANUAL.md", import.meta.url), "utf8");
    const external = manual.split("### External PO Receiving")[1]!.split("\n### ")[0]!;
    for (const [name, text] of Object.entries({ feature: JSON.stringify(feature()), procedure: JSON.stringify(procedure()), manual: external })) {
      expect(text, name).toContain("PO and documents emailed by Procurement");
      expect(text, name).toMatch(/PO number already exists in Intra Procurement.*existing receiving workflow/i);
      expect(text, name).toMatch(/already received through External PO.*Procurement.*blocked/i);
      expect(text, name).toMatch(/reconcile the existing receipt instead of receiving it again/i);
      expect(text, name).toMatch(/Do not change the PO number or supplier to bypass/i);
      expect(text, name).toMatch(/no automatic linking or reconciliation is implemented/i);
      expect(text, name).toMatch(/verification.*release record/i);
      expect(text, name).not.toMatch(/local candidate|not deployed|is live|is certified/i);
    }
  });

  it("keeps the offline procedure candid about deployment, training and the complete handoff", () => {
    const manual = readFileSync(new URL("../../../../docs/manual/MWELL_INTRA_USER_MANUAL.md", import.meta.url), "utf8");
    const external = manual.split("### External PO Receiving")[1]!.split("\n### ")[0]!;
    expect(external).toContain("/warehouse/external-receiving");
    const status = manual.split("## October 19 Transition Update")[1]!.split("\n## ")[0]!;
    expect(status).toMatch(/verification.*release record/i);
    expect(status).toMatch(/does not establish live or certified status/i);
    expect(external).toMatch(/October 19 transition update/i);
    expect(external).toMatch(/verification.*release record/i);
    expect(external).not.toMatch(/local candidate|not deployed|is live|is certified/i);
    expect(external).toMatch(/Required training.*not.*completion/i);
    expect(external).toMatch(/Operations Lead.*not purchase approval/i);
    expect(external).toMatch(/before.*confirmation/i);
    expect(external).toMatch(/held stock.*unassigned staging/i);
    expect(external).toMatch(/independent Quality.*putaway/i);
    expect(external).toMatch(/partial.*remaining/i);
    expect(external).toContain("SMTP is unchanged");
    expect(manual).toContain("## Procurement Flow");
  });
});
