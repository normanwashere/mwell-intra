import assert from "node:assert/strict";

export function eligibleTaskTargets(tasks, origin, pathname) {
  assert.ok(Array.isArray(tasks) && tasks.length, "No authenticated eligible tasks");
  assert.ok(["/onboarding", "/vendor/onboarding"].includes(pathname));
  const ids = new Set();
  return tasks.map(task => {
    assert.ok(typeof task.id === "string" && task.id.length && !ids.has(task.id), "Missing or duplicate task identity");
    ids.add(task.id);
    assert.ok(typeof task.actionHref === "string" && task.actionHref.startsWith("/") && !task.actionHref.startsWith("//"));
    assert.equal(new URL(task.actionHref, origin).origin, origin, "Task action must remain same-origin");
    const url = new URL(pathname, origin);
    url.searchParams.set("task", task.id);
    url.searchParams.set("next", task.actionHref);
    url.searchParams.set("smoke", "retained");
    return { task, url: url.href };
  });
}

export async function readinessDom(page, expectedTaskId) {
  const region = page.getByRole("region", { name: "Task learning", exact: true });
  const count = await region.count();
  return {
    expectedTaskId, regionCount: count,
    visible: count === 1 && await region.isVisible(),
    selectedTaskId: count === 1 ? await region.getAttribute("data-task-id") : null,
    unavailableAlerts: await page.getByRole("alert").filter({ hasText: "Task learning readiness is unavailable" }).count(),
    knownReadinessHeading: count === 1 && await region.getByRole("heading", { name: "Needed for this task", exact: true }).isVisible(),
  };
}

export function readinessStatus(observations, expectedTaskId) {
  if (!observations.length) return "unexecuted";
  return observations.every(state => state.regionCount === 1 && state.visible &&
    state.selectedTaskId === expectedTaskId && state.unavailableAlerts === 0 && state.knownReadinessHeading)
    ? "passed" : "failed";
}

export function summarizeTasks(tasks, expectedCount) {
  return {
    expected: expectedCount, attempted: tasks.length,
    navigationPassed: tasks.filter(task => task.navigation === "passed").length,
    readinessPassed: tasks.filter(task => task.readiness === "passed").length,
    readinessFailed: tasks.filter(task => task.readiness === "failed").length,
    readinessUnexecuted: tasks.filter(task => task.readiness === "unexecuted").length + expectedCount - tasks.length,
    complete: tasks.length === expectedCount,
  };
}
