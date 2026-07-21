import { expect, test, type Page } from "@playwright/test";
import { KNOWLEDGE_CONTENT } from "../../lib/knowledge/content";
import { edgeChoiceId } from "../../lib/knowledge/graph";
import { COMING_SOON_ROLES } from "../../lib/knowledge/roles";
import type {
  KnowledgeFlow,
  KnowledgeFlowEdge,
} from "../../lib/knowledge/types";

const MEMORY_SESSION_KEY = "intra.memory-session.v1";

async function installSession(
  page: Page,
  roles = {
    core: ["admin"],
    legal: ["legal_admin"],
    warehouse: ["admin"],
    procurement: ["admin"],
  },
) {
  await page.addInitScript(
    ({ key, session }) => sessionStorage.setItem(key, JSON.stringify(session)),
    { key: MEMORY_SESSION_KEY, session: { profileId: "demo-admin", roles } },
  );
}

function terminalPaths(flow: KnowledgeFlow) {
  const outgoing = new Map<string, KnowledgeFlowEdge[]>();
  for (const edge of flow.edges)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  const paths = new Map<string, string[]>();
  const walk = (nodeId: string, choices: string[], seen: Set<string>) => {
    if (seen.has(nodeId)) return;
    const node = flow.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    if (node.type === "terminal") paths.set(node.id, choices);
    const edges = outgoing.get(nodeId) ?? [];
    for (const edge of edges) {
      walk(
        edge.to,
        edges.length > 1 ? [...choices, edgeChoiceId(flow, edge)] : choices,
        new Set([...seen, nodeId]),
      );
    }
  };
  walk(flow.startNodeId, [], new Set());
  return paths;
}

function reachableNodeIds(flow: KnowledgeFlow, startNodeId: string) {
  const reachable = new Set<string>();
  const visit = (nodeId: string) => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    for (const edge of flow.edges.filter(
      (candidate) => candidate.from === nodeId,
    ))
      visit(edge.to);
  };
  visit(startNodeId);
  return reachable;
}

function choicePathToNode(flow: KnowledgeFlow, targetNodeId: string) {
  const walk = (
    nodeId: string,
    choices: string[],
    seen: Set<string>,
  ): string[] | null => {
    if (nodeId === targetNodeId) return choices;
    if (seen.has(nodeId)) return null;
    const edges = flow.edges.filter((edge) => edge.from === nodeId);
    for (const edge of edges) {
      const result = walk(
        edge.to,
        edges.length > 1 ? [...choices, edgeChoiceId(flow, edge)] : choices,
        new Set([...seen, nodeId]),
      );
      if (result) return result;
    }
    return null;
  };
  return walk(flow.startNodeId, [], new Set());
}

test.beforeEach(async ({ page }) => installSession(page));

test("task, role, and feature search supports recovery and browser history", async ({
  page,
}) => {
  await page.goto("/knowledge");
  const search = page.getByRole("searchbox", {
    name: "Search all handbook content",
  });
  for (const [mode, query, expectedResult] of [
    ["task", "receiving", /receiv/i],
    ["role", "Legal administrator", /Legal administrator/i],
    ["feature", "cycle count", /cycle count/i],
  ] as const) {
    await page
      .getByRole("button", {
        name: new RegExp(
          mode === "task"
            ? "Do a task"
            : mode === "role"
              ? "Understand a role"
              : "Explore a feature",
          "i",
        ),
      })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("mode"))
      .toBe(mode);
    await search.fill(query);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe(query);
    await expect(page.getByRole("status")).not.toContainText(/^0 results$/);
    await expect(
      page.getByRole("heading", { name: "Search results" }),
    ).toBeVisible();
    const searchResults = page.getByRole("region", { name: "Search results" });
    await expect(
      searchResults
        .getByRole("button")
        .filter({ hasText: expectedResult })
        .first(),
    ).toBeVisible();
  }
  await search.fill("zzqxjv9274");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("zzqxjv9274");
  await expect(page.getByRole("status")).toHaveText("0 results");
  await page.getByRole("button", { name: /Clear handbook search/i }).click();
  await expect(page).toHaveURL(/\/knowledge(?:\?|$)/);
  await page.goBack();
  await expect(page).toHaveURL(/q=/);
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Find the right next step" }),
  ).toBeVisible();
});

