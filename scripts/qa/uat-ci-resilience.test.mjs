import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertZeroResidue, buildRunScope } from "./cleanup-uat-live-run.mjs";
import { buildDeterministicAuditRunId } from "./uat-ci-run-id.mjs";
import { waitForExactDeployment } from "./wait-for-uat-deployment.mjs";

test("deterministic audit IDs are stable across transaction and cleanup jobs", () => {
  const input = { date: "20260722", runNumber: 29, ordinal: 91 };
  assert.equal(buildDeterministicAuditRunId(input), "QA-20260722-00000BAF");
  assert.equal(
    buildDeterministicAuditRunId(input),
    buildDeterministicAuditRunId(input),
  );
  assert.throws(
    () => buildDeterministicAuditRunId({ ...input, date: "2026-07-22" }),
    /YYYYMMDD/,
  );
});

test("deployment gate waits until health reports the exact GitHub SHA", async () => {
  const expectedCommit = "a".repeat(40);
  const observations = [];
  let calls = 0;
  const result = await waitForExactDeployment({
    baseUrl: "https://uat.example.com",
    expectedCommit,
    expectedAppEnv: "uat",
    expectedProjectRef: "uatprojectref",
    timeoutMs: 5_000,
    intervalMs: 1,
    sleepImpl: async () => {},
    onAttempt: (attempt) => observations.push(attempt),
    fetchImpl: async () => {
      calls += 1;
      return Response.json({
        deployment: { appEnv: "uat", supabaseProjectRef: "uatprojectref" },
        features: {
          notifications: "configured",
          serviceWorker: "configured",
          vendorInviteDelivery: "configured",
        },
        commit: calls === 1 ? "b".repeat(40) : expectedCommit,
      });
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.commit, expectedCommit);
  assert.equal(result.features.notifications, "configured");
  assert.equal(result.ready, true);
  assert.equal(observations[0].ready, false);
});

test("deployment gate rejects the wrong environment without auditing it", async () => {
  await assert.rejects(
    () =>
      waitForExactDeployment({
        baseUrl: "https://uat.example.com",
        expectedCommit: "a".repeat(40),
        expectedAppEnv: "uat",
        expectedProjectRef: "uatprojectref",
        timeoutMs: 100,
        intervalMs: 1,
        sleepImpl: async () => {},
        fetchImpl: async () =>
          Response.json({
            deployment: {
              appEnv: "production",
              supabaseProjectRef: "uatprojectref",
            },
            commit: "a".repeat(40),
          }),
      }),
    /Wrong APP_ENV/,
  );
});

test("cleanup scope is deterministic and bound to one transaction viewport", () => {
  const scope = buildRunScope("QA-20260722-00000AEF", "mobile-390");
  assert.equal(scope.marker, "QA-20260722-00000AEF-mobile-390");
  assert.match(scope.authEmail, /qa-20260722-00000aef-mobile-390/);
  assert.ok(scope.eventNames.every((name) => name.includes(scope.marker)));
  assert.throws(
    () => buildRunScope("QA-20260722-00000AEF", "tablet-768"),
    /Unsupported transaction viewport/,
  );
});

test("cleanup certification fails on residue and discovery errors", () => {
  assert.doesNotThrow(() =>
    assertZeroResidue({
      complete: true,
      results: [{ entity: "warehouse.events", remaining: 0 }],
    }),
  );
  assert.throws(
    () =>
      assertZeroResidue({
        complete: false,
        results: [
          { entity: "warehouse.events", remaining: 1 },
          { entity: "auth.users", remaining: null, error: "lookup failed" },
        ],
      }),
    /warehouse\.events.*auth\.users/,
  );
});

test("independent cleanup guards UAT and covers governed residue plus Auth", async () => {
  const source = await readFile(
    new URL("./cleanup-uat-live-run.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /assertApprovedMutationTarget\(\{/);
  assert.match(source, /POLICY_ALLOW_TEST_MUTATIONS/);
  for (const entity of [
    "core.activity_log",
    "core.profiles",
    "legal.vendor_invite_commands",
    "legal.vendor_invites",
    "legal.accreditation_cases",
    "procurement.requests",
    "procurement.purchase_orders",
    "warehouse.receipts",
    "warehouse.events",
    "warehouse.movements",
    "warehouse.stock_levels",
  ]) {
    const [schema, table] = entity.split(".");
    assert.match(source, new RegExp(`"${schema}"[\\s\\S]*?"${table}"`));
  }
  assert.match(source, /auth\.admin\.listUsers/);
  assert.match(source, /auth\.admin\.deleteUser/);
  assert.match(source, /product[\s\S]*cleanup_certification_records/);
  assert.match(source, /product\.certification-records/);
  assert.match(source, /remaining === 0/);
});

test("UAT certification workflow gates deployment and always certifies cleanup", async () => {
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/uat-live-certification.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /wait-for-uat-deployment\.mjs/);
  assert.match(workflow, /GITHUB_SHA:\s*\$\{\{ github\.sha \}\}/);
  assert.equal(
    (workflow.match(/fetch-depth:\s*0/g) ?? []).length,
    5,
    "every certification job must fetch provenance history",
  );
  for (const gate of [
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm build",
    "pnpm verify:launch-artifacts",
  ]) {
    assert.match(workflow, new RegExp(gate.replace(" ", "\\s+")));
  }
  assert.match(workflow, /outputs:[\s\S]*audit_date:/);
  assert.match(workflow, /cleanup:[\s\S]*if:\s*\$\{\{ always\(\)/);
  assert.match(workflow, /cleanup-uat-live-run\.mjs/);
  assert.match(workflow, /uat-cleanup-\$\{\{ matrix\.viewport \}\}/);
  assert.match(workflow, /needs:\s*\[prepare, routes, transactions, cleanup\]/);
  assert.match(workflow, /needs\.cleanup\.result != 'success'/);
  assert.match(
    workflow,
    /verify-launch-artifacts\.mjs --certification-dir certification-artifacts/,
  );
  assert.match(workflow, /Verify complete cross-shard certification evidence/);
  assert.match(
    workflow,
    /verify-release-documentation\.mjs --manifest test-results\/documentation-sync-source\.json/,
  );
  assert.match(workflow, /pnpm verify:app-documentation-html/);
  assert.doesNotMatch(
    workflow,
    /pnpm verify:release-documentation -- --manifest/,
  );
  assert.match(
    workflow,
    /uat-ci-run-id\.mjs[\s\S]*--ordinal "\$\{\{ matrix\.ordinal \}\}"/,
  );
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY:\s*eyJ/);
});

test("UAT runs actual disclosure browser regressions after Chromium installation", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/uat-live-certification.yml", import.meta.url), "utf8");
  const installed = workflow.indexOf("Install Chromium for first-login certification");
  const contract = workflow.indexOf("node --test scripts/qa/audit-disclosure.browser.test.mjs");
  const orientation = workflow.indexOf("Complete first-login role orientations on desktop");
  assert.ok(installed >= 0 && contract > installed && orientation > contract);
});

test("production certification is read-only and covers every supported viewport", async () => {
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/production-readonly-certification.yml",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    workflow,
    /AUDIT_BASE_URL:\s*https:\/\/mwell-intra\.vercel\.app/,
  );
  assert.match(workflow, /APP_ENV:\s*production/);
  assert.match(workflow, /AUDIT_PHASE:\s*routes/);
  assert.match(workflow, /AUDIT_MUTATIONS:\s*"false"/);
  assert.match(workflow, /POLICY_ALLOW_TEST_MUTATIONS:\s*"false"/);
  assert.match(workflow, /SUPABASE_PROJECT_REF:\s*abbfziukjalyqtcuskhi/);
  assert.match(
    workflow,
    /PRODUCTION_SUPABASE_PROJECT_REF:\s*abbfziukjalyqtcuskhi/,
  );
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /health\.supabase !== "reachable"/);
  assert.match(workflow, /health\.clientAuth !== "supabase-configured"/);
  assert.match(workflow, /health\.features\?\.serviceWorker !== "configured"/);
  for (const viewport of [
    "desktop-1440",
    "desktop-1280",
    "tablet-768",
    "mobile-390",
    "mobile-360",
    "mobile-320",
  ]) {
    assert.match(workflow, new RegExp(`viewport: ${viewport}`));
  }
});
