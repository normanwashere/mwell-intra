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
  test(`wrapped inline link whitespace is not an overlapping control (${width})`, async () => {
    await fixture(`<style>main{min-height:700px}p{width:320px;font:14px/24px Arial;overflow-wrap:break-word}</style><p>Original order: <a id="wrapped" href="#order">WMS-ECOM-177f0c97-a6de-4ee4-82b1-37a09f4f5e37-mobile390</a></p>`, async page => {
      const geometry = await page.locator("#wrapped").evaluate(link => {
        document.querySelector("main").tabIndex = 0;
        const rect = link.getBoundingClientRect();
        const fragments = [...link.getClientRects()];
        return {
          fragments: fragments.length,
          unionHit: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.tagName,
          fragmentHits: fragments.map(fragment => document.elementFromPoint(fragment.left + fragment.width / 2, fragment.top + fragment.height / 2) === link),
        };
      });
      assert.equal(geometry.fragments, 2, "the reference naturally wraps across two lines");
      assert.notEqual(geometry.unionHit, "A", "union center is whitespace, not clickable link content");
      assert.ok(geometry.fragmentHits.every(Boolean), "both real fragments are unobstructed");
      const result = await helpers.pageAudit(page);
      assert.deepEqual(result.overlaps, [], "a containing focusable main is not covering either fragment");
    }, width);
  });

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

