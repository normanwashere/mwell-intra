import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { before, after, test } from "node:test";

const require = createRequire(new URL("../../apps/shell/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const ts = require("typescript");
const source = await readFile(new URL("./full-intra-live-e2e.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("audit.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ["classify", "routeReadinessSnapshot", "describeRouteStructureProblems", "waitForMeaningfulRoute", "pageAudit", "routeEvidenceToken", "routeNeedsFailureEvidence", "captureScrollableEvidenceForPage", "captureRouteEvidence", "attachRouteEvidence"];
const definitions = names.map(name => {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `actual helper ${name} exists`);
  return node.getText(ast);
});
let browser, directory, helpers;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "route-evidence-"));
  helpers = new Function("mkdir", "path", "auditEvidenceDir", `${definitions.join("\n")}\nreturn {${names.join(",")}};`)(mkdir, path, directory);
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function fixture(nested, width, run) {
  const context = await browser.newContext({ viewport: { width, height: 600 } });
  await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  await page.setContent(`<style>
    *{box-sizing:border-box}body{margin:0;font:16px Arial}header{height:60px;background:#ddd}
    main{${nested ? "height:540px;overflow-y:auto" : ""}}section{height:480px;padding:20px}
    section:nth-child(1){background:#aaddcc}section:nth-child(2){background:#ddaacc}
    section:nth-child(3){background:#ccddaa}input{width:240px;height:40px}
    </style><header>Intra / Warehouse</header><main>
    <section><h1>Receipt review</h1><label>Credential <input type="password" value="FIRST-SECRET"></label>
    <label>Revealed credential <input type="text" autocomplete="current-password" value="REVEALED-SECRET"></label></section>
    <section><h2>Inspection lines</h2><p>Serial A100, quantity 2</p></section>
    <section><h2>Custody history</h2><p>Independent quality acceptance</p></section></main>`);
  try { await run(page); } finally { await context.close(); }
}

for (const nested of [false, true]) {
  for (const width of [390, 1440]) {
    test(`all route frames and secret masking: ${nested ? "main" : "document"} scroll at ${width}`, async () => {
      await fixture(nested, width, async page => {
        const scroll = top => page.evaluate(({ nested, top }) => (nested ? document.querySelector("main") : document.scrollingElement).scrollTo(0, top), { nested, top });
        await scroll(137);
        const identity = { viewport: String(width), role: "operations", route: `/receipts-${nested}`, state: "allowed" };
        const audit = { route: identity.route, class: "rendered", expectedAccess: "allowed", expectationMet: true, overflow: false };
        const result = await helpers.attachRouteEvidence(page, audit, identity);
        assert.equal(result.expectationMet, true);
        assert.equal(result.evidenceCaptureError, null);
        assert.ok(result.evidenceScreenshots.length >= 3, "top, middle and bottom frames retained");
        assert.equal(result.evidenceScreenshot, result.evidenceScreenshots[0]);
        const images = [];
        for (const filename of result.evidenceScreenshots) {
          assert.ok((await stat(filename)).size > 3000, "nonempty rendered JPEG");
          images.push(await readFile(filename));
        }
        assert.notDeepEqual(images[0], images.at(-1), "scroll sections produce distinct images");
        assert.equal(await page.evaluate(nested => (nested ? document.querySelector("main") : document.scrollingElement).scrollTop, nested), 137);
        assert.equal(await page.locator('input[type="password"]').inputValue(), "FIRST-SECRET", "capture never edits credentials");
        await page.locator('input[type="password"]').fill("A-DIFFERENT-SECRET-WITH-DIFFERENT-LENGTH");
        await page.locator('input[type="text"]').fill("CHANGED-REVEALED-SECRET");
        await page.locator("h1").click();
        await scroll(137);
        const second = await helpers.attachRouteEvidence(page, audit, { ...identity, route: `${identity.route}-second` });
        for (let i = 0; i < images.length; i++) {
          assert.deepEqual(await readFile(second.evidenceScreenshots[i]), images[i], "secret values cannot affect screenshot pixels");
        }
      });
    });
  }
}

for (const width of [390, 1440]) {
  test(`choice labels and states survive masking, including sticky controls (${width})`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 600 } });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    try {
      await page.setContent(`<style>
        body{margin:0;font:16px Arial}main{padding:12px}
        .choice{position:relative;display:inline-block;padding:16px;background:#def}
        .choice input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0}
        .choice:has(:checked){background:#8d8}input,textarea{height:24px}
        footer{position:fixed;bottom:0;background:#eee;padding:12px;width:100%}
      </style><main><h1>Choice evidence</h1>
        <label class="choice"><input id="check" type="checkbox" checked>Office category</label>
        <label class="choice"><input id="radio" type="radio" name="category" checked>Equipment category</label>
        <p><input id="password" data-secret type="password" value="SECRET-A"></p>
        <p><input id="revealed" data-secret type="text" autocomplete="current-password" value="REVEALED-A"></p>
        <p><input id="default" data-secret value="TEXT-A"></p>
        <textarea data-secret>PRIVATE-NOTE</textarea>
        <div data-secret contenteditable="plaintext-only">PRIVATE-EDIT</div>
        <div contenteditable="false">Public explanation</div>
        <footer><label><input id="sticky" type="checkbox" checked>Include category</label>
        <input type="button" value="Review category"><button>Continue</button></footer>
      </main>`);
      const capture = async state => {
        const files = await helpers.captureRouteEvidence(page, { viewport: String(width), role: 'fixture', route: '/choice-masking', state });
        assert.equal(files.length, 1);
        return readFile(files[0]);
      };
      const original = await capture('original');
      const explicitMask = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false, mask: [page.locator('[data-secret]')] });
      assert.deepEqual(original, explicitMask, 'choice labels, transparent input overlays, buttons and fixed footer are not masked');
      await page.locator('#password').fill('DIFFERENT-PASSWORD-LONG');
      await page.locator('#password').evaluate(input => { input.type = 'text'; });
      await page.locator('#revealed').fill('DIFFERENT-REVEALED-PASSWORD');
      await page.locator('#default').fill('DIFFERENT-TEXT');
      await page.locator('textarea').fill('DIFFERENT-NOTE');
      await page.locator('[contenteditable="plaintext-only"]').fill('DIFFERENT-EDIT');
      await page.locator('h1').click();
      assert.deepEqual(await capture('secrets-changed'), original, 'all text entry stays masked, including revealed passwords without autocomplete');
      await page.locator('#check').uncheck();
      await page.locator('#sticky').uncheck();
      await page.locator('#radio').evaluate(input => { input.checked = false; });
      await page.locator('h1').click();
      assert.notDeepEqual(await capture('choices-changed'), original, 'changed choice states remain visible in screenshot pixels');
      assert.equal(await page.locator('#password').inputValue(), 'DIFFERENT-PASSWORD-LONG', 'capture does not mutate values');
    } finally {
      await context.close();
    }
  });
}

