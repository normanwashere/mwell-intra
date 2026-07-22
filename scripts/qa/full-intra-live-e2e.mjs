import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
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
  CURRENT_LIVE_SCENARIOS,
  assertAuditRunId,
  evaluateScenarioCoverage,
  scenarioCoverageFailures,
  workflowScenarioEvidence,
} from "./live-e2e-scenarios.mjs";
import {
  createAuditDatabaseClient,
  verifyCheckpoint,
} from "./live-e2e-db-verify.mjs";
import { cleanupRun } from "./live-e2e-cleanup.mjs";
import { resolveSharedUatPassword } from "./provision-uat-intra-test-users.mjs";

const require = createRequire(path.resolve("apps/shell/package.json"));
const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const auditEvidenceDir = path.resolve(
  process.env.AUDIT_EVIDENCE_DIR ??
    path.join(
      path.dirname(
        process.env.AUDIT_OUTPUT_PATH ??
          "test-results/full-intra-live-e2e-results.json",
      ),
      "evidence",
    ),
);

function preserveFatalAuditEvidence(error) {
  const outputPath = path.resolve(
    process.env.AUDIT_OUTPUT_PATH ??
      "test-results/full-intra-live-e2e-results.json",
  );
  try {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(
      outputPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          baseUrl: process.env.AUDIT_BASE_URL ?? null,
          runId: process.env.AUDIT_RUN_ID ?? null,
          phase: process.env.AUDIT_PHASE ?? "all",
          fatal: {
            message: error instanceof Error ? error.message : String(error),
          },
        },
        null,
        2,
      )}\n`,
    );
  } catch (evidenceError) {
    console.error("Unable to preserve fatal audit evidence:", evidenceError);
  }
}

process.once("uncaughtException", (error) => {
  preserveFatalAuditEvidence(error);
  console.error(error);
  process.exit(1);
});
process.once("unhandledRejection", (error) => {
  preserveFatalAuditEvidence(error);
  console.error(error);
  process.exit(1);
});

const baseUrl = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const masterPassword = process.env.AUDIT_PASSWORD;
const allowMutations = process.env.AUDIT_MUTATIONS === "true";
const viewFilter = process.env.AUDIT_VIEWPORT;
const roleFilter = process.env.AUDIT_ROLE;
const auditPhase = process.env.AUDIT_PHASE ?? "all";
if (!["all", "routes", "transactions"].includes(auditPhase)) {
  throw new Error("AUDIT_PHASE must be all, routes, or transactions.");
}
const runRouteAudit = auditPhase !== "transactions";
const runTransactionAudit = auditPhase !== "routes";
const mutatingPhase = allowMutations && runTransactionAudit;
const requireVendorDelivery =
  process.env.AUDIT_REQUIRE_VENDOR_DELIVERY === "true";
const controlledVendorEmail =
  process.env.AUDIT_VENDOR_EMAIL?.trim().toLowerCase();
const vendorDeliveryConfigurationError =
  mutatingPhase &&
  requireVendorDelivery &&
  !controlledVendorEmail?.includes("{marker}")
    ? "AUDIT_VENDOR_EMAIL must be a controlled mailbox template containing {marker} when AUDIT_REQUIRE_VENDOR_DELIVERY=true."
    : null;

const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
assertApprovedMutationTarget({
  appEnv: process.env.APP_ENV,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  expectedProjectRef: process.env.SUPABASE_PROJECT_REF,
  productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
  mutationsRequested: mutatingPhase,
  mutationsApproved: process.env.POLICY_ALLOW_TEST_MUTATIONS === "true",
});
const projectRef = projectRefFromSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);
console.log(
  `Live audit target: environment=${process.env.APP_ENV} project=${projectRef}`,
);
const auditRunId = mutatingPhase
  ? assertAuditRunId(process.env.AUDIT_RUN_ID ?? "")
  : process.env.AUDIT_RUN_ID || null;

if (mutatingPhase && !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required for persistence verification and governed cleanup.",
  );

if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  throw new Error(
    "AUDIT_BASE_URL must be the HTTPS URL of the live deployment.",
  );
}
if (!masterPassword) {
  throw new Error(
    "AUDIT_PASSWORD is required as the vaulted shared UAT credential.",
  );
}
const sharedUatPassword = resolveSharedUatPassword(masterPassword);
const appOrigin = new URL(baseUrl).origin;
await verifyDeployedTargetIdentity({
  baseUrl,
  appEnv: process.env.APP_ENV,
  expectedProjectRef: process.env.SUPABASE_PROJECT_REF,
  productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
  mutationsRequested: mutatingPhase,
  protectionBypass,
});

const users = CURRENT_LIVE_ROLES;

const EXECUTABLE_CROSS_MODULE_SCENARIOS = new Set(
  CURRENT_LIVE_SCENARIOS.map((scenario) => scenario.id),
);
for (const scenarioId of EXECUTABLE_CROSS_MODULE_SCENARIOS) {
  if (!CURRENT_LIVE_SCENARIOS.some((scenario) => scenario.id === scenarioId)) {
    throw new Error(
      `Executable scenario ${scenarioId} is missing from the live contract.`,
    );
  }
}

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

const DENIED_ROUTE_TEXT =
  /No (?:warehouse|procurement|legal|vendor|admin|My Work|Events|Insights|Finance|Product) access|Access denied|doesn't include|not authorized|reserved for enrolled|employee workspace/i;

const FINANCE_WAREHOUSE_ROLES = new Set([
  "finance",
  "pricing",
  "warehouse_admin",
]);
const FINANCE_PROCUREMENT_ROLES = new Set(["finance", "admin"]);

function hasAssignedModule(user, module) {
  return (user.assignments[module]?.length ?? 0) > 0;
}

function hasProcurementWorkflowAccess(user) {
  return (
    hasAssignedModule(user, "procurement") ||
    (user.assignments.legal ?? []).includes("legal_reviewer")
  );
}

function hasFinanceAccess(user) {
  return (
    (user.assignments.warehouse ?? []).some((role) =>
      FINANCE_WAREHOUSE_ROLES.has(role),
    ) ||
    (user.assignments.procurement ?? []).some((role) =>
      FINANCE_PROCUREMENT_ROLES.has(role),
    )
  );
}

const ROUTE_AUTHORIZATION_MATRIX = [
  {
    path: "/",
    allowed: () => true,
    allowedText: /Your areas|No areas yet|Vendor Portal|Admin/i,
  },
  {
    path: "/warehouse",
    allowed: (user) => hasAssignedModule(user, "warehouse"),
    allowedText: /Warehouse|Dashboard/i,
    deniedText: /No warehouse access|Access denied/i,
  },
  {
    path: "/procurement",
    allowed: hasProcurementWorkflowAccess,
    allowedText: /Procurement|Approval inbox|Purchase request/i,
    deniedText: /No procurement access|Access denied/i,
  },
  {
    path: "/legal",
    allowed: (user) => hasAssignedModule(user, "legal"),
    allowedText: /Legal|Accreditation/i,
    deniedText: /No legal access|Access denied/i,
  },
  {
    path: "/vendor",
    allowed: (user) => user.kind === "vendor",
    allowedText: /Vendor|accreditation|enrolled vendor/i,
    deniedText: /reserved for enrolled|No vendor access|Access denied/i,
  },
  {
    path: "/admin/users",
    allowed: (user) => (user.assignments.core ?? []).includes("platform_admin"),
    allowedText: /Users & Roles|Access matrix/i,
    deniedText: /No admin access|don't have access|No modules|Access denied/i,
  },
  {
    path: "/knowledge",
    allowed: () => true,
    allowedText:
      /Start with the flow|MWELL INTRA OPERATING HANDBOOK|Knowledge Base/i,
  },
  {
    path: "/work",
    allowed: (user) => user.kind === "employee",
    allowedText: /My Work|Assignments|Your areas/i,
    deniedText: /No My Work access|employee workspace|Access denied/i,
  },
  {
    path: "/events",
    allowed: (user) => hasAssignedModule(user, "events"),
    allowedText: /Events|Event operations/i,
    deniedText: /No Events access|Access denied/i,
  },
  {
    path: "/insights",
    allowed: (user) => hasAssignedModule(user, "insights"),
    allowedText: /Insights|Operational indicators|Decision support/i,
    deniedText: /No Insights access|Access denied/i,
  },
  {
    path: "/finance",
    allowed: hasFinanceAccess,
    allowedText: /Finance|Payment readiness|Cross-module activity/i,
    deniedText: /No Finance access|Access denied/i,
  },
  {
    path: "/product",
    allowed: (user) => hasAssignedModule(user, "product"),
    allowedText: /Product readiness|Pricing governance|go-live/i,
    deniedText: /No Product access|Access denied/i,
  },
];

const roleRoutes = {
  platform_admin: [
    { path: "/admin/users", text: /Users & Roles|Access matrix/i },
  ],
  vendor_portal: [{ path: "/vendor", text: /Vendor|accreditation|Acme/i }],
  warehouse_logistics_supervisor: [
    { path: "/warehouse/receiving", text: /Receiving|Receive/i },
    { path: "/warehouse/quality", text: /Controlled exception disposition/i },
    { path: "/warehouse/approvals", text: /Controlled exceptions/i },
    {
      path: "/warehouse/cycle-counts",
      text: /material variance requires a different Warehouse Supervisor/i,
    },
    { path: "/warehouse/locations", text: /Locations|Warehouse|Site/i },
    { path: "/warehouse/storage", text: /Storage|Bin|Area/i },
  ],
  warehouse_operations: [
    {
      path: "/warehouse",
      text: /Receive and inspect|Put away|Pick or issue|Returns and counts/i,
    },
    {
      path: "/warehouse/purchase-orders",
      text: /Receive and inspect|Purchase Orders/i,
    },
    { path: "/warehouse/storage", text: /Put away|Storage|Bin/i },
    {
      path: "/warehouse/allocations",
      text: /Pick or issue|Allocations|Issue/i,
    },
    {
      path: "/warehouse/returns",
      text: /Returns and counts|Returns|Record return/i,
    },
  ],
  warehouse_finance: [
    { path: "/warehouse/finance", text: /Finance|Valuation|Reconciliation/i },
    { path: "/warehouse/approvals", text: /Approvals|adjustment/i },
  ],
  warehouse_bi_analyst: [
    { path: "/insights/warehouse", text: /Insights|Warehouse|Indicators/i },
  ],
  warehouse_marketing: [
    { path: "/events", text: /Events|Activations|Event operations/i },
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
    { path: "/legal/invites/new", text: /Invite vendor|Onboard a new vendor/i },
  ],
  legal_compliance: [{ path: "/legal", text: /Accreditation cases|Legal/i }],
  legal_admin: [
    { path: "/legal", text: /Accreditation cases|Legal/i },
    { path: "/legal/invites/new", text: /Invite vendor|Onboard a new vendor/i },
  ],
  warehouse_operator: [
    { path: "/warehouse/receiving", text: /Receiving|Receive/i },
    { path: "/warehouse/storage", text: /Put away|Storage|Bin/i },
    {
      path: "/warehouse/allocations",
      text: /Pick or issue|Allocations|Issue/i,
    },
    { path: "/warehouse/returns", text: /Returns|Record return/i },
  ],
  warehouse_supervisor: [
    { path: "/warehouse/receiving", text: /Receiving|Receive/i },
    {
      path: "/warehouse/quality",
      text: /Quality|Controlled exception disposition/i,
    },
    { path: "/warehouse/approvals", text: /Controlled exceptions|Approvals/i },
    { path: "/warehouse/cycle-counts", text: /Cycle|Count|variance/i },
  ],
  warehouse_business_unit: [
    { path: "/events", text: /Events|Activations|Event operations/i },
  ],
  warehouse_procurement: [
    {
      path: "/warehouse/purchase-orders",
      text: /Purchase Orders|Receive and inspect/i,
    },
  ],
  finance_unified: [
    {
      path: "/finance",
      text: /Finance|Payment readiness|Valuation|Reconciliation/i,
    },
    {
      path: "/procurement/approvals",
      text: /Approval inbox|Waiting on you|Inbox zero/i,
    },
    {
      path: "/warehouse/approvals",
      text: /Approvals|Stock adjustment approvals|Controlled exceptions/i,
    },
  ],
  events_requester: [{ path: "/events", text: /Events|New event|Create/i }],
  events_coordinator: [
    { path: "/events", text: /Events|New event|Readiness|Fulfillment/i },
  ],
  events_viewer: [{ path: "/events", text: /Events|Readiness|Fulfillment/i }],
  events_admin: [
    { path: "/events", text: /Events|New event|Readiness|Fulfillment/i },
  ],
  insights_analyst: [
    { path: "/insights", text: /Insights|Indicators|Warehouse|Procurement/i },
  ],
  insights_manager: [
    { path: "/insights", text: /Insights|Indicators|Warehouse|Procurement/i },
  ],
  insights_executive: [
    { path: "/insights", text: /Insights|Executive|Indicators/i },
  ],
  insights_admin: [
    { path: "/insights", text: /Insights|Indicators|Warehouse|Procurement/i },
  ],
};

roleRoutes.platform_administrator = roleRoutes.platform_admin;
roleRoutes.vendor_representative = roleRoutes.vendor_portal;
roleRoutes.general_employee = [
  ...roleRoutes.procurement_requester,
  ...roleRoutes.warehouse_business_unit,
  ...roleRoutes.events_requester,
];
roleRoutes.operations_associate = [
  ...roleRoutes.warehouse_operator,
  ...roleRoutes.warehouse_operations,
];
roleRoutes.operations_lead = [
  ...roleRoutes.warehouse_supervisor,
  ...roleRoutes.warehouse_logistics_supervisor,
  ...roleRoutes.procurement_approver,
];
roleRoutes.procurement_lead = [
  ...roleRoutes.procurement_officer,
  ...roleRoutes.procurement_admin,
  ...roleRoutes.warehouse_procurement,
];
roleRoutes.finance_controller = roleRoutes.finance_unified;
roleRoutes.legal_compliance_lead = [
  ...roleRoutes.legal_reviewer,
  ...roleRoutes.legal_compliance,
  ...roleRoutes.legal_admin,
];
roleRoutes.marketing_events_lead = [
  ...roleRoutes.events_coordinator,
  ...roleRoutes.events_admin,
  ...roleRoutes.warehouse_marketing,
];
roleRoutes.product_owner = [
  ...roleRoutes.events_viewer,
  { path: "/product", text: /Product readiness|Pricing governance|go-live/i },
];
roleRoutes.leadership_insights = [
  ...roleRoutes.insights_analyst,
  ...roleRoutes.warehouse_bi_analyst,
];

function routesFor(user, discoveredRoutes = []) {
  const exactRoutes = ROUTE_AUTHORIZATION_MATRIX.map((route) => {
    const allowed = route.allowed(user);
    return {
      path: route.path,
      expectedAccess: allowed ? "allowed" : "denied",
      text: allowed
        ? route.allowedText
        : (route.deniedText ?? DENIED_ROUTE_TEXT),
    };
  });
  const scopedRoutes = (roleRoutes[user.role] ?? []).map((route) => ({
    ...route,
    expectedAccess: "allowed",
  }));
  const renderedNavigationRoutes = discoveredRoutes.map((path) => ({
    path,
    expectedAccess: "allowed",
    source: "rendered-navigation",
  }));
  return [
    ...new Map(
      [...exactRoutes, ...scopedRoutes, ...renderedNavigationRoutes].map(
        (route) => [route.path, route],
      ),
    ).values(),
  ];
}

function canonicalPath(pathname) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

function finalPathMatches(expectedPath, currentUrl) {
  const actualPath = canonicalPath(new URL(currentUrl).pathname);
  const acceptedPaths = new Map([
    ["/procurement", new Set(["/procurement", "/procurement/approvals"])],
  ]);
  return (
    actualPath === canonicalPath(expectedPath) ||
    acceptedPaths.get(canonicalPath(expectedPath))?.has(actualPath) === true
  );
}

async function collectVisibleSameOriginRoutes(page, selector) {
  return page.locator(selector).evaluateAll((links) => {
    const paths = links.flatMap((link) => {
      const style = getComputedStyle(link);
      const rect = link.getBoundingClientRect();
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0;
      const href = link.getAttribute("href");
      if (!visible || !href || link.hasAttribute("download")) return [];
      const target = new URL(href, location.origin);
      if (target.origin !== location.origin) return [];
      if (
        target.pathname.startsWith("/login") ||
        target.pathname.startsWith("/reset-password") ||
        target.pathname.startsWith("/api/") ||
        target.pathname.startsWith("/_next/") ||
        /\.[a-z0-9]{2,5}$/i.test(target.pathname)
      ) {
        return [];
      }
      return [target.pathname];
    });
    return [...new Set(paths)];
  });
}

async function discoverVisibleNavigationRoutes(page) {
  const routes = new Set(
    await collectVisibleSameOriginRoutes(
      page,
      'nav a[href], aside a[href], [role="navigation"] a[href]',
    ),
  );
  const more = page.getByRole("button", { name: "More", exact: true });
  if ((await more.count()) && (await more.first().isVisible())) {
    await more.first().click();
    const allAreas = page.getByRole("dialog", { name: "All areas" });
    await allAreas.waitFor({ state: "visible", timeout: 5_000 });
    for (const route of await collectVisibleSameOriginRoutes(
      page,
      '[role="dialog"] nav a[href], [role="dialog"] [role="navigation"] a[href]',
    )) {
      routes.add(route);
    }
    await page.keyboard.press("Escape");
    await allAreas.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  }
  return [...routes];
}

async function discoverSafeDetailRoutes(page) {
  return collectVisibleSameOriginRoutes(
    page,
    'main a[href], [data-shell-content="true"] a[href]',
  );
}

function classify(text, url) {
  const lower = (text || "").toLowerCase();
  if (url.includes("/login")) return "redirected-login";
  if (
    lower.includes("page not found") ||
    lower.includes("we couldn't find that page")
  ) {
    return "not-found";
  }
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
    lower.includes("access required") ||
    lower.includes("employee workspace") ||
    lower.includes("you don't have access to this page") ||
    lower.includes("not available for your role") ||
    lower.includes("doesn't include") ||
    lower.includes("not authorized") ||
    lower.includes("no access") ||
    /\bno (?:warehouse|procurement|legal|vendor|admin|my work|events|insights|finance|product) access\b/.test(
      lower,
    ) ||
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
        const body = document.body;
        if (!body) return false;
        const text = body.innerText.trim().replace(/\s+/g, " ");
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
        const body = document.body;
        if (!body) return false;
        const text = body.innerText.trim().replace(/\s+/g, " ");
        return new RegExp(source, flags).test(text);
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

async function auditKeyboardAndHotspots(page) {
  const before = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName?.toLowerCase() ?? null,
      label:
        active?.getAttribute?.("aria-label") ??
        active?.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ??
        null,
    };
  });
  await page.keyboard.press("Tab");
  const result = await page.evaluate(async () => {
    const selector =
      'a[href],button,input:not([type="hidden"]):not([type="file"]),select,textarea,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])';
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const hiddenFromInteraction = (element) =>
      Boolean(
        element.closest("[inert]") ||
        element.closest('[aria-hidden="true"]') ||
        element.matches(":disabled") ||
        element.getAttribute("aria-disabled") === "true",
      );
    const visibleDialogs = [
      ...document.querySelectorAll('dialog[open], [role="dialog"]'),
    ].filter((dialog) => visible(dialog) && !hiddenFromInteraction(dialog));
    const modalDialogs = visibleDialogs.filter((dialog) => {
      if (dialog.getAttribute("aria-modal") === "true") return true;
      if (dialog instanceof HTMLDialogElement && dialog.open) {
        try {
          return dialog.matches(":modal");
        } catch {
          return true;
        }
      }
      return false;
    });
    const activeDialog = modalDialogs
      .map((dialog, order) => ({
        dialog,
        order,
        zIndex: Number.parseInt(getComputedStyle(dialog).zIndex, 10) || 0,
      }))
      .sort((left, right) =>
        left.zIndex === right.zIndex
          ? left.order - right.order
          : left.zIndex - right.zIndex,
      )
      .at(-1)?.dialog;
    const visibleControls = [...document.querySelectorAll(selector)].filter(
      visible,
    );
    const controls = visibleControls.filter(
      (element) =>
        !hiddenFromInteraction(element) &&
        (!activeDialog || activeDialog.contains(element)),
    );
    const active = document.activeElement;
    const focusEscapedDialog = Boolean(
      activeDialog && active && !activeDialog.contains(active),
    );
    const undersizedTargets = controls
      .map((element) => {
        const associatedLabel = "labels" in element ? element.labels?.[0] : null;
        const enclosingLabel = associatedLabel?.contains(element)
          ? associatedLabel
          : element.closest("label");
        const controlRect = element.getBoundingClientRect();
        const labelRect = enclosingLabel?.getBoundingClientRect();
        const rect =
          labelRect && labelRect.width > 0 && labelRect.height > 0
            ? labelRect
            : controlRect;
        return {
          label: (
            element.getAttribute("aria-label") ||
            element.textContent ||
            element.getAttribute("name") ||
            element.tagName
          )
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 80),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((target) => target.width < 44 || target.height < 44)
      .slice(0, 16);

    const describe = (element) =>
      (
        element?.getAttribute?.("aria-label") ||
        element?.textContent ||
        element?.tagName ||
        "unknown element"
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 80);
    const samplePoints = (element) => {
      const rect = element.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const right = Math.min(innerWidth, rect.right);
      const top = Math.max(0, rect.top);
      const bottom = Math.min(innerHeight, rect.bottom);
      if (right <= left || bottom <= top) return [];
      const insetX = Math.min(6, Math.max(1, (right - left) / 4));
      const insetY = Math.min(6, Math.max(1, (bottom - top) / 4));
      const xs = [left + insetX, (left + right) / 2, right - insetX];
      const ys = [top + insetY, (top + bottom) / 2, bottom - insetY];
      return xs.flatMap((x) =>
        ys.map((y) => ({
          x: Math.min(innerWidth - 1, Math.max(0, x)),
          y: Math.min(innerHeight - 1, Math.max(0, y)),
        })),
      );
    };
    const hitActivates = (element, hit) => {
      if (!hit) return false;
      if (hit === element || element.contains(hit)) return true;
      const label = hit.closest("label");
      if (label?.control === element) return true;
      const enclosingLabel = element.closest("label");
      return Boolean(enclosingLabel && enclosingLabel.contains(hit));
    };
    const probe = (element) => {
      const samples = samplePoints(element).map((point) => ({
        ...point,
        hit: document.elementFromPoint(point.x, point.y),
      }));
      return {
        reachable: samples.some(({ hit }) => hitActivates(element, hit)),
        blocker:
          samples
            .map(({ hit }) => hit)
            .find((hit) => hit && !hitActivates(element, hit)) ?? null,
      };
    };
    const nextPaint = () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const scrollContainers = (element) => {
      const containers = [];
      for (
        let ancestor = element.parentElement;
        ancestor && ancestor !== document.documentElement;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        const scrollable = /(auto|scroll|overlay)/.test(
          `${style.overflow} ${style.overflowX} ${style.overflowY}`,
        );
        if (
          scrollable &&
          (ancestor.scrollHeight > ancestor.clientHeight ||
            ancestor.scrollWidth > ancestor.clientWidth)
        ) {
          containers.push({
            element: ancestor,
            left: ancestor.scrollLeft,
            top: ancestor.scrollTop,
          });
        }
      }
      return containers;
    };
    const recheckReachability = async (element, initial) => {
      const windowScroll = { left: scrollX, top: scrollY };
      const containers = scrollContainers(element);
      element.scrollIntoView({ block: "center", inline: "center" });
      await nextPaint();
      await nextPaint();
      const recheck = probe(element);
      for (const container of containers) {
        container.element.scrollTo(container.left, container.top);
      }
      scrollTo(windowScroll.left, windowScroll.top);
      await nextPaint();
      return {
        ...recheck,
        initialBlocker: initial.blocker,
        recheckedAfterScroll: true,
      };
    };
    const interceptedTargets = [];
    let recheckedTargetCount = 0;
    for (const element of controls) {
      const initial = probe(element);
      if (initial.reachable) continue;
      recheckedTargetCount += 1;
      const reachability = await recheckReachability(element, initial);
      if (reachability.reachable) continue;
      interceptedTargets.push({
        target: describe(element),
        blocker: describe(reachability.blocker ?? reachability.initialBlocker),
        recheckedAfterScroll: reachability.recheckedAfterScroll,
      });
      if (interceptedTargets.length >= 12) break;
    }
    return {
      focusAfterTab: {
        tag: active?.tagName?.toLowerCase() ?? null,
        label:
          active?.getAttribute?.("aria-label") ??
          active?.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ??
          null,
      },
      focusEscapedDialog,
      focusableCount: controls.length,
      activeDialog: activeDialog ? describe(activeDialog) : null,
      suppressedControlCount: visibleControls.length - controls.length,
      recheckedTargetCount,
      undersizedTargets,
      interceptedTargets,
    };
  });
  await page.keyboard.press("Shift+Tab").catch(() => {});
  return { before, ...result };
}

async function login(page, user) {
  await page.goto(`${baseUrl}/login?redirect=%2F&audit=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  const submit = page.getByRole("button", { name: /^sign in$/i });
  await submit.waitFor({ state: "visible", timeout: 10_000 });
  await page.fill("#email", user.email);
  await page.fill("#password", sharedUatPassword);
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

async function openPersonaPageFrom(page, email) {
  const browser = page.context().browser();
  if (!browser) throw new Error("The audit browser is unavailable.");
  const sourceViewport = page.viewportSize();
  const emulateTouch = Boolean(sourceViewport && sourceViewport.width < 768);
  const context = await browser.newContext({
    viewport: sourceViewport,
    isMobile: emulateTouch,
    hasTouch: emulateTouch,
  });
  await installScopedProtectionBypass({
    context,
    appOrigin,
    protectionBypass,
  });
  const personaPage = await context.newPage();
  const loginResult = await login(personaPage, { email });
  if (loginResult.status !== "signed-in") {
    await context.close();
    throw new Error(`Unable to sign in the ${email} control actor.`);
  }
  return { context, page: personaPage };
}

