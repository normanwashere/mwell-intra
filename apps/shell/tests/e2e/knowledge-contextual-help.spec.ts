import { expect, test, type Page } from "@playwright/test";

const MEMORY_SESSION_KEY = "intra.memory-session.v1";

const setSession = async (
  page: Page,
  session: { profileId: string; roles: Record<string, readonly string[]> },
) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    },
    { key: MEMORY_SESSION_KEY, value: session },
  );
};

test("an operational page links directly to its exact feature guide", async ({
  page,
}) => {
  await setSession(page, {
    profileId: "demo-warehouse-admin",
    roles: { core: ["staff"], warehouse: ["warehouse_admin"] },
  });

  await page.goto("/warehouse/receiving");

  const help = page.getByRole("link", {
    name: "Help for Warehouse receiving",
  });
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute(
    "href",
    "/knowledge?article=feature-warehouse-receiving",
  );
});

for (const scenario of [
  {
    name: "procurement",
    session: {
      profileId: "demo-procurement",
      roles: { core: ["staff"], procurement: ["procurement_officer"] },
    },
    route: "/procurement/requests/new",
    label: "Help for Create purchase request",
    href: "/knowledge?article=feature-procurement-request-create",
  },
  {
    name: "legal",
    session: {
      profileId: "demo-legal",
      roles: { core: ["staff"], legal: ["admin"] },
    },
    route: "/legal/invites/new",
    label: "Help for Invite vendor",
    href: "/knowledge?article=feature-legal-invite-vendor",
  },
  {
    name: "vendor",
    session: {
      profileId: "demo-vendor",
      roles: { core: ["vendor_portal"] },
    },
    route: "/vendor",
    label: "Help for Vendor portal cases",
    href: "/knowledge?article=feature-vendor-cases",
  },
] as const) {
  test(`${scenario.name} pages expose exact contextual guidance${scenario.name === "vendor" ? "" : " with controlled context response"}`, async ({
    page,
  }) => {
    await setSession(page, scenario.session);
    const requestedPaths: string[] = [];
    if (scenario.name !== "vendor") {
      await page.route((url) => url.pathname === "/api/knowledge/context", async (route) => {
        const url = new URL(route.request().url());
        expect(url.pathname).toBe("/api/knowledge/context");
        expect(route.request().method()).toBe("GET");
        requestedPaths.push(url.searchParams.get("path") ?? "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ guide: url.searchParams.get("path") === scenario.route
            ? { title: scenario.label.replace(/^Help for /, ""), href: scenario.href }
            : null }),
        });
      });
    }
    await page.goto(scenario.route);

    const help = page.getByRole("link", { name: scenario.label });
    await expect(help).toBeVisible();
    await expect(help).toHaveAttribute("href", scenario.href);
    if (scenario.name !== "vendor") expect(requestedPaths).toContain(scenario.route);
  });

  if (scenario.name !== "vendor") {
    test(`${scenario.name} memory context uses the generic knowledge fallback without server authentication`, async ({ page }) => {
      await setSession(page, scenario.session);
      const responsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/knowledge/context" && url.searchParams.get("path") === scenario.route;
      });
      await page.goto(scenario.route);
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ guide: null, unavailable: true });
      await expect(page.getByRole("link", { name: "Open the Knowledge Base", exact: true })).toHaveAttribute("href", "/knowledge");
      await expect(page.getByRole("link", { name: scenario.label, exact: true })).toHaveCount(0);
    });
  }
}

test("role capability guidance uses plain language and a specific meaning", async ({
  page,
}) => {
  await setSession(page, {
    profileId: "demo-legal",
    roles: { core: ["staff"], legal: ["admin"] },
  });

  await page.goto("/knowledge?article=role-legal_admin");

  const capabilityRow = page.getByRole("row", {
    name: /Manage requirement checklists/i,
  });
  await expect(capabilityRow).toBeVisible();
  await expect(capabilityRow).toContainText(
    "Configure the evidence requirements used to review vendor applications.",
  );
});

test("policy guidance exposes document control status instead of an unverified title", async ({
  page,
}) => {
  await setSession(page, {
    profileId: "demo-legal",
    roles: { core: ["staff"], legal: ["admin"] },
  });

  await page.goto("/knowledge?article=policy-vendor-accreditation");

  await expect(
    page.getByRole("heading", { name: "Controlled source" }),
  ).toBeVisible();
  await expect(page.getByText(/Version 2\.0/)).toBeVisible();
  await expect(
    page.getByText(/Effective date requires owner confirmation/),
  ).toBeVisible();
});
