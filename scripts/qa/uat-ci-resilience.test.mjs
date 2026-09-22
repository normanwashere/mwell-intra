import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import { assertZeroResidue, buildRunScope } from "./cleanup-uat-live-run.mjs";
import { buildDeterministicAuditRunId } from "./uat-ci-run-id.mjs";
import { waitForExactDeployment } from "./wait-for-uat-deployment.mjs";
import { selectDoaFixtureApprovers } from './doa-assignment-driver.mjs';

test('DOA fixture selects named qualified actors, never alphabetical dropdown positions', async () => {
  const departmentHeadId = '60bdca8a-14dd-4297-b9a8-be64e9e7a1cc';
  const finalApproverId = '2936c9fc-5859-47fc-b2fc-4ee3bb49fc71';
  const calls = [];
  const page = { getByLabel: label => ({ count: async () => 2,
    inputValue: async () => label === 'Tier 1' ? 'dept_head' : 'final_approver',
    selectOption: async value => { assert.equal(typeof value, 'string'); calls.push([label, value]); } }) };
  await selectDoaFixtureApprovers(page, { departmentHeadId, finalApproverId });
  assert.deepEqual(calls, [['Tier 1 named approver', departmentHeadId], ['Tier 2 named approver', finalApproverId]]);
  await assert.rejects(selectDoaFixtureApprovers(page, { departmentHeadId }), /final-approver fixture identity/);
  await assert.rejects(selectDoaFixtureApprovers(page, { departmentHeadId, finalApproverId: departmentHeadId }), /distinct fixture/);
  await assert.rejects(selectDoaFixtureApprovers({ getByLabel: () => ({ count: async () => 3 }) },
    { departmentHeadId, finalApproverId }), /default DOA tiers change/);
});

const require = createRequire(new URL("../../apps/shell/package.json", import.meta.url));
const yaml = createRequire(require.resolve("eslint"))("js-yaml");
const readUatWorkflow = async () => (await readFile(
  new URL("../../.github/workflows/uat-live-certification.yml", import.meta.url), "utf8",
)).replaceAll("\r\n", "\n");

const browserHelperFiles = [
  "scripts/qa/audit-disclosure.browser.test.mjs",
  "scripts/qa/event-demand-selector.browser.test.mjs",
  "scripts/qa/quality-validation-workflow.browser.test.mjs",
  "scripts/qa/route-evidence.browser.test.mjs",
  "scripts/qa/evidence-upload.browser.test.mjs",
  "scripts/qa/receipt-quality-probes.test.mjs",
  "scripts/qa/excess-save-outcome.browser.test.mjs",
  "scripts/qa/receiving-audit-evidence.test.mjs",
  "scripts/qa/sep22-departments-target.browser.test.mjs",
];

function assertBrowserHelperContract(workflow) {
  const steps = workflow.jobs.prepare.steps;
  const index = name => {
    assert.equal(steps.filter(step => step.name === name).length, 1, `one ${name} step is required`);
    return steps.findIndex(step => step.name === name);
  };
  const dependencies = index("Install locked dependencies");
  const installed = index("Install Chromium for browser-backed contracts and first-login certification");
  const unit = index("Run unit and contract tests");
  const contract = index("Verify browser audit visibility and readiness contracts");
  const orientation = index("Complete first-login role orientations on desktop");
  assert.ok(dependencies < installed && installed < unit,
    "Chromium must be installed after dependencies and before browser-backed workspace tests");
  assert.ok(installed < contract && contract < orientation,
    "Browser helper contracts must run after Chromium and before live orientation");
  const step = steps[contract];
  assert.equal(step.if, undefined, "browser helper contracts must not be conditional");
  assert.equal(step["continue-on-error"], undefined, "browser helper failures must block certification");
  assert.deepEqual(step.run.trim().split(/\s+/), ["node", "--test", ...browserHelperFiles]);
  for (const file of browserHelperFiles) {
    assert.equal(steps.flatMap(item => item.run?.trim().split(/\s+/) ?? [])
      .filter(token => token === file).length, 1, `${file} must run exactly once in prepare`);
  }
}

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
  assert.match(source, /query\.in\("name", scope\.departments\)/);
  assert.match(source, /organizationRows\.map\(row => row\.code\)/);
  assert.match(source, /query\.in\("department", departmentKeys\)/);
  assert.ok(source.indexOf('await removeWhen(organizationIds, "core", "department_cost_centers"') <
    source.indexOf('await removeWhen(organizationIds, "core", "departments"'));
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
    "pnpm exec turbo run test",
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

