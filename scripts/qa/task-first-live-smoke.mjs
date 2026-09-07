import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { CURRENT_LIVE_ROLES } from "./live-e2e-scenarios.mjs";
import { eligibleTaskTargets, readinessDom, readinessStatus, summarizeTasks } from "./task-readiness-sweep.mjs";

const require = createRequire(new URL("../../apps/shell/package.json", import.meta.url));
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 30000 });
const allowedOrigins = new Set([
  "https://mwell-intra-uat.vercel.app",
  "https://mwell-intra-6ena7ruqm-normans-projects-d718ecb1.vercel.app",
  "https://mwell-intra-k8udn3aka-normans-projects-d718ecb1.vercel.app",
  "https://mwell-intra-534eobi9l-normans-projects-d718ecb1.vercel.app",
]);
const origin = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const project = "kkoitlvydytdhlpxhuah";
const serviceWorkers = process.env.AUDIT_SERVICE_WORKERS ?? "allow";
const taskMode = process.env.AUDIT_TASK_MODE ?? "sampled";
const output = path.resolve("outputs/task-first-candidate", `smoke-${serviceWorkers}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const password = process.env.AUDIT_PASSWORD;
const expectedSha = process.env.AUDIT_EXPECTED_SHA;
const roles = process.env.AUDIT_ROLE ? CURRENT_LIVE_ROLES.filter(actor => actor.role === process.env.AUDIT_ROLE) : CURRENT_LIVE_ROLES;
const views = [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]
  .filter(view => !process.env.AUDIT_VIEWPORT || view.name === process.env.AUDIT_VIEWPORT);
const report = { startedAt: new Date().toISOString(), baseUrl: origin, expectedSha, taskMode,
  targetKind: origin === "https://mwell-intra-uat.vercel.app" ? "public-uat" : "protected-candidate",
  serviceWorkers, protectionMode: protectionBypass ? "origin-scoped-header-and-browser-cookie" : "none", assertionTimeoutMs: 30000,
  adjustments: ["Normal service workers allowed by default; blocked-service-worker attempt preserved separately", "Assertions use approved 30000ms network budget instead of Playwright default 5000ms"],
  mutations: false, freshLearningCompletionTested: false, expectedCases: roles.length * views.length,
  roleFilter: process.env.AUDIT_ROLE ?? null, viewportFilter: process.env.AUDIT_VIEWPORT ?? null, results: [] };
let browser;
let stopRequested = false;
process.on("SIGINT", () => { stopRequested = true; });
process.on("SIGTERM", () => { stopRequested = true; });

function safeError(error) {
  return String(error?.message ?? error)
    .replaceAll(password || "\0", "[REDACTED]")
    .replaceAll(protectionBypass || "\0", "[REDACTED]").slice(0, 4000);
}

function redactedUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}${url.search ? `?${[...url.searchParams.keys()].map(key => `${encodeURIComponent(key)}=[REDACTED]`).join("&")}` : ""}${url.hash ? "#[REDACTED]" : ""}`;
}

async function identity() {
  const response = await fetch(`${origin}/api/health`, { cache: "no-store", redirect: "error",
    headers: protectionBypass ? { "x-vercel-protection-bypass": protectionBypass } : {},
    signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, "Health endpoint must return 200");
  const health = await response.json();
  assert.equal(health.deployment?.appEnv, "uat");
  assert.equal(health.deployment?.supabaseProjectRef, project);
  assert.equal(health.commit, expectedSha, "Deployed SHA differs from exact candidate");
  return { commit: health.commit, deployment: health.deployment, status: health.status };
}

async function persist() {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "smoke-results.json"), `${JSON.stringify(report, null, 2)}\n`);
}

async function ready(page) {
  await expect(page.locator('[aria-busy="true"]:visible')).toHaveCount(0, { timeout: 30000 });
}