test("every current and planned role has a complete, availability-aware profile", async ({
  page,
}) => {
  test.setTimeout(90_000);
  for (const role of [...KNOWLEDGE_CONTENT.roles, ...COMING_SOON_ROLES]) {
    await page.goto(`/knowledge?article=role-${encodeURIComponent(role.id)}`);
    await expect(
      page.getByRole("heading", { name: role.label, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Decision authority", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Can do and cannot do/i }),
    ).toBeVisible();
    if (role.availability === "coming_soon")
      await expect(page.getByText("Coming soon").first()).toBeVisible();
  }
});

test("every feature guide opens and coming-soon controls remain clearly non-operational", async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const feature of KNOWLEDGE_CONTENT.features) {
    await page.goto(
      `/knowledge?article=feature-${encodeURIComponent(feature.id)}`,
    );
    await expect(page.locator("h1")).toHaveText(feature.title);
    await expect(
      page.getByRole("heading", { name: "Controls", exact: true }),
    ).toBeVisible();
    if (feature.availability === "coming_soon") {
      await expect(page.getByText("Coming soon").first()).toBeVisible();
      await expect(
        page.getByRole("link", { name: /open.*feature|go to/i }),
      ).toHaveCount(0);
    }
  }
});

test("all principal workflows, decision outcomes, and terminal nodes are navigable", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  for (const flow of KNOWLEDGE_CONTENT.flows) {
    const paths = terminalPaths(flow);
    const terminals = flow.nodes.filter((node) => node.type === "terminal");
    expect(paths.size, `${flow.id} reachable terminals`).toBe(terminals.length);
    for (const terminal of terminals) {
      const branch = paths.get(terminal.id) ?? [];
      const params = new URLSearchParams({
        flow: flow.id,
        view: "flow",
        step: terminal.id,
      });
      if (branch.length) params.set("branch", branch.join(","));
      await page.goto(`/knowledge?${params}`);
      await expect(
        page.getByRole("heading", { name: flow.title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: terminal.title, exact: true }),
      ).toBeVisible();
    }
    if (testInfo.project.name !== "desktop-1280") continue;
    for (const decision of flow.nodes.filter(
      (node) => node.type === "decision",
    )) {
      const outcomes = flow.edges.filter((edge) => edge.from === decision.id);
      expect(
        outcomes.length,
        `${flow.id}:${decision.id} decision outcomes`,
      ).toBeGreaterThan(1);
      for (const outcome of outcomes) {
        await test.step(`${flow.id}:${decision.id}:${outcome.label}`, async () => {
          const target = flow.nodes.find((node) => node.id === outcome.to)!;
          const prefix = choicePathToNode(flow, decision.id);
          expect(
            prefix,
            `${flow.id}:${decision.id} reachable decision`,
          ).not.toBeNull();
          const params = new URLSearchParams({
            flow: flow.id,
            view: "steps",
            step: decision.id,
          });
          if (prefix!.length) params.set("branch", prefix!.join(","));
          await page.goto(`/knowledge?${params}`);
          await expect(
            page.getByRole("region", { name: decision.title, exact: true }),
          ).toBeVisible();
          await page
            .getByRole("region", { name: decision.title, exact: true })
            .getByRole("button", { name: outcome.label!, exact: true })
            .first()
            .click();
          const choiceId = edgeChoiceId(flow, outcome);
          await expect
            .poll(() =>
              new URL(page.url()).searchParams.get("branch")?.split(","),
            )
            .toContain(choiceId);
          const selectedId = new URL(page.url()).searchParams.get("step");
          expect(
            reachableNodeIds(flow, target.id),
            `${flow.id}:${choiceId} selected ${selectedId}`,
          ).toContain(selectedId);
          const selected = flow.nodes.find((node) => node.id === selectedId)!;
          await expect(
            page.getByRole("region", { name: selected.title, exact: true }),
          ).toBeVisible();
        });
      }
    }
  }
});

test("branch backtracking and four workflow views share one selected node", async ({
  page,
}) => {
  const flow = KNOWLEDGE_CONTENT.flows.find((item) =>
    item.nodes.some((node) => node.type === "decision"),
  )!;
  const decision = flow.nodes.find((node) => node.type === "decision")!;
  const edge = flow.edges.find((item) => item.from === decision.id)!;
  await page.goto(`/knowledge?flow=${flow.id}&view=steps&step=${decision.id}`);
  await page.getByRole("tab", { name: "Flow" }).click();
  await page.getByRole("button", { name: edge.label!, exact: true }).click();
  await expect(page).toHaveURL(/branch=/);
  if ((page.viewportSize()?.width ?? 0) < 640)
    await page.getByRole("button", { name: "Backtrack" }).click();
  else await page.goBack();
  await expect(page).toHaveURL(new RegExp(`step=${decision.id}`));
  for (const tab of ["Step-by-step", "Roles involved", "Exceptions"] as const) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page).toHaveURL(/step=/);
    await expect(page.getByRole("tabpanel", { name: tab })).toBeVisible();
  }
});