test("expected denial and failed visual gates both retain screenshot evidence", async () => {
  await fixture(false, 390, async page => {
    await page.setContent("<main><h1>Access denied</h1><p>This role cannot access Finance.</p></main>");
    for (const overflow of [false, true]) {
      const audit = { route: "/finance", class: "access-denied", expectedAccess: "denied", expectationMet: true, overflow };
      const result = await helpers.attachRouteEvidence(page, audit, { viewport: "390", role: "vendor", route: "/finance", state: overflow ? "failed" : "denied" });
      assert.equal(result.evidenceScreenshots.length, 1);
      assert.equal(result.class, audit.class);
      assert.equal(result.expectationMet, true);
      assert.equal(helpers.routeNeedsFailureEvidence(result), overflow, "existing gate is unchanged");
    }
  });
});

test("capture failures cannot pass and navigation failure retains its original error", async () => {
  await fixture(false, 390, async page => {
    page.screenshot = async () => { throw new Error("PRIVATE-PROVIDER-DETAIL"); };
    for (const audit of [
      { route: "/warehouse", class: "rendered", expectationMet: true },
      { route: "/finance", class: "access-denied", expectationMet: true },
      { route: "/broken", class: "navigation-error", expectationMet: false, error: "Navigation timeout" },
    ]) {
      await page.evaluate(() => document.scrollingElement.scrollTo(0, 137));
      const result = await helpers.attachRouteEvidence(page, audit, { viewport: "390", role: "vendor", route: audit.route });
      assert.equal(result.expectationMet, false);
      assert.equal(result.class, audit.class);
      assert.equal(result.error, audit.error);
      assert.equal(result.evidenceScreenshot, null);
      assert.deepEqual(result.evidenceScreenshots, []);
      assert.match(result.evidenceCaptureError, /capture failed/);
      assert.equal(helpers.routeNeedsFailureEvidence(result), true);
      assert.ok(!JSON.stringify(result).includes("PRIVATE-PROVIDER-DETAIL"));
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 137, "failed capture restores scroll");
    }
  });
});