for (const width of [1440, 390]) {
  for (const coveredFragment of [0, 1]) {
    test(`a real overlay on wrapped fragment ${coveredFragment + 1} remains an overlap (${width})`, async () => {
      await fixture(`<style>p{width:320px;font:14px/24px Arial;overflow-wrap:break-word}</style><p>Original order: <a id="wrapped" href="#order">WMS-ECOM-177f0c97-a6de-4ee4-82b1-37a09f4f5e37-mobile390</a></p>`, async page => {
        await page.locator("#wrapped").evaluate((link, index) => {
          const rect = link.getClientRects()[index];
          const overlay = document.createElement("div");
          overlay.tabIndex = 0;
          overlay.setAttribute("aria-label", "Blocking overlay");
          Object.assign(overlay.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: "100", background: "white" });
          document.body.append(overlay);
        }, coveredFragment);
        const result = await helpers.pageAudit(page);
        assert.equal(result.overlaps.length, 1, "one blocked fragment must not be excused by the other reachable fragment");
        assert.equal(result.overlaps[0].b, "Blocking overlay");
        assert.match(result.overlaps[0].a, /^WMS-ECOM-/);
      }, width);
    });
  }

  test(`modal and sticky occlusion still block ordinary controls (${width})`, async () => {
    await fixture(`<style>body{margin:0}main{height:1800px}header{position:sticky;top:0;height:120px;background:white;z-index:10}#target{display:block;margin-top:20px;width:200px;height:48px}</style><header tabindex="0" aria-label="Sticky header"></header><a id="target" href="#order">Open order</a><dialog tabindex="0" aria-label="Blocking modal" style="position:fixed;inset:0;margin:0;width:100vw;height:100vh;max-width:none;max-height:none">Review</dialog>`, async page => {
      await page.evaluate(() => window.scrollTo(0, 160));
      const sticky = await helpers.pageAudit(page);
      assert.ok(sticky.overlaps.some(item => item.a === "Open order" && item.b === "Sticky header"));
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelector("dialog").showModal();
      });
      const modal = await helpers.pageAudit(page);
      assert.ok(modal.overlaps.some(item => item.a === "Open order" && item.b === "Review"));
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

// Reproduce task recommendations arriving between scrollIntoView and the
// hotspot helper's paint wait, without relying on a wall-clock network delay.
async function installLateHomeSection(page, { overlay = false, continuous = false } = {}) {
  await page.evaluate(({ overlay, continuous }) => {
    const target = document.querySelector("#home-target");
    const nativeScroll = target.scrollIntoView.bind(target);
    window.homeScrollAttempts = 0;
    target.scrollIntoView = (options) => {
      nativeScroll(options);
      window.homeScrollAttempts += 1;
      if (continuous || window.homeScrollAttempts === 1) {
        requestAnimationFrame(() => {
          const section = document.querySelector("#late-tasks");
          section.style.height = `${section.offsetHeight + 704}px`;
          if (overlay) {
            const blocker = document.createElement("div");
            blocker.id = "late-overlay";
            blocker.setAttribute("aria-label", "Blocking overlay");
            blocker.style.cssText = "position:fixed;inset:0;z-index:9999;background:white";
            document.body.append(blocker);
          }
        });
      }
    };
  }, { overlay, continuous });
}

const lateHomeFixture = `<style>html{overflow-anchor:none}#home-target{display:block;width:300px;height:101px}</style><button>Start</button><div style="height:1000px"></div><div id="late-tasks"></div><a id="home-target" href="#home">Warehouse inventory and receiving</a><div style="height:1000px"></div>`;

test("mobile home hotspot is re-centered after a 704px late task-section insertion", async () => {
  await fixture(lateHomeFixture, async page => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installLateHomeSection(page);
    const result = await helpers.auditKeyboardAndHotspots(page);
    assert.deepEqual(result.interceptedTargets, []);
    assert.equal(result.focusAfterTab.tag, "button");
    assert.equal(result.focusAfterTab.label, "Start");
    assert.equal(result.focusEscapedDialog, false);
    assert.equal(await page.evaluate(() => window.homeScrollAttempts), 2);
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.locator("#home-target").click();
    assert.equal(await page.evaluate(() => location.hash), "#home");
  }, 390);
});

test("late layout insertion cannot hide a real overlay or waive a 43px mobile target", async () => {
  await fixture(lateHomeFixture, async page => {
    await page.locator("#home-target").evaluate(element => { element.style.height = "43px"; });
    await installLateHomeSection(page, { overlay: true });
    const result = await helpers.auditKeyboardAndHotspots(page);
    const failure = result.interceptedTargets.find(item => item.targetIdentity.id === "home-target");
    assert.ok(failure);
    assert.equal(failure.blocker, "Blocking overlay");
    assert.equal(failure.recheckProbe.reason, "blocked");
    assert.ok(failure.recheckProbe.samples.every(sample => sample.hit.id === "late-overlay"));
    assert.ok(result.undersizedTargets.some(item => item.height === 43));
    assert.equal(await page.evaluate(() => scrollY), 0);
  }, 390);
});

test("continuously shifting mobile targets fail within three scroll attempts", async () => {
  await fixture(lateHomeFixture, async page => {
    await installLateHomeSection(page, { continuous: true });
    const result = await helpers.auditKeyboardAndHotspots(page);
    const failure = result.interceptedTargets.find(item => item.targetIdentity.id === "home-target");
    assert.ok(failure);
    assert.equal(failure.recheckProbe.reason, "unstable-layout");
    assert.equal(failure.recheckProbe.attempts.length, 3);
    assert.equal(await page.evaluate(() => window.homeScrollAttempts), 3);
    assert.equal(await page.evaluate(() => scrollY), 0);
  }, 390);
});

test("hotspot scroll and restoration are instant even with smooth nested scrolling", async () => {
  await fixture(`<style>html{scroll-behavior:smooth}</style><button>Start</button><div style="height:1000px"></div><div id="scroller" style="height:200px;overflow:auto;scroll-behavior:smooth"><div style="height:2000px"></div><button id="nested-target">Inspect receipt</button></div><div style="height:1000px"></div>`, async page => {
    const result = await helpers.auditKeyboardAndHotspots(page);
    assert.deepEqual(result.interceptedTargets, []);
    assert.ok(result.recheckedTargetCount > 0);
    assert.equal(await page.locator("#scroller").evaluate(element => element.scrollTop), 0);
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator("#scroller").evaluate(element => element.scrollTop), 0);
    assert.equal(await page.evaluate(() => scrollY), 0);
  }, 390);
});

const nestedHotspotFixture = `<style>html{overflow-anchor:none}body{margin:0;min-height:1800px}main{margin-top:80px;height:680px;overflow:auto;overflow-anchor:none}#settling-target{display:block;width:300px;height:44px;min-height:44px;padding:0}</style><button>Start</button><div style="height:1000px"></div><a id="settling-target" href="#settled">Inspect receipt</a><div style="height:1000px"></div>`;

