import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { HANDBOOK_GUIDES } from "../docs/handbook-guides.mjs";
import { CURRENT_LIVE_ROLES } from "./live-e2e-scenarios.mjs";
import { HANDBOOK_EVIDENCE_TARGETS as TARGETS } from "./handbook-evidence-targets.mjs";
import { mergeStageEvidenceManifest } from "./handbook-evidence-manifest.mjs";

const require = createRequire(path.resolve("apps/shell/package.json"));
const { chromium } = require("@playwright/test");

const baseUrl = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const password = process.env.AUDIT_PASSWORD;
const sourceCommit = process.env.UAT_SOURCE_COMMIT;
const certificationRun = process.env.UAT_CERTIFICATION_RUN;
if (
  baseUrl !== "https://mwell-intra-uat.vercel.app" ||
  !password ||
  !/^[a-f0-9]{40}$/.test(sourceCommit ?? "") ||
  !/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(certificationRun ?? "")
) {
  throw new Error("Exact UAT host, vaulted AUDIT_PASSWORD, UAT_SOURCE_COMMIT, and UAT_CERTIFICATION_RUN are required.");
}

function verifySourceCommit(commit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { stdio: "ignore" });
  } catch {
    throw new Error(`UAT_SOURCE_COMMIT ${commit} is not a reachable commit for this handbook tree.`);
  }
}
verifySourceCommit(sourceCommit);

const outputDirectory = path.resolve("docs/manual/assets/knowledge-base");
const manifestPath = path.join(outputDirectory, "task-stage-evidence.json");
const personas = new Map(CURRENT_LIVE_ROLES.map((persona) => [persona.role, persona]));
const taskStages = HANDBOOK_GUIDES.filter(({ type }) => type === "task").flatMap((guide) =>
  guide.steps.map((stage, index) => ({
    ...stage,
    taskId: guide.id,
    bindingId: `${guide.id}:${stage.id}`,
    stepNumber: index + 1,
  })),
);
const onlyRole = process.env.EVIDENCE_ONLY_ROLE;
const onlyViewport = process.env.EVIDENCE_ONLY_VIEWPORT;
const onlyBinding = process.env.EVIDENCE_ONLY_BINDING;
const availabilityAudit = process.env.EVIDENCE_AVAILABILITY_AUDIT === "true";
const selectedTaskStages = taskStages.filter((stage) =>
  (!onlyRole || stage.performingRole === onlyRole) &&
  (!onlyBinding || stage.bindingId === onlyBinding),
);

if (taskStages.length !== 52 || Object.keys(TARGETS).length !== 52) {
  throw new Error(`Expected 52 task stages and actionable targets, received ${taskStages.length} and ${Object.keys(TARGETS).length}.`);
}

const viewports = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "mobile", width: 390, height: 844 },
].filter(({ id }) => !onlyViewport || id === onlyViewport);

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function groupBy(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector("main")?.innerText.trim().length > 60) &&
      !document.body.innerText.includes("Restoring your session") &&
      !document.body.innerText.includes("Loading Warehouse data") &&
      !document.querySelector('main [aria-busy="true"], main .animate-pulse'),
    null,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(800);
}

async function authenticatedEmail(page) {
  return page.evaluate(() => {
    const findEmail = (value, depth = 0) => {
      if (depth > 6 || value == null) return null;
      if (typeof value === "object" && !Array.isArray(value) && typeof value.email === "string") {
        return value.email.toLowerCase();
      }
      if (typeof value !== "object") return null;
      for (const nested of Object.values(value)) {
        const email = findEmail(nested, depth + 1);
        if (email) return email;
      }
      return null;
    };
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.includes("auth")) continue;
        try {
          const email = findEmail(JSON.parse(storage.getItem(key) ?? "null"));
          if (email) return email;
        } catch {
          // Ignore unrelated browser storage values.
        }
      }
    }
    return null;
  });
}

