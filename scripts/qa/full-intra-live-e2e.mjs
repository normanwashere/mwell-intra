import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertApprovedMutationTarget,
  installScopedProtectionBypass,
  projectRefFromSupabaseUrl,
  verifyDeployedTargetIdentity,
} from "../lib/target-environment.mjs";
import {
  CURRENT_LIVE_ROLES,
  assertAuditRunId,
} from "./live-e2e-scenarios.mjs";
import {
  createAuditDatabaseClient,
  verifyCheckpoint,
} from "./live-e2e-db-verify.mjs";
import { cleanupRun } from "./live-e2e-cleanup.mjs";

const require = createRequire(path.resolve("apps/shell/package.json"));
const { chromium } = require("@playwright/test");

const baseUrl = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const password = process.env.AUDIT_PASSWORD;
const allowMutations = process.env.AUDIT_MUTATIONS === "true";
const viewFilter = process.env.AUDIT_VIEWPORT;
const roleFilter = process.env.AUDIT_ROLE;
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
assertApprovedMutationTarget({
  appEnv: process.env.APP_ENV,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  expectedProjectRef: process.env.SUPABASE_PROJECT_REF,
  productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
  mutationsRequested: process.env.AUDIT_MUTATIONS === "true",
  mutationsApproved: process.env.POLICY_ALLOW_TEST_MUTATIONS === "true",
});
const projectRef = projectRefFromSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);
console.log(
  `Live audit target: environment=${process.env.APP_ENV} project=${projectRef}`,
);
const auditRunId = allowMutations
  ? assertAuditRunId(process.env.AUDIT_RUN_ID ?? "")
  : process.env.AUDIT_RUN_ID || null;

if (allowMutations && !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required for persistence verification and governed cleanup.",
  );

if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  throw new Error(
    "AUDIT_BASE_URL must be the HTTPS URL of the live deployment.",
  );
}
if (!password) {
  throw new Error(
    "AUDIT_PASSWORD is required; shared credentials are never embedded in the release gate.",
  );
}
const appOrigin = new URL(baseUrl).origin;
await verifyDeployedTargetIdentity({
  baseUrl,
  appEnv: process.env.APP_ENV,
  expectedProjectRef: process.env.SUPABASE_PROJECT_REF,
  productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
  mutationsRequested: allowMutations,
  protectionBypass,
});

const users = CURRENT_LIVE_ROLES;

const viewports = [
  {
    name: "desktop-1440",
    viewport: { width: 1440, height: 900 },
    isMobile: false,
  },
  {
    name: "desktop-1280",
    viewport: { width: 1280, height: 800 },
    isMobile: false,
  },
  {
    name: "tablet-768",
    viewport: { width: 768, height: 1024 },
    isMobile: false,
  },
  { name: "mobile-390", viewport: { width: 390, height: 844 }, isMobile: true },
  { name: "mobile-360", viewport: { width: 360, height: 800 }, isMobile: true },
  { name: "mobile-320", viewport: { width: 320, height: 720 }, isMobile: true },
];

const commonRoutes = [
  { path: "/", text: /Your areas|No areas yet|Vendor Portal|Admin/i },
  {
    path: "/warehouse",
    text: /Warehouse|Dashboard|No warehouse access|Access denied/i,
  },
  {
    path: "/procurement",
    text: /Procurement|No procurement access|Approval inbox|Purchase request|Access denied/i,
  },
  {
    path: "/legal",
    text: /Legal|Accreditation|No legal access|Access denied/i,
  },
  {
    path: "/vendor",
    text: /Vendor|accreditation|No legal access|enrolled vendor|Access denied/i,
  },
  {
    path: "/admin/users",
    text: /Users & Roles|Access matrix|No admin access|don't have access|No modules|Access denied/i,
  },
  {
    path: "/knowledge",
    text: /Start with the flow|MWELL INTRA OPERATING HANDBOOK|Knowledge Base/i,
  },
];

const roleRoutes = {
  platform_admin: [
    { path: "/admin/users", text: /Users & Roles|Access matrix/i },
  ],
  vendor_portal: [
    { path: "/vendor", text: /Vendor|accreditation|Acme/i },
    {
      path: "/vendor/cases/case_seed_001",
      text: /Accreditation|Checklist|Documents|requirements/i,
    },
  ],
  warehouse_logistics_supervisor: [
    { path: "/warehouse/receiving", text: /Receiving|Receive/i },
    { path: "/warehouse/quality", text: /Controlled exception disposition/i },
    { path: "/warehouse/approvals", text: /Controlled exceptions/i },
    { path: "/warehouse/cycle-counts", text: /material variance requires a different Warehouse Supervisor/i },
    { path: "/warehouse/locations", text: /Locations|Warehouse|Site/i },
    { path: "/warehouse/storage", text: /Storage|Bin|Area/i },
  ],
  warehouse_operations: [
    { path: "/warehouse", text: /Receive and inspect|Put away|Pick or issue|Returns and counts/i },
    { path: "/warehouse/purchase-orders", text: /Receive and inspect|Purchase Orders/i },
    { path: "/warehouse/storage", text: /Put away|Storage|Bin/i },
    { path: "/warehouse/allocations", text: /Pick or issue|Allocations|Issue/i },
    { path: "/warehouse/returns", text: /Returns and counts|Returns|Record return/i },
  ],
  warehouse_finance: [
    { path: "/warehouse/finance", text: /Finance|Valuation|Reconciliation/i },
    { path: "/warehouse/cycle-counts", text: /Cycle|Count/i },
  ],
  warehouse_bi_analyst: [
    { path: "/warehouse/data", text: /Data|Reports|Export/i },
  ],
  warehouse_marketing: [
    { path: "/warehouse/events", text: /Events|Activations|access/i },
    { path: "/warehouse/returns", text: /Returns|Record return/i },
  ],
  warehouse_pricing: [
    { path: "/warehouse/pricing", text: /Pricing|Landed cost|Set price/i },
    { path: "/warehouse/finance", text: /Finance|Valuation|Reconciliation/i },
  ],
  procurement_requester: [
    {
      path: "/procurement/requests/new",
      text: /Draft a purchase request|New request/i,
    },
    {
      path: "/procurement/requests/req_seed_001",
      text: /Purchase request|Line items|Activity/i,
    },
  ],
  procurement_officer: [
    { path: "/procurement", text: /Purchase requests|Procurement/i },
    { path: "/procurement/purchase-orders", text: /Purchase orders|POs/i },
  ],
  procurement_approver: [
    {
      path: "/procurement/approvals",
      text: /Approval inbox|Waiting on you|Inbox zero/i,
    },
  ],
  procurement_finance: [
    {
      path: "/procurement/approvals",
      text: /Approval inbox|Waiting on you|Inbox zero/i,
    },
  ],
  procurement_admin: [
    { path: "/procurement/purchase-orders", text: /Purchase orders|POs/i },
    {
      path: "/procurement/approvals",
      text: /Approval inbox|Waiting on you|Inbox zero/i,
    },
  ],
  legal_reviewer: [
    { path: "/legal", text: /Accreditation cases|Legal/i },
    {
      path: "/legal/cases/case_seed_001",
      text: /Accreditation|Checklist|Documents|Activity/i,
    },
    { path: "/legal/invites/new", text: /Invite vendor|Onboard a new vendor/i },
  ],
  legal_compliance: [
    { path: "/legal", text: /Accreditation cases|Legal/i },
    {
      path: "/legal/cases/case_seed_001",
      text: /Accreditation|Checklist|Documents|Activity/i,
    },
  ],
  legal_admin: [
    { path: "/legal", text: /Accreditation cases|Legal/i },
    { path: "/legal/invites/new", text: /Invite vendor|Onboard a new vendor/i },
  ],
};

function routesFor(role) {
  return [...commonRoutes, ...(roleRoutes[role] ?? [])];
}

function classify(text, url) {
  const lower = (text || "").toLowerCase();
  if (url.includes("/login")) return "redirected-login";
  if (
    lower.includes("application error") ||
    lower.includes("runtime error") ||
    lower.includes("internal server error") ||
    lower.includes("server error")
  ) {
    return "error";
  }
  if (
    lower.includes("access denied") ||
    lower.includes("doesn't include") ||
    lower.includes("not authorized") ||
    lower.includes("no access") ||
    lower.includes("reserved for enrolled")
  ) {
    return "access-denied";
  }
  if (lower.length < 20) return "blank-or-nearblank";
  return "rendered";
}