async function installNestedScrollSettlement(page, { overlay = false, continuous = false, movingLayout = false } = {}) {
  await page.evaluate(({ overlay, continuous, movingLayout }) => {
    const target = document.querySelector('#settling-target');
    const container = document.querySelector('main');
    const nativeScroll = target.scrollIntoView.bind(target);
    window.settlementScrollAttempts = 0;
    window.settlementFrames = 0;
    target.scrollIntoView = options => {
      nativeScroll(options);
      window.settlementScrollAttempts += 1;
      const delta = window.settlementScrollAttempts % 2 ? 4 : -4;
      requestAnimationFrame(() => {
        // Match CI202: main and window each adjust by 4px after centering.
        // Re-centering restarts that adjustment; merely waiting lets it settle.
        container.scrollTop += delta;
        window.scrollBy({ top: delta, behavior: 'instant' });
        if (overlay && !document.querySelector('#settlement-overlay')) {
          const blocker = document.createElement('div');
          blocker.id = 'settlement-overlay';
          blocker.setAttribute('aria-label', 'Blocking overlay');
          blocker.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white';
          document.body.append(blocker);
        }
      });
      if (continuous && !window.settlementFrames) {
        const shift = () => {
          window.settlementFrames += 1;
          if (movingLayout) target.style.transform = `translateY(${window.settlementFrames % 2 ? 8 : -8}px)`;
          else container.scrollTop += window.settlementFrames % 2 ? 4 : -4;
          requestAnimationFrame(shift);
        };
        requestAnimationFrame(shift);
      }
    };
  }, { overlay, continuous, movingLayout });
}

for (const width of [360, 390]) {
  test(`nested mobile scroll settles without restarting its 8px adjustment (${width})`, async () => {
    await fixture(nestedHotspotFixture, async page => {
      await page.setViewportSize({ width, height: 844 });
      await installNestedScrollSettlement(page);
      const result = await helpers.auditKeyboardAndHotspots(page);
      assert.deepEqual(result.interceptedTargets.map(item => ({ id: item.targetIdentity.id, reason: item.recheckProbe.reason })), []);
      assert.equal(await page.evaluate(() => window.settlementScrollAttempts), 1, 'wait for stability before trying another center');
      assert.equal(await page.locator('main').evaluate(element => element.scrollTop), 0);
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.deepEqual(result.undersizedTargets, []);
      await page.locator('#settling-target').click();
      assert.equal(await page.evaluate(() => location.hash), '#settled');
    }, width);
  });
}

test('nested mobile settling never excuses a persistent overlay', async () => {
  await fixture(nestedHotspotFixture, async page => {
    await installNestedScrollSettlement(page, { overlay: true });
    const result = await helpers.auditKeyboardAndHotspots(page);
    const failure = result.interceptedTargets.find(item => item.targetIdentity.id === 'settling-target');
    assert.ok(failure);
    assert.equal(failure.recheckProbe.reason, 'blocked');
    assert.equal(failure.blocker, 'Blocking overlay');
    assert.ok(failure.recheckProbe.samples.every(sample => !sample.activatesTarget));
    assert.equal(await page.locator('main').evaluate(element => element.scrollTop), 0);
    assert.equal(await page.evaluate(() => scrollY), 0);
  }, 390);
});

for (const movingLayout of [false, true]) {
  test(`reachable mobile target that keeps ${movingLayout ? 'changing layout' : 'scrolling'} still fails`, async () => {
    await fixture(nestedHotspotFixture, async page => {
      await installNestedScrollSettlement(page, { continuous: true, movingLayout });
      const result = await helpers.auditKeyboardAndHotspots(page);
      const failure = result.interceptedTargets.find(item => item.targetIdentity.id === 'settling-target');
      assert.ok(failure, 'a sampled hit does not waive continuous movement');
      assert.equal(failure.recheckProbe.reason, 'unstable-layout');
      assert.equal(failure.recheckProbe.attempts.length, 3);
      assert.ok(failure.recheckProbe.attempts.every(attempt => attempt.settled === false && attempt.settleFrameCount === 8));
      assert.equal(failure.recheckProbe.samples.length, 9, 'continuous movement remains visible and hit-testable');
      assert.ok(failure.recheckProbe.samples.every(sample => sample.activatesTarget));
      assert.equal(await page.evaluate(() => window.settlementScrollAttempts), 3);
    }, 390);
  });
}

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