async function auditRoute(page, route) {
  await page.goto(`${baseUrl}${route.path}?auditRoute=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await waitForRouteExpectation(page, route.text);
  const audit = await pageAudit(page);
  const routeClass = classify(audit.text, page.url());
  const expectedClass =
    route.expectedAccess === "denied" ? "access-denied" : "rendered";
  const finalPathMet = finalPathMatches(route.path, page.url());
  const recordExpectationMet = route.recordText
    ? route.recordText.test(audit.text)
    : true;
  const expectationMet =
    routeClass === expectedClass &&
    finalPathMet &&
    recordExpectationMet &&
    (route.text ? route.text.test(audit.text) : true);
  return {
    route: route.path,
    finalUrl: page.url().replace(baseUrl, ""),
    class: routeClass,
    expectedAccess: route.expectedAccess,
    expectationMet,
    finalPathMet,
    recordExpectationMet,
    h1: audit.h1,
    mainCount: audit.mainCount,
    controls: audit.visibleControls,
    overflow: audit.horizontalOverflow,
    scrollWidth: audit.scrollWidth,
    viewportWidth: audit.viewportWidth,
    overflowOffenders: audit.overflowOffenders,
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
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith("/procurement/requests/") &&
      !url.pathname.endsWith("/new"),
    { timeout: 15_000 },
  );
  await page
    .getByRole("heading", { name: title, exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
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
  if (vendorDeliveryConfigurationError)
    throw new Error(vendorDeliveryConfigurationError);
  const unique = Date.now();
  const companyName = `${marker} Vendor`;
  const vendorEmail = vendorAuditEmail(marker);
  await page.goto(`${baseUrl}/legal/invites/new?workflow=${unique}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByLabel("Company name").fill(companyName);
  await page.getByLabel("Vendor contact email").fill(vendorEmail);
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
    .select("id,status,delivery_error,auth_user_id,expires_at,link_generation")
    .eq("company_name", companyName);
  if (deliveryError) throw new Error(deliveryError.message);
  const deliveryStatus = deliveryRows?.[0]?.status;
  if (!["sent", "delivery_failed"].includes(deliveryStatus))
    throw new Error(
      `Unexpected vendor invite delivery status: ${deliveryStatus}`,
    );
  if (requireVendorDelivery && deliveryStatus !== "sent") {
    throw new Error(
      `Vendor invitation delivery certification failed: ${deliveryRows?.[0]?.delivery_error ?? deliveryStatus}.`,
    );
  }
  if (
    deliveryStatus === "sent" &&
    (!deliveryRows?.[0]?.auth_user_id ||
      !deliveryRows?.[0]?.expires_at ||
      Number(deliveryRows?.[0]?.link_generation ?? 0) < 1)
  ) {
    throw new Error(
      "Delivered vendor invitation is missing Auth identity, expiry, or generation evidence.",
    );
  }
  let acceptanceCheckpoint = null;
  let replayStatus = null;
  let acceptanceEvidenceScreenshot = null;
  let acceptanceUsedAuditToken = false;
  if (deliveryStatus === "sent") {
    const invite = deliveryRows[0];
    const authUserId = invite.auth_user_id;
    const generation = Number(invite.link_generation);
    const auditAcceptanceToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const tokenDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(auditAcceptanceToken),
    );
    const tokenHash = Array.from(new Uint8Array(tokenDigest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const { error: tokenOverrideError } = await db
      .schema("legal")
      .from("vendor_invites")
      .update({ acceptance_token_hash: tokenHash })
      .eq("id", invite.id)
      .eq("link_generation", generation)
      .eq("status", "sent");
    if (tokenOverrideError) throw new Error(tokenOverrideError.message);
    acceptanceUsedAuditToken = true;
    const [profileAccessBefore, roleAccessBefore] = await Promise.all([
      db
        .schema("core")
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("id", authUserId)
        .eq("status", "active"),
      db
        .schema("core")
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", authUserId)
        .eq("module", "core")
        .eq("role", "vendor_portal"),
    ]);
    if (profileAccessBefore.error) {
      throw new Error(profileAccessBefore.error.message);
    }
    if (roleAccessBefore.error) throw new Error(roleAccessBefore.error.message);
    const profileBefore = profileAccessBefore.count;
    const roleBefore = roleAccessBefore.count;
    if ((profileBefore ?? 0) !== 0 || (roleBefore ?? 0) !== 0) {
      throw new Error("Vendor access was active before invitation acceptance.");
    }

    const { error: passwordError } = await db.auth.admin.updateUserById(
      authUserId,
      { password: sharedUatPassword, email_confirm: true },
    );
    if (passwordError) throw new Error(passwordError.message);

    const { context, page: vendorPage } = await openPersonaPageFrom(
      page,
      vendorEmail,
    );
    try {
      const acceptanceQuery = new URLSearchParams({
        invite_id: invite.id,
        generation: String(generation),
        acceptance_token: auditAcceptanceToken,
      });
      await vendorPage.goto(`${baseUrl}/vendor?${acceptanceQuery}`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await vendorPage
        .getByText("Vendor portal", { exact: true })
        .waitFor({ state: "visible", timeout: 25_000 });
      const vendorLayout = await pageAudit(vendorPage);
      const vendorAccessibility = await new AxeBuilder({ page: vendorPage })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const seriousVendorAccessibility = vendorAccessibility.violations.filter(
        (violation) => ["critical", "serious"].includes(violation.impact),
      );
      if (
        vendorLayout.horizontalOverflow ||
        vendorLayout.overlaps.length ||
        vendorLayout.deadLinks.length ||
        vendorLayout.unlabeledControls.length ||
        seriousVendorAccessibility.length
      ) {
        throw new Error(
          `Accepted vendor portal failed its visual/accessibility audit: ${JSON.stringify(
            {
              overflow: vendorLayout.horizontalOverflow,
              overlaps: vendorLayout.overlaps.length,
              deadLinks: vendorLayout.deadLinks.length,
              unlabeledControls: vendorLayout.unlabeledControls.length,
              seriousAccessibility: seriousVendorAccessibility.map(
                (violation) => violation.id,
              ),
            },
          )}`,
        );
      }
      const acceptanceEvidencePath = path.join(
        auditEvidenceDir,
        `${marker.toLowerCase()}-vendor-acceptance.jpg`,
      );
      await mkdir(auditEvidenceDir, { recursive: true });
      await vendorPage.screenshot({
        path: acceptanceEvidencePath,
        type: "jpeg",
        quality: 72,
        fullPage: true,
      });
      acceptanceEvidenceScreenshot = path
        .relative(process.cwd(), acceptanceEvidencePath)
        .replaceAll("\\", "/");
      acceptanceCheckpoint = await verifyCheckpoint({
        schema: "legal",
        table: "vendor_invites",
        filters: { id: invite.id },
        expected: {
          status: "accepted",
          accepted_generation: generation,
          auth_user_id: authUserId,
        },
        select:
          "id,status,accepted_generation,auth_user_id,accepted_at,acceptance_nonce",
      });
      await verifyCheckpoint({
        schema: "core",
        table: "profiles",
        filters: { id: authUserId },
        expected: { kind: "vendor", status: "active" },
        select: "id,email,kind,vendor_id,status",
      });
      await verifyCheckpoint({
        schema: "core",
        table: "user_roles",
        filters: {
          user_id: authUserId,
          module: "core",
          role: "vendor_portal",
        },
        expected: { role: "vendor_portal" },
        select: "user_id,module,role",
      });
      const replay = await vendorPage.evaluate(
        async ({ inviteId, expectedGeneration, acceptanceToken }) => {
          const response = await fetch("/api/legal/vendor-invites", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "accept",
              invite_id: inviteId,
              expected_generation: expectedGeneration,
              acceptance_token: acceptanceToken,
            }),
          });
          return { status: response.status, body: await response.text() };
        },
        {
          inviteId: invite.id,
          expectedGeneration: generation,
          acceptanceToken: auditAcceptanceToken,
        },
      );
      replayStatus = replay.status;
      if (
        replay.status !== 409 ||
        !/already been used|replayed/i.test(replay.body)
      ) {
        throw new Error(
          `Accepted invitation replay was not rejected (${replay.status}: ${replay.body}).`,
        );
      }
    } finally {
      await context.close();
    }
  }
  return {
    name: "legal vendor invite",
    ok: audit.text.includes(companyName) && /\/legal\/cases\//.test(page.url()),
    finalUrl: page.url().replace(baseUrl, ""),
    text: audit.text.slice(0, 260),
    checkpoint,
    inviteCheckpoint,
    deliveryStatus,
    acceptanceCheckpoint,
    replayStatus,
    acceptanceEvidenceScreenshot,
    acceptanceUsedAuditToken,
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
  await page
    .getByText(code, { exact: true })
    .first()
    .waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  await page
    .getByText(code, { exact: true })
    .first()
    .waitFor({ state: "visible" });
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

async function warehouseCreateLocationWorkflow(page, marker) {
  const locationId = marker;
  const locationName = `${marker} Warehouse`;
  await page.goto(`${baseUrl}/warehouse/locations?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add location" });
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.getByRole("alert").waitFor({ state: "visible" });
  await dialog.getByLabel("Name").fill(locationName);
  await dialog.getByLabel("ID (optional)").fill(locationId);
  await dialog.getByLabel("Type").selectOption("warehouse");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByText(locationName, { exact: true })
    .waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  await page
    .getByText(locationName, { exact: true })
    .waitFor({ state: "visible" });
  const checkpoint = await verifyCheckpoint({
    schema: "warehouse",
    table: "locations",
    filters: { id: locationId },
    expected: { name: locationName, type: "warehouse" },
    select: "id,name,type",
  });
  return {
    name: "warehouse location creation",
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
  const createEvent = page.getByRole("button", {
    name: "Create event",
    exact: true,
  });
  await createEvent.click();
  await page.getByText("Event name is required.").waitFor({ state: "visible" });
  await page.getByLabel("Event name").fill(eventName);
  await page.getByLabel("Start date").fill("2026-07-14");
  await page.getByLabel("End date").fill("2026-07-13");
  await createEvent.click();
  await page
    .getByText("End date cannot be before the start date.")
    .waitFor({ state: "visible" });
  await page.getByLabel("End date").fill("2026-07-15");
  await createEvent.click();
  await page
    .getByText(eventName, { exact: true })
    .waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  await page
    .getByText(eventName, { exact: true })
    .waitFor({ state: "visible" });
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

async function adminCreateDoaWorkflow(page, marker, { captureState }) {
  const department = `${marker} Department`;
  const version = `${marker}-V1`;
  await page.goto(`${baseUrl}/admin/doa?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  const saveDraft = page.getByRole("button", {
    name: "Save draft",
    exact: true,
  });
  const clickSaveDraft = async () => {
    const mobileNavigation = page.getByRole("navigation", {
      name: "Primary mobile",
    });
    if (await mobileNavigation.count()) {
      await saveDraft.waitFor({ state: "visible" });
      const [actionBox, navigationBox] = await Promise.all([
        saveDraft.boundingBox(),
        mobileNavigation.boundingBox(),
      ]);
      if (
        actionBox &&
        navigationBox &&
        actionBox.y + actionBox.height > navigationBox.y - 2
      ) {
        throw new Error(
          "Save draft remains obstructed by the primary mobile navigation.",
        );
      }
      const ownsHitTarget = await saveDraft.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hitTarget === button || button.contains(hitTarget);
      });
      if (!ownsHitTarget) {
        throw new Error(
          "Save draft does not own its center mobile hit target.",
        );
      }
      if (!actionBox) {
        throw new Error("Save draft has no measurable mobile hit target.");
      }
      await page.touchscreen.tap(
        actionBox.x + actionBox.width / 2,
        actionBox.y + actionBox.height / 2,
      );
      return;
    } else {
      await saveDraft.scrollIntoViewIfNeeded();
    }
    await saveDraft.click();
  };
  await clickSaveDraft();
  await page.getByText("Department and version are required.").waitFor({
    state: "visible",
  });
  await captureState("DOA required-field validation");
  await page.getByLabel("Department", { exact: true }).fill(department);
  await page.getByLabel("Version", { exact: true }).fill(version);
  await page
    .getByLabel("Source document", { exact: true })
    .fill(`${marker} controlled test`);
  await page.getByLabel("Effective date", { exact: true }).fill("2026-07-14");
  await page.getByLabel("Tier 1 minimum").fill("0");
  await page.getByLabel("Tier 1 maximum").fill("1000");
  const approvers = page.getByLabel(/Tier \d+ named approver/);
  for (let index = 0; index < (await approvers.count()); index += 1)
    await page
      .getByLabel(`Tier ${index + 1} named approver`)
      .selectOption({ index: 1 });
  await clickSaveDraft();
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
  await page
    .getByText(`${department} DOA activated.`)
    .waitFor({ state: "visible" });
  await captureState("DOA activation success");
  await page.waitForFunction(() => {
    const visibleSaveButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => {
      const rect = button.getBoundingClientRect();
      return (
        button.textContent?.trim() === "Save draft" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    return (
      visibleSaveButton instanceof HTMLButtonElement &&
      !visibleSaveButton.disabled
    );
  });
  await page.waitForTimeout(200);
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
    const findAccessToken = (value, seen = new Set()) => {
      if (typeof value === "string")
        return value.split(".").length === 3 ? value : null;
      if (!value || typeof value !== "object" || seen.has(value)) return null;
      seen.add(value);
      if (typeof value.access_token === "string") return value.access_token;
      for (const nested of Array.isArray(value)
        ? value
        : Object.values(value)) {
        const token = findAccessToken(nested, seen);
        if (token) return token;
      }
      return null;
    };
    const parseStoredSession = (raw) => {
      if (!raw) return null;
      try {
        let decoded = decodeURIComponent(raw);
        if (decoded.startsWith("base64-")) {
          const encoded = decoded
            .slice("base64-".length)
            .replaceAll("-", "+")
            .replaceAll("_", "/");
          const padded = encoded.padEnd(
            encoded.length + ((4 - (encoded.length % 4)) % 4),
            "=",
          );
          decoded = new TextDecoder().decode(
            Uint8Array.from(atob(padded), (character) =>
              character.charCodeAt(0),
            ),
          );
        }
        return findAccessToken(JSON.parse(decoded));
      } catch {
        return null;
      }
    };
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const token = parseStoredSession(localStorage.getItem(key));
      if (token) return token;
    }
    const cookieChunks = new Map();
    for (const pair of document.cookie.split("; ").filter(Boolean)) {
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      const name = pair.slice(0, separator);
      if (!name.startsWith("sb-") || !name.includes("-auth-token")) continue;
      const baseName = name.replace(/\.\d+$/, "");
      const suffix = Number(name.match(/\.(\d+)$/)?.[1] ?? 0);
      const chunks = cookieChunks.get(baseName) ?? [];
      chunks.push({ suffix, value: pair.slice(separator + 1) });
      cookieChunks.set(baseName, chunks);
    }
    for (const chunks of cookieChunks.values()) {
      const token = parseStoredSession(
        chunks
          .sort((left, right) => left.suffix - right.suffix)
          .map((chunk) => chunk.value)
          .join(""),
      );
      if (token) return token;
    }
    return null;
  });
}

async function callRpcAsBrowserUser(
  page,
  schema,
  fn,
  payload,
  { wrapPayload = true } = {},
) {
  const accessToken = await browserAccessToken(page);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!accessToken || !anonKey || !supabaseUrl)
    throw new Error(
      "Authenticated browser session and public Supabase configuration are required.",
    );
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "accept-profile": schema,
      "content-profile": schema,
    },
    body: JSON.stringify(wrapPayload ? { payload } : payload),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
}

async function callRestAsBrowserUser(
  page,
  schema,
  table,
  { method = "POST", body },
) {
  const accessToken = await browserAccessToken(page);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!accessToken || !anonKey || !supabaseUrl) {
    throw new Error(
      "Authenticated browser session and public Supabase configuration are required.",
    );
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method,
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "accept-profile": schema,
      "content-profile": schema,
      prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
}

function requireRpcFailure(result, pattern, contract) {
  if (result.ok || !pattern.test(result.body))
    throw new Error(
      `${contract} was not enforced (${result.status}: ${result.body}).`,
    );
}

async function insertAuditRows(client, schema, table, rows) {
  const { data, error } = await client
    .schema(schema)
    .from(table)
    .insert(rows)
    .select();
  if (error)
    throw new Error(
      `${schema}.${table} fixture insert failed: ${error.message}`,
    );
  return data;
}

async function createTask3ReceiptFixture(marker, registerTask3Cleanup) {
  const client = createAuditDatabaseClient();
  const { data: locations, error: locationError } = await client
    .schema("warehouse")
    .from("locations")
    .select("id")
    .eq("id", marker)
    .eq("type", "warehouse")
    .limit(1);
  if (locationError || !locations?.[0])
    throw new Error(
      `The run-scoped Warehouse location ${marker} is required for Task 3 transactions.`,
    );
  const { data: officerProfiles, error: officerError } = await client
    .schema("core")
    .from("profiles")
    .select("id")
    .eq("email", "intra.test.procurement.lead@mwell.com.ph")
    .limit(1);
  if (officerError || !officerProfiles?.[0])
    throw new Error("Procurement Officer profile is required.");
  const { data: requesterProfiles, error: requesterError } = await client
    .schema("core")
    .from("profiles")
    .select("id")
    .eq("email", "intra.test.employee@mwell.com.ph")
    .limit(1);
  if (requesterError || !requesterProfiles?.[0])
    throw new Error("Procurement requester profile is required.");
  const { data: reviewerProfiles, error: reviewerError } = await client
    .schema("core")
    .from("profiles")
    .select("id")
    .eq("email", "intra.test.legal.lead@mwell.com.ph")
    .limit(1);
  if (reviewerError || !reviewerProfiles?.[0])
    throw new Error("Assigned technical reviewer profile is required.");
  const { data: approverProfiles, error: approverError } = await client
    .schema("core")
    .from("profiles")
    .select("id,full_name")
    .eq("email", "intra.test.operations.lead@mwell.com.ph")
    .limit(1);
  if (approverError || !approverProfiles?.[0])
    throw new Error("Procurement amendment approver profile is required.");
  const ids = {
    vendor: crypto.randomUUID(),
    product: `${marker}-product`,
    serializedIssueProduct: `${marker}-serialized-issue-product`,
    serializedIssueUnit: `${marker}-serialized-issue-unit`,
    serializedIssueSerial: `${marker}-SERIAL-HELD`,
    serializedIssueReceipt: `${marker}-serialized-issue-receipt`,
    request: `${marker}-receipt-request`,
    cleanPo: `${marker}-po-clean`,
    partialPo: `${marker}-po-partial`,
    exceptionPo: `${marker}-po-exception`,
    shortPo: `${marker}-po-short`,
    excessPo: `${marker}-po-excess`,
    unidentifiedPo: `${marker}-po-unidentified`,
    unidentifiedAcceptPo: `${marker}-po-unidentified-accept`,
    unidentifiedQuarantinePo: `${marker}-po-unidentified-quarantine`,
    qualityProbePo: `${marker}-po-quality-probe`,
    collisionPo: `${marker}-po-collision`,
    cleanLine: `${marker}-line-clean`,
    partialLine: `${marker}-line-partial`,
    concurrentLine: `${marker}-line-concurrent`,
    cancelledLine: `${marker}-line-cancelled`,
    exceptionLine: `${marker}-line-exception`,
    shortLine: `${marker}-line-short`,
    excessLine: `${marker}-line-excess`,
    unidentifiedLine: `${marker}-line-unidentified`,
    unidentifiedAcceptLine: `${marker}-line-unidentified-accept`,
    unidentifiedQuarantineLine: `${marker}-line-unidentified-quarantine`,
    qualityProbeLine: `${marker}-line-quality-probe`,
    collisionLine: `${marker}-line-collision`,
    routineQualityReceipt: `${marker}-routine-quality-receipt`,
    qualityRaceReceipt: `${marker}-quality-race-receipt`,
    event: `${marker}-event`,
    cycleCount: `${marker}-cycle-count`,
    selfCycleCount: `${marker}-self-cycle-count`,
    quarantineReceipt: null,
    policyRfq: `${marker}-policy-rfq`,
    policyDirect: `${marker}-policy-direct`,
    policyPetty: `${marker}-policy-petty`,
    policyImport: `${marker}-policy-import`,
    policyExpired: `${marker}-policy-expired`,
    expiredVendor: crypto.randomUUID(),
    accreditationCase: `${marker}-temporary-clearance-case`,
    activeApprovalRole: `task3_ref_${crypto.randomUUID().replaceAll("-", "")}`,
    inactiveApprovalRole: `task3_inactive_${crypto.randomUUID().replaceAll("-", "")}`,
    amendmentDoaMatrix: crypto.randomUUID(),
    amendmentDoaAssignments: [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ],
  };
  const { data: approvalGroup, error: approvalGroupError } = await client
    .schema("core")
    .from("approval_groups")
    .select("member_roles")
    .eq("entity_type", "warehouse_stock_change")
    .eq("group_code", "logistics_supervisor")
    .single();
  if (approvalGroupError || !approvalGroup)
    throw new Error(
      `Warehouse Supervisor approval group is required: ${approvalGroupError?.message ?? "missing"}`,
    );
  const fixture = {
    marker,
    client,
    ids,
    locationId: locations[0].id,
    cycleRequestId: null,
    requesterId: requesterProfiles[0].id,
    reviewerId: reviewerProfiles[0].id,
    approverName: approverProfiles[0].full_name,
    poIds: [
      ids.cleanPo,
      ids.partialPo,
      ids.exceptionPo,
      ids.shortPo,
      ids.excessPo,
      ids.unidentifiedPo,
      ids.unidentifiedAcceptPo,
      ids.unidentifiedQuarantinePo,
      ids.qualityProbePo,
      ids.collisionPo,
    ],
    approvalGroupOriginalRoles: approvalGroup.member_roles ?? [],
    cleanupActivityEntityIds: [],
    cleanupExceptionIds: [],
    cleanupDecisionIds: [],
    cleanupStockRequestIds: [],
    cleanupHoldIds: [],
    receiptExceptionScenarios: [],
  };
  registerTask3Cleanup(fixture);
  await insertAuditRows(client, "core", "roles", [
    {
      module: "warehouse",
      role: ids.activeApprovalRole,
      label: `${marker} referenced approval role`,
      is_active: true,
    },
    {
      module: "warehouse",
      role: ids.inactiveApprovalRole,
      label: `${marker} inactive approval role`,
      is_active: false,
    },
  ]);
  await insertAuditRows(client, "core", "role_capabilities", [
    {
      module: "warehouse",
      role: ids.activeApprovalRole,
      cap: "approve_stock_adjustment",
    },
    {
      module: "warehouse",
      role: ids.inactiveApprovalRole,
      cap: "approve_stock_adjustment",
    },
  ]);
  await insertAuditRows(client, "core", "user_roles", [
    {
      user_id: officerProfiles[0].id,
      module: "warehouse",
      role: ids.inactiveApprovalRole,
    },
  ]);
  const { error: groupUpdateError } = await client
    .schema("core")
    .from("approval_groups")
    .update({
      member_roles: [
        ...new Set([
          ...fixture.approvalGroupOriginalRoles,
          ids.activeApprovalRole,
          ids.inactiveApprovalRole,
        ]),
      ],
    })
    .eq("entity_type", "warehouse_stock_change")
    .eq("group_code", "logistics_supervisor");
  if (groupUpdateError)
    throw new Error(
      `Approval-group role fixture failed: ${groupUpdateError.message}`,
    );
  await insertAuditRows(client, "core", "vendors", [
    {
      id: ids.vendor,
      legal_name: `${marker} Receipt Vendor`,
      category: "goods",
      accreditation_status: "approved",
      owner_module: "legal",
    },
    {
      id: ids.expiredVendor,
      legal_name: `${marker} Expired Vendor`,
      category: "goods",
      accreditation_status: "expired",
      accreditation_expires_at: "2026-01-01",
      owner_module: "legal",
    },
  ]);
  await insertAuditRows(client, "warehouse", "products", [
    {
      id: ids.product,
      sku: `${marker}-SKU`,
      name: `${marker} Receipt Product`,
      category: "qa",
      item_class: "merchandise",
      serialization_policy: "none",
      serialized: false,
      unit_cost: 100,
      reorder_point: 0,
    },
    {
      id: ids.serializedIssueProduct,
      sku: `${marker}-SERIAL-SKU`,
      name: `${marker} Held Serial Product`,
      category: "qa",
      item_class: "sellable_sku",
      serialization_policy: "required",
      serialized: true,
      unit_cost: 150,
      reorder_point: 0,
    },
  ]);
  await insertAuditRows(client, "procurement", "requests", [
    {
      id: ids.request,
      title: `${marker} Receipt authority request`,
      status: "approved",
      requester_id: requesterProfiles[0].id,
      department: `${marker} Receipt Department`,
      category: "goods",
      sourcing_method: "rfq",
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      estimated_amount: 500,
    },
    ...[
      [ids.policyRfq, "rfq", {}],
      [ids.policyDirect, "direct_award", {}],
      [ids.policyPetty, "petty_cash", {}],
      [ids.policyImport, "rfp", { importation: true }],
      [ids.policyExpired, "rfq", {}],
    ].map(([id, method, compliance]) => ({
      id,
      title: `${marker} ${method} negative`,
      status: "draft",
      requester_id: requesterProfiles[0].id,
      category: "goods",
      sourcing_method: method,
      core_vendor_id: id === ids.policyExpired ? ids.expiredVendor : ids.vendor,
      vendor_name: `${marker} Policy Vendor`,
      estimated_amount: 500,
      compliance,
    })),
  ]);
  await insertAuditRows(
    client,
    "procurement",
    "acceptance_reviewer_assignments",
    [
      {
        request_id: ids.request,
        reviewer_id: reviewerProfiles[0].id,
        assigned_by: officerProfiles[0].id,
      },
    ],
  );
  await insertAuditRows(client, "procurement", "doa_matrices", [
    {
      id: ids.amendmentDoaMatrix,
      version: `${marker}-AMENDMENT-DOA-V1`,
      department: `${marker} Receipt Department`,
      source_document: `${marker} controlled amendment DOA`,
      approved_by_name: "Task 3 governed fixture",
      approved_at: new Date().toISOString(),
      effective_at: "2026-07-14T00:00:00.000Z",
      active: true,
      status: "active",
    },
  ]);
  await insertAuditRows(
    client,
    "procurement",
    "doa_assignments",
    ["dept_head", "procurement_head", "final_approver"].map((tier, index) => ({
      id: ids.amendmentDoaAssignments[index],
      matrix_id: ids.amendmentDoaMatrix,
      department: `${marker} Receipt Department`,
      category: "goods",
      min_amount: 0,
      max_amount: 100000,
      tier,
      approver_user_id: approverProfiles[0].id,
      active: true,
    })),
  );
  await insertAuditRows(client, "warehouse", "events", [
    {
      id: ids.event,
      name: `${marker} Hold ATP event`,
      type: "qa",
      site_location_id: locations[0].id,
      start_date: "2026-07-15",
    },
  ]);
  const routeRows = await insertAuditRows(
    client,
    "procurement",
    "route_decisions",
    [
      ids.policyRfq,
      ids.policyDirect,
      ids.policyPetty,
      ids.policyImport,
      ids.policyExpired,
    ].map((requestId) => ({
      request_id: requestId,
      policy_version: "task3-live",
      request_version: 1,
      method:
        requestId === ids.policyDirect
          ? "direct_award"
          : requestId === ids.policyPetty
            ? "petty_cash"
            : requestId === ids.policyImport
              ? "rfp"
              : "rfq",
      reasons: ["task3-live-negative"],
      risk_facts: requestId === ids.policyImport ? { importation: true } : {},
      status: "confirmed",
      confirmed_by: officerProfiles[0].id,
    })),
  );
  await insertAuditRows(client, "procurement", "exception_packs", [
    {
      request_id: ids.policyDirect,
      exception_type: "direct_award",
      vendor_id: ids.vendor,
      route_decision_id: routeRows.find(
        (row) => row.request_id === ids.policyDirect,
      ).id,
      route_method: "direct_award",
      request_version: 1,
      justification: `${marker} incomplete direct award`,
      evidence: {},
      status: "approved",
    },
    {
      request_id: ids.policyPetty,
      exception_type: "petty_cash_non_accredited",
      vendor_id: ids.vendor,
      route_decision_id: routeRows.find(
        (row) => row.request_id === ids.policyPetty,
      ).id,
      route_method: "petty_cash",
      request_version: 1,
      justification: `${marker} split petty cash`,
      evidence: {},
      finance_eligibility_confirmed: false,
      non_recurring_non_split_attested: false,
      status: "approved",
    },
  ]);
  await insertAuditRows(client, "legal", "accreditation_cases", [
    {
      id: ids.accreditationCase,
      vendor_id: ids.expiredVendor,
      vendor_name: `${marker} Expired Vendor`,
      status: "provisional",
      category: "goods",
      jurisdiction: "PH",
      entity_type: "corporation",
    },
  ]);
  await insertAuditRows(client, "legal", "accreditation_dispositions", [
    {
      case_id: ids.accreditationCase,
      requirement_code: "TEMP_CLEARANCE",
      disposition: "temporary_clearance",
      reason: `${marker} unapproved clearance probe`,
      conditions: { approved: false, valid_until: "2027-01-01T00:00:00Z" },
      decided_by: officerProfiles[0].id,
    },
  ]);
  await insertAuditRows(client, "procurement", "purchase_orders", [
    {
      id: ids.cleanPo,
      po_number: `${marker}-PO-CLEAN`,
      request_id: ids.request,
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      status: "issued",
      total: 100,
    },
    {
      id: ids.partialPo,
      po_number: `${marker}-PO-PARTIAL`,
      request_id: ids.request,
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      status: "issued",
      total: 400,
    },
    {
      id: ids.exceptionPo,
      po_number: `${marker}-PO-EXCEPTION`,
      request_id: ids.request,
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      status: "issued",
      total: 100,
    },
    {
      id: ids.shortPo,
      po_number: `${marker}-PO-SHORT`,
      request_id: ids.request,
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      status: "issued",
      total: 300,
    },
    {
      id: ids.excessPo,
      po_number: `${marker}-PO-EXCESS`,
      request_id: ids.request,
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      status: "issued",
      total: 100,
    },
    {
      id: ids.unidentifiedPo,
      po_number: `${marker}-PO-UNIDENTIFIED`,
      request_id: ids.request,
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      status: "issued",
      total: 100,
    },
    {
      id: ids.unidentifiedAcceptPo,
      po_number: `${marker}-PO-UNIDENTIFIED-ACCEPT`,
      request_id: ids.request,
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      status: "issued",
      total: 100,
    },
    {
      id: ids.unidentifiedQuarantinePo,
      po_number: `${marker}-PO-UNIDENTIFIED-QUARANTINE`,
      request_id: ids.request,
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      status: "issued",
      total: 100,
    },
    {
      id: ids.qualityProbePo,
      po_number: `${marker}-PO-QUALITY-PROBE`,
      request_id: ids.request,
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      status: "issued",
      total: 100,
    },
    {
      id: ids.collisionPo,
      po_number: `${marker}-PO-COLLISION`,
      request_id: ids.request,
      core_vendor_id: ids.vendor,
      vendor_name: `${marker} Receipt Vendor`,
      status: "issued",
      total: 100,
    },
  ]);
  await insertAuditRows(
    client,
    "procurement",
    "purchase_order_lines",
    [
      {
        id: ids.cleanLine,
        purchase_order_id: ids.cleanPo,
        line_no: 1,
        description: `${marker} clean receipt`,
        quantity: 1,
        warehouse_product_id: ids.product,
      },
      {
        id: ids.partialLine,
        purchase_order_id: ids.partialPo,
        line_no: 1,
        description: `${marker} partial PO first receipt`,
        quantity: 1,
        warehouse_product_id: ids.product,
      },
      {
        id: ids.concurrentLine,
        purchase_order_id: ids.partialPo,
        line_no: 2,
        description: `${marker} concurrent balance`,
        quantity: 2,
        warehouse_product_id: ids.product,
      },
      {
        id: ids.cancelledLine,
        purchase_order_id: ids.partialPo,
        line_no: 3,
        description: `${marker} cancelled line`,
        quantity: 1,
        warehouse_product_id: ids.product,
        receiving_status: "cancelled",
      },
      {
        id: ids.exceptionLine,
        purchase_order_id: ids.exceptionPo,
        line_no: 1,
        description: `${marker} quarantine receipt`,
        quantity: 1,
        warehouse_product_id: ids.product,
      },
      {
        id: ids.shortLine,
        purchase_order_id: ids.shortPo,
        line_no: 1,
        description: `${marker} short receipt`,
        quantity: 3,
        warehouse_product_id: ids.product,
      },
      {
        id: ids.excessLine,
        purchase_order_id: ids.excessPo,
        line_no: 1,
        description: `${marker} excess receipt`,
        quantity: 1,
        warehouse_product_id: ids.product,
      },
      {
        id: ids.unidentifiedLine,
        purchase_order_id: ids.unidentifiedPo,
        line_no: 1,
        description: `${marker} unidentified receipt`,
        quantity: 1,
      },
      {
        id: ids.unidentifiedAcceptLine,
        purchase_order_id: ids.unidentifiedAcceptPo,
        line_no: 1,
        description: `${marker} unidentified accept receipt`,
        quantity: 1,
      },
      {
        id: ids.unidentifiedQuarantineLine,
        purchase_order_id: ids.unidentifiedQuarantinePo,
        line_no: 1,
        description: `${marker} unidentified quarantine receipt`,
        quantity: 1,
      },
      {
        id: ids.qualityProbeLine,
        purchase_order_id: ids.qualityProbePo,
        line_no: 1,
        description: `${marker} public quality wrapper receipt`,
        quantity: 1,
        warehouse_product_id: ids.product,
      },
      {
        id: ids.collisionLine,
        purchase_order_id: ids.collisionPo,
        line_no: 1,
        description: `${marker} same-line collision`,
        quantity: 1,
        warehouse_product_id: ids.product,
      },
    ].map((line) => ({ receiving_status: "open", ...line })),
  );
  return fixture;
}

