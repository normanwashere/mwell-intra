import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  CURRENT_LIVE_ROLES,
  CURRENT_LIVE_SCENARIOS,
  REQUIRED_TRANSACTION_VIEWPORTS,
  WORKFLOW_SCENARIO_EVIDENCE,
  assertScenarioEvidenceRegistry,
  evaluateScenarioCoverage,
  scenarioCoverageFailures,
} from "./live-e2e-scenarios.mjs";

test("declares every current live role exactly once", () => {
  assert.equal(CURRENT_LIVE_ROLES.length, 11);
  assert.equal(new Set(CURRENT_LIVE_ROLES.map((item) => item.role)).size, 11);
  for (const role of CURRENT_LIVE_ROLES) {
    assert.match(role.email, /^intra\.test\..+@mwell\.com\.ph$/);
    assert.ok(!("password" in role));
    assert.ok(Object.keys(role.assignments).length > 0);
    assert.equal(typeof role.kind, "string");
  }
  const unifiedFinance = CURRENT_LIVE_ROLES.find(
    (item) => item.role === "finance_controller",
  );
  assert.deepEqual(unifiedFinance?.assignments.warehouse, ["finance"]);
  assert.deepEqual(unifiedFinance?.assignments.procurement, ["finance"]);
  assert.deepEqual(unifiedFinance?.assignments.events, ["finance_reviewer"]);
  assert.deepEqual(
    CURRENT_LIVE_ROLES.find((item) => item.role === "leadership_insights")
      ?.assignments.insights,
    ["analyst", "manager", "executive"],
  );
  assert.deepEqual(
    CURRENT_LIVE_ROLES.find((item) => item.role === "general_employee")
      ?.assignments.events,
    ["requester"],
  );
  assert.deepEqual(
    CURRENT_LIVE_ROLES.find((item) => item.role === "marketing_events_lead")
      ?.assignments.events,
    ["coordinator", "admin"],
  );
  assert.ok(
    CURRENT_LIVE_ROLES.some((item) => item.role === "operations_associate"),
  );
  assert.ok(CURRENT_LIVE_ROLES.some((item) => item.role === "operations_lead"));
});

test("live authentication uses the vaulted shared UAT credential", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /resolveSharedUatPassword\(masterPassword\)/);
  assert.doesNotMatch(source, /fill\("#password", password\)/);
});

test("transaction logins use the same shared UAT credential", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /page\.fill\("#password", sharedUatPassword\)/);
});

test("warehouse receipt projections have a matching exception schema contract", async () => {
  const [repository, migration] = await Promise.all([
    readFile(
      new URL(
        "../../packages/data-kit/src/supabase/SupabaseRepository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../supabase/migrations/20260814083514_add_receipt_exception_contract.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(repository, /receipts:\s*["'][^"']*receipt_exception/);
  assert.match(
    migration,
    /alter table warehouse\.receipts[\s\S]*add column if not exists receipt_exception jsonb/i,
  );
  assert.match(migration, /warehouse_receipt_exception_shape_check/);
  assert.match(migration, /'non_po',\s*'overage'/);
  assert.match(
    migration,
    /jsonb_array_length\(receipt_exception->'evidenceUrls'\) > 0/,
  );
});

test("certification gates cannot activate before a published pathway exists", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260814084615_require_published_certification_pathway.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    migration,
    /create or replace function learning\.is_certification_required/,
  );
  assert.match(migration, /curriculum_capability_outcomes/);
  assert.match(migration, /curriculum_version\.status = 'published'/);
  assert.match(migration, /requirement_version\.status = 'published'/);
  assert.match(
    migration,
    /curriculum_version\.effective_at <= pg_catalog\.now\(\)/,
  );
  assert.match(
    migration,
    /requirement_version\.effective_at <= pg_catalog\.now\(\)/,
  );
});

test("browser-role RPCs recover Supabase SSR cookie sessions without logging tokens", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /document\.cookie/);
  assert.match(source, /decoded\.startsWith\("base64-"\)/);
  assert.match(source, /findAccessToken/);
  assert.doesNotMatch(source, /console\.log\([^\n]*accessToken/);
});
test("requires canonical desktop and mobile transaction viewports", () => {
  assert.deepEqual(REQUIRED_TRANSACTION_VIEWPORTS, [
    { name: "desktop-1440", width: 1440, height: 900 },
    { name: "mobile-390", width: 390, height: 844 },
  ]);
});

test("covers current cross-role workflows and negative paths", () => {
  const expected = [
    "identity-access",
    "vendor-accreditation",
    "procurement-request-to-po",
    "warehouse-setup-receive-putaway",
    "warehouse-quality-and-return",
    "warehouse-cycle-count",
    "warehouse-allocation-event-return",
    "admin-doa",
    "events-request-to-warehouse-handoff",
    "insights-read-only-governance",
    "unified-finance-control-center",
    "product-readiness-go-live-pricing",
  ];
  assert.deepEqual(
    CURRENT_LIVE_SCENARIOS.map((item) => item.id),
    expected,
  );
  for (const scenario of CURRENT_LIVE_SCENARIOS) {
    assert.ok(scenario.actors.length > 0, `${scenario.id} actors`);
    assert.ok(scenario.checkpoints.length > 0, `${scenario.id} checkpoints`);
    assert.ok(scenario.cleanup.length > 0, `${scenario.id} cleanup`);
    assert.ok(scenario.cases.length > 0, `${scenario.id} cases`);
    assert.equal(
      new Set(scenario.cases).size,
      scenario.cases.length,
      `${scenario.id} cases are unique`,
    );
  }
});

test("scenario evidence is enforceable per shard and across the bundle", () => {
  assert.doesNotThrow(() => assertScenarioEvidenceRegistry());
  const workflowEvidence = (viewport) =>
    WORKFLOW_SCENARIO_EVIDENCE.map((item) => ({
      ok: true,
      viewport,
      workflow: item.workflow,
      scenarioEvidence: [item],
    }));
  const desktop = workflowEvidence("desktop-1440");
  const desktopCoverage = evaluateScenarioCoverage(desktop, ["desktop-1440"]);
  assert.deepEqual(scenarioCoverageFailures(desktopCoverage), []);

  const incompleteBundle = evaluateScenarioCoverage(desktop);
  assert.ok(
    scenarioCoverageFailures(incompleteBundle).every((failure) =>
      failure.includes("mobile-390"),
    ),
  );

  const completeBundle = evaluateScenarioCoverage([
    ...desktop,
    ...workflowEvidence("mobile-390"),
  ]);
  assert.deepEqual(scenarioCoverageFailures(completeBundle), []);
});

test("the mutating harness is run-scoped and always invokes cleanup", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /AUDIT_RUN_ID/);
  assert.match(source, /assertAuditRunId/);
  assert.match(source, /finally\s*\{[\s\S]*cleanupRun/);
  assert.doesNotMatch(source, /service_role\s*[=:]\s*["']/i);
  assert.doesNotMatch(source, /AUDIT_PASSWORD\s*[=:]\s*["'][^"']+/);
});

test("governed workflow activity cleanup resolves generated IDs from exact run markers", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /cleanupGovernedWorkflowActivity/);
  assert.match(
    source,
    /from\("requests"\)[\s\S]*\.eq\("title", `\$\{marker\} Procurement draft`\)/,
  );
  assert.match(
    source,
    /from\("doa_matrices"\)[\s\S]*\.eq\("department", `\$\{marker\} Department`\)[\s\S]*\.eq\("version", `\$\{marker\}-V1`\)/,
  );
  assert.match(
    source,
    /from\("activity_log"\)[\s\S]*\.in\("entity_id", entityIds\)[\s\S]*!entityIds\.includes\(String\(row\.entity_id\)\)[\s\S]*\.delete\(\)[\s\S]*\.in\("id", activityIds\)/,
  );
  assert.match(
    source,
    /cleanupGovernedWorkflowActivity\(marker\)[\s\S]*cleanupRun\(auditRunId/,
  );
});

test("event cleanup removes exact run-scoped fulfillment dependencies first", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function cleanupEventWorkflowDependencies");
  const end = source.indexOf("async function procurementReceiptAuthorityWorkflow", start);
  const cleanup = source.slice(start, end);
  assert.match(cleanup, /purpose.*marker.*event fulfillment/i);
  assert.match(cleanup, /fulfillment_order_id/);
  assert.match(cleanup, /fulfillment_reservations/);
  assert.match(cleanup, /fulfillment_orders/);
  assert.match(cleanup, /event_lifecycle_events/);
  assert.match(cleanup, /event_reconciliations/);
  assert.match(cleanup, /event_settlements/);
  assert.ok(
    cleanup.indexOf("const parentOrderIds") <
      cleanup.indexOf('"event_lifecycle_events"'),
    "fulfillment orders must be removed before event-owned rows",
  );
});

test("Warehouse certification creates its editable baseline before receiving and cleans it last", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  const setup = source.indexOf('name: "warehouse location creation"');
  const receivingFixture = source.indexOf(
    "const task3Fixture = await createTask3ReceiptFixture",
  );
  assert.ok(setup >= 0 && setup < receivingFixture);
  assert.match(
    source,
    /warehouseCreateLocationWorkflow[\s\S]*table: "locations"/,
  );
  assert.match(source, /table: "storage_areas"[\s\S]*table: "locations"/);
});

