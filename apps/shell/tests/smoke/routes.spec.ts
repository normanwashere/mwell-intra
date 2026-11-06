import { expect, type Page, test, type TestInfo } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface RouteCase {
  readonly path: string;
  readonly label: string;
  readonly maxStatus?: number;
}

interface MemoryFixture {
  readonly profileId: string;
  readonly roles: Record<string, readonly string[]>;
}

interface AuthenticatedRouteCase extends RouteCase {
  readonly fixture: MemoryFixture;
  readonly expectedPath: string;
  readonly expectedText: RegExp;
}

interface CommandRouteCase {
  readonly fixture: MemoryFixture;
  readonly query: string;
  readonly option: RegExp;
  readonly expectedPath: string;
}

interface ConsoleIssue {
  readonly type: string;
  readonly text: string;
  readonly location: string;
}

interface TargetIssue {
  readonly identity: number;
  readonly label: string;
  readonly selector: string;
  readonly width: number;
  readonly height: number;
  readonly scrollY?: number;
  readonly rect?: { x: number; y: number; width: number; height: number };
}

interface BlockedTargetIssue extends TargetIssue {
  readonly blocker: string;
  readonly blockerRect?: TargetIssue["rect"];
}

const ROUTES: readonly RouteCase[] = [
  { path: "/", label: "dashboard" },
  { path: "/login", label: "sign-in" },
  { path: "/reset-password", label: "reset-password" },
  { path: "/work", label: "my work" },
  { path: "/events", label: "events workspace" },
  { path: "/insights", label: "insights workspace" },
  { path: "/warehouse", label: "warehouse module" },
  { path: "/finance", label: "finance module" },
  { path: "/procurement", label: "procurement module" },
  { path: "/legal", label: "legal module" },
  { path: "/vendor", label: "vendor portal" },
  { path: "/knowledge", label: "knowledge base" },
  { path: "/admin", label: "administration" },
  { path: "/nonexistent-route", label: "not-found page" },
];