async function task3OperatorReceiptTransactions(page, fixture) {
  const receive = (poId, lineId, quantity, suffix) =>
    callRpcAsBrowserUser(page, "warehouse", "receive_procurement_po", {
      idempotency_key: `${fixture.marker}-${suffix}`,
      po_id: poId,
      location_id: fixture.locationId,
      evidence_urls: [`audit/${fixture.marker}/${suffix}.jpg`],
      lines: [
        {
          line_id: lineId,
          product_id: fixture.ids.product,
          quantity,
          disposition: "accepted",
        },
      ],
    });
  const clean = await receive(
    fixture.ids.cleanPo,
    fixture.ids.cleanLine,
    1,
    "clean",
  );
  if (!clean.ok) throw new Error(`Clean receipt failed: ${clean.body}`);
  fixture.ids.cleanReceipt = JSON.parse(clean.body).receipt.id;
  const inventoryLedger = async () => {
    const { data: stockRows, error: stockError } = await fixture.client
      .schema("warehouse")
      .from("stock_levels")
      .select("quantity")
      .eq("product_id", fixture.ids.product)
      .eq("location_id", fixture.locationId);
    if (stockError)
      throw new Error(`Inventory readback failed: ${stockError.message}`);
    const { count: ledgerCount, error: ledgerError } = await fixture.client
      .schema("warehouse")
      .from("movements")
      .select("id", { count: "exact", head: true })
      .eq("product_id", fixture.ids.product);
    if (ledgerError)
      throw new Error(
        `Movement ledger readback failed: ${ledgerError.message}`,
      );
    return {
      inventory: (stockRows ?? []).reduce(
        (total, row) => total + Number(row.quantity ?? 0),
        0,
      ),
      ledger: ledgerCount ?? 0,
    };
  };
  const replayBefore = await inventoryLedger();
  const cleanReplay = await receive(
    fixture.ids.cleanPo,
    fixture.ids.cleanLine,
    1,
    "clean",
  );
  const replayAfter = await inventoryLedger();
  if (
    !cleanReplay.ok ||
    JSON.parse(cleanReplay.body).receipt.id !==
      JSON.parse(clean.body).receipt.id ||
    replayBefore.inventory !== replayAfter.inventory ||
    replayBefore.ledger !== replayAfter.ledger
  )
    throw new Error(
      "Idempotent receipt replay changed inventory or the movement ledger.",
    );
  const partial = await receive(
    fixture.ids.partialPo,
    fixture.ids.partialLine,
    1,
    "partial",
  );
  if (!partial.ok) throw new Error(`Partial receipt failed: ${partial.body}`);
  fixture.ids.partialReceipt = JSON.parse(partial.body).receipt.id;
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "v_purchase_order_receipt_status",
      filters: { purchase_order_id: fixture.ids.partialPo },
      expected: { accepted_quantity: 1, outstanding_quantity: 2 },
      select: "purchase_order_id,accepted_quantity,outstanding_quantity",
    },
    fixture.client,
  );

  requireRpcFailure(
    await receive(
      fixture.ids.partialPo,
      fixture.ids.cancelledLine,
      1,
      "cancelled",
    ),
    /cancelled or rejected/i,
    "cancelled-line receipt",
  );
  requireRpcFailure(
    await receive(
      fixture.ids.partialPo,
      fixture.ids.concurrentLine,
      3,
      "excess",
    ),
    /exceeds/i,
    "excess receipt",
  );
  const inventoryBefore = (await inventoryLedger()).inventory;
  const ledgerBefore = (await inventoryLedger()).ledger;
  const concurrent = await Promise.all([
    receive(
      fixture.ids.partialPo,
      fixture.ids.concurrentLine,
      2,
      "concurrent-a",
    ),
    receive(
      fixture.ids.partialPo,
      fixture.ids.concurrentLine,
      2,
      "concurrent-b",
    ),
  ]);
  if (concurrent.filter((result) => result.ok).length !== 1)
    throw new Error(
      `Atomic concurrent receipt expected one success: ${JSON.stringify(concurrent)}`,
    );
  fixture.ids.concurrentReceipt = JSON.parse(
    concurrent.find((result) => result.ok).body,
  ).receipt.id;
  const inventoryAfter = (await inventoryLedger()).inventory;
  const ledgerAfter = (await inventoryLedger()).ledger;
  if (
    inventoryAfter - inventoryBefore !== 2 ||
    ledgerAfter - ledgerBefore !== 1
  )
    throw new Error(
      `Concurrent receipt readback mismatch: inventory ${inventoryBefore}->${inventoryAfter}, ledger ${ledgerBefore}->${ledgerAfter}.`,
    );
  const exceptionFacts = [
    {
      key: "short-accept",
      exceptionClass: "short",
      outcome: "accept",
      poId: fixture.ids.shortPo,
      lineId: fixture.ids.shortLine,
      actualQuantity: 1,
      expectedQuantity: 3,
    },
    {
      key: "excess-quarantine",
      exceptionClass: "excess",
      outcome: "quarantine",
      poId: fixture.ids.excessPo,
      lineId: fixture.ids.excessLine,
      actualQuantity: 2,
      expectedQuantity: 1,
    },
    {
      key: "damaged-reject",
      exceptionClass: "damaged",
      outcome: "reject",
      poId: fixture.ids.exceptionPo,
      lineId: fixture.ids.exceptionLine,
      actualQuantity: 1,
      expectedQuantity: 1,
    },
    {
      key: "unidentified-escalate",
      exceptionClass: "unidentified",
      outcome: "escalate",
      poId: fixture.ids.unidentifiedPo,
      lineId: fixture.ids.unidentifiedLine,
      actualQuantity: 2,
      expectedQuantity: 1,
      rawDescription: `${fixture.marker} observed unlabelled carton`,
    },
    {
      key: "unidentified-accept",
      exceptionClass: "unidentified",
      outcome: "accept",
      poId: fixture.ids.unidentifiedAcceptPo,
      lineId: fixture.ids.unidentifiedAcceptLine,
      actualQuantity: 1,
      expectedQuantity: 1,
      rawDescription: `${fixture.marker} unidentified accept identification`,
    },
    {
      key: "unidentified-quarantine",
      exceptionClass: "unidentified",
      outcome: "quarantine",
      poId: fixture.ids.unidentifiedQuarantinePo,
      lineId: fixture.ids.unidentifiedQuarantineLine,
      actualQuantity: 1,
      expectedQuantity: 1,
      rawDescription: `${fixture.marker} unidentified quarantine identification`,
    },
  ];
  for (const scenario of exceptionFacts) {
    const exceptionBefore = await inventoryLedger();
    const exceptionReceipt = await callRpcAsBrowserUser(
      page,
      "warehouse",
      "receive_procurement_po_exception",
      {
        idempotency_key: `${fixture.marker}-receipt-exception-${scenario.key}`,
        po_id: scenario.poId,
        location_id: fixture.locationId,
        exception_type: scenario.exceptionClass,
        reason: `${fixture.marker} receipt exception ${scenario.exceptionClass}`,
        evidence_urls: [`audit/${fixture.marker}/${scenario.key}.jpg`],
        lines: [
          {
            line_id: scenario.lineId,
            ...(scenario.exceptionClass === "unidentified"
              ? {}
              : { product_id: fixture.ids.product }),
            actual_quantity: scenario.actualQuantity,
            expected_quantity: scenario.expectedQuantity,
            raw_description:
              scenario.rawDescription ??
              `${fixture.marker} ${scenario.exceptionClass}`,
          },
        ],
      },
    );
    if (!exceptionReceipt.ok)
      throw new Error(
        `Operator ${scenario.exceptionClass} receipt failed: ${exceptionReceipt.body}`,
      );
    const result = JSON.parse(exceptionReceipt.body);
    const tracked = {
      ...scenario,
      receiptId: result.receipt.id,
      decisionId: result.decision.id,
      exceptionId: result.exception.id,
      requestedBy: result.decision.requested_by,
    };
    fixture.receiptExceptionScenarios.push(tracked);
    fixture.cleanupDecisionIds.push(tracked.decisionId);
    fixture.cleanupExceptionIds.push(tracked.exceptionId);
    fixture.cleanupActivityEntityIds.push(scenario.poId);
    if (
      scenario.exceptionClass === "unidentified" &&
      scenario.actualQuantity > scenario.expectedQuantity
    ) {
      await verifyCheckpoint(
        {
          schema: "warehouse",
          table: "procurement_receipt_excess_custody",
          filters: { decision_id: tracked.decisionId },
          expected: {
            po_line_id: scenario.lineId,
            product_id: null,
            ordered_quantity: scenario.expectedQuantity,
            excess_quantity:
              scenario.actualQuantity - scenario.expectedQuantity,
            status: "pending",
          },
          select:
            "decision_id,po_line_id,product_id,ordered_quantity,excess_quantity,status",
        },
        fixture.client,
      );
      const { data: custodyIdentity, error: custodyIdentityError } =
        await fixture.client
          .schema("warehouse")
          .from("procurement_receipt_excess_custody")
          .select("id")
          .eq("decision_id", tracked.decisionId)
          .single();
      if (custodyIdentityError || !custodyIdentity)
        throw new Error(
          `Unidentified excess custody identity failed: ${custodyIdentityError?.message ?? "missing"}`,
        );
      tracked.excessCustodyId = custodyIdentity.id;
      // unidentified excess custody is established without mutating the PO-line product mapping.
    }
    const exceptionAfter = await inventoryLedger();
    if (
      exceptionBefore.inventory !== exceptionAfter.inventory ||
      exceptionBefore.ledger !== exceptionAfter.ledger
    )
      throw new Error(
        `${scenario.exceptionClass} receipt posted available stock or a receipt movement.`,
      );
  }

  const qualityProbeReceipt = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "receive_procurement_po_exception",
    {
      idempotency_key: `${fixture.marker}-public-quality-probe-intake`,
      po_id: fixture.ids.qualityProbePo,
      location_id: fixture.locationId,
      exception_type: "damaged",
      reason: `${fixture.marker} valid public quality inspection`,
      evidence_urls: [`audit/${fixture.marker}/public-quality-probe.jpg`],
      lines: [
        {
          line_id: fixture.ids.qualityProbeLine,
          product_id: fixture.ids.product,
          actual_quantity: 1,
          expected_quantity: 1,
        },
      ],
    },
  );
  if (!qualityProbeReceipt.ok)
    throw new Error(
      `Public quality probe intake failed: ${qualityProbeReceipt.body}`,
    );
  const qualityProbe = JSON.parse(qualityProbeReceipt.body);
  fixture.ids.qualityProbeReceipt = qualityProbe.receipt.id;
  fixture.ids.qualityProbeDecision = qualityProbe.decision.id;
  fixture.cleanupDecisionIds.push(qualityProbe.decision.id);
  fixture.cleanupExceptionIds.push(qualityProbe.exception.id);

  const routineQualityReceipt = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "receive_stock",
    {
      lots: [],
      units: [],
      stock_deltas: [],
      movements: [],
      receipt: {
        id: fixture.ids.routineQualityReceipt,
        supplier_id: `proc-${fixture.ids.vendor}`,
        location_id: fixture.locationId,
        lines: [{ productId: fixture.ids.product, quantity: 1 }],
        evidence_urls: [`audit/${fixture.marker}/routine-quality-receipt.jpg`],
        actor: "browser-role Warehouse Operator",
      },
    },
  );
  if (!routineQualityReceipt.ok)
    throw new Error(
      `Routine public quality receipt failed: ${routineQualityReceipt.body}`,
    );

  const qualityRaceReceipt = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "receive_stock",
    {
      lots: [],
      units: [],
      stock_deltas: [],
      movements: [],
      receipt: {
        id: fixture.ids.qualityRaceReceipt,
        supplier_id: `proc-${fixture.ids.vendor}`,
        location_id: fixture.locationId,
        lines: [{ productId: fixture.ids.product, quantity: 1 }],
        evidence_urls: [`audit/${fixture.marker}/quality-race-receipt.jpg`],
        actor: "browser-role Warehouse Operator",
      },
    },
  );
  if (!qualityRaceReceipt.ok)
    throw new Error(`Quality race receipt failed: ${qualityRaceReceipt.body}`);

  const serializedIssueReceipt = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "receive_stock",
    {
      lots: [],
      units: [
        {
          id: fixture.ids.serializedIssueUnit,
          product_id: fixture.ids.serializedIssueProduct,
          serial_number: fixture.ids.serializedIssueSerial,
          location_id: fixture.locationId,
          status: "in_stock",
        },
      ],
      stock_deltas: [],
      movements: [
        {
          id: `${fixture.marker}-serialized-receipt-movement`,
          type: "receipt",
          product_id: fixture.ids.serializedIssueProduct,
          quantity: 1,
          to_location_id: fixture.locationId,
          reference: fixture.ids.serializedIssueReceipt,
          evidence_urls: [`audit/${fixture.marker}/serialized-receipt.jpg`],
          actor: "browser-role Warehouse Operator",
          created_at: new Date().toISOString(),
        },
      ],
      receipt: {
        id: fixture.ids.serializedIssueReceipt,
        supplier_id: `proc-${fixture.ids.vendor}`,
        location_id: fixture.locationId,
        lines: [
          {
            productId: fixture.ids.serializedIssueProduct,
            quantity: 1,
            serialNumbers: [fixture.ids.serializedIssueSerial],
          },
        ],
        evidence_urls: [`audit/${fixture.marker}/serialized-receipt.jpg`],
        actor: "browser-role Warehouse Operator",
      },
    },
  );
  if (!serializedIssueReceipt.ok)
    throw new Error(
      `Serialized issue receipt failed: ${serializedIssueReceipt.body}`,
    );

  const collisionPayload = (suffix) => ({
    idempotency_key: `${fixture.marker}-same-line-${suffix}`,
    po_id: fixture.ids.collisionPo,
    location_id: fixture.locationId,
    exception_type: "damaged",
    reason: `${fixture.marker} same-line receipt decision collision`,
    evidence_urls: [`audit/${fixture.marker}/same-line-${suffix}.jpg`],
    lines: [
      {
        line_id: fixture.ids.collisionLine,
        product_id: fixture.ids.product,
        actual_quantity: 1,
        expected_quantity: 1,
      },
    ],
  });
  requireRpcFailure(
    await callRpcAsBrowserUser(
      page,
      "warehouse",
      "receive_procurement_po_exception",
      {
        ...collisionPayload("expected-drift"),
        lines: [
          {
            line_id: fixture.ids.collisionLine,
            product_id: fixture.ids.product,
            actual_quantity: 1,
            expected_quantity: 2,
          },
        ],
      },
    ),
    /expected quantity drift/i,
    "expected quantity drift",
  );
  const collisionBefore = await inventoryLedger();
  const collisionResults = await Promise.all([
    callRpcAsBrowserUser(
      page,
      "warehouse",
      "receive_procurement_po_exception",
      collisionPayload("a"),
    ),
    callRpcAsBrowserUser(
      page,
      "warehouse",
      "receive_procurement_po_exception",
      collisionPayload("b"),
    ),
  ]);
  if (collisionResults.filter((result) => result.ok).length !== 1)
    throw new Error(
      `same-line receipt decision collision expected one success: ${JSON.stringify(collisionResults)}`,
    );
  const collisionAfter = await inventoryLedger();
  if (
    collisionBefore.inventory !== collisionAfter.inventory ||
    collisionBefore.ledger !== collisionAfter.ledger
  )
    throw new Error(
      "same-line receipt decision collision posted stock before disposition.",
    );
  const collisionResult = JSON.parse(
    collisionResults.find((result) => result.ok).body,
  );
  const collisionScenario = {
    exceptionClass: "same-line-collision",
    outcome: "reject",
    poId: fixture.ids.collisionPo,
    lineId: fixture.ids.collisionLine,
    actualQuantity: 1,
    expectedQuantity: 1,
    receiptId: collisionResult.receipt.id,
    decisionId: collisionResult.decision.id,
    exceptionId: collisionResult.exception.id,
    requestedBy: collisionResult.decision.requested_by,
  };
  fixture.receiptExceptionScenarios.push(collisionScenario);
  fixture.cleanupDecisionIds.push(collisionScenario.decisionId);
  fixture.cleanupExceptionIds.push(collisionScenario.exceptionId);
  fixture.cleanupActivityEntityIds.push(collisionScenario.poId);

  const quarantineScenario = fixture.receiptExceptionScenarios.find(
    (scenario) => scenario.outcome === "quarantine",
  );
  fixture.ids.quarantineReceipt = quarantineScenario.receiptId;
  fixture.ids.quarantineDecision = quarantineScenario.decisionId;
  fixture.ids.quarantineException = quarantineScenario.exceptionId;
  fixture.ids.quarantineRequestedBy = quarantineScenario.requestedBy;
  fixture.ids.quarantineLine = quarantineScenario.lineId;
  fixture.ids.quarantinePo = quarantineScenario.poId;
  requireRpcFailure(
    await callRpcAsBrowserUser(
      page,
      "warehouse",
      "resolve_procurement_po_exception",
      {
        idempotency_key: `${fixture.marker}-operator-self-exception-denial`,
        decision_id: fixture.ids.quarantineDecision,
        decision: "quarantine",
        reason: "Operator cannot decide their own exception",
        evidence_urls: [`audit/${fixture.marker}/operator-self-denial.jpg`],
      },
    ),
    /not authorized|cannot approve their own exception|permission/i,
    "different Warehouse Supervisor receipt decision",
  );

  const cycleDraft = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "record_cycle_count",
    {
      cycle_count: {
        id: fixture.ids.cycleCount,
        location_id: fixture.locationId,
        category: "qa",
        lines: [{ productId: fixture.ids.product, counted: 5 }],
        actor: fixture.marker,
      },
    },
  );
  if (!cycleDraft.ok)
    throw new Error(`Operator cycle-count draft failed: ${cycleDraft.body}`);
  const cycleSubmit = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "submit_cycle_count",
    {
      idempotency_key: `${fixture.marker}-cycle-submit`,
      cycle_count_id: fixture.ids.cycleCount,
      reason: `${fixture.marker} material variance`,
      evidence_urls: [`audit/${fixture.marker}/count.jpg`],
    },
  );
  if (!cycleSubmit.ok)
    throw new Error(`Operator cycle-count submit failed: ${cycleSubmit.body}`);
  fixture.cycleRequestId = JSON.parse(cycleSubmit.body).requests[0].id;
  fixture.cleanupActivityEntityIds.push(fixture.cycleRequestId);
  requireRpcFailure(
    await callRpcAsBrowserUser(page, "warehouse", "adjust_stock", {
      stock_delta: {
        product_id: fixture.ids.product,
        location_id: fixture.locationId,
        delta: 1,
      },
      movement: { id: `${fixture.marker}-direct-adjustment-probe` },
    }),
    /retired|permission|not authorized/i,
    "retired direct stock adjustment",
  );
  const stockBeforeRequests = await inventoryLedger();
  fixture.manualStockRequests = {};
  for (const [name, sourceType, quantityDelta] of [
    ["positive", "adjustment", 2],
    ["negative", "write_off", -1],
    ["insufficient", "write_off", -999],
  ]) {
    const requested = await callRpcAsBrowserUser(
      page,
      "warehouse",
      "request_stock_change",
      {
        idempotency_key: `${fixture.marker}-manual-${name}`,
        source_type: sourceType,
        product_id: fixture.ids.product,
        location_id: fixture.locationId,
        quantity_delta: quantityDelta,
        reason: `${fixture.marker} governed ${name} stock request`,
        evidence_urls: [`audit/${fixture.marker}/manual-${name}.jpg`],
      },
    );
    if (!requested.ok)
      throw new Error(
        `Governed ${name} stock request failed: ${requested.body}`,
      );
    const request = JSON.parse(requested.body);
    fixture.manualStockRequests[name] = request.id;
    fixture.cleanupStockRequestIds.push(request.id);
    fixture.cleanupActivityEntityIds.push(request.id);
  }
  const stockAfterRequests = await inventoryLedger();
  if (
    stockBeforeRequests.inventory !== stockAfterRequests.inventory ||
    stockBeforeRequests.ledger !== stockAfterRequests.ledger
  )
    throw new Error(
      "A stock-change request mutated inventory before locked approval.",
    );
  return {
    name: "Task 3 operator receipt transactions",
    ok: true,
    cleanReceipt: JSON.parse(clean.body).receipt.id,
    partialReceipt: JSON.parse(partial.body).receipt.id,
    quarantineReceipt: fixture.ids.quarantineReceipt,
    concurrentDenied: concurrent.find((result) => !result.ok)?.status,
  };
}

async function callRpcArgsAsBrowserUser(page, schema, fn, args) {
  const accessToken = await browserAccessToken(page);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!accessToken || !anonKey || !supabaseUrl)
    throw new Error(
      "Authenticated browser session and public Supabase configuration are required.",
    );
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "accept-profile": schema,
      "content-profile": schema,
    },
    body: JSON.stringify(args),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
}

async function task3RequestExcessAmendment(page, fixture) {
  const requested = await callRpcAsBrowserUser(
    page,
    "procurement",
    "request_po_line_quantity_amendment",
    {
      purchase_order_id: fixture.ids.excessPo,
      po_line_id: fixture.ids.excessLine,
      amended_quantity: 2,
      reason: `${fixture.marker} approved amendment quantity growth request`,
      evidence_urls: [`audit/${fixture.marker}/excess-amendment-request.pdf`],
    },
  );
  if (!requested.ok)
    throw new Error(`Approved amendment request failed: ${requested.body}`);
  const amendment = JSON.parse(requested.body);
  fixture.ids.excessAmendment = amendment.id;
  return {
    name: "Task 3 approved amendment quantity growth request",
    ok: true,
    amendmentId: amendment.id,
    previousQuantity: Number(amendment.previous_quantity),
    amendedQuantity: Number(amendment.amended_quantity),
  };
}

