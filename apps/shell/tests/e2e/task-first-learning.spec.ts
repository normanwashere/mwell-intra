import { test, expect } from "@playwright/test";
import { DEMO_PROFILES } from "../../lib/demoProfiles";
import { KNOWLEDGE_GUIDE_CONTENT } from "../../lib/knowledge/guideContent";
import { tasksForRoles } from "../../lib/knowledge/taskCatalog";
import { auditWarehouseLayout } from "../helpers/warehouseLayoutAudit";

const profiles = ["demo-operations", "demo-warehouse-operator", "demo-logistics", "demo-procurement", "demo-finance", "demo-legal", "demo-marketing", "demo-product-owner", "demo-bi", "demo-admin", "demo-vendor"];

for (const profileId of profiles) {
  test(`${profileId}: task entry, selected learning and role-safe guide`, async ({ page }, info) => {
    const profile = DEMO_PROFILES.find(item => item.id === profileId)!;
    const tasks = tasksForRoles(KNOWLEDGE_GUIDE_CONTENT, profile.roles, profile.kind === "vendor" ? "vendor" : "internal");
    expect(tasks.length, `${profileId} has a valid task`).toBeGreaterThan(0);
    await page.addInitScript(value => sessionStorage.setItem("intra.memory-session.v1", JSON.stringify(value)), { profileId, roles: profile.roles });
    // The authenticated endpoint is covered separately. This fixture exercises UI with the same catalog projection.
    await page.route("**/api/knowledge/tasks*", route => route.fulfill({ json: { tasks } }));
    const path = profile.kind === "vendor" ? "/vendor/onboarding" : "/onboarding";
    await page.goto(`${path}?task=${encodeURIComponent(tasks[0]!.id)}`);
    await page.getByText("Change task", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "What are you working on?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Selected", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Prepare for task", exact: true })).toHaveCount(Math.min(3, tasks.length) - 1);
    await page.reload();
    await page.getByText("Change task", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Selected", exact: true })).toHaveCount(1);
    await page.getByText("Change task", { exact: true }).click();
    const layout = await auditWarehouseLayout(page);
    expect(layout.overflowElements).toEqual([]);
    expect(layout.clippedControls).toEqual([]);
    expect(layout.overlaps).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${profileId}-task-learning.png`), fullPage: true });
    await page.screenshot({ path: info.outputPath(`${profileId}-viewport.png`) });
    await page.getByText("Change task", { exact: true }).click();
    await page.getByRole("link", { name: "View guide", exact: true }).first().click();
    await expect(page).toHaveURL(/\/knowledge\?/);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText("Screen evidence is being prepared", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${profileId}-guide.png`), fullPage: true });
  });
}

test("local task endpoint, dark theme, invalid task and KB recovery", async ({ page }, info) => {
  const profile = DEMO_PROFILES.find(item => item.id === "demo-warehouse-operator")!;
  await page.addInitScript(value => {
    sessionStorage.setItem("intra.memory-session.v1", JSON.stringify(value));
    localStorage.setItem("intra-theme", "dark");
  }, { profileId: profile.id, roles: profile.roles });
  await page.goto("/onboarding?task=not-a-real-task");
  await expect(page.getByRole("heading", { name: "What are you working on?" })).toBeVisible();
  await page.getByRole("button", { name: "Prepare for task", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Task learning", exact: true })).toBeVisible();
  await page.getByText("Change task", { exact: true }).click();
  const start = page.getByRole("button", { name: "Start Role orientation", exact: true }).first();
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Resume later", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("task-learning-dark-viewport.png") });
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { name: "What are you working on?" })).toBeVisible();
  await expect(page.getByText("Orientation complete", { exact: true })).toHaveCount(0);
  const layout = await auditWarehouseLayout(page);
  expect(layout.overflowElements).toEqual([]);
  expect(layout.clippedControls).toEqual([]);
  await page.screenshot({ path: info.outputPath("knowledge-dark-viewport.png") });
});