const MEMORY_SESSION_KEY = "intra.memory-session.v1";
const liveSupabaseConfigured =
  Boolean(readEnvValue("NEXT_PUBLIC_SUPABASE_URL")) &&
  Boolean(readEnvValue("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
const memoryFixtureAuthDisabled =
  liveSupabaseConfigured && process.env.MWELL_E2E_AUTH_MODE !== "memory";
const memoryFixtureSkipReason =
  "Memory-session fixture tests are disabled while live Supabase middleware is configured. Use .qa/role-e2e-audit.mjs for live credential E2E, or set MWELL_E2E_AUTH_MODE=memory in a non-live run.";

const FIXTURES = {
  admin: {
    profileId: "demo-admin",
    roles: { core: ["platform_admin", "staff"] },
  },
  finance: {
    profileId: "demo-finance",
    roles: {
      core: ["staff"],
      warehouse: ["finance"],
      procurement: ["finance"],
    },
  },
  procurementFinance: {
    profileId: "demo-procurement-finance",
    roles: { core: ["staff"], procurement: ["finance"] },
  },
  procurement: {
    profileId: "demo-procurement",
    roles: { core: ["staff"], procurement: ["procurement_officer"] },
  },
  legal: {
    profileId: "demo-legal",
    roles: { core: ["staff"], legal: ["legal_reviewer"] },
  },
  vendor: {
    profileId: "demo-vendor",
    roles: { core: ["vendor_portal"] },
  },
} as const satisfies Record<string, MemoryFixture>;

const AUTHENTICATED_ROUTES: readonly AuthenticatedRouteCase[] = [
  {
    path: "/knowledge",
    label: "employee knowledge base",
    fixture: FIXTURES.procurement,
    expectedPath: "/knowledge",
    expectedText: /Knowledge Base|Search functions and workflows/i,
  },
  {
    path: "/knowledge",
    label: "vendor knowledge base",
    fixture: FIXTURES.vendor,
    expectedPath: "/knowledge",
    expectedText: /Knowledge Base|Search functions and workflows/i,
  },
  {
    path: "/",
    label: "admin dashboard",
    fixture: FIXTURES.admin,
    expectedPath: "/",
    expectedText: /Admin|Users & Roles/i,
  },
  {
    path: "/admin",
    label: "administration landing",
    fixture: FIXTURES.admin,
    expectedPath: "/admin",
    expectedText: /Administration|Users and roles/i,
  },
  {
    path: "/admin/users",
    label: "admin users",
    fixture: FIXTURES.admin,
    expectedPath: "/admin/users",
    expectedText: /Users & Roles|Access matrix/i,
  },
  {
    path: "/finance",
    label: "dual-scope finance",
    fixture: FIXTURES.finance,
    expectedPath: "/finance",
    expectedText: /Finance|Payment readiness|Cross-module activity/i,
  },
  {
    path: "/finance",
    label: "procurement-only finance",
    fixture: FIXTURES.procurementFinance,
    expectedPath: "/finance",
    expectedText: /Finance|Payment readiness|Procurement Finance/i,
  },
  {
    path: "/warehouse/finance",
    label: "legacy warehouse finance redirect",
    fixture: FIXTURES.finance,
    expectedPath: "/finance",
    expectedText: /Finance|Payment readiness|Cross-module activity/i,
  },
  {
    path: "/procurement/approvals",
    label: "procurement approvals",
    fixture: FIXTURES.procurement,
    expectedPath: "/procurement/approvals",
    expectedText: /Approval|Inbox|Requests/i,
  },
  {
    path: "/procurement/requests/new",
    label: "new procurement request",
    fixture: FIXTURES.procurement,
    expectedPath: "/procurement/requests/new",
    expectedText: /New|Request|Purchase/i,
  },
  {
    path: "/legal/invites/new",
    label: "legal invite vendor",
    fixture: FIXTURES.legal,
    expectedPath: "/legal/invites/new",
    expectedText: /Invite|Vendor/i,
  },
  {
    path: "/vendor",
    label: "vendor portal",
    fixture: FIXTURES.vendor,
    expectedPath: "/vendor/",
    expectedText: /Vendor|Accreditation|Documents/i,
  },
];

const COMMAND_ROUTES: readonly CommandRouteCase[] = [
  {
    fixture: FIXTURES.procurement,
    query: "knowledge base",
    option: /Knowledge Base/i,
    expectedPath: "/knowledge",
  },
  {
    fixture: FIXTURES.procurement,
    query: "approval inbox",
    option: /Approval inbox/i,
    expectedPath: "/procurement/approvals",
  },
  {
    fixture: FIXTURES.legal,
    query: "invite vendor",
    option: /Invite vendor/i,
    expectedPath: "/legal/invites/new",
  },
  {
    fixture: FIXTURES.finance,
    query: "finance",
    option: /^Finance/i,
    expectedPath: "/finance",
  },
];

const CONTROL_SELECTOR = [
  "button",
  '[role="button"]',
  'input:not([type="hidden"])',
  "select",
  "textarea",
  "nav a[href]",
  "a[aria-label]",
  'a[class*="btn-"]',
].join(",");

for (const { path, label, maxStatus = 499 } of ROUTES) {
  test(`GET ${path} (${label}) renders a usable ${path === "/nonexistent-route" ? "recovery" : "route"}`, async ({
    page,
  }, testInfo) => {
    await assertRouteUsable(page, testInfo, { path, maxStatus });
  });
}

for (const route of AUTHENTICATED_ROUTES) {
  test(`signed in ${route.label} route stays usable on ${route.path}`, async ({
    page,
  }, testInfo) => {
    test.skip(memoryFixtureAuthDisabled, memoryFixtureSkipReason);
    await installMemorySession(page, route.fixture);
    await assertRouteUsable(page, testInfo, route);
    expect(
      new URL(page.url()).pathname,
      `${route.path} should not redirect to a fallback route`,
    ).toBe(route.expectedPath);
    await expect(page.locator("body")).toContainText(route.expectedText);
  });
}

for (const route of COMMAND_ROUTES) {
  test(`command palette opens ${route.expectedPath}`, async ({
    page,
  }, testInfo) => {
    test.skip(memoryFixtureAuthDisabled, memoryFixtureSkipReason);
    await installMemorySession(page, route.fixture);
    await assertRouteUsable(page, testInfo, { path: "/" });

    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox").fill(route.query);
    await dialog.getByRole("option", { name: route.option }).click();

    await expect(page).toHaveURL(
      new RegExp(`${escapeRegex(route.expectedPath)}/?$`),
    );
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await assertNoDocumentOverflow(page, route.expectedPath);
    await assertControlsAreReachable(page, route.expectedPath, testInfo);
  });
}

for (const navCase of [
  { label: "admin", fixture: FIXTURES.admin, link: /Admin|Users/i },
  { label: "finance", fixture: FIXTURES.finance, link: /Finance/i },
] as const) {
  test(`${navCase.label} destination is exposed in persistent navigation`, async ({
    page,
  }, testInfo) => {
    test.skip(memoryFixtureAuthDisabled, memoryFixtureSkipReason);
    await installMemorySession(page, navCase.fixture);
    await assertRouteUsable(page, testInfo, { path: "/" });
    const nav = page.getByRole("navigation", {
      name: testInfo.project.name.includes("mobile")
        ? "Primary mobile"
        : "Primary",
    });
    await expect(nav.getByRole("link", { name: navCase.link })).toBeVisible();
  });
}

function readEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return undefined;
  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((raw) => raw.trim())
    .find((raw) => raw.startsWith(`${key}=`));
  if (!line) return undefined;
  return line.slice(key.length + 1).trim();
}

async function installMemorySession(
  page: Page,
  fixture: MemoryFixture,
): Promise<void> {
  await page.addInitScript(
    ({ key, session }) => {
      window.sessionStorage.setItem(key, JSON.stringify(session));
    },
    {
      key: MEMORY_SESSION_KEY,
      session: { profileId: fixture.profileId, roles: fixture.roles },
    },
  );
}

async function assertRouteUsable(
  page: Page,
  testInfo: TestInfo,
  {
    path,
    maxStatus = 499,
  }: {
    readonly path: string;
    readonly maxStatus?: number;
  },
): Promise<void> {
  const consoleIssues = collectConsoleIssues(page);
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `no response received for ${path}`).not.toBeNull();

  const status = response!.status();
  expect(
    status,
    `expected ${path} to respond < ${maxStatus + 1}, got ${status}`,
  ).toBeLessThan(maxStatus + 1);

  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect
    .poll(() => visibleBodyTextLength(page), {
      message: `${path} should render visible body text`,
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const bodyText = (await page.locator("body").innerText()).trim();
  expect(
    bodyText,
    `${path} rendered the production configuration guard instead of the app`,
  ).not.toContain("Configuration missing");

  await expect
    .poll(() => page.locator("main").count(), {
      message: `${path} should expose a main landmark`,
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  await expect(page.locator("body")).toBeVisible();
  await assertNoDocumentOverflow(page, path);
  await assertNoKnownDeadLinks(page, path);
  await assertControlsAreReachable(page, path, testInfo);

  expect(
    consoleIssues.filter((issue) => !isAllowedConsoleIssue(issue)),
    `${path} should not emit console warnings/errors or page exceptions`,
  ).toEqual([]);
}

function collectConsoleIssues(page: Page): ConsoleIssue[] {
  const issues: ConsoleIssue[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    issues.push({
      type: msg.type(),
      text: msg.text(),
      location: `${msg.location().url}:${msg.location().lineNumber}`,
    });
  });
  page.on("pageerror", (error) => {
    issues.push({
      type: "pageerror",
      text: error.message,
      location: error.stack ?? "pageerror",
    });
  });
  return issues;
}

function isAllowedConsoleIssue(issue: ConsoleIssue): boolean {
  return /Failed to load resource.*404|favicon\.ico/i.test(issue.text);
}

async function visibleBodyTextLength(page: Page): Promise<number> {
  return page
    .locator("body")
    .innerText()
    .then((text) => text.trim().length);
}

async function assertNoDocumentOverflow(
  page: Page,
  path: string,
): Promise<void> {
  const result = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    );
    const offenders = Array.from(
      document.body.querySelectorAll<HTMLElement>("*"),
    )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim().replace(/\s+/g, " ").slice(0, 64) ??
            "",
          className: element.className?.toString().slice(0, 96) ?? "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          display: style.display,
          visibility: style.visibility,
        };
      })
      .filter(
        (item) =>
          item.display !== "none" &&
          item.visibility !== "hidden" &&
          (item.left < -2 || item.right > viewportWidth + 2),
      )
      .slice(0, 8);

    return { scrollWidth, viewportWidth, offenders };
  });

  expect(
    result.scrollWidth,
    `${path} should not create page-level horizontal scroll. Offenders: ${JSON.stringify(
      result.offenders,
    )}`,
  ).toBeLessThanOrEqual(result.viewportWidth + 2);
}

