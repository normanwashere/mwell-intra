import { finishGuidedDialog, ASSESSMENT_ANSWERS, waitForAssessmentResult, waitForOrientationState, assertCurriculumComplete } from './orientation-driver.mjs';
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertApprovedMutationTarget,
  installScopedProtectionBypass,
  verifyDeployedTargetIdentity,
} from "../lib/target-environment.mjs";
import { auditPersonas, assertAuditIdentityScope } from './uat-audit-identities.mjs';
import { resolveSharedUatPassword } from "./provision-uat-intra-test-users.mjs";

const identityScope = process.env.AUDIT_IDENTITY_SCOPE ?? '';
assertAuditIdentityScope(identityScope, process.env.APP_ENV, 'onboarding');

const require = createRequire(path.resolve("apps/shell/package.json"));
const { chromium } = require("@playwright/test");

const VIEWPORTS = {
  "desktop-1440": { width: 1440, height: 900 },
  "mobile-390": { width: 390, height: 844 },
};

const baseUrl = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const viewportName = process.env.AUDIT_VIEWPORT ?? "desktop-1440";
const viewport = VIEWPORTS[viewportName];
const mutate = process.env.AUDIT_ORIENTATION_MUTATIONS === "true";
const roleFilter = process.env.AUDIT_ROLE?.trim();
const outputPath = path.resolve(
  process.env.AUDIT_OUTPUT_PATH ??
    `test-results/onboarding-${viewportName}.json`,
);
const evidenceDir = path.resolve(
  process.env.AUDIT_EVIDENCE_DIR ?? path.join(path.dirname(outputPath), "evidence"),
);
const password = resolveSharedUatPassword(process.env.AUDIT_PASSWORD ?? "");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!baseUrl || !baseUrl.startsWith("https://")) {
  throw new Error("AUDIT_BASE_URL must be the HTTPS UAT deployment URL.");
}
if (!viewport) {
  throw new Error(`Unsupported AUDIT_VIEWPORT ${viewportName}.`);
}

assertApprovedMutationTarget({
  appEnv: process.env.APP_ENV,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  expectedProjectRef: process.env.SUPABASE_PROJECT_REF,
  productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
  mutationsRequested: mutate,
  mutationsApproved: process.env.POLICY_ALLOW_TEST_MUTATIONS === "true",
});

await verifyDeployedTargetIdentity({
  baseUrl,
  appEnv: process.env.APP_ENV,
  expectedProjectRef: process.env.SUPABASE_PROJECT_REF,
  productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
  mutationsRequested: mutate,
  protectionBypass,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function evidenceToken(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function login(page, email) {
  await page.goto(`${baseUrl}/login?redirect=%2Fonboarding`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20_000,
  });
}


async function finishPolicyDialog(page, dialog) {
  await dialog
    .getByLabel("I have read and understand this controlled policy version.")
    .check();
  await dialog.getByRole("button", { name: "Acknowledge policy" }).click();
  await dialog.getByText("Policy acknowledged").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
}


async function finishAssessmentDialog(page, dialog) {
  const title = (await dialog.getByRole('heading').first().innerText()).trim();
  for (let questionIndex = 0; questionIndex < 20; questionIndex += 1) {
    const passed = dialog.getByText("Assessment passed");
    if (await passed.isVisible().catch(() => false)) {
      await dialog.getByRole("button", { name: "Close" }).first().click();
      await dialog.waitFor({ state: "hidden", timeout: 10_000 });
      return;
    }
    const heading = dialog.locator("fieldset legend");
    await heading.waitFor({ state: "visible", timeout: 10_000 });
    const prompt = (await heading.textContent())?.trim() ?? "";
    const answer = ASSESSMENT_ANSWERS.get(prompt);
    if (!answer) throw new Error(`No governed audit answer is configured for ${prompt}.`);
    await dialog.getByLabel(answer, { exact: true }).check();
    const submit = dialog.getByRole("button", { name: "Submit answers" });
    if (await submit.isVisible().catch(() => false)) {
      await submit.click();
      await waitForAssessmentResult(page, title);
      if (!(await dialog.isVisible())) return;
      continue;
    }
    await dialog.getByRole("button", { name: "Next question" }).click();
  }
  throw new Error("Assessment exceeded the bounded question count.");
}

async function finishRequirementDialog(page) {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  if (
    await dialog
      .getByLabel("I have read and understand this controlled policy version.")
      .isVisible()
      .catch(() => false)
  ) {
    await finishPolicyDialog(page, dialog);
    return;
  }
  if (
    await dialog
      .getByText(/Question \d+ of \d+/)
      .isVisible()
      .catch(() => false)
  ) {
    await finishAssessmentDialog(page, dialog);
    return;
  }
  await finishGuidedDialog(page);
}

async function visibleEnabledOrientationLauncher(page) {
  const launchers = page.getByRole("button", {
    name: /^Start .+ orientation\b/i,
  });
  for (let index = 0; index < (await launchers.count()); index += 1) {
    const candidate = launchers.nth(index);
    if (
      (await candidate.isVisible().catch(() => false)) &&
      (await candidate.isEnabled().catch(() => false))
    ) {
      return candidate;
    }
  }
  return null;
}

async function visibleEnabledRequirementLauncher(page) {
  const launchers = page.getByRole("button", {
    name: /^(?:Start|Resume|Try again) /i,
  });
  for (let index = 0; index < (await launchers.count()); index += 1) {
    const candidate = launchers.nth(index);
    if (
      (await candidate.isVisible().catch(() => false)) &&
      (await candidate.isEnabled().catch(() => false))
    ) {
      return candidate;
    }
  }
  return null;
}

async function completeRemainingRequirements(page) {
  let completedNow = 0;
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const launcher = await visibleEnabledRequirementLauncher(page);
    if (!launcher) break;
    const label = (await launcher.innerText()).trim();
    console.log(`  START ${label}`);
    await launcher.click();
    await finishRequirementDialog(page);
    completedNow += 1;
    console.log(`  DONE ${label}`);
  }
  return completedNow;
}

async function auditInternalOrientation(page, persona) {
  await page.goto(`${baseUrl}/onboarding?next=%2Fwork`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await page
    .getByRole("heading", { level: 1, name: "Role onboarding" })
    .waitFor({ state: "visible", timeout: 15_000 });
  await waitForOrientationState(page);

  let completedNow = 0;
  if (mutate) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const start = await visibleEnabledOrientationLauncher(page);
      if (!start) break;
      await start.click();
      await finishGuidedDialog(page);
      completedNow += 1;
    }
    completedNow += await completeRemainingRequirements(page);
  }

  const progress = await assertCurriculumComplete(page, persona);

  const continueLink = page.getByRole("link", { name: "Continue to My Work" });
  await continueLink.waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot({
    path: path.join(
      evidenceDir,
      `${viewportName}-${evidenceToken(persona.role)}-orientation.jpg`,
    ),
    type: "jpeg",
    quality: 78,
    fullPage: true,
  });

  await continueLink.click();
  await page.waitForURL((url) => url.pathname === "/work", { timeout: 15_000 });
  assert(
    !new URL(page.url()).pathname.startsWith("/onboarding"),
    `${persona.role} remained trapped in onboarding after completion.`,
  );
  return { completedNow, progress, destination: "/work" };
}

