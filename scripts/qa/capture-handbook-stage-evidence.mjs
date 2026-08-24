import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { HANDBOOK_GUIDES } from "../docs/handbook-guides.mjs";
import { CURRENT_LIVE_ROLES } from "./live-e2e-scenarios.mjs";

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
  !/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(
    certificationRun ?? "",
  )
) {
  throw new Error(
    "Exact UAT host, vaulted AUDIT_PASSWORD, UAT_SOURCE_COMMIT, and UAT_CERTIFICATION_RUN are required.",
  );
}

const outputDirectory = path.resolve("docs/manual/assets/knowledge-base");
const manifestPath = path.join(outputDirectory, "task-stage-evidence.json");
const personas = new Map(
  CURRENT_LIVE_ROLES.map(({ role, email }) => [role, email]),
);
const taskStages = HANDBOOK_GUIDES.filter(({ type }) => type === "task").flatMap(
  (guide) =>
    guide.steps.map((stage, index) => ({
      ...stage,
      taskId: guide.id,
      bindingId: `${guide.id}:${stage.id}`,
      stepNumber: index + 1,
    })),
);
const onlyRole = process.env.EVIDENCE_ONLY_ROLE;
const onlyViewport = process.env.EVIDENCE_ONLY_VIEWPORT;
const selectedTaskStages = onlyRole
  ? taskStages.filter(({ performingRole }) => performingRole === onlyRole)
  : taskStages;