const TASK3_SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function task3ApproveExcessAmendment(page, fixture) {
  const queue = await callRpcAsBrowserUser(
    page,
    "procurement",
    "purchase_order_amendment_work_items",
    {},
  );
  if (!queue.ok || !queue.body.includes(fixture.ids.excessAmendment))
    throw new Error(
      `Scoped amendment approval queue is missing the assigned item: ${queue.body}`,
    );
  let approved;
  const { error: revokeDoaError } = await fixture.client
    .schema("procurement")
    .from("doa_assignments")
    .update({ active: false })
    .eq("id", fixture.ids.amendmentDoaAssignments[0]);
  if (revokeDoaError)
    throw new Error(
      `Current DOA revocation setup failed: ${revokeDoaError.message}`,
    );
  try {
    requireRpcFailure(
      await callRpcAsBrowserUser(
        page,
        "procurement",
        "approve_po_line_quantity_amendment",
        {
          amendment_id: fixture.ids.excessAmendment,
          decision: "approved",
          reason: `${fixture.marker} revoked current DOA assignment denial`,
          signature: {
            signature_png: TASK3_SIGNATURE_PNG,
            signer_name: fixture.approverName,
            signature_method: "typed",
            signed_at: new Date().toISOString(),
          },
        },
      ),
      /currently active DOA assignment and matrix/i,
      "revoked current DOA assignment denial",
    );
  } finally {
    const { error: restoreDoaError } = await fixture.client
      .schema("procurement")
      .from("doa_assignments")
      .update({ active: true })
      .eq("id", fixture.ids.amendmentDoaAssignments[0]);
    if (restoreDoaError)
      throw new Error(
        `Current DOA restoration failed: ${restoreDoaError.message}`,
      );
  }
  for (let step = 1; step <= 3; step += 1) {
    approved = await callRpcAsBrowserUser(
      page,
      "procurement",
      "approve_po_line_quantity_amendment",
      {
        amendment_id: fixture.ids.excessAmendment,
        decision: "approved",
        reason: `${fixture.marker} independently approved excess amendment step ${step}`,
        signature: {
          signature_png: TASK3_SIGNATURE_PNG,
          signer_name: fixture.approverName,
          signature_method: "typed",
          signed_at: new Date().toISOString(),
        },
      },
    );
    if (!approved.ok)
      throw new Error(
        `Approved amendment step ${step} failed: ${approved.body}`,
      );
  }
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "purchase_order_amendments",
      filters: { id: fixture.ids.excessAmendment },
      expected: {
        purchase_order_id: fixture.ids.excessPo,
        po_line_id: fixture.ids.excessLine,
        previous_quantity: 1,
        amended_quantity: 2,
        status: "approved",
      },
      select:
        "id,purchase_order_id,po_line_id,previous_quantity,amended_quantity,status,requested_by,approved_by",
    },
    fixture.client,
  );
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "purchase_order_lines",
      filters: { id: fixture.ids.excessLine },
      expected: { quantity: 2 },
      select: "id,quantity,received_quantity",
    },
    fixture.client,
  );
  return {
    name: "Task 3 approved amendment quantity growth approval",
    ok: true,
    amendmentId: fixture.ids.excessAmendment,
  };
}

async function task3SupervisorTransactions(page, fixture) {
  const inventoryQuantity = async () => {
    const { data, error } = await fixture.client
      .schema("warehouse")
      .from("stock_levels")
      .select("quantity")
      .eq("product_id", fixture.ids.product)
      .eq("location_id", fixture.locationId);
    if (error)
      throw new Error(`Stock approval readback failed: ${error.message}`);
    return (data ?? []).reduce(
      (total, row) => total + Number(row.quantity ?? 0),
      0,
    );
  };
  const serializedHoldResult = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "inspect_quality",
    {
      idempotency_key: `${fixture.marker}-held-serial-qc`,
      source_type: "receipt",
      source_id: fixture.ids.serializedIssueReceipt,
      product_id: fixture.ids.serializedIssueProduct,
      serial_number: fixture.ids.serializedIssueSerial,
      quantity: 1,
      disposition: "hold",
      reason: `${fixture.marker} held serialized unit issue denial`,
      evidence_urls: [`audit/${fixture.marker}/held-serial.jpg`],
    },
  );
  if (!serializedHoldResult.ok)
    throw new Error(
      `Serialized hold creation failed: ${serializedHoldResult.body}`,
    );
  const serializedHold = JSON.parse(serializedHoldResult.body).hold;
  if (!serializedHold?.id)
    throw new Error("Serialized hold readback is missing");
  fixture.cleanupHoldIds.push(serializedHold.id);
  const serializedAllocationId = `${fixture.marker}-held-serial-allocation`;
  await insertAuditRows(fixture.client, "warehouse", "allocations", [
    {
      id: serializedAllocationId,
      event_id: fixture.ids.event,
      product_id: fixture.ids.serializedIssueProduct,
      quantity: 1,
      status: "reserved",
      promotional: false,
      created_at: new Date().toISOString(),
    },
  ]);
  requireRpcFailure(
    await callRpcAsBrowserUser(page, "warehouse", "issue", {
      allocation_id: serializedAllocationId,
      unit_ids: [fixture.ids.serializedIssueUnit],
      assigned_to: "Task 3 denied assignee",
      event_id: fixture.ids.event,
      stock_deltas: [],
      movement: {
        id: `${fixture.marker}-held-serial-movement`,
        type: "issue",
        product_id: fixture.ids.serializedIssueProduct,
        quantity: 1,
        from_location_id: fixture.locationId,
        event_id: fixture.ids.event,
        reference: serializedAllocationId,
        evidence_urls: [],
        actor: "caller-supplied",
        created_at: new Date().toISOString(),
      },
    }),
    /held serialized units cannot be issued/i,
    "held serialized unit issue denial",
  );
  await verifyCheckpoint(
    {
      schema: "warehouse",
      table: "inventory_units",
      filters: { id: fixture.ids.serializedIssueUnit },
      expected: { status: "in_stock" },
      select: "id,status,serial_number",
    },
    fixture.client,
  );
  await verifyCheckpoint(
    {
      schema: "warehouse",
      table: "allocations",
      filters: { id: serializedAllocationId },
      expected: { status: "reserved" },
      select: "id,status,product_id",
    },
    fixture.client,
  );
  const { error: serializedAllocationCleanupError } = await fixture.client
    .schema("warehouse")
    .from("allocations")
    .delete()
    .eq("id", serializedAllocationId);
  if (serializedAllocationCleanupError)
    throw new Error(
      `Held serial allocation cleanup failed: ${serializedAllocationCleanupError.message}`,
    );

  requireRpcFailure(
    await callRpcAsBrowserUser(page, "private", "warehouse_inspect_quality", {
      idempotency_key: `${fixture.marker}-private-quality-denial`,
      source_type: "receipt",
      source_id: fixture.ids.quarantineReceipt,
      product_id: fixture.ids.product,
      procurement_po_line_id: fixture.ids.quarantineLine,
      quantity: 1,
      disposition: "hold",
      reason: "private quality inspection direct denial",
      evidence_urls: [`audit/${fixture.marker}/private-denial.jpg`],
    }),
    /permission|denied|schema|not found|could not find/i,
    "private quality inspection direct denial",
  );
  requireRpcFailure(
    await callRpcAsBrowserUser(page, "warehouse", "inspect_quality", {
      idempotency_key: `${fixture.marker}-wrong-receipt-line`,
      source_type: "receipt",
      source_id: fixture.ids.quarantineReceipt,
      product_id: fixture.ids.product,
      procurement_po_line_id: fixture.ids.cleanLine,
      quantity: 1,
      disposition: "hold",
      reason: "caller line must belong to receipt",
      evidence_urls: [`audit/${fixture.marker}/wrong-line.jpg`],
    }),
    /does not belong to the receipt/i,
    "receipt quality PO-line identity",
  );
  requireRpcFailure(
    await callRpcAsBrowserUser(page, "warehouse", "inspect_quality", {
      idempotency_key: `${fixture.marker}-active-exception-public-quality-denial`,
      source_type: "receipt",
      source_id: fixture.ids.qualityProbeReceipt,
      product_id: fixture.ids.product,
      procurement_po_line_id: fixture.ids.qualityProbeLine,
      quantity: 1,
      disposition: "accepted",
      evidence_urls: [`audit/${fixture.marker}/active-exception-qc-denial.jpg`],
    }),
    /active controlled receipt exception|controlled exception resolver/i,
    "active exception public quality denial",
  );
  // Deterministic hold creation versus reservation: both browser-role transactions
  // share the product lock, so exactly one concurrent hold or reservation may consume availability.
  const atpBeforeRaceResult = await callRpcArgsAsBrowserUser(
    page,
    "warehouse",
    "available_to_promise",
    {
      p_product_id: fixture.ids.product,
    },
  );
  if (!atpBeforeRaceResult.ok)
    throw new Error(
      `Hold-create race ATP pre-read failed: ${atpBeforeRaceResult.body}`,
    );
  const atpBeforeRace = Number(JSON.parse(atpBeforeRaceResult.body));
  const raceAllocationId = `${fixture.marker}-hold-create-race-allocation`;
  const holdCreator = await openPersonaPageFrom(
    page,
    "intra.test.operations.associate@mwell.com.ph",
  );
  let raceResults;
  try {
    raceResults = await Promise.allSettled([
      callRpcAsBrowserUser(holdCreator.page, "warehouse", "inspect_quality", {
        idempotency_key: `${fixture.marker}-hold-create-race`,
        source_type: "receipt",
        source_id: fixture.ids.qualityRaceReceipt,
        product_id: fixture.ids.product,
        quantity: 1,
        disposition: "hold",
        reason: `${fixture.marker} hold creation versus reservation`,
        evidence_urls: [`audit/${fixture.marker}/hold-create-race.jpg`],
      }),
      callRpcAsBrowserUser(page, "warehouse", "reserve", {
        product_id: fixture.ids.product,
        quantity: atpBeforeRace,
        allocation: {
          id: raceAllocationId,
          event_id: fixture.ids.event,
          product_id: fixture.ids.product,
          quantity: atpBeforeRace,
          status: "reserved",
          promotional: false,
          created_at: new Date().toISOString(),
        },
      }),
    ]);
  } finally {
    await holdCreator.context.close();
  }
  const [holdRace, reserveRace] = raceResults.map((result) =>
    result.status === "fulfilled"
      ? result.value
      : { ok: false, status: 500, body: String(result.reason) },
  );
  if (Number(holdRace.ok) + Number(reserveRace.ok) !== 1)
    throw new Error(
      `exactly one concurrent hold or reservation may consume availability: ${JSON.stringify({ holdRace, reserveRace })}`,
    );
  const { data: raceHolds, error: raceHoldError } = await fixture.client
    .schema("warehouse")
    .from("inventory_holds")
    .select("id,status,quantity,inspection_id")
    .eq("reason", `${fixture.marker} hold creation versus reservation`);
  if (raceHoldError)
    throw new Error(
      `Hold-create race hold readback failed: ${raceHoldError.message}`,
    );
  const { data: raceAllocations, error: raceAllocationError } =
    await fixture.client
      .schema("warehouse")
      .from("allocations")
      .select("id,status,quantity,product_id")
      .eq("id", raceAllocationId);
  if (raceAllocationError)
    throw new Error(
      `Hold-create race allocation readback failed: ${raceAllocationError.message}`,
    );
  if ((raceHolds?.length ?? 0) + (raceAllocations?.length ?? 0) !== 1)
    throw new Error(
      `Hold-create race authoritative rows diverged: ${JSON.stringify({ raceHolds, raceAllocations })}`,
    );
  await verifyCheckpoint(
    {
      schema: "warehouse",
      table: "receipts",
      filters: { id: fixture.ids.cleanReceipt },
      expected: { procurement_po_id: fixture.ids.cleanPo },
      select: "id,quality_status,procurement_po_id",
    },
    fixture.client,
  );
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "purchase_order_lines",
      filters: { id: fixture.ids.cleanLine },
      expected: { received_quantity: 1 },
      select: "id,quantity,received_quantity,receiving_status",
    },
    fixture.client,
  );
  const atpAfterRace = await callRpcArgsAsBrowserUser(
    page,
    "warehouse",
    "available_to_promise",
    {
      p_product_id: fixture.ids.product,
    },
  );
  const expectedAtpAfterRace = holdRace.ok ? atpBeforeRace - 1 : 0;
  if (
    !atpAfterRace.ok ||
    Number(JSON.parse(atpAfterRace.body)) !== expectedAtpAfterRace
  )
    throw new Error(
      `Hold-create race authoritative ATP readback failed: ${atpAfterRace.body}`,
    );
  if (reserveRace.ok) {
    const cancelled = await callRpcAsBrowserUser(
      page,
      "warehouse",
      "cancel_allocation",
      {
        allocation_id: raceAllocationId,
      },
    );
    if (!cancelled.ok)
      throw new Error(
        `Hold-create race allocation cleanup failed: ${cancelled.body}`,
      );
    const acceptedQc = await callRpcAsBrowserUser(
      page,
      "warehouse",
      "inspect_quality",
      {
        idempotency_key: `${fixture.marker}-post-race-quality-acceptance`,
        source_type: "receipt",
        source_id: fixture.ids.qualityRaceReceipt,
        product_id: fixture.ids.product,
        quantity: 1,
        disposition: "accepted",
        evidence_urls: [
          `audit/${fixture.marker}/post-race-quality-acceptance.jpg`,
        ],
      },
    );
    if (!acceptedQc.ok)
      throw new Error(
        `Post-race quality acceptance failed: ${acceptedQc.body}`,
      );
  } else {
    fixture.cleanupHoldIds.push(raceHolds[0].id);
    const released = await callRpcAsBrowserUser(
      page,
      "warehouse",
      "release_quality_hold",
      {
        idempotency_key: `${fixture.marker}-hold-create-race-release`,
        hold_id: raceHolds[0].id,
        target_disposition: "accepted",
        reason: `${fixture.marker} race hold released after readback`,
        evidence_urls: [`audit/${fixture.marker}/hold-create-race-release.jpg`],
      },
    );
    if (!released.ok)
      throw new Error(`Hold-create race hold cleanup failed: ${released.body}`);
  }
  const validPublicQuality = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "inspect_quality",
    {
      idempotency_key: `${fixture.marker}-valid-public-quality-inspection`,
      source_type: "receipt",
      source_id: fixture.ids.routineQualityReceipt,
      product_id: fixture.ids.product,
      quantity: 1,
      disposition: "accepted",
      evidence_urls: [`audit/${fixture.marker}/valid-public-quality.jpg`],
    },
  );
  if (!validPublicQuality.ok)
    throw new Error(
      `valid public quality inspection failed: ${validPublicQuality.body}`,
    );
  await verifyCheckpoint(
    {
      schema: "warehouse",
      table: "quality_inspections",
      filters: {
        source_id: fixture.ids.routineQualityReceipt,
        disposition: "accepted",
      },
      expected: { procurement_po_line_id: null },
      select: "source_id,disposition,procurement_po_line_id",
    },
    fixture.client,
  );
  await verifyCheckpoint(
    {
      schema: "warehouse",
      table: "quality_inspections",
      filters: {
        source_id: fixture.ids.quarantineReceipt,
        disposition: "pending",
      },
      expected: { procurement_po_line_id: fixture.ids.quarantineLine },
      select: "source_id,disposition,procurement_po_line_id",
    },
    fixture.client,
  );

  for (const scenario of fixture.receiptExceptionScenarios) {
    const decisionPayload = {
      idempotency_key: `${fixture.marker}-exception-outcome-${scenario.key ?? scenario.decisionId}`,
      decision_id: scenario.decisionId,
      decision: scenario.outcome,
      reason: `${fixture.marker} exception outcome ${scenario.outcome} ${scenario.key ?? scenario.decisionId}`,
      evidence_urls: [
        `audit/${fixture.marker}/outcome-${scenario.outcome}.jpg`,
      ],
      ...(scenario.exceptionClass === "unidentified" &&
      ["accept", "quarantine"].includes(scenario.outcome)
        ? {
            identifications: [
              { po_line_id: scenario.lineId, product_id: fixture.ids.product },
            ],
          }
        : {}),
    };
    const resolution = await callRpcAsBrowserUser(
      page,
      "warehouse",
      "resolve_procurement_po_exception",
      decisionPayload,
    );
    if (!resolution.ok)
      throw new Error(
        `Supervisor ${scenario.outcome} decision failed: ${resolution.body}`,
      );
    const replay = await callRpcAsBrowserUser(
      page,
      "warehouse",
      "resolve_procurement_po_exception",
      decisionPayload,
    );
    if (
      !replay.ok ||
      JSON.parse(replay.body).decision.id !== scenario.decisionId
    )
      throw new Error(
        `Supervisor ${scenario.outcome} decision was not idempotent.`,
      );
    await verifyCheckpoint(
      {
        schema: "warehouse",
        table: "procurement_receipt_exception_decisions",
        filters: { id: scenario.decisionId },
        expected: {
          status: scenario.outcome === "escalate" ? "escalated" : "decided",
          decision: scenario.outcome,
        },
        select: "id,status,decision,requested_by,decided_by",
      },
      fixture.client,
    );
    const expectedDisposition = {
      accept: "accepted",
      reject: "vendor_return",
      quarantine: "hold",
      escalate: "pending",
    }[scenario.outcome];
    if (scenario.exceptionClass === "unidentified") {
      await verifyCheckpoint(
        {
          schema: "warehouse",
          table: "unidentified_receipt_custody",
          filters: { decision_id: scenario.decisionId },
          expected: {
            po_line_id: scenario.lineId,
            identified_product_id: ["accept", "quarantine"].includes(
              scenario.outcome,
            )
              ? fixture.ids.product
              : null,
          },
          select:
            "decision_id,po_line_id,identified_product_id,observed_description",
        },
        fixture.client,
      );
      await verifyCheckpoint(
        {
          schema: "procurement",
          table: "purchase_order_lines",
          filters: { id: scenario.lineId },
          expected: {
            warehouse_product_id: ["accept", "quarantine"].includes(
              scenario.outcome,
            )
              ? fixture.ids.product
              : null,
          },
          select: "id,warehouse_product_id",
        },
        fixture.client,
      );
      if (scenario.outcome === "accept")
        await verifyCheckpoint(
          {
            schema: "warehouse",
            table: "quality_inspections",
            filters: { source_id: scenario.receiptId },
            expected: {
              disposition: "accepted",
              procurement_po_line_id: scenario.lineId,
            },
            select: "source_id,disposition,procurement_po_line_id",
          },
          fixture.client,
        );
    } else {
      await verifyCheckpoint(
        {
          schema: "warehouse",
          table: "quality_inspections",
          filters: { source_id: scenario.receiptId },
          expected: { disposition: expectedDisposition },
          select: "id,source_id,disposition,procurement_po_line_id",
        },
        fixture.client,
      );
    }
    fixture.cleanupActivityEntityIds.push(scenario.decisionId);
    if (scenario.outcome === "escalate") {
      const actionable = await callRpcAsBrowserUser(
        page,
        "warehouse",
        "procurement_receipt_exception_work_items",
        { status: "escalated" },
      );
      if (!actionable.ok || !actionable.body.includes(scenario.decisionId))
        throw new Error(
          "Escalated receipt decision did not remain in the actionable queue.",
        );
      await page.goto(
        `${baseUrl}/warehouse/purchase-orders?workflow=${Date.now()}`,
        {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        },
      );
      await waitForMeaningfulRoute(page);
      const decisionPanel = page.getByRole("region", {
        name: "Controlled receipt decisions",
      });
      const escalatedRow = decisionPanel.getByRole("listitem").filter({
        has: page.getByText(`${fixture.marker}-PO-UNIDENTIFIED`, {
          exact: true,
        }),
      });
      await escalatedRow
        .getByText("Escalated", { exact: true })
        .waitFor({ state: "visible" });
      await escalatedRow
        .getByRole("button", { name: "Review controlled receipt" })
        .click();
      const decisionDialog = page.getByRole("dialog", {
        name: "Supervisor receipt decision",
      });
      await decisionDialog
        .getByLabel("Decision reason")
        .fill(`${fixture.marker} browser escalation final disposition`);
      await decisionDialog
        .getByLabel("Decision evidence")
        .fill(`audit/${fixture.marker}/escalated-final.jpg`);
      await decisionDialog
        .getByRole("button", { name: "Reject receipt" })
        .click();
      await decisionDialog.waitFor({ state: "detached" });
      await verifyCheckpoint(
        {
          schema: "warehouse",
          table: "procurement_receipt_exception_decisions",
          filters: { id: scenario.decisionId },
          expected: { status: "decided", decision: "reject" },
          select: "id,status,decision",
        },
        fixture.client,
      );
      if (scenario.excessCustodyId) {
        await verifyCheckpoint(
          {
            schema: "warehouse",
            table: "procurement_receipt_excess_custody",
            filters: { id: scenario.excessCustodyId },
            expected: { product_id: null, status: "vendor_return" },
            select: "id,product_id,ordered_quantity,excess_quantity,status",
          },
          fixture.client,
        );
        await verifyCheckpoint(
          {
            schema: "warehouse",
            table: "procurement_receipt_exception_lines",
            filters: { decision_id: scenario.decisionId },
            expected: { active: false },
            select: "decision_id,po_line_id,active",
          },
          fixture.client,
        );
      }
    }
    if (scenario.outcome === "quarantine") {
      requireRpcFailure(
        await callRpcAsBrowserUser(
          page,
          "warehouse",
          "receive_procurement_po_exception",
          {
            idempotency_key: `${fixture.marker}-quarantine-line-claim-collision-${scenario.decisionId}`,
            po_id: scenario.poId,
            location_id: fixture.locationId,
            exception_type: "damaged",
            reason: `${fixture.marker} quarantine line claim collision`,
            evidence_urls: [`audit/${fixture.marker}/quarantine-collision.jpg`],
            lines: [
              {
                line_id: scenario.lineId,
                product_id: fixture.ids.product,
                actual_quantity: 1,
                expected_quantity: scenario.expectedQuantity,
              },
            ],
          },
        ),
        /active receipt decision already reserves/i,
        "quarantine line claim collision",
      );
      const { data: receiptFact, error: receiptFactError } =
        await fixture.client
          .schema("warehouse")
          .from("receipts")
          .select("lines")
          .eq("id", scenario.receiptId)
          .single();
      if (
        receiptFactError ||
        Number(receiptFact?.lines?.[0]?.actual_quantity) !==
          scenario.actualQuantity
      )
        throw new Error(
          "Quarantine did not preserve the full observed receipt fact.",
        );
      const { data: qualityRows, error: qualityError } = await fixture.client
        .schema("warehouse")
        .from("quality_inspections")
        .select("id,quantity")
        .eq("source_id", scenario.receiptId)
        .limit(1);
      if (qualityError || !qualityRows?.[0])
        throw new Error("Quarantine QC readback failed.");
      const postableQuantity = Math.min(
        scenario.actualQuantity,
        scenario.expectedQuantity,
      );
      if (Number(qualityRows[0].quantity) !== postableQuantity)
        throw new Error(
          `bounded quarantine posting expected ${postableQuantity}, got ${qualityRows[0].quantity}.`,
        );
      const { data: holdRows, error: holdError } = await fixture.client
        .schema("warehouse")
        .from("inventory_holds")
        .select("id,status,quantity,location_id,bin_id,lot_id")
        .eq("inspection_id", qualityRows[0].id)
        .eq("status", "active")
        .limit(1);
      if (holdError || !holdRows?.[0])
        throw new Error("Quarantine did not create an active inventory hold.");
      if (Number(holdRows[0].quantity) !== postableQuantity)
        throw new Error(
          `bounded quarantine posting created hold ${holdRows[0].quantity}, expected ${postableQuantity}.`,
        );
      fixture.cleanupHoldIds.push(holdRows[0].id);
      fixture.cleanupActivityEntityIds.push(holdRows[0].id);
      const heldLotAllocationId = `${fixture.marker}-held-lot-issue-${scenario.decisionId}`;
      await insertAuditRows(fixture.client, "warehouse", "allocations", [
        {
          id: heldLotAllocationId,
          event_id: fixture.ids.event,
          product_id: fixture.ids.product,
          quantity: 1,
          status: "reserved",
          promotional: false,
          created_at: new Date().toISOString(),
        },
      ]);
      requireRpcFailure(
        await callRpcAsBrowserUser(page, "warehouse", "issue", {
          allocation_id: heldLotAllocationId,
          unit_ids: [],
          event_id: fixture.ids.event,
          stock_deltas: [
            {
              product_id: fixture.ids.product,
              location_id: holdRows[0].location_id,
              bin_id: holdRows[0].bin_id,
              lot_id: holdRows[0].lot_id,
              delta: -1,
            },
          ],
          movement: {
            id: `${fixture.marker}-held-lot-movement-${scenario.decisionId}`,
            type: "issue",
            product_id: fixture.ids.product,
            quantity: 1,
            from_location_id: holdRows[0].location_id,
            from_bin_id: holdRows[0].bin_id,
            lot_id: holdRows[0].lot_id,
            event_id: fixture.ids.event,
            reference: heldLotAllocationId,
            evidence_urls: [],
            actor: "caller-supplied",
            created_at: new Date().toISOString(),
          },
        }),
        /held exact lot stock cannot be issued/i,
        "held exact lot issue denial",
      );
      await verifyCheckpoint(
        {
          schema: "warehouse",
          table: "allocations",
          filters: { id: heldLotAllocationId },
          expected: { status: "reserved" },
          select: "id,status,product_id",
        },
        fixture.client,
      );
      const { error: heldLotAllocationCleanupError } = await fixture.client
        .schema("warehouse")
        .from("allocations")
        .delete()
        .eq("id", heldLotAllocationId);
      if (heldLotAllocationCleanupError)
        throw new Error(
          `Held lot allocation cleanup failed: ${heldLotAllocationCleanupError.message}`,
        );
      if (scenario.actualQuantity > scenario.expectedQuantity) {
        await verifyCheckpoint(
          {
            schema: "warehouse",
            table: "procurement_receipt_excess_custody",
            filters: { decision_id: scenario.decisionId },
            expected: {
              product_id: fixture.ids.product,
              ordered_quantity: 1,
              excess_quantity: 1,
              status: "held",
            },
            select:
              "id,decision_id,product_id,ordered_quantity,excess_quantity,status",
          },
          fixture.client,
        );
        const { data: custodyRows, error: custodyError } = await fixture.client
          .schema("warehouse")
          .from("procurement_receipt_excess_custody")
          .select("id")
          .eq("decision_id", scenario.decisionId)
          .limit(1);
        if (custodyError || !custodyRows?.[0])
          throw new Error("Excess custody identity readback failed.");
        scenario.excessCustodyId = custodyRows[0].id;
        if (scenario.exceptionClass === "excess")
          fixture.ids.excessCustody = custodyRows[0].id;
        fixture.cleanupActivityEntityIds.push(custodyRows[0].id);
      }
      const heldStock = await inventoryQuantity();
      requireRpcFailure(
        await callRpcAsBrowserUser(page, "warehouse", "reserve", {
          product_id: fixture.ids.product,
          quantity: heldStock,
          allocation: {
            id: `${fixture.marker}-held-allocation-denial`,
            event_id: fixture.ids.event,
            product_id: fixture.ids.product,
            quantity: heldStock,
            status: "reserved",
            promotional: false,
            created_at: new Date().toISOString(),
          },
        }),
        /available after active inventory holds|only .* available/i,
        "active hold reservation denial",
      );
      if (scenario.key === "unidentified-quarantine") {
        const stockBeforeReturn = await inventoryQuantity();
        await page.goto(`${baseUrl}/warehouse/quality?workflow=${Date.now()}`, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });
        await waitForMeaningfulRoute(page);
        await page.getByRole("tab", { name: "Holds", exact: true }).click();
        const holdRow = page
          .getByText(
            `${fixture.marker} exception outcome quarantine ${scenario.key}`,
            { exact: true },
          )
          .locator("xpath=ancestor::li[1]");
        await holdRow.getByRole("button", { name: "Review hold" }).click();
        await page.getByRole("tab", { name: "Reject to vendor" }).click();
        await page
          .getByLabel("Supplier")
          .selectOption(`proc-${fixture.ids.vendor}`);
        await page
          .getByLabel("Vendor return reference")
          .fill(`${fixture.marker}-atomic-hold-return`);
        await page
          .getByLabel("Vendor return reason")
          .fill(`${fixture.marker} atomic hold rejection vendor return`);
        await page
          .getByLabel("Vendor return evidence URL")
          .fill(`audit/${fixture.marker}/atomic-hold-return.jpg`);
        await page
          .getByRole("button", { name: "Reject and create vendor return" })
          .click();
        await page
          .getByRole("dialog", { name: "Review inventory hold" })
          .waitFor({ state: "detached" });
        await verifyCheckpoint(
          {
            schema: "warehouse",
            table: "inventory_holds",
            filters: { id: holdRows[0].id },
            expected: { status: "vendor_return" },
            select: "id,status,released_by,release_reason",
          },
          fixture.client,
        );
        await verifyCheckpoint(
          {
            schema: "warehouse",
            table: "quality_inspections",
            filters: { id: qualityRows[0].id },
            expected: { disposition: "vendor_return" },
            select: "id,disposition,procurement_po_line_id",
          },
          fixture.client,
        );
        await verifyCheckpoint(
          {
            schema: "warehouse",
            table: "vendor_returns",
            filters: { hold_id: holdRows[0].id },
            expected: {
              supplier_id: `proc-${fixture.ids.vendor}`,
              reference: `${fixture.marker}-atomic-hold-return`,
              status: "ready",
            },
            select: "id,hold_id,supplier_id,reference,status,quantity",
          },
          fixture.client,
        );
        await verifyCheckpoint(
          {
            schema: "warehouse",
            table: "procurement_receipt_exception_lines",
            filters: { decision_id: scenario.decisionId },
            expected: { active: false },
            select: "decision_id,po_line_id,active",
          },
          fixture.client,
        );
        await verifyCheckpoint(
          {
            schema: "procurement",
            table: "purchase_orders",
            filters: { id: scenario.poId },
            expected: { status: "issued" },
            select: "id,status",
          },
          fixture.client,
        );
        if (
          (await inventoryQuantity()) !==
          stockBeforeReturn - postableQuantity
        )
          throw new Error(
            "Atomic hold rejection did not move the held quantity out of Warehouse custody.",
          );
        continue;
      }

      const releasePayload = {
        idempotency_key: `${fixture.marker}-release-quality-hold-${scenario.decisionId}`,
        hold_id: holdRows[0].id,
        target_disposition: "accepted",
        reason: `${fixture.marker} controlled hold release`,
        evidence_urls: [`audit/${fixture.marker}/hold-release.jpg`],
      };
      const firstAllocationId = `${fixture.marker}-hold-race-${scenario.decisionId}`;
      const retryAllocationId = `${fixture.marker}-hold-race-retry-${scenario.decisionId}`;
      const [release, firstReservation] = await Promise.all([
        callRpcAsBrowserUser(
          page,
          "warehouse",
          "release_quality_hold",
          releasePayload,
        ),
        callRpcAsBrowserUser(page, "warehouse", "reserve", {
          product_id: fixture.ids.product,
          quantity: heldStock,
          allocation: {
            id: firstAllocationId,
            event_id: fixture.ids.event,
            product_id: fixture.ids.product,
            quantity: heldStock,
            status: "reserved",
            promotional: false,
            created_at: new Date().toISOString(),
          },
        }),
      ]);
      if (!release.ok)
        throw new Error(
          `Controlled quarantine release failed: ${release.body}`,
        );
      let finalReservation = firstReservation;
      let allocationId = firstAllocationId;
      if (!firstReservation.ok) {
        requireRpcFailure(
          firstReservation,
          /available after active inventory holds|only .* available/i,
          "hold reservation lock ordering",
        );
        allocationId = retryAllocationId;
        finalReservation = await callRpcAsBrowserUser(
          page,
          "warehouse",
          "reserve",
          {
            product_id: fixture.ids.product,
            quantity: heldStock,
            allocation: {
              id: allocationId,
              event_id: fixture.ids.event,
              product_id: fixture.ids.product,
              quantity: heldStock,
              status: "reserved",
              promotional: false,
              created_at: new Date().toISOString(),
            },
          },
        );
      }
      if (!finalReservation.ok)
        throw new Error(
          `Authoritative post-release reservation failed: ${finalReservation.body}`,
        );
      await verifyCheckpoint(
        {
          schema: "warehouse",
          table: "inventory_holds",
          filters: { id: holdRows[0].id },
          expected: { status: "released" },
          select: "id,status,released_by",
        },
        fixture.client,
      );
      await verifyCheckpoint(
        {
          schema: "warehouse",
          table: "allocations",
          filters: { id: allocationId },
          expected: {
            product_id: fixture.ids.product,
            quantity: heldStock,
            status: "reserved",
          },
          select: "id,product_id,quantity,status,event_id",
        },
        fixture.client,
      );
      const atp = await callRpcArgsAsBrowserUser(
        page,
        "warehouse",
        "available_to_promise",
        {
          p_product_id: fixture.ids.product,
        },
      );
      if (!atp.ok || Number(JSON.parse(atp.body)) !== 0)
        throw new Error(
          `authoritative hold race readback expected zero ATP: ${atp.body}`,
        );
      await verifyCheckpoint(
        {
          schema: "warehouse",
          table: "receipts",
          filters: { id: scenario.receiptId },
          expected: { quality_status: "accepted" },
          select: "id,quality_status,procurement_po_id",
        },
        fixture.client,
      );

      if (scenario.exceptionClass === "excess") {
        await verifyCheckpoint(
          {
            schema: "warehouse",
            table: "procurement_receipt_exception_lines",
            filters: { decision_id: scenario.decisionId },
            expected: { active: true },
            select: "decision_id,po_line_id,active",
          },
          fixture.client,
        );
        await verifyCheckpoint(
          {
            schema: "procurement",
            table: "purchase_orders",
            filters: { id: scenario.poId },
            expected: { status: "issued" },
            select: "id,status",
          },
          fixture.client,
        );
        requireRpcFailure(
          await callRpcAsBrowserUser(
            page,
            "warehouse",
            "resolve_procurement_receipt_excess",
            {
              idempotency_key: `${fixture.marker}-excess-custody-missing-amendment`,
              custody_id: fixture.ids.excessCustody,
              outcome: "accepted_amendment",
              reason: `${fixture.marker} missing amendment denial`,
              evidence_urls: [`audit/${fixture.marker}/missing-amendment.jpg`],
            },
          ),
          /approved PO amendment|ordered quantity growth/i,
          "accepted excess without approved amendment",
        );
        const workItems = await callRpcAsBrowserUser(
          page,
          "warehouse",
          "procurement_receipt_excess_work_items",
          {},
        );
        if (
          !workItems.ok ||
          !workItems.body.includes(fixture.ids.excessCustody)
        )
          throw new Error(
            `authenticated excess custody work items missing: ${workItems.body}`,
          );
        fixture.ids.excessDecision = scenario.decisionId;
        continue;
      }
      await verifyCheckpoint(
        {
          schema: "procurement",
          table: "purchase_orders",
          filters: { id: scenario.poId },
          expected: { status: "closed" },
          select: "id,status",
        },
        fixture.client,
      );
      fixture.cleanupActivityEntityIds.push(scenario.poId);
      // PO status after hold release is authoritative under the same locked release transaction.
    }
  }

  for (const [name, expectedDelta] of [
    ["positive", 2],
    ["negative", -1],
  ]) {
    const before = await inventoryQuantity();
    const decided = await callRpcAsBrowserUser(
      page,
      "warehouse",
      "decide_stock_change",
      {
        idempotency_key: `${fixture.marker}-manual-${name}-approval`,
        request_id: fixture.manualStockRequests[name],
        decision: "approved",
        note: `${fixture.marker} trusted Supervisor ${name} approval`,
      },
    );
    if (!decided.ok)
      throw new Error(
        `Governed ${name} stock approval failed: ${decided.body}`,
      );
    const after = await inventoryQuantity();
    if (after - before !== expectedDelta)
      throw new Error(
        `Governed ${name} stock approval applied ${after - before}, expected ${expectedDelta}.`,
      );
  }
  const insufficientEscalation = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "decide_stock_change",
    {
      idempotency_key: `${fixture.marker}-manual-insufficient-approval`,
      request_id: fixture.manualStockRequests.insufficient,
      decision: "approved",
      note: `${fixture.marker} Supervisor escalation to Finance`,
    },
  );
  if (!insufficientEscalation.ok)
    throw new Error(
      `Insufficient stock-change Finance escalation failed: ${insufficientEscalation.body}`,
    );
  const insufficientRequest = JSON.parse(insufficientEscalation.body);
  if (insufficientRequest.status !== "pending_finance")
    throw new Error(
      `Material stock change bypassed Finance handoff (${insufficientEscalation.body}).`,
    );

  const approveVariance = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "decide_stock_change",
    {
      idempotency_key: `${fixture.marker}-variance-approve`,
      request_id: fixture.cycleRequestId,
      decision: "approved",
      note: `${fixture.marker} supervisor approval`,
    },
  );
  if (!approveVariance.ok)
    throw new Error(
      `Cross-role variance approval failed: ${approveVariance.body}`,
    );

  const selfDraft = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "record_cycle_count",
    {
      cycle_count: {
        id: fixture.ids.selfCycleCount,
        location_id: fixture.locationId,
        category: "qa",
        lines: [{ productId: fixture.ids.product, counted: 6 }],
        actor: fixture.marker,
      },
    },
  );
  if (!selfDraft.ok)
    throw new Error(
      `Supervisor self-approval fixture failed: ${selfDraft.body}`,
    );
  const selfSubmit = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "submit_cycle_count",
    {
      idempotency_key: `${fixture.marker}-self-submit`,
      cycle_count_id: fixture.ids.selfCycleCount,
      reason: `${fixture.marker} delegated self approval probe`,
      evidence_urls: [`audit/${fixture.marker}/self.jpg`],
    },
  );
  if (!selfSubmit.ok)
    throw new Error(
      `Supervisor self-approval submit failed: ${selfSubmit.body}`,
    );
  const selfRequestId = JSON.parse(selfSubmit.body).requests[0].id;
  fixture.cleanupActivityEntityIds.push(selfRequestId);
  requireRpcFailure(
    await callRpcAsBrowserUser(page, "warehouse", "decide_stock_change", {
      idempotency_key: `${fixture.marker}-self-denial`,
      request_id: selfRequestId,
      decision: "approved",
      note: "delegation must not permit self approval",
    }),
    /requester cannot approve their own/i,
    "self-approval under delegation",
  );
  return {
    name: "Task 3 supervisor quarantine and variance transactions",
    ok: true,
    varianceRequestId: fixture.cycleRequestId,
    selfApprovalDenied: true,
  };
}