async function assertNoKnownDeadLinks(page: Page, path: string): Promise<void> {
  const result = await page.locator("a[href]").evaluateAll((anchors) => {
    const knownDeadPaths = new Set(["/procurement/inbox", "/legal/invite"]);
    const blockedSchemes = ["javascript:", "data:"];
    return anchors
      .map((anchor) => {
        const raw = anchor.getAttribute("href") ?? "";
        let pathname = raw;
        try {
          pathname = new URL(raw, window.location.origin).pathname;
        } catch {
          // Keep the raw value so the assertion can report it.
        }
        return {
          raw,
          text:
            anchor.getAttribute("aria-label") ??
            anchor.textContent?.trim().replace(/\s+/g, " ").slice(0, 64) ??
            "",
          knownDead: knownDeadPaths.has(pathname),
          blockedScheme: blockedSchemes.some((scheme) =>
            raw.toLowerCase().startsWith(scheme),
          ),
        };
      })
      .filter((item) => item.knownDead || item.blockedScheme);
  });

  expect(
    result,
    `${path} should not expose known-dead or unsafe links`,
  ).toEqual([]);
}

test('styled native choices retain visible labels and reachable touch targets', async ({ page }, testInfo) => {
  await page.setContent(`<label style="display:block;position:relative;width:180px;height:48px">
    <input type="radio" aria-label="Goods" style="position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0">Goods
  </label>`);
  await assertControlsAreReachable(page, 'styled-native-choice', testInfo);
  await page.getByRole('radio', { name: 'Goods', exact: true }).check();
  await expect(page.getByRole('radio', { name: 'Goods', exact: true })).toBeChecked();
  await page.locator('label').evaluate(element => element.style.opacity = '0');
  await expect(assertControlsAreReachable(page, 'hidden-choice-label', testInfo)).rejects.toThrow(/hidden\/transparent ancestor/);
});

