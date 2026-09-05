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

test("return Product selector remains unique beside product group and remove action", async () => {
  assert.ok(source.includes('page.getByRole("combobox", { name: "Product", exact: true }).selectOption'));
  await fixture(`<fieldset aria-label="Return product 1"><button aria-label="Remove product 1" disabled>Remove</button><label for="product">Product</label><select id="product"><option value="">Choose</option><option value="ring">Ring</option></select></fieldset>`, async page => {
    const product = page.getByRole("combobox", { name: "Product", exact: true });
    await product.selectOption({ index: 1 });
    assert.equal(await product.inputValue(), "ring");
  });
});

test("event handoff opens the review dialog before approval and verifies the card state", async () => {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === "warehouseEventHandoffWorkflow");
  const run = new Function('baseUrl', 'waitForMeaningfulRoute', `${node.getText(ast)};return warehouseEventHandoffWorkflow;`)('https://uat.example.test', async () => {});
  await fixture(`<button role="tab">Department requests</button><ul><li><p>QA event fulfillment</p><p id="state">Pending approval</p><button id="view">View request</button></li></ul><dialog aria-label="Review request"><p>QA event fulfillment</p><button id="approve">Approve</button></dialog>`, async page => {
    await page.evaluate(() => {
      document.querySelector('#view').onclick = () => document.querySelector('dialog').showModal();
      document.querySelector('#approve').onclick = () => {
        document.querySelector('#state').textContent = 'Approved';
        document.querySelector('dialog').close();
      };
    });
    const originalGoto = page.goto;
    page.goto = async () => null;
    try {
      const result = await run(page, { eventId: 'event', eventName: 'QA', fulfillmentPurpose: 'QA event fulfillment' });
      assert.equal(result.ok, true);
      assert.equal(await page.locator('#state').innerText(), 'Approved');
    } finally { page.goto = originalGoto; }
  });
});

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

test("offscreen input remains a failure but diagnostics distinguish absent viewport samples", async () => {
  await fixture(`<label for="policy-amount">Formal-bid amount (PHP)</label><input id="policy-amount" type="text" value="PRIVATE-INPUT-VALUE" style="position:fixed;left:1600px;top:200px;width:300px;height:44px">`, async page => {
    const result = await helpers.auditKeyboardAndHotspots(page);
    assert.equal(result.interceptedTargets.length, 1);
    const failure = result.interceptedTargets[0];
    assert.equal(failure.target, "INPUT");
    assert.equal(failure.blocker, "unknown element");
    assert.equal(failure.recheckedAfterScroll, true);
    assert.deepEqual(failure.targetIdentity, { tag: "input", id: "policy-amount", type: "text", labels: ["Formal-bid amount (PHP)"] });
    for (const probe of [failure.initialProbe, failure.recheckProbe]) {
      assert.equal(probe.reason, "no-visible-samples");
      assert.deepEqual(probe.samples, []);
      assert.equal(probe.rect.left, 1600);
      assert.equal(probe.viewport.width, 1280);
      assert.equal(probe.scroll.left, 0);
    }
    assert.ok(!JSON.stringify(result).includes("PRIVATE-INPUT-VALUE"));
  }, 1280);
});

test("diagnostics retain visible overlay failure and identify actual sampled hits without field values", async () => {
  await fixture(`<label for="policy-amount">Amount<textarea style="display:none">PRIVATE-TEXTAREA-VALUE</textarea></label><input id="policy-amount" value="PRIVATE-INPUT-VALUE" style="width:300px;height:44px"><div id="overlay" aria-label="Blocking overlay" style="position:fixed;inset:0;z-index:99"></div>`, async page => {
    const result = await helpers.auditKeyboardAndHotspots(page);
    assert.equal(result.interceptedTargets.length, 1);
    const failure = result.interceptedTargets[0];
    assert.equal(failure.blocker, "Blocking overlay");
    assert.deepEqual(failure.targetIdentity.labels, ["Amount"]);
    assert.equal(failure.recheckProbe.reason, "blocked");
    assert.equal(failure.recheckProbe.samples.length, 9);
    assert.ok(failure.recheckProbe.samples.every(sample => sample.hit.id === "overlay" && !sample.activatesTarget));
    assert.ok(!JSON.stringify({ identity: failure.targetIdentity, initial: failure.initialProbe, recheck: failure.recheckProbe }).includes("PRIVATE-"));
  }, 1280);
});

test("reachable long-page input still passes and scroll recheck restores nested scroll positions", async () => {
  await fixture(`<button>Start</button><div id="scroller" style="height:200px;overflow:auto"><div style="height:2000px"></div><label for="amount">Amount</label><input id="amount" style="width:300px;height:44px"></div>`, async page => {
    const result = await helpers.auditKeyboardAndHotspots(page);
    assert.deepEqual(result.interceptedTargets, []);
    assert.ok(result.recheckedTargetCount > 0);
    assert.equal(await page.locator("#scroller").evaluate(element => element.scrollTop), 0);
  }, 1280);
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