async function login(page, { email, title }) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 25_000 });
  await settle(page);
  const observedEmail = await authenticatedEmail(page);
  if (observedEmail && observedEmail !== email.toLowerCase()) {
    throw new Error(`Authenticated UAT identity did not match the selected ${email.split("@")[0]} persona.`);
  }
  const roleTitleVisible = await page.getByText(title, { exact: true }).filter({ visible: true }).first().isVisible().catch(() => false);
  if (!roleTitleVisible) throw new Error(`The authenticated shell did not expose the expected ${title} role title.`);
  return { observedEmail: observedEmail ?? email.toLowerCase(), roleTitleVisible };
}

async function selectOptionContaining(locator, fragments) {
  const options = await locator.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({ value: node.value, label: node.textContent?.trim() ?? "" })),
  );
  const match = options.find(({ value, label }) => value && fragments.some((fragment) => label.toLowerCase().includes(fragment)));
  if (!match) throw new Error(`No governed option matched ${fragments.join(" or ")}.`);
  await locator.selectOption(match.value);
}

async function openFirstEvent(page) {
  const view = page.getByRole("link", { name: /view event/i }).filter({ visible: true }).first();
  if (await view.isVisible().catch(() => false)) {
    await view.click();
  } else {
    const eventLink = page.locator("main a[href^='/events/']").filter({ visible: true }).first();
    if (!(await eventLink.isVisible().catch(() => false))) throw new Error("No current UAT event detail action is available.");
    await eventLink.click();
  }
  await settle(page);
}

async function prepareStage(page, prepare) {
  if (!prepare) return;
  const actions = {
    "open-new-order": async () => {
      await page.getByRole("button", { name: "New order / demand", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "visible" });
    },
    "open-storage-area": async () => {
      await page.getByRole("button", { name: "Add bin", exact: true }).filter({ visible: true }).first().click();
      await page.getByRole("dialog", { name: "Add storage area" }).waitFor({ state: "visible" });
    },
    "prepare-receipt-line": async () => {
      const product = page.getByLabel("Product", { exact: true });
      await product.selectOption({ label: "mWell Event Shirt - Medium" });
    },
    "open-department-requests": async () => {
      await page.getByRole("tab", { name: "Department requests", exact: true }).click();
      await page.waitForTimeout(400);
    },
    "open-orders-events": async () => {
      await page.getByRole("tab", { name: "Orders and events", exact: true }).click();
      await page.waitForTimeout(400);
    },
    "open-first-event": async () => openFirstEvent(page),
    "select-serialized-return": async () => {
      await selectOptionContaining(page.getByLabel("Product"), ["ring", "watch", "device"]);
      await page.getByLabel("Serial number").waitFor({ state: "visible" });
    },
    "prepare-return-form": async () => {
      await selectOptionContaining(page.getByLabel("Product"), ["lanyard", "shirt", "merch"]);
      await page.getByLabel("Quarantine location").selectOption({ index: 1 });
      await page.getByLabel("Quarantine bin").waitFor({ state: "visible" });
      await page.getByLabel("Quarantine bin").selectOption({ index: 1 });
    },
    "open-first-quality-inspection": async () => {
      const inspect = page.getByRole("button", { name: /^inspect(?:\s|$)/i }).filter({ visible: true }).first();
      if (!(await inspect.isVisible().catch(() => false))) throw new Error("No current UAT quality inspection action is available.");
      await inspect.click();
      await page.getByRole("dialog").waitFor({ state: "visible" });
    },
    "prepare-quality-disposition": async () => {
      await actions["open-first-quality-inspection"]();
      await page.getByLabel("Disposition", { exact: true }).selectOption("accepted");
      await page.getByLabel("Attach inspection evidence").setInputFiles({
        name: "handbook-uat-inspection-evidence.png",
        mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
      });
      await page.getByRole("button", { name: "Submit inspection", exact: true }).waitFor({ state: "visible" });
    },
    "prepare-count-entry": async () => {
      await page.getByLabel("Category", { exact: true }).selectOption("merchandise");
      const storage = page.getByLabel("Storage area", { exact: true });
      if (await storage.isVisible().catch(() => false)) await storage.selectOption({ index: 1 });
      const counted = page.getByLabel(page.viewportSize().width < 640
        ? "mWell Event Shirt - Medium counted quantity"
        : "Counted mWell Event Shirt - Medium", { exact: true });
      if (!(await counted.isVisible().catch(() => false))) throw new Error("No current UAT count-sheet quantity is available.");
      await counted.fill("1");
      await page.getByLabel("Attach cycle-count evidence").setInputFiles({
        name: "handbook-uat-cycle-count-evidence.png",
        mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
      });
      await page.getByRole("button", { name: /^Submit count(?:\s|$)/ }).waitFor({ state: "visible" });
    },
    "open-doa-draft": async () => {
      if (await page.getByRole("button", { name: "Add tier", exact: true }).count()) return;
      const revision = page.getByRole("button", { name: "Create revision", exact: true }).filter({ visible: true }).first();
      if (!(await revision.isVisible().catch(() => false))) throw new Error("No current UAT DOA draft action is available.");
      await revision.click();
      await page.getByRole("dialog").waitFor({ state: "visible" });
    },
    "open-product-decision": async () => {
      const decide = page.getByRole("button", { name: "Approve go-live", exact: true }).filter({ visible: true }).first();
      if (!(await decide.isVisible().catch(() => false))) throw new Error("No current UAT Product go-live decision is available.");
      await decide.click();
      const dialog = page.getByRole("dialog", { name: "Approve go-live" });
      await dialog.waitFor({ state: "visible" });
      await dialog.getByLabel("Decision note").fill("Verified current UAT evidence for the handbook decision step.");
    },
    "open-procurement-department-step": async () => {
      const discard = page.getByRole("button", { name: /Discard draft/i });
      if (await discard.isVisible().catch(() => false)) {
        await discard.click();
        await page.getByText("Draft discarded.", { exact: true }).waitFor({ state: "visible" });
      }
      await page.getByRole("radio", { name: "Goods", exact: true }).check();
      await page.getByLabel("Goods / materials", { exact: true }).check();
      await page.getByLabel("Title", { exact: true }).fill("Handbook UAT DOA route readback");
      await page.getByLabel("Line 1 description").fill("Controlled UAT supplies");
      await page.getByLabel("Line 1 unit price").fill("1250");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByLabel("Department", { exact: true }).waitFor({ state: "visible" });
    },
  };
  const action = actions[prepare];
  if (!action) throw new Error(`Unknown capture preparation ${prepare}.`);
  await action();
}