async function waitForMeaningfulRoute(page) {
  await page
    .waitForLoadState("domcontentloaded", { timeout: 20_000 })
    .catch(() => {});
  await page
    .waitForFunction(
      () => {
        const text = document.body.innerText.trim().replace(/\s+/g, " ");
        const lower = text.toLowerCase();
        if (lower.includes("restoring your session")) return false;
        if (document.querySelector("[aria-busy='true']")) return false;
        if (document.querySelector("h1")) return true;
        return (
          text.length >= 20 ||
          lower.includes("access denied") ||
          lower.includes("not authorized") ||
          lower.includes("invalid login credentials") ||
          lower.includes("application error") ||
          lower.includes("runtime error")
        );
      },
      undefined,
      { timeout: 8_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(500);
}

async function waitForRouteExpectation(page, expected) {
  if (!expected) return;
  await page
    .waitForFunction(
      ({ source, flags }) => {
        const text = document.body.innerText.trim().replace(/\s+/g, " ");
        const lower = text.toLowerCase();
        return (
          new RegExp(source, flags).test(text) ||
          lower.includes("access denied") ||
          lower.includes("doesn't include") ||
          lower.includes("not authorized") ||
          lower.includes("no access") ||
          lower.includes("reserved for enrolled") ||
          lower.includes("application error") ||
          lower.includes("runtime error")
        );
      },
      { source: expected.source, flags: expected.flags },
      { timeout: 10_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(250);
}

async function pageAudit(page) {
  return page.evaluate(() => {
    function isVisible(el) {
      const style = getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        el.closest("[hidden], [aria-hidden='true'], details:not([open])")
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function centerIsInsideVisibleClip(el, x, y) {
      let node = el.parentElement;
      while (
        node &&
        node !== document.body &&
        node !== document.documentElement
      ) {
        const style = getComputedStyle(node);
        const clipsX = ["hidden", "clip", "auto", "scroll"].includes(
          style.overflowX,
        );
        const clipsY = ["hidden", "clip", "auto", "scroll"].includes(
          style.overflowY,
        );
        if (clipsX || clipsY) {
          const rect = node.getBoundingClientRect();
          if (clipsX && (x < rect.left || x > rect.right)) return false;
          if (clipsY && (y < rect.top || y > rect.bottom)) return false;
        }
        node = node.parentElement;
      }
      return true;
    }

    const text = document.body.innerText.trim().replace(/\s+/g, " ");
    const controlSelector =
      'a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])';
    const controls = Array.from(document.querySelectorAll(controlSelector))
      .filter((el) => !el.classList.contains("sr-only"))
      .filter((el) => el.type !== "file")
      .filter(isVisible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || "",
          text: (
            el.innerText ||
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            el.getAttribute("title") ||
            el.getAttribute("href") ||
            ""
          )
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 80),
          href: el.getAttribute("href") || "",
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
        };
      });

    const overlapExamples = [];
    const visibleControls = Array.from(
      document.querySelectorAll(controlSelector),
    )
      .filter((el) => !el.classList.contains("sr-only"))
      .filter((el) => el.type !== "file")
      .filter(isVisible);
    for (let i = 0; i < visibleControls.length; i += 1) {
      const el = visibleControls[i];
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight)
        continue;
      if (!centerIsInsideVisibleClip(el, x, y)) continue;
      const blocker = document.elementFromPoint(x, y);
      if (!blocker || blocker === el || el.contains(blocker)) continue;
      if (
        blocker.tagName.toLowerCase() === "nextjs-portal" ||
        blocker.closest("nextjs-portal")
      ) {
        continue;
      }
      const blockerControl = blocker.closest(controlSelector);
      if (
        !blockerControl ||
        blockerControl === el ||
        el.contains(blockerControl)
      )
        continue;
      function fixedAncestor(node) {
        let current = node;
        while (current && current !== document.documentElement) {
          if (["fixed", "sticky"].includes(getComputedStyle(current).position))
            return current;
          current = current.parentElement;
        }
        return null;
      }
      const fixedBlocker = fixedAncestor(blockerControl);
      const fixedTarget = fixedAncestor(el);
      const blockerRect = (
        fixedBlocker ?? blockerControl
      ).getBoundingClientRect();
      if (
        fixedBlocker &&
        !fixedTarget &&
        blockerRect.top > window.innerHeight / 2
      ) {
        const targetScrollY =
          window.scrollY + Math.max(0, rect.bottom - (blockerRect.top - 16));
        const maxScrollY = Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight,
        );
        if (targetScrollY >= 0 && targetScrollY <= maxScrollY + 1) continue;
      }
      overlapExamples.push({
        a: controls[i]?.text || controls[i]?.tag || "control",
        b:
          blockerControl.innerText?.trim().replace(/\s+/g, " ").slice(0, 80) ||
          blockerControl.getAttribute("aria-label") ||
          blockerControl.tagName.toLowerCase(),
        target: {
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          height: Math.round(rect.height),
        },
        blocker: {
          top: Math.round(blockerRect.top),
          bottom: Math.round(blockerRect.bottom),
        },
        scroll: {
          y: Math.round(window.scrollY),
          max: Math.round(
            Math.max(
              0,
              document.documentElement.scrollHeight - window.innerHeight,
            ),
          ),
        },
      });
    }

    const layoutWidth = Math.floor(
      Math.min(
        window.innerWidth,
        document.documentElement.clientWidth,
        window.visualViewport?.width ?? window.innerWidth,
      ),
    );
    function clippedByBoundedAncestor(el) {
      let node = el.parentElement;
      while (
        node &&
        node !== document.body &&
        node !== document.documentElement
      ) {
        const style = getComputedStyle(node);
        const overflowX = style.overflowX;
        if (["hidden", "clip", "auto", "scroll"].includes(overflowX)) {
          const rect = node.getBoundingClientRect();
          if (rect.left >= -2 && rect.right <= layoutWidth + 2) return true;
        }
        node = node.parentElement;
      }
      return false;
    }
    const overflowOffenders = Array.from(document.querySelectorAll("body *"))
      .filter(isVisible)
      .filter((el) => !clippedByBoundedAncestor(el))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
          className: String(el.className || "").slice(0, 120),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            right: Math.round(rect.right),
          },
        };
      })
      .filter(
        (item) =>
          item.rect.w > 0 &&
          (item.rect.x < -2 || item.rect.right > layoutWidth + 2),
      )
      .slice(0, 8);

    const horizontalOverflow =
      document.documentElement.scrollWidth > layoutWidth + 2 ||
      document.body.scrollWidth > layoutWidth + 2 ||
      overflowOffenders.length > 0;

    return {
      text: text.slice(0, 700),
      h1: Array.from(document.querySelectorAll("h1"))
        .map((heading) => heading.innerText.trim())
        .filter(Boolean)
        .slice(0, 4),
      mainCount: document.querySelectorAll("main").length,
      visibleControls: controls.length,
      horizontalOverflow,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      layoutWidth,
      overflowOffenders,
      overlaps: overlapExamples.slice(0, 8),
      deadLinks: controls
        .filter(
          (control) =>
            control.tag === "a" &&
            (!control.href ||
              control.href === "#" ||
              control.href.startsWith("javascript:")),
        )
        .slice(0, 10),
      unlabeledControls: controls
        .filter(
          (control) => !control.text && ["button", "a"].includes(control.tag),
        )
        .slice(0, 10),
    };
  });
}