async function task3FinanceInsufficientStockDenial(page, fixture) {
  const inventoryQuantity = async () => {
    const { data, error } = await fixture.client
      .schema("warehouse")
      .from("stock_levels")
      .select("quantity")
      .eq("product_id", fixture.ids.product)
      .eq("location_id", fixture.locationId);
    if (error)
      throw new Error(`Finance stock readback failed: ${error.message}`);
    return (data ?? []).reduce(
      (total, row) => total + Number(row.quantity ?? 0),
      0,
    );
  };
  const before = await inventoryQuantity();
  requireRpcFailure(
    await callRpcAsBrowserUser(page, "warehouse", "decide_stock_change", {
      idempotency_key: `${fixture.marker}-manual-insufficient-finance-denial`,
      request_id: fixture.manualStockRequests.insufficient,
      decision: "approved",
      note: `${fixture.marker} Finance locked-stock denial`,
    }),
    /negative|insufficient/i,
    "Finance insufficient locked stock-change approval",
  );
  const after = await inventoryQuantity();
  if (after !== before)
    throw new Error(
      `Failed Finance stock approval changed inventory from ${before} to ${after}.`,
    );
  const checkpoint = await verifyCheckpoint(
    {
      schema: "warehouse",
      table: "stock_change_requests",
      filters: { id: fixture.manualStockRequests.insufficient },
      expected: { status: "pending_finance" },
      select: "id,status,quantity_delta,financial_impact",
    },
    fixture.client,
  );
  return {
    name: "Task 3 Finance insufficient locked-stock denial",
    ok: true,
    checkpoint,
  };
}

async function task3SupervisorExcessFinalDisposition(page, fixture) {
  const workItems = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "procurement_receipt_excess_work_items",
    {},
  );
  if (!workItems.ok || !workItems.body.includes(fixture.ids.excessCustody))
    throw new Error(
      `Authenticated excess custody work item disappeared before disposition: ${workItems.body}`,
    );
  await page.goto(
    `${baseUrl}/warehouse/purchase-orders?workflow=${Date.now()}`,
    {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    },
  );
  await waitForMeaningfulRoute(page);
  const custodyRow = page
    .getByText(`${fixture.marker}-PO-EXCESS`, { exact: true })
    .locator("xpath=ancestor::li[1]");
  await custodyRow
    .getByRole("button", { name: "Review excess custody" })
    .click();
  const custodyDialog = page.getByRole("dialog", {
    name: "Final excess custody disposition",
  });
  await custodyDialog
    .getByLabel("Governed outcome")
    .selectOption("accepted_amendment");
  await custodyDialog
    .getByLabel("Approved quantity amendment")
    .selectOption(fixture.ids.excessAmendment);
  await custodyDialog
    .getByLabel("Decision reason")
    .fill(`${fixture.marker} Supervisor excess custody final disposition`);
  await custodyDialog
    .getByLabel("Evidence URL")
    .fill(`audit/${fixture.marker}/accepted-excess-amendment.jpg`);
  await custodyDialog
    .getByRole("button", { name: "Record final disposition" })
    .click();
  await custodyDialog.waitFor({ state: "detached" });
  await verifyCheckpoint(
    {
      schema: "warehouse",
      table: "procurement_receipt_excess_custody",
      filters: { id: fixture.ids.excessCustody },
      expected: {
        status: "accepted_amendment",
        approved_amendment_id: fixture.ids.excessAmendment,
      },
      select:
        "id,status,approved_amendment_id,ordered_quantity,excess_quantity",
    },
    fixture.client,
  );
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "purchase_order_lines",
      filters: { id: fixture.ids.excessLine },
      expected: { quantity: 2, received_quantity: 2 },
      select: "id,quantity,received_quantity",
    },
    fixture.client,
  );
  await verifyCheckpoint(
    {
      schema: "warehouse",
      table: "procurement_receipt_exception_lines",
      filters: { decision_id: fixture.ids.excessDecision },
      expected: { active: false },
      select: "decision_id,po_line_id,active",
    },
    fixture.client,
  );
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "purchase_orders",
      filters: { id: fixture.ids.excessPo },
      expected: { status: "closed" },
      select: "id,status",
    },
    fixture.client,
  );
  const after = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "procurement_receipt_excess_work_items",
    {},
  );
  if (!after.ok || after.body.includes(fixture.ids.excessCustody))
    throw new Error(
      `Supervisor excess custody final disposition remained actionable: ${after.body}`,
    );
  return {
    name: "Task 3 Supervisor excess custody final disposition",
    ok: true,
    custodyId: fixture.ids.excessCustody,
    amendmentId: fixture.ids.excessAmendment,
  };
}

async function task3AllCapabilityAdminWrongStep(page, fixture) {
  requireRpcFailure(
    await callRpcAsBrowserUser(page, "warehouse", "decide_stock_change", {
      idempotency_key: `${fixture.marker}-all-cap-admin-wrong-step`,
      request_id: fixture.manualStockRequests.positive,
      decision: "approved",
      note: "all-capability admin wrong-step denial",
    }),
    /configured approval group|not authorized|current stock-change approval tier/i,
    "all-capability admin wrong-step denial",
  );
  return { name: "Task 3 all-capability admin wrong-step denial", ok: true };
}

async function task3ApprovalRoleLifecycleContracts(page, fixture) {
  const { data: role, error } = await fixture.client
    .schema("core")
    .from("roles")
    .select("updated_at")
    .eq("module", "warehouse")
    .eq("role", fixture.ids.activeApprovalRole)
    .single();
  if (error || !role)
    throw new Error(
      `Referenced approval role readback failed: ${error?.message ?? "missing"}`,
    );
  const base = {
    module: "warehouse",
    original_role: fixture.ids.activeApprovalRole,
    label: `${fixture.marker} referenced approval role`,
    description: null,
    capabilities: ["approve_stock_adjustment"],
    expected_updated_at: role.updated_at,
  };
  requireRpcFailure(
    await callRpcAsBrowserUser(page, "core", "upsert_role_bundle", {
      ...base,
      role: fixture.ids.activeApprovalRole,
      is_active: false,
    }),
    /cannot be renamed or deactivated/i,
    "referenced approval role rename/deactivate denial",
  );
  requireRpcFailure(
    await callRpcAsBrowserUser(page, "core", "upsert_role_bundle", {
      ...base,
      role: `${fixture.ids.activeApprovalRole}_renamed`,
      is_active: true,
    }),
    /cannot be renamed or deactivated/i,
    "referenced approval role rename/deactivate denial",
  );
  return {
    name: "Task 3 referenced approval role rename/deactivate denial",
    ok: true,
  };
}

async function task3InactiveApprovalRoleDenial(page, fixture) {
  requireRpcFailure(
    await callRpcAsBrowserUser(page, "warehouse", "decide_stock_change", {
      idempotency_key: `${fixture.marker}-inactive-approval-role-denial`,
      request_id: fixture.manualStockRequests.positive,
      decision: "approved",
      note: `${fixture.marker} inactive approval role cannot authorize`,
    }),
    /not authorized for current stock-change approval tier|configured approval group/i,
    "inactive approval role cannot authorize",
  );
  return { name: "Task 3 inactive approval role cannot authorize", ok: true };
}

async function task3PolicyNegativeTransactions(page, fixture) {
  const submittedRfq = await callRpcAsBrowserUser(
    page,
    "procurement",
    "submit_request",
    { id: fixture.ids.policyRfq },
  );
  if (!submittedRfq.ok)
    throw new Error(
      `RFQ request submission failed before sourcing could begin: ${submittedRfq.body}`,
    );
  const rfqAwardReadiness = await callRpcAsBrowserUser(
    page,
    "procurement",
    "commitment_readiness",
    {
      request_id: fixture.ids.policyRfq,
      vendor_id: fixture.ids.vendor,
      phase: "award",
    },
  );
  if (!rfqAwardReadiness.ok || !/RFQ/i.test(rfqAwardReadiness.body))
    throw new Error(
      `route-specific RFQ evidence was not enforced before award (${rfqAwardReadiness.status}: ${rfqAwardReadiness.body}).`,
    );

  for (const [requestId, expected, contract] of [
    [
      fixture.ids.policyDirect,
      /complete Direct Award pack/i,
      "unsupported Direct Award",
    ],
    [
      fixture.ids.policyPetty,
      /Finance-approved one-time non-split petty-cash/i,
      "split petty-cash use",
    ],
    [
      fixture.ids.policyImport,
      /complete importation plan/i,
      "missing importation controls",
    ],
    [
      fixture.ids.policyExpired,
      /current full accreditation or approved scoped temporary clearance/i,
      "expired accreditation and unapproved scoped temporary clearance",
    ],
  ]) {
    const readiness = await callRpcAsBrowserUser(
      page,
      "procurement",
      "commitment_readiness",
      {
        request_id: requestId,
        vendor_id:
          requestId === fixture.ids.policyExpired
            ? fixture.ids.expiredVendor
            : fixture.ids.vendor,
        phase: "issue",
      },
    );
    if (!readiness.ok || !expected.test(readiness.body))
      throw new Error(
        `${contract} negative readiness failed (${readiness.status}: ${readiness.body}).`,
      );
  }

  return {
    name: "Task 3 policy-negative database transactions",
    ok: true,
    requestIds: [
      fixture.ids.policyRfq,
      fixture.ids.policyDirect,
      fixture.ids.policyPetty,
      fixture.ids.policyImport,
      fixture.ids.policyExpired,
    ],
  };
}

async function task3PaymentReadinessWithoutAcceptance(page, fixture) {
  requireRpcFailure(
    await callRpcAsBrowserUser(
      page,
      "procurement",
      "prepare_payment_readiness",
      {
        purchase_order_id: fixture.ids.cleanPo,
        acceptance_pack_id: crypto.randomUUID(),
        po_match: true,
        invoice_or_si_storage_path: `audit/${fixture.marker}/invoice.pdf`,
        milestone_support_storage_path: `audit/${fixture.marker}/receipt.pdf`,
        tax_withholding_support_storage_path: `audit/${fixture.marker}/tax.pdf`,
      },
    ),
    /acceptance|invalid input|foreign key/i,
    "payment readiness without accepted receipt or service acceptance",
  );
  return {
    name: "Task 3 payment readiness without acceptance denial",
    ok: true,
  };
}

async function task3GoodsAcceptance(
  page,
  fixture,
  purchaseOrderId,
  expectedLineId,
  workflowName,
) {
  await page.goto(
    `${baseUrl}/procurement/purchase-orders/${encodeURIComponent(purchaseOrderId)}?workflow=${Date.now()}`,
    {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    },
  );
  await waitForMeaningfulRoute(page);
  if (!/goods acceptance/i.test(await page.locator("body").innerText()))
    throw new Error(`${workflowName} did not render the scoped acceptance UI.`);
  const projection = await callRpcAsBrowserUser(
    page,
    "procurement",
    "acceptance_work_items",
    {
      purchase_order_id: purchaseOrderId,
    },
  );
  if (!projection.ok)
    throw new Error(`${workflowName} work item failed: ${projection.body}`);
  const [item] = JSON.parse(projection.body);
  const line = item?.lines?.find(
    (candidate) => candidate.poLineId === expectedLineId,
  );
  if (!line || Number(line.qcAcceptedQuantity) <= 0)
    throw new Error(
      `${workflowName} did not expose QC-accepted line quantities.`,
    );
  if (
    /vendor_name|unit_price|core_vendor_id|estimated_amount|"total"/i.test(
      projection.body,
    )
  )
    throw new Error(`${workflowName} leaked commercial facts.`);
  const accepted = await callRpcAsBrowserUser(
    page,
    "procurement",
    "record_acceptance_pack",
    {
      purchase_order_id: purchaseOrderId,
      acceptance_type: "goods",
      accepted_scope: {
        summary: `${fixture.marker} browser-role acceptance`,
        lines: [
          {
            poLineId: expectedLineId,
            quantity: Number(line.qcAcceptedQuantity),
            warehouseReceiptId: line.warehouseReceiptId,
            qcInspectionIds: line.qcInspectionIds,
          },
        ],
      },
      exceptions: [],
      warehouse_receipt_reference: item.warehouse_receipt_reference,
    },
  );
  if (!accepted.ok)
    throw new Error(`${workflowName} mutation failed: ${accepted.body}`);
  const pack = JSON.parse(accepted.body);
  fixture.cleanupActivityEntityIds.push(pack.id);
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "acceptance_packs",
      filters: { id: pack.id },
      expected: { purchase_order_id: purchaseOrderId },
      select: "id,purchase_order_id,request_id,accepted_by,status",
    },
    fixture.client,
  );
  return {
    name: workflowName,
    ok: true,
    purchaseOrderId,
    acceptancePackId: pack.id,
    acceptanceFacts: {
      warehouseReceiptReference: item.warehouse_receipt_reference,
      line,
    },
  };
}

async function task3CumulativePartialAcceptance(page, fixture) {
  const { data: exactQuality, error: exactQualityError } = await fixture.client
    .schema("warehouse")
    .from("quality_inspections")
    .select("source_id,procurement_po_line_id,quantity,disposition")
    .in("source_id", [
      fixture.ids.partialReceipt,
      fixture.ids.concurrentReceipt,
    ])
    .eq("disposition", "accepted");
  const exactByLine = new Map(
    (exactQuality ?? []).map((row) => [
      row.procurement_po_line_id,
      { receiptId: row.source_id, quantity: Number(row.quantity) },
    ]),
  );
  if (
    exactQualityError ||
    exactByLine.get(fixture.ids.partialLine)?.receiptId !==
      fixture.ids.partialReceipt ||
    exactByLine.get(fixture.ids.partialLine)?.quantity !== 1 ||
    exactByLine.get(fixture.ids.concurrentLine)?.receiptId !==
      fixture.ids.concurrentReceipt ||
    exactByLine.get(fixture.ids.concurrentLine)?.quantity !== 2
  )
    throw new Error(
      `same-product PO-line quality isolation failed: ${exactQualityError?.message ?? JSON.stringify(exactQuality)}`,
    );
  const latest = await task3GoodsAcceptance(
    page,
    fixture,
    fixture.ids.partialPo,
    fixture.ids.concurrentLine,
    "Task 3 assigned-reviewer goods acceptance latest partial",
  );
  const earlier = await task3GoodsAcceptance(
    page,
    fixture,
    fixture.ids.partialPo,
    fixture.ids.partialLine,
    "Task 3 assigned-reviewer goods acceptance earlier partial",
  );
  const { data: packs, error } = await fixture.client
    .schema("procurement")
    .from("acceptance_packs")
    .select("id,warehouse_receipt_reference,status")
    .eq("purchase_order_id", fixture.ids.partialPo)
    .in("status", ["accepted", "accepted_with_exceptions"]);
  if (
    error ||
    packs?.length !== 2 ||
    new Set(packs.map((pack) => pack.warehouse_receipt_reference)).size !== 2
  )
    throw new Error(
      `cumulative partial acceptance did not preserve two exact receipt evidence groups: ${error?.message ?? JSON.stringify(packs)}`,
    );
  fixture.cumulativeAcceptancePackIds = [
    latest.acceptancePackId,
    earlier.acceptancePackId,
  ];
  fixture.replacementAcceptanceFacts = earlier.acceptanceFacts;
  if (new Set(fixture.cumulativeAcceptancePackIds).size !== 2)
    throw new Error(
      "distinct active acceptance packs were not preserved per receipt evidence pack.",
    );
  return {
    name: "Task 3 cumulative partial acceptance",
    ok: true,
    acceptancePackIds: fixture.cumulativeAcceptancePackIds,
  };
}

async function task3CumulativePaymentAcceptanceBinding(page, fixture) {
  const readiness = await callRpcAsBrowserUser(
    page,
    "procurement",
    "prepare_payment_readiness",
    {
      purchase_order_id: fixture.ids.partialPo,
      po_match: true,
      invoice_or_si_storage_path: `audit/${fixture.marker}/cumulative-invoice.pdf`,
      milestone_support_storage_path: `audit/${fixture.marker}/cumulative-receipts.pdf`,
      tax_withholding_support_storage_path: `audit/${fixture.marker}/cumulative-tax.pdf`,
    },
  );
  if (!readiness.ok)
    throw new Error(
      `cumulative payment acceptance binding failed: ${readiness.body}`,
    );
  const pack = JSON.parse(readiness.body);
  const expected = [...fixture.cumulativeAcceptancePackIds].sort();
  const actual = [...(pack.acceptance_pack_ids ?? [])].sort();
  if (
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    Number(pack.accepted_quantity) !== 3
  )
    throw new Error(
      `cumulative payment acceptance binding mismatch: ${readiness.body}`,
    );
  fixture.ids.paymentReadinessPack = pack.id;
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "payment_readiness_packs",
      filters: { id: pack.id },
      expected: { accepted_quantity: 3, status: "ready_for_finance" },
      select: "id,acceptance_pack_ids,accepted_quantity,status",
    },
    fixture.client,
  );
  return {
    name: "Task 3 cumulative payment acceptance binding",
    ok: true,
    acceptancePackIds: actual,
    acceptedQuantity: Number(pack.accepted_quantity),
  };
}

