import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const SESSION_KEY = "intra.memory-session.v1";

const sessions = {
  requester: {
    profileId: "demo-business-unit",
    roles: {
      core: ["staff"],
      warehouse: ["business_unit"],
      events: ["requester"],
    },
  },
  viewer: {
    profileId: "demo-event-viewer",
    roles: { core: ["staff"], events: ["viewer"] },
  },
  analyst: {
    profileId: "demo-bi",
    roles: {
      core: ["staff"],
      warehouse: ["bi_analyst"],
      insights: ["analyst"],
    },
  },
  manager: {
    profileId: "demo-insights-manager",
    roles: { core: ["staff"], insights: ["manager"] },
  },
  executive: {
    profileId: "demo-executive",
    roles: { core: ["staff"], insights: ["executive"] },
  },
  admin: {
    profileId: "demo-warehouse-admin",
    roles: {
      core: ["staff"],
      warehouse: ["warehouse_admin"],
      events: ["admin"],
      insights: ["admin"],
    },
  },
} as const;

async function installSession(page: Page, value: object) {
  await page.addInitScript(
    ({ key, session }) => sessionStorage.setItem(key, JSON.stringify(session)),
    { key: SESSION_KEY, session: value },
  );
}

async function assertVisualSafety(page: Page) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(viewport!.width + 2);
  const clippedCommands = await page
    .locator("button:visible, a.btn-primary:visible, a.btn-ghost:visible")
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.scrollWidth > element.clientWidth + 2)
        .map((element) => element.textContent?.trim()),
    );
  expect(clippedCommands).toEqual([]);
}

async function captureKnowledgeScreen(
  page: Page,
  target: ReturnType<Page["locator"]>,
  id: string,
  projectName: string,
) {
  if (process.env.CAPTURE_KB !== "1") return;
  const viewportName = projectName.startsWith("mobile") ? "mobile" : "desktop";
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((element) =>
    element.setAttribute("data-knowledge-capture-target", "true"),
  );
  await page.addStyleTag({
    content:
      '[data-knowledge-capture-target="true"]{outline:4px solid #0284c7!important;outline-offset:4px!important;box-shadow:0 0 0 8px rgba(2,132,199,.18)!important}',
  });
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  if (box && viewport) {
    console.log(
      `KB_COORD ${id} ${viewportName} ${((box.x + box.width / 2) / viewport.width).toFixed(4)} ${((box.y + box.height / 2) / viewport.height).toFixed(4)}`,
    );
  }
  await page.screenshot({
    path: path.resolve(
      process.cwd(),
      "public/knowledge/screenshots",
      `task8-${id}-${viewportName}.png`,
    ),
    fullPage: false,
    animations: "disabled",
    scale: "css",
  });
}

test("event requester validates, creates, opens, and hands off an event", async ({
  page,
}, testInfo) => {
  await installSession(page, sessions.requester);
  await page.goto("/events");
  await expect(
    page.getByRole("heading", { name: "Events", exact: true }),
  ).toBeVisible();
  await captureKnowledgeScreen(
    page,
    page.getByRole("button", { name: "New event" }),
    "events-workspace",
    testInfo.project.name,
  );
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByText("Event name is required.")).toBeVisible();
  await page.getByLabel("Event name").fill("QA Community Wellness Day");
  await page.getByLabel("Start date").fill("2026-07-20");
  await page.getByLabel("End date").fill("2026-07-19");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(
    page.getByText("End date cannot be before the start date."),
  ).toBeVisible();
  await page.getByLabel("End date").fill("2026-07-21");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(
    page.getByRole("heading", { name: "QA Community Wellness Day" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View event" }).first().click();
  await expect(
    page.getByRole("heading", { name: "QA Community Wellness Day" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open Warehouse fulfillment/i }),
  ).toHaveAttribute("href", /\/warehouse\/events\//);
  await assertVisualSafety(page);
  await page.screenshot({
    path: testInfo.outputPath(`events-detail-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("event viewer is read-only", async ({ page }) => {
  await installSession(page, sessions.viewer);
  await page.goto("/events");
  await expect(
    page.getByRole("heading", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "New event" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Event guide" })).toBeVisible();
  await assertVisualSafety(page);
});

test("Insights respects analyst, manager, and executive scopes", async ({
  page,
}, testInfo) => {
  await installSession(page, sessions.analyst);
  await page.goto("/insights");
  await expect(page.getByRole("tab", { name: "Warehouse" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Executive" })).toHaveCount(0);
  await expect(page.getByText("Fulfillment rate")).toBeVisible();
  await captureKnowledgeScreen(
    page,
    page.getByRole("link", { name: "Open governed source" }).first(),
    "insights-workspace",
    testInfo.project.name,
  );

  const manager = await page.context().newPage();
  await installSession(manager, sessions.manager);
  await manager.goto("/insights");
  await expect(manager.getByRole("tab", { name: "Executive" })).toBeVisible();
  await expect(manager.getByRole("tab", { name: "Warehouse" })).toBeVisible();
  await manager.close();

  const executive = await page.context().newPage();
  await installSession(executive, sessions.executive);
  await executive.goto("/insights");
  await expect(executive.getByRole("tab", { name: "Executive" })).toBeVisible();
  await expect(executive.getByRole("tab", { name: "Warehouse" })).toHaveCount(
    0,
  );
  await expect(
    executive.getByText("Priority exceptions", { exact: true }),
  ).toBeVisible();
  await executive.close();
  await assertVisualSafety(page);
});

test("My Work filters and opens the authoritative source", async ({
  page,
}, testInfo) => {
  await installSession(page, sessions.requester);
  await page.goto("/work");
  await expect(page.getByRole("heading", { name: "My Work" })).toBeVisible();
  await page.getByRole("tab", { name: "Events" }).click();
  await expect(page.getByText("Confirm Cebu event fulfillment")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open source" })).toHaveAttribute(
    "href",
    "/events/evt-demo-wellness-caravan",
  );
  await captureKnowledgeScreen(
    page,
    page.getByRole("link", { name: "Open source" }),
    "my-work",
    testInfo.project.name,
  );
  await assertVisualSafety(page);
  await page.screenshot({
    path: testInfo.outputPath(`my-work-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("legacy top-level routes redirect without trapping the detail handoff", async ({
  page,
}) => {
  await installSession(page, sessions.admin);
  await page.goto("/warehouse/events");
  await expect(page).toHaveURL(/\/events$/);
  await page.goto("/warehouse/reports");
  await expect(page).toHaveURL(/\/insights\/warehouse$/);
  await page.goto("/warehouse/quality-control");
  await expect(page).toHaveURL(/\/warehouse\/quality$/);
  await page.goto("/warehouse/events/evt-demo-wellness-caravan");
  await expect(page).toHaveURL(
    /\/warehouse\/events\/evt-demo-wellness-caravan$/,
  );
});

test("Knowledge Base explains exact workspace roles and ownership", async ({
  page,
}) => {
  await installSession(page, sessions.admin);
  await page.goto("/knowledge?q=Events%20roles");
  await page
    .getByRole("button", {
      name: /Events, My Work, and Insights role catalog/i,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Events roles" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Event Requester can view and create events/i),
  ).toBeVisible();
  await expect(
    page.getByText(/Executive sees the executive summary only/i),
  ).toBeVisible();
  await assertVisualSafety(page);
});