async function visibleEnabled(locator) {
  if (!(await locator.isVisible().catch(() => false))) return false;
  if (!(await locator.isEnabled().catch(() => false))) return false;
  return (await locator.getAttribute("aria-disabled")) !== "true";
}

async function findTarget(page, specification) {
  if (specification.selector) {
    const candidates = page.locator(specification.selector);
    for (let index = 0; index < (await candidates.count()); index += 1) {
      const locator = candidates.nth(index);
      if (!await visibleEnabled(locator)) continue;
      const label = (await locator.getAttribute("aria-label")) ?? (await locator.innerText()).trim();
      if (!label) continue;
      return { locator, label };
    }
  }
  for (const name of specification.names) {
    const expression = specification.nameMode === "prefix"
      ? new RegExp(`^${escapeRegExp(name)}(?:\\s|$)`, "i")
      : new RegExp(`^${escapeRegExp(name)}$`, "i");
    const candidates = page.getByRole(specification.controlRole, { name: expression });
    for (let index = 0; index < (await candidates.count()); index += 1) {
      const locator = candidates.nth(index);
      if (await visibleEnabled(locator)) {
        return { locator, label: name };
      }
    }
  }
  throw new Error(`No enabled ${specification.controlRole} for ${specification.landmark}: ${specification.names.join(" | ") || specification.selector}`);
}