test('reachability samples overlap between fixed chrome and retain real obstruction failures', async ({ page }, testInfo) => {
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body { margin: 0; min-height: 1700px; }
    header, footer { position: fixed; inset-inline: 0; height: 150px; background: white; z-index: 2; }
    header { top: 0; } footer { bottom: 0; }
    button { position: absolute; top: calc(100vh - 130px); width: 140px; height: 48px; }
  </style><header></header><button>Reachable guide</button><footer></footer>`);
  await assertControlsAreReachable(page, 'between-scroll-samples', testInfo);
  await page.getByRole('button', { name: 'Reachable guide' }).click();
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><button style="width:140px;height:48px">Covered guide</button>
    <div style="position:fixed;inset:0;z-index:2;background:white"></div>`);
  await expect(assertControlsAreReachable(page, 'persistent-overlay', testInfo)).rejects.toThrow(/intercepted/);
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body { margin: 0; min-height: 1700px; }
    button { position: absolute; top: calc(50vh - 30px); width: 140px; height: 48px; }
  </style><button>Covered scrollable guide</button>
    <div style="position:fixed;inset:0;z-index:2;background:white"></div>`);
  await expect(assertControlsAreReachable(page, 'scrollable-persistent-overlay', testInfo)).rejects.toThrow(/intercepted/);
});

test('reachability recovers a late scroll reset without overlooking permanent chrome obstruction', async ({ page }, testInfo) => {
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body { margin: 0; min-height: calc(250vh - 200px); }
    header, footer { position: fixed; inset-inline: 0; height: 150px; background: white; z-index: 2; }
    header { top: 0; } footer { bottom: 0; }
    button { position: absolute; top: calc(150vh - 124px); width: 140px; height: 48px; }
  </style><header></header><button onclick="this.dataset.clicked='true'">Late reset action</button><footer></footer>
  <script>
    document.body.dataset.resets = '0';
    addEventListener('scroll', () => {
      if (document.body.dataset.resets === '0' && Math.abs(scrollY - innerHeight) < 1) {
        document.body.dataset.resets = '1';
        queueMicrotask(() => scrollTo(0, 0));
      }
    });
  </script>`);
  await assertControlsAreReachable(page, 'late-scroll-reset', testInfo);
  await expect(page.locator('body')).toHaveAttribute('data-resets', '1');
  const attachment = testInfo.attachments.find(item => item.name === 'reachability-late-scroll-reset');
  expect(attachment).toBeDefined();
  const evidence = JSON.parse((attachment!.body ?? readFileSync(attachment!.path!)).toString());
  const height = await page.evaluate(() => innerHeight);
  expect(evidence.measurements.some((sample: { requestedScrollY: number; actualScrollY: number }) =>
    sample.requestedScrollY === height && sample.actualScrollY === 0)).toBe(true);
  const centered = evidence.measurements.find((sample: { targetIdentity?: number }) => sample.targetIdentity !== undefined);
  expect(centered, 'Late reset fixture must exercise the centered measurement').toBeDefined();
  expect(centered.reachableTargets).toEqual(expect.arrayContaining([
    expect.objectContaining({ identity: centered.targetIdentity, label: 'Late reset action', rect: expect.objectContaining({ height: 48 }) }),
  ]));
  const action = page.getByRole('button', { name: 'Late reset action' });
  await action.click();
  await expect(action).toHaveAttribute('data-clicked', 'true');
  await page.locator('header').evaluate(element => { element.style.height = '100vh'; });
  await expect(assertControlsAreReachable(page, 'late-reset-permanent-cover', testInfo)).rejects.toThrow(/intercepted/);
});