async function capture(page, item, label) {
  if (item.screenshots.length >= (item.captureLimit ?? 7) || new URL(page.url()).pathname === "/login") return;
  const unavailable = await page.getByRole("alert").filter({ hasText: "Task learning readiness is unavailable" }).count();
  (item.readinessObservations ??= []).push({ label, unavailableAlerts: unavailable });
  // Mask entered text and password fields (including revealed passwords), not empty controls or choice states.
  const controls = page.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([type="hidden"]), textarea, [contenteditable="true"]');
  const sensitive = await controls.evaluateAll(nodes => nodes.map(node => Boolean(
    node.type === "password" || /password/i.test(`${node.id} ${node.name} ${node.autocomplete}`) ||
    (node.value ?? node.textContent ?? "").trim()
  )));
  const file = `${item.role}-${item.viewport}-${label}.png`;
  const search = page.locator("#knowledge-search");
  const count = await search.count();
  const knowledgeSearch = { selector: "#knowledge-search", count, visible: count === 1 && await search.isVisible(),
    empty: count === 1 ? (await search.inputValue()) === "" : null,
    boundingBox: count === 1 ? await search.boundingBox() : null };
  const capturedAt = new Date().toISOString();
  await page.screenshot({ path: path.join(output, file), fullPage: false,
    mask: sensitive.flatMap((yes, index) => yes ? [controls.nth(index)] : []), maskColor: "#64748b" });
  item.screenshots.push(file);
  const bytes = await readFile(path.join(output, file));
  (item.imageEvidence ??= []).push({ file, capturedAt, captureFinishedAt: new Date().toISOString(),
    sha256: createHash("sha256").update(bytes).digest("hex"), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
    sourceSha: expectedSha, url: redactedUrl(page.url()), knowledgeSearch, supplementalProvenanceOnly: true });
}

function taskUrl(page, task, pathname) {
  const url = new URL(page.url());
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, pathname);
  assert.equal(url.searchParams.get("task"), task.id);
  assert.equal(url.searchParams.get("next"), task.actionHref);
  assert.equal(url.searchParams.get("smoke"), "retained");
}

