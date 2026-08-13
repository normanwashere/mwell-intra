import { describe, expect, it } from "vitest";
import {
  availableWorkFilters,
  createWorkRequestAuthority,
  filterWorkItems,
  projectLiveWorkItems,
  scopeWorkItems,
  sortWorkItems,
  workRequestKey,
} from "./data";
import { WORK_DEMO_DATA } from "./seed";

describe("My Work queue", () => {
  it("filters without changing source ownership", () => {
    const items = filterWorkItems(WORK_DEMO_DATA.items, "warehouse");
    expect(items).toHaveLength(1);
    expect(items[0]?.href).toBe("/warehouse/quality");
  });

  it("orders urgent work before normal work", () => {
    const sorted = sortWorkItems(WORK_DEMO_DATA.items);
    expect(sorted[0]?.priority).toBe("high");
    expect(sorted.at(-1)?.priority).toBe("normal");
  });

  it("offers only role-relevant source filters", () => {
    expect(availableWorkFilters(["procurement", "events"])).toEqual([
      { value: "all", label: "All" },
      { value: "procurement", label: "Procurement" },
      { value: "events", label: "Events" },
    ]);
  });

  it("excludes invalid and capability-ineligible records before priority counts", () => {
    const items = scopeWorkItems(
      [
        {
          id: "valid-finance",
          source: "finance",
          title: "Review payment readiness",
          description: "Payment readiness evidence is ready for review.",
          status: "ready for finance",
          priority: "high",
          href: "/finance",
          requiredCapabilities: [
            { module: "warehouse", capability: "view_finance" },
          ],
        },
        {
          id: "missing-source",
          source: "finance",
          title: "Broken record",
          description: "This source record was removed.",
          status: "open",
          priority: "critical",
          href: "/finance",
          requiredCapabilities: [
            { module: "warehouse", capability: "view_finance" },
          ],
          sourceRecordExists: false,
        },
      ],
      (module, capability) =>
        module === "warehouse" && capability === "view_finance",
    );

    expect(items.map((item) => item.id)).toEqual(["valid-finance"]);
    expect(items.filter((item) => item.priority !== "normal")).toHaveLength(1);
  });

  it("keys live requests by principal and effective authority", () => {
    expect(
      workRequestKey("profile-1", {
        procurement: ["view_finance", "approve_request"],
      }),
    ).toBe("profile-1:procurement:approve_request,view_finance");
    expect(workRequestKey("profile-2", {})).toBe("profile-2:");
  });

  it("discards a response after principal or effective authority changes", () => {
    const authority = createWorkRequestAuthority();
    const first = authority.begin("profile-1:warehouse:inspect_quality");
    const second = authority.begin("profile-2:legal:review_accreditation");

    expect(authority.accepts(first)).toBe(false);
    expect(authority.accepts(second)).toBe(true);
  });

  it("fails closed for rows outside the current principal, capability, or source", () => {
    const projected = projectLiveWorkItems(
      [
        {
          id: "valid",
          principal_id: "profile-1",
          source: "legal",
          title: "Review case",
          description: "Current case",
          status: "submitted",
          priority: "normal",
          href: "/legal/accreditation",
          required_module: "legal",
          required_capability: "review_accreditation",
          source_record_exists: true,
        },
        {
          id: "wrong-principal",
          principal_id: "profile-2",
          source: "legal",
          priority: "normal",
          href: "/legal/accreditation",
          required_module: "legal",
          required_capability: "review_accreditation",
          source_record_exists: true,
        },
        {
          id: "missing-source",
          principal_id: "profile-1",
          source: "legal",
          priority: "critical",
          href: "/legal/accreditation",
          required_module: "legal",
          required_capability: "review_accreditation",
          source_record_exists: false,
        },
      ],
      "profile-1",
      (module, capability) =>
        module === "legal" && capability === "review_accreditation",
    );

    expect(projected.map((item) => item.id)).toEqual(["valid"]);
  });
});
