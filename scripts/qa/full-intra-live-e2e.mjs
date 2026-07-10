import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(path.resolve("apps/shell/package.json"));
const { chromium } = require("@playwright/test");

const baseUrl = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const password = process.env.AUDIT_PASSWORD;
const allowMutations = process.env.AUDIT_MUTATIONS === "true";
const viewFilter = process.env.AUDIT_VIEWPORT;
const roleFilter = process.env.AUDIT_ROLE;

if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  throw new Error("AUDIT_BASE_URL must be the HTTPS URL of the live deployment.");
}
if (!password) {
  throw new Error("AUDIT_PASSWORD is required; shared credentials are never embedded in the release gate.");
}

const users = [
  { role: "core_staff_only", email: "intra.test.staff@mwell.com.ph" },
  { role: "platform_admin", email: "intra.test.admin@mwell.com.ph" },
  { role: "vendor_portal", email: "intra.test.vendor@mwell.com.ph" },
  { role: "warehouse_logistics_supervisor", email: "intra.test.wh.logistics@mwell.com.ph" },
  { role: "warehouse_operations", email: "intra.test.wh.operations@mwell.com.ph" },
  { role: "warehouse_finance", email: "intra.test.wh.finance@mwell.com.ph" },
  { role: "warehouse_bi_analyst", email: "intra.test.wh.bi@mwell.com.ph" },
  { role: "warehouse_marketing", email: "intra.test.wh.marketing@mwell.com.ph" },
  { role: "warehouse_pricing", email: "intra.test.wh.pricing@mwell.com.ph" },
  { role: "procurement_requester", email: "intra.test.proc.requester@mwell.com.ph" },
  { role: "procurement_officer", email: "intra.test.proc.officer@mwell.com.ph" },
  { role: "procurement_approver", email: "intra.test.proc.approver@mwell.com.ph" },
  { role: "procurement_finance", email: "intra.test.proc.finance@mwell.com.ph" },
  { role: "procurement_admin", email: "intra.test.proc.admin@mwell.com.ph" },
  { role: "legal_reviewer", email: "intra.test.legal.reviewer@mwell.com.ph" },
  { role: "legal_compliance", email: "intra.test.legal.compliance@mwell.com.ph" },
  { role: "legal_admin", email: "intra.test.legal.admin@mwell.com.ph" },
];

const viewports = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true },
];

