import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { warehouseModule, type WarehouseCapability } from "@intra/rbac";
import { KNOWLEDGE_ROLES } from "./roles";
import { KNOWLEDGE_FLOWS } from "./workflows";

const receipt = KNOWLEDGE_FLOWS.find(flow => flow.id === "receive-to-putaway")!;
const quality = KNOWLEDGE_FLOWS.find(flow => flow.id === "quality-disposition")!;
const node = (id: string) => [...receipt.nodes, ...quality.nodes].find(item => item.id === id)!;
const ownersFor = (capability: WarehouseCapability) => KNOWLEDGE_ROLES
  .filter(role => role.rbacModule === "warehouse" && role.rbacRole &&
    warehouseModule.roles[role.rbacRole as keyof typeof warehouseModule.roles]
      ?.capabilities.includes(capability))
  .map(role => role.id).sort();
const migration = (name: string) => readFileSync(path.resolve(process.cwd(), "../../supabase/migrations", name), "utf8");

describe("source-backed inbound flow ownership (offline guidance, not live certification)", () => {
  it.each([
    ["receive-traceability", "receive_stock"],
    ["receive-record", "receive_stock"],
    ["receive-bin-ready", "transfer_stock"],
    ["receive-putaway", "transfer_stock"],
    ["receive-complete", "transfer_stock"],
    ["quality-start", "inspect_quality"],
    ["quality-inspection", "inspect_quality"],
    ["quality-release", "inspect_quality"],
    ["quality-complete", "inspect_quality"],
    ["quality-hold-review", "release_quality_hold"],
  ] as const)("assigns %s only to current %s role owners", (id, capability) => {
    expect([...node(id).ownerRoleIds].sort()).toEqual(ownersFor(capability));
    for (const reader of ["warehouse_operations", "warehouse_procurement", "warehouse_finance", "warehouse_marketing"]) {
      expect(node(id).ownerRoleIds).not.toContain(reader);
    }
  });

  it.each([
    [["warehouse_operations"], false, false],
    [["warehouse_procurement"], false, false],
    [["warehouse_finance"], false, false],
    [["warehouse_operator"], true, false],
    [["warehouse_supervisor"], true, true],
    [["warehouse_operations", "warehouse_operator"], true, false],
    [["warehouse_operations", "warehouse_supervisor"], true, true],
  ] as const)("keeps documented actor alternatives distinct for %j", (roles, mayInspect, mayReviewHold) => {
    // This checks role alternatives in guidance, not an effective-session authorization decision.
    expect(roles.some(role => node("quality-inspection").ownerRoleIds.includes(role))).toBe(mayInspect);
    expect(roles.some(role => node("quality-hold-review").ownerRoleIds.includes(role))).toBe(mayReviewHold);
  });

  it("retains coordination readers without making them custody executors", () => {
    expect(receipt.roles).toEqual([
      "warehouse_procurement", "warehouse_operator", "warehouse_supervisor",
      "warehouse_logistics_supervisor", "warehouse_operations", "warehouse_finance", "warehouse_admin",
    ]);
    expect(quality.roles).toEqual([
      "warehouse_operator", "warehouse_supervisor", "warehouse_logistics_supervisor",
      "warehouse_operations", "warehouse_procurement", "warehouse_finance", "warehouse_admin",
    ]);
    expect(node("receive-start").ownerRoleIds).toContain("warehouse_procurement");
    expect(node("receive-po-eligible").ownerRoleIds).toContain("warehouse_procurement");
    expect(node("receive-start").body).toContain("does not authorize posting the receipt");
  });

  it("distinguishes receipt inspection independence from later hold review", () => {
    const inspect = node("quality-inspection");
    expect(inspect.body).toContain("receipt inspector must be a different person from the recorded receiver");
    expect(inspect.body).toContain("Combined roles do not waive this separation");
    expect(inspect.body).toContain("current inspection permission and any required training");
    expect(inspect.body).toContain("does not establish the same receiver/inspector rule for every return");
    const hold = node("quality-hold-review");
    expect(hold.body).toContain("hold creator cannot release their own hold");
    expect(hold.body).toContain("do not infer that identity from the latest inspector");
    expect(hold.body).toContain("release reason and evidence");
    expect(hold.body).toContain("Procurement may coordinate corrective evidence but cannot release stock on that role alone");
  });

  it("describes accepted receipt inspection as atomic, not an extra approval", () => {
    const release = node("quality-release");
    expect(release.title).toBe("Verify accepted stock availability");
    expect(release.body).toContain("same transaction");
    expect(release.body).toContain("not a second approval or a separate release command");
    expect(release.body).toContain("After a continuing hold review");
    expect(node("receive-bin-ready").body).toContain("different from the recorded receiver");
    expect(node("receive-bin-ready").body).toContain("hold is released");
    expect(node("receive-bin-ready").body).toContain("Held or pending stock must not enter");
  });

  it("keeps pending inspection out of direct hold release and vendor coordination distinct", () => {
    expect(node("quality-hold-review").body).toContain("Pending inspection cannot be bypassed with direct hold release");
    expect(node("quality-return").body).toContain("Procurement coordination alone does not authorize executing the return");
  });

  it("pins the checked-in receipt and transfer command guards behind the owner mapping", () => {
    const custody = migration("20260826032845_converge_receipt_quality_custody.sql");
    expect(custody).toContain("not core.has_live_cap('warehouse', 'receive_stock')");
    expect(custody).toContain("not core.has_live_cap('warehouse', 'inspect_quality')");
    expect(custody).toContain("if v_receipt.received_by = auth.uid() then");
    expect(custody).toContain("Accepted by independent quality inspection");
    const wrappers = migration("20260813203240_task_1_database_authority_remediation.sql");
    expect(wrappers).toMatch(/warehouse\.transfer\(payload jsonb\)[^\n]+has_live_cap\('warehouse', 'transfer_stock'\)/);
    expect(wrappers).toMatch(/warehouse\.release_quality_hold\(payload jsonb\)[^\n]+has_live_cap\('warehouse', 'release_quality_hold'\)/);
    const release = migration("20260714175318_single_po_receipt_authority.sql").split("create or replace function private.warehouse_release_quality_hold(payload jsonb)")[1]!.split("$$;")[0]!;
    expect(release).toContain("v_hold.created_by=auth.uid()");
    expect(release).toContain("payload->>'target_disposition'<>'accepted'");
    const protection = migration("20260905180530_authorize_accepted_provisional_quality_hold_release.sql");
    expect(protection).toContain("receipt.received_by <> inspection.inspected_by");
    expect(protection).toContain("old.created_by <> inspection.inspected_by");
    expect(protection).toContain("Pending independent inspection holds cannot be released directly");
  });

  it("preserves the existing step and transition sequence without adding evidence", () => {
    expect(receipt.nodes.map(item => item.id)).toEqual([
      "receive-start", "receive-po-eligible", "receive-traceability", "receive-record", "receive-bin-ready",
      "receive-putaway", "receive-complete", "receive-rejected", "receive-revision", "receive-escalated",
    ]);
    expect(quality.nodes.map(item => item.id)).toEqual([
      "quality-start", "quality-inspection", "quality-release", "quality-hold-review", "quality-return",
      "quality-complete", "quality-returned", "quality-held",
    ]);
    expect(receipt.edges.map(item => [item.from, item.to, item.label])).toEqual([
      ["receive-start", "receive-po-eligible", undefined],
      ["receive-po-eligible", "receive-traceability", "Eligible"],
      ["receive-po-eligible", "receive-rejected", "Not eligible"],
      ["receive-traceability", "receive-record", "Complete"],
      ["receive-traceability", "receive-revision", "Incomplete or mismatched"],
      ["receive-record", "receive-bin-ready", undefined],
      ["receive-bin-ready", "receive-putaway", "Accepted, unheld stock and valid bin"],
      ["receive-bin-ready", "receive-escalated", "No valid bin or route"],
      ["receive-bin-ready", "receive-escalated", "Quality not accepted or hold active"],
      ["receive-bin-ready", "receive-escalated", "Destination restricted"],
      ["receive-putaway", "receive-complete", undefined],
    ]);
    expect(quality.edges.map(item => [item.from, item.to, item.label])).toEqual([
      ["quality-start", "quality-inspection", undefined],
      ["quality-inspection", "quality-release", "Accepted"],
      ["quality-inspection", "quality-hold-review", "Hold"],
      ["quality-inspection", "quality-return", "Damaged or return to vendor"],
      ["quality-release", "quality-complete", undefined],
      ["quality-hold-review", "quality-release", "Release as accepted"],
      ["quality-hold-review", "quality-held", "Continue hold and escalate"],
      ["quality-hold-review", "quality-return", "Return to vendor"],
      ["quality-return", "quality-returned", undefined],
    ]);
    for (const flow of [receipt, quality]) {
      expect(flow.startNodeId).toBe(flow.nodes[0]!.id);
      for (const item of flow.nodes) {
        expect(item.evidenceId).toBe(["start", "action", "handoff"].includes(item.type) ? `ev-${item.id}` : undefined);
      }
    }
    // Existing capture roles default to the first owner; do not relabel those artifacts.
    for (const id of ["receive-record", "receive-putaway", "quality-start", "quality-release"]) {
      expect(node(id).ownerRoleIds[0]).toBe("warehouse_logistics_supervisor");
    }
  });
});
