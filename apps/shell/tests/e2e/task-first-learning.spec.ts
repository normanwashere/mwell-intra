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
    const selectedTask = page.getByRole("region", { name: "Task learning", exact: true });
    await expect(selectedTask).toHaveAttribute("data-task-id", tasks[0]!.id);
    await page.getByText("Change task", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your operational tasks" })).toBeVisible();
    const eligible = page.getByRole("region", { name: "Eligible tasks by module" });
    await expect(eligible.getByRole("button", { pressed: true })).toHaveCount(1);
    await expect(eligible.getByRole("button", { pressed: false })).toHaveCount(tasks.length - 1);
    await expect(eligible.getByRole("button", { name: `Select ${tasks[0]!.title}`, exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("searchbox", { name: "All eligible tasks" }).fill(tasks[0]!.title);
    await expect(eligible.getByRole("button", { name: `Select ${tasks[0]!.title}`, exact: true })).toBeVisible();
    await page.reload();
    await page.getByText("Change task", { exact: true }).click();
    await expect(eligible.getByRole("button", { pressed: true })).toHaveCount(1);
    await expect(eligible.getByRole("button")).toHaveCount(tasks.length);
    await expect(selectedTask).toHaveAttribute("data-task-id", tasks[0]!.id);
    await page.getByText("Change task", { exact: true }).click();
    const layout = await auditWarehouseLayout(page);
    expect(layout.overflowElements).toEqual([]);
    expect(layout.clippedControls).toEqual([]);
    expect(layout.overlaps).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${profileId}-task-learning.png`), fullPage: true });
    await page.screenshot({ path: info.outputPath(`${profileId}-viewport.png`) });
    await page.getByText("Change task", { exact: true }).click();
    await page.getByRole("link", { name: "All task guides", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search all handbook content" }).fill(tasks[0]!.title);
    await page.getByRole("region", { name: "Search results" }).getByRole("button")
      .filter({ has: page.getByText(tasks[0]!.title, { exact: true }) }).click();
    await expect(page).toHaveURL(/\/knowledge\?/);
    for (const [key, value] of new URL(tasks[0]!.guideHref, page.url()).searchParams) {
      await expect.poll(() => new URL(page.url()).searchParams.get(key)).toBe(value);
    }
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
  await page.getByText("Choose a task", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your operational tasks" })).toBeVisible();
  await page.getByRole("region", { name: "Eligible tasks by module" }).getByRole("button", { name: /^Select / }).first().click();
  await expect(page.getByRole("region", { name: "Task learning", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/not-a-real-task/);
  const start = page.getByRole("region", { name: "Task learning", exact: true })
    .getByRole("button", { name: "Start Role orientation", exact: true });
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Resume later", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("task-learning-dark-viewport.png") });
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { name: "Knowledge Base", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Guidance scope" })).toHaveValue("mine");
  await expect(page.getByText("Orientation complete", { exact: true })).toHaveCount(0);
  const layout = await auditWarehouseLayout(page);
  expect(layout.overflowElements).toEqual([]);
  expect(layout.clippedControls).toEqual([]);
  await page.screenshot({ path: info.outputPath("knowledge-dark-viewport.png") });
});