async function login(page, user) {
  await page.goto(`${baseUrl}/login?redirect=%2F&audit=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  const submit = page.getByRole("button", { name: /^sign in$/i });
  await submit.waitFor({ state: "visible", timeout: 10_000 });
  await page.fill("#email", user.email);
  await page.fill("#password", password);
  await submit.click();
  await page
    .waitForFunction(
      () => {
        const text = document.body.innerText.toLowerCase();
        return (
          !location.pathname.startsWith("/login") ||
          text.includes("invalid") ||
          text.includes("failed") ||
          text.includes("error")
        );
      },
      { timeout: 20_000 },
    )
    .catch(() => {});
  await waitForMeaningfulRoute(page);
  const body = await page.locator("body").innerText({ timeout: 10_000 });
  return {
    url: page.url().replace(baseUrl, ""),
    status: page.url().includes("/login") ? "stayed-login" : "signed-in",
    text: body.trim().replace(/\s+/g, " ").slice(0, 300),
  };
}

async function auditRoute(page, route) {
  await page.goto(`${baseUrl}${route.path}?auditRoute=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await waitForRouteExpectation(page, route.text);
  const audit = await pageAudit(page);
  const expectationMet = route.text ? route.text.test(audit.text) : true;
  return {
    route: route.path,
    finalUrl: page.url().replace(baseUrl, ""),
    class: classify(audit.text, page.url()),
    expectationMet,
    h1: audit.h1,
    mainCount: audit.mainCount,
    controls: audit.visibleControls,
    overflow: audit.horizontalOverflow,
    scrollWidth: audit.scrollWidth,
    viewportWidth: audit.viewportWidth,
    overlaps: audit.overlaps,
    deadLinks: audit.deadLinks,
    unlabeledControls: audit.unlabeledControls,
    text: audit.text.slice(0, 260),
  };
}

async function procurementCreateRequestWorkflow(page, marker) {
  const title = `${marker} Procurement draft`;
  await page.goto(
    `${baseUrl}/procurement/requests/new?workflow=${Date.now()}`,
    {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    },
  );
  await waitForMeaningfulRoute(page);
  await page
    .locator("label")
    .filter({ hasText: /^Petty cash/i })
    .first()
    .click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Line 1 description").fill("Audit workflow supplies");
  await page.getByLabel("Line 1 unit price").fill("1250");
  await page.getByRole("button", { name: /continue/i }).click();
  await page
    .getByLabel(/Need description/i)
    .fill("Operational test purchase for full Intra audit coverage.");
  await page
    .getByLabel(/Risk if not procured/i)
    .fill("Testing would not cover procurement draft creation.");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("button", { name: /save draft/i }).click();
  await page
    .waitForURL(
      (url) =>
        url.pathname.startsWith("/procurement/requests/") &&
        !url.pathname.endsWith("/new"),
      { timeout: 15_000 },
    )
    .catch(() => {});
  await waitForMeaningfulRoute(page);
  const audit = await pageAudit(page);
  const path = new URL(page.url()).pathname;
  const requestId = path.split("/").filter(Boolean).at(-1);
  const checkpoint = await verifyCheckpoint({
    schema: "procurement",
    table: "requests",
    filters: { id: requestId },
    expected: { title, status: "draft" },
    select: "id,title,status",
  });
  return {
    name: "procurement request draft",
    ok:
      /Purchase request|Line items|Activity|Business justification/i.test(
        audit.text,
      ) &&
      path.startsWith("/procurement/requests/") &&
      !path.endsWith("/new"),
    finalUrl: page.url().replace(baseUrl, ""),
    text: audit.text.slice(0, 260),
    checkpoint,
  };
}

async function legalInviteVendorWorkflow(page, marker) {
  const unique = Date.now();
  const companyName = `${marker} Vendor`;
  const vendorEmail = vendorAuditEmail(marker);
  await page.goto(`${baseUrl}/legal/invites/new?workflow=${unique}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByLabel("Company name").fill(companyName);
  await page
    .getByLabel("Vendor contact email")
    .fill(vendorEmail);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("button", { name: /send invite & open case/i }).click();
  await page
    .waitForURL((url) => url.pathname.startsWith("/legal/cases/"), {
      timeout: 15_000,
    })
    .catch(() => {});
  await waitForMeaningfulRoute(page);
  const audit = await pageAudit(page);
  const checkpoint = await verifyCheckpoint({
    schema: "legal",
    table: "accreditation_cases",
    filters: { vendor_name: companyName },
    expected: { vendor_name: companyName },
    select: "id,vendor_name,status",
  });
  const inviteCheckpoint = await verifyCheckpoint({
    schema: "legal",
    table: "vendor_invites",
    filters: { company_name: companyName },
    expected: { company_name: companyName },
    select: "id,company_name,status,case_id",
  });
  const db = createAuditDatabaseClient();
  const { data: deliveryRows, error: deliveryError } = await db
    .schema("legal")
    .from("vendor_invites")
    .select("status")
    .eq("company_name", companyName);
  if (deliveryError) throw new Error(deliveryError.message);
  const deliveryStatus = deliveryRows?.[0]?.status;
  if (!["sent", "delivery_failed"].includes(deliveryStatus))
    throw new Error(`Unexpected vendor invite delivery status: ${deliveryStatus}`);
  return {
    name: "legal vendor invite",
    ok:
      audit.text.includes(companyName) &&
      /\/legal\/cases\//.test(page.url()),
    finalUrl: page.url().replace(baseUrl, ""),
    text: audit.text.slice(0, 260),
    checkpoint,
    inviteCheckpoint,
    deliveryStatus,
  };
}

async function warehouseCreateBinWorkflow(page, marker) {
  const code = marker.toUpperCase();
  await page.goto(`${baseUrl}/warehouse/storage?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add storage area" });
  await dialog.getByRole("button", { name: "Add bin", exact: true }).click();
  await dialog.getByRole("alert").waitFor({ state: "visible" });
  await dialog.getByLabel("Bin code").fill(code);
  await dialog.getByLabel("Label (optional)").fill(`${marker} controlled bin`);
  await dialog.getByLabel("Zone (optional)").fill("QA isolation");
  await dialog.getByRole("button", { name: "Add bin", exact: true }).click();
  await page.getByText(code, { exact: true }).first().waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  await page.getByText(code, { exact: true }).first().waitFor({ state: "visible" });
  const checkpoint = await verifyCheckpoint({
    schema: "warehouse",
    table: "storage_areas",
    filters: { code },
    expected: { label: `${marker} controlled bin`, active: true },
    select: "id,code,label,active",
  });
  return {
    name: "warehouse bin creation",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
    checkpoint,
  };
}

async function warehouseCreateEventWorkflow(page, marker) {
  const eventName = `${marker} Event`;
  await page.goto(`${baseUrl}/warehouse/events?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByRole("button", { name: "New event" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("button", { name: "Create event" }).click();
  await dialog.getByText("Event name is required.").waitFor({ state: "visible" });
  await dialog.getByLabel("Event name").fill(eventName);
  await dialog.getByLabel("Start date").fill("2026-07-14");
  await dialog.getByLabel("End date").fill("2026-07-13");
  await dialog.getByRole("button", { name: "Create event" }).click();
  await dialog
    .getByText("End date cannot be before the start date.")
    .waitFor({ state: "visible" });
  await dialog.getByLabel("End date").fill("2026-07-15");
  await dialog.getByRole("button", { name: "Create event" }).click();
  await page.getByText(eventName, { exact: true }).waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  await page.getByText(eventName, { exact: true }).waitFor({ state: "visible" });
  const checkpoint = await verifyCheckpoint({
    schema: "warehouse",
    table: "events",
    filters: { name: eventName },
    expected: { type: "corporate", start_date: "2026-07-14" },
    select: "id,name,type,start_date,end_date",
  });
  return {
    name: "warehouse event creation",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
    checkpoint,
  };
}

async function adminCreateDoaWorkflow(page, marker) {
  const department = `${marker} Department`;
  const version = `${marker}-V1`;
  await page.goto(`${baseUrl}/admin/doa?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByText("Department and version are required.").waitFor({
    state: "visible",
  });
  await page.getByLabel("Department", { exact: true }).fill(department);
  await page.getByLabel("Version", { exact: true }).fill(version);
  await page.getByLabel("Source document", { exact: true }).fill(`${marker} controlled test`);
  await page.getByLabel("Effective date", { exact: true }).fill("2026-07-14");
  await page.getByLabel("Tier 1 minimum").fill("0");
  await page.getByLabel("Tier 1 maximum").fill("1000");
  const approvers = page.getByLabel(/Tier \d+ named approver/);
  for (let index = 0; index < (await approvers.count()); index += 1)
    await page
      .getByLabel(`Tier ${index + 1} named approver`)
      .selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save draft" }).click();
  const departmentHeading = page.getByRole("heading", {
    name: department,
    exact: true,
  });
  await departmentHeading.waitFor({
    state: "visible",
  });
  const card = departmentHeading.locator(
    "xpath=ancestor::div[.//button[normalize-space()='Activate']][1]",
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await card.getByRole("button", { name: "Activate" }).click();
  await page.getByText(`${department} DOA activated.`).waitFor({ state: "visible" });
  const checkpoint = await verifyCheckpoint({
    schema: "procurement",
    table: "doa_matrices",
    filters: { department, version },
    expected: { status: "active", active: true },
    select: "id,department,version,status,active",
  });
  return {
    name: "department DOA creation",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
    checkpoint,
  };
}

async function browserAccessToken(page) {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null");
        const session = Array.isArray(value) ? value[0] : value;
        if (typeof session?.access_token === "string") return session.access_token;
      } catch {
        // Ignore unrelated or stale local storage entries.
      }
    }
    return null;
  });
}

