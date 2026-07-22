import { describe, expect, it } from "vitest";
import { availableWorkFilters, filterWorkItems, sortWorkItems } from "./data";
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
});