test("Warehouse location certification follows the live accessible control name without aborting downstream workflows", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  const workflowStart = source.indexOf(
    "async function warehouseCreateLocationWorkflow",
  );
  const workflowEnd = source.indexOf(
    "async function warehouseCreateEventWorkflow",
  );
  const workflowSource = source.slice(workflowStart, workflowEnd);

  assert.match(
    workflowSource,
    /getByRole\("button", \{ name: "Add location", exact: true \}\)/,
  );
  assert.doesNotMatch(
    workflowSource,
    /getByRole\("button", \{ name: "Add", exact: true \}\)/,
  );
  assert.doesNotMatch(source, /Warehouse location setup failed/);
  assert.doesNotMatch(source, /Warehouse bin setup failed/);
});

test("fatal audit evidence retains completed route, workflow, and cleanup progress", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /let auditProgressSnapshot = \(\) => \(\{\}\)/);
  assert.match(
    source,
    /auditProgressSnapshot = \(\) => \(\{[\s\S]*workflows,[\s\S]*cleanup,[\s\S]*results,/,
  );
  assert.match(source, /\.\.\.auditProgressSnapshot\(\)/);
});

test("route failures preserve screenshot evidence in every visual shard", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/uat-live-certification.yml",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /captureRouteFailureEvidence/);
  assert.match(source, /routeResult\.evidenceScreenshot/);
  assert.match(source, /navigation-error[\s\S]*evidenceScreenshot/);
  assert.match(
    workflow,
    /name: Upload route artifact[\s\S]*test-results\/evidence/,
  );
});

test("the approval-group fixture has an explicit service-role grant", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260718160000_grant_approval_groups_to_service_role.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    migration,
    /grant all on table core\.approval_groups to service_role/i,
  );
});

test("service verification and hardened policy hashing converge explicitly", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260718170000_harden_service_verification_and_digest_resolution.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /auth\.role\(\) = 'service_role'/);
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /private\.policy_record_acceptance_pack/);
});

test("supports bounded route and transaction certification phases", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /AUDIT_PHASE/);
  assert.match(source, /runRouteAudit = auditPhase !== "transactions"/);
  assert.match(source, /runTransactionAudit = auditPhase !== "routes"/);
  assert.match(source, /mutatingPhase = allowMutations && runTransactionAudit/);
  assert.match(source, /AUDIT_OUTPUT_PATH/);
  assert.match(source, /phase: auditPhase/);
  assert.match(source, /if \(mutatingPhase\)[\s\S]*cleanupRun/);
});

test("shards UAT certification into bounded least-privilege jobs", async () => {
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/uat-live-certification.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /environment: uat/);
  assert.match(workflow, /AUDIT_PHASE: routes/);
  assert.match(workflow, /AUDIT_PHASE: transactions/);
  assert.match(workflow, /AUDIT_OUTPUT_PATH/);
  assert.match(workflow, /max-parallel: 2/);
  assert.match(workflow, /max-parallel: 1/);
  assert.match(workflow, /pnpm provision:test:uat/);
  assert.match(workflow, /secrets\.UAT_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(
    workflow,
    /secrets\.AUDIT_PASSWORD \|\| secrets\.UAT_AUDIT_MASTER_PASSWORD/g,
  );
  assert.match(workflow, /AUDIT_REQUIRE_VENDOR_DELIVERY: "true"/);
  assert.match(workflow, /AUDIT_VENDOR_DELIVERY_VIEWPORT: desktop-1440/);
  assert.match(
    workflow,
    /AUDIT_VENDOR_EMAIL: intra\.test\.admin\+\{marker\}@mwell\.com\.ph/,
  );
  assert.match(workflow, /test-results\/evidence/);
  assert.doesNotMatch(workflow, /service_role\s*[=:]\s*["'][^"']+/i);
});

test("certification gates use only the signed-in user's assigned role pathways", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260816203000_scope_certification_pathways_to_assigned_roles.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    migration,
    /join core\.user_roles role_assignment[\s\S]*?role_assignment\.user_id = auth\.uid\(\)/i,
  );
  assert.match(
    migration,
    /join learning\.role_curricula role_curriculum[\s\S]*?role_curriculum\.module = role_assignment\.module[\s\S]*?role_curriculum\.role = role_assignment\.role/i,
  );
  assert.match(migration, /curriculum_version\.status = 'published'/i);
  assert.match(migration, /requirement_version\.status = 'published'/i);
  assert.match(
    migration,
    /grant execute on function warehouse\.procurement_receipt_excess_work_items\(jsonb\)[\s\S]*?authenticated, service_role/i,
  );
});

test("the route crawl recognizes the current explicit access-denied screen", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /You don't have access to this page/i);
});

test("the route crawl expands all filters and rejects empty audit shards", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /AUDIT_ROLE\?\.trim\(\)\.toLowerCase\(\) === "all"/);
  assert.match(source, /AUDIT_VIEWPORT\?\.trim\(\)\.toLowerCase\(\) === "all"/);
  assert.match(source, /selectedUsers\.length === 0[\s\S]*?Unknown AUDIT_ROLE/);
  assert.match(
    source,
    /selectedViewports\.length === 0[\s\S]*?Unknown AUDIT_VIEWPORT/,
  );
});

test("certifies mandatory first-login onboarding before module route and transaction audits", async () => {
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/uat-live-certification.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const source = await readFile(
    new URL("./complete-uat-role-orientations.mjs", import.meta.url),
    "utf8",
  );

  const desktop = workflow.indexOf(
    "Complete first-login role orientations on desktop",
  );
  const mobile = workflow.indexOf(
    "Verify completed role orientations on mobile",
  );
  const routes = workflow.indexOf("routes:");
  assert.ok(desktop > 0 && mobile > desktop && routes > mobile);
  assert.match(workflow, /AUDIT_ORIENTATION_MUTATIONS: "true"/);
  assert.match(workflow, /AUDIT_ORIENTATION_MUTATIONS: "false"/);
  assert.match(workflow, /pnpm certify:onboarding-live/g);
  assert.match(source, /CURRENT_LIVE_ROLES/);
  assert.match(source, /visibleEnabledOrientationLauncher/);
  assert.match(source, /Start \.\+ orientation/);
  assert.match(source, /Finish review/);
  assert.match(source, /Continue to My Work/);
  assert.match(source, /Continue to vendor onboarding/);
  assert.match(source, /assertApprovedMutationTarget/);
  assert.match(source, /verifyDeployedTargetIdentity/);
  assert.doesNotMatch(source, /AUDIT_PASSWORD\s*[=:]\s*["'][^"']+/);
});

test("cross-module scenarios are imported and executed as browser/database contracts", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /CURRENT_LIVE_SCENARIOS,/);
  for (const scenarioId of CURRENT_LIVE_SCENARIOS.map(
    (scenario) => scenario.id,
  )) {
    assert.match(
      source,
      new RegExp(`scenarioId:\\s*["']${scenarioId}["']`),
      `${scenarioId} is attached to executable workflow results`,
    );
  }
  for (const workflow of [
    "eventsCreateAndReadbackWorkflow",
    "eventsViewerMutationDenialWorkflow",
    "eventsCoordinatorReadbackWorkflow",
    "warehouseEventHandoffWorkflow",
    "insightsGovernanceWorkflow",
    "unifiedFinanceReadbackWorkflow",
  ]) {
    assert.match(
      source,
      new RegExp(`run:\\s*\\([^)]*\\)[\\s\\S]{0,500}${workflow}\\(`),
      `${workflow} is passed to runWorkflow`,
    );
  }
  assert.match(
    source,
    /verifyCheckpoint\(\{[\s\S]*schema: "warehouse",[\s\S]*table: "events"/,
  );
  assert.match(source, /Duplicate Events replay left/);
  assert.match(source, /Denied Events mutation persisted a row/);
  assert.match(source, /mutated the read-only Insights snapshot/);
  assert.match(source, /denied Insights write persisted a row/);
  assert.match(source, /getByLabel\("Insight view", \{ exact: true \}\)/);
  assert.match(source, /availableAreas\.includes\(area\)/);
  assert.match(source, /beforeRefresh !== afterRefresh/);
  assert.match(source, /sources\.has\("procurement_po"\)/);
  assert.match(source, /sources\.has\("warehouse_receipt"\)/);
  assert.match(source, /Unified Finance PO source link is incorrect/);
  assert.match(
    source,
    /Unified Finance exposed an inaccessible receiving link/,
  );
  assert.match(source, /evaluateScenarioCoverage\(/);
  assert.match(source, /scenarioCoverage/);
  assert.match(source, /scenarioCoverageFailures\(scenarioCoverage\)/);
  assert.match(source, /shardCoverageViewports/);
});

test("route crawl enforces an exact role-to-route authorization matrix", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /const ROUTE_AUTHORIZATION_MATRIX = \[/);
  assert.match(source, /expectedAccess: allowed \? "allowed" : "denied"/);
  assert.match(source, /routeClass === expectedClass/);
  assert.match(
    source,
    /no \(\?:warehouse\|procurement[\s\S]*finance\|product\) access/,
  );
  assert.match(
    source,
    /const routeQueue = routesFor\(user, discoveredRoutes\)/,
  );
  assert.match(source, /while \(routeQueue\.length\)/);
  assert.match(
    source,
    /allowed: \(user\) => hasAssignedModule\(user, "events"\)/,
  );
  assert.match(
    source,
    /allowed: \(user\) => hasAssignedModule\(user, "insights"\)/,
  );
  assert.match(
    source,
    /allowed: \(user\) => hasAssignedModule\(user, "product"\)/,
  );
  assert.match(source, /allowed: hasFinanceAccess/);
  assert.doesNotMatch(
    source,
    /text: \/Warehouse\|Dashboard\|No warehouse access\|Access denied\/i/,
  );
  assert.doesNotMatch(
    source,
    /text: \/Finance\|Payment readiness\|Valuation\|Your areas\|Vendor Portal\|Access denied\/i/,
  );
});

test("route crawl rejects silent redirects without depending on permanent QA records", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /finalPathMatches\(route\.path, page\.url\(\)\)/);
  assert.match(
    source,
    /route\.recordText\s*\?\s*route\.recordText\.test\(audit\.text\)/,
  );
  assert.match(source, /acceptedPaths\.get\(canonicalPath\(expectedPath\)\)/);
  assert.match(
    source,
    /\["\/warehouse\/data", new Set\(\["\/warehouse\/data", "\/insights\/warehouse"\]\)\]/,
  );
  assert.match(
    source,
    /\["\/warehouse\/quality-control", new Set\(\["\/warehouse\/quality"\]\)\]/,
  );
  assert.doesNotMatch(source, /path: "\/procurement\/requests\/req_seed_001"/);
  assert.doesNotMatch(source, /path: "\/legal\/cases\/case_seed_001"/);
  assert.doesNotMatch(source, /path: "\/vendor\/cases\/case_seed_001"/);
  assert.match(source, /async function routeReadinessSnapshot\(page\)/);
  assert.match(
    source,
    /\["blank-or-nearblank", "route-not-ready"\]\.includes\(routeClass\)/,
  );
  assert.match(source, /blankRecoveryAttempts = 1/);
  assert.match(source, /await page\.reload\(\{ waitUntil: "domcontentloaded"/);
});

test("route classification rejects rendered not-found shells", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /lower\.includes\("page not found"\)/);
  assert.match(source, /return "not-found"/);
});