test("CI bounds nested test pools without relaxing assertions or deadlines", async () => {
  const workflow = await readUatWorkflow();
  const step = workflow.split("      - name: Run unit and contract tests\n")[1]?.split("      - name:")[0];
  assert.ok(step);
  assert.match(step, /run: pnpm exec turbo run test --concurrency=1 -- --maxWorkers=2/);
  assert.doesNotMatch(step, /testTimeout|retry|continue-on-error|\|\||--exclude|--passWithNoTests/);
});

test("prepare runs only reviewed Sep05 SQL suites before persona provisioning", async () => {
  const workflow = await readUatWorkflow();
  const prepare = workflow.split("  prepare:\n")[1]?.split("\n  routes:")[0];
  assert.ok(prepare, "prepare job exists");
  const stepName = "Verify Sep05 isolated SQL regression suites";
  const step = prepare.split(`      - name: ${stepName}\n`)[1]?.split("      - name:")[0];
  assert.ok(step, "dedicated SQL gate exists in prepare");
  assert.match(step, /^        run: \|\n/);
  assert.doesNotMatch(step, /continue-on-error|if:|\|\||\*|\$\{|\bprovision\b|fetch/);
  const command = step.replace(/^        run: \|\n/, "").replace(/\\\r?\n/g, " ").trim().split(/\s+/);
  assert.deepEqual(command, [
    "node", "--test", "--test-concurrency=1",
    "scripts/verify-sep05-procurement.pglite.test.mjs",
    "scripts/verify-sep22-doa-tier.pglite.test.mjs",
    "scripts/verify-sep22-doa-final-authority.pglite.test.mjs",
    "scripts/qa/request-cleanup.pglite.test.mjs",
    "scripts/qa/payment-cleanup.pglite.test.mjs",
    "scripts/verify-provisional-quality-hold-release.pglite.test.mjs",
    "scripts/qa/serialized-hold-fixture.pglite.test.mjs",
    "scripts/qa/closed-po-payment.pglite.test.mjs",
    "scripts/qa/excess-custody-resolution.pglite.test.mjs",
    "scripts/verify-sep05-procurement-integration.pglite.test.mjs",
    "scripts/verify-putaway-tasks.pglite.test.mjs",
    "scripts/verify-receiving-drafts.pglite.test.mjs",
    "modules/finance/platform-remediation.pglite.test.mjs",
    "scripts/verify-return-intake.pglite.test.mjs",
    "scripts/verify-offline-replay-identity.pglite.test.mjs",
    "scripts/verify-warehouse-custody-truncate.pglite.test.mjs",
  ]);
  assert.ok(prepare.indexOf(stepName) > prepare.indexOf("Install locked dependencies"));
  assert.ok(prepare.indexOf(stepName) < prepare.indexOf("Reconcile guarded UAT personas"));
  assert.match(prepare, /timeout-minutes: 60\b/);
});

test('Sep20 safety contracts run without live seller provisioning or SMTP', async () => {
  const workflow = await readUatWorkflow();
  const prepare = workflow.split('\n  prepare:')[1].split('\n  routes:')[0];
  const stepName = 'Verify Sep20 event custody and warehouse access contracts';
  const step = prepare.split(`      - name: ${stepName}\n`)[1]?.split('      - name:')[0];
  assert.ok(step);
  assert.doesNotMatch(step, /continue-on-error|--apply|--allow-cli-credential|\bSMTP\b|\|\||\*/);
  const command = step.replace(/^        run: \|\n/, '').replace(/\\\r?\n/g, ' ').trim().split(/\s+/);
  assert.deepEqual(command, [
    'node', '--test', '--test-concurrency=1',
    'scripts/verify-quality-batch.pglite.test.mjs',
    'scripts/verify-stock-conversion.pglite.test.mjs',
    'scripts/verify-warehouse-raw-read-policy.pglite.test.mjs',
    'scripts/verify-event-ledger-effective-read.pglite.test.mjs',
    'modules/events/tests/custody.pglite.test.mjs',
    'modules/learning/tests/eventSellerLearningReadiness.pglite.test.mjs',
    'modules/procurement/request-list-privacy.pglite.test.mjs',
    'scripts/sep20-seller-learning.test.mjs',
    'scripts/sep20-seller-learning-live.test.mjs',
    'scripts/qa/sep20-event-live.test.mjs',
    'scripts/qa/sep20-seller-user-provision.test.mjs',
  ]);
  assert.ok(prepare.indexOf(stepName) < prepare.indexOf('Reconcile guarded UAT personas'));
});

test('route concurrency is isolated and the full strict audit follows the critical gate', async () => {
  const workflow = await readUatWorkflow();
  const routes = workflow.split('\n  routes:')[1].split('\n  transactions:')[0];
  assert.match(routes, /needs: prepare/);
  assert.match(routes, /max-parallel: 3/);
  assert.match(routes, /AUDIT_IDENTITY_SCOPE: \$\{\{ matrix.viewport \}\}/);
  assert.match(routes, /AUDIT_PHASE: routes/);
  assert.match(routes, /Reconcile only this viewport's isolated identities/);
  assert.match(routes, /Complete actual onboarding for isolated viewport identities/);
  assert.doesNotMatch(routes.split('    steps:')[0], /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow.split('\n  transactions:')[1].split('\n  cleanup:')[0], /max-parallel: 1/);
  assert.match(workflow.split('\n  transactions:')[1].split('\n  cleanup:')[0], /if: \$\{\{ !cancelled\(\) && needs.prepare.result == 'success' \}\}/);
  assert.match(workflow.split('\n  cleanup:')[1].split('\n  bundle:')[0], /if: \$\{\{ always\(\) && needs.prepare.result == 'success' \}\}/);
  const prepare = workflow.split('\n  prepare:')[1].split('\n  routes:')[0];
  assert.match(prepare, /AUDIT_PHASE: critical/);
  assert.match(prepare, /SUPABASE_SERVICE_ROLE_KEY: ""/);
  assert.match(prepare, /critical-routes.json/);
  assert.doesNotMatch(workflow, /continue-on-error/);
});

test("controlled vendor cleanup uses the same exact run mailbox and refuses a shared account", () => {
  const id = "QA-20260722-00000AEF";
  assert.equal(buildRunScope(id, "mobile-390", { vendorEmailTemplate: "intra.test.admin+{marker}@mwell.com.ph" }).authEmail,
    "intra.test.admin+qa-20260722-00000aef-mobile-390@mwell.com.ph");
  assert.throws(() => buildRunScope(id, "mobile-390", { vendorEmailTemplate: "intra.test.admin@mwell.com.ph" }), /placeholder/);
  assert.throws(() => buildRunScope(id, "mobile-390", { vendorEmailTemplate: "{marker}" }), /Invalid/);
});

test("UAT runs explicit browser and receipt-quality helper contracts after Chromium installation", async () => {
  assertBrowserHelperContract(yaml.load(await readUatWorkflow()));
});

function assertDoaConcurrencyGate(workflow) {
  const job = workflow.jobs.prepare;
  const service = job.services?.['doa-postgres'];
  assert.equal(service?.image, 'postgres:17-alpine');
  assert.equal(service.env.POSTGRES_DB, 'postgres');
  assert.equal(service.env.POSTGRES_USER, 'postgres');
  assert.equal(service.env.POSTGRES_INITDB_ARGS, '--set=cluster_name=sep22_doa_ci');
  assert.deepEqual(service.ports, ['5432:5432']);
  assert.match(service.options, /pg_isready -U postgres/);
  const name = 'Verify final DOA concurrency on disposable PostgreSQL';
  const steps = job.steps.filter(step => step.name === name);
  assert.equal(steps.length, 1);
  const step = steps[0];
  assert.equal(step.run, 'node --test scripts/verify-sep22-doa-final-authority.postgres.test.mjs');
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.equal(step.env.SEP22_DOA_EPHEMERAL_CI, '1');
  assert.equal(step.env.SEP22_DOA_CI_DATABASE_URL,
    `postgresql://postgres:${service.env.POSTGRES_PASSWORD}@127.0.0.1:5432/postgres`);
  assert.deepEqual(Object.keys(step.env).sort(), ['SEP22_DOA_CI_DATABASE_URL', 'SEP22_DOA_EPHEMERAL_CI']);
  assert.doesNotMatch(JSON.stringify(step.env), /secrets|supabase/i);
  assert.ok(job.steps.indexOf(step) > job.steps.findIndex(item => item.name === 'Install locked dependencies'));
  assert.ok(job.steps.indexOf(step) < job.steps.findIndex(item => item.name === 'Reconcile guarded UAT personas'));
}

test('final DOA concurrency uses a required isolated PostgreSQL gate', async () => {
  const workflow = yaml.load(await readUatWorkflow());
  assertDoaConcurrencyGate(workflow);
  for (const mutate of [
    copy => { delete copy.jobs.prepare.services; },
    copy => { copy.jobs.prepare.steps = copy.jobs.prepare.steps.filter(step => step.name !== 'Verify final DOA concurrency on disposable PostgreSQL'); },
    copy => { copy.jobs.prepare.steps.find(step => step.name === 'Verify final DOA concurrency on disposable PostgreSQL').if = 'false'; },
    copy => { copy.jobs.prepare.steps.find(step => step.name === 'Verify final DOA concurrency on disposable PostgreSQL')['continue-on-error'] = true; },
    copy => { copy.jobs.prepare.steps.find(step => step.name === 'Verify final DOA concurrency on disposable PostgreSQL').env.SEP22_DOA_CI_DATABASE_URL = '${{ secrets.DATABASE_URL }}'; },
  ]) {
    const copy = structuredClone(workflow);
    mutate(copy);
    assert.throws(() => assertDoaConcurrencyGate(copy));
  }
});

for (const file of browserHelperFiles) {
  test(`browser workflow contract rejects omission of ${file}`, async () => {
    const workflow = yaml.load(await readUatWorkflow());
    const step = workflow.jobs.prepare.steps.find(item => item.name === "Verify browser audit visibility and readiness contracts");
    step.run = step.run.replace(file, "");
    assert.throws(() => assertBrowserHelperContract(workflow));
  });
}

for (const [label, mutate] of [
  ["conditional execution", (_steps, step) => { step.if = "false"; }],
  ["ignored failure", (_steps, step) => { step["continue-on-error"] = true; }],
  ["duplicate suite", (steps, step) => { steps.push({ name: "Duplicate", run: step.run }); }],
  ["orientation before contracts", (steps) => {
    const index = steps.findIndex(step => step.name === "Complete first-login role orientations on desktop");
    steps.unshift(...steps.splice(index, 1));
  }],
]) {
  test(`browser workflow contract rejects ${label}`, async () => {
    const workflow = yaml.load(await readUatWorkflow());
    const steps = workflow.jobs.prepare.steps;
    mutate(steps, steps.find(step => step.name === "Verify browser audit visibility and readiness contracts"));
    assert.throws(() => assertBrowserHelperContract(workflow));
  });
}

test("browser workflow contract accepts both LF and CRLF YAML source", async () => {
  const source = await readUatWorkflow();
  for (const text of [source, source.replaceAll("\n", "\r\n")]) assertBrowserHelperContract(yaml.load(text));
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
