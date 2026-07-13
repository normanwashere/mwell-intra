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
  readonly label: string;
  readonly selector: string;
  readonly width: number;
  readonly height: number;
  readonly scrollY?: number;
}

interface BlockedTargetIssue extends TargetIssue {
  readonly blocker: string;
}

const ROUTES: readonly RouteCase[] = [
  { path: "/", label: "dashboard" },
  { path: "/login", label: "sign-in" },
  { path: "/reset-password", label: "reset-password" },
  { path: "/warehouse", label: "warehouse module" },
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
    roles: { core: ["staff"], warehouse: ["finance"] },
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
    path: "/warehouse/finance",
    label: "warehouse finance",
    fixture: FIXTURES.finance,
    expectedPath: "/warehouse/finance",
    expectedText: /Finance|Valuation|Reconciliation/i,
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
    expectedPath: "/warehouse/finance",
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
  const step = Math.max(1, Math.floor(viewportHeight * 0.75));
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

  try {
    for (const scrollY of samples) {
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
          y: scrollY,
        },
      );
      await page.waitForTimeout(50);
      const result = await page.evaluate(
        ({ selector, minSize }) => {
          const hasHiddenAncestor = (element: Element): boolean => {
            for (
              let current: Element | null = element;
              current;
              current = current.parentElement
            ) {
              const style = window.getComputedStyle(current);
              if (style.display === "none" || style.visibility === "hidden")
                return true;
              if (Number(style.opacity) === 0) return true;
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
            return {
              label:
                element.getAttribute("aria-label") ??
                element.textContent?.trim().replace(/\s+/g, " ").slice(0, 64) ??
                element.tagName.toLowerCase(),
              selector: describeElement(element),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
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

          const visibleTargets = visibleElements.map(describe);

          const smallTargets = visibleElements
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width < minSize || rect.height < minSize;
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
              if (!blocker || element === blocker || element.contains(blocker))
                return null;
              if (
                blocker.tagName.toLowerCase() === "nextjs-portal" ||
                blocker.closest("nextjs-portal")
              ) {
                return null;
              }
              return {
                ...describe(element),
                blocker: describeElement(blocker),
              };
            })
            .filter((item): item is BlockedTargetIssue => item !== null)
            .slice(0, 12);

          return {
            visibleTargets,
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
        { selector: CONTROL_SELECTOR, minSize },
      );
      smallTargets.push(
        ...result.smallTargets.map((item) => ({ ...item, scrollY })),
      );
      hiddenTargets.push(
        ...result.hiddenTargets.map((item) => ({ ...item, scrollY })),
      );
      const blockedKeys = new Set(result.blockedTargets.map(targetKey));
      for (const item of result.visibleTargets) {
        if (!blockedKeys.has(targetKey(item)))
          reachableTargetKeys.add(targetKey(item));
      }
      blockedTargets.push(
        ...result.blockedTargets.map((item) => ({ ...item, scrollY })),
      );
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
    );
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
    const key = `${item.selector}:${item.label}:${item.width}:${item.height}:${item.scrollY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function targetKey(item: Pick<TargetIssue, "selector" | "label">): string {
  return `${item.selector}:${item.label}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