test("route readiness fails closed on shell-only, busy, or structurally invalid pages", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  const waitStart = source.indexOf("async function waitForMeaningfulRoute");
  const waitEnd = source.indexOf("async function waitForRouteExpectation");
  const waitSource = source.slice(waitStart, waitEnd);
  assert.match(waitSource, /visibleMainCount === 1/);
  assert.match(waitSource, /visibleH1Count === 1/);
  assert.match(waitSource, /h1InMainCount === 1/);
  assert.match(waitSource, /routeOwnedTextLength >= 20/);
  assert.match(waitSource, /busyCount === 0/);
  assert.doesNotMatch(waitSource, /\.catch\(\(\) => \{\}\)/);
  assert.match(source, /routeStructureProblems/);
  assert.match(source, /route-not-ready/);
});

test("route certification persists accessibility, keyboard, hotspot, and mobile target evidence", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  const auditStart = source.indexOf("async function auditRoute");
  const auditEnd = source.indexOf(
    "async function procurementCreateRequestWorkflow",
  );
  const auditSource = source.slice(auditStart, auditEnd);
  assert.match(auditSource, /auditSeriousAccessibility\(page\)/);
  assert.match(auditSource, /auditKeyboardAndHotspots\(page\)/);
  assert.match(auditSource, /seriousAccessibility/);
  assert.match(auditSource, /undersizedMobileTargets/);
  assert.match(auditSource, /keyboardHotspots/);
  assert.match(source, /accessibilityRoutes/);
  assert.match(source, /keyboardRoutes/);
  assert.match(source, /targetSizeRoutes/);
  assert.match(source, /routeStructureRoutes/);
});