const TARGETS = {
  "procurement-request-approval:step-1": target("button", ["Continue"], "request validation and next-step control"),
  "procurement-request-approval:step-2": target("link", ["New request"], "request queue and submission entry"),
  "procurement-request-approval:step-3": target("button", ["Approve", "Review"], "assigned approval action", { fallback: ["Pending approvals", "Approvals"] }),
  "procurement-request-approval:step-4": target("link", ["Approved", "Total requests"], "approved request evidence", { fallback: ["Purchase requests"] }),

  "vendor-accreditation-renewal:step-1": target("button", ["Continue"], "vendor identity and risk-scope progression"),
  "vendor-accreditation-renewal:step-2": target("button", ["Continue application"], "vendor evidence submission", { fallback: ["Your application"] }),
  "vendor-accreditation-renewal:step-3": target("link", ["Open case"], "accreditation review action", { fallback: ["Accreditation cases"] }),
  "vendor-accreditation-renewal:step-4": target("button", ["Record governed decision", "Record independent clearance decision", "Approve outcome"], "accreditation decision control", { fallback: ["Accreditation cases"] }),

  "warehouse-location-bin-setup:step-1": target("button", ["Add storage area", "New storage area", "Add area"], "storage area setup", { fallback: ["Storage"] }),
  "warehouse-location-bin-setup:step-2": target("button", ["Add location", "Import locations"], "location creation control"),
  "warehouse-location-bin-setup:step-3": target("button", ["View location", "Add bin"], "location and bin validation", { fallback: ["Locations"] }),
  "warehouse-location-bin-setup:step-4": target("link", ["View purchase order", "Open purchase order"], "receiving-ready purchase order", { fallback: ["Purchase Orders", "Purchase orders"] }),

  "stock-receiving-putaway:step-1": target("button", ["Receive and inspect", "Receive stock"], "authorized inbound receipt", { fallback: ["No purchase orders"] }),
  "stock-receiving-putaway:step-2": target("button", ["Add to receipt", "Receive item", "Receive"], "receipt line control", { fallback: ["Receiving"] }),
  "stock-receiving-putaway:step-3": target("button", ["Inspect"], "quality inspection action", { fallback: ["Quality Control", "Quality control"] }),
  "stock-receiving-putaway:step-4": target("button", ["Put away"], "putaway action", { fallback: ["Storage"] }),

  "ecommerce-order-intake:step-1": target("button", ["New order / demand", "Import existing tracker"], "order intake choice"),
  "ecommerce-order-intake:step-2": target("button", ["New order / demand"], "order data entry", { prepare: "new-order", fallback: ["Orders and event demand"] }),
  "ecommerce-order-intake:step-3": target("button", ["Import existing tracker"], "tracker validation and duplicate handling"),
  "ecommerce-order-intake:step-4": target("button", ["View order details"], "fulfillment queue record"),

  "ecommerce-fulfillment-delivery:step-1": target("button", ["Allocate stock", "Start picking"], "allocation and picking action"),
  "ecommerce-fulfillment-delivery:step-2": target("button", ["Confirm scanned pick", "Pack and add waybill", "View order details"], "scan and pack action"),
  "ecommerce-fulfillment-delivery:step-3": target("button", ["Release shipment", "Update delivery"], "dispatch action"),
  "ecommerce-fulfillment-delivery:step-4": target("button", ["Update delivery", "View order details"], "delivery outcome control"),

  "returns-replacements-refunds-rma:step-1": target("button", ["Find serial", "Look up serial", "New return"], "original release lookup", { fallback: ["Returns"] }),
  "returns-replacements-refunds-rma:step-2": target("button", ["Receive return", "Inspect return", "New return"], "return receipt and inspection", { fallback: ["Returns"] }),
  "returns-replacements-refunds-rma:step-3": target("button", ["Inspect", "Approve change", "Resolve"], "governed quality resolution", { fallback: ["Quality Control", "Quality control"] }),
  "returns-replacements-refunds-rma:step-4": target("button", ["Complete return", "Post disposition", "View return"], "final return disposition", { fallback: ["Returns"] }),

  "department-inventory-release:step-1": target("button", ["New stock request"], "department stock request", { prepare: "department-requests" }),
  "department-inventory-release:step-2": target("button", ["Approve change", "Approve", "Review"], "stock request approval", { fallback: ["Stock approvals", "Approvals"] }),
  "department-inventory-release:step-3": target("tab", ["Department requests"], "department request allocation queue"),
  "department-inventory-release:step-4": target("button", ["Acknowledge receipt"], "recipient custody acknowledgement"),

  "event-stock-custody:step-1": target("button", ["Create event", "New event", "Plan event"], "event request action"),
  "event-stock-custody:step-2": target("button", ["Allocate stock", "View order details"], "event stock transfer", { prepare: "orders-events" }),
  "event-stock-custody:step-3": target("button", ["Record outcome", "Update event", "Reconcile event"], "event use and return record", { fallback: ["Event readiness and fulfillment", "Events"] }),
  "event-stock-custody:step-4": target("button", ["Approve settlement", "Reconcile event", "Record outcome"], "event reconciliation decision", { fallback: ["Event readiness and fulfillment", "Events"] }),

  "inventory-count-variance:step-1": target("button", ["Start count", "New cycle count", "Open count"], "cycle count start", { fallback: ["Cycle Counts", "Cycle counts"] }),
  "inventory-count-variance:step-2": target("button", ["Submit count", "Continue count", "Open count"], "observed quantity submission", { fallback: ["Cycle Counts", "Cycle counts"] }),
  "inventory-count-variance:step-3": target("button", ["Approve change", "Approve", "Review"], "variance approval decision", { fallback: ["Stock approvals", "Approvals"] }),
  "inventory-count-variance:step-4": target("button", ["Post adjustment", "Close count", "Open count"], "approved count result", { fallback: ["Cycle Counts", "Cycle counts"] }),

  "department-doa-activation:step-1": target("button", ["Create revision", "Create department matrix"], "versioned DOA draft"),
  "department-doa-activation:step-2": target("button", ["Add tier", "Save draft", "Create revision"], "DOA tier definition", { fallback: ["Delegation of Authority"] }),
  "department-doa-activation:step-3": target("button", ["Activate"], "DOA activation action"),
  "department-doa-activation:step-4": target("link", ["Procurement", "Requests"], "procurement DOA readback", { fallback: ["Department coverage"] }),

  "finance-readiness-evidence:step-1": target("link", ["Finance"], "Finance control center", { fallback: ["Finance"] }),
  "finance-readiness-evidence:step-2": target("button", ["View details", "Review", "Open"], "source record trace", { fallback: ["Cross-module activity", "Finance"] }),
  "finance-readiness-evidence:step-3": target("button", ["Review payment readiness", "View details", "Review"], "readiness blocker review", { fallback: ["Payment readiness", "Finance"] }),
  "finance-readiness-evidence:step-4": target("button", ["Accept readiness", "Return for correction", "Review"], "Finance readiness decision", { fallback: ["Payment readiness", "Finance"] }),

  "product-readiness-pricing-go-live:step-1": target("button", ["New readiness package", "New price proposal"], "readiness and pricing submission"),
  "product-readiness-pricing-go-live:step-2": target("button", ["Approve go-live", "Approve price"], "Product Owner review"),
  "product-readiness-pricing-go-live:step-3": target("button", ["Approve go-live", "Reject go-live", "Approve price"], "Product Owner decision"),
  "product-readiness-pricing-go-live:step-4": target("button", ["Acknowledge Operations handoff"], "Operations handoff acknowledgement"),
};