async function task3InvalidateReadinessWithAcceptanceChange(page, fixture) {
  const facts = fixture.replacementAcceptanceFacts;
  if (!facts?.line || !facts.warehouseReceiptReference)
    throw new Error("Replacement acceptance evidence facts were not retained.");
  const replacementResult = await callRpcAsBrowserUser(
    page,
    "procurement",
    "record_acceptance_pack",
    {
      purchase_order_id: fixture.ids.partialPo,
      acceptance_type: "goods",
      accepted_scope: {
        summary: `${fixture.marker} corrected acceptance evidence`,
        lines: [
          {
            poLineId: fixture.ids.partialLine,
            quantity: Number(facts.line.qcAcceptedQuantity),
            warehouseReceiptId: facts.line.warehouseReceiptId,
            qcInspectionIds: facts.line.qcInspectionIds,
          },
        ],
      },
      exceptions: [],
      warehouse_receipt_reference: facts.warehouseReceiptReference,
    },
  );
  if (!replacementResult.ok)
    throw new Error(
      `Task 3 replacement acceptance evidence failed: ${replacementResult.body}`,
    );
  const replacement = JSON.parse(replacementResult.body);
  fixture.ids.replacementAcceptancePack = replacement.id;
  fixture.cleanupActivityEntityIds.push(replacement.id);
  const { data: po, error: poError } = await fixture.client
    .schema("procurement")
    .from("purchase_orders")
    .select("acceptance_evidence_version")
    .eq("id", fixture.ids.partialPo)
    .single();
  if (poError || Number(po?.acceptance_evidence_version) <= 0)
    throw new Error(
      `Acceptance evidence version did not advance: ${poError?.message ?? JSON.stringify(po)}`,
    );
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "payment_readiness_packs",
      filters: { id: fixture.ids.paymentReadinessPack },
      expected: { status: "accepted", evidence_stale: true },
      select:
        "id,status,evidence_stale,evidence_stale_at,acceptance_evidence_version,acceptance_pack_ids",
    },
    fixture.client,
  );
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "payment_readiness_staleness_events",
      filters: { payment_readiness_pack_id: fixture.ids.paymentReadinessPack },
      expected: { prior_status: "accepted" },
      select:
        "id,payment_readiness_pack_id,prior_status,prior_acceptance_evidence_version,acceptance_evidence_version",
    },
    fixture.client,
  );
  return {
    name: "Task 3 stale payment readiness invalidation",
    ok: true,
    replacementAcceptancePackId: replacement.id,
    acceptanceEvidenceVersion: Number(po.acceptance_evidence_version),
  };
}

async function task3FinalizePaymentReadiness(page, fixture) {
  const accepted = await callRpcAsBrowserUser(
    page,
    "procurement",
    "review_payment_readiness",
    {
      id: fixture.ids.paymentReadinessPack,
      status: "accepted",
      note: `${fixture.marker} finalized Finance decision before later acceptance evidence`,
    },
  );
  if (!accepted.ok)
    throw new Error(`Finance readiness finalization failed: ${accepted.body}`);
  await verifyCheckpoint(
    {
      schema: "procurement",
      table: "payment_readiness_packs",
      filters: { id: fixture.ids.paymentReadinessPack },
      expected: { status: "accepted", evidence_stale: false },
      select: "id,status,evidence_stale,acceptance_pack_ids,accepted_quantity",
    },
    fixture.client,
  );
  return {
    name: "Task 3 finalized Finance readiness preservation",
    ok: true,
    readinessPackId: fixture.ids.paymentReadinessPack,
  };
}

async function task3RejectStalePaymentReadiness(page, fixture) {
  requireRpcFailure(
    await callRpcAsBrowserUser(
      page,
      "procurement",
      "review_payment_readiness",
      {
        id: fixture.ids.paymentReadinessPack,
        status: "accepted",
        note: `${fixture.marker} stale payment readiness invalidation denial`,
      },
    ),
    /acceptance evidence version is stale|cannot transition from superseded/i,
    "stale payment readiness invalidation",
  );
  return {
    name: "Task 3 stale Finance readiness denial",
    ok: true,
    readinessPackId: fixture.ids.paymentReadinessPack,
  };
}

async function assertTask3ZeroResidualRows(fixture) {
  const { client, ids, marker } = fixture;
  const { poIds } = fixture;
  const checks = [
    [
      "core.vendors",
      client
        .schema("core")
        .from("vendors")
        .select("id", { count: "exact", head: true })
        .in("id", [ids.vendor, ids.expiredVendor]),
    ],
    [
      "core.activity_log",
      client
        .schema("core")
        .from("activity_log")
        .select("id", { count: "exact", head: true })
        .like("entity_id", `${marker}%`),
    ],
    [
      "core.documents",
      client
        .schema("core")
        .from("documents")
        .select("id", { count: "exact", head: true })
        .like("storage_path", `audit/${marker}/%`),
    ],
    [
      "procurement.requests",
      client
        .schema("procurement")
        .from("requests")
        .select("id", { count: "exact", head: true })
        .like("id", `${marker}%`),
    ],
    [
      "procurement.purchase_orders",
      client
        .schema("procurement")
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .in("id", poIds),
    ],
    [
      "procurement.purchase_order_lines",
      client
        .schema("procurement")
        .from("purchase_order_lines")
        .select("id", { count: "exact", head: true })
        .in("purchase_order_id", poIds),
    ],
    [
      "procurement.route_decisions",
      client
        .schema("procurement")
        .from("route_decisions")
        .select("id", { count: "exact", head: true })
        .like("request_id", `${marker}%`),
    ],
    [
      "procurement.exception_packs",
      client
        .schema("procurement")
        .from("exception_packs")
        .select("id", { count: "exact", head: true })
        .like("request_id", `${marker}%`),
    ],
    [
      "procurement.policy_evidence",
      client
        .schema("procurement")
        .from("policy_evidence")
        .select("id", { count: "exact", head: true })
        .like("request_id", `${marker}%`),
    ],
    [
      "procurement.acceptance_packs",
      client
        .schema("procurement")
        .from("acceptance_packs")
        .select("id", { count: "exact", head: true })
        .in("purchase_order_id", poIds),
    ],
    [
      "procurement.payment_readiness_packs",
      client
        .schema("procurement")
        .from("payment_readiness_packs")
        .select("id", { count: "exact", head: true })
        .in("purchase_order_id", poIds),
    ],
    [
      "procurement.payment_readiness_staleness_events",
      client
        .schema("procurement")
        .from("payment_readiness_staleness_events")
        .select("id", { count: "exact", head: true })
        .in("purchase_order_id", poIds),
    ],
    [
      "procurement.purchase_order_amendments",
      client
        .schema("procurement")
        .from("purchase_order_amendments")
        .select("id", { count: "exact", head: true })
        .in("purchase_order_id", poIds),
    ],
    [
      "procurement.doa_assignments Task 3 amendment",
      client
        .schema("procurement")
        .from("doa_assignments")
        .select("id", { count: "exact", head: true })
        .in("id", ids.amendmentDoaAssignments),
    ],
    [
      "procurement.doa_matrices Task 3 amendment",
      client
        .schema("procurement")
        .from("doa_matrices")
        .select("id", { count: "exact", head: true })
        .eq("id", ids.amendmentDoaMatrix),
    ],
    [
      "legal.accreditation_cases",
      client
        .schema("legal")
        .from("accreditation_cases")
        .select("id", { count: "exact", head: true })
        .eq("id", ids.accreditationCase),
    ],
    [
      "legal.accreditation_dispositions",
      client
        .schema("legal")
        .from("accreditation_dispositions")
        .select("id", { count: "exact", head: true })
        .eq("case_id", ids.accreditationCase),
    ],
    [
      "warehouse.products",
      client
        .schema("warehouse")
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("id", ids.product),
    ],
    [
      "warehouse.receipts",
      client
        .schema("warehouse")
        .from("receipts")
        .select("id", { count: "exact", head: true })
        .in("procurement_po_id", poIds),
    ],
    [
      "warehouse.routine quality receipt",
      client
        .schema("warehouse")
        .from("receipts")
        .select("id", { count: "exact", head: true })
        .eq("id", ids.routineQualityReceipt),
    ],
    [
      "warehouse.vendor_returns",
      client
        .schema("warehouse")
        .from("vendor_returns")
        .select("id", { count: "exact", head: true })
        .like("reference", `${marker}%`),
    ],
    [
      "warehouse.command_log",
      client
        .schema("warehouse")
        .from("command_log")
        .select("id", { count: "exact", head: true })
        .like("idempotency_key", `${marker}%`),
    ],
    [
      "warehouse.movements",
      client
        .schema("warehouse")
        .from("movements")
        .select("id", { count: "exact", head: true })
        .eq("product_id", ids.product),
    ],
    [
      "warehouse.stock_levels",
      client
        .schema("warehouse")
        .from("stock_levels")
        .select("product_id", { count: "exact", head: true })
        .eq("product_id", ids.product),
    ],
    [
      "warehouse.stock_change_requests",
      client
        .schema("warehouse")
        .from("stock_change_requests")
        .select("id", { count: "exact", head: true })
        .in("source_id", [ids.cycleCount, ids.selfCycleCount]),
    ],
    [
      "warehouse.cycle_counts",
      client
        .schema("warehouse")
        .from("cycle_counts")
        .select("id", { count: "exact", head: true })
        .in("id", [ids.cycleCount, ids.selfCycleCount]),
    ],
    [
      "warehouse.suppliers",
      client
        .schema("warehouse")
        .from("suppliers")
        .select("id", { count: "exact", head: true })
        .eq("id", `proc-${ids.vendor}`),
    ],
  ];
  if (fixture.cleanupReceiptIds?.length)
    checks.push(
      [
        "warehouse.quality_inspections",
        client
          .schema("warehouse")
          .from("quality_inspections")
          .select("id", { count: "exact", head: true })
          .in("source_id", fixture.cleanupReceiptIds),
      ],
      [
        "warehouse.exceptions",
        client
          .schema("warehouse")
          .from("exceptions")
          .select("id", { count: "exact", head: true })
          .in("source_id", [
            ...fixture.cleanupReceiptIds,
            ...(fixture.cleanupStockRequestIds ?? []),
          ]),
      ],
    );
  if (ids.excessAmendment)
    checks.push([
      "procurement.purchase_order_amendment_steps",
      client
        .schema("procurement")
        .from("purchase_order_amendment_steps")
        .select("id", { count: "exact", head: true })
        .eq("amendment_id", ids.excessAmendment),
    ]);
  if (fixture.cleanupQualityIds?.length)
    checks.push([
      "warehouse.inventory_holds",
      client
        .schema("warehouse")
        .from("inventory_holds")
        .select("id", { count: "exact", head: true })
        .in("inspection_id", fixture.cleanupQualityIds),
    ]);
  if (fixture.cleanupHoldIds?.length)
    checks.push(
      [
        "warehouse.inventory_holds by UUID",
        client
          .schema("warehouse")
          .from("inventory_holds")
          .select("id", { count: "exact", head: true })
          .in("id", fixture.cleanupHoldIds),
      ],
      [
        "core.activity_log hold-release activity",
        client
          .schema("core")
          .from("activity_log")
          .select("id", { count: "exact", head: true })
          .in("entity_id", fixture.cleanupHoldIds),
      ],
    );
  if (fixture.cleanupStockRequestIds?.length)
    checks.push([
      "core.approvals",
      client
        .schema("core")
        .from("approvals")
        .select("id", { count: "exact", head: true })
        .eq("entity_type", "warehouse_stock_change")
        .in("entity_id", fixture.cleanupStockRequestIds),
    ]);
  if (fixture.cleanupDecisionIds?.length)
    checks.push([
      "warehouse.procurement_receipt_exception_decisions",
      client
        .schema("warehouse")
        .from("procurement_receipt_exception_decisions")
        .select("id", { count: "exact", head: true })
        .in("id", fixture.cleanupDecisionIds),
    ]);
  if (fixture.cleanupDecisionIds?.length)
    checks.push(
      [
        "warehouse.procurement_receipt_exception_lines",
        client
          .schema("warehouse")
          .from("procurement_receipt_exception_lines")
          .select("decision_id", { count: "exact", head: true })
          .in("decision_id", fixture.cleanupDecisionIds),
      ],
      [
        "warehouse.unidentified_receipt_custody",
        client
          .schema("warehouse")
          .from("unidentified_receipt_custody")
          .select("decision_id", { count: "exact", head: true })
          .in("decision_id", fixture.cleanupDecisionIds),
      ],
      [
        "warehouse.procurement_receipt_excess_custody",
        client
          .schema("warehouse")
          .from("procurement_receipt_excess_custody")
          .select("decision_id", { count: "exact", head: true })
          .in("decision_id", fixture.cleanupDecisionIds),
      ],
    );
  if (fixture.cleanupExceptionIds?.length)
    checks.push([
      "warehouse.exceptions by id",
      client
        .schema("warehouse")
        .from("exceptions")
        .select("id", { count: "exact", head: true })
        .in("id", fixture.cleanupExceptionIds),
    ]);
  if (fixture.cleanupActivityEntityIds?.length)
    checks.push([
      "core.activity_log exact entities",
      client
        .schema("core")
        .from("activity_log")
        .select("id", { count: "exact", head: true })
        .in("entity_id", fixture.cleanupActivityEntityIds),
    ]);
  checks.push([
    "procurement.acceptance_reviewer_assignments",
    client
      .schema("procurement")
      .from("acceptance_reviewer_assignments")
      .select("request_id", { count: "exact", head: true })
      .eq("request_id", ids.request),
  ]);
  checks.push([
    "warehouse.events",
    client
      .schema("warehouse")
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("id", ids.event),
  ]);
  checks.push([
    "core.roles Task 3 approval fixtures",
    client
      .schema("core")
      .from("roles")
      .select("role", { count: "exact", head: true })
      .eq("module", "warehouse")
      .in("role", [ids.activeApprovalRole, ids.inactiveApprovalRole]),
  ]);
  checks.push([
    "core.user_roles Task 3 approval fixtures",
    client
      .schema("core")
      .from("user_roles")
      .select("role", { count: "exact", head: true })
      .eq("module", "warehouse")
      .in("role", [ids.activeApprovalRole, ids.inactiveApprovalRole]),
  ]);
  for (const [name, query] of checks) {
    const { count, error } = await query;
    if (error || count !== 0)
      throw new Error(
        `${name} has ${count ?? "unknown"} residual Task 3 rows: ${error?.message ?? ""}`,
      );
  }
}

async function cleanupTask3ReceiptFixture(fixture) {
  const { client, ids, marker } = fixture;
  const { poIds } = fixture;
  const remove = async (schema, table, configure) => {
    const { error } = await configure(
      client.schema(schema).from(table).delete(),
    );
    if (error)
      throw new Error(
        `${schema}.${table} Task 3 cleanup failed: ${error.message}`,
      );
  };
  const { error: restoreGroupError } = await client
    .schema("core")
    .from("approval_groups")
    .update({ member_roles: fixture.approvalGroupOriginalRoles })
    .eq("entity_type", "warehouse_stock_change")
    .eq("group_code", "logistics_supervisor");
  if (restoreGroupError)
    throw new Error(
      `Approval-group role cleanup failed: ${restoreGroupError.message}`,
    );
  const { data: receiptRows, error: receiptError } = await client
    .schema("warehouse")
    .from("receipts")
    .select("id")
    .in("procurement_po_id", poIds);
  if (receiptError)
    throw new Error(
      `Warehouse receipt cleanup lookup failed: ${receiptError.message}`,
    );
  const receiptIds = [
    ...new Set(
      [
        ...(receiptRows ?? []).map((row) => row.id),
        ids.quarantineReceipt,
        ids.routineQualityReceipt,
        ids.qualityRaceReceipt,
        ids.serializedIssueReceipt,
      ].filter(Boolean),
    ),
  ];
  let qualityRows = [];
  if (receiptIds.length) {
    const { data, error } = await client
      .schema("warehouse")
      .from("quality_inspections")
      .select("id")
      .in("source_id", receiptIds);
    if (error)
      throw new Error(`Quality cleanup lookup failed: ${error.message}`);
    qualityRows = data ?? [];
  }
  const qualityIds = qualityRows.map((row) => row.id);
  let holdRows = [];
  if (qualityIds.length) {
    const { data, error } = await client
      .schema("warehouse")
      .from("inventory_holds")
      .select("id")
      .in("inspection_id", qualityIds);
    if (error) throw new Error(`Hold cleanup lookup failed: ${error.message}`);
    holdRows = data ?? [];
  }
  const holdIds = [
    ...new Set([
      ...holdRows.map((row) => row.id),
      ...(fixture.cleanupHoldIds ?? []),
    ]),
  ];
  const { data: requestRows, error: requestError } = await client
    .schema("warehouse")
    .from("stock_change_requests")
    .select("id")
    .in("source_id", [ids.cycleCount, ids.selfCycleCount]);
  if (requestError)
    throw new Error(`Variance cleanup lookup failed: ${requestError.message}`);
  const stockRequestIds = [
    ...new Set([
      ...(requestRows ?? []).map((row) => row.id),
      ...(fixture.cleanupStockRequestIds ?? []),
    ]),
  ];
  const exceptionSourceIds = [
    ...receiptIds,
    ...stockRequestIds.map(String),
    ...qualityIds.map(String),
  ];
  let exceptionRows = [];
  if (exceptionSourceIds.length) {
    const { data, error } = await client
      .schema("warehouse")
      .from("exceptions")
      .select("id")
      .in("source_id", exceptionSourceIds);
    if (error)
      throw new Error(`Exception cleanup lookup failed: ${error.message}`);
    exceptionRows = data ?? [];
  }
  const exceptionIds = [
    ...new Set([
      ...exceptionRows.map((row) => row.id),
      ...(fixture.cleanupExceptionIds ?? []),
    ]),
  ];
  let decisionRows = [];
  if (receiptIds.length) {
    const { data, error } = await client
      .schema("warehouse")
      .from("procurement_receipt_exception_decisions")
      .select("id")
      .in("receipt_id", receiptIds);
    if (error)
      throw new Error(
        `Receipt decision cleanup lookup failed: ${error.message}`,
      );
    decisionRows = data ?? [];
  }
  const decisionIds = [
    ...new Set([
      ...decisionRows.map((row) => row.id),
      ...(fixture.cleanupDecisionIds ?? []),
    ]),
  ];
  fixture.cleanupReceiptIds = receiptIds;
  fixture.cleanupQualityIds = qualityIds;
  fixture.cleanupStockRequestIds = stockRequestIds;
  fixture.cleanupExceptionIds = exceptionIds;
  fixture.cleanupDecisionIds = decisionIds;
  fixture.cleanupHoldIds = holdIds;
  fixture.cleanupActivityEntityIds = [
    ...new Set([
      ...(fixture.cleanupActivityEntityIds ?? []),
      ...stockRequestIds.map(String),
      ...qualityIds.map(String),
      ...holdIds.map(String),
      ...exceptionIds.map(String),
      ...decisionIds.map(String),
    ]),
  ];

  if (decisionIds.length) {
    await remove("warehouse", "procurement_receipt_excess_custody", (query) =>
      query.in("decision_id", decisionIds),
    );
    await remove("warehouse", "unidentified_receipt_custody", (query) =>
      query.in("decision_id", decisionIds),
    );
    await remove("warehouse", "procurement_receipt_exception_lines", (query) =>
      query.in("decision_id", decisionIds),
    );
  }
  if (holdIds.length)
    await remove("warehouse", "vendor_returns", (query) =>
      query.in("hold_id", holdIds),
    );
  if (holdIds.length)
    await remove("warehouse", "inventory_holds", (query) =>
      query.in("id", holdIds),
    );
  if (decisionIds.length)
    await remove(
      "warehouse",
      "procurement_receipt_exception_decisions",
      (query) => query.in("id", decisionIds),
    );
  if (stockRequestIds.length)
    await remove("core", "approvals", (query) =>
      query
        .eq("entity_type", "warehouse_stock_change")
        .in("entity_id", stockRequestIds),
    );
  if (exceptionIds.length)
    await remove("warehouse", "exceptions", (query) =>
      query.in("id", exceptionIds),
    );
  await remove("core", "documents", (query) =>
    query.like("storage_path", `audit/${marker}/%`),
  );
  await remove("warehouse", "command_log", (query) =>
    query.like("idempotency_key", `${marker}%`),
  );
  await remove("warehouse", "movements", (query) =>
    query.in("product_id", [ids.product, ids.serializedIssueProduct]),
  );
  if (receiptIds.length) {
    await remove("warehouse", "quality_inspections", (query) =>
      query.in("source_id", receiptIds),
    );
    await remove("warehouse", "receipts", (query) =>
      query.in("id", receiptIds),
    );
  }
  await remove("warehouse", "stock_change_requests", (query) =>
    query.in("source_id", [ids.cycleCount, ids.selfCycleCount]),
  );
  if (stockRequestIds.length)
    await remove("warehouse", "stock_change_requests", (query) =>
      query.in("id", stockRequestIds),
    );
  await remove("warehouse", "cycle_counts", (query) =>
    query.in("id", [ids.cycleCount, ids.selfCycleCount]),
  );
  await remove("warehouse", "stock_levels", (query) =>
    query.eq("product_id", ids.product),
  );
  await remove("warehouse", "allocations", (query) =>
    query.eq("event_id", ids.event),
  );
  await remove("warehouse", "inventory_units", (query) =>
    query.in("product_id", [ids.product, ids.serializedIssueProduct]),
  );
  await remove("warehouse", "events", (query) => query.eq("id", ids.event));
  await remove("warehouse", "suppliers", (query) =>
    query.eq("id", `proc-${ids.vendor}`),
  );
  await remove("procurement", "payment_readiness_staleness_events", (query) =>
    query.in("purchase_order_id", poIds),
  );
  await remove("procurement", "payment_readiness_packs", (query) =>
    query.in("purchase_order_id", poIds),
  );
  await remove("procurement", "acceptance_packs", (query) =>
    query.in("purchase_order_id", poIds),
  );
  await remove("procurement", "acceptance_reviewer_assignments", (query) =>
    query.eq("request_id", ids.request),
  );
  if (ids.excessAmendment)
    await remove("procurement", "purchase_order_amendment_steps", (query) =>
      query.eq("amendment_id", ids.excessAmendment),
    );
  await remove("procurement", "purchase_order_amendments", (query) =>
    query.in("purchase_order_id", poIds),
  );
  await remove("procurement", "purchase_order_lines", (query) =>
    query.in("purchase_order_id", poIds),
  );
  await remove("procurement", "purchase_orders", (query) =>
    query.in("id", poIds),
  );
  await remove("procurement", "exception_packs", (query) =>
    query.in("request_id", [ids.policyDirect, ids.policyPetty]),
  );
  await remove("procurement", "policy_evidence", (query) =>
    query.like("request_id", `${marker}%`),
  );
  await remove("procurement", "route_decisions", (query) =>
    query.like("request_id", `${marker}%`),
  );
  await remove("legal", "accreditation_dispositions", (query) =>
    query.eq("case_id", ids.accreditationCase),
  );
  await remove("legal", "accreditation_cases", (query) =>
    query.eq("id", ids.accreditationCase),
  );
  await remove("procurement", "requests", (query) =>
    query.like("id", `${marker}%`),
  );
  await remove("procurement", "doa_assignments", (query) =>
    query.in("id", ids.amendmentDoaAssignments),
  );
  await remove("procurement", "doa_matrices", (query) =>
    query.eq("id", ids.amendmentDoaMatrix),
  );
  await remove("warehouse", "products", (query) =>
    query.in("id", [ids.product, ids.serializedIssueProduct]),
  );
  await remove("core", "user_roles", (query) =>
    query
      .eq("module", "warehouse")
      .in("role", [ids.activeApprovalRole, ids.inactiveApprovalRole]),
  );
  await remove("core", "role_capabilities", (query) =>
    query
      .eq("module", "warehouse")
      .in("role", [ids.activeApprovalRole, ids.inactiveApprovalRole]),
  );
  await remove("core", "roles", (query) =>
    query
      .eq("module", "warehouse")
      .in("role", [ids.activeApprovalRole, ids.inactiveApprovalRole]),
  );
  if (fixture.cleanupActivityEntityIds.length)
    await remove("core", "activity_log", (query) =>
      query.in("entity_id", fixture.cleanupActivityEntityIds),
    );
  await remove("core", "activity_log", (query) =>
    query.like("entity_id", `${marker}%`),
  );
  await remove("core", "vendors", (query) =>
    query.in("id", [ids.vendor, ids.expiredVendor]),
  );
  await assertTask3ZeroResidualRows(fixture);
  return {
    entity: "task3-receipt-fixture",
    marker,
    removed: true,
    remaining: 0,
  };
}

async function cleanupGovernedWorkflowActivity(marker) {
  const client = createAuditDatabaseClient();
  const { data: requestRows, error: requestError } = await client
    .schema("procurement")
    .from("requests")
    .select("id")
    .eq("title", `${marker} Procurement draft`);
  if (requestError)
    throw new Error(
      `Procurement activity cleanup lookup failed: ${requestError.message}`,
    );

  const { data: matrixRows, error: matrixError } = await client
    .schema("procurement")
    .from("doa_matrices")
    .select("id")
    .eq("department", `${marker} Department`)
    .eq("version", `${marker}-V1`);
  if (matrixError)
    throw new Error(
      `DOA activity cleanup lookup failed: ${matrixError.message}`,
    );

  const entityIds = [
    ...new Set([
      ...(requestRows ?? []).map((row) => String(row.id)),
      ...(matrixRows ?? []).map((row) => String(row.id)),
    ]),
  ];
  if (!entityIds.length)
    return {
      entity: "governed-workflow-activity",
      marker,
      removed: true,
      remaining: 0,
    };

  const { data: activityRows, error: activityError } = await client
    .schema("core")
    .from("activity_log")
    .select("id,entity_id,detail")
    .in("entity_id", entityIds);
  if (activityError)
    throw new Error(
      `Governed activity cleanup lookup failed: ${activityError.message}`,
    );

  const unexpectedRows = (activityRows ?? []).filter(
    (row) =>
      !entityIds.includes(String(row.entity_id)) ||
      !JSON.stringify(row.detail ?? {}).includes(marker),
  );
  if (unexpectedRows.length)
    throw new Error(
      `Governed activity cleanup refused ${unexpectedRows.length} row(s) without run-marker proof.`,
    );

  const activityIds = (activityRows ?? []).map((row) => row.id);
  if (activityIds.length) {
    const { error: deleteError } = await client
      .schema("core")
      .from("activity_log")
      .delete()
      .in("id", activityIds);
    if (deleteError)
      throw new Error(
        `Governed activity cleanup failed: ${deleteError.message}`,
      );
  }

  const { count, error: verificationError } = await client
    .schema("core")
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .in("entity_id", entityIds);
  if (verificationError || count !== 0)
    throw new Error(
      `Governed activity cleanup left ${count ?? "unknown"} row(s): ${verificationError?.message ?? ""}`,
    );

  return {
    entity: "governed-workflow-activity",
    marker,
    removed: true,
    remaining: 0,
  };
}

async function cleanupVendorInviteCommands(marker) {
  const client = createAuditDatabaseClient();
  const { data: invites, error: lookupError } = await client
    .schema("legal")
    .from("vendor_invites")
    .select("id,company_name")
    .eq("company_name", `${marker} Vendor`);
  if (lookupError) throw new Error(lookupError.message);
  if (
    (invites ?? []).some((invite) => invite.company_name !== `${marker} Vendor`)
  ) {
    throw new Error("Vendor invite cleanup refused an unscoped command.");
  }
  const inviteIds = (invites ?? []).map((invite) => invite.id);
  if (inviteIds.length) {
    const { error: deleteError } = await client
      .schema("legal")
      .from("vendor_invite_commands")
      .delete()
      .in("invite_id", inviteIds);
    if (deleteError) throw new Error(deleteError.message);
  }
  const { count, error: verifyError } = inviteIds.length
    ? await client
        .schema("legal")
        .from("vendor_invite_commands")
        .select("id", { count: "exact", head: true })
        .in("invite_id", inviteIds)
    : { count: 0, error: null };
  if (verifyError || count !== 0) {
    throw new Error(
      `Vendor invite command cleanup left ${count ?? "unknown"} row(s): ${verifyError?.message ?? ""}`,
    );
  }
  return {
    entity: "legal.vendor_invite_commands",
    marker,
    removed: true,
    remaining: 0,
  };
}