const commonRoutes = [
  { path: "/", text: /Your modules|No modules yet|Vendor Portal|Admin/i },
  { path: "/warehouse", text: /Warehouse|Dashboard|No warehouse access|Access denied/i },
  { path: "/procurement", text: /Procurement|No procurement access|Approval inbox|Purchase request|Access denied/i },
  { path: "/legal", text: /Legal|Accreditation|No legal access|Access denied/i },
  { path: "/vendor", text: /Vendor|accreditation|No legal access|enrolled vendor|Access denied/i },
  { path: "/admin/users", text: /Users & Roles|Access matrix|No admin access|don't have access|No modules|Access denied/i },
];

const roleRoutes = {
  platform_admin: [
    { path: "/admin/users", text: /Users & Roles|Access matrix/i },
  ],
  vendor_portal: [
    { path: "/vendor", text: /Vendor|accreditation|Acme/i },
    { path: "/vendor/cases/case_seed_001", text: /Accreditation|Checklist|Documents|requirements/i },
  ],
  warehouse_logistics_supervisor: [
    { path: "/warehouse/receiving", text: /Receiving|Receive/i },
    { path: "/warehouse/locations", text: /Locations|Warehouse|Site/i },
    { path: "/warehouse/storage", text: /Storage|Bin|Area/i },
  ],
  warehouse_operations: [
    { path: "/warehouse/inventory", text: /Inventory|SKUs|Low stock/i },
    { path: "/warehouse/allocations", text: /Allocations|Reserve|Issue/i },
    { path: "/warehouse/returns", text: /Returns|Record return/i },
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
    { path: "/procurement/requests/new", text: /Draft a purchase request|New request/i },
    { path: "/procurement/requests/req_seed_001", text: /Purchase request|Line items|Activity/i },
  ],
  procurement_officer: [
    { path: "/procurement", text: /Purchase requests|Procurement/i },
    { path: "/procurement/purchase-orders", text: /Purchase orders|POs/i },
  ],
  procurement_approver: [
    { path: "/procurement/approvals", text: /Approval inbox|Waiting on you|Inbox zero/i },
  ],
  procurement_finance: [
    { path: "/procurement/approvals", text: /Approval inbox|Waiting on you|Inbox zero/i },
  ],
  procurement_admin: [
    { path: "/procurement/purchase-orders", text: /Purchase orders|POs/i },
    { path: "/procurement/approvals", text: /Approval inbox|Waiting on you|Inbox zero/i },
  ],
  legal_reviewer: [
    { path: "/legal", text: /Accreditation cases|Legal/i },
    { path: "/legal/cases/case_seed_001", text: /Accreditation|Checklist|Documents|Activity/i },
    { path: "/legal/invites/new", text: /Invite vendor|Onboard a new vendor/i },
  ],
  legal_compliance: [
    { path: "/legal", text: /Accreditation cases|Legal/i },
    { path: "/legal/cases/case_seed_001", text: /Accreditation|Checklist|Documents|Activity/i },
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
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
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
      { timeout: 8_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(500);
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
      while (node && node !== document.body && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const clipsX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX);
        const clipsY = ["hidden", "clip", "auto", "scroll"].includes(style.overflowY);
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
    const visibleControls = Array.from(document.querySelectorAll(controlSelector))
      .filter((el) => !el.classList.contains("sr-only"))
      .filter((el) => el.type !== "file")
      .filter(isVisible);
    for (let i = 0; i < visibleControls.length; i += 1) {
      const el = visibleControls[i];
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) continue;
      if (!centerIsInsideVisibleClip(el, x, y)) continue;
      const blocker = document.elementFromPoint(x, y);
      if (!blocker || blocker === el || el.contains(blocker)) continue;
      if (blocker.tagName.toLowerCase() === "nextjs-portal" || blocker.closest("nextjs-portal")) {
        continue;
      }
      const blockerControl = blocker.closest(controlSelector);
      if (!blockerControl || blockerControl === el || el.contains(blockerControl)) continue;
      overlapExamples.push({
        a: controls[i]?.text || controls[i]?.tag || "control",
        b:
          blockerControl.innerText?.trim().replace(/\s+/g, " ").slice(0, 80) ||
          blockerControl.getAttribute("aria-label") ||
          blockerControl.tagName.toLowerCase(),
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
      while (node && node !== document.body && node !== document.documentElement) {
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
      .filter((item) => item.rect.w > 0 && (item.rect.x < -2 || item.rect.right > layoutWidth + 2))
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
            (!control.href || control.href === "#" || control.href.startsWith("javascript:")),
        )
        .slice(0, 10),
      unlabeledControls: controls
        .filter((control) => !control.text && ["button", "a"].includes(control.tag))
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

async function procurementCreateRequestWorkflow(page) {
  await page.goto(`${baseUrl}/procurement/requests/new?workflow=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.locator("label").filter({ hasText: /^Petty cash/i }).first().click();
  await page.getByLabel("Title").fill(`Audit petty cash ${Date.now()}`);
  await page.getByLabel("Line 1 description").fill("Audit workflow supplies");
  await page.getByLabel("Line 1 unit price").fill("1250");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByLabel(/Need description/i).fill("Operational test purchase for full Intra audit coverage.");
  await page.getByLabel(/Risk if not procured/i).fill("Testing would not cover procurement draft creation.");
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
  return {
    name: "procurement request draft",
    ok:
      /Purchase request|Line items|Activity|Business justification/i.test(audit.text) &&
      path.startsWith("/procurement/requests/") &&
      !path.endsWith("/new"),
    finalUrl: page.url().replace(baseUrl, ""),
    text: audit.text.slice(0, 260),
  };
}

async function legalInviteVendorWorkflow(page) {
  const unique = Date.now();
  await page.goto(`${baseUrl}/legal/invites/new?workflow=${unique}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForMeaningfulRoute(page);
  await page.getByLabel("Company name").fill(`Audit Vendor ${unique}`);
  await page.getByLabel("Vendor contact email").fill(`audit.vendor.${unique}@example.com`);
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
  return {
    name: "legal vendor invite",
    ok: audit.text.includes(`Audit Vendor ${unique}`) && /\/legal\/cases\//.test(page.url()),
    finalUrl: page.url().replace(baseUrl, ""),
    text: audit.text.slice(0, 260),
  };
}

async function runWorkflow(browser, viewport, user, workflow) {
  const context = await browser.newContext({
    viewport: viewport.viewport,
    isMobile: viewport.isMobile,
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
      consoleErrors.push(`${message.type()}${where}: ${message.text()}`.slice(0, 320));
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`.slice(0, 240)));
  page.on("response", (response) => {
    const url = response.url();
    if ((url.includes("supabase.co") || url.includes("/_next/")) && response.status() >= 400) {
      networkErrors.push({ status: response.status(), url: url.slice(0, 220) });
    }
  });

  try {
    const loginResult = await login(page, user);
    if (loginResult.status !== "signed-in") {
      return { viewport: viewport.name, user: user.email, workflow: workflow.name, ok: false, login: loginResult };
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

for (const viewport of viewports.filter((item) => !viewFilter || item.name === viewFilter)) {
  for (const user of users.filter((item) => !roleFilter || item.role === roleFilter)) {
    const context = await browser.newContext({
      viewport: viewport.viewport,
      isMobile: viewport.isMobile,
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
        consoleErrors.push(`${message.type()}${where}: ${message.text()}`.slice(0, 320));
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(`pageerror: ${error.message}`.slice(0, 240));
    });
    page.on("response", (response) => {
      const url = response.url();
      if ((url.includes("supabase.co") || url.includes("/_next/")) && response.status() >= 400) {
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
        new Map(networkErrors.map((entry) => [`${entry.status}:${entry.url}`, entry])).values(),
      ).slice(0, 24),
      consoleErrors: Array.from(new Set(consoleErrors)).slice(0, 24),
    };
    results.push(item);
    console.log(
      JSON.stringify({
        viewport: item.viewport,
        role: item.role,
        login: item.login.status,
        rendered: routeResults.filter((route) => route.class === "rendered").length,
        denied: routeResults.filter((route) => route.class === "access-denied").length,
        problems: routeResults.filter(
          (route) =>
            route.class !== "rendered" &&
            route.class !== "access-denied" &&
            route.class !== "redirected-login",
        ).length,
        expectationMisses: routeResults.filter((route) => route.expectationMet === false).length,
        overflow: routeResults.filter((route) => route.overflow).map((route) => route.route),
        overlaps: routeResults.filter((route) => route.overlaps?.length).length,
        networkErrors: item.networkErrors.length,
        consoleErrors: item.consoleErrors.length,
      }),
    );
    await context.close();
  }
}

const workflows = [];
if (allowMutations) {
  for (const viewport of viewports.filter((item) => !viewFilter || item.name === viewFilter)) {
    workflows.push(
      await runWorkflow(browser, viewport, { email: "intra.test.proc.requester@mwell.com.ph" }, {
        name: "procurement request draft",
        run: procurementCreateRequestWorkflow,
      }),
    );
    workflows.push(
      await runWorkflow(browser, viewport, { email: "intra.test.legal.reviewer@mwell.com.ph" }, {
        name: "legal vendor invite",
        run: legalInviteVendorWorkflow,
      }),
    );
  }
} else {
  console.warn("AUDIT_MUTATIONS is not true; write/read-back workflows were skipped.");
}

await browser.close();

const aggregate = results.map((item) => ({
  viewport: item.viewport,
  role: item.role,
  email: item.email,
  loginStatus: item.login.status,
  loginUrl: item.login.url,
  rendered: item.routes.filter((route) => route.class === "rendered").map((route) => route.route),
  denied: item.routes.filter((route) => route.class === "access-denied").map((route) => route.route),
  expectationMisses: item.routes
    .filter((route) => route.expectationMet === false)
    .map((route) => ({ route: route.route, class: route.class, text: route.text, error: route.error })),
  blankOrErrors: item.routes
    .filter((route) => ["blank-or-nearblank", "error", "navigation-error"].includes(route.class))
    .map((route) => ({ route: route.route, class: route.class, error: route.error })),
  overflowRoutes: item.routes.filter((route) => route.overflow).map((route) => route.route),
  overlapRoutes: item.routes
    .filter((route) => route.overlaps?.length)
    .map((route) => ({ route: route.route, examples: route.overlaps.slice(0, 2) })),
  deadLinkRoutes: item.routes
    .filter((route) => route.deadLinks?.length)
    .map((route) => ({ route: route.route, count: route.deadLinks.length })),
  unlabeledControlRoutes: item.routes
    .filter((route) => route.unlabeledControls?.length)
    .map((route) => ({ route: route.route, count: route.unlabeledControls.length })),
  networkErrors: item.networkErrors,
  consoleErrors: item.consoleErrors,
}));

const outputPath = path.resolve("test-results", "full-intra-live-e2e-results.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, aggregate, workflows, results }, null, 2)}\n`,
);

const routeFailures = aggregate.flatMap((item) => [
  ...item.expectationMisses.map((entry) => `${item.viewport}/${item.role}${entry.route}: expectation miss`),
  ...item.blankOrErrors.map((entry) => `${item.viewport}/${item.role}${entry.route}: ${entry.class}`),
  ...item.overflowRoutes.map((route) => `${item.viewport}/${item.role}${route}: overflow`),
  ...item.overlapRoutes.map((entry) => `${item.viewport}/${item.role}${entry.route}: overlap`),
  ...item.deadLinkRoutes.map((entry) => `${item.viewport}/${item.role}${entry.route}: dead link`),
  ...item.unlabeledControlRoutes.map((entry) => `${item.viewport}/${item.role}${entry.route}: unlabeled control`),
  ...item.networkErrors.map((entry) => `${item.viewport}/${item.role}: network ${entry.status}`),
  ...item.consoleErrors.map(() => `${item.viewport}/${item.role}: console error`),
]);
const workflowFailures = workflows
  .filter((workflow) => !workflow.ok || workflow.networkErrors?.length || workflow.consoleErrors?.length)
  .map((workflow) => `${workflow.viewport}/${workflow.workflow}: ${workflow.error ?? "failed"}`);

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