async function callRpcAsBrowserUser(page, schema, fn, payload) {
  const accessToken = await browserAccessToken(page);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!accessToken || !anonKey || !supabaseUrl)
    throw new Error("Authenticated browser session and public Supabase configuration are required.");
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "accept-profile": schema,
      "content-profile": schema,
    },
    body: JSON.stringify({ payload }),
  });
  return { ok: response.ok, status: response.status, body: await response.text() };
}

function requireRpcFailure(result, pattern, contract) {
  if (result.ok || !pattern.test(result.body))
    throw new Error(`${contract} was not enforced (${result.status}: ${result.body}).`);
}

async function insertAuditRows(client, schema, table, rows) {
  const { data, error } = await client.schema(schema).from(table).insert(rows).select();
  if (error) throw new Error(`${schema}.${table} fixture insert failed: ${error.message}`);
  return data;
}

async function createTask3ReceiptFixture(marker) {
  const client = createAuditDatabaseClient();
  const { data: locations, error: locationError } = await client
    .schema("warehouse").from("locations").select("id").eq("type", "warehouse").limit(1);
  if (locationError || !locations?.[0]) throw new Error("A Warehouse location is required for Task 3 transactions.");
  const { data: officerProfiles, error: officerError } = await client.schema("core").from("profiles")
    .select("id").eq("email", "intra.test.proc.officer@mwell.com.ph").limit(1);
  if (officerError || !officerProfiles?.[0]) throw new Error("Procurement Officer profile is required.");
  const ids = {
    vendor: crypto.randomUUID(),
    product: `${marker}-product`,
    request: `${marker}-receipt-request`,
    cleanPo: `${marker}-po-clean`,
    partialPo: `${marker}-po-partial`,
    cleanLine: `${marker}-line-clean`,
    partialLine: `${marker}-line-partial`,
    cancelledLine: `${marker}-line-cancelled`,
    cycleCount: `${marker}-cycle-count`,
    selfCycleCount: `${marker}-self-cycle-count`,
    quarantineReceipt: `${marker}-quarantine-receipt`,
    policyRfq: `${marker}-policy-rfq`,
    policyDirect: `${marker}-policy-direct`,
    policyPetty: `${marker}-policy-petty`,
    policyImport: `${marker}-policy-import`,
    policyExpired: `${marker}-policy-expired`,
    expiredVendor: crypto.randomUUID(),
    accreditationCase: `${marker}-temporary-clearance-case`,
  };
  await insertAuditRows(client, "core", "vendors", [{
    id: ids.vendor, legal_name: `${marker} Receipt Vendor`, category: "goods",
    accreditation_status: "approved", owner_module: "legal",
  }, {
    id: ids.expiredVendor, legal_name: `${marker} Expired Vendor`, category: "goods",
    accreditation_status: "expired", accreditation_expires_at: "2026-01-01", owner_module: "legal",
  }]);
  await insertAuditRows(client, "warehouse", "products", [{
    id: ids.product, sku: `${marker}-SKU`, name: `${marker} Receipt Product`,
    category: "qa", serialized: false, unit_cost: 100, reorder_point: 0,
  }]);
  await insertAuditRows(client, "procurement", "requests", [{
    id: ids.request, title: `${marker} Receipt authority request`, status: "approved",
    category: "goods", sourcing_method: "rfq", core_vendor_id: ids.vendor,
    vendor_name: `${marker} Receipt Vendor`, estimated_amount: 500,
  }, ...[
    [ids.policyRfq, "rfq", {}],
    [ids.policyDirect, "direct_award", {}],
    [ids.policyPetty, "petty_cash", {}],
    [ids.policyImport, "rfp", { importation: true }],
    [ids.policyExpired, "rfq", {}],
  ].map(([id, method, compliance]) => ({
    id, title: `${marker} ${method} negative`, status: "draft", category: "goods",
    sourcing_method: method, core_vendor_id: id === ids.policyExpired ? ids.expiredVendor : ids.vendor,
    vendor_name: `${marker} Policy Vendor`, estimated_amount: 500, compliance,
  }))]);
  await insertAuditRows(client, "procurement", "route_decisions",
    [ids.policyRfq, ids.policyDirect, ids.policyPetty, ids.policyImport, ids.policyExpired].map((requestId) => ({
      request_id: requestId, policy_version: "task3-live", request_version: 1,
      method: requestId === ids.policyDirect ? "direct_award"
        : requestId === ids.policyPetty ? "petty_cash"
          : requestId === ids.policyImport ? "rfp" : "rfq",
      reasons: ["task3-live-negative"], risk_facts: requestId === ids.policyImport ? { importation: true } : {},
      status: "confirmed", confirmed_by: officerProfiles[0].id,
    })),
  );
  await insertAuditRows(client, "procurement", "exception_packs", [
    { request_id: ids.policyDirect, exception_type: "direct_award", vendor_id: ids.vendor,
      justification: `${marker} incomplete direct award`, evidence: {}, status: "approved" },
    { request_id: ids.policyPetty, exception_type: "petty_cash_non_accredited",
      justification: `${marker} split petty cash`, evidence: {}, finance_eligibility_confirmed: false,
      non_recurring_non_split_attested: false, status: "approved" },
  ]);
  await insertAuditRows(client, "legal", "accreditation_cases", [{
    id: ids.accreditationCase, vendor_id: ids.expiredVendor,
    vendor_name: `${marker} Expired Vendor`, status: "provisional", category: "goods",
    jurisdiction: "PH", entity_type: "corporation",
  }]);
  await insertAuditRows(client, "legal", "accreditation_dispositions", [{
    case_id: ids.accreditationCase, requirement_code: "TEMP_CLEARANCE",
    disposition: "temporary_clearance", reason: `${marker} unapproved clearance probe`,
    conditions: { approved: false, valid_until: "2027-01-01T00:00:00Z" },
    decided_by: officerProfiles[0].id,
  }]);
  await insertAuditRows(client, "procurement", "purchase_orders", [
    { id: ids.cleanPo, po_number: `${marker}-PO-CLEAN`, request_id: ids.request,
      core_vendor_id: ids.vendor, vendor_name: `${marker} Receipt Vendor`, status: "issued", total: 100 },
    { id: ids.partialPo, po_number: `${marker}-PO-PARTIAL`, request_id: ids.request,
      core_vendor_id: ids.vendor, vendor_name: `${marker} Receipt Vendor`, status: "issued", total: 400 },
  ]);
  await insertAuditRows(client, "procurement", "purchase_order_lines", [
    { id: ids.cleanLine, purchase_order_id: ids.cleanPo, line_no: 1,
      description: `${marker} clean receipt`, quantity: 1, warehouse_product_id: ids.product },
    { id: ids.partialLine, purchase_order_id: ids.partialPo, line_no: 1,
      description: `${marker} partial receipt`, quantity: 3, warehouse_product_id: ids.product },
    { id: ids.cancelledLine, purchase_order_id: ids.partialPo, line_no: 2,
      description: `${marker} cancelled line`, quantity: 1, warehouse_product_id: ids.product,
      receiving_status: "cancelled" },
  ]);
  return { marker, client, ids, locationId: locations[0].id, cycleRequestId: null };
}