test("route crawl covers visible same-origin navigation discovered from the shell DOM", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /async function discoverVisibleNavigationRoutes\(page\)/,
  );
  assert.match(
    source,
    /nav a\[href\][\s\S]*\[role=["']navigation["']\] a\[href\]/,
  );
  assert.match(source, /const target = new URL\(href, document\.baseURI\)/);
  assert.match(source, /target\.origin !== location\.origin/);
  assert.match(
    source,
    /QA-\\d\{8\}-\[A-F0-9\]\{8\}\/i\.test\(link\.textContent \|\| ""\)/,
  );
  assert.match(source, /routesFor\(user, discoveredRoutes\)/);
  assert.match(source, /getByRole\("button", \{ name: "More"/);
  assert.match(source, /getByRole\("dialog", \{ name: "All areas"/);
  assert.match(source, /discoverSafeDetailRoutes\(page\)/);
  assert.match(source, /recursive-rendered-link/);
  assert.match(
    source,
    /routes\.filter\(\(pathname\) => !isEphemeralAuditPath\(pathname\)\)/,
  );
  assert.match(source, /QA-\\d\{8\}-\[A-F0-9\]\{8\}/);
  assert.match(source, /reducedMotion: "reduce"/);
  assert.match(source, /\.slice\(0, 64\)/);
});

test("the mutating harness waits for quality data and uses unambiguous DOA controls", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /getByLabel\("Department", \{ exact: true \}\)/);
  assert.doesNotMatch(
    source,
    /getByLabel\("Tier 1", \{ exact: true \}\)\s*\.selectOption\("final_approver"\)/,
  );
  assert.match(source, /getByLabel\(`Tier \$\{index \+ 1\} named approver`\)/);
  assert.match(source, /DOA draft saved for independent review/);
  assert.match(source, /legalActivateDoaWorkflow/);
  assert.match(source, /Loading quality controls/);
  assert.match(source, /No inspections waiting/);
});

test("PO amendment browser approval submits the governed snake-case signature contract", async () => {
  const source = await readFile(
    new URL(
      "../../modules/procurement/src/pages/PurchaseOrdersPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /signature_png:\s*signature\.dataUrl/);
  assert.match(source, /signer_name:\s*signature\.signerName/);
  assert.match(source, /signature_method:\s*signature\.method/);
  assert.match(source, /signed_at:\s*signature\.signedAt/);
  assert.doesNotMatch(source, /signature:\s*makeTypedSignature\(/);
});

test("Task 3 asserts current DOA, PNG signatures, exact held-stock issue denial, and both race outcomes", async () => {
  const [harness, migration] = await Promise.all([
    readFile(new URL("./full-intra-live-e2e.mjs", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../supabase/migrations/20260714175318_single_po_receipt_authority.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(harness, /data:image\/png;base64,/);
  assert.match(harness, /signer_name: fixture\.approverName/);
  assert.match(harness, /holdRace\.ok\s*\?\s*atpBeforeRace\s*-\s*1\s*:\s*0/);
  assert.match(harness, /revoked current DOA assignment denial/i);
  assert.match(harness, /held serialized unit issue denial/i);
  assert.match(harness, /held exact lot issue denial/i);
  assert.match(harness, /const postReleaseAtp = await callRpcArgsAsBrowserUser/);
  assert.match(harness, /quantity: reservationQuantity/);
  assert.match(harness, /authoritative hold race readback expected zero ATP/i);
  assert.match(
    migration,
    /Only a currently active DOA assignment and matrix may decide the next amendment step/i,
  );
  assert.match(migration, /data:image\/png;base64,/);
  assert.match(
    migration,
    /create or replace function warehouse\.issue\(payload jsonb\)[\s\S]*inventory_holds[\s\S]*serial_number/is,
  );
});

test("the invite workflow verifies the persisted delivery state", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /AUDIT_REQUIRE_VENDOR_DELIVERY/);
  assert.match(source, /runVendorDeliveryWorkflow/);
  assert.match(source, /legalInviteVendorInteractionWorkflow/);
  assert.match(source, /AUDIT_VENDOR_EMAIL/);
  assert.match(source, /controlled mailbox template containing \{marker\}/);
  assert.match(source, /vendorDeliveryConfigurationError/);
  assert.match(source, /replaceAll\("\{marker\}", marker\.toLowerCase\(\)\)/);
  assert.match(source, /deliveryStatus !== "sent"/);
  assert.match(source, /auth_user_id,expires_at,link_generation/);
  assert.match(source, /acceptance_token_hash/);
  assert.match(source, /Vendor access was active before invitation acceptance/);
  assert.match(source, /Accepted invitation replay was not rejected/);
  assert.match(source, /acceptanceEvidenceScreenshot/);
  assert.match(source, /table: "vendor_invites"/);
  assert.match(source, /filters: \{ company_name: companyName \}/);
});

test("governed transactions retain visual and accessibility evidence", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /AUDIT_EVIDENCE_DIR/);
  assert.match(source, /page\.screenshot/);
  assert.match(source, /new AxeBuilder\(\{ page \}\)/);
  assert.match(source, /overflow: layout\.horizontalOverflow/);
  assert.match(source, /seriousAccessibility/);
  assert.match(source, /undersizedMobileTargets/);
  assert.match(source, /label\?\.contains\(element\)/);
  assert.match(source, /interactionProblems/);
  assert.match(source, /auditKeyboardAndHotspots\(page\)/);
  assert.match(source, /keyboardHotspots/);
  assert.match(source, /captureState/);
  assert.match(source, /intermediateEvidence/);
});

test("interaction reachability scopes an active modal and excludes inert background controls", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /element\.closest\("\[inert\]"\)/);
  assert.match(source, /element\.closest\('\[aria-hidden="true"\]'\)/);
  assert.match(source, /element\.getAttribute\("aria-disabled"\) === "true"/);
  assert.match(source, /dialog\[open\], \[role="dialog"\]/);
  assert.match(source, /dialog\.getAttribute\("aria-modal"\) === "true"/);
  assert.match(source, /dialog\.matches\(":modal"\)/);
  assert.match(source, /!activeDialog \|\| activeDialog\.contains\(element\)/);
  assert.match(
    source,
    /activeDialog && active && !activeDialog\.contains\(active\)/,
  );
  assert.match(source, /suppressedControlCount/);
});

test("interaction reachability rechecks blocked controls without hiding real fixed-overlay failures", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  const initialProbe = source.indexOf("const initial = probe(element)");
  const scrollRecheck = source.indexOf(
    "const reachability = await recheckReachability(element, initial)",
  );
  const finalFailure = source.indexOf(
    "interceptedTargets.push({",
    scrollRecheck,
  );
  assert.ok(initialProbe >= 0, "an initial multi-point probe is required");
  assert.match(source, /!element\.isConnected \|\| !visible\(element\)/);
  assert.ok(scrollRecheck > initialProbe, "blocked controls are rechecked");
  assert.ok(
    finalFailure > scrollRecheck,
    "interception is reported only after the reachability recheck",
  );
  assert.match(
    source,
    /const xs = \[left \+ insetX, \(left \+ right\) \/ 2, right - insetX\]/,
  );
  assert.match(
    source,
    /const ys = \[top \+ insetY, \(top \+ bottom\) \/ 2, bottom - insetY\]/,
  );
  assert.match(source, /label\?\.control === element/);
  assert.match(source, /associatedLabel\?\.contains\(element\)/);
  assert.match(source, /element\.closest\("label"\)/);
  assert.match(
    source,
    /element\.scrollIntoView\(\{ block: "center", inline: "center" \}\)/,
  );
  assert.match(source, /await nextPaint\(\);\s*await nextPaint\(\);/);
  assert.match(
    source,
    /container\.element\.scrollTo\(container\.left, container\.top\)/,
  );
  assert.match(source, /scrollTo\(windowScroll\.left, windowScroll\.top\)/);
  assert.match(source, /recheckedAfterScroll/);
  assert.doesNotMatch(source, /position\s*===?\s*["']fixed["']/);
});

test("Product launch certification uses UI decisions, denial checks, readback, screenshots, and cleanup", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /productContributorWorkflow/);
  assert.match(source, /productOwnerDecisionWorkflow/);
  assert.match(source, /productOperationsHandoffWorkflow/);
  assert.match(source, /New readiness package/);
  assert.match(source, /Propose price/);
  assert.match(source, /Approve go-live/);
  assert.match(source, /Approve price/);
  assert.match(source, /Acknowledge Operations handoff/);
  assert.match(source, /Acknowledg\(\?:e\|ing\) Operations handoff/);
  assert.match(source, /not awaiting decision/i);
  assert.match(source, /not authorized/i);
  assert.match(source, /"product",\s*"can_launch"/);
  assert.match(source, /await page\.reload\(/);
  assert.match(source, /captureState\("Product readiness validation"\)/);
  assert.match(
    source,
    /captureState\("Operations Product handoff persisted"\)/,
  );
  assert.match(source, /cleanupProductGovernance\(marker\)/);
  assert.match(source, /cleanup_certification_records/);
  assert.match(source, /name: state\.readinessTitle,\s*exact: true/);
  assert.match(source, /xpath=ancestor::article\[1\]/);
  assert.doesNotMatch(
    source,
    /ancestor::div\[\.\/\/button\[normalize-space\(\)=['"]Approve (?:go-live|price)['"]\]\]/,
  );
  assert.match(source, /productGovernanceResults\.every/);
});

test("the mutating harness scopes and removes temporary auth identities", async () => {
  const [harness, cleanup] = await Promise.all([
    readFile(new URL("./full-intra-live-e2e.mjs", import.meta.url), "utf8"),
    readFile(new URL("./live-e2e-cleanup.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(harness, /vendorAuditEmail\(marker\)/);
  assert.match(harness, /authEmails/);
  assert.match(cleanup, /auth\.admin\.listUsers/);
  assert.match(cleanup, /auth\.admin\.deleteUser/);
  assert.match(cleanup, /includes\(runId\.toLowerCase\(\)\)/);
});

test(
  "executes Task 3 receipt and policy contracts against live UAT",
  {
    skip: process.env.RUN_TASK3_LIVE_CONTRACT !== "true",
    timeout: 20 * 60_000,
  },
  async () => {
    const run = promisify(execFile);
    const { stdout } = await run(
      process.execPath,
      [fileURLToPath(new URL("./full-intra-live-e2e.mjs", import.meta.url))],
      {
        env: { ...process.env, AUDIT_MUTATIONS: "true" },
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    assert.match(stdout, /Wrote .*full-intra-live-e2e-results\.json/);
  },
);

test("Task 3 uses browser-role exception receipts and proves transactional cleanup", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /receive_procurement_po_exception/);
  assert.doesNotMatch(
    source,
    /insertAuditRows\([^)]*"warehouse"\s*,\s*"(?:receipts|quality_inspections)"/s,
    "receipt and QC fixtures must be created through browser-role RPCs",
  );
  const cleanupRegistration = source.indexOf("registerTask3Cleanup");
  const firstTask3Insert = source.indexOf(
    'insertAuditRows(client, "core", "vendors"',
  );
  assert.ok(cleanupRegistration >= 0 && cleanupRegistration < firstTask3Insert);
  assert.match(
    source,
    /finally\s*\{\s*try\s*\{[\s\S]*browser\.close\(\)[\s\S]*finally\s*\{[\s\S]*cleanupTask3ReceiptFixture/,
  );
  assert.match(source, /assertTask3ZeroResidualRows/);
  assert.match(
    source,
    /inventoryBefore[\s\S]*inventoryAfter[\s\S]*ledgerBefore[\s\S]*ledgerAfter/,
  );
  assert.match(source, /resolve_procurement_po_exception/);
  assert.match(source, /requested_by[\s\S]*different Warehouse Supervisor/i);
  assert.match(source, /acceptance_work_items/);
  assert.match(source, /Task 3 requester goods acceptance/);
  assert.match(source, /Task 3 assigned-reviewer goods acceptance/);
  assert.match(source, /cleanupActivityEntityIds/);
  assert.match(source, /cleanupExceptionIds/);
  assert.match(source, /cleanupHoldIds/);
  assert.match(source, /same-line receipt decision collision/i);
  assert.match(source, /expected quantity drift/i);
  assert.match(source, /active hold reservation denial/i);
  assert.match(source, /bounded quarantine posting/i);
  assert.match(source, /quarantine line claim collision/i);
  assert.match(source, /unidentified accept identification/i);
  assert.match(source, /unidentified quarantine identification/i);
  assert.match(source, /browser escalation final disposition/i);
  assert.match(source, /authoritative hold race readback/i);
  assert.match(source, /accepted excess without approved amendment/i);
  assert.match(source, /cumulative payment acceptance binding/i);
  assert.match(source, /referenced approval role rename\/deactivate denial/i);
  assert.match(source, /inactive approval role cannot authorize/i);
  assert.match(source, /Material stock change bypassed Finance handoff/);
  assert.match(
    source,
    /Task 3 Finance negative-stock approval denial[\s\S]*intra\.test\.finance@mwell\.com\.ph/,
  );
  assert.match(
    source,
    /Finance negative-stock approval[\s\S]*expected: \{ status: "pending_finance" \}/,
  );
  assert.match(source, /valid public quality inspection/i);
  assert.match(
    source,
    /\.map\(\(line\) => \(\{ receiving_status: "open", \.\.\.line \}\)\)/,
  );
  assert.match(source, /PO status after hold release/i);
  assert.match(source, /cumulative partial acceptance/i);
  assert.match(source, /all-capability admin wrong-step denial/i);
  assert.match(source, /cleanupHoldIds[\s\S]*core\.activity_log/);
  assert.match(source, /private quality inspection direct denial/i);
  assert.match(source, /active exception public quality denial/i);
  assert.match(source, /approved amendment quantity growth/i);
  assert.match(source, /unidentified excess custody/i);
  assert.match(source, /authenticated excess custody work items/i);
  assert.match(source, /Supervisor excess custody final disposition/i);
  assert.match(source, /distinct active acceptance packs/i);
  assert.match(source, /stale payment readiness invalidation/i);
  assert.match(source, /same-product PO-line quality isolation/i);
  assert.match(source, /atomic hold rejection vendor return/i);
  assert.match(source, /authoritative hold race readback/i);
  assert.doesNotMatch(
    source,
    /if \(!concurrentReservation\.ok[\s\S]*available after active inventory holds/i,
    "hold races must assert one deterministic authoritative state",
  );
  for (const exceptionClass of ["short", "excess", "damaged", "unidentified"]) {
    assert.match(
      source,
      new RegExp(`exceptionClass:\\s*["']${exceptionClass}["']`, "i"),
    );
  }
  for (const outcome of ["accept", "reject", "quarantine", "escalate"]) {
    assert.match(source, new RegExp(`outcome:\\s*["']${outcome}["']`, "i"));
  }
  assert.match(source, /inventory_holds[\s\S]*status[\s\S]*active/i);
  assert.match(source, /release_quality_hold[\s\S]*status[\s\S]*released/i);
  assert.match(source, /reject:\s*"vendor_return"/i);
  assert.match(source, /warehouseReceiptId/);
  assert.match(source, /qcInspectionIds/);
});

test("production certification uses the shared audit credential without privileged database access", async () => {
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/production-readonly-certification.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    workflow,
    /AUDIT_PASSWORD: \$\{\{ secrets\.AUDIT_PASSWORD \|\| secrets\.UAT_AUDIT_MASTER_PASSWORD \}\}/,
  );
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /AUDIT_MUTATIONS: "false"/);
});

test("vendor readiness appends conditional requirements with array-safe operations", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260806100000_vendor_readiness_array_append.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    migration,
    /array_append\(v_required, 'PH_PRIVACY_COMPLIANCE'\)/,
  );
  assert.match(
    migration,
    /array_append\(v_required, 'PH_CYBERSECURITY_POLICIES'\)/,
  );
  assert.doesNotMatch(migration, /v_required\s*:=\s*v_required\s*\|\|\s*'PH_/);
});

test("receiving wrappers authorize before disclosure and preserve idempotent replay", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260806090000_receiving_boundary_replay_order.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const command of [
    "receive_procurement_po",
    "receive_procurement_po_exception",
  ]) {
    const start = migration.indexOf(
      `create or replace function warehouse.${command}`,
    );
    assert.ok(start >= 0, `${command} wrapper is missing`);
    const body = migration.slice(start, migration.indexOf("$$;", start));
    assert.ok(
      body.indexOf("core.has_cap('warehouse', 'receive_stock')") <
        body.indexOf("private.assert_goods_procurement_po"),
      `${command} must authorize before checking PO state`,
    );
    assert.ok(
      body.indexOf("warehouse.command_log") <
        body.indexOf("private.assert_goods_procurement_po"),
      `${command} must recognize a replay before checking current PO state`,
    );
  }
});

test("the UI and live harness cover mobile names, controlled accounting, and completed writes", async () => {
  const [requestPage, accreditationCases, caseDetail, eventsApp, harness] =
    await Promise.all([
      readFile(
        new URL(
          "../../modules/procurement/src/pages/CreateRequestPage.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../../modules/legal/src/pages/AccreditationCasesPage.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../../modules/legal/src/pages/CaseDetailPage.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../../modules/events/src/EventsApp.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("./full-intra-live-e2e.mjs", import.meta.url), "utf8"),
    ]);
  assert.match(requestPage, /aria-label={`Step \$\{s\.n\}:/);
  assert.match(
    accreditationCases,
    /aria-label="Accreditation requirements approved"/,
  );
  assert.match(caseDetail, /aria-label="Overall accreditation progress"/);
  assert.match(eventsApp, /<select[\s\S]*id="event-request-department"/);
  assert.match(eventsApp, /<select[\s\S]*id="event-request-cost"/);
  assert.match(
    harness,
    /getByLabel\("Department"\)\.selectOption\("marketing"\)/,
  );
  assert.match(harness, /readinessDialog\.waitFor\(\{ state: "detached"/);
  assert.match(harness, /priceDialog\.waitFor\(\{ state: "detached"/);
  assert.match(
    harness,
    /acceptanceHeading[\s\S]*waitFor\(\{ state: "visible", timeout: 25_000 \}\)/,
  );
});

test("the live harness verifies deployed identity before browser launch", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  const verification = source.indexOf("await verifyDeployedTargetIdentity(");
  const browserLaunch = source.indexOf("chromium.launch(");

  assert.ok(verification >= 0, "deployed identity verification is present");
  assert.ok(browserLaunch >= 0, "browser launch is present");
  assert.ok(verification < browserLaunch, "identity is verified before launch");
  assert.match(source, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.doesNotMatch(source, /extraHTTPHeaders\s*:/);
  assert.equal(
    source.match(/await installScopedProtectionBypass\(\{/g)?.length,
    3,
    "all browser contexts install exact-origin bypass routing",
  );
  assert.doesNotMatch(source, /context\.route\(["']\*\*\/\*["']/);
  assert.match(source, /installScopedProtectionBypass,/);
  assert.doesNotMatch(
    source,
    /console\.(?:log|warn|error)\([^)]*VERCEL_AUTOMATION_BYPASS_SECRET/,
  );
});

test("Vercel protection bypass headers are scoped to the exact app origin", async () => {
  const { scopedProtectionHeaders } =
    await import("../lib/target-environment.mjs");
  const input = {
    appOrigin: "https://uat.example.com",
    protectionBypass: "bypass-secret",
    requestHeaders: {
      accept: "application/json",
      "x-vercel-protection-bypass": "stale-secret",
    },
  };

  assert.deepEqual(
    scopedProtectionHeaders({
      ...input,
      requestUrl: "https://uat.example.com/api/health",
    }),
    {
      accept: "application/json",
      "x-vercel-protection-bypass": "bypass-secret",
    },
  );

  for (const requestUrl of [
    "https://uatref.supabase.co/rest/v1/items",
    "https://analytics.example.net/collect",
    "https://assets.uat.example.com/app.js",
  ]) {
    const headers = scopedProtectionHeaders({ ...input, requestUrl });
    assert.equal(
      headers["x-vercel-protection-bypass"],
      undefined,
      `${new URL(requestUrl).origin} must not receive the bypass`,
    );
    assert.equal(headers.accept, "application/json");
  }
});

test("route registration intercepts only the exact app origin", async () => {
  const { installScopedProtectionBypass } =
    await import("../lib/target-environment.mjs");
  const registrations = [];
  const context = {
    route: async (matcher, handler) => registrations.push({ matcher, handler }),
  };

  await installScopedProtectionBypass({
    context,
    appOrigin: "https://uat.example.com:8443",
    protectionBypass: "bypass-secret",
  });

  assert.equal(registrations.length, 1);
  const [{ matcher, handler }] = registrations;
  assert.equal(typeof matcher, "function", "registration uses a URL predicate");

  for (const requestUrl of [
    "https://uat.example.com:8443/",
    "https://uat.example.com:8443/api/health?probe=deployed%20identity",
    "https://uat.example.com:8443/deep/path?next=%2Fdashboard&tab=2",
  ]) {
    assert.equal(matcher(new URL(requestUrl)), true, requestUrl);
  }
  for (const requestUrl of [
    "https://uat.example.com/without-required-port",
    "https://uat.example.com:9443/different-port",
    "https://assets.uat.example.com:8443/app.js",
    "https://uat.example.com.evil.test:8443/collect",
    "https://uatref.supabase.co/rest/v1/items",
    "https://analytics.example.net/collect",
  ]) {
    assert.equal(matcher(new URL(requestUrl)), false, requestUrl);
  }

  const appRequest = fakeRoute({
    url: "https://uat.example.com:8443/start?source=audit",
    headers: { cookie: "session=abc" },
    response: { status: 200 },
  });
  if (matcher(new URL(appRequest.route.request().url()))) {
    await handler(appRequest.route);
  }
  assert.equal(appRequest.calls.fetch.length, 1);

  const nonAppRequest = fakeRoute({
    url: "https://uatref.supabase.co/rest/v1/items?select=*",
    headers: { authorization: "Bearer session-token" },
  });
  if (matcher(new URL(nonAppRequest.route.request().url()))) {
    await handler(nonAppRequest.route);
  }
  assert.deepEqual(nonAppRequest.calls, {
    continue: [],
    fetch: [],
    fulfill: [],
  });
});

function fakeRoute({
  url,
  headers,
  method = "GET",
  postData = null,
  response,
}) {
  const calls = { continue: [], fetch: [], fulfill: [] };
  return {
    calls,
    route: {
      request: () => ({
        allHeaders: async () => ({ ...headers }),
        method: () => method,
        postDataBuffer: () => postData,
        url: () => url,
      }),
      continue: async (options) => calls.continue.push(options),
      fetch: async (options) => {
        calls.fetch.push(options);
        return response;
      },
      fulfill: async (options) => calls.fulfill.push(options),
    },
  };
}

test("app-origin interception preserves request and redirect response semantics", async () => {
  const { routeWithScopedProtectionBypass } =
    await import("../lib/target-environment.mjs");
  const postData = Buffer.from("important-body");
  const redirectResponse = {
    status: 307,
    headers: { location: "https://uat.example.com/next" },
    body: "redirect-body",
  };
  const intercepted = fakeRoute({
    url: "https://uat.example.com/start",
    headers: {
      authorization: "Bearer session-token",
      cookie: "session=abc",
    },
    method: "POST",
    postData,
    response: redirectResponse,
  });

  await routeWithScopedProtectionBypass({
    route: intercepted.route,
    appOrigin: "https://uat.example.com",
    protectionBypass: "bypass-secret",
  });

  assert.equal(intercepted.calls.continue.length, 0);
  assert.equal(intercepted.calls.fetch.length, 1);
  assert.deepEqual(intercepted.calls.fetch[0], {
    headers: {
      authorization: "Bearer session-token",
      cookie: "session=abc",
      "x-vercel-protection-bypass": "bypass-secret",
    },
    maxRedirects: 0,
    method: "POST",
    postData,
  });
  assert.deepEqual(intercepted.calls.fulfill, [{ response: redirectResponse }]);
});

test("redirect hops to non-app origins never receive the bypass", async () => {
  const { routeWithScopedProtectionBypass } =
    await import("../lib/target-environment.mjs");
  for (const redirectUrl of [
    "https://uatref.supabase.co/rest/v1/items",
    "https://analytics.example.net/collect",
    "https://assets.uat.example.com/app.js",
  ]) {
    const firstHop = fakeRoute({
      url: "https://uat.example.com/start",
      headers: { cookie: "session=abc" },
      response: { status: 302, headers: { location: redirectUrl } },
    });
    await routeWithScopedProtectionBypass({
      route: firstHop.route,
      appOrigin: "https://uat.example.com",
      protectionBypass: "bypass-secret",
    });
    assert.equal(firstHop.calls.fetch[0].maxRedirects, 0);

    const redirectedHop = fakeRoute({
      url: redirectUrl,
      headers: {
        accept: "application/json",
        "x-vercel-protection-bypass": "bypass-secret",
      },
    });
    await routeWithScopedProtectionBypass({
      route: redirectedHop.route,
      appOrigin: "https://uat.example.com",
      protectionBypass: "bypass-secret",
    });

    assert.equal(redirectedHop.calls.fetch.length, 0);
    assert.equal(redirectedHop.calls.continue.length, 1);
    assert.equal(
      redirectedHop.calls.continue[0].headers["x-vercel-protection-bypass"],
      undefined,
      `${new URL(redirectUrl).origin} must not receive the bypass`,
    );
    assert.equal(
      redirectedHop.calls.continue[0].headers.accept,
      "application/json",
    );
  }
});

test("same-origin redirect hops receive a freshly scoped bypass", async () => {
  const { routeWithScopedProtectionBypass } =
    await import("../lib/target-environment.mjs");
  for (const url of [
    "https://uat.example.com/start",
    "https://uat.example.com/next",
  ]) {
    const hop = fakeRoute({
      url,
      headers: { cookie: "session=abc" },
      response: { status: url.endsWith("/start") ? 302 : 200 },
    });
    await routeWithScopedProtectionBypass({
      route: hop.route,
      appOrigin: "https://uat.example.com",
      protectionBypass: "bypass-secret",
    });

    assert.equal(hop.calls.fetch.length, 1);
    assert.equal(hop.calls.fetch[0].maxRedirects, 0);
    assert.equal(
      hop.calls.fetch[0].headers["x-vercel-protection-bypass"],
      "bypass-secret",
    );
    assert.equal(hop.calls.fulfill.length, 1);
  }
});

test("receipt authority harness proves hold creation versus reservation with authoritative readbacks", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /hold creation versus reservation/i);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /available_to_promise/);
  assert.match(source, /inventory_holds/);
  assert.match(source, /allocations/);
  assert.match(source, /quality_inspections/);
  assert.match(source, /purchase_order_lines/);
  assert.match(
    source,
    /exactly one concurrent hold or reservation may consume availability/i,
  );
});

test("Warehouse excess E2E selects the exact governed amendment", async () => {
  const harness = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    harness,
    /getByLabel\("Approved quantity amendment"\)\s*\.selectOption\(fixture\.ids\.excessAmendment\)/,
  );
  assert.doesNotMatch(harness, /getByLabel\("Approved amendment ID"\)\.fill/);
  assert.match(
    harness,
    /getByRole\("dialog", \{\s*name: "Final excess custody disposition",\s*\}\)/,
  );
});

test("governed Warehouse fixtures use the run-scoped location and await hold disposition", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /from\("locations"\)[\s\S]*?\.eq\("id", marker\)[\s\S]*?\.eq\("type", "warehouse"\)/,
  );
  assert.match(
    source,
    /name: "Reject and create vendor return"[\s\S]*?name: "Review inventory hold"[\s\S]*?state: "detached"/,
  );
});

test("Warehouse audit products satisfy the governed serialization contract", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /id: ids\.product[\s\S]*?item_class: "merchandise"[\s\S]*?serialization_policy: "none"[\s\S]*?serialized: false/,
  );
  assert.match(
    source,
    /id: ids\.serializedIssueProduct[\s\S]*?item_class: "sellable_sku"[\s\S]*?serialization_policy: "required"[\s\S]*?serialized: true/,
  );
  assert.match(source, /preserveFatalAuditEvidence/);
});

test("live certification recognizes Product denials and keeps Finance out of cycle counts", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /Finance\|Product/);
  assert.match(
    source,
    /finance_unified:[\s\S]*?path: "\/warehouse\/approvals"/,
  );
  assert.match(
    source,
    /"intra\.test\.operations\.lead@mwell\.com\.ph",\s*"warehouse cycle count validation"/,
  );
});

test("Events certification submits and cleans the governed Warehouse handoff", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /name: "Request warehouse stock"/);
  assert.match(source, /from\("department_stock_requests"\)/);
  assert.match(source, /state\.fulfillmentRequestId/);
  assert.match(source, /cleanupEventWorkflowDependencies/);
  assert.match(source, /"event_lifecycle_events"[\s\S]*?\.delete\(\)/);
  assert.match(source, /fulfillment_reservations/);
  assert.match(source, /fulfillment_orders/);
});

test("governed Warehouse wrappers retain private-schema isolation", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260722174500_restore_governed_warehouse_wrapper_execution.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const name of ["release_quality_hold", "submit_cycle_count"]) {
    assert.match(
      migration,
      new RegExp(
        `function warehouse\\.${name}\\(payload jsonb\\)[\\s\\S]*?security definer`,
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on function private\\.warehouse_${name}\\(jsonb\\)[\\s\\S]*?authenticated`,
      ),
    );
  }
});

test("Warehouse resolvers reconcile both receipt authority queues", async () => {
  const source = await readFile(
    new URL(
      "../../modules/warehouse/src/pages/PurchaseOrdersPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /procurement_receipt_exception_work_items/);
  assert.match(source, /procurement_receipt_excess_work_items/);
  assert.match(source, /reconcile both receipt authority queues/i);
});

test("Task 3 ships an idempotent forward migration for already-versioned databases", async () => {
  const source = await readFile(
    new URL(
      "../../supabase/migrations/20260717143000_task3_receipt_authority_forward_convergence.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /Forward convergence for databases that already applied/i,
  );
  assert.match(source, /add column if not exists doa_matrix_id/i);
  assert.match(source, /legacy_record[\s\S]*?status='superseded'/i);
  assert.match(source, /purchase_order_amendments_governed_snapshot_check/i);
  assert.match(source, /purchase_order_amendments_legacy_terminal_check/i);
  assert.match(source, /purchase_order_amendment_steps/);
  assert.match(
    source,
    /create or replace function private\.policy_approve_po_line_quantity_amendment/,
  );
  assert.match(
    source,
    /create or replace function procurement\.purchase_order_amendment_work_items/,
  );
  assert.match(source, /create or replace function warehouse\.issue/);
});

test("stock approval projection casts UUID entity identifiers into the shared ledger key", async () => {
  const source = await readFile(
    new URL(
      "../../supabase/migrations/20260718150000_fix_stock_approval_projection_uuid_join.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /supervisor_step\.entity_id=request\.id::text/i);
  assert.match(source, /approval\.entity_id=request\.id::text/i);
  assert.doesNotMatch(source, /entity_id=request\.id(?!::text)/i);
});

test("governed receipt quantities and service Finance readback converge safely", async () => {
  const source = await readFile(
    new URL(
      "../../supabase/migrations/20260718180000_fix_receipt_quantity_and_service_finance_readback.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /auth\.role\(\) = 'service_role'/);
  assert.match(source, /ordered_quantity_at_request''\)\:\:numeric\:\:integer/);
});

test("the latest public quality boundary delegates exact PO-line inspection", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260816222000_restore_exact_receipt_quality_boundary.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /core\.has_live_cap\('warehouse', 'inspect_quality'\)/);
  assert.match(
    migration,
    /return private\.warehouse_inspect_quality_v2\(payload\)/,
  );
  assert.doesNotMatch(migration, /return private\.warehouse_inspect_quality\(payload\)/);
});

test("multi-role Procurement collaborators are deduplicated before upsert", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260816223000_deduplicate_procurement_intake_collaborators.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const functionName of [
    "procurement.create_request",
    "procurement.submit_request",
  ]) {
    const bodyStart = migration.indexOf(`create or replace function ${functionName}`);
    const bodyEnd = migration.indexOf("$$;", bodyStart);
    assert.notEqual(bodyStart, -1, `${functionName} repair is missing`);
    assert.notEqual(bodyEnd, -1, `${functionName} repair is unterminated`);
    assert.match(
      migration.slice(bodyStart, bodyEnd),
      /insert into procurement\.request_collaborators[\s\S]*?select distinct/i,
    );
  }
});

test("transaction fixtures and UI checks preserve the acting persona and rendered state", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /requester_id: requesterProfiles\[0\]\.id/);
  assert.match(
    source,
    /getByText\(expected\)[\s\S]*?waitFor\(\{ state: "visible", timeout: 20_000 \}\)/,
  );
  assert.match(
    source,
    /page[\s\S]*?getByText\("Event name is required\."\)[\s\S]*?waitFor/,
  );
  assert.match(source, /phase: "award"/);
  assert.match(source, /replacementAcceptanceFacts/);
});

test("live journeys enforce evidence, independent QC, current labels, and correct owners", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /Document type for \$\{marker\}-spec\.pdf/);
  assert.match(source, /Document type for \$\{marker\}-budget\.pdf/);
  assert.match(source, /filename: `\$\{marker\}-receipt-spec\.pdf`/);
  assert.match(source, /filename: `\$\{marker\}-receipt-budget\.pdf`/);
  assert.match(source, /department: ids\.departmentCode/);
  assert.match(
    source,
    /departmentCode: `audit\.x\$\{crypto\.randomUUID\(\)\.replaceAll\("-", ""\)\}`/,
  );
  assert.match(source, /from\("department_cost_centers"\)/);
  assert.match(source, /query\.eq\("id", ids\.departmentCostCenter\)/);
  assert.match(source, /quality_status: "pending"/);
  assert.match(source, /disposition: "pending"/);
  assert.match(source, /Independent QC receipt status was not preserved/);
  assert.match(source, /Independent QC acceptance did not reach Procurement/);
  assert.match(source, /"Pick & Pack"/);
  assert.doesNotMatch(source, /"Pick or issue"/);
  assert.match(
    source,
    /intra\.test\.operations\.lead@mwell\.com\.ph[\s\S]*?Events-to-Warehouse operational handoff/,
  );
  assert.match(source, /expected_version: state\.readinessVersion/);
});

test("mobile transaction checks target visible records and unobstructed actions", async () => {
  const audit = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  const doaPage = await readFile(
    new URL("../../apps/shell/app/admin/doa/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(audit, /saveDraft\.scrollIntoViewIfNeeded\(\)/);
  assert.match(audit, /const clickSaveDraft = async \(\) =>/);
  assert.equal(
    (audit.match(/await clickSaveDraft\(\);/g) ?? []).length,
    2,
    "both DOA save attempts use the unobstructed mobile action",
  );
  assert.match(audit, /name: "Primary mobile"/);
  assert.match(audit, /Save draft remains obstructed/);
  assert.match(audit, /document\.elementFromPoint/);
  assert.match(audit, /Save draft does not own its center mobile hit target/);
  assert.match(audit, /await page\.touchscreen\.tap\(/);
  assert.match(audit, /hasTouch: viewport\.isMobile/);
  assert.match(
    audit,
    /if \(await mobileNavigation\.count\(\)\)[\s\S]*?else \{[\s\S]*?await saveDraft\.scrollIntoViewIfNeeded\(\)/,
  );
  assert.match(doaPage, /data-mobile-action-bar="true"/);
  assert.match(
    doaPage,
    /sticky bottom-\[calc\(5\.25rem\+env\(safe-area-inset-bottom\)\)\]/,
  );
  assert.doesNotMatch(doaPage, /createPortal\(/);
  assert.match(audit, /slice\(0, 1_200\)/);
});

test("receipt escalation checks are scoped to their accessible decision region", async () => {
  const audit = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    audit,
    /name: "Controlled receipt decisions"[\s\S]*decisionPanel[\s\S]*getByRole\("listitem"\)/,
  );
  assert.doesNotMatch(
    audit,
    /getByText\(`\$\{fixture\.marker\}-PO-UNIDENTIFIED`[^;]+ancestor::li/,
  );
  assert.match(
    audit,
    /const decisionDialog = page\.getByRole\("dialog", \{[\s\S]*name: "Supervisor receipt decision"[\s\S]*decisionDialog\.waitFor\(\{ state: "detached" \}\)/,
  );
  assert.doesNotMatch(
    audit,
    /escalatedRow\.waitFor\(\{ state: "detached" \}\)/,
  );
});

test("excess-custody readback waits for the governed dialog mutation", async () => {
  const audit = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    audit,
    /const custodyDialog = page\.getByRole\("dialog", \{[\s\S]*name: "Final excess custody disposition"[\s\S]*custodyDialog\.waitFor\(\{ state: "detached" \}\)[\s\S]*procurement_receipt_excess_custody/,
  );
});

test("quality hold navigation follows the segmented-control tab contract", async () => {
  const audit = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    audit,
    /getByRole\("tab", \{ name: "Holds", exact: true \}\)\.click\(\)/,
  );
  assert.doesNotMatch(
    audit,
    /getByRole\("button", \{ name: "Holds", exact: true \}\)/,
  );
});

test("the DOA editor cannot submit while asynchronous workspace data shifts the form", async () => {
  const page = await readFile(
    new URL("../../apps/shell/app/admin/doa/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /const \[workspaceLoading, setWorkspaceLoading\]/);
  assert.match(page, /setWorkspaceLoading\(true\);[\s\S]*finally/);
  assert.match(page, /disabled=\{saving \|\| workspaceLoading\}/);
  assert.match(page, /data-mobile-action-bar="true"/);
  assert.match(
    page,
    /sticky bottom-\[calc\(5\.25rem\+env\(safe-area-inset-bottom\)\)\][\s\S]*md:hidden/,
  );
  assert.doesNotMatch(page, /createPortal\(/);
  assert.match(page, /mt-5 hidden justify-end md:flex/);
  assert.doesNotMatch(
    page,
    /\[captureActivationDraft, core, effectiveAt, mode, procurement, toast\]/,
  );
  assert.match(page, /from\("doa_matrices"\)/);
  assert.match(page, /\.eq\("department", matrix\.department\)/);
  assert.match(page, /\.eq\("version", matrix\.version\)/);
  assert.match(page, /payload: \{ matrix_id: currentMatrix\.id \}/);
});

test("DOA activation sends the governed signature and proves independent review", async () => {
  const pageSource = await readFile(
    new URL("../../apps/shell/app/admin/doa/page.tsx", import.meta.url),
    "utf8",
  );
  const auditSource = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    pageSource,
    /rpc\("activate_doa_matrix"[\s\S]*?payload: \{ matrix_id: currentMatrix\.id \}/,
  );
  assert.match(
    auditSource,
    /DOA draft saved for independent review[\s\S]*?status: "draft", active: false/,
  );
  assert.match(
    auditSource,
    /legalActivateDoaWorkflow[\s\S]*?DOA independently activated by Legal[\s\S]*?status: "active", active: true/,
  );
});

test("quality acceptance and DOA activation converge their private contracts", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260816230000_repair_quality_acceptance_and_doa_activation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    migration,
    /v_disposition = 'accepted' and v_stock[.]quantity < v_quantity/,
  );
  assert.match(
    migration,
    /v_disposition <> 'accepted'[\s\S]*v_stock[.]quantity - v_exact_held < v_quantity/,
  );
  assert.match(
    migration,
    /payload \|\| pg_catalog[.]jsonb_build_object\('id', v_matrix_id\)/,
  );
  assert.match(
    migration,
    /A separate DOA checker must activate the matrix/,
  );
});

test("receipt quality validates exact PO-line identity before exception state", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260816231000_enforce_quality_receipt_line_identity_precedence.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const identityGuard = migration.indexOf(
    "Procurement PO line does not belong to the receipt",
  );
  const exceptionGuard = migration.indexOf(
    "Active controlled receipt exception must be finalized",
  );
  assert.ok(identityGuard > 0);
  assert.ok(exceptionGuard > identityGuard);
  assert.match(
    migration,
    /receipt PO-line identity validation before controlled exception state/,
  );
});

test("procurement draft certification trusts route, heading, and persisted readback", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /checkpoint[.]matched === 1/);
  assert.doesNotMatch(
    source,
    /\/Purchase request\|Line items\|Activity\|Business justification\/i[.]test/,
  );
});

test("DOA revision loading follows business order and the schema restores its audit timestamp", async () => {
  const [page, migration] = await Promise.all([
    readFile(
      new URL("../../apps/shell/app/admin/doa/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../supabase/migrations/20260810142147_restore_doa_assignment_audit_timestamp.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(
    page,
    /from\("doa_assignments"\)[\s\S]{0,300}order\("created_at"\)/,
  );
  assert.match(page, /TIERS\.indexOf\(left\.tier as Tier\)/);
  assert.match(page, /String\(left\.category \?\? ""\)\.localeCompare/);
  assert.match(page, /Number\(left\.min_amount \?\? 0\)/);
  assert.match(migration, /add column if not exists created_at timestamptz/);
  assert.match(migration, /coalesce\(matrix\.created_at, now\(\)\)/);
  assert.match(migration, /alter column created_at set default now\(\)/);
  assert.match(migration, /alter column created_at set not null/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
});

test("already-versioned Warehouse databases restore governed receive_stock", async () => {
  const source = await readFile(
    new URL(
      "../../supabase/migrations/20260718190000_restore_governed_receive_stock.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /core\.has_cap\('warehouse','receive_stock'\)/);
  assert.match(source, /warehouse\.authoritative_actor\(\)/);
  assert.match(source, /warehouse\.force_actor_on_object/);
  assert.match(source, /warehouse\.force_actor_on_array/);
  assert.match(source, /\{receipt,created_at\}/);
  assert.match(source, /\{receipt,quality_status\}/);
  assert.match(source, /set search_path = ''/);
  assert.doesNotMatch(source, /warehouse\.has_cap\(/);
});

test("Warehouse actor helpers converge before trusting receipt audit identity", async () => {
  const source = await readFile(
    new URL(
      "../../supabase/migrations/20260718191000_restore_warehouse_actor_helpers.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /create or replace function warehouse\.authoritative_actor/,
  );
  assert.match(source, /core\.profiles/);
  assert.match(
    source,
    /create or replace function warehouse\.force_actor_on_array/,
  );
  assert.match(
    source,
    /create or replace function warehouse\.force_actor_on_object/,
  );
  assert.match(source, /revoke all on function warehouse\.authoritative_actor/);
});

test("policy exceptions and raw receipts retain authoritative audit metadata", async () => {
  const exceptionSource = await readFile(
    new URL(
      "../../supabase/migrations/20260718192000_restore_exception_pack_audit_timestamp.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const receiptSource = await readFile(
    new URL(
      "../../supabase/migrations/20260718193000_harden_receive_stock_server_defaults.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    exceptionSource,
    /created_at timestamptz not null default now\(\)/,
  );
  assert.match(exceptionSource, /request_id,created_at desc/);
  assert.match(receiptSource, /receipt,created_at/);
  assert.match(receiptSource, /receipt,quality_status/);
  assert.match(receiptSource, /pending/);
});

test("Warehouse evidence registration converges as an internal governed helper", async () => {
  const source = await readFile(
    new URL(
      "../../supabase/migrations/20260718194000_restore_warehouse_evidence_registration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /create or replace function warehouse\.register_evidence_docs/,
  );
  assert.match(source, /insert into core\.documents/);
  assert.match(source, /v_entity_id text/);
  assert.match(source, /v_entity_id := p_entity_id/);
  assert.match(source, /uploaded_by/);
  assert.match(source, /auth\.uid\(\)/);
  assert.match(
    source,
    /revoke all on function warehouse\.register_evidence_docs/,
  );
});

test("Warehouse evidence keeps the shared text entity identity", async () => {
  const source = await readFile(
    new URL(
      "../../supabase/migrations/20260718195000_align_evidence_document_entity_identity.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /v_entity_id uuid/);
  assert.match(source, /v_entity_id text/);
  assert.match(source, /v_entity_id := p_entity_id/);
});

test("cycle-count defaults and Warehouse RPCs converge to shared RBAC", async () => {
  const cycleSource = await readFile(
    new URL(
      "../../supabase/migrations/20260718196000_harden_cycle_count_server_defaults.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const rbacSource = await readFile(
    new URL(
      "../../supabase/migrations/20260718197000_converge_warehouse_rbac_gates.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(cycleSource, /\{created_at\}/);
  assert.match(cycleSource, /to_jsonb\(now\(\)\)/);
  assert.match(rbacSource, /function\.proname<>'has_cap'/);
  assert.match(rbacSource, /core\.has_cap\(''warehouse''/);
  assert.match(rbacSource, /regexp_replace/);
});

test("manual stock governance converges its exception type and approval boundary", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260718198000_converge_stock_change_governance.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const identityMigration = await readFile(
    new URL(
      "../../supabase/migrations/20260718199000_align_stock_approval_entity_identity.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const harness = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(migration, /'stock_variance'/);
  assert.match(
    migration,
    /function warehouse\.decide_stock_change\(payload jsonb\)[\s\S]*?security definer/i,
  );
  assert.match(
    migration,
    /revoke all on function private\.warehouse_decide_stock_change\(jsonb\)[\s\S]*?authenticated/,
  );
  assert.match(harness, /qualityRaceReceipt/);
  assert.match(harness, /openPersonaPageFrom/);
  assert.match(
    harness,
    /intra\.test\.operations\.associate@mwell\.com\.ph[\s\S]*?hold creation versus reservation/,
  );
  assert.match(
    harness,
    /source_id: fixture\.ids\.qualityRaceReceipt[\s\S]*?hold creation versus reservation/,
  );
  assert.doesNotMatch(harness, /Post-race clean QC failed/);
  assert.match(identityMigration, /entity_id=v_request\.id::text/);
  assert.match(identityMigration, /pg_catalog\.replace/);
});

test("quality holds serialize with reservations on the shared product lock", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260718200000_serialize_quality_holds_with_reservations.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const productLock = migration.indexOf("private.lock_warehouse_products");
  const delegatedInspection = migration.indexOf(
    "private.warehouse_inspect_quality_v2",
  );
  assert.ok(productLock >= 0, "quality wrapper acquires the product lock");
  assert.ok(delegatedInspection >= 0, "quality wrapper delegates inspection");
  assert.ok(
    productLock < delegatedInspection,
    "the product lock is acquired before the quality mutation",
  );
  assert.match(migration, /array\[v_product_id\]/);
  assert.match(migration, /security definer/i);
});

test("availability refreshes after the product lock for every quality path", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260718201000_refresh_atp_inside_product_lock.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const productLock = migration.indexOf("private.lock_warehouse_products");
  const availabilityCheck = migration.indexOf(
    "warehouse.available_to_promise(v_product_id)",
  );
  assert.match(migration, /returns integer\s+language sql\s+volatile/i);
  assert.ok(productLock >= 0, "quality wrapper acquires the product lock");
  assert.ok(availabilityCheck >= 0, "quality wrapper checks current ATP");
  assert.ok(
    productLock < availabilityCheck,
    "availability is refreshed only after the product lock is held",
  );
  assert.match(migration, /v_disposition<>'accepted'/);
});

test("the issue RPC blocks every exact source identity carrying an active hold", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260718202000_block_issue_from_held_stock_identity.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const productLock = migration.indexOf("private.lock_warehouse_products");
  const holdCheck = migration.indexOf("from warehouse.inventory_holds");
  const delegate = migration.lastIndexOf("private.warehouse_issue_v1(payload)");
  assert.match(migration, /set schema private/i);
  assert.match(migration, /rename to warehouse_issue_v1/i);
  assert.ok(productLock >= 0, "issue wrapper acquires the product lock");
  assert.ok(holdCheck > productLock, "exact holds are checked inside the lock");
  assert.ok(delegate > holdCheck, "the issue mutation follows the hold check");
  assert.match(migration, /active_hold\.location_id=v_delta->>'location_id'/);
  assert.match(migration, /Held exact lot stock cannot be issued/);
  assert.match(migration, /from public, anon;/);
});

test("department-only amendment approvers can reach their narrowly scoped queue", async () => {
  const app = await readFile(
    new URL(
      "../../modules/procurement/src/ProcurementApp.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const page = await readFile(
    new URL(
      "../../modules/procurement/src/pages/PurchaseOrdersPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(app, /amendmentQueueDeepLink/);
  assert.match(app, /amendmentOnly[\s\S]*?<PurchaseOrdersPage/);
  assert.match(page, /hasAssignedAmendmentWork/);
  assert.match(page, /Loading assigned amendment work/);
});

test("the issue client excludes exact holds and can select another valid source", async () => {
  const [source, behaviorTests] = await Promise.all([
    readFile(
      new URL(
        "../../packages/data-kit/src/supabase/SupabaseRepository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../packages/data-kit/src/supabase/SupabaseRepository.test.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(
    source,
    /from\(["']inventory_holds["']\)[\s\S]*?eq\(["']status["'],\s*["']active["']\)/,
  );
  assert.match(source, /isHeldSerializedUnit/);
  assert.match(source, /unheldBulkQuantity/);
  assert.match(
    source,
    /locationIds\.find\(\s*\(locationId\) => availableAt\(locationId\) >= allocation\.quantity,?\s*\)/,
  );
  assert.match(
    behaviorTests,
    /avoids exact held stock and selects another unheld source location/,
  );
});

test("procurement readiness distinguishes missing records from retired seed owners", async () => {
  const procurementReadiness = await readFile(
    new URL(
      "../../supabase/migrations/20260806101500_repair_commitment_readiness_ownership.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(procurementReadiness, /v_request_found := found/);
  assert.match(procurementReadiness, /if not v_request_found then/);
  assert.match(procurementReadiness, /requester_id is null/);
  assert.match(
    procurementReadiness,
    /v_requester_id is null and not v_has_control_access/,
  );
  assert.match(
    procurementReadiness,
    /coalesce\(auth\.uid\(\) = v_requester_id, false\)/,
  );
});