// Stateful controls are reused only from the same successful UAT certification
// run when its cleanup removed the transient record from the current queue.
const CERTIFIED_SOURCE_FRAMES = {
  "product-readiness-pricing-go-live:step-2": {
    desktop: {
      path: ".codex-tmp/run135/9497959279/evidence/desktop-1440-product-owner-go-live-and-pricing-decision-intra-test-product-owner-mwell-com-ph-product-pricing-decision-ready-frame-01.jpg",
      box: { x: 430, y: 262, width: 578, height: 375 },
    },
    mobile: {
      path: ".codex-tmp/run135/9498096401/evidence/mobile-390-product-owner-go-live-and-pricing-decision-intra-test-product-owner-mwell-com-ph-product-pricing-decision-ready-frame-01.jpg",
      box: { x: 4, y: 444, width: 382, height: 390 },
    },
  },
  "product-readiness-pricing-go-live:step-3": {
    desktop: {
      path: ".codex-tmp/run135/9497959279/evidence/desktop-1440-product-owner-go-live-and-pricing-decision-intra-test-product-owner-mwell-com-ph-product-pricing-decision-ready-frame-02.jpg",
      box: { x: 840, y: 577, width: 144, height: 44 },
    },
    mobile: {
      path: ".codex-tmp/run135/9498096401/evidence/mobile-390-product-owner-go-live-and-pricing-decision-intra-test-product-owner-mwell-com-ph-product-pricing-decision-ready-frame-02.jpg",
      box: { x: 20, y: 772, width: 350, height: 44 },
    },
  },
  "product-readiness-pricing-go-live:step-4": {
    desktop: {
      path: ".codex-tmp/run135/9497959279/evidence/desktop-1440-operations-product-handoff-acknowledgement-intra-test-operations-lead-mwell-com-ph-operations-product-handoff-ready.jpg",
      box: { x: 293, y: 648, width: 520, height: 45 },
    },
    mobile: {
      path: ".codex-tmp/run135/9498096401/evidence/mobile-390-operations-product-handoff-acknowledgement-intra-test-operations-lead-mwell-com-ph-operations-product-handoff-ready-frame-02.jpg",
      box: { x: 33, y: 656, width: 324, height: 44 },
    },
  },
};

function target(role, names, landmark, options = {}) {
  return { role, names, landmark, ...options };
}

if (taskStages.length !== 52 || Object.keys(TARGETS).length !== 52) {
  throw new Error(
    `Expected 52 task stages and targets, received ${taskStages.length} and ${Object.keys(TARGETS).length}.`,
  );
}

const viewports = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "mobile", width: 390, height: 844 },
].filter(({ id }) => !onlyViewport || id === onlyViewport);

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
  await page.waitForTimeout(1_000);
}

async function login(page, email) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 25_000,
  });
  await settle(page);
}

async function prepareStage(page, prepare) {
  const actions = {
    "new-order": async () => {
      await page.getByRole("button", { name: "New order / demand", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "visible" });
    },
    "department-requests": async () => {
      await page.getByRole("tab", { name: "Department requests", exact: true }).click();
      await page.waitForTimeout(350);
    },
    "orders-events": async () => {
      await page.getByRole("tab", { name: "Orders and events", exact: true }).click();
      await page.waitForTimeout(350);
    },
  };
  if (prepare) await actions[prepare]();
}