test('reachability allows subpixel arithmetic only, not undersized controls', async ({ page }, testInfo) => {
  const minimum = testInfo.project.name.includes('mobile') ? 44 : 32;
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><button style="width:150px;height:${minimum}px;border:0;padding:0;transform:scaleY(0.99999)">Exact target</button>`);
  await assertControlsAreReachable(page, 'subpixel-target', testInfo);
  await page.locator('button').evaluate((element, height) => { element.style.height = `${height}px`; }, minimum - 1);
  await expect(assertControlsAreReachable(page, 'undersized-target', testInfo)).rejects.toThrow(/controls below/);
});

test('reachability keeps identically labelled controls separate', async ({ page }, testInfo) => {
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body { margin: 0; min-height: 1700px; }
    button { position: absolute; left: 0; width: 140px; height: 48px; }
    button:first-of-type { top: 200px; } button:last-of-type { top: 900px; }
    #cover { position: absolute; top: 190px; left: 0; width: 150px; height: 68px; z-index: 2; background: white; }
  </style><button>Open guide</button><button>Open guide</button><div id="cover"></div>`);
  await expect(assertControlsAreReachable(page, 'duplicate-label-overlay', testInfo)).rejects.toThrow(/intercepted/);
  await page.locator('#cover').evaluate((element) => element.remove());
  await assertControlsAreReachable(page, 'duplicate-label-uncovered', testInfo);
});

