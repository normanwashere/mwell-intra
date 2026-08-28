import { expect, test } from "@playwright/test";
import assessment from "../../../../modules/learning/src/marketing-reservation-assessment.json" with { type: "json" };

const email = "intra.test.marketing.events@mwell.com.ph";
const projectRef = "kkoitlvydytdhlpxhuah";
const requirementId = "internal.warehouse.marketing-reservation-assessment.v1";
// Synthetic UAT test responses, submitted only through the real assessment UI.
const responses = [
  "respect-availability", "hold-not-issue", "event-product-purpose",
  "reservation-only", "reconcile-before-retry",
];

test("Marketing completes reservation assessment through the governed UI", async ({ page, request, context, baseURL }, info) => {
  expect(process.env.POLICY_ALLOW_TEST_MUTATIONS, "Explicit synthetic UAT learning mutation approval is required").toBe("true");
  expect(process.env.AUDIT_PASSWORD, "Provide the existing synthetic Marketing UAT password").toBeTruthy();
  expect(new URL(baseURL!).origin).toBe("https://mwell-intra-uat.vercel.app");
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const health = await request.get("/api/health", {
    headers: bypass ? { "x-vercel-protection-bypass": bypass } : {},
  });
  expect(health.ok(), "UAT health identity must be readable before login").toBe(true);
  expect((await health.json()).deployment).toMatchObject({ appEnv: "uat", supabaseProjectRef: projectRef });
  if (bypass) {
    await context.route((url) => url.origin === new URL(baseURL!).origin, async (route) => {
      const response = await route.fetch({
        headers: { ...route.request().headers(), "x-vercel-protection-bypass": bypass },
        maxRedirects: 0,
      });
      await route.fulfill({ response });
    });
  }
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const destination = `/onboarding?requirement=${encodeURIComponent(requirementId)}&next=%2Fwarehouse%2Fallocations`;
  await page.goto(`/login?redirect=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(process.env.AUDIT_PASSWORD!);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 25_000 });
  await page.goto(destination);
  const row = page.locator(`[id="onboarding-requirement-${requirementId}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByRole("heading", { name: assessment.title, exact: true })).toBeVisible();
  const completed = await row.getByText("Complete", { exact: true }).isVisible();
  if (!completed) {
    // Old event practice completion must not make the new reservation action available.
    await page.goto("/warehouse/allocations");
    await expect(page.getByRole("heading", { name: "Allocations", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(?:New reservation|Reserve)$/i })).toHaveCount(0);
    await page.goto(destination);
    const start = page.getByRole("button", { name: new RegExp(`^(Start|Resume|Try again) Marketing event reservation controls`) });
    await expect(start, "The deployed build must include reservation assessment content").toBeEnabled();
    await start.click();
    const dialog = page.getByRole("dialog", { name: assessment.title, exact: true });
    await expect(dialog).toBeVisible();
    for (const [index, question] of assessment.questions.entries()) {
      await expect(dialog.getByText(question.prompt, { exact: true })).toBeVisible();
      const option = question.options.find((item) => item.id === responses[index]);
      expect(option).toBeTruthy();
      await dialog.getByRole("radio", { name: option!.label, exact: true }).check();
      const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      expect(width.content).toBeLessThanOrEqual(width.viewport);
      await page.screenshot({ path: info.outputPath(`assessment-question-${index + 1}.png`) });
      if (index < assessment.questions.length - 1) {
        await dialog.getByRole("button", { name: "Next question", exact: true }).click();
      }
    }
    const responsePromise = page.waitForResponse((response) =>
      response.url() === `https://${projectRef}.supabase.co/rest/v1/rpc/submit_assessment`
      && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Submit answers", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const result = await response.json();
    expect(result).toMatchObject({ status: "passed", score: 100 });
    await expect(dialog.getByRole("heading", { name: "Assessment passed", exact: true })).toBeVisible();
    await info.attach("governed-assessment-result", {
      body: JSON.stringify({ status: result.status, score: result.score }), contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("assessment-passed.png") });
  } else {
    info.annotations.push({ type: "already-completed", description: "Existing normal completion retained; no evidence reset or manufactured reattempt." });
  }
  await page.goto(destination);
  await expect(row.getByText("Complete", { exact: true })).toBeVisible();
  await page.goto("/warehouse/allocations");
  const reserve = page.getByRole("button", { name: /^(?:New reservation|Reserve)$/i });
  await expect(reserve, "Requires the pending raw Marketing grant as well as the earned certification").toBeEnabled();
  await expect(page.getByRole("button", { name: /^Issue(?: items)?$/i })).toHaveCount(0);
  await reserve.click();
  const reservation = page.getByRole("dialog", { name: "New reservation", exact: true });
  await expect(reservation.getByLabel("Event", { exact: true })).toBeVisible();
  await expect(reservation.getByLabel("Product", { exact: true }).first()).toBeVisible();
  await expect(reservation.getByRole("button", { name: "Reserve", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("certified-reservation-entry.png") });
  // Do not submit an operational reservation or touch issue/return workflows.
  expect(errors).toEqual([]);
});
