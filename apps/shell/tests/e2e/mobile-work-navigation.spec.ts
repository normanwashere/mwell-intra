import { expect, test, type Page } from "@playwright/test";
import {
  LEARNING_CATALOG,
  roleCurriculumFor,
} from "../../../../modules/learning/src/catalog";

const SESSION_KEY = "intra.memory-session.v1";

const PERSONAS = [
  {
    label: "Operations Associate",
    profileId: "demo-warehouse-operator",
    roles: {
      core: ["staff"],
      warehouse: ["warehouse_operator"],
    },
  },
  {
    label: "Operations Lead",
    profileId: "demo-logistics",
    roles: {
      core: ["staff"],
      warehouse: ["warehouse_supervisor", "logistics_supervisor"],
      procurement: ["approver"],
      product: ["operations_partner"],
    },
  },
] as const;

const WIDTHS = [320, 340, 359, 360, 390] as const;

function completedOrientationProgress(
  roles: Record<string, readonly string[]>,
) {
  const requirementIds = Object.entries(roles).flatMap(
    ([module, moduleRoles]) =>
      moduleRoles.flatMap(
        (role) =>
          roleCurriculumFor(module as never, role as never)?.requirementIds ??
          [],
      ),
  );
  const now = "2026-08-26T00:00:00.000Z";
  return LEARNING_CATALOG.requirements
    .filter(
      (requirement) =>
        requirement.kind === "orientation" &&
        requirementIds.includes(requirement.id),
    )
    .map((requirement) => ({
      assignmentRequirementId: `preview:${requirement.id}`,
      requirementId: requirement.id,
      requirementVersion: requirement.version,
      state: "passed",
      attemptCount: 1,
      allowsSharedCompletion: true,
      completedAt: now,
      updatedAt: now,
    }));
}

async function installCompletedSession(
  page: Page,
  persona: (typeof PERSONAS)[number],
) {
  const progress = completedOrientationProgress(persona.roles);
  await page.addInitScript(
    ({ profileId, roles, progress }) => {
      sessionStorage.setItem(
        "intra.memory-session.v1",
        JSON.stringify({ profileId, roles }),
      );
      sessionStorage.setItem(
        `intra.demo-learning.v1:${profileId}:${JSON.stringify(roles)}`,
        JSON.stringify({ progress, completedCheckpoints: {} }),
      );
    },
    { profileId: persona.profileId, roles: persona.roles, progress },
  );
}

for (const persona of PERSONAS) {
  test(`${persona.label} /work mobile navigation fits 320px and nearby widths`, async ({
    page,
  }) => {
    await installCompletedSession(page, persona);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/work");
      await expect(page).toHaveURL(/\/work$/);
      await expect(
        page.getByRole("heading", { name: "My Work" }),
      ).toBeVisible();

      const layout = await page.evaluate(() => {
        const nav = document.querySelector<HTMLElement>(
          'nav[aria-label="Primary mobile"]',
        );
        const list = nav?.querySelector<HTMLUListElement>("ul");
        if (!nav || !list) throw new Error("Primary mobile navigation missing");
        const visibleLinks = [
          ...list.querySelectorAll<HTMLAnchorElement>("a"),
        ].filter(
          (link) => getComputedStyle(link.closest("li")!).display !== "none",
        );
        const visibleButtons = [
          ...list.querySelectorAll<HTMLButtonElement>("button"),
        ].filter(
          (button) =>
            getComputedStyle(button.closest("li")!).display !== "none",
        );
        const targets = [...visibleLinks, ...visibleButtons];
        const targetGeometry = targets.map((target) => {
          const bounds = target.getBoundingClientRect();
          const label = target.querySelector<HTMLElement>("span:last-of-type");
          return {
            name:
              target.getAttribute("aria-label") ?? target.textContent?.trim(),
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            height: bounds.height,
            labelClientWidth: label?.clientWidth ?? 0,
            labelScrollWidth: label?.scrollWidth ?? 0,
          };
        });
        const navBounds = nav.getBoundingClientRect();
        const listBounds = list.getBoundingClientRect();
        return {
          viewportWidth: document.documentElement.clientWidth,
          documentScrollWidth: Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ),
          nav: {
            left: navBounds.left,
            right: navBounds.right,
            width: navBounds.width,
          },
          list: {
            left: listBounds.left,
            right: listBounds.right,
            width: listBounds.width,
            scrollWidth: list.scrollWidth,
          },
          narrowOverflowName:
            list
              .querySelector<HTMLAnchorElement>(
                '[data-mobile-nav-narrow-overflow="true"] a',
              )
              ?.getAttribute("aria-label") ?? null,
          targetGeometry,
        };
      });

      expect(
        layout.documentScrollWidth,
        `${persona.label} at ${width}px`,
      ).toBeLessThanOrEqual(width);
      expect(layout.nav).toEqual({ left: 0, right: width, width });
      expect(layout.list.left).toBeGreaterThanOrEqual(0);
      expect(layout.list.right).toBeLessThanOrEqual(width);
      expect(layout.list.scrollWidth).toBeLessThanOrEqual(width);
      expect(layout.targetGeometry).toHaveLength(width < 360 ? 4 : 5);
      for (const target of layout.targetGeometry) {
        expect(
          target.left,
          `${target.name} left edge at ${width}px`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          target.right,
          `${target.name} right edge at ${width}px`,
        ).toBeLessThanOrEqual(width);
        expect(
          target.width,
          `${target.name} width at ${width}px`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          target.height,
          `${target.name} height at ${width}px`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          target.labelScrollWidth,
          `${target.name} label clipping at ${width}px`,
        ).toBeLessThanOrEqual(target.labelClientWidth + 1);
      }

      if (width < 360) {
        expect(layout.narrowOverflowName).not.toBeNull();
        await page.getByRole("button", { name: "More" }).click();
        const allAreas = page.getByRole("navigation", {
          name: "All accessible areas",
        });
        await expect(allAreas).toBeVisible();
        await expect(
          allAreas.getByRole("link", {
            name: layout.narrowOverflowName!,
            exact: true,
          }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      }
    }
  });
}
