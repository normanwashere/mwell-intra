import { test, expect } from "@playwright/test";
import { DEMO_PROFILES } from "../../lib/demoProfiles";
import { KNOWLEDGE_GUIDE_CONTENT } from "../../lib/knowledge/guideContent";
import { tasksForRoles } from "../../lib/knowledge/taskCatalog";

test("local negative mapping fixture keeps task selected and offers honest readiness refresh", async ({ page }, info) => {
  const profile = DEMO_PROFILES.find(item => item.id === "demo-warehouse-operator")!;
  const task = tasksForRoles(KNOWLEDGE_GUIDE_CONTENT, profile.roles, "internal")[0]!;
  // Deliberately absent mapping tests recovery UI only; no live authority or catalog is changed.
  const fixture = { ...task, actionCapabilities: [{ module: "warehouse", capability: "diagnostic_missing_mapping" }] };
  await page.addInitScript(value => sessionStorage.setItem("intra.memory-session.v1", JSON.stringify(value)), { profileId: profile.id, roles: profile.roles });
  await page.route("**/api/knowledge/tasks*", route => route.fulfill({ json: { tasks: [fixture] } }));
  const params = new URLSearchParams({ task: task.id, next: task.actionHref });
  await page.goto(`/onboarding?${params}`);
  const region = page.getByRole("region", { name: "Task learning", exact: true });
  await expect(region).toHaveAttribute("data-task-id", task.id);
  await expect(region.getByRole("alert")).toContainText("Task learning readiness is unavailable");
  const refresh = region.getByRole("button", { name: "Refresh task readiness", exact: true });
  await expect(refresh).toBeVisible();
  await refresh.scrollIntoViewIfNeeded();
  const box = await refresh.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const before = page.url();
  await page.screenshot({ path: info.outputPath("negative-readiness-before-refresh.png") });
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(region.getByRole("alert")).toContainText("Task learning readiness is unavailable");
  await expect(region.getByText("No outstanding learning is identified", { exact: false })).toHaveCount(0);
  await expect(region).toHaveAttribute("data-task-id", task.id);
  expect(page.url()).toBe(before);
  await page.screenshot({ path: info.outputPath("negative-readiness-after-refresh.png") });
});
