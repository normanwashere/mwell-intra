import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { KNOWLEDGE_CONTENT } from "../../lib/knowledge/content";
import { OPERATING_PERSONA_GUIDES, OPERATING_WORKFLOWS } from "../../lib/knowledge/operatingPersonas";

const MEMORY_SESSION_KEY = "intra.memory-session.v1";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, session }) => {
      window.sessionStorage.setItem(key, JSON.stringify(session));
    },
    {
      key: MEMORY_SESSION_KEY,
      session: {
        profileId: "demo-procurement",
        roles: {
          core: ["staff"],
          procurement: ["procurement_officer"],
        },
      },
    },
  );
});

test("legacy future URLs render roadmap entries", async ({ page }) => {
  await page.goto("/knowledge?type=future");

  await expect(
    page.getByRole("heading", { name: "Reference", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reference", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Availability", exact: true })).toHaveValue("coming_soon");
  await expect(page.locator("#principal-flow-title")).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: /Offline Knowledge Base.*Roadmap.*Coming soon/,
    }),
  ).toBeVisible();
});

test("task search opens all five cross-department governed decision trees", async ({
  page,
}) => {
  expect(OPERATING_WORKFLOWS).toHaveLength(5);
  for (const workflow of OPERATING_WORKFLOWS) {
    const flow = KNOWLEDGE_CONTENT.flows.find((item) => item.id === workflow.flowId)!;
    await page.goto("/knowledge");
    await expect(page.getByRole("button", { name: "Task", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("searchbox", { name: "Search all handbook content" }).fill(flow.title);
    const result = page.getByRole("region", { name: "Search results" }).getByRole("button")
      .filter({ has: page.getByText(flow.title, { exact: true }) })
      .filter({ hasText: "Workflow" });
    await expect(result).toHaveCount(1);
    await result.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("flow")).toBe(flow.id);
    await expect(page.getByRole("heading", { name: flow.title, exact: true })).toBeVisible();
  }
});

test("legacy job persona deep links retain the exact task-first guide", async ({
  page,
}, testInfo) => {
  await page.goto("/knowledge?mode=role&article=persona-operations_associate");
  await expect(page).toHaveURL(
    /mode=role&article=persona-operations_associate/,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Operations Associate" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What do you need to do?" }),
  ).toBeVisible();
  const tasks = OPERATING_PERSONA_GUIDES.operations_associate!.tasks;
  expect(tasks).toHaveLength(7);
  await expect(page.getByRole("link", { name: "Open workspace" })).toHaveCount(tasks.length);
  await expect(page.getByRole("button", { name: "Show me how" })).toHaveCount(tasks.length);
  for (const task of tasks) {
    const region = page.getByRole("region", { name: task.title, exact: true });
    await expect(region.getByRole("link", { name: "Open workspace" })).toHaveAttribute("href", task.workspaceHref);
    await expect(region.getByRole("button", { name: "Show me how" })).toBeVisible();
  }
  await expect(page.getByText("Review the queue and receive stock", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Perform a cycle count", { exact: true }),
  ).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("legacy-persona-first-viewport.png") });
  const firstViewport = await page.evaluate(() => ({
    hasHorizontalOverflow:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
    firstTaskVisible:
      (document
        .getElementById("persona-task-receive-stock")
        ?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY) <
      window.innerHeight,
  }));
  expect(firstViewport.hasHorizontalOverflow).toBe(false);
  expect(firstViewport.firstTaskVisible).toBe(true);
});

test("landing interactions preserve URL state and accessible targets", async ({
  page,
}) => {
  await page.goto("/knowledge");

  const searchSection = page.locator("#handbook-search-title");
  const flowSection = page.locator("#handbook-results-title");
  await expect(searchSection).toBeVisible();
  await expect(flowSection).toBeVisible();
  const sectionOrder = await page.evaluate(
    ([searchId, flowId]) => {
      const search = document.getElementById(searchId);
      const flows = document.getElementById(flowId);
      if (!search || !flows) return null;
      return search.compareDocumentPosition(flows);
    },
    ["handbook-search-title", "handbook-results-title"],
  );
  expect(sectionOrder).not.toBeNull();
  expect(sectionOrder! & 4).toBeTruthy();

  const recommendations = page.getByRole("region", { name: "Task", exact: true });
  await expect(page.getByRole("combobox", { name: "Guidance scope" })).toHaveValue("mine");
  await expect(
    recommendations.getByText("Procurement officer").first(),
  ).toBeVisible();

  // Leave through a reachable result below the fold, not a focused tab that
  // the browser must scroll back into view before activating with Enter.
  const historyTarget = recommendations.locator("li").nth(6).getByRole("button");
  await historyTarget.click({ trial: true });
  await historyTarget.focus();
  await expect(historyTarget).toBeInViewport();
  const savedScroll = await page.evaluate(() => window.scrollY);
  expect(savedScroll).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&](article|flow)=/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/knowledge$/);
  await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - savedScroll)).toBeLessThanOrEqual(20);

  const roleMode = page.getByRole("button", { name: "Role", exact: true });
  await roleMode.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/knowledge\?mode=role$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/knowledge$/);

  const search = page.getByRole("searchbox", {
    name: "Search all handbook content",
  });
  await search.fill("Place hold");
  await expect(page).toHaveURL(/\?q=Place\+hold$/);
  await expect(flowSection).toHaveText("Search results");
  await expect(page.getByRole("combobox", { name: "Guidance scope" })).toBeDisabled();
  const qualityResult = page.getByRole("button", {
    name: /Quality control.*Feature.*Live/,
  });
  await expect(qualityResult).toBeVisible();

  const clear = page.getByRole("button", { name: "Clear handbook search" });
  const box = await clear.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await qualityResult.click();
  await expect(page).toHaveURL(
    /\?q=Place\+hold&article=feature-warehouse-quality$/,
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\?q=Place\+hold$/);
  await clear.click();
  await expect(page).toHaveURL(/\/knowledge$/);

  await search.fill("Identity and access");
  await page
    .getByRole("region", { name: "Search results" })
    .getByRole("button", { name: /Identity and access.*Workflow/ })
    .click();
  await expect(page).toHaveURL(
    /flow=identity-and-access&view=flow&step=access-authorized$/,
  );
});