async function task3OperatorReceiptTransactions(page, fixture) {
  const receive = (poId, lineId, quantity, suffix) => callRpcAsBrowserUser(page, "warehouse", "receive_procurement_po", {
    idempotency_key: `${fixture.marker}-${suffix}`,
    po_id: poId, location_id: fixture.locationId,
    evidence_urls: [`audit/${fixture.marker}/${suffix}.jpg`],
    lines: [{ line_id: lineId, product_id: fixture.ids.product, quantity, disposition: "accepted" }],
  });
  const clean = await receive(fixture.ids.cleanPo, fixture.ids.cleanLine, 1, "clean");
  if (!clean.ok) throw new Error(`Clean receipt failed: ${clean.body}`);
  const partial = await receive(fixture.ids.partialPo, fixture.ids.partialLine, 1, "partial");
  if (!partial.ok) throw new Error(`Partial receipt failed: ${partial.body}`);
  await verifyCheckpoint({ schema: "procurement", table: "v_purchase_order_receipt_status",
    filters: { purchase_order_id: fixture.ids.partialPo },
    expected: { accepted_quantity: 1, outstanding_quantity: 2 },
    select: "purchase_order_id,accepted_quantity,outstanding_quantity" }, fixture.client);

  requireRpcFailure(
    await receive(fixture.ids.partialPo, fixture.ids.cancelledLine, 1, "cancelled"),
    /cancelled or rejected/i, "cancelled-line receipt",
  );
  requireRpcFailure(
    await receive(fixture.ids.partialPo, fixture.ids.partialLine, 3, "excess"),
    /exceeds/i, "excess receipt",
  );
  const concurrent = await Promise.all([
    receive(fixture.ids.partialPo, fixture.ids.partialLine, 2, "concurrent-a"),
    receive(fixture.ids.partialPo, fixture.ids.partialLine, 2, "concurrent-b"),
  ]);
  if (concurrent.filter((result) => result.ok).length !== 1)
    throw new Error(`Atomic concurrent receipt expected one success: ${JSON.stringify(concurrent)}`);

  const cycleDraft = await callRpcAsBrowserUser(page, "warehouse", "record_cycle_count", {
    cycle_count: { id: fixture.ids.cycleCount, location_id: fixture.locationId,
      category: "qa", lines: [{ productId: fixture.ids.product, counted: 5 }], actor: fixture.marker },
  });
  if (!cycleDraft.ok) throw new Error(`Operator cycle-count draft failed: ${cycleDraft.body}`);
  const cycleSubmit = await callRpcAsBrowserUser(page, "warehouse", "submit_cycle_count", {
    idempotency_key: `${fixture.marker}-cycle-submit`, cycle_count_id: fixture.ids.cycleCount,
    reason: `${fixture.marker} material variance`, evidence_urls: [`audit/${fixture.marker}/count.jpg`],
  });
  if (!cycleSubmit.ok) throw new Error(`Operator cycle-count submit failed: ${cycleSubmit.body}`);
  fixture.cycleRequestId = JSON.parse(cycleSubmit.body).requests[0].id;
  return { name: "Task 3 operator receipt transactions", ok: true,
    cleanReceipt: JSON.parse(clean.body).receipt.id,
    partialReceipt: JSON.parse(partial.body).receipt.id,
    concurrentDenied: concurrent.find((result) => !result.ok)?.status };
}

async function task3SupervisorTransactions(page, fixture) {
  const { data: profileRows, error: profileError } = await fixture.client.schema("core").from("profiles")
    .select("id,email").eq("email", "intra.test.wh.logistics@mwell.com.ph").limit(1);
  if (profileError || !profileRows?.[0]) throw new Error("Warehouse Supervisor profile is required.");
  await insertAuditRows(fixture.client, "warehouse", "receipts", [{
    id: fixture.ids.quarantineReceipt, location_id: fixture.locationId,
    lines: [{ productId: fixture.ids.product, procurementLineId: fixture.ids.cleanLine, quantity: 1 }],
    evidence_urls: [`audit/${fixture.marker}/quarantine.jpg`], actor: fixture.marker, quality_status: "pending",
  }]);
  await insertAuditRows(fixture.client, "warehouse", "quality_inspections", [{
    source_type: "receipt", source_id: fixture.ids.quarantineReceipt,
    product_id: fixture.ids.product, procurement_po_line_id: fixture.ids.cleanLine,
    location_id: fixture.locationId, quantity: 1, disposition: "pending",
    inspected_by: profileRows[0].id, inspected_by_email: profileRows[0].email,
  }]);
  const quarantine = await callRpcAsBrowserUser(page, "warehouse", "inspect_quality", {
    idempotency_key: `${fixture.marker}-quarantine`, source_type: "receipt",
    source_id: fixture.ids.quarantineReceipt, product_id: fixture.ids.product,
    quantity: 1, disposition: "hold", reason: `${fixture.marker} quarantine`,
    evidence_urls: [`audit/${fixture.marker}/quarantine.jpg`],
  });
  if (!quarantine.ok) throw new Error(`Supervisor quarantine failed: ${quarantine.body}`);
  await verifyCheckpoint({ schema: "warehouse", table: "quality_inspections",
    filters: { source_id: fixture.ids.quarantineReceipt, disposition: "hold" },
    expected: { procurement_po_line_id: fixture.ids.cleanLine },
    select: "source_id,disposition,procurement_po_line_id" }, fixture.client);

  const approveVariance = await callRpcAsBrowserUser(page, "warehouse", "decide_stock_change", {
    idempotency_key: `${fixture.marker}-variance-approve`, request_id: fixture.cycleRequestId,
    decision: "approved", note: `${fixture.marker} supervisor approval`,
  });
  if (!approveVariance.ok) throw new Error(`Cross-role variance approval failed: ${approveVariance.body}`);

  const selfDraft = await callRpcAsBrowserUser(page, "warehouse", "record_cycle_count", {
    cycle_count: { id: fixture.ids.selfCycleCount, location_id: fixture.locationId,
      category: "qa", lines: [{ productId: fixture.ids.product, counted: 6 }], actor: fixture.marker },
  });
  if (!selfDraft.ok) throw new Error(`Supervisor self-approval fixture failed: ${selfDraft.body}`);
  const selfSubmit = await callRpcAsBrowserUser(page, "warehouse", "submit_cycle_count", {
    idempotency_key: `${fixture.marker}-self-submit`, cycle_count_id: fixture.ids.selfCycleCount,
    reason: `${fixture.marker} delegated self approval probe`, evidence_urls: [`audit/${fixture.marker}/self.jpg`],
  });
  if (!selfSubmit.ok) throw new Error(`Supervisor self-approval submit failed: ${selfSubmit.body}`);
  const selfRequestId = JSON.parse(selfSubmit.body).requests[0].id;
  requireRpcFailure(await callRpcAsBrowserUser(page, "warehouse", "decide_stock_change", {
    idempotency_key: `${fixture.marker}-self-denial`, request_id: selfRequestId,
    decision: "approved", note: "delegation must not permit self approval",
  }), /requester cannot approve their own/i, "self-approval under delegation");
  return { name: "Task 3 supervisor quarantine and variance transactions", ok: true,
    varianceRequestId: fixture.cycleRequestId, selfApprovalDenied: true };
}

async function task3PolicyNegativeTransactions(page, fixture) {
  requireRpcFailure(await callRpcAsBrowserUser(page, "procurement", "submit_request", {
    id: fixture.ids.policyRfq,
  }), /commitment_blocked|RFQ/i, "route-specific RFQ evidence");

  for (const [requestId, expected, contract] of [
    [fixture.ids.policyDirect, /complete Direct Award pack/i, "unsupported Direct Award"],
    [fixture.ids.policyPetty, /Finance-approved one-time non-split petty-cash/i, "split petty-cash use"],
    [fixture.ids.policyImport, /complete importation plan/i, "missing importation controls"],
    [fixture.ids.policyExpired, /current full accreditation or approved scoped temporary clearance/i,
      "expired accreditation and unapproved scoped temporary clearance"],
  ]) {
    const readiness = await callRpcAsBrowserUser(page, "procurement", "commitment_readiness", {
      request_id: requestId,
      vendor_id: requestId === fixture.ids.policyExpired ? fixture.ids.expiredVendor : fixture.ids.vendor,
      phase: "issue",
    });
    if (!readiness.ok || !expected.test(readiness.body))
      throw new Error(`${contract} negative readiness failed (${readiness.status}: ${readiness.body}).`);
  }

  requireRpcFailure(await callRpcAsBrowserUser(page, "procurement", "prepare_payment_readiness", {
    purchase_order_id: fixture.ids.cleanPo,
    acceptance_pack_id: crypto.randomUUID(),
    po_match: true,
    invoice_or_si_storage_path: `audit/${fixture.marker}/invoice.pdf`,
    milestone_support_storage_path: `audit/${fixture.marker}/receipt.pdf`,
    tax_withholding_support_storage_path: `audit/${fixture.marker}/tax.pdf`,
  }), /acceptance|invalid input|foreign key/i,
  "payment readiness without accepted receipt or service acceptance");
  return { name: "Task 3 policy-negative database transactions", ok: true,
    requestIds: [fixture.ids.policyRfq, fixture.ids.policyDirect, fixture.ids.policyPetty,
      fixture.ids.policyImport, fixture.ids.policyExpired] };
}