test("route runner attaches evidence unconditionally and on navigation errors", () => {
  const start = source.indexOf("const auditResult = await auditRoute(page, route);");
  assert.ok(start > 0);
  const block = source.slice(start, source.indexOf("routeResults.push(routeResult)", start));
  assert.match(block, /const routeResult = await attachRouteEvidence\(/);
  assert.doesNotMatch(block, /if\s*\(/, "green routes cannot skip capture");
  const runner = source.slice(start, source.indexOf("loginResult = {", start));
  assert.equal((runner.match(/await attachRouteEvidence\(/g) ?? []).length, 2);
  assert.doesNotMatch(runner, /\.catch\(\(\) => null\)/);
});

for (const width of [390, 1440]) {
  test(`active modal body takes priority over long background, with masking and restoration (${width})`, async () => {
    await fixture(false, width, async page => {
      const tag = width === 390 ? "div" : "dialog";
      await page.setContent(`<style>
        *{box-sizing:border-box}body{margin:0;font:16px Arial}main{height:4000px;background:linear-gradient(#eef,#fee)}
        .modal{position:fixed;inset:80px auto auto 20px;margin:0;width:320px;height:420px;padding:0;display:flex;flex-direction:column;background:white}
        header,footer{flex-shrink:0;height:60px;background:white;padding:16px}
        #modal-body{flex:1;min-height:0;overflow-y:auto;scroll-behavior:smooth}
        section{height:${width === 1440 ? 4000 : 350}px;padding:16px}section:first-child{background:#ade}section:nth-child(2){background:#eda}
        [role=alert]{padding:20px;background:#fcc}input{width:180px;height:40px}
      </style><main><h1>Background purchase orders</h1></main>
      <div role="dialog" hidden><div style="overflow:auto;height:100px"><div style="height:9000px">Hidden dialog</div></div></div>
      <${tag} class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="Final excess custody disposition"><header>Excess custody</header>
        <div id="modal-body"><section>Evidence upload<label>Secret <input value="PRIVATE-FIRST"></label></section>
        <section>Document details</section><p role="alert">Private evidence uploads require a signed-in connection.</p></div>
        <footer><button>Record final disposition</button></footer>
      </${tag}>`);
      await page.locator('.modal').evaluate(dialog => {
        if (dialog instanceof HTMLDialogElement) dialog.showModal();
        else dialog.focus();
      });
      const reset = () => page.evaluate(() => {
        document.scrollingElement.scrollTo({ top: 137, behavior: 'instant' });
        document.querySelector('#modal-body').scrollTo({ top: 77, behavior: 'instant' });
      });
      await reset();
      const screenshot = page.screenshot.bind(page);
      const frames = [];
      page.screenshot = async options => {
        frames.push(await page.evaluate(() => {
          const body = document.querySelector('#modal-body');
          const alert = document.querySelector('[role=alert]');
          const rect = alert.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + 10, rect.top + rect.height / 2);
          return { top: body.scrollTop, background: document.scrollingElement.scrollTop,
            alertVisible: Boolean(hit && (hit === alert || alert.contains(hit))),
            footerVisible: document.querySelector('footer').getBoundingClientRect().bottom <= innerHeight };
        }));
        return screenshot(options);
      };
      const identity = { viewport: String(width), role: 'supervisor', route: '/modal-evidence' };
      const first = await helpers.captureRouteEvidence(page, identity);
      assert.ok(first.length >= 3 && first.length <= 13);
      if (width === 1440) assert.equal(first.length, 13, 'long modal stays within total frame limit');
      assert.equal(frames[0].top, 0);
      assert.equal(new Set(frames.map(frame => frame.top)).size, first.length, 'distinct modal scroll frames');
      assert.ok(frames.every(frame => frame.background === 137 && frame.footerVisible), 'background and footer remain unchanged');
      assert.equal(frames.at(-1).alertVisible, true, 'bottom alert is captured above the footer');
      assert.equal(await page.locator('#modal-body').evaluate(el => el.scrollTop), 77);
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 137);
      const images = await Promise.all(first.map(filename => readFile(filename)));
      assert.notDeepEqual(images[0], images.at(-1));
      await page.locator('input').evaluate(el => { el.value = 'DIFFERENT-PRIVATE-SECRET'; });
      const second = await helpers.captureRouteEvidence(page, { ...identity, route: '/modal-evidence-second' });
      for (let i = 0; i < images.length; i++) assert.deepEqual(await readFile(second[i]), images[i], 'modal input remains masked');
      page.screenshot = async () => { throw new Error('PRIVATE-CAPTURE-FAILURE'); };
      await assert.rejects(helpers.captureRouteEvidence(page, identity), /PRIVATE-CAPTURE-FAILURE/);
      assert.equal(await page.locator('#modal-body').evaluate(el => el.scrollTop), 77, 'failed capture restores modal');
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 137, 'failed capture preserves background');
    });
  });
}