async function findStableTarget(page, specification, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      let found = await findTarget(page, specification);
      await found.locator.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      found = await findTarget(page, specification);
      if (await visibleEnabled(found.locator)) return found;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Target ${specification.landmark} did not stabilize.`);
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function annotate(page, locator, { number, role, label }) {
  const box = await locator.boundingBox();
  if (!box || box.width < 2 || box.height < 2) throw new Error(`Target ${label} has no visible box.`);
  await page.evaluate(({ box, number, role, label }) => {
    document.querySelectorAll("[data-handbook-evidence-overlay]").forEach((node) => node.remove());
    const overlay = document.createElement("div");
    overlay.dataset.handbookEvidenceOverlay = "true";
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, { position: "fixed", inset: "0", zIndex: "2147483647", pointerEvents: "none", fontFamily: "Arial, sans-serif" });
    const outline = document.createElement("div");
    Object.assign(outline.style, {
      position: "fixed",
      left: `${Math.max(3, box.x - 4)}px`,
      top: `${Math.max(3, box.y - 4)}px`,
      width: `${Math.min(innerWidth - Math.max(3, box.x - 4) - 3, box.width + 8)}px`,
      height: `${Math.min(innerHeight - Math.max(3, box.y - 4) - 3, box.height + 8)}px`,
      border: "3px solid #ffb000",
      borderRadius: "6px",
      boxShadow: "0 0 0 3px rgba(5, 26, 52, .82)",
        });
        const badge = document.createElement("div");
        badge.textContent = String(number);
        const badgeSize = 42;
        let badgeLeft;
        let badgeTop;
        if (box.x + box.width + badgeSize + 6 <= innerWidth) {
          badgeLeft = box.x + box.width + 6;
          badgeTop = Math.max(6, Math.min(innerHeight - badgeSize - 6, box.y + (box.height - badgeSize) / 2));
        } else if (box.x >= badgeSize + 6) {
          badgeLeft = box.x - badgeSize - 6;
          badgeTop = Math.max(6, Math.min(innerHeight - badgeSize - 6, box.y + (box.height - badgeSize) / 2));
        } else if (box.y >= badgeSize + 6) {
          badgeLeft = Math.max(6, Math.min(innerWidth - badgeSize - 6, box.x));
          badgeTop = box.y - badgeSize - 6;
        } else {
          badgeLeft = Math.max(6, Math.min(innerWidth - badgeSize - 6, box.x));
          badgeTop = Math.min(innerHeight - badgeSize - 6, box.y + box.height + 6);
        }
        Object.assign(badge.style, {
          position: "fixed",
          left: `${badgeLeft}px`,
          top: `${badgeTop}px`,
          width: "36px", height: "36px", display: "grid", placeItems: "center", borderRadius: "50%",
      background: "#ffb000", color: "#071a31", border: "3px solid white", boxShadow: "0 2px 10px rgba(0,0,0,.55)",
      fontSize: "20px", fontWeight: "800",
    });
    const caption = document.createElement("div");
    caption.textContent = `STEP ${number} · ${role.replaceAll("_", " ")} · ${label}`;
    const captionWidth = Math.min(420, innerWidth - 24);
    const positions = [
      { x: innerWidth - captionWidth - 12, y: 12 },
      { x: 12, y: 12 },
      { x: innerWidth - captionWidth - 12, y: innerHeight - 56 },
      { x: 12, y: innerHeight - 56 },
    ];
    const target = { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 };
        const badgeBox = { x: badgeLeft, y: badgeTop, width: badgeSize, height: badgeSize };
        const intersects = (a, b) => (
          a.x < b.x + b.width && a.x + a.width > b.x &&
          a.y < b.y + b.height && a.y + a.height > b.y
        );
        const position = positions.find((candidate) => {
          const candidateBox = { ...candidate, width: captionWidth, height: 44 };
          return !intersects(candidateBox, target) && !intersects(candidateBox, badgeBox);
        }) ?? positions[0];
    Object.assign(caption.style, {
      position: "fixed", left: `${position.x}px`, top: `${position.y}px`, width: `${captionWidth}px`, minHeight: "44px",
      padding: "9px 12px", borderRadius: "6px", background: "rgba(5, 26, 52, .94)", color: "white",
      border: "1px solid rgba(255,255,255,.5)", boxShadow: "0 4px 20px rgba(0,0,0,.35)",
      fontSize: "13px", fontWeight: "700", textTransform: "uppercase",
    });
    overlay.append(outline, badge, caption);
    document.body.append(overlay);
  }, { box, number, role, label });
      const overlayCount = await page.locator("[data-handbook-evidence-overlay]").count();
      if (overlayCount !== 1) throw new Error(`Target ${label} did not receive exactly one numbered callout.`);
      const badgeBox = await page.locator("[data-handbook-evidence-overlay] > div:nth-child(2)").boundingBox();
      if (badgeBox && overlaps(box, badgeBox)) throw new Error(`Evidence badge obscures target ${label}.`);
      const captionBox = await page.locator("[data-handbook-evidence-overlay] > div:nth-child(3)").boundingBox();
  if (captionBox && overlaps(box, captionBox)) throw new Error(`Evidence caption obscures target ${label}.`);
  return box;
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function captureViewport(browser, viewport) {
  const records = [];
  const failures = [];
  const grouped = groupBy(selectedTaskStages, ({ performingRole }) => performingRole);
  for (const [role, stages] of grouped) {
    const persona = personas.get(role);
    if (!persona) throw new Error(`No current UAT persona for ${role}.`);
    const { email } = persona;
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: "allow" });
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (error) => problems.push(`pageerror ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") problems.push(`console ${message.text()}`); });
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().startsWith(baseUrl)) problems.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    const identity = await login(page, persona);
    for (const stage of stages) {
      try {
        problems.length = 0;
        await page.goto(`${baseUrl}${stage.route}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        const current = new URL(page.url());
        const routeMatched = current.origin === baseUrl && current.pathname === stage.route;
        const loginBounce = current.pathname.startsWith("/login");
        if (!routeMatched || loginBounce) throw new Error(`${stage.bindingId} bounced or changed route to ${current.href}.`);
        const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
        const horizontalOverflow = layout.width > layout.viewport + 1;
        if (horizontalOverflow) throw new Error(`${stage.bindingId} overflows ${layout.width}px > ${layout.viewport}px.`);
      await prepareStage(page, TARGETS[stage.bindingId].prepare);
      const observedCurrent = new URL(page.url());
      const observedRouteMatched = TARGETS[stage.bindingId].observedRoutePattern
        ? new RegExp(TARGETS[stage.bindingId].observedRoutePattern).test(observedCurrent.pathname)
        : observedCurrent.pathname === stage.route;
      if (observedCurrent.origin !== baseUrl || !observedRouteMatched || observedCurrent.pathname.startsWith("/login")) {
        throw new Error(`${stage.bindingId} prepared evidence route ${observedCurrent.pathname} is not the documented live state.`);
      }
        const found = await findStableTarget(page, TARGETS[stage.bindingId]);
        const targetVisible = await visibleEnabled(found.locator);
        if (!targetVisible) throw new Error(`${stage.bindingId} target is not enabled and visible.`);
        const box = await annotate(page, found.locator, { number: stage.stepNumber, role, label: found.label });
        const numberedCallout = await page.locator("[data-handbook-evidence-overlay]").count() === 1;
        if (problems.length) throw new Error(`${stage.bindingId} browser errors: ${problems.join(" | ")}`);
        const filename = `${slug(stage.taskId)}-${stage.id}-${viewport.id}.png`;
        const absolute = path.join(outputDirectory, filename);
        if (!availabilityAudit) await page.screenshot({ path: absolute, fullPage: false, animations: "disabled" });
        records.push({
        bindingId: stage.bindingId,
        viewport: viewport.id,
        path: `docs/manual/assets/knowledge-base/${filename}`,
        observedRoute: observedCurrent.pathname,
        width: viewport.width,
        height: viewport.height,
        sha256: await sha256(absolute),
        targetBox: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
        targetLabel: found.label,
        targetLandmark: TARGETS[stage.bindingId].landmark,
        controlRole: TARGETS[stage.bindingId].controlRole,
        observations: {
          hostMatched: observedCurrent.origin === baseUrl,
          routeMatched: observedRouteMatched,
          roleMatched: identity.roleTitleVisible && identity.observedEmail === email.toLowerCase(),
          targetVisible,
          loginBounce,
          browserErrors: problems.length,
          horizontalOverflow,
          syntheticAccount: email.toLowerCase().startsWith("intra.test."),
          numberedCallout,
        },
        });
      } catch (error) {
        if (!availabilityAudit) {
          throw new Error(`${stage.bindingId}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
        failures.push({ bindingId: stage.bindingId, viewport: viewport.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    await context.close();
  }
  return { records, failures };
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
let captures;
try {
  const results = [];
  for (const viewport of viewports) {
    results.push(await captureViewport(browser, viewport));
  }
  const failures = results.flatMap(({ failures }) => failures);
  captures = results.flatMap(({ records }) => records);
  if (availabilityAudit) {
    console.log(JSON.stringify({ passed: captures.map(({ bindingId, viewport }) => ({ bindingId, viewport })), failures }, null, 2));
    process.exitCode = failures.length ? 1 : 0;
  }
} finally {
  await browser.close();
}

if (availabilityAudit) process.exit();

const capturedAt = new Date().toISOString();
const byBinding = groupBy(captures, ({ bindingId }) => bindingId);
const buildStages = (sourceStages) => sourceStages.map((stage) => {
  const variants = byBinding.get(stage.bindingId) ?? [];
  if (variants.length !== viewports.length) throw new Error(`${stage.bindingId} has ${variants.length} variants.`);
  const labels = new Set(variants.map(({ targetLabel }) => targetLabel));
  const landmarks = new Set(variants.map(({ targetLandmark }) => targetLandmark));
  const controlRoles = new Set(variants.map(({ controlRole }) => controlRole));
  if (landmarks.size !== 1 || controlRoles.size !== 1) throw new Error(`${stage.bindingId} target semantics changed by viewport.`);
  const observations = variants.map(({ observations }) => observations);
  const assertions = {
    hostMatched: observations.every(({ hostMatched }) => hostMatched),
    routeMatched: observations.every(({ routeMatched }) => routeMatched),
    roleMatched: observations.every(({ roleMatched }) => roleMatched),
    targetVisible: observations.every(({ targetVisible }) => targetVisible),
    loginBounce: observations.some(({ loginBounce }) => loginBounce),
    browserErrors: observations.reduce((sum, row) => sum + row.browserErrors, 0),
    horizontalOverflow: observations.some(({ horizontalOverflow }) => horizontalOverflow),
    sensitiveData: observations.every(({ syntheticAccount }) => syntheticAccount) ? "synthetic-uat-only" : "unverified",
    numberedCallout: observations.every(({ numberedCallout }) => numberedCallout),
  };
  if (
    !assertions.hostMatched || !assertions.routeMatched || !assertions.roleMatched ||
    !assertions.targetVisible || assertions.loginBounce || assertions.browserErrors !== 0 ||
    assertions.horizontalOverflow || assertions.sensitiveData !== "synthetic-uat-only" ||
    !assertions.numberedCallout
  ) throw new Error(`${stage.bindingId} did not satisfy measured certification assertions.`);
  return {
    taskId: stage.taskId,
    stageId: stage.id,
    bindingId: stage.bindingId,
    status: "captured-awaiting-independent-review",
    host: baseUrl,
    route: stage.route,
    role: stage.performingRole,
    target: { label: [...labels].join(" / "), landmark: [...landmarks][0], controlRole: [...controlRoles][0] },
    capturedAt,
    sourceCommit,
    certificationRun,
    assertions,
    variants: variants.map(({ bindingId: _, targetLandmark: __, controlRole: ___, observations: ____, ...variant }) => variant)
      .sort((a, b) => a.viewport.localeCompare(b.viewport)),
  };
});

const replacementStages = buildStages(selectedTaskStages);
if (onlyRole || onlyViewport || onlyBinding) {
  if (onlyViewport) {
    throw new Error("Targeted manifest updates require both desktop and mobile captures.");
  }
  const existing = JSON.parse(await readFile(manifestPath, "utf8"));
  const merged = mergeStageEvidenceManifest(existing, replacementStages, {
    generatedAt: capturedAt,
    host: baseUrl,
    sourceCommit,
    certificationRun,
  });
  await writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(`Recaptured ${replacementStages.length} selected stages with ${captures.length} current UAT frames awaiting independent review.`);
  process.exit(0);
}

await writeFile(manifestPath, `${JSON.stringify({ schemaVersion: 2, generatedAt: capturedAt, host: baseUrl, sourceCommit, certificationRun, stages: replacementStages }, null, 2)}\n`, "utf8");
console.log(`Captured ${replacementStages.length} stages with ${captures.length} current UAT frames awaiting independent review.`);