async function cleanupTask3ReceiptFixture(fixture) {
  const { client, ids, marker } = fixture;
  const remove = async (schema, table, configure) => {
    const { error } = await configure(client.schema(schema).from(table).delete());
    if (error) throw new Error(`${schema}.${table} Task 3 cleanup failed: ${error.message}`);
  };
  const { data: receiptRows, error: receiptError } = await client.schema("warehouse").from("receipts")
    .select("id").in("procurement_po_id", [ids.cleanPo, ids.partialPo]);
  if (receiptError) throw new Error(`Warehouse receipt cleanup lookup failed: ${receiptError.message}`);
  const receiptIds = [...(receiptRows ?? []).map((row) => row.id), ids.quarantineReceipt];
  const { data: qualityRows, error: qualityError } = await client.schema("warehouse").from("quality_inspections")
    .select("id").in("source_id", receiptIds);
  if (qualityError) throw new Error(`Quality cleanup lookup failed: ${qualityError.message}`);
  const qualityIds = (qualityRows ?? []).map((row) => row.id);
  const { data: requestRows, error: requestError } = await client.schema("warehouse").from("stock_change_requests")
    .select("id").in("source_id", [ids.cycleCount, ids.selfCycleCount]);
  if (requestError) throw new Error(`Variance cleanup lookup failed: ${requestError.message}`);
  const stockRequestIds = (requestRows ?? []).map((row) => row.id);

  if (qualityIds.length) await remove("warehouse", "inventory_holds", (query) => query.in("inspection_id", qualityIds));
  if (stockRequestIds.length) await remove("core", "approvals", (query) => query
    .eq("entity_type", "warehouse_stock_change").in("entity_id", stockRequestIds));
  if (qualityIds.length || stockRequestIds.length || receiptIds.length) await remove(
    "warehouse", "exceptions", (query) => query.in("source_id", [
      ...qualityIds.map(String), ...stockRequestIds.map(String), ...receiptIds,
    ]),
  );
  await remove("warehouse", "command_log", (query) => query.like("idempotency_key", `${marker}%`));
  await remove("warehouse", "movements", (query) => query.eq("product_id", ids.product));
  await remove("warehouse", "quality_inspections", (query) => query.in("source_id", receiptIds));
  await remove("warehouse", "receipts", (query) => query.in("id", receiptIds));
  await remove("warehouse", "stock_change_requests", (query) => query.in("source_id", [ids.cycleCount, ids.selfCycleCount]));
  await remove("warehouse", "cycle_counts", (query) => query.in("id", [ids.cycleCount, ids.selfCycleCount]));
  await remove("warehouse", "stock_levels", (query) => query.eq("product_id", ids.product));
  await remove("warehouse", "suppliers", (query) => query.eq("id", `proc-${ids.vendor}`));
  await remove("procurement", "acceptance_packs", (query) => query.in("purchase_order_id", [ids.cleanPo, ids.partialPo]));
  await remove("procurement", "purchase_order_lines", (query) => query.in("purchase_order_id", [ids.cleanPo, ids.partialPo]));
  await remove("procurement", "purchase_orders", (query) => query.in("id", [ids.cleanPo, ids.partialPo]));
  await remove("procurement", "exception_packs", (query) => query.in("request_id", [ids.policyDirect, ids.policyPetty]));
  await remove("procurement", "policy_evidence", (query) => query.like("request_id", `${marker}%`));
  await remove("procurement", "route_decisions", (query) => query.like("request_id", `${marker}%`));
  await remove("legal", "accreditation_dispositions", (query) => query.eq("case_id", ids.accreditationCase));
  await remove("legal", "accreditation_cases", (query) => query.eq("id", ids.accreditationCase));
  await remove("procurement", "requests", (query) => query.like("id", `${marker}%`));
  await remove("warehouse", "products", (query) => query.eq("id", ids.product));
  await remove("core", "activity_log", (query) => query.like("entity_id", `${marker}%`));
  await remove("core", "vendors", (query) => query.in("id", [ids.vendor, ids.expiredVendor]));
  const { count, error } = await client.schema("procurement").from("requests")
    .select("id", { count: "exact", head: true }).like("id", `${marker}%`);
  if (error || count !== 0) throw new Error(`Task 3 cleanup readback failed for ${marker}.`);
  return { entity: "task3-receipt-fixture", marker, removed: true, remaining: 0 };
}