test("a non-scrolling visible dialog captures once without scrolling the background", async () => {
  await fixture(false, 390, async page => {
    await page.evaluate(() => {
      document.scrollingElement.scrollTop = 137;
      const dialog = document.createElement('dialog');
      dialog.innerHTML = '<h2>Upload rejected</h2><p role="alert">Reconnect and retry</p><button>Close</button>';
      document.body.append(dialog);
      dialog.showModal();
    });
    const result = await helpers.captureRouteEvidence(page, { viewport: '390', role: 'supervisor', route: '/short-dialog' });
    assert.equal(result.length, 1);
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 137);
    assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
  });
});

const vendorUnavailable = '<section role="alert"><h1>Vendor onboarding unavailable</h1><p>This workspace is limited to signed-in vendor representatives.</p><a href="/">Return home</a></section>';
const vendorLoading = '<h1>Role onboarding</h1><p>Loading your onboarding</p>';
const vendorReady = '<h1>Vendor onboarding</h1><p>4 of 4 required steps complete</p><a href="/vendor">Vendor portal</a>';
const vendorRoute = { path: '/vendor/onboarding', expectedAccess: 'allowed' };

async function vendorFixture(width, run) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<main>${vendorUnavailable}</main>` }));
  const page = await context.newPage();
  await page.goto('https://fixture.test/vendor/onboarding');
  try { await run(page); } finally { await context.close(); }
}

test('vendor unavailable is denial, never rendered success', () => {
  assert.equal(helpers.classify('Vendor onboarding unavailable This workspace is limited to signed-in vendor representatives.', 'https://fixture.test/vendor/onboarding'), 'access-denied');
});

test('both initial and recovery route audits pass the exact route to readiness', () => {
  const audit = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'auditRoute');
  const calls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'waitForMeaningfulRoute') calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(audit);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.arguments[1]?.getText(ast), '{ route }');
});

for (const width of [768, 1440]) {
  test(`vendor readiness waits through profile-unavailable and learning-loading hydration (${width})`, async () => {
    await vendorFixture(width, async page => {
      let settled = false;
      const ready = helpers.waitForMeaningfulRoute(page, { route: vendorRoute, timeout: 1500 }).then(() => { settled = true; });
      await page.waitForTimeout(80);
      assert.equal(settled, false, 'initial audience denial cannot satisfy allowed readiness');
      await page.locator('main').evaluate((main, html) => { main.innerHTML = html; }, vendorLoading);
      await page.waitForTimeout(80);
      assert.equal(settled, false, 'loading heading cannot satisfy readiness');
      await page.locator('main').evaluate((main, html) => { main.innerHTML = html; }, vendorReady);
      await ready;
      assert.deepEqual((await helpers.pageAudit(page)).h1, ['Vendor onboarding']);
    });
  });
}

test('permanent vendor denial times out for allowed access but stays auditable as expected denial', async () => {
  await vendorFixture(768, async page => {
    await assert.rejects(helpers.waitForMeaningfulRoute(page, { route: vendorRoute, timeout: 200 }), /Timeout/);
    await helpers.waitForMeaningfulRoute(page, { route: { ...vendorRoute, expectedAccess: 'denied' }, timeout: 200 });
  });
});

for (const transition of ['before-capture', 'during-capture', 'stale-denial', 'stable']) {
  test(`vendor screenshot and audited state remain bound: ${transition}`, async () => {
    await vendorFixture(768, async page => {
      await page.locator('main').evaluate((main, html) => { main.innerHTML = html; }, vendorReady);
      const audit = { route: '/vendor/onboarding', class: 'rendered', expectedAccess: 'allowed', expectationMet: true,
        h1: [transition === 'stale-denial' ? 'Vendor onboarding unavailable' : 'Vendor onboarding'] };
      if (transition === 'before-capture') await page.locator('main').evaluate((main, html) => { main.innerHTML = html; }, vendorLoading);
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async options => {
        if (transition === 'during-capture') await page.locator('main').evaluate((main, html) => { main.innerHTML = html; }, vendorLoading);
        return screenshot(options);
      };
      const result = await helpers.attachRouteEvidence(page, audit, { viewport: '768', role: 'vendor', route: audit.route, state: 'allowed' });
      assert.equal(result.expectationMet, transition === 'stable');
      assert.ok(result.evidenceScreenshots.length > 0, 'failed-state captures are retained, not relabeled as success');
      if (transition !== 'stable') assert.match(result.evidenceCaptureError, /state changed|not ready/i);
      assert.equal(result.class, audit.class, 'original observation remains intact');
    });
  });
}

test('a changed middle frame fails even when the final vendor frame recovers', async () => {
  await vendorFixture(768, async page => {
    await page.locator('main').evaluate((main, html) => { main.innerHTML = html; main.style.minHeight = '2200px'; }, vendorReady);
    const audit = { route: '/vendor/onboarding', class: 'rendered', expectationMet: true, h1: ['Vendor onboarding'] };
    const screenshot = page.screenshot.bind(page);
    let frames = 0;
    page.screenshot = async options => {
      frames += 1;
      await page.locator('main').evaluate((main, html) => { main.innerHTML = html; }, frames === 2 ? vendorLoading : vendorReady);
      return screenshot(options);
    };
    const result = await helpers.attachRouteEvidence(page, audit, { viewport: '768', role: 'vendor', route: audit.route });
    assert.ok(frames >= 3);
    assert.equal(result.evidenceScreenshots.length, frames);
    assert.equal(result.expectationMet, false);
    assert.ok(result.evidenceStateProblems.includes('not-ready'));
    assert.deepEqual((await helpers.pageAudit(page)).h1, ['Vendor onboarding']);
    assert.equal(await page.evaluate(() => scrollY), 0);
  });
});

test('vendor expected denial stays passing only when its capture stays denied; failed audits are never upgraded', async () => {
  await vendorFixture(768, async page => {
    const denied = { route: '/vendor/onboarding', class: 'access-denied', expectedAccess: 'denied', expectationMet: true, h1: ['Vendor onboarding unavailable'] };
    const identity = { viewport: '768', role: 'employee', route: denied.route, state: 'denied' };
    const stable = await helpers.attachRouteEvidence(page, denied, identity);
    assert.equal(stable.expectationMet, true);
    await page.locator('main').evaluate((main, html) => { main.innerHTML = html; }, vendorReady);
    const changed = await helpers.attachRouteEvidence(page, denied, identity);
    assert.equal(changed.expectationMet, false);
    assert.ok(changed.evidenceStateProblems.includes('class-changed'));
    const failed = await helpers.attachRouteEvidence(page, { ...denied, expectationMet: false, error: 'Original failure' }, identity);
    assert.equal(failed.expectationMet, false);
    assert.equal(failed.error, 'Original failure');
    assert.ok(failed.evidenceScreenshots.length);
  });
});
