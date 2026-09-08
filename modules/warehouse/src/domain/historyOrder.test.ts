import { expect, it } from "vitest";
import { newestFirst } from "./historyOrder";

it("compares actual instants, breaks equal-time ties by ID and places unknown dates last", () => {
  const entries = [
    { id: "z", createdAt: "invalid" },
    { id: "b", createdAt: "2026-09-08T08:00:00+08:00" },
    { id: "a", createdAt: "2026-09-08T00:00:00Z" },
    { id: "new", createdAt: "2026-09-08T01:00:00Z" },
    { id: "y", createdAt: "" },
  ];
  expect([...entries].sort(newestFirst).map((entry) => entry.id)).toEqual(["new", "a", "b", "y", "z"]);
  expect(entries[0]!.id).toBe("z");
});
