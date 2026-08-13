import { describe, expect, it } from "vitest";
import {
  availableWorkFilters,
  filterWorkItems,
  scopeWorkItems,
  sortWorkItems,
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
});