async function auditVendorOrientation(page, persona) {
  await page.goto(`${baseUrl}/onboarding`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  const handoff = page.getByRole("link", {
    name: "Continue to vendor onboarding",
  });
  await handoff.waitFor({ state: "visible", timeout: 15_000 });
  await handoff.click();
  await page.waitForURL((url) => url.pathname === "/vendor/onboarding", {
    timeout: 15_000,
  });
  await page
    .getByRole("heading", { level: 1, name: "Vendor onboarding" })
    .waitFor({ state: "visible", timeout: 15_000 });
  await waitForOrientationState(page);
  let completedNow = 0;
  if (mutate) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const start = await visibleEnabledOrientationLauncher(page);
      if (!start) break;
      await start.click();
      await finishGuidedDialog(page);
      completedNow += 1;
    }
    completedNow += await completeRemainingRequirements(page);
  }
  const outstandingOrientation = await visibleEnabledOrientationLauncher(page);
  assert(
    !outstandingOrientation,
    "Vendor role orientation remains incomplete after the bounded journey.",
  );
  const progress = await assertCurriculumComplete(page, persona);
  await page.screenshot({
    path: path.join(
      evidenceDir,
      `${viewportName}-${evidenceToken(persona.role)}-orientation.jpg`,
    ),
    type: "jpeg",
    quality: 78,
    fullPage: true,
  });
  return { completedNow, progress, destination: "/vendor/onboarding" };
}

await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const persona of auditPersonas(identityScope).filter(
    (item) => !roleFilter || item.role === roleFilter,
  )) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 768,
      hasTouch: viewport.width < 768,
      reducedMotion: "reduce",
    });
    await installScopedProtectionBypass({
      context,
      appOrigin: new URL(baseUrl).origin,
      protectionBypass,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const consoleErrors = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    try {
      await login(page, persona.email);
      const outcome =
        persona.kind === "vendor"
          ? await auditVendorOrientation(page, persona)
          : await auditInternalOrientation(page, persona);
      assert(
        consoleErrors.length === 0,
        `${persona.role} emitted console errors: ${consoleErrors.join(" | ")}`,
      );
      results.push({ role: persona.role, status: "passed", ...outcome });
      console.log(`PASS ${viewportName} ${persona.role} -> ${outcome.destination}`);
    } catch (error) {
      const screenshot = path.join(
        evidenceDir,
        `${viewportName}-${evidenceToken(persona.role)}-failed.jpg`,
      );
      await page.screenshot({ path: screenshot, type: "jpeg", quality: 70, fullPage: true })
        .catch(() => {});
      results.push({
        role: persona.role,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`FAIL ${viewportName} ${persona.role}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      baseUrl,
      viewport: viewportName,
      identityScope: identityScope || 'shared-testers',
      mutations: mutate,
      results,
    },
    null,
    2,
  )}\n`,
);

const failures = results.filter((item) => item.status !== "passed");
if (failures.length) {
  throw new Error(`${failures.length} role onboarding journey(s) failed.`);
}