test("deep links, refresh, scroll restoration, and every evidence hotspot remain stable", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const evidence = KNOWLEDGE_CONTENT.evidence.find(
    (item) => item.id === "ev-admin-start",
  )!;
  const flow = KNOWLEDGE_CONTENT.flows.find((item) =>
    item.nodes.some((node) => node.evidenceId === evidence.id),
  )!;
  const node = flow.nodes.find((item) => item.evidenceId === evidence.id)!;
  await page.goto(`/knowledge?flow=${flow.id}&view=steps&step=${node.id}`);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      ),
    )
    .toBeGreaterThan(200);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(() =>
    window.scrollTo(
      0,
      Math.min(500, document.documentElement.scrollHeight - window.innerHeight),
    ),
  );
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(200);
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await expect
    .poll(() =>
      page.evaluate((expected) => {
        const key = `knowledge-scroll:${window.location.pathname}${window.location.search}`;
        return Math.abs(Number(sessionStorage.getItem(key)) - expected);
      }, before),
    )
    .toBeLessThanOrEqual(16);
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`step=${node.id}`));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      Math.abs((await page.evaluate(() => window.scrollY)) - before),
    )
    .toBeLessThanOrEqual(64);
  if (testInfo.project.name !== "desktop-1280") return;
  for (const item of KNOWLEDGE_CONTENT.evidence) {
    const evidenceFlow = KNOWLEDGE_CONTENT.flows.find((candidate) =>
      candidate.nodes.some(
        (candidateNode) => candidateNode.evidenceId === item.id,
      ),
    )!;
    const evidenceNode = evidenceFlow.nodes.find(
      (candidateNode) => candidateNode.evidenceId === item.id,
    )!;
    for (const src of [item.desktopSrc, item.mobileSrc]) {
      const response = await request.get(src);
      expect(response.ok(), `${item.id} ${src}`).toBeTruthy();
      expect((await response.body()).byteLength, src).toBeGreaterThan(12_000);
    }
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(
        `/knowledge?flow=${evidenceFlow.id}&view=steps&step=${evidenceNode.id}`,
      );
      const region = page.getByRole("region", {
        name: evidenceNode.title,
        exact: true,
      });
      await expect(region).toBeVisible();
      const image = region.locator("img");
      await expect(image).toBeVisible();
      for (const hotspot of item.hotspots) {
        const marker = region.getByRole("button", {
          name: `${hotspot.number}. ${hotspot.label}`,
          exact: true,
        });
        await expect(marker).toBeVisible();
        const [markerBox, imageBox] = await Promise.all([
          marker.boundingBox(),
          image.boundingBox(),
        ]);
        expect(
          markerBox,
          `${item.id}:${hotspot.id}:${width} marker`,
        ).not.toBeNull();
        expect(
          imageBox,
          `${item.id}:${hotspot.id}:${width} image`,
        ).not.toBeNull();
        expect(markerBox!.x).toBeGreaterThanOrEqual(imageBox!.x - 1);
        expect(markerBox!.y).toBeGreaterThanOrEqual(imageBox!.y - 1);
        expect(markerBox!.x + markerBox!.width).toBeLessThanOrEqual(
          imageBox!.x + imageBox!.width + 1,
        );
        expect(markerBox!.y + markerBox!.height).toBeLessThanOrEqual(
          imageBox!.y + imageBox!.height + 1,
        );
      }
    }
  }
});

test("recommended guidance changes with the signed-in user's access", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installSession(page, { core: ["staff"], warehouse: ["operations"] });
  await page.goto("/knowledge");
  const recommended = page.locator("section").filter({
    has: page.getByRole("heading", { name: /Recommended for your work/i }),
  });
  await expect(recommended).toContainText(/receiv|warehouse/i);
  await expect(recommended).not.toContainText(/Legal administrator/i);
  await context.close();
});
