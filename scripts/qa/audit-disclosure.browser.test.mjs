import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

const require = createRequire(new URL("../../apps/shell/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const ts = require("typescript");
const source = await readFile(new URL("./full-intra-live-e2e.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("audit.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ["pageAudit", "auditKeyboardAndHotspots", "routeReadinessSnapshot", "describeRouteStructureProblems", "waitForMeaningfulRoute"];
const definitions = names.map(name => {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `actual harness function ${name} exists`);
  return node.getText(ast);
});
// Execute only the actual pure audit helpers, never the live runner/bootstrap.
const helpers = new Function(`${definitions.join("\n")}\nreturn {${names.join(",")}};`)();
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(html, run, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  await page.setContent(`<style>body{margin:24px}button,summary{box-sizing:border-box;min-height:48px;padding:12px}summary{cursor:pointer}details{margin:12px 0}</style><main><h1>Quality control</h1>${html}</main>`);
  try { await run(page); } finally { await context.close(); }
}

for (const width of [1440, 390]) {
  test(`closed disclosures exclude Inspect but audit visible summaries, then expand and inspect (${width})`, async () => {
    await fixture(`<details id="outer"><summary><span>Receipt group</span></summary><button id="outer-inspect">Inspect receipt</button><details id="inner"><summary>Serial group</summary><button id="inspect">Inspect serial</button></details></details>`, async page => {
      await page.locator("#inspect").evaluate(element => element.addEventListener("click", () => element.dataset.inspected = "yes"));
      const closed = await helpers.auditKeyboardAndHotspots(page);
      assert.equal(closed.focusableCount, 1, "only the outer summary is interactive");
      assert.deepEqual(closed.interceptedTargets, []);
      assert.equal((await helpers.pageAudit(page)).visibleControls, 1);
      await page.locator("#outer > summary").click();
      const outerOpen = await helpers.auditKeyboardAndHotspots(page);
      assert.equal(outerOpen.focusableCount, 3, "outer summary, outer button, inner summary");
      assert.deepEqual(outerOpen.interceptedTargets, []);
      await page.locator("#inner > summary").click();
      const expanded = await helpers.auditKeyboardAndHotspots(page);
      assert.equal(expanded.focusableCount, 4);
      assert.deepEqual(expanded.interceptedTargets, []);
      await page.getByRole("button", { name: "Inspect serial", exact: true }).click();
      assert.equal(await page.locator("#inspect").getAttribute("data-inspected"), "yes");
    }, width);
  });
}

test("an open inner disclosure remains hidden by a closed outer disclosure", async () => {
  await fixture(`<details><summary>Outer receipt</summary><details open><summary>Inner serial</summary><button>Inspect hidden serial</button></details></details>`, async page => {
    assert.equal((await helpers.auditKeyboardAndHotspots(page)).focusableCount, 1);
    assert.equal((await helpers.pageAudit(page)).visibleControls, 1);
  });
});

test("visible fixed occlusion still fails for a summary and an expanded Inspect", async () => {
  await fixture(`<details open><summary>Receipt group</summary><button>Inspect visible serial</button></details><div style="position:fixed;inset:0;z-index:9999;background:white" aria-label="Blocking overlay"></div>`, async page => {
    const result = await helpers.auditKeyboardAndHotspots(page);
    assert.equal(result.focusableCount, 2);
    assert.deepEqual(result.interceptedTargets.map(item => item.target).sort(), ["Inspect visible serial", "Receipt group"]);
    assert.ok(result.interceptedTargets.every(item => item.recheckedAfterScroll && item.blocker === "Blocking overlay"));
  });
});

test("semantic route readiness waits for delayed quality hydration, not merely its heading", async () => {
  await fixture(`<p id="loading">Loading quality controls...</p>`, async page => {
    const initial = await helpers.routeReadinessSnapshot(page);
    assert.equal(initial.loadingStateCount, 1);
    let settled = false;
    const ready = helpers.waitForMeaningfulRoute(page).then(() => { settled = true; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(settled, false);
    await page.locator("#loading").evaluate(element => {
      const details = document.createElement("details");
      details.innerHTML = "<summary>Hydrated receipt group</summary><button>Inspect hydrated unit</button>";
      element.replaceWith(details);
    });
    await ready;
    assert.equal((await helpers.routeReadinessSnapshot(page)).loadingStateCount, 0);
    assert.equal((await helpers.pageAudit(page)).visibleControls, 1);
    assert.equal((await helpers.auditKeyboardAndHotspots(page)).focusableCount, 1);
  });
});

test("persistent loading fails within the bound and a queue error is not certified ready", async () => {
  await fixture(`<p>Loading quality controls...</p>`, async page => {
    await assert.rejects(helpers.waitForMeaningfulRoute(page, { timeout: 200 }), /Timeout/);
    await page.locator("main p").evaluate(element => {
      element.outerHTML = '<div role="alert">Quality source unavailable<button>Retry quality queue</button></div>';
    });
    const problems = helpers.describeRouteStructureProblems(await helpers.routeReadinessSnapshot(page));
    assert.ok(problems.some(item => /source.*error|queue.*error/i.test(item)), JSON.stringify(problems));
  });
});