async function procurementReceiptAuthorityWorkflow(page) {
  await page.goto(`${baseUrl}/procurement/purchase-orders?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  if (await page.getByRole("button", { name: /receive items|record receipt/i }).count())
    throw new Error("Procurement still exposes a receipt mutation control.");

  const probe = {
    idempotency_key: `procurement-denial-${Date.now()}`,
    po_id: "00000000-0000-0000-0000-000000000000",
    location_id: "not-used",
    lines: [{ line_id: "00000000-0000-0000-0000-000000000000", quantity: 1 }],
  };
  const removedCommand = await callRpcAsBrowserUser(
    page,
    "procurement",
    "receive_purchase_order",
    probe,
  );
  const warehouseDenial = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "receive_procurement_po",
    probe,
  );
  if (removedCommand.ok) throw new Error("Removed Procurement receipt RPC executed successfully.");
  if (warehouseDenial.ok || !/not authorized|permission|denied/i.test(warehouseDenial.body))
    throw new Error(`Procurement officer Warehouse RPC denial was not enforced (${warehouseDenial.status}).`);
  return {
    name: "procurement receipt authority denial",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
    removedCommandStatus: removedCommand.status,
    warehouseDenialStatus: warehouseDenial.status,
  };
}

async function warehouseOperatorSurfaceWorkflow(page) {
  await page.goto(`${baseUrl}/warehouse?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  for (const label of ["Receive and inspect", "Put away", "Pick or issue", "Returns and counts"])
    await page.getByRole("link", { name: label, exact: true }).first().waitFor({ state: "visible" });
  const body = await page.locator("body").innerText();
  if (/Data & Reports|Pricing workspace|New event|New PO/i.test(body))
    throw new Error("Warehouse Operator surface exposes an advanced or authoring workflow.");
  return { name: "warehouse operator routine surface", ok: true, finalUrl: page.url().replace(baseUrl, "") };
}

async function warehouseSupervisorControlWorkflow(page) {
  for (const [route, expected] of [
    ["/warehouse/quality", /controlled exception disposition/i],
    ["/warehouse/approvals", /delegation never permits the requester/i],
    ["/warehouse/cycle-counts", /material variance requires a different Warehouse Supervisor/i],
  ]) {
    await page.goto(`${baseUrl}${route}?workflow=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForMeaningfulRoute(page);
    if (!expected.test(await page.locator("body").innerText()))
      throw new Error(`Supervisor control contract missing at ${route}.`);
  }
  return { name: "warehouse supervisor controlled exceptions", ok: true, finalUrl: page.url().replace(baseUrl, "") };
}

async function warehouseReceivingValidationWorkflow(page) {
  await page.goto(`${baseUrl}/warehouse/receiving?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  const addLine = page.getByRole("button", { name: "Add to receipt" });
  if (!(await addLine.isDisabled()))
    throw new Error("Receiving accepted an empty receipt line.");
  await page.getByLabel("Enter barcode manually").fill("QA-UNKNOWN-STOCK");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator('[role="alert"]').first().waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  return {
    name: "warehouse receiving validation",
    ok: await page.getByRole("button", { name: "Add to receipt" }).isDisabled(),
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function warehouseQualityValidationWorkflow(page) {
  await page.goto(`${baseUrl}/warehouse/quality?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page
    .waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          !/Loading quality controls/i.test(text) &&
          (/No inspections waiting/i.test(text) ||
            [...document.querySelectorAll("button")].some(
              (button) => button.textContent?.trim() === "Inspect",
            ))
        );
      },
      undefined,
      { timeout: 12_000 },
    )
    .catch(() => {});
  const inspect = page.getByRole("button", { name: "Inspect", exact: true }).first();
  if (!(await inspect.count()))
    return {
      name: "warehouse quality validation",
      ok: /No inspections waiting/i.test(await page.locator("body").innerText()),
      finalUrl: page.url().replace(baseUrl, ""),
    };
  await inspect.click();
  const dialog = page.getByRole("dialog", { name: "Inspect stock" });
  const submit = dialog.getByRole("button", { name: "Submit inspection" });
  if (!(await submit.isDisabled()))
    throw new Error("Quality inspection bypassed required evidence.");
  await dialog.getByLabel("Disposition").selectOption("hold");
  if (!(await submit.isDisabled()))
    throw new Error("Quality hold bypassed reason and evidence validation.");
  await dialog.getByRole("button", { name: "Close" }).click();
  return {
    name: "warehouse quality validation",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function warehouseCycleCountValidationWorkflow(page) {
  await page.goto(`${baseUrl}/warehouse/cycle-counts?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByLabel("Category").selectOption("device");
  await page.getByLabel("Enter barcode manually").fill("QA-UNKNOWN-UNIT");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator('p[role="alert"]').waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  return {
    name: "warehouse cycle count validation",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function warehouseReturnValidationWorkflow(page) {
  await page.goto(`${baseUrl}/warehouse/returns?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByLabel("Related event (optional)").selectOption({ index: 1 });
  await page.getByLabel("Product").selectOption({ index: 1 });
  const serialInput = page.getByLabel("Enter barcode manually");
  if (await serialInput.count()) {
    await serialInput.fill("QA-UNKNOWN-RETURN");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.locator('p[role="alert"]').waitFor({ state: "visible" });
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  return {
    name: "warehouse return validation",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function roleHandoffReadbackWorkflow(page, route, expectedText, name) {
  await page.goto(`${baseUrl}${route}?handoff=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByText(expectedText, { exact: true }).first().waitFor({
    state: "visible",
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  await page.getByText(expectedText, { exact: true }).first().waitFor({
    state: "visible",
  });
  return { name, ok: true, finalUrl: page.url().replace(baseUrl, "") };
}

async function runWorkflow(browser, viewport, user, workflow) {
  const context = await browser.newContext({
    viewport: viewport.viewport,
    isMobile: viewport.isMobile,
  });
  await installScopedProtectionBypass({
    context,
    appOrigin,
    protectionBypass,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const networkErrors = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      const loc = message.location();
      const where = loc?.url
        ? ` (${loc.url.split("/").slice(-2).join("/")}:${loc.lineNumber}:${loc.columnNumber})`
        : "";
      consoleErrors.push(
        `${message.type()}${where}: ${message.text()}`.slice(0, 320),
      );
    }
  });
  page.on("pageerror", (error) =>
    consoleErrors.push(`pageerror: ${error.message}`.slice(0, 240)),
  );
  page.on("response", (response) => {
    const url = response.url();
    if (
      (url.includes("supabase.co") || url.includes("/_next/")) &&
      response.status() >= 400
    ) {
      networkErrors.push({ status: response.status(), url: url.slice(0, 220) });
    }
  });

  try {
    const loginResult = await login(page, user);
    if (loginResult.status !== "signed-in") {
      return {
        viewport: viewport.name,
        user: user.email,
        workflow: workflow.name,
        ok: false,
        login: loginResult,
      };
    }
    const result = await workflow.run(page);
    return {
      viewport: viewport.name,
      user: user.email,
      workflow: workflow.name,
      ...result,
      consoleErrors: Array.from(new Set(consoleErrors)).slice(0, 12),
      networkErrors: networkErrors.slice(0, 12),
    };
  } catch (error) {
    return {
      viewport: viewport.name,
      user: user.email,
      workflow: workflow.name,
      ok: false,
      error: String(error.message || error).slice(0, 300),
      consoleErrors: Array.from(new Set(consoleErrors)).slice(0, 12),
      networkErrors: networkErrors.slice(0, 12),
    };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
const results = [];

for (const viewport of viewports.filter(
  (item) => !viewFilter || item.name === viewFilter,
)) {
  for (const user of users.filter(
    (item) => !roleFilter || item.role === roleFilter,
  )) {
    const context = await browser.newContext({
      viewport: viewport.viewport,
      isMobile: viewport.isMobile,
    });
    await installScopedProtectionBypass({
      context,
      appOrigin,
      protectionBypass,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const networkErrors = [];

    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        const loc = message.location();
        const where = loc?.url
          ? ` (${loc.url.split("/").slice(-2).join("/")}:${loc.lineNumber}:${loc.columnNumber})`
          : "";
        consoleErrors.push(
          `${message.type()}${where}: ${message.text()}`.slice(0, 320),
        );
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(`pageerror: ${error.message}`.slice(0, 240));
    });
    page.on("response", (response) => {
      const url = response.url();
      if (
        (url.includes("supabase.co") || url.includes("/_next/")) &&
        response.status() >= 400
      ) {
        networkErrors.push({
          status: response.status(),
          url: url.replace(/apikey=[^&]+/g, "apikey=[redacted]").slice(0, 220),
        });
      }
    });

    let loginResult;
    const routeResults = [];
    try {
      loginResult = await login(page, user);
      if (loginResult.status === "signed-in") {
        for (const route of routesFor(user.role)) {
          try {
            routeResults.push(await auditRoute(page, route));
          } catch (error) {
            routeResults.push({
              route: route.path,
              class: "navigation-error",
              expectationMet: false,
              error: String(error.message || error).slice(0, 220),
            });
          }
        }
      }
    } catch (error) {
      loginResult = {
        status: "login-error",
        url: page.url().replace(baseUrl, ""),
        text: String(error.message || error).slice(0, 300),
      };
    }

    const item = {
      viewport: viewport.name,
      role: user.role,
      email: user.email,
      login: loginResult,
      routes: routeResults,
      networkErrors: Array.from(
        new Map(
          networkErrors.map((entry) => [`${entry.status}:${entry.url}`, entry]),
        ).values(),
      ).slice(0, 24),
      consoleErrors: Array.from(new Set(consoleErrors)).slice(0, 24),
    };
    results.push(item);
    console.log(
      JSON.stringify({
        viewport: item.viewport,
        role: item.role,
        login: item.login.status,
        rendered: routeResults.filter((route) => route.class === "rendered")
          .length,
        denied: routeResults.filter((route) => route.class === "access-denied")
          .length,
        problems: routeResults.filter(
          (route) =>
            route.class !== "rendered" &&
            route.class !== "access-denied" &&
            route.class !== "redirected-login",
        ).length,
        expectationMisses: routeResults.filter(
          (route) => route.expectationMet === false,
        ).length,
        overflow: routeResults
          .filter((route) => route.overflow)
          .map((route) => route.route),
        overlaps: routeResults.filter((route) => route.overlaps?.length).length,
        networkErrors: item.networkErrors.length,
        consoleErrors: item.consoleErrors.length,
      }),
    );
    await context.close();
  }
}

const workflows = [];
let cleanup = { runId: auditRunId, complete: true, results: [] };
const task3Fixtures = [];
const vendorAuditEmail = (marker) =>
  `audit.vendor.${marker.toLowerCase()}@example.com`;
const transactionViewports = viewports.filter(
  (item) =>
    ["desktop-1440", "mobile-390"].includes(item.name) &&
    (!viewFilter || item.name === viewFilter),
);
const auditMarkers = transactionViewports.map(
  (viewport) => `${auditRunId}-${viewport.name}`,
);
const cleanupTargets = allowMutations
  ? auditMarkers.flatMap((marker) => [
      {
        runId: auditRunId,
        schema: "legal",
        table: "vendor_invites",
        filters: { company_name: `${marker} Vendor` },
        proofColumn: "company_name",
      },
      {
        runId: auditRunId,
        schema: "legal",
        table: "accreditation_cases",
        filters: { vendor_name: `${marker} Vendor` },
        proofColumn: "vendor_name",
      },
      {
        runId: auditRunId,
        schema: "core",
        table: "vendors",
        filters: { legal_name: `${marker} Vendor` },
        proofColumn: "legal_name",
      },
      {
        runId: auditRunId,
        schema: "procurement",
        table: "requests",
        filters: { title: `${marker} Procurement draft` },
        proofColumn: "title",
      },
      {
        runId: auditRunId,
        schema: "warehouse",
        table: "storage_areas",
        filters: { code: marker.toUpperCase() },
        proofColumn: "code",
      },
      {
        runId: auditRunId,
        schema: "warehouse",
        table: "events",
        filters: { name: `${marker} Event` },
        proofColumn: "name",
      },
      {
        runId: auditRunId,
        schema: "procurement",
        table: "doa_assignments",
        filters: { department: `${marker} Department` },
        proofColumn: "department",
      },
      {
        runId: auditRunId,
        schema: "procurement",
        table: "doa_matrices",
        filters: {
          department: `${marker} Department`,
          version: `${marker}-V1`,
        },
        proofColumn: "department",
      },
    ])
  : [];

try {
  for (const viewport of transactionViewports) {
    for (const [email, name, run] of [
      [
        "intra.test.proc.officer@mwell.com.ph",
        "procurement receipt authority denial",
        procurementReceiptAuthorityWorkflow,
      ],
      [
        "intra.test.wh.operations@mwell.com.ph",
        "warehouse operator routine surface",
        warehouseOperatorSurfaceWorkflow,
      ],
      [
        "intra.test.wh.logistics@mwell.com.ph",
        "warehouse supervisor controlled exceptions",
        warehouseSupervisorControlWorkflow,
      ],
    ])
      workflows.push(
        await runWorkflow(browser, viewport, { email }, { name, run }),
      );
  }
  if (allowMutations) {
    for (const viewport of transactionViewports) {
      const marker = `${auditRunId}-${viewport.name}`;
      const task3Fixture = await createTask3ReceiptFixture(marker);
      task3Fixtures.push(task3Fixture);
      workflows.push(await runWorkflow(
        browser, viewport, { email: "intra.test.wh.operations@mwell.com.ph" },
        { name: "Task 3 operator receipt transactions", run: (page) => task3OperatorReceiptTransactions(page, task3Fixture) },
      ));
      workflows.push(await runWorkflow(
        browser, viewport, { email: "intra.test.wh.logistics@mwell.com.ph" },
        { name: "Task 3 supervisor quarantine and variance transactions", run: (page) => task3SupervisorTransactions(page, task3Fixture) },
      ));
      workflows.push(await runWorkflow(
        browser, viewport, { email: "intra.test.proc.officer@mwell.com.ph" },
        { name: "Task 3 policy-negative database transactions", run: (page) => task3PolicyNegativeTransactions(page, task3Fixture) },
      ));
      workflows.push(
        await runWorkflow(
          browser,
          viewport,
          { email: "intra.test.proc.requester@mwell.com.ph" },
          {
            name: "procurement request draft",
            run: (page) => procurementCreateRequestWorkflow(page, marker),
          },
        ),
      );
      workflows.push(
        await runWorkflow(
          browser,
          viewport,
          { email: "intra.test.legal.reviewer@mwell.com.ph" },
          {
            name: "legal vendor invite",
            run: (page) => legalInviteVendorWorkflow(page, marker),
          },
        ),
      );
      workflows.push(
        await runWorkflow(
          browser,
          viewport,
          { email: "intra.test.wh.warehouse.admin@mwell.com.ph" },
          {
            name: "warehouse bin creation",
            run: (page) => warehouseCreateBinWorkflow(page, marker),
          },
        ),
      );
      workflows.push(
        await runWorkflow(
          browser,
          viewport,
          { email: "intra.test.wh.logistics@mwell.com.ph" },
          {
            name: "warehouse bin role handoff",
            run: (page) =>
              roleHandoffReadbackWorkflow(
                page,
                "/warehouse/storage",
                marker.toUpperCase(),
                "warehouse bin role handoff",
              ),
          },
        ),
      );
      workflows.push(
        await runWorkflow(
          browser,
          viewport,
          { email: "intra.test.wh.business.unit@mwell.com.ph" },
          {
            name: "warehouse event creation",
            run: (page) => warehouseCreateEventWorkflow(page, marker),
          },
        ),
      );
      workflows.push(
        await runWorkflow(
          browser,
          viewport,
          { email: "intra.test.wh.marketing@mwell.com.ph" },
          {
            name: "warehouse event role handoff",
            run: (page) =>
              roleHandoffReadbackWorkflow(
                page,
                "/warehouse/events",
                `${marker} Event`,
                "warehouse event role handoff",
              ),
          },
        ),
      );
      workflows.push(
        await runWorkflow(
          browser,
          viewport,
          { email: "intra.test.admin@mwell.com.ph" },
          {
            name: "department DOA creation",
            run: (page) => adminCreateDoaWorkflow(page, marker),
          },
        ),
      );
      workflows.push(
        await runWorkflow(
          browser,
          viewport,
          { email: "intra.test.legal.admin@mwell.com.ph" },
          {
            name: "department DOA role handoff",
            run: (page) =>
              roleHandoffReadbackWorkflow(
                page,
                "/admin/doa",
                `${marker} Department`,
                "department DOA role handoff",
              ),
          },
        ),
      );
      for (const [email, name, run] of [
        [
          "intra.test.wh.logistics@mwell.com.ph",
          "warehouse receiving validation",
          warehouseReceivingValidationWorkflow,
        ],
        [
          "intra.test.wh.logistics@mwell.com.ph",
          "warehouse quality validation",
          warehouseQualityValidationWorkflow,
        ],
        [
          "intra.test.wh.finance@mwell.com.ph",
          "warehouse cycle count validation",
          warehouseCycleCountValidationWorkflow,
        ],
        [
          "intra.test.wh.operations@mwell.com.ph",
          "warehouse return validation",
          warehouseReturnValidationWorkflow,
        ],
      ])
        workflows.push(
          await runWorkflow(browser, viewport, { email }, { name, run }),
        );
    }
  } else {
    console.warn(
      "AUDIT_MUTATIONS is not true; write/read-back workflows were skipped.",
    );
  }
} finally {
  await browser.close();
  if (allowMutations) {
    const task3Results = [];
    for (const fixture of [...task3Fixtures].reverse()) {
      try {
        task3Results.push(await cleanupTask3ReceiptFixture(fixture));
      } catch (error) {
        task3Results.push({ entity: "task3-receipt-fixture", marker: fixture.marker,
          removed: false, remaining: null,
          error: error instanceof Error ? error.message : String(error) });
      }
    }
    cleanup = await cleanupRun(auditRunId, cleanupTargets, {
      authEmails: auditMarkers.map((marker) => vendorAuditEmail(marker)),
    });
    cleanup.results.push(...task3Results);
    cleanup.complete = cleanup.complete && task3Results.every((result) => result.remaining === 0 && !result.error);
  }
}

const aggregate = results.map((item) => ({
  viewport: item.viewport,
  role: item.role,
  email: item.email,
  loginStatus: item.login.status,
  loginUrl: item.login.url,
  rendered: item.routes
    .filter((route) => route.class === "rendered")
    .map((route) => route.route),
  denied: item.routes
    .filter((route) => route.class === "access-denied")
    .map((route) => route.route),
  expectationMisses: item.routes
    .filter((route) => route.expectationMet === false)
    .map((route) => ({
      route: route.route,
      class: route.class,
      text: route.text,
      error: route.error,
    })),
  blankOrErrors: item.routes
    .filter((route) =>
      ["blank-or-nearblank", "error", "navigation-error"].includes(route.class),
    )
    .map((route) => ({
      route: route.route,
      class: route.class,
      error: route.error,
    })),
  overflowRoutes: item.routes
    .filter((route) => route.overflow)
    .map((route) => route.route),
  overlapRoutes: item.routes
    .filter((route) => route.overlaps?.length)
    .map((route) => ({
      route: route.route,
      examples: route.overlaps.slice(0, 2),
    })),
  deadLinkRoutes: item.routes
    .filter((route) => route.deadLinks?.length)
    .map((route) => ({ route: route.route, count: route.deadLinks.length })),
  unlabeledControlRoutes: item.routes
    .filter((route) => route.unlabeledControls?.length)
    .map((route) => ({
      route: route.route,
      count: route.unlabeledControls.length,
    })),
  networkErrors: item.networkErrors,
  consoleErrors: item.consoleErrors,
}));

const outputPath = path.resolve(
  "test-results",
  "full-intra-live-e2e-results.json",
);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    runId: auditRunId,
    task3Transactions: workflows.filter((workflow) => workflow.workflow?.startsWith("Task 3")),
    aggregate,
    workflows,
    cleanup,
    results,
  }, null, 2)}\n`,
);

const routeFailures = aggregate.flatMap((item) => [
  ...item.expectationMisses.map(
    (entry) => `${item.viewport}/${item.role}${entry.route}: expectation miss`,
  ),
  ...item.blankOrErrors.map(
    (entry) => `${item.viewport}/${item.role}${entry.route}: ${entry.class}`,
  ),
  ...item.overflowRoutes.map(
    (route) => `${item.viewport}/${item.role}${route}: overflow`,
  ),
  ...item.overlapRoutes.map(
    (entry) => `${item.viewport}/${item.role}${entry.route}: overlap`,
  ),
  ...item.deadLinkRoutes.map(
    (entry) => `${item.viewport}/${item.role}${entry.route}: dead link`,
  ),
  ...item.unlabeledControlRoutes.map(
    (entry) => `${item.viewport}/${item.role}${entry.route}: unlabeled control`,
  ),
  ...item.networkErrors.map(
    (entry) => `${item.viewport}/${item.role}: network ${entry.status}`,
  ),
  ...item.consoleErrors.map(
    () => `${item.viewport}/${item.role}: console error`,
  ),
]);
const workflowFailures = workflows
  .filter(
    (workflow) =>
      !workflow.ok ||
      workflow.networkErrors?.length ||
      workflow.consoleErrors?.length,
  )
  .map(
    (workflow) =>
      `${workflow.viewport}/${workflow.workflow}: ${workflow.error ?? "failed"}`,
  );
if (!cleanup.complete) workflowFailures.push(`${auditRunId}: cleanup incomplete`);

console.log(`Wrote ${outputPath}`);
if (routeFailures.length || workflowFailures.length) {
  console.error(
    JSON.stringify(
      {
        routeFailures: routeFailures.slice(0, 60),
        workflowFailures: workflowFailures.slice(0, 20),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