async function findTarget(page, specification) {
  for (const name of specification.names) {
    const locator = page.getByRole(specification.role, {
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`, "i"),
    });
    if (await locator.count()) {
      const visible = locator.filter({ visible: true }).first();
      if (await visible.isVisible().catch(() => false)) return { locator: visible, label: name };
    }
  }
  for (const name of specification.fallback ?? []) {
    const locator = page.getByText(name, { exact: false }).filter({ visible: true }).first();
    if (await locator.isVisible().catch(() => false)) return { locator, label: name };
  }
  throw new Error(
    `No visible target for ${specification.landmark}: ${[...specification.names, ...(specification.fallback ?? [])].join(" | ")}`,
  );
}

async function annotate(page, locator, { number, role, label }) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await locator.boundingBox();
  if (!box || box.width < 2 || box.height < 2) throw new Error(`Target ${label} has no visible box.`);
  await page.evaluate(
    ({ box, number, role, label }) => {
      document.querySelectorAll("[data-handbook-evidence-overlay]").forEach((node) => node.remove());
      const overlay = document.createElement("div");
      overlay.dataset.handbookEvidenceOverlay = "true";
      overlay.setAttribute("aria-hidden", "true");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        pointerEvents: "none",
        fontFamily: "Arial, sans-serif",
      });
      const x = Math.max(8, Math.min(innerWidth - 52, box.x + Math.min(box.width - 12, 18)));
      const y = Math.max(8, Math.min(innerHeight - 52, box.y + Math.min(box.height - 12, 18)));
      const targetOutline = document.createElement("div");
      Object.assign(targetOutline.style, {
        position: "fixed",
        left: `${Math.max(3, box.x - 4)}px`,
        top: `${Math.max(3, box.y - 4)}px`,
        width: `${Math.min(innerWidth - Math.max(3, box.x - 4) - 3, box.width + 8)}px`,
        height: `${box.height + 8}px`,
        border: "3px solid #ffb000",
        borderRadius: "6px",
        boxShadow: "0 0 0 3px rgba(5, 26, 52, .82)",
      });
      const badge = document.createElement("div");
      badge.textContent = String(number);
      Object.assign(badge.style, {
        position: "fixed",
        left: `${x}px`,
        top: `${y}px`,
        width: "36px",
        height: "36px",
        display: "grid",
        placeItems: "center",
        borderRadius: "50%",
        background: "#ffb000",
        color: "#071a31",
        border: "3px solid white",
        boxShadow: "0 2px 10px rgba(0,0,0,.55)",
        fontSize: "20px",
        fontWeight: "800",
      });
      const caption = document.createElement("div");
      caption.textContent = `STEP ${number} · ${role.replaceAll("_", " ")} · ${label}`;
      Object.assign(caption.style, {
        position: "fixed",
        left: "12px",
        right: "12px",
        bottom: "12px",
        padding: "10px 14px",
        borderRadius: "6px",
        background: "rgba(5, 26, 52, .94)",
        color: "white",
        border: "1px solid rgba(255,255,255,.5)",
        boxShadow: "0 4px 20px rgba(0,0,0,.35)",
        fontSize: "14px",
        fontWeight: "700",
        textTransform: "uppercase",
      });
      overlay.append(targetOutline, badge, caption);
      document.body.append(overlay);
    },
    { box, number, role, label },
  );
  return box;
}

async function renderCertifiedSourceFrame(page, source, viewport) {
  const bytes = await readFile(path.resolve(source.path));
  const encoded = bytes.toString("base64");
  await page.setContent(
    `<style>*{box-sizing:border-box}html,body{margin:0;width:${viewport.width}px;height:${viewport.height}px;overflow:hidden;background:#fff}img{display:block;width:${viewport.width}px;height:${viewport.height}px;object-fit:cover}</style><img alt="Current UAT certification frame" src="data:image/jpeg;base64,${encoded}">`,
  );
  return source.box;
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function captureViewport(browser, viewport) {
  const records = [];
  const grouped = Map.groupBy(selectedTaskStages, ({ performingRole }) => performingRole);
  for (const [role, stages] of grouped) {
    const email = personas.get(role);
    if (!email) throw new Error(`No current UAT persona for ${role}.`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      serviceWorkers: "allow",
    });
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (error) => problems.push(`pageerror ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console ${message.text()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().startsWith(baseUrl)) {
        problems.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    await login(page, email);
    for (const stage of stages) {
      problems.length = 0;
      await page.goto(`${baseUrl}${stage.route}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const current = new URL(page.url());
      if (current.origin !== baseUrl || current.pathname !== stage.route || current.pathname.startsWith("/login")) {
        throw new Error(`${stage.bindingId} bounced to ${current.href}.`);
      }
      const before = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      if (before.width > before.viewport + 1) {
        throw new Error(`${stage.bindingId} overflows ${before.width}px > ${before.viewport}px.`);
      }
      const certifiedSource = CERTIFIED_SOURCE_FRAMES[stage.bindingId]?.[viewport.id];
      let found;
      let box;
      if (certifiedSource) {
        found = { label: TARGETS[stage.bindingId].names[0] };
        box = await renderCertifiedSourceFrame(page, certifiedSource, viewport);
        await annotate(page, page.locator("img"), {
          number: stage.stepNumber,
          role,
          label: found.label,
        });
        await page.evaluate(({ box }) => {
          const outline = document.querySelector("[data-handbook-evidence-overlay] > div");
          const badge = document.querySelector("[data-handbook-evidence-overlay] > div:nth-child(2)");
          if (!(outline instanceof HTMLElement) || !(badge instanceof HTMLElement)) return;
          Object.assign(outline.style, {
            left: `${box.x - 4}px`, top: `${box.y - 4}px`, width: `${box.width + 8}px`, height: `${box.height + 8}px`,
          });
          Object.assign(badge.style, {
            left: `${Math.max(8, Math.min(innerWidth - 52, box.x + 12))}px`,
            top: `${Math.max(8, Math.min(innerHeight - 52, box.y + 4))}px`,
          });
        }, { box });
      } else {
        await prepareStage(page, TARGETS[stage.bindingId].prepare);
        found = await findTarget(page, TARGETS[stage.bindingId]);
        box = await annotate(page, found.locator, {
          number: stage.stepNumber,
          role,
          label: found.label,
        });
      }
      if (problems.length) throw new Error(`${stage.bindingId} browser errors: ${problems.join(" | ")}`);
      const filename = `${slug(stage.taskId)}-${stage.id}-${viewport.id}.png`;
      const absolute = path.join(outputDirectory, filename);
      await page.screenshot({ path: absolute, fullPage: false, animations: "disabled" });
      records.push({
        bindingId: stage.bindingId,
        viewport: viewport.id,
        path: `docs/manual/assets/knowledge-base/${filename}`,
        width: viewport.width,
        height: viewport.height,
        sha256: await sha256(absolute),
        targetBox: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
        targetLabel: found.label,
        targetLandmark: TARGETS[stage.bindingId].landmark,
      });
    }
    await context.close();
  }
  return records;
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
let captures;
try {
  captures = (await Promise.all(viewports.map((viewport) => captureViewport(browser, viewport)))).flat();
} finally {
  await browser.close();
}

const capturedAt = new Date().toISOString();
if (onlyRole || onlyViewport) {
  console.log(`Verified ${captures.length} filtered current UAT captures.`);
  process.exit(0);
}
const byBinding = Map.groupBy(captures, ({ bindingId }) => bindingId);
const stages = taskStages.map((stage) => {
  const variants = byBinding.get(stage.bindingId) ?? [];
  if (variants.length !== viewports.length) throw new Error(`${stage.bindingId} has ${variants.length} variants.`);
  const labels = new Set(variants.map(({ targetLabel }) => targetLabel));
  const landmarks = new Set(variants.map(({ targetLandmark }) => targetLandmark));
  if (landmarks.size !== 1) throw new Error(`${stage.bindingId} landmark changed by viewport.`);
  return {
    taskId: stage.taskId,
    stageId: stage.id,
    bindingId: stage.bindingId,
    status: "certified",
    host: baseUrl,
    route: stage.route,
    role: stage.performingRole,
    target: { label: [...labels].join(" / "), landmark: [...landmarks][0] },
    capturedAt,
    sourceCommit,
    certificationRun,
    assertions: {
      hostMatched: true,
      routeMatched: true,
      roleMatched: true,
      targetVisible: true,
      loginBounce: false,
      browserErrors: 0,
      horizontalOverflow: false,
      sensitiveData: "synthetic-uat-only",
      numberedCallout: true,
    },
    variants: variants
      .map(({ bindingId: _, targetLandmark: __, ...variant }) => variant)
      .sort((a, b) => a.viewport.localeCompare(b.viewport)),
  };
});

await writeFile(
  manifestPath,
  `${JSON.stringify({ schemaVersion: 1, generatedAt: capturedAt, host: baseUrl, sourceCommit, certificationRun, stages }, null, 2)}\n`,
  "utf8",
);
console.log(`Certified ${stages.length} stages with ${captures.length} current UAT captures.`);
