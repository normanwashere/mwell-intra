import { expect, it } from "vitest";
import { recommendTasks } from "./taskRecommendations";
import type { TaskDefinition } from "./taskCatalog";
import { tasksForRoles } from "./taskCatalog";
import { KNOWLEDGE_CONTENT } from "./content";

const task = (id: string, priority = 1): TaskDefinition => ({ id, title: id, priority, outcome: "Read the assigned record", audience: "internal", roleIds: ["core_staff_only"], featureId: "my-work", actionCapabilities: [], availability: "live", guideHref: "/knowledge?article=feature-my-work", actionHref: "/work", module: "core", moduleLabel: "Core", personaIds: [], aliases: [] });

it("ranks selected, resumed, assigned, then curated without granting eligibility", () => {
  expect(recommendTasks({ tasks: [task("curated"), task("assigned"), task("resumed"), task("selected"), task("forbidden")], eligibleTaskIds: new Set(["curated", "assigned", "resumed", "selected"]), selectedTaskId: "selected", resumableTaskId: "resumed", assignedTaskIds: ["forbidden", "assigned", "assigned"] }).map(task => task.id)).toEqual(["selected", "resumed", "assigned"]);
});

it("rejects stale selections, unknown assignments, limited and coming-soon tasks", () => {
  const tasks = [task("live"), { ...task("limited"), availability: "limited" as const }, { ...task("future"), availability: "coming_soon" as const }];
  expect(recommendTasks({ tasks, eligibleTaskIds: new Set(["live", "limited", "future"]), selectedTaskId: "future", resumableTaskId: "limited", assignedTaskIds: ["unknown"] }).map(t => t.id)).toEqual(["live"]);
});

it("deduplicates all priority sources and preserves distinct equal-title tasks", () => {
  const tasks = [task("b"), task("a"), task("a"), task("c"), task("d")].map(t => ({ ...t, title: "Same title" }));
  expect(recommendTasks({ tasks, eligibleTaskIds: new Set(tasks.map(t => t.id)), selectedTaskId: "b", resumableTaskId: "b", assignedTaskIds: ["b", "a", "a"] }).map(t => t.id)).toEqual(["b", "a", "c"]);
});

it("uses priority then stable ID regardless of input order without mutating inputs", () => {
  const tasks = Object.freeze([Object.freeze(task("z", 2)), Object.freeze(task("b")), Object.freeze(task("a"))]);
  const assignedTaskIds = Object.freeze([] as string[]);
  const input = { tasks, assignedTaskIds, eligibleTaskIds: new Set(["a", "b", "z"]) };
  expect(recommendTasks(input).map(t => t.id)).toEqual(["a", "b", "z"]);
  expect(tasks.map(t => t.id)).toEqual(["z", "b", "a"]);
  expect(recommendTasks({ ...input, eligibleTaskIds: new Set() })).toEqual([]);
});

it("unions actual Finance scopes without enabling another role's task", () => {
  const tasks = tasksForRoles(KNOWLEDGE_CONTENT, { procurement: ["finance"], warehouse: ["finance"], events: ["finance_reviewer"] }, "internal");
  const ids = new Set(tasks.map(t => t.id));
  expect([...ids]).toEqual(expect.arrayContaining(["review-payment-readiness", "review-inventory-close", "review-event-settlement"]));
  expect(ids.has("author-purchase-order")).toBe(false);
  expect(recommendTasks({ tasks, eligibleTaskIds: ids, assignedTaskIds: ["review-event-settlement"], selectedTaskId: "author-purchase-order" })[0]?.id).toBe("review-event-settlement");
});

it("keeps mixed vendor claims vendor-only and fails closed for internal recommendations", () => {
  const roles = { core: ["vendor_portal", "platform_admin"], procurement: ["admin"] };
  const tasks = tasksForRoles(KNOWLEDGE_CONTENT, roles, "vendor");
  expect(tasks).toHaveLength(3);
  expect(tasks.every(t => t.audience === "vendor" && t.roleIds.every(id => id === "vendor_portal"))).toBe(true);
  expect(tasksForRoles(KNOWLEDGE_CONTENT, roles, "internal")).toEqual([]);
  expect(tasksForRoles(KNOWLEDGE_CONTENT, { warehouse: ["platform_admin"], unknown: ["warehouse_operator"] }, "internal")).toEqual([]);
});