async function cleanupEventWorkflowDependencies(marker) {
  const client = createAuditDatabaseClient();
  const eventNames = [`${marker} Event`, `${marker} Intra Event`];
  const { data: events, error: eventError } = await client
    .schema("warehouse")
    .from("events")
    .select("id,name")
    .in("name", eventNames);
  if (eventError)
    throw new Error(`Event cleanup lookup failed: ${eventError.message}`);
  if ((events ?? []).some((event) => !String(event.name).includes(marker)))
    throw new Error("Event cleanup refused a row without run-marker proof.");

  const { data: requests, error: requestError } = await client
    .schema("warehouse")
    .from("department_stock_requests")
    .select("id,purpose")
    .eq("purpose", `${marker} event fulfillment`);
  if (requestError)
    throw new Error(
      `Event request cleanup lookup failed: ${requestError.message}`,
    );
  if (
    (requests ?? []).some(
      (request) => !String(request.purpose).includes(marker),
    )
  )
    throw new Error(
      "Event request cleanup refused a row without run-marker proof.",
    );

  const eventIds = (events ?? []).map((event) => event.id);
  const requestIds = (requests ?? []).map((request) => request.id);
  if (eventIds.length) {
    const { error } = await client
      .schema("warehouse")
      .from("event_lifecycle_events")
      .delete()
      .in("event_id", eventIds);
    if (error)
      throw new Error(`Event lifecycle cleanup failed: ${error.message}`);
  }
  const activityEntityIds = [...eventIds, ...requestIds];
  if (activityEntityIds.length) {
    const { error } = await client
      .schema("core")
      .from("activity_log")
      .delete()
      .in("entity_id", activityEntityIds);
    if (error)
      throw new Error(`Event activity cleanup failed: ${error.message}`);
  }
  return {
    entity: "event-workflow-dependencies",
    marker,
    removed: true,
    remaining: 0,
  };
}

