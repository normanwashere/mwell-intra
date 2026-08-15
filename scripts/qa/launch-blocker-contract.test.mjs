import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("the onboarding live command resolves to a real guarded route audit", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    pkg.scripts["test:onboarding-live"],
    "node scripts/qa/onboarding-live-e2e.mjs",
  );
  const script = new URL("./onboarding-live-e2e.mjs", import.meta.url);
  await access(script);
  const source = await readFile(script, "utf8");
  assert.match(source, /AUDIT_PHASE/);
  assert.match(source, /routes/);
  assert.match(source, /full-intra-live-e2e\.mjs/);
});

test("UAT CI certifies the deployed schema without mutating it", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/uat-live-certification.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /codex\/uat-launch-blockers/);
  assert.doesNotMatch(workflow, /codex\/unified-finance-module/);
  assert.match(workflow, /UAT_SUPABASE_DB_PASSWORD/);
  assert.doesNotMatch(workflow, /supabase db push/);
  assert.doesNotMatch(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /pnpm verify:security-db-launch-blockers/);
});

test("UAT CI blocks high severity dependency and source vulnerabilities", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/uat-live-certification.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /pnpm audit --prod --audit-level high/);
  assert.match(workflow, /security-events: write/);
  assert.match(workflow, /github\/codeql-action\/analyze/);
});

test("UAT builds receive the canonical application URL", async () => {
  const turbo = JSON.parse(
    await readFile(new URL("../../turbo.json", import.meta.url), "utf8"),
  );
  assert.ok(turbo.globalPassThroughEnv.includes("APP_URL"));
});
