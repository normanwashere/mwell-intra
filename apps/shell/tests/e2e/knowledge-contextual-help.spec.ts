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
  test(`${scenario.name} pages expose exact contextual guidance`, async ({
    page,
  }) => {
    await setSession(page, scenario.session);
    await page.goto(scenario.route);

    const help = page.getByRole("link", { name: scenario.label });
    await expect(help).toBeVisible();
    await expect(help).toHaveAttribute("href", scenario.href);
  });
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