async function procurementReceiptAuthorityWorkflow(page) {
  await page.goto(
    `${baseUrl}/procurement/purchase-orders?workflow=${Date.now()}`,
    {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    },
  );
  await waitForMeaningfulRoute(page);
  if (
    await page
      .getByRole("button", { name: /receive items|record receipt/i })
      .count()
  )
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
  if (removedCommand.ok)
    throw new Error("Removed Procurement receipt RPC executed successfully.");
  if (
    warehouseDenial.ok ||
    !/not authorized|permission|denied/i.test(warehouseDenial.body)
  )
    throw new Error(
      `Procurement officer Warehouse RPC denial was not enforced (${warehouseDenial.status}).`,
    );
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
  for (const label of [
    "Receive and inspect",
    "Put away",
    "Pick or issue",
    "Returns and counts",
  ])
    await page
      .getByRole("link", { name: label, exact: true })
      .first()
      .waitFor({ state: "visible" });
  const body = await page.locator("body").innerText();
  if (/Data & Reports|Pricing workspace|New event|New PO/i.test(body))
    throw new Error(
      "Warehouse Operator surface exposes an advanced or authoring workflow.",
    );
  return {
    name: "warehouse operator routine surface",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function warehouseSupervisorControlWorkflow(page) {
  for (const [route, expected] of [
    ["/warehouse/quality", /controlled exception disposition/i],
    ["/warehouse/approvals", /delegation never permits the requester/i],
    [
      "/warehouse/cycle-counts",
      /material variance requires a different Warehouse Supervisor/i,
    ],
  ]) {
    await page.goto(`${baseUrl}${route}?workflow=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForMeaningfulRoute(page);
    await page
      .getByText(expected)
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .catch(() => {});
    if (!expected.test(await page.locator("body").innerText()))
      throw new Error(
        `Supervisor control contract missing at ${route}: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 240)}`,
      );
  }
  return {
    name: "warehouse supervisor controlled exceptions",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function warehouseReceivingValidationWorkflow(page, { captureState }) {
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
  await captureState("Receiving unknown barcode validation");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  return {
    name: "warehouse receiving validation",
    ok: await page.getByRole("button", { name: "Add to receipt" }).isDisabled(),
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function warehouseQualityValidationWorkflow(page, { captureState }) {
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
  const inspect = page
    .getByRole("button", { name: "Inspect", exact: true })
    .first();
  if (!(await inspect.count()))
    return {
      name: "warehouse quality validation",
      ok: /No inspections waiting/i.test(
        await page.locator("body").innerText(),
      ),
      finalUrl: page.url().replace(baseUrl, ""),
    };
  await inspect.click();
  const dialog = page.getByRole("dialog", { name: "Inspect stock" });
  const submit = dialog.getByRole("button", { name: "Submit inspection" });
  if (!(await submit.isDisabled()))
    throw new Error("Quality inspection bypassed required evidence.");
  await captureState("Quality evidence-required dialog");
  await dialog.getByLabel("Disposition").selectOption("hold");
  if (!(await submit.isDisabled()))
    throw new Error("Quality hold bypassed reason and evidence validation.");
  await captureState("Quality hold validation");
  await dialog.getByRole("button", { name: "Close" }).click();
  return {
    name: "warehouse quality validation",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function warehouseCycleCountValidationWorkflow(page, { captureState }) {
  await page.goto(`${baseUrl}/warehouse/cycle-counts?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByLabel("Category").selectOption("device");
  await page.getByLabel("Enter barcode manually").fill("QA-UNKNOWN-UNIT");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator('p[role="alert"]').waitFor({ state: "visible" });
  await captureState("Cycle count unknown unit validation");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  return {
    name: "warehouse cycle count validation",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function warehouseReturnValidationWorkflow(page, { captureState }) {
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
    await captureState("Return unknown serial validation");
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

async function eventsCreateAndReadbackWorkflow(
  page,
  marker,
  state,
  { captureState },
) {
  const eventName = `${marker} Intra Event`;
  await page.goto(`${baseUrl}/events?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByRole("button", { name: "New event", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create event" });
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await page.getByText("Event name is required.").waitFor({ state: "visible" });
  await captureState("Event required-field validation");
  await dialog.getByLabel("Event name").fill(eventName);
  await dialog.getByLabel("Start date").fill("2027-08-15");
  await dialog.getByLabel("End date").fill("2027-08-14");
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await page
    .getByText("End date cannot be before the start date.")
    .waitFor({ state: "visible" });
  await captureState("Event date validation");
  await dialog.getByLabel("End date").fill("2027-08-16");
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await page.getByText(eventName, { exact: true }).first().waitFor({
    state: "visible",
  });
  await captureState("Event creation success");
  const checkpoint = await verifyCheckpoint({
    schema: "warehouse",
    table: "events",
    filters: { name: eventName },
    expected: {
      name: eventName,
      type: "corporate",
      start_date: "2027-08-15",
      end_date: "2027-08-16",
    },
    select: "id,name,type,start_date,end_date",
  });
  const db = createAuditDatabaseClient();
  const { data: rows, error } = await db
    .schema("warehouse")
    .from("events")
    .select("id")
    .eq("name", eventName)
    .limit(1);
  if (error || !rows?.[0]?.id) {
    throw new Error(
      `Events readback failed: ${error?.message ?? "missing id"}`,
    );
  }
  state.eventId = rows[0].id;
  state.eventName = eventName;
  const duplicate = await callRpcAsBrowserUser(
    page,
    "warehouse",
    "create_event",
    {
      event: {
        id: state.eventId,
        name: eventName,
        type: "corporate",
        start_date: "2027-08-15",
        end_date: "2027-08-16",
        site_location_id: null,
      },
    },
  );
  if (duplicate.ok) {
    throw new Error("Duplicate Events replay created a second event.");
  }
  const { count: duplicateCount, error: duplicateError } = await db
    .schema("warehouse")
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("id", state.eventId);
  if (duplicateError) {
    throw new Error(
      `Duplicate Events readback failed: ${duplicateError.message}`,
    );
  }
  if (duplicateCount !== 1) {
    throw new Error(`Duplicate Events replay left ${duplicateCount} rows.`);
  }
  return {
    name: "Events request creation and persistence readback",
    ok: true,
    checkpoint,
    eventId: state.eventId,
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function eventsViewerMutationDenialWorkflow(page, marker) {
  const deniedName = `${marker} Viewer Forbidden Event`;
  await page.goto(`${baseUrl}/events?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  if (
    await page.getByRole("button", { name: "New event", exact: true }).count()
  ) {
    throw new Error("Events viewer was shown the create-event control.");
  }
  const result = await callRpcAsBrowserUser(page, "warehouse", "create_event", {
    event: {
      id: `evt-${marker.toLowerCase()}-viewer-denied`,
      name: deniedName,
      type: "corporate",
      start_date: "2027-08-15",
      end_date: "2027-08-16",
      site_location_id: null,
    },
  });
  if (result.ok) {
    throw new Error("Events viewer created an event through the governed RPC.");
  }
  const db = createAuditDatabaseClient();
  const { count, error } = await db
    .schema("warehouse")
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("name", deniedName);
  if (error) throw new Error(`Denied event readback failed: ${error.message}`);
  if (count !== 0) throw new Error("Denied Events mutation persisted a row.");
  return {
    name: "Events viewer create denial",
    ok: true,
    denialStatus: result.status,
  };
}

async function eventsCoordinatorReadbackWorkflow(page, state) {
  if (!state.eventId || !state.eventName) {
    throw new Error("Events coordinator handoff requires a created event.");
  }
  await page.goto(`${baseUrl}/events/${encodeURIComponent(state.eventId)}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page
    .getByRole("heading", { name: state.eventName, exact: true })
    .waitFor({
      state: "visible",
    });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  await page
    .getByRole("heading", { name: state.eventName, exact: true })
    .waitFor({
      state: "visible",
    });
  const requestButton = page.getByRole("button", {
    name: "Request warehouse stock",
    exact: true,
  });
  if ((await requestButton.count()) === 0)
    throw new Error("Events coordinator cannot request Warehouse stock.");
  await requestButton.click();
  const requestDialog = page.getByRole("dialog", {
    name: "Request warehouse stock",
  });
  state.fulfillmentPurpose = `${state.marker} event fulfillment`;
  await requestDialog.getByLabel("Department").fill("Marketing");
  await requestDialog
    .getByLabel("Business purpose")
    .fill(state.fulfillmentPurpose);
  await requestDialog.getByLabel("Cost center").fill("MKT-UAT");
  const product = requestDialog.getByLabel("Product");
  if (!(await product.inputValue()))
    throw new Error("Events handoff has no eligible Warehouse product.");
  await requestDialog
    .getByRole("button", { name: "Submit for approval", exact: true })
    .click();
  await requestDialog.waitFor({ state: "detached" });
  const db = createAuditDatabaseClient();
  const { data: requests, error } = await db
    .schema("warehouse")
    .from("department_stock_requests")
    .select("id,event_id,requesting_department,purpose,status")
    .eq("event_id", state.eventId)
    .eq("purpose", state.fulfillmentPurpose)
    .limit(1);
  if (error || !requests?.[0])
    throw new Error(
      `Events Warehouse handoff readback failed: ${error?.message ?? "missing request"}`,
    );
  if (requests[0].status !== "pending_approval")
    throw new Error(`Events Warehouse handoff entered ${requests[0].status}.`);
  state.fulfillmentRequestId = requests[0].id;
  return {
    name: "Events coordinator refresh and Warehouse handoff",
    ok: true,
    requestId: state.fulfillmentRequestId,
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

async function warehouseEventHandoffWorkflow(page, state) {
  if (!state.eventId || !state.eventName || !state.fulfillmentPurpose) {
    throw new Error("Warehouse handoff requires a persisted stock request.");
  }
  await page.goto(`${baseUrl}/warehouse/fulfillment?handoff=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByRole("tab", { name: "Department requests" }).click();
  await page
    .getByText(state.fulfillmentPurpose, { exact: true })
    .first()
    .waitFor({
      state: "visible",
    });
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (!/pending|approval|department request/i.test(text))
    throw new Error("Warehouse handoff does not expose the approval state.");
  return {
    name: "Events-to-Warehouse operational handoff",
    ok: true,
    finalUrl: page.url().replace(baseUrl, ""),
  };
}

const INSIGHT_ROLE_AREAS = {
  leadership_insights: {
    visible: ["Warehouse", "Procurement", "Legal", "Finance", "Executive"],
    hidden: [],
  },
  insights_analyst: {
    visible: ["Warehouse", "Procurement", "Legal", "Finance"],
    hidden: ["Executive"],
  },
  insights_manager: {
    visible: ["Warehouse", "Procurement", "Legal", "Finance", "Executive"],
    hidden: [],
  },
  insights_executive: {
    visible: ["Executive"],
    hidden: ["Warehouse", "Procurement", "Legal", "Finance"],
  },
  insights_admin: {
    visible: ["Warehouse", "Procurement", "Legal", "Finance", "Executive"],
    hidden: [],
  },
};

async function insightsGovernanceWorkflow(page, role) {
  const contract = INSIGHT_ROLE_AREAS[role];
  if (!contract) throw new Error(`No Insights area contract for ${role}.`);
  await page.goto(`${baseUrl}/insights?governance=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  const mobileAreaSelect = page.getByLabel("Insight view", { exact: true });
  if (await mobileAreaSelect.isVisible().catch(() => false)) {
    const availableAreas = await mobileAreaSelect
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => option.textContent?.trim()),
      );
    for (const area of contract.visible) {
      if (!availableAreas.includes(area)) {
        throw new Error(`${role} is missing the ${area} Insights scope.`);
      }
    }
    for (const area of contract.hidden) {
      if (availableAreas.includes(area)) {
        throw new Error(`${role} received forbidden ${area} Insights scope.`);
      }
    }
  } else {
    for (const area of contract.visible) {
      await page.getByRole("tab", { name: area, exact: true }).waitFor({
        state: "visible",
      });
    }
    for (const area of contract.hidden) {
      if (await page.getByRole("tab", { name: area, exact: true }).count()) {
        throw new Error(`${role} received forbidden ${area} Insights scope.`);
      }
    }
  }
  const indicator = page.locator('[aria-label="Operational indicators"]');
  await indicator.waitFor({ state: "visible" });
  const beforeRefresh = (await indicator.innerText())
    .replace(/\s+/g, " ")
    .trim();
  const sourceLinks = indicator.getByRole("link", {
    name: "Open governed source",
    exact: true,
  });
  if ((await sourceLinks.count()) === 0) {
    throw new Error(`${role} has no governed source links.`);
  }
  for (const href of await sourceLinks.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  )) {
    if (!href || href === "#" || href.startsWith("javascript:")) {
      throw new Error(`${role} has a dead governed source link.`);
    }
  }
  const denied = await callRestAsBrowserUser(
    page,
    "core",
    "v_insights_snapshot",
    {
      body: {
        id: `${auditRunId}-forbidden-insight`,
        area: "executive",
        label: "Forbidden write",
        value: 1,
      },
    },
  );
  if (denied.ok) {
    throw new Error(`${role} mutated the read-only Insights snapshot.`);
  }
  const db = createAuditDatabaseClient();
  const { count: forbiddenCount, error: forbiddenError } = await db
    .schema("core")
    .from("v_insights_snapshot")
    .select("id", { count: "exact", head: true })
    .eq("id", `${auditRunId}-forbidden-insight`);
  if (forbiddenError) {
    throw new Error(
      `Insights denial readback failed: ${forbiddenError.message}`,
    );
  }
  if (forbiddenCount !== 0) {
    throw new Error(`${role} denied Insights write persisted a row.`);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  const afterRefresh = (
    await page.locator('[aria-label="Operational indicators"]').innerText()
  )
    .replace(/\s+/g, " ")
    .trim();
  if (beforeRefresh !== afterRefresh) {
    throw new Error(
      `${role} Insights snapshot changed across an immediate refresh.`,
    );
  }
  return {
    name: `${role} Insights governance`,
    ok: true,
    visibleAreas: contract.visible,
    mutationDenialStatus: denied.status,
    sourceLinkCount: await sourceLinks.count().catch(() => 0),
  };
}

async function unifiedFinanceReadbackWorkflow(page, fixture) {
  const receiptId = fixture.ids.cleanReceipt;
  if (!receiptId)
    throw new Error("Unified Finance requires the governed receipt.");
  const db = createAuditDatabaseClient();
  const references = [fixture.ids.cleanPo, receiptId];
  const { data: rows, error } = await db
    .schema("core")
    .from("v_finance_activity")
    .select("source,ref_id,po_id,status")
    .in("ref_id", references);
  if (error) throw new Error(`Finance readback failed: ${error.message}`);
  const sources = new Set((rows ?? []).map((row) => row.source));
  if (!sources.has("procurement_po") || !sources.has("warehouse_receipt")) {
    throw new Error(
      `Unified Finance source readback incomplete: ${JSON.stringify(rows)}`,
    );
  }
  await page.goto(`${baseUrl}/finance?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByText("Warehouse Finance", { exact: true }).waitFor({
    state: "visible",
  });
  await page.getByText("Procurement Finance", { exact: true }).waitFor({
    state: "visible",
  });
  await page.getByRole("tab", { name: "POs", exact: true }).click();
  const poLink = page.getByRole("link", {
    name: fixture.ids.cleanPo,
    exact: true,
  });
  await poLink.waitFor({ state: "visible" });
  const poHref = await poLink.getAttribute("href");
  if (
    poHref !==
    `/procurement/purchase-orders/${encodeURIComponent(fixture.ids.cleanPo)}`
  ) {
    throw new Error(`Unified Finance PO source link is incorrect: ${poHref}`);
  }
  await page.getByRole("tab", { name: "Receipts", exact: true }).click();
  const receiptControl = page.getByRole("button", {
    name: `View ${receiptId} details`,
    exact: true,
  });
  await receiptControl.waitFor({ state: "visible" });
  await receiptControl.click();
  await page
    .getByRole("dialog", { name: `Finance activity ${receiptId}` })
    .waitFor({ state: "visible" });
  if (await page.getByRole("link", { name: receiptId, exact: true }).count()) {
    throw new Error("Unified Finance exposed an inaccessible receiving link.");
  }
  return {
    name: "Unified Finance cross-module readback",
    ok: true,
    checkpoint: {
      entity: "core.v_finance_activity",
      matched: rows.length,
      expectedSources: ["procurement_po", "warehouse_receipt"],
    },
  };
}

async function productContributorWorkflow(
  page,
  marker,
  fixture,
  state,
  { captureState },
) {
  const readinessTitle = `${marker} launch readiness`;
  const pricingReason = `${marker} governed pricing proposal`;
  await page.goto(`${baseUrl}/product?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByRole("heading", { name: "Product readiness" }).waitFor({
    state: "visible",
  });
  if (await page.getByRole("button", { name: "Approve go-live" }).count()) {
    throw new Error("Product contributor was offered the go-live decision.");
  }

  await page.getByRole("button", { name: "New readiness package" }).click();
  const readinessDialog = page.getByRole("dialog", {
    name: "New readiness package",
  });
  const readinessSubmit = readinessDialog.getByRole("button", {
    name: "Submit package",
  });
  if (!(await readinessSubmit.isDisabled())) {
    throw new Error("Incomplete Product readiness package was enabled.");
  }
  await captureState("Product readiness validation");
  await readinessDialog.getByLabel("Product ID").fill(fixture.ids.product);
  await readinessDialog.getByLabel("Readiness title").fill(readinessTitle);
  await readinessDialog.getByLabel("Evidence name").fill("UAT launch controls");
  await readinessDialog
    .getByLabel("Evidence reference")
    .fill(`audit://${marker}/product-readiness`);
  await readinessDialog
    .getByLabel("Launch conditions")
    .fill("Operations acknowledgement is required before launch.");
  await captureState("Product readiness ready to submit");
  await readinessSubmit.click();
  await page.getByRole("heading", { name: readinessTitle }).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Propose price" }).click();
  const priceDialog = page.getByRole("dialog", { name: "Propose price" });
  const priceSubmit = priceDialog.getByRole("button", {
    name: "Submit price proposal",
  });
  if (!(await priceSubmit.isDisabled())) {
    throw new Error("Incomplete Product price proposal was enabled.");
  }
  await priceDialog.getByLabel("Product ID").fill(fixture.ids.product);
  await priceDialog.getByLabel("Proposed price").fill("1250");
  await priceDialog.getByLabel("Cost basis").fill("800");
  await priceDialog.getByLabel("Reason").fill(pricingReason);
  await priceDialog
    .getByLabel("Effective date and time")
    .fill("2027-08-15T09:00");
  await captureState("Product pricing ready to submit");
  await priceSubmit.click();
  await page.getByText(pricingReason, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  const db = createAuditDatabaseClient();
  const [
    { data: readinessRows, error: readinessError },
    { data: priceRows, error: priceError },
  ] = await Promise.all([
    db
      .schema("product")
      .from("readiness_packages")
      .select("id,title,status,product_id,version")
      .eq("title", readinessTitle),
    db
      .schema("product")
      .from("price_proposals")
      .select("id,reason,status,product_id,version")
      .eq("reason", pricingReason),
  ]);
  if (readinessError || readinessRows?.length !== 1) {
    throw new Error(
      `Product readiness readback failed: ${readinessError?.message ?? JSON.stringify(readinessRows)}`,
    );
  }
  if (priceError || priceRows?.length !== 1) {
    throw new Error(
      `Product pricing readback failed: ${priceError?.message ?? JSON.stringify(priceRows)}`,
    );
  }
  state.readinessId = readinessRows[0].id;
  state.priceProposalId = priceRows[0].id;
  state.productId = fixture.ids.product;
  state.readinessTitle = readinessTitle;
  state.pricingReason = pricingReason;

  const unauthorized = await callRpcAsBrowserUser(
    page,
    "product",
    "decide_readiness_package",
    {
      id: state.readinessId,
      decision: "approved",
      note: "Unauthorized decision",
    },
  );
  if (unauthorized.ok || !/not authorized/i.test(unauthorized.body)) {
    throw new Error(
      `Product contributor decision was not denied (${unauthorized.status}: ${unauthorized.body}).`,
    );
  }
  await captureState("Product contributor submission success");
  return {
    name: "Product contributor readiness and pricing submission",
    ok: true,
    checkpoints: [
      {
        entity: "product.readiness_packages",
        id: state.readinessId,
        status: "submitted",
      },
      {
        entity: "product.price_proposals",
        id: state.priceProposalId,
        status: "submitted",
      },
    ],
    unauthorizedStatus: unauthorized.status,
  };
}

async function productOwnerDecisionWorkflow(page, state, { captureState }) {
  if (!state.readinessId || !state.priceProposalId) {
    throw new Error("Product owner workflow requires contributor submissions.");
  }
  await page.goto(`${baseUrl}/product?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  const readinessHeading = page.getByRole("heading", {
    name: state.readinessTitle,
    exact: true,
  });
  await readinessHeading.waitFor({ state: "visible" });
  const readinessCard = readinessHeading.locator("xpath=ancestor::article[1]");
  await readinessCard.getByRole("button", { name: "Approve go-live" }).click();
  const readinessDecision = page.getByRole("dialog", {
    name: "Approve go-live",
  });
  const readinessSubmit = readinessDecision.getByRole("button", {
    name: "Approve go-live",
  });
  if (!(await readinessSubmit.isDisabled())) {
    throw new Error("Product go-live decision note was not required.");
  }
  await captureState("Product go-live decision validation");
  await readinessDecision
    .getByLabel("Decision note")
    .fill("Approved after verified UAT launch evidence.");
  await readinessSubmit.click();
  await readinessCard.getByText("approved", { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  const priceReason = page.getByText(state.pricingReason, { exact: true });
  await priceReason.waitFor({ state: "visible" });
  const priceCard = priceReason.locator("xpath=ancestor::article[1]");
  await priceCard.getByRole("button", { name: "Approve price" }).click();
  const priceDecision = page.getByRole("dialog", { name: "Approve price" });
  await priceDecision
    .getByLabel("Decision note")
    .fill("Approved under governed pricing review.");
  await captureState("Product pricing decision ready");
  await priceDecision.getByRole("button", { name: "Approve price" }).click();
  await priceCard.getByText("approved", { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  const stale = await callRpcAsBrowserUser(
    page,
    "product",
    "decide_readiness_package",
    {
      id: state.readinessId,
      decision: "approved",
      note: "Duplicate stale Product decision",
    },
  );
  if (stale.ok || !/not awaiting decision/i.test(stale.body)) {
    throw new Error(
      `Stale Product decision was not denied (${stale.status}: ${stale.body}).`,
    );
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  await page.getByRole("heading", { name: state.readinessTitle }).waitFor({
    state: "visible",
  });
  const readinessCheckpoint = await verifyCheckpoint({
    schema: "product",
    table: "readiness_packages",
    filters: { id: state.readinessId },
    expected: { status: "approved", is_current: true },
    select: "id,status,is_current,decided_by,decided_at",
  });
  const pricingCheckpoint = await verifyCheckpoint({
    schema: "product",
    table: "price_proposals",
    filters: { id: state.priceProposalId },
    expected: { status: "approved" },
    select: "id,status,decided_by,decided_at",
  });
  await captureState("Product owner decisions persisted after refresh");
  return {
    name: "Product owner go-live and pricing decision",
    ok: true,
    checkpoints: [readinessCheckpoint, pricingCheckpoint],
    staleDenialStatus: stale.status,
  };
}

async function productOperationsHandoffWorkflow(page, state, { captureState }) {
  await page.goto(`${baseUrl}/product?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  const readinessHeading = page.getByRole("heading", {
    name: state.readinessTitle,
    exact: true,
  });
  await readinessHeading.waitFor({ state: "visible" });
  if (
    (await page.getByRole("button", { name: "Approve go-live" }).count()) ||
    (await page.getByRole("button", { name: "New readiness package" }).count())
  ) {
    throw new Error(
      "Operations partner was offered a Product authoring decision.",
    );
  }
  const card = readinessHeading.locator("xpath=ancestor::article[1]");
  await captureState("Operations Product handoff ready");
  await card
    .getByRole("button", { name: "Acknowledge Operations handoff" })
    .click();
  await card
    .getByRole("button", { name: /Acknowledg(?:e|ing) Operations handoff/ })
    .waitFor({ state: "hidden", timeout: 15_000 });

  const duplicate = await callRpcAsBrowserUser(
    page,
    "product",
    "acknowledge_operations_handoff",
    { id: state.readinessId },
  );
  if (
    duplicate.ok ||
    !/unavailable|already acknowledged/i.test(duplicate.body)
  ) {
    throw new Error(
      `Duplicate Operations handoff was not denied (${duplicate.status}: ${duplicate.body}).`,
    );
  }
  const unauthorized = await callRpcAsBrowserUser(
    page,
    "product",
    "decide_readiness_package",
    {
      id: state.readinessId,
      decision: "rejected",
      note: "Unauthorized Operations decision",
    },
  );
  if (unauthorized.ok || !/not authorized/i.test(unauthorized.body)) {
    throw new Error("Operations partner Product decision was not denied.");
  }
  const canLaunch = await callRpcAsBrowserUser(
    page,
    "product",
    "can_launch",
    { p_product_id: state.productId },
    { wrapPayload: false },
  );
  if (!canLaunch.ok || canLaunch.body !== "true") {
    throw new Error(
      `Product launch readback did not converge (${canLaunch.status}: ${canLaunch.body}).`,
    );
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  const checkpoint = await verifyCheckpoint({
    schema: "product",
    table: "readiness_packages",
    filters: { id: state.readinessId },
    expected: { status: "approved", is_current: true },
    select:
      "id,status,is_current,operations_acknowledged_by,operations_acknowledged_at",
  });
  const db = createAuditDatabaseClient();
  const { data: handoffRows, error } = await db
    .schema("product")
    .from("readiness_packages")
    .select("operations_acknowledged_by,operations_acknowledged_at")
    .eq("id", state.readinessId);
  if (
    error ||
    !handoffRows?.[0]?.operations_acknowledged_by ||
    !handoffRows?.[0]?.operations_acknowledged_at
  ) {
    throw new Error(
      `Operations handoff readback failed: ${error?.message ?? "missing acknowledgement"}.`,
    );
  }
  await captureState("Operations Product handoff persisted");
  return {
    name: "Operations Product handoff acknowledgement",
    ok: true,
    checkpoint,
    duplicateStatus: duplicate.status,
    unauthorizedStatus: unauthorized.status,
    canLaunch: true,
  };
}

async function cleanupProductGovernance(marker) {
  const db = createAuditDatabaseClient();
  const readinessTitle = `${marker} launch readiness`;
  const pricingReason = `${marker} governed pricing proposal`;
  const [
    { data: readiness, error: readinessError },
    { data: pricing, error: pricingError },
  ] = await Promise.all([
    db
      .schema("product")
      .from("readiness_packages")
      .select("id,title")
      .eq("title", readinessTitle),
    db
      .schema("product")
      .from("price_proposals")
      .select("id,reason")
      .eq("reason", pricingReason),
  ]);
  if (readinessError || pricingError) {
    throw new Error(
      `Product cleanup discovery failed: ${readinessError?.message ?? pricingError?.message}`,
    );
  }
  if (
    (readiness ?? []).some((row) => row.title !== readinessTitle) ||
    (pricing ?? []).some((row) => row.reason !== pricingReason)
  ) {
    throw new Error(
      "Product cleanup refused a row without exact marker proof.",
    );
  }
  const { data: cleanupResult, error: cleanupError } = await db
    .schema("product")
    .rpc("cleanup_certification_records", { p_marker: marker });
  if (cleanupError) {
    throw new Error(
      `Product certification cleanup failed: ${cleanupError.message}`,
    );
  }
  const [
    { count: readinessRemaining, error: readinessVerify },
    { count: priceRemaining, error: priceVerify },
  ] = await Promise.all([
    db
      .schema("product")
      .from("readiness_packages")
      .select("id", { count: "exact", head: true })
      .eq("title", readinessTitle),
    db
      .schema("product")
      .from("price_proposals")
      .select("id", { count: "exact", head: true })
      .eq("reason", pricingReason),
  ]);
  if (
    readinessVerify ||
    priceVerify ||
    readinessRemaining !== 0 ||
    priceRemaining !== 0
  ) {
    throw new Error("Product governance cleanup left run-scoped records.");
  }
  return {
    entity: "product-governance",
    marker,
    removed:
      Number(cleanupResult?.readiness_removed ?? 0) +
      Number(cleanupResult?.pricing_removed ?? 0),
    remaining: 0,
  };
}

async function identityAccessWorkflow(page, { allowedPath, deniedPath }) {
  await page.goto(`${baseUrl}${allowedPath}?identityAudit=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  const allowedAudit = await pageAudit(page);
  if (classify(allowedAudit.text, page.url()) !== "rendered") {
    throw new Error(`Authorized identity route did not render: ${allowedPath}`);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMeaningfulRoute(page);
  const refreshedAudit = await pageAudit(page);
  if (
    page.url().includes("/login") ||
    classify(refreshedAudit.text, page.url()) !== "rendered"
  ) {
    throw new Error(
      `Session was not restored after refreshing ${allowedPath}.`,
    );
  }

  if (deniedPath) {
    await page.goto(`${baseUrl}${deniedPath}?identityAudit=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForMeaningfulRoute(page);
    const deniedAudit = await pageAudit(page);
    if (classify(deniedAudit.text, page.url()) !== "access-denied") {
      throw new Error(`Least-privilege route was not denied: ${deniedPath}`);
    }
  }

  return {
    name: "Identity access and session restoration",
    ok: true,
    checkpoints: [
      "session-restored",
      "least-privilege-route-result",
      "refresh-restored",
    ],
  };
}

async function runWorkflow(browser, viewport, user, workflow) {
  const context = await browser.newContext({
    viewport: viewport.viewport,
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
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

  const evidenceName = [viewport.name, workflow.name, user.email]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
  const screenshotPath = path.join(auditEvidenceDir, `${evidenceName}.jpg`);

  async function captureEvidence() {
    await mkdir(auditEvidenceDir, { recursive: true });
    await page.screenshot({
      path: screenshotPath,
      type: "jpeg",
      quality: 72,
      fullPage: true,
    });
    return path.relative(process.cwd(), screenshotPath).replaceAll("\\", "/");
  }

  async function auditInteractiveState() {
    await page.waitForTimeout(250);
    const layout = await pageAudit(page);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const seriousAccessibility = accessibility.violations
      .filter((violation) => ["critical", "serious"].includes(violation.impact))
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
        examples: violation.nodes.slice(0, 3).map((node) => ({
          target: node.target,
          html: node.html.slice(0, 500),
          failureSummary: node.failureSummary,
        })),
      }));
    const undersizedMobileTargets = viewport.isMobile
      ? await page.evaluate(() => {
          const selector = [
            "button",
            "input:not([type='hidden']):not([type='file'])",
            "select",
            "textarea",
            "[role='button']",
            "a.btn",
            "a[class*='btn-']",
          ].join(",");
          return Array.from(document.querySelectorAll(selector))
            .filter((element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0
              );
            })
            .map((element) => {
              const controlRect = element.getBoundingClientRect();
              const label = "labels" in element ? element.labels?.[0] : null;
              const enclosingLabel = label?.contains(element) ? label : null;
              const labelRect = enclosingLabel?.getBoundingClientRect();
              const rect =
                labelRect && labelRect.width > 0 && labelRect.height > 0
                  ? labelRect
                  : controlRect;
              return {
                label: (
                  element.getAttribute("aria-label") ||
                  element.textContent ||
                  element.getAttribute("name") ||
                  element.tagName
                )
                  .trim()
                  .replace(/\s+/g, " ")
                  .slice(0, 80),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              };
            })
            .filter((target) => target.width < 44 || target.height < 44)
            .slice(0, 12);
        })
      : [];
    const keyboardHotspots = await auditKeyboardAndHotspots(page);
    const allUndersizedMobileTargets = viewport.isMobile
      ? [...undersizedMobileTargets, ...keyboardHotspots.undersizedTargets]
          .filter(
            (target, index, items) =>
              items.findIndex(
                (candidate) =>
                  candidate.label === target.label &&
                  candidate.width === target.width &&
                  candidate.height === target.height,
              ) === index,
          )
          .slice(0, 16)
      : [];
    return {
      overflow: layout.horizontalOverflow,
      scrollWidth: layout.scrollWidth,
      viewportWidth: layout.viewportWidth,
      layoutWidth: layout.layoutWidth,
      overflowOffenders: layout.overflowOffenders,
      overlaps: layout.overlaps,
      deadLinks: layout.deadLinks,
      unlabeledControls: layout.unlabeledControls,
      seriousAccessibility,
      undersizedMobileTargets: allUndersizedMobileTargets,
      keyboardHotspots,
    };
  }

  const intermediateEvidence = [];
  async function captureState(label) {
    const stateLabel = String(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64);
    const audit = await auditInteractiveState();
    const statePath = path.join(
      auditEvidenceDir,
      `${evidenceName}-${stateLabel || "state"}.jpg`,
    );
    await mkdir(auditEvidenceDir, { recursive: true });
    await page.screenshot({
      path: statePath,
      type: "jpeg",
      quality: 72,
      fullPage: true,
    });
    const record = {
      label,
      url: page.url().replace(baseUrl, ""),
      screenshot: path.relative(process.cwd(), statePath).replaceAll("\\", "/"),
      audit,
    };
    intermediateEvidence.push(record);
    return record;
  }

  try {
    const loginResult = await login(page, user);
    if (loginResult.status !== "signed-in") {
      return {
        viewport: viewport.name,
        user: user.email,
        workflow: workflow.name,
        scenarioId: workflow.scenarioId ?? null,
        ok: false,
        login: loginResult,
      };
    }
    const result = await workflow.run(page, { captureState });
    const interactionAudit = await auditInteractiveState();
    const evidenceScreenshot = await captureEvidence();
    const interactionProblems = [
      interactionAudit.overflow ? "horizontal overflow" : null,
      interactionAudit.overlaps.length ? "overlapping controls" : null,
      interactionAudit.deadLinks.length ? "dead links" : null,
      interactionAudit.unlabeledControls.length ? "unlabeled controls" : null,
      interactionAudit.seriousAccessibility.length
        ? "serious accessibility violations"
        : null,
      interactionAudit.undersizedMobileTargets.length
        ? "mobile targets smaller than 44px"
        : null,
      interactionAudit.keyboardHotspots.focusEscapedDialog
        ? "keyboard focus escaped the active dialog"
        : null,
      interactionAudit.keyboardHotspots.interceptedTargets.length
        ? "intercepted interactive hotspots"
        : null,
    ].filter(Boolean);
    return {
      viewport: viewport.name,
      user: user.email,
      workflow: workflow.name,
      scenarioId: workflow.scenarioId ?? null,
      ...result,
      ok: result.ok !== false && interactionProblems.length === 0,
      interactionProblems,
      interactionAudit,
      intermediateEvidence,
      scenarioEvidence: workflowScenarioEvidence(workflow.name),
      evidenceScreenshot,
      consoleErrors: Array.from(new Set(consoleErrors)).slice(0, 12),
      networkErrors: networkErrors.slice(0, 12),
    };
  } catch (error) {
    const evidenceScreenshot = await captureEvidence().catch(() => null);
    return {
      viewport: viewport.name,
      user: user.email,
      workflow: workflow.name,
      scenarioId: workflow.scenarioId ?? null,
      ok: false,
      error: String(error.message || error).slice(0, 1_200),
      intermediateEvidence,
      scenarioEvidence: workflowScenarioEvidence(workflow.name),
      evidenceScreenshot,
      consoleErrors: Array.from(new Set(consoleErrors)).slice(0, 12),
      networkErrors: networkErrors.slice(0, 12),
    };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
const results = [];

if (runRouteAudit) {
  for (const viewport of viewports.filter(
    (item) => !viewFilter || item.name === viewFilter,
  )) {
    for (const user of users.filter(
      (item) => !roleFilter || item.role === roleFilter,
    )) {
      const context = await browser.newContext({
        viewport: viewport.viewport,
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile,
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
            url: url
              .replace(/apikey=[^&]+/g, "apikey=[redacted]")
              .slice(0, 220),
          });
        }
      });

      let loginResult;
      const routeResults = [];
      try {
        loginResult = await login(page, user);
        if (loginResult.status === "signed-in") {
          const discoveredRoutes = await discoverVisibleNavigationRoutes(page);
          const routeQueue = routesFor(user, discoveredRoutes);
          const queuedPaths = new Set(routeQueue.map((route) => route.path));
          const recursiveRouteLimit = 32;
          let recursivelyDiscovered = 0;
          while (routeQueue.length) {
            const route = routeQueue.shift();
            try {
              const routeResult = await auditRoute(page, route);
              routeResults.push(routeResult);
              if (
                route.expectedAccess === "allowed" &&
                routeResult.class === "rendered" &&
                recursivelyDiscovered < recursiveRouteLimit
              ) {
                for (const path of await discoverSafeDetailRoutes(page)) {
                  if (queuedPaths.has(path)) continue;
                  queuedPaths.add(path);
                  routeQueue.push({
                    path,
                    expectedAccess: "allowed",
                    source: "recursive-rendered-link",
                  });
                  recursivelyDiscovered += 1;
                  if (recursivelyDiscovered >= recursiveRouteLimit) break;
                }
              }
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
            networkErrors.map((entry) => [
              `${entry.status}:${entry.url}`,
              entry,
            ]),
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
          denied: routeResults.filter(
            (route) => route.class === "access-denied",
          ).length,
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
          overlaps: routeResults.filter((route) => route.overlaps?.length)
            .length,
          networkErrors: item.networkErrors.length,
          consoleErrors: item.consoleErrors.length,
        }),
      );
      await context.close();
    }
  }
}

const workflows = [];
let cleanup = { runId: auditRunId, complete: true, results: [] };
const task3Fixtures = [];
const registerTask3Cleanup = (fixture) => task3Fixtures.push(fixture);
const vendorAuditEmail = (marker) =>
  controlledVendorEmail?.replaceAll("{marker}", marker.toLowerCase()) ||
  `audit.vendor.${marker.toLowerCase()}@example.com`;
const transactionViewports = viewports.filter(
  (item) =>
    ["desktop-1440", "mobile-390"].includes(item.name) &&
    (!viewFilter || item.name === viewFilter),
);
const auditMarkers = transactionViewports.map(
  (viewport) => `${auditRunId}-${viewport.name}`,
);
const cleanupTargets = mutatingPhase
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
        table: "locations",
        filters: { id: marker },
        proofColumn: "id",
      },
      {
        runId: auditRunId,
        schema: "warehouse",
        table: "department_stock_requests",
        filters: { purpose: `${marker} event fulfillment` },
        proofColumn: "purpose",
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
        schema: "warehouse",
        table: "events",
        filters: { name: `${marker} Intra Event` },
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
  if (runTransactionAudit) {
    for (const viewport of transactionViewports) {
      for (const [email, name, run] of [
        [
          "intra.test.procurement.lead@mwell.com.ph",
          "procurement receipt authority denial",
          procurementReceiptAuthorityWorkflow,
        ],
        [
          "intra.test.operations.associate@mwell.com.ph",
          "warehouse operator routine surface",
          warehouseOperatorSurfaceWorkflow,
        ],
        [
          "intra.test.operations.lead@mwell.com.ph",
          "warehouse supervisor controlled exceptions",
          warehouseSupervisorControlWorkflow,
        ],
      ])
        workflows.push(
          await runWorkflow(browser, viewport, { email }, { name, run }),
        );
    }
    if (mutatingPhase) {
      for (const viewport of transactionViewports) {
        const marker = `${auditRunId}-${viewport.name}`;
        for (const identityCase of [
          {
            email: "intra.test.employee@mwell.com.ph",
            name: "general employee identity and least privilege",
            allowedPath: "/",
            deniedPath: "/admin/doa",
          },
          {
            email: "intra.test.admin@mwell.com.ph",
            name: "platform administrator identity and session restoration",
            allowedPath: "/admin/doa",
            deniedPath: null,
          },
          {
            email: "intra.test.vendor@mwell.com.ph",
            name: "vendor identity and least privilege",
            allowedPath: "/vendor",
            deniedPath: "/warehouse",
          },
        ]) {
          workflows.push(
            await runWorkflow(
              browser,
              viewport,
              { email: identityCase.email },
              {
                name: identityCase.name,
                scenarioId: "identity-access",
                run: (page) => identityAccessWorkflow(page, identityCase),
              },
            ),
          );
        }
        const locationSetup = await runWorkflow(
          browser,
          viewport,
          { email: "intra.test.operations.lead@mwell.com.ph" },
          {
            name: "warehouse location creation",
            scenarioId: "warehouse-setup-receive-putaway",
            run: (page) => warehouseCreateLocationWorkflow(page, marker),
          },
        );
        workflows.push(locationSetup);
        if (!locationSetup.ok)
          throw new Error(
            `Warehouse location setup failed: ${JSON.stringify(locationSetup)}`,
          );
        const binSetup = await runWorkflow(
          browser,
          viewport,
          { email: "intra.test.operations.lead@mwell.com.ph" },
          {
            name: "warehouse bin creation",
            scenarioId: "warehouse-setup-receive-putaway",
            run: (page) => warehouseCreateBinWorkflow(page, marker),
          },
        );
        workflows.push(binSetup);
        if (!binSetup.ok)
          throw new Error(
            `Warehouse bin setup failed: ${JSON.stringify(binSetup)}`,
          );
        const task3Fixture = await createTask3ReceiptFixture(
          marker,
          registerTask3Cleanup,
        );
        const crossModuleState = { marker };
        const productState = { marker };
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.employee@mwell.com.ph" },
            {
              name: "Product contributor readiness and pricing submission",
              scenarioId: "product-readiness-go-live-pricing",
              run: (page, hooks) =>
                productContributorWorkflow(
                  page,
                  marker,
                  task3Fixture,
                  productState,
                  hooks,
                ),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.product.owner@mwell.com.ph" },
            {
              name: "Product owner go-live and pricing decision",
              scenarioId: "product-readiness-go-live-pricing",
              run: (page, hooks) =>
                productOwnerDecisionWorkflow(page, productState, hooks),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.operations.lead@mwell.com.ph" },
            {
              name: "Operations Product handoff acknowledgement",
              scenarioId: "product-readiness-go-live-pricing",
              run: (page, hooks) =>
                productOperationsHandoffWorkflow(page, productState, hooks),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.operations.associate@mwell.com.ph" },
            {
              name: "Task 3 operator receipt transactions",
              scenarioId: "warehouse-setup-receive-putaway",
              run: (page) =>
                task3OperatorReceiptTransactions(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.procurement.lead@mwell.com.ph" },
            {
              name: "Task 3 payment readiness without acceptance denial",
              scenarioId: "procurement-request-to-po",
              run: (page) =>
                task3PaymentReadinessWithoutAcceptance(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.employee@mwell.com.ph" },
            {
              name: "Events request creation and persistence readback",
              scenarioId: "events-request-to-warehouse-handoff",
              run: (page, hooks) =>
                eventsCreateAndReadbackWorkflow(
                  page,
                  marker,
                  crossModuleState,
                  hooks,
                ),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.product.owner@mwell.com.ph" },
            {
              name: "Events viewer create denial",
              scenarioId: "events-request-to-warehouse-handoff",
              run: (page) => eventsViewerMutationDenialWorkflow(page, marker),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.marketing.events@mwell.com.ph" },
            {
              name: "Events coordinator refresh and Warehouse handoff",
              scenarioId: "events-request-to-warehouse-handoff",
              run: (page) =>
                eventsCoordinatorReadbackWorkflow(page, crossModuleState),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.operations.associate@mwell.com.ph" },
            {
              name: "Events-to-Warehouse operational handoff",
              scenarioId: "events-request-to-warehouse-handoff",
              run: (page) =>
                warehouseEventHandoffWorkflow(page, crossModuleState),
            },
          ),
        );
        for (const [role, email] of [
          ["leadership_insights", "intra.test.leadership@mwell.com.ph"],
        ]) {
          workflows.push(
            await runWorkflow(
              browser,
              viewport,
              { email },
              {
                name: `${role} Insights governance`,
                scenarioId: "insights-read-only-governance",
                run: (page) => insightsGovernanceWorkflow(page, role),
              },
            ),
          );
        }
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.finance@mwell.com.ph" },
            {
              name: "Unified Finance cross-module readback",
              scenarioId: "unified-finance-control-center",
              run: (page) => unifiedFinanceReadbackWorkflow(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.procurement.lead@mwell.com.ph" },
            {
              name: "Task 3 approved amendment quantity growth request",
              run: (page) => task3RequestExcessAmendment(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.admin@mwell.com.ph" },
            {
              name: "Task 3 all-capability admin wrong-step denial",
              run: (page) =>
                task3AllCapabilityAdminWrongStep(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.admin@mwell.com.ph" },
            {
              name: "Task 3 referenced approval role lifecycle denial",
              run: (page) =>
                task3ApprovalRoleLifecycleContracts(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.procurement.lead@mwell.com.ph" },
            {
              name: "Task 3 inactive approval role denial",
              run: (page) =>
                task3InactiveApprovalRoleDenial(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.operations.lead@mwell.com.ph" },
            {
              name: "Task 3 supervisor quarantine and variance transactions",
              scenarioId: "warehouse-cycle-count",
              run: (page) => task3SupervisorTransactions(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.finance@mwell.com.ph" },
            {
              name: "Task 3 Finance insufficient locked-stock denial",
              run: (page) =>
                task3FinanceInsufficientStockDenial(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.operations.lead@mwell.com.ph" },
            {
              name: "Task 3 approved amendment quantity growth approval",
              run: (page) => task3ApproveExcessAmendment(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.operations.lead@mwell.com.ph" },
            {
              name: "Task 3 Supervisor excess custody final disposition",
              scenarioId: "warehouse-quality-and-return",
              run: (page) =>
                task3SupervisorExcessFinalDisposition(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.employee@mwell.com.ph" },
            {
              name: "Task 3 policy-negative database transactions",
              run: (page) =>
                task3PolicyNegativeTransactions(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.employee@mwell.com.ph" },
            {
              name: "Task 3 requester goods acceptance",
              run: (page) =>
                task3GoodsAcceptance(
                  page,
                  task3Fixture,
                  task3Fixture.ids.cleanPo,
                  task3Fixture.ids.cleanLine,
                  "Task 3 requester goods acceptance",
                ),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.legal.lead@mwell.com.ph" },
            {
              name: "Task 3 cumulative partial acceptance",
              run: (page) =>
                task3CumulativePartialAcceptance(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.procurement.lead@mwell.com.ph" },
            {
              name: "Task 3 cumulative payment acceptance binding",
              run: (page) =>
                task3CumulativePaymentAcceptanceBinding(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.finance@mwell.com.ph" },
            {
              name: "Task 3 finalized Finance readiness preservation",
              run: (page) => task3FinalizePaymentReadiness(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.legal.lead@mwell.com.ph" },
            {
              name: "Task 3 stale payment readiness invalidation",
              run: (page) =>
                task3InvalidateReadinessWithAcceptanceChange(
                  page,
                  task3Fixture,
                ),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.finance@mwell.com.ph" },
            {
              name: "Task 3 stale Finance readiness denial",
              run: (page) =>
                task3RejectStalePaymentReadiness(page, task3Fixture),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.employee@mwell.com.ph" },
            {
              name: "procurement request draft",
              scenarioId: "procurement-request-to-po",
              run: (page) => procurementCreateRequestWorkflow(page, marker),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.legal.lead@mwell.com.ph" },
            {
              name: "legal vendor invite",
              scenarioId: "vendor-accreditation",
              run: (page) => legalInviteVendorWorkflow(page, marker),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.operations.lead@mwell.com.ph" },
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
            { email: "intra.test.employee@mwell.com.ph" },
            {
              name: "warehouse event creation",
              scenarioId: "warehouse-allocation-event-return",
              run: (page) => warehouseCreateEventWorkflow(page, marker),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.marketing.events@mwell.com.ph" },
            {
              name: "warehouse event role handoff",
              scenarioId: "warehouse-allocation-event-return",
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
              scenarioId: "admin-doa",
              run: (page, hooks) => adminCreateDoaWorkflow(page, marker, hooks),
            },
          ),
        );
        workflows.push(
          await runWorkflow(
            browser,
            viewport,
            { email: "intra.test.legal.lead@mwell.com.ph" },
            {
              name: "department DOA role handoff",
              scenarioId: "admin-doa",
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
            "intra.test.operations.lead@mwell.com.ph",
            "warehouse receiving validation",
            warehouseReceivingValidationWorkflow,
          ],
          [
            "intra.test.operations.lead@mwell.com.ph",
            "warehouse quality validation",
            warehouseQualityValidationWorkflow,
          ],
          [
            "intra.test.operations.lead@mwell.com.ph",
            "warehouse cycle count validation",
            warehouseCycleCountValidationWorkflow,
          ],
          [
            "intra.test.operations.associate@mwell.com.ph",
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
  }
} finally {
  try {
    await browser.close();
  } finally {
    if (mutatingPhase) {
      const task3Results = [];
      const governedActivityResults = [];
      const eventDependencyResults = [];
      const vendorInviteCommandResults = [];
      const productGovernanceResults = [];
      for (const marker of auditMarkers) {
        try {
          vendorInviteCommandResults.push(
            await cleanupVendorInviteCommands(marker),
          );
        } catch (error) {
          vendorInviteCommandResults.push({
            entity: "legal.vendor_invite_commands",
            marker,
            removed: false,
            remaining: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        try {
          governedActivityResults.push(
            await cleanupGovernedWorkflowActivity(marker),
          );
        } catch (error) {
          governedActivityResults.push({
            entity: "governed-workflow-activity",
            marker,
            removed: false,
            remaining: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        try {
          eventDependencyResults.push(
            await cleanupEventWorkflowDependencies(marker),
          );
        } catch (error) {
          eventDependencyResults.push({
            entity: "event-workflow-dependencies",
            marker,
            removed: false,
            remaining: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        try {
          productGovernanceResults.push(await cleanupProductGovernance(marker));
        } catch (error) {
          productGovernanceResults.push({
            entity: "product-governance",
            marker,
            removed: false,
            remaining: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      for (const fixture of [...task3Fixtures].reverse()) {
        try {
          task3Results.push(await cleanupTask3ReceiptFixture(fixture));
        } catch (error) {
          task3Results.push({
            entity: "task3-receipt-fixture",
            marker: fixture.marker,
            removed: false,
            remaining: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      cleanup = await cleanupRun(auditRunId, cleanupTargets, {
        authEmails: auditMarkers.map((marker) => vendorAuditEmail(marker)),
      });
      cleanup.results.push(
        ...vendorInviteCommandResults,
        ...governedActivityResults,
        ...eventDependencyResults,
        ...productGovernanceResults,
        ...task3Results,
      );
      cleanup.complete =
        cleanup.complete &&
        vendorInviteCommandResults.every(
          (result) => result.remaining === 0 && !result.error,
        ) &&
        governedActivityResults.every(
          (result) => result.remaining === 0 && !result.error,
        ) &&
        eventDependencyResults.every(
          (result) => result.remaining === 0 && !result.error,
        ) &&
        productGovernanceResults.every(
          (result) => result.remaining === 0 && !result.error,
        ) &&
        task3Results.every((result) => result.remaining === 0 && !result.error);
    }
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
    .map((route) => ({
      route: route.route,
      scrollWidth: route.scrollWidth,
      viewportWidth: route.viewportWidth,
      examples: route.overflowOffenders?.slice(0, 3) ?? [],
    })),
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

const shardCoverageViewports = mutatingPhase
  ? transactionViewports.map((viewport) => viewport.name)
  : [];
const scenarioCoverage = evaluateScenarioCoverage(
  workflows,
  shardCoverageViewports,
);

const outputPath = path.resolve(
  process.env.AUDIT_OUTPUT_PATH ??
    "test-results/full-intra-live-e2e-results.json",
);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      baseUrl,
      runId: auditRunId,
      task3Transactions: workflows.filter((workflow) =>
        workflow.workflow?.startsWith("Task 3"),
      ),
      phase: auditPhase,
      aggregate,
      scenarioCoverage,
      workflows,
      cleanup,
      results,
    },
    null,
    2,
  )}\n`,
);

const routeFailures = aggregate.flatMap((item) => [
  ...item.expectationMisses.map(
    (entry) => `${item.viewport}/${item.role}${entry.route}: expectation miss`,
  ),
  ...item.blankOrErrors.map(
    (entry) => `${item.viewport}/${item.role}${entry.route}: ${entry.class}`,
  ),
  ...item.overflowRoutes.map(
    (entry) => `${item.viewport}/${item.role}${entry.route}: overflow`,
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
if (mutatingPhase) {
  workflowFailures.push(
    ...scenarioCoverageFailures(scenarioCoverage).map(
      (failure) => `${auditRunId}: ${failure}`,
    ),
  );
}
if (!cleanup.complete)
  workflowFailures.push(`${auditRunId}: cleanup incomplete`);

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