try {
  assert.equal(process.env.APP_ENV, "uat");
  assert.ok(allowedOrigins.has(origin), "Only explicit UAT/candidate origins are allowed");
  assert.equal(process.env.SUPABASE_PROJECT_REF, project);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, ""), `https://${project}.supabase.co`);
  assert.equal(process.env.AUDIT_MUTATIONS, "false", "Explicit read-only mode is required");
  assert.ok(["allow", "block"].includes(serviceWorkers));
  assert.ok(["sampled", "all-eligible"].includes(taskMode));
  assert.ok(roles.length > 0 && views.length > 0, "Unknown role or viewport filter");
  assert.match(expectedSha ?? "", /^[a-f0-9]{40}$/, "AUDIT_EXPECTED_SHA must be the full candidate SHA");
  assert.ok(password, "AUDIT_PASSWORD is required in process environment");
  report.identityBefore = await identity();
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true });
  let stop = false;
  for (const view of views) {
    for (const actor of roles) {
      if (stopRequested || existsSync(path.join(output, "STOP"))) {
        report.stopReason = "Operator requested stop at case boundary";
        stop = true;
      }
      if (stop) break;
      await identity();
      const item = { role: actor.role, viewport: view.name, login: "not-attempted", status: "running", screenshots: [], checks: [], errors: [] };
      report.results.push(item);
      const context = await browser.newContext({ viewport: { width: view.width, height: view.height },
        isMobile: view.width === 390, hasTouch: view.width === 390, serviceWorkers });
      if (protectionBypass) {
        // Forward actual requests unchanged except the origin-scoped protection credential.
        await context.route("**/*", async route => {
          const request = route.request();
          const headers = await request.allHeaders();
          delete headers["x-vercel-protection-bypass"];
          if (new URL(request.url()).origin === origin) headers["x-vercel-protection-bypass"] = protectionBypass;
          await route.continue({ headers });
        });
      }
      const page = await context.newPage();
      const snapshotReads = [];
      page.setDefaultTimeout(20000);
      page.on("pageerror", error => item.errors.push({ type: "pageerror", message: safeError(error) }));
      page.on("requestfailed", request => item.errors.push({ type: "requestfailed",
        url: redactedUrl(request.url()), message: safeError(request.failure()?.errorText ?? "Unknown transport failure") }));
      page.on("response", response => {
        const url = new URL(response.url());
        if (url.origin === `https://${project}.supabase.co` && ["/rest/v1/rpc/my_learning_snapshot", "/rest/v1/rpc/resolve_assignments"].includes(url.pathname) && response.ok()) {
          snapshotReads.push(response.json().then(value => {
            const capability = item => ({ module: item?.module, capability: item?.capability });
            item.learningSnapshot = {
              responsePath: url.pathname,
              requirements: (value.curricula ?? []).flatMap(entry => (entry.requirements ?? []).map(requirement => ({
                id: requirement.id, version: requirement.version, audience: requirement.audience,
                prerequisiteIds: requirement.prerequisiteIds, capabilityOutcomes: (requirement.capabilityOutcomes ?? []).map(capability),
              }))),
              lockedCapabilities: (value.lockedCapabilities ?? []).map(lock => ({ capability: capability(lock.capability), reason: lock.reason, requirementIds: lock.requirementIds })),
              progress: (value.progress ?? []).map(progress => ({ requirementId: progress.requirementId, requirementVersion: progress.requirementVersion, state: progress.state })),
            };
          }).catch(() => { item.snapshotDiagnosticUnavailable = true; }));
        }
        if (response.status() >= 400 && [origin, `https://${project}.supabase.co`].includes(url.origin)) {
          item.errors.push({ type: "http", status: response.status(), path: url.pathname });
        }
      });
      try {
        if (protectionBypass) {
          // Set the shared browser cookie once; never forward the cookie-setting header on redirects.
          const preflight = await context.request.get(`${origin}/login`, {
            headers: { "x-vercel-protection-bypass": protectionBypass, "x-vercel-set-bypass-cookie": "true" },
            maxRedirects: 0,
          });
          assert.ok(preflight.status() >= 200 && preflight.status() < 400, "Protection cookie preflight failed");
          const probe = await context.request.get(`${origin}/login`, { maxRedirects: 0 });
          assert.equal(probe.status(), 200, "Cookie-only protection check must succeed before actor login");
          item.protectionCookieVerified = true;
        }
        await page.goto(`${origin}/login?redirect=%2F`, { waitUntil: "domcontentloaded" });
        await page.locator("#email").fill(actor.email);
        await page.locator("#password").fill(password);
        await page.getByRole("button", { name: /^sign in$/i }).click();
        await page.waitForURL(url => url.pathname !== "/login", { timeout: 25000 });
        item.login = "signed-in";
        const pathname = actor.kind === "vendor" ? "/vendor/onboarding" : "/onboarding";
        const tasksResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/knowledge/tasks" && response.request().method() === "GET");
        await page.goto(`${origin}${pathname}?smoke=retained`, { waitUntil: "domcontentloaded" });
        const response = await tasksResponse;
        assert.equal(response.status(), 200, "Actual authenticated tasks endpoint");
        assert.ok(!response.url().includes("demoProfile"), "No demo task projection");
        const { tasks } = await response.json();
        assert.ok(Array.isArray(tasks) && tasks.length > 0, "Actor must receive eligible tasks");
        item.availableTaskIds = tasks.map(task => task.id);
        if (taskMode === "all-eligible") {
          const targets = eligibleTaskTargets(tasks, origin, pathname);
          item.captureLimit = targets.length * 2;
          item.tasks = [];
          for (const [index, target] of targets.entries()) {
            if (stopRequested || existsSync(path.join(output, "STOP"))) break;
            const result = { id: target.task.id, navigation: "unexecuted", readiness: "unexecuted", observations: [], screenshots: [] };
            item.tasks.push(result);
            const firstImage = item.screenshots.length;
            try {
              await page.goto(target.url, { waitUntil: "domcontentloaded" });
              const region = page.getByRole("region", { name: "Task learning", exact: true });
              await expect(region).toBeVisible();
              await expect(region).toHaveAttribute("data-task-id", target.task.id);
              await ready(page);
              taskUrl(page, target.task, pathname);
              result.observations.push(await readinessDom(page, target.task.id));
              await capture(page, item, `task-${index + 1}-selected`);
              await page.reload({ waitUntil: "domcontentloaded" });
              await expect(region).toBeVisible();
              await expect(region).toHaveAttribute("data-task-id", target.task.id);
              await ready(page);
              taskUrl(page, target.task, pathname);
              result.observations.push(await readinessDom(page, target.task.id));
              await capture(page, item, `task-${index + 1}-reloaded`);
              result.navigation = "passed";
            } catch (error) {
              result.navigation = "failed";
              result.failure = safeError(error);
              result.failureUrl = redactedUrl(page.url());
              if (item.screenshots.length - firstImage < 2) await capture(page, item, `task-${index + 1}-failure`).catch(() => {});
            }
            result.readiness = readinessStatus(result.observations, target.task.id);
            result.screenshots = item.screenshots.slice(firstImage);
            await persist();
            if (new URL(page.url()).pathname === "/login") { stop = true; report.stopReason = "Session lost during task sweep"; break; }
          }
          item.taskSummary = summarizeTasks(item.tasks, targets.length);
          item.navigationAborts = item.errors.filter(error => error.type === "requestfailed" && error.message === "net::ERR_ABORTED");
          item.actionableErrors = item.errors.filter(error => !(error.type === "requestfailed" && error.message === "net::ERR_ABORTED"));
          item.status = item.taskSummary.complete && item.taskSummary.navigationPassed === targets.length &&
            item.taskSummary.readinessPassed === targets.length && item.actionableErrors.length === 0 ? "passed" : "failed";
          continue;
        }
        await expect(page.getByRole("heading", { name: "What are you working on?", exact: true })).toBeVisible();
        await ready(page);
        await capture(page, item, "chooser");
        await page.getByRole("button", { name: "Prepare for task", exact: true }).first().click();
        await expect(page.getByRole("region", { name: "Task learning", exact: true })).toBeVisible();
        let task = tasks.find(value => value.id === new URL(page.url()).searchParams.get("task"));
        assert.ok(task, "Selected task belongs to authenticated response");
        taskUrl(page, task, pathname);
        item.checks.push("selection-and-next-url");
        await capture(page, item, "selected");
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.getByRole("region", { name: "Task learning", exact: true })).toBeVisible();
        taskUrl(page, task, pathname);
        item.checks.push("reload-retains-selection-and-next");
        await page.getByText("Change task", { exact: true }).click();
        await expect(page.getByRole("button", { name: "Selected", exact: true })).toHaveCount(1);
        const alternatives = page.getByRole("button", { name: "Prepare for task", exact: true });
        if (await alternatives.count()) {
          const previous = task.id;
          await alternatives.first().click();
          await expect.poll(() => new URL(page.url()).searchParams.get("task")).not.toBe(previous);
          task = tasks.find(value => value.id === new URL(page.url()).searchParams.get("task"));
          assert.ok(task);
          taskUrl(page, task, pathname);
          await page.reload({ waitUntil: "domcontentloaded" });
          await expect(page.getByRole("region", { name: "Task learning", exact: true })).toBeVisible();
          taskUrl(page, task, pathname);
          item.checks.push("change-task-and-reload");
          await page.getByText("Change task", { exact: true }).click();
        } else {
          assert.equal(tasks.length, 1, "Multiple eligible tasks must permit changing selection");
          item.checks.push("single-task-change-not-applicable");
        }
        await capture(page, item, "change-task");
        const row = page.locator("li").filter({ has: page.getByRole("button", { name: "Selected", exact: true }) });
        const guide = row.getByRole("link", { name: "View guide", exact: true });
        const href = await guide.getAttribute("href");
        assert.equal(href, task.guideHref);
        const guideUrl = new URL(href, origin);
        assert.equal(guideUrl.origin, origin);
        assert.equal(guideUrl.pathname, "/knowledge");
        await guide.click();
        await expect(page).toHaveURL(guideUrl.href);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await expect(page.getByText("Screen evidence is being prepared", { exact: true })).toHaveCount(0);
        await ready(page);
        item.checks.push("selected-task-guide-navigation");
        await capture(page, item, "guide-top");
        await page.evaluate(() => window.scrollBy(0, innerHeight * 0.8));
        await capture(page, item, "guide-scroll");
        await page.goto(`${origin}/knowledge?mode=task`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await ready(page);
        await capture(page, item, "knowledge");
        const search = page.locator("#knowledge-search");
        if (await search.count() === 1) {
          await search.scrollIntoViewIfNeeded();
          if (process.env.AUDIT_RECONNECT === "true" && report.results.length === 1) {
            const query = "task-first reconnect smoke";
            await search.fill(query);
            const retainedUrl = page.url();
            const marker = `reconnect-${Date.now()}`;
            await page.evaluate(value => {
              window.__taskFirstReconnect = { marker: value, input: document.querySelector("#knowledge-search") };
            }, marker);
            let documentNavigations = 0;
            const navigation = frame => { if (frame === page.mainFrame()) documentNavigations += 1; };
            page.on("framenavigated", navigation);
            try {
              await context.setOffline(true);
              await page.waitForFunction(() => navigator.onLine === false);
              await context.setOffline(false);
              await page.waitForFunction(() => navigator.onLine === true);
              // Allow delayed online handlers to run before checking draft preservation.
              await page.waitForTimeout(5000);
              assert.equal(documentNavigations, 0, "Reconnect must not navigate/reload the document");
              assert.equal(page.url(), retainedUrl, "Reconnect URL retained");
              assert.equal(await page.evaluate(value => window.__taskFirstReconnect?.marker === value &&
                window.__taskFirstReconnect.input === document.querySelector("#knowledge-search"), marker), true,
              "Reconnect must retain document marker and original input identity");
              await expect(search).toHaveValue(query);
              item.checks.push("reconnect-retains-document-input-value-and-url");
              item.reconnect = { passed: true, offlineThenOnline: true, observationMs: 5000, documentNavigations };
              await capture(page, item, "knowledge-reconnect");
            } finally {
              await context.setOffline(false);
              page.off("framenavigated", navigation);
            }
          } else {
            await capture(page, item, "knowledge-search");
          }
        }
        item.checks.push("knowledge-navigation");
        assert.equal((item.readinessObservations ?? []).some(observation => observation.unavailableAlerts > 0), false,
          "Selected task learning readiness is unavailable; navigation success is not readiness success");
        item.navigationAborts = item.errors.filter(error => error.type === "requestfailed" && error.message === "net::ERR_ABORTED");
        item.actionableErrors = item.errors.filter(error => !(error.type === "requestfailed" && error.message === "net::ERR_ABORTED"));
        assert.equal(item.actionableErrors.length, 0, "Browser/network failures recorded (navigation aborts retained separately)");
        item.status = "passed";
      } catch (error) {
        item.status = "failed";
        item.failure = safeError(error);
        item.failureUrl = redactedUrl(page.url());
        item.failureState = await page.evaluate(() => ({
          selectedTaskId: document.querySelector('[aria-label="Task learning"]')?.getAttribute("data-task-id") ?? null,
          changeTaskVisible: [...document.querySelectorAll("summary")].some(node => node.textContent?.trim() === "Change task" && node.getClientRects().length > 0),
          busyRegions: document.querySelectorAll('[aria-busy="true"]').length,
        })).catch(() => null);
        if (item.login !== "signed-in") { item.login = "failed"; stop = true; report.stopReason = "First login failure; remaining actors not attempted"; }
        await capture(page, item, "failure").catch(() => {});
      } finally {
        await Promise.allSettled(snapshotReads);
        await context.close();
        item.contextClosed = true;
        await persist();
        console.log(JSON.stringify({ role: item.role, viewport: item.viewport, status: item.status, login: item.login, screenshots: item.screenshots.length }));
      }
    }
  }
  report.identityAfter = await identity();
} catch (error) {
  report.fatal = safeError(error);
} finally {
  if (browser) await browser.close();
  report.browserClosed = true;
  report.finishedAt = new Date().toISOString();
  report.passed = report.results.filter(item => item.status === "passed").length;
  report.failed = report.results.filter(item => item.status === "failed").length;
  report.complete = report.results.length === report.expectedCases;
  await persist();
  if (report.fatal || report.failed || !report.complete) process.exitCode = 1;
}
