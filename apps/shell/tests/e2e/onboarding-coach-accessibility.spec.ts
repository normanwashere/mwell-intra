import { expect, test, type Page } from "@playwright/test";
import { auditWarehouseLayout } from "../helpers/warehouseLayoutAudit";

const SESSION_KEY = "intra.memory-session.v1";

async function installEmployee(page: Page) {
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    {
      key: SESSION_KEY,
      value: {
        profileId: "demo-operations",
        roles: { core: ["staff"], warehouse: ["operations"] },
      },
    },
  );
}

test.describe("accessible onboarding coach", () => {
  test("starts a governed attempt and supports keyboard, back, pause, resume, and exit", async ({
    page,
  }, testInfo) => {
    await installEmployee(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const operationalWrites: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        /supabase|\/rest\/v1|\/rpc\//i.test(request.url())
      ) {
        operationalWrites.push(request.url());
      }
    });

    await page.goto("/onboarding");
    const launcher = page.getByRole("button", { name: "Start Role orientation" });
    await launcher.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Confirm why this step is assigned" }),
    ).toBeFocused();
    if (testInfo.project.name.startsWith("mobile")) {
      await expect(dialog).toHaveAttribute("data-placement", "sheet");
    } else {
      await expect(dialog).not.toHaveAttribute("data-placement", "sheet");
    }
    await expect(page.locator("[data-training-target='true']")).toHaveCount(1);
    await page.screenshot({
      path: testInfo.outputPath(`onboarding-coach-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await dialog.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("heading", { name: "Role orientation" })).toBeFocused();
    await dialog.getByRole("button", { name: "Back" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      dialog.getByRole("heading", { name: "Confirm why this step is assigned" }),
    ).toBeFocused();

    await dialog.getByRole("button", { name: "Resume later" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Resume", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Resume", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Finish review" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      dialog.getByRole("heading", { name: "Guided review complete" }),
    ).toBeFocused();
    await expect(page.getByText("Complete", { exact: true })).toBeVisible();

    await page
      .getByRole("region", { name: "Training mode" })
      .getByRole("button", { name: "Exit training" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Your required steps" }),
    ).toBeFocused();
    expect(operationalWrites).toEqual([]);

    const layout = await auditWarehouseLayout(page);
    expect(layout.overflowElements).toEqual([]);
    expect(layout.clippedControls).toEqual([]);
    expect(layout.overlaps).toEqual([]);
    expect(layout.deadEnds).toEqual([]);
  });

  test("reflows at 200 percent zoom without hiding coach actions", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440", "One desktop zoom proof is sufficient.");
    await installEmployee(page);
    await page.goto("/onboarding");
    await page.getByRole("button", { name: "Start Role orientation" }).click();
    await page.setViewportSize({ width: 720, height: 450 });

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Resume later" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Exit training" })).toBeVisible();
    const layout = await auditWarehouseLayout(page);
    expect(layout.overflowElements).toEqual([]);
    expect(layout.clippedControls).toEqual([]);
    expect(layout.overlaps).toEqual([]);
  });
});