test('reachability retains obstructions beyond its diagnostic limit', async ({ page }, testInfo) => {
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body { margin: 0; min-height: 2000px; }
    #actions { position: fixed; top: 0; left: 0; display: grid; grid-template-columns: repeat(3, 92px); gap: 4px; }
    button { width: 92px; height: 48px; }
    #last { position: absolute; top: 220px; left: 0; }
    #cover { position: absolute; top: 210px; left: 0; width: 100px; height: 68px; z-index: 2; background: white; }
    #temporary { position: fixed; inset: 0; z-index: 3; background: white; }
  </style><div id="actions">${Array.from({ length: 12 }, (_, index) => `<button>Action ${index + 1}</button>`).join('')}</div>
  <button id="last">Last action</button><div id="cover"></div><div id="temporary"></div>
  <script>addEventListener('scroll', () => { const cover = document.querySelector('#temporary'); if (cover) cover.hidden = scrollY > 0; });</script>`);
  await expect(assertControlsAreReachable(page, 'thirteenth-obstruction', testInfo)).rejects.toThrow(/intercepted/);
  await page.locator('#cover').evaluate((element) => element.remove());
  await page.locator('#temporary').evaluate((element) => element.remove());
  await assertControlsAreReachable(page, 'all-thirteen-uncovered', testInfo);
});

async function assertControlsAreReachable(
  page: Page,
  path: string,
  testInfo: TestInfo,
): Promise<void> {
  const minSize = testInfo.project.name.includes("mobile") ? 44 : 32;
  const scrollRegionSelector = '[data-testid="warehouse-scroll-region"]';
  const scrollRegionCount = await page.locator(scrollRegionSelector).count();
  const useScrollRegion = scrollRegionCount === 1;
  const { originalY, scrollHeight, viewportHeight } = await page.evaluate(
    ({ selector, useRegion }) => {
      const region = useRegion
        ? document.querySelector<HTMLElement>(selector)
        : null;
      return {
        originalY: region?.scrollTop ?? window.scrollY,
        scrollHeight:
          region?.scrollHeight ??
          Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
          ),
        viewportHeight: region?.clientHeight ?? window.innerHeight,
      };
    },
    { selector: scrollRegionSelector, useRegion: useScrollRegion },
  );
  // Overlap enough to inspect controls between the fixed header and bottom nav.
  const step = Math.max(1, Math.floor(viewportHeight * 0.5));
  const maxY = Math.max(0, scrollHeight - viewportHeight);
  const samples = Array.from(
    new Set([
      0,
      ...Array.from({ length: Math.ceil(maxY / step) + 1 }, (_, index) =>
        Math.min(maxY, index * step),
      ),
      maxY,
    ]),
  ).sort((a, b) => a - b);
  const smallTargets: TargetIssue[] = [];
  const hiddenTargets: TargetIssue[] = [];
  const blockedTargets: BlockedTargetIssue[] = [];
  const reachableTargetKeys = new Set<string>();
  const measurements: unknown[] = [];
  // Repeated row actions must not clear each other's obstruction failures.
  const identities = await page.evaluateHandle(() => ({ ids: new WeakMap<Element, number>(), nextId: 1 }));

  try {
    const inspectAt = async (scrollY: number, targetIdentity?: number) => {
      const requestedScrollY = await page.evaluate(
        ({ selector, controls, useRegion, y, targetIdentity, identities }) => {
          const region = useRegion
            ? document.querySelector<HTMLElement>(selector)
            : null;
          if (targetIdentity !== undefined) {
            const target = Array.from(document.querySelectorAll<HTMLElement>(controls))
              .find(element => identities.ids.get(element) === targetIdentity);
            if (!target?.isConnected) throw new Error(`Reachability target ${targetIdentity} disconnected during measurement`);
            const rect = target.getBoundingClientRect();
            const center = region
              ? region.getBoundingClientRect().top + region.clientTop + region.clientHeight / 2
              : window.innerHeight / 2;
            y = (region?.scrollTop ?? window.scrollY) + rect.top + rect.height / 2 - center;
          }
          if (region) region.scrollTo({ top: y, behavior: 'instant' });
          else window.scrollTo({ top: y, behavior: 'instant' });
          return y;
        },
        {
          selector: scrollRegionSelector,
          controls: CONTROL_SELECTOR,
          useRegion: useScrollRegion,
          y: scrollY,
          targetIdentity,
          identities,
        },
      );
      const result = await page.evaluate(
        async ({ selector, minSize, identities, scrollRegionSelector, useScrollRegion }) => {
          const region = useScrollRegion ? document.querySelector<HTMLElement>(scrollRegionSelector) : null;
          // Scroll effects and route layout can settle after scrollTo returns.
          // Require consecutive unchanged frames, never an eventual unblocked hit.
          await new Promise<void>((resolve, reject) => {
            let previous = '', stableFrames = 0, frame = 0;
            const timer = setTimeout(() => {
              cancelAnimationFrame(frame);
              reject(new Error('Reachability geometry did not settle within 2000ms'));
            }, 2000);
            const sample = () => {
              const geometry = JSON.stringify([
                region?.scrollTop ?? window.scrollY, window.scrollX, window.innerWidth, window.innerHeight,
                region?.scrollHeight ?? document.documentElement.scrollHeight, region?.clientHeight,
                ...Array.from(document.querySelectorAll(`${selector}, header, footer, [data-shell-mobile-nav]`), element => {
                  const rect = element.getBoundingClientRect();
                  return [rect.x, rect.y, rect.width, rect.height];
                }),
              ]);
              stableFrames = geometry === previous && document.fonts.status === 'loaded' ? stableFrames + 1 : 0;
              previous = geometry;
              if (stableFrames >= 3) { clearTimeout(timer); resolve(); }
              else frame = requestAnimationFrame(sample);
            };
            frame = requestAnimationFrame(sample);
          });
          const hasHiddenAncestor = (element: Element): boolean => {
            for (
              let current: Element | null = element;
              current;
              current = current.parentElement
            ) {
              const style = window.getComputedStyle(current);
              if (style.display === "none" || style.visibility === "hidden")
                return true;
              if (Number(style.opacity) === 0) {
                // A styled native choice may cover its visible label. Its
                // label, ancestors, dimensions and hit target still get checked.
                const isLabelledChoice = current === element &&
                  current instanceof HTMLInputElement && ['radio', 'checkbox'].includes(current.type) &&
                  Array.from(current.labels ?? []).some(label => {
                    const labelStyle = getComputedStyle(label);
                    const bounds = label.getBoundingClientRect();
                    const inputBounds = element.getBoundingClientRect();
                    return Boolean(label.textContent?.trim()) && labelStyle.display !== 'none' &&
                      labelStyle.visibility !== 'hidden' && Number(labelStyle.opacity) > 0 &&
                      bounds.width + 0.001 >= minSize && bounds.height + 0.001 >= minSize &&
                      inputBounds.left >= bounds.left - 1 && inputBounds.right <= bounds.right + 1 &&
                      inputBounds.top >= bounds.top - 1 && inputBounds.bottom <= bounds.bottom + 1;
                  });
                if (!isLabelledChoice) return true;
              }
              if (
                current.hasAttribute("hidden") ||
                current.getAttribute("aria-hidden") === "true"
              ) {
                return true;
              }
            }
            return false;
          };

          const isVisible = (element: Element, rect: DOMRect): boolean => {
            if (hasHiddenAncestor(element)) return false;
            if (element.closest("details:not([open])")) return false;
            if (rect.width <= 0 || rect.height <= 0) return false;
            if (
              rect.bottom < 0 ||
              rect.top > window.innerHeight ||
              rect.right < 0 ||
              rect.left > window.innerWidth
            ) {
              return false;
            }
            return true;
          };

          const describe = (element: Element): TargetIssue => {
            const rect = element.getBoundingClientRect();
            let identity = identities.ids.get(element);
            if (identity === undefined) {
              identity = identities.nextId++;
              identities.ids.set(element, identity);
            }
            return {
              identity,
              label:
                element.getAttribute("aria-label") ??
                element.textContent?.trim().replace(/\s+/g, " ").slice(0, 64) ??
                element.tagName.toLowerCase(),
              selector: describeElement(element),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
          };

          const elements = Array.from(
            document.querySelectorAll<HTMLElement>(selector),
          )
            .filter((element) => !(element as HTMLButtonElement).disabled)
            .filter((element) => !element.classList.contains("sr-only"))
            .filter((element) => {
              const input = element as HTMLInputElement;
              return input.type !== "file";
            })
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return false;
              if (element.closest("details:not([open])")) return false;
              return !(
                rect.bottom < 0 ||
                rect.top > window.innerHeight ||
                rect.right < 0 ||
                rect.left > window.innerWidth
              );
            });

          const hiddenTargets = elements
            .filter((element) => hasHiddenAncestor(element))
            .map(describe)
            .slice(0, 12);

          const visibleElements = elements.filter((element) =>
            isVisible(element, element.getBoundingClientRect()),
          );

          const reachableTargets: TargetIssue[] = [];

          const smallTargets = visibleElements
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width + 0.001 < minSize || rect.height + 0.001 < minSize;
            })
            .map(describe)
            .slice(0, 12);

          const blockedTargets = visibleElements
            .map((element): BlockedTargetIssue | null => {
              const rect = element.getBoundingClientRect();
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;
              if (
                x < 0 ||
                x > window.innerWidth ||
                y < 0 ||
                y > window.innerHeight
              ) {
                return null;
              }
              const blocker = document.elementFromPoint(x, y);
              if (blocker && (element === blocker || element.contains(blocker))) {
                reachableTargets.push(describe(element));
                return null;
              }
              if (!blocker) return null;
              if (
                blocker.tagName.toLowerCase() === "nextjs-portal" ||
                blocker.closest("nextjs-portal")
              ) {
                return null;
              }
              return {
                ...describe(element),
                blocker: describeElement(blocker),
                blockerRect: (() => {
                  const bounds = blocker.getBoundingClientRect();
                  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
                })(),
              };
            })
            .filter((item): item is BlockedTargetIssue => item !== null);

          return {
            actualScrollY: region?.scrollTop ?? window.scrollY,
            reachableTargets,
            hiddenTargets,
            smallTargets,
            blockedTargets,
          };

          function describeElement(element: Element): string {
            const id = element.id ? `#${element.id}` : "";
            const classes =
              typeof element.className === "string"
                ? element.className
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 4)
                    .map((name) => `.${name}`)
                    .join("")
                : "";
            return `${element.tagName.toLowerCase()}${id}${classes}`;
          }
        },
        { selector: CONTROL_SELECTOR, minSize, identities, scrollRegionSelector, useScrollRegion },
      );
      measurements.push({ requestedScrollY, actualScrollY: result.actualScrollY, targetIdentity, ...result });
      smallTargets.push(
        ...result.smallTargets.map((item) => ({ ...item, scrollY: result.actualScrollY })),
      );
      hiddenTargets.push(
        ...result.hiddenTargets.map((item) => ({ ...item, scrollY: result.actualScrollY })),
      );
      for (const item of result.reachableTargets) {
        reachableTargetKeys.add(targetKey(item));
      }
      blockedTargets.push(
        ...result.blockedTargets.map((item) => ({ ...item, scrollY: result.actualScrollY })),
      );
    };
    for (const scrollY of samples) await inspectAt(scrollY);
    // One ordinary centered scroll per still-blocked identity closes sampling
    // gaps without ignoring chrome or retrying a persistent obstruction.
    const unresolved = [...new Set(blockedTargets
      .filter(item => !reachableTargetKeys.has(targetKey(item)))
      .map(item => item.identity))];
    for (const identity of unresolved) {
      if (!reachableTargetKeys.has(String(identity))) await inspectAt(0, identity);
    }
  } finally {
    await page.evaluate(
      ({ selector, useRegion, y }) => {
        const region = useRegion
          ? document.querySelector<HTMLElement>(selector)
          : null;
        if (region) region.scrollTo(0, y);
        else window.scrollTo(0, y);
      },
      {
        selector: scrollRegionSelector,
        useRegion: useScrollRegion,
        y: originalY,
      },
    ).finally(() => identities.dispose());
    await testInfo.attach(`reachability-${path.replace(/[^a-z0-9-]/gi, '-')}`, {
      body: Buffer.from(JSON.stringify({ path, measurements }, null, 2)),
      contentType: 'application/json',
    });
  }

  expect(
    dedupeTargets(smallTargets).slice(0, 12),
    `${path} has controls below ${minSize}px in ${testInfo.project.name}`,
  ).toEqual([]);
  expect(
    dedupeTargets(hiddenTargets).slice(0, 12),
    `${path} has controls with a hidden/transparent ancestor in ${testInfo.project.name}`,
  ).toEqual([]);
  expect(
    dedupeTargets(
      blockedTargets.filter(
        (item) => !reachableTargetKeys.has(targetKey(item)),
      ),
    ).slice(0, 12),
    `${path} has controls whose center point is intercepted by another element`,
  ).toEqual([]);
}

function dedupeTargets<T extends TargetIssue>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = `${item.identity}:${item.width}:${item.height}:${item.scrollY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function targetKey(item: Pick<TargetIssue, "identity">): string {
  return String(item.identity);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