test("pointer navigation preserves the outgoing bookmark across shorter guide reflow", async ({ page }, testInfo) => {
  await page.goto("/knowledge");
  const target = page.getByRole("region", { name: "Task", exact: true })
    .locator("li").nth(6).getByRole("button");
  await target.click({ trial: true });
  await expect(target).toBeInViewport();
  await target.evaluate(element => element.addEventListener("click", () => {
    sessionStorage.setItem("qa3-scroll-at-activation", String(window.scrollY));
  }, { once: true, capture: true }));
  if (testInfo.project.name.startsWith("mobile")) await target.tap();
  else await target.click();
  await expect(page).toHaveURL(/[?&](article|flow)=/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const activationY = await page.evaluate(() => Number(sessionStorage.getItem("qa3-scroll-at-activation")));
  expect(activationY).toBeGreaterThan(0);
  expect(await page.evaluate(() => sessionStorage.getItem("knowledge-scroll:/knowledge"))).toBe(String(activationY));
  await page.goBack();
  await expect(page).toHaveURL(/\/knowledge$/);
  await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - activationY)).toBeLessThanOrEqual(20);
  await page.screenshot({ path: testInfo.outputPath("knowledge-pointer-history-restored.png") });
});

test("task result controls keep their centers reachable", async ({
  page,
}) => {
  await page.goto("/knowledge");
  const results = page.getByRole("region", { name: "Task", exact: true });
  await expect(results).toBeVisible();
  const cards = results.getByRole("button");
  expect(await cards.count()).toBeGreaterThan(0);
  for (const card of await cards.all()) {
    await card.click({ trial: true });
    expect(await card.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const target = document.elementFromPoint(x, y);
      return Boolean(target && (target === element || element.contains(target)));
    })).toBe(true);
  }
});

test("knowledge landing stays accessible, reachable, and free of horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/knowledge");
  await expect(
    page.getByRole("heading", { name: "Knowledge Base", exact: true }),
  ).toBeVisible();

  const geometry = await page.locator("main").evaluate((main) => {
    const controls = [
      ...main.querySelectorAll<HTMLElement>("a, button, input, select"),
    ].filter((element) => {
      const rect = element.getBoundingClientRect();
      const closed = element.closest("details:not([open])");
      return (!closed || Boolean(closed.querySelector(":scope > summary")?.contains(element))) &&
        getComputedStyle(element).visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });

    return {
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      undersized: controls.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        // DOMRect doubles can report a 44px CSS control as 43.99997px.
        return rect.width < 44 - 0.001 || rect.height < 44 - 0.001
          ? [
              {
                label:
                  element.getAttribute("aria-label") ??
                  element.textContent?.trim(),
                width: rect.width,
                height: rect.height,
              },
            ]
          : [];
      }),
      unreachable: controls.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const x = Math.max(
          0,
          Math.min(window.innerWidth - 1, rect.left + rect.width / 2),
        );
        const y = Math.max(
          0,
          Math.min(window.innerHeight - 1, rect.top + rect.height / 2),
        );
        if (
          rect.top < 0 ||
          rect.bottom > window.innerHeight - 80 ||
          rect.right < 0 ||
          rect.left > window.innerWidth
        )
          return [];
        const target = document.elementFromPoint(x, y);
        return target && (target === element || element.contains(target))
          ? []
          : [
              element.getAttribute("aria-label") ??
                element.textContent?.trim() ??
                "unlabeled control",
            ];
      }),
    };
  });

  expect(geometry).toEqual({
    horizontalOverflow: false,
    undersized: [],
    unreachable: [],
  });

  await page.screenshot({ path: testInfo.outputPath("knowledge-landing-viewport.png") });
  await page.getByText("Common tasks", { exact: true }).click();
  for (const label of ["Create a purchase request", "Accredit a vendor", "Receive stock", "Resolve an exception"]) {
    await page.getByRole("button", { name: label, exact: true }).click({ trial: true });
  }
  await page.getByText("Help and recovery", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "When work does not go as planned" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    accessibility.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.length,
    })),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("knowledge-landing-disclosures.png"), fullPage: true });
});
