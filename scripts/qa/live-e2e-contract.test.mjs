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
  ];
  assert.deepEqual(
    CURRENT_LIVE_SCENARIOS.map((item) => item.id),
    expected,
  );
  for (const scenario of CURRENT_LIVE_SCENARIOS) {
    assert.ok(scenario.actors.length > 0, `${scenario.id} actors`);
    assert.ok(scenario.checkpoints.length > 0, `${scenario.id} checkpoints`);
    assert.ok(scenario.cleanup.length > 0, `${scenario.id} cleanup`);
    for (const requiredCase of [
      "authorized",
      "unauthorized",
      "validation",
      "duplicate",
      "correction",
      "refresh",
      "handoff",
    ])
      assert.ok(
        scenario.cases.includes(requiredCase),
        `${scenario.id} covers ${requiredCase}`,
      );
  }
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
    /from\("activity_log"\)[\s\S]*JSON\.stringify\(row\.detail \?\? \{\}\)\.includes\(marker\)[\s\S]*\.delete\(\)[\s\S]*\.in\("id", activityIds\)/,
  );
  assert.match(
    source,
    /cleanupGovernedWorkflowActivity\(marker\)[\s\S]*cleanupRun\(auditRunId/,
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
  assert.doesNotMatch(workflow, /service_role\s*[=:]\s*["'][^"']+/i);
});

test("cross-module scenarios are imported and executed as browser/database contracts", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /CURRENT_LIVE_SCENARIOS,/);
  for (const scenarioId of [
    "events-request-to-warehouse-handoff",
    "insights-read-only-governance",
    "unified-finance-control-center",
  ]) {
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
      new RegExp(`run:\\s*\\(page\\)[\\s\\S]{0,120}${workflow}\\(`),
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
  assert.match(source, /beforeRefresh !== afterRefresh/);
  assert.match(source, /sources\.has\("procurement_po"\)/);
  assert.match(source, /sources\.has\("warehouse_receipt"\)/);
  assert.match(source, /Unified Finance PO source link is incorrect/);
  assert.match(source, /Unified Finance receipt source link is incorrect/);
  assert.match(
    source,
    /EXECUTABLE_CROSS_MODULE_SCENARIOS[\s\S]*executable scenario \$\{scenarioId\} was not run/,
  );
});

test("route crawl enforces an exact role-to-route authorization matrix", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /const ROUTE_AUTHORIZATION_MATRIX = \[/);
  assert.match(source, /expectedAccess: allowed \? "allowed" : "denied"/);
  assert.match(source, /routeClass === expectedClass/);
  assert.match(source, /no \(\?:warehouse\|procurement[\s\S]*finance\) access/);
  assert.match(
    source,
    /for \(const route of routesFor\(user, discoveredRoutes\)\)/,
  );
  assert.match(
    source,
    /allowed: \(user\) => hasAssignedModule\(user, "events"\)/,
  );
  assert.match(
    source,
    /allowed: \(user\) => hasAssignedModule\(user, "insights"\)/,
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

test("route crawl rejects silent redirects and verifies record-specific detail content", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /finalPathMatches\(route\.path, page\.url\(\)\)/);
  assert.match(
    source,
    /route\.recordText\s*\?\s*route\.recordText\.test\(audit\.text\)/,
  );
  assert.match(
    source,
    /path: "\/procurement\/requests\/req_seed_001"[\s\S]*recordText: \/Emergency aircon repair/,
  );
  assert.match(
    source,
    /path: "\/legal\/cases\/case_seed_001"[\s\S]*recordText: \/Acme Medical Supplies/,
  );
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
  assert.match(source, /const target = new URL\(href, location\.origin\)/);
  assert.match(source, /target\.origin !== location\.origin/);
  assert.match(source, /routesFor\(user, discoveredRoutes\)/);
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
  assert.match(source, /delivery_failed/);
  assert.match(source, /table: "vendor_invites"/);
  assert.match(source, /filters: \{ company_name: companyName \}/);
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
    /Task 3 Finance insufficient locked-stock denial[\s\S]*intra\.test\.finance@mwell\.com\.ph/,
  );
  assert.match(
    source,
    /Finance insufficient locked stock-change approval[\s\S]*expected: \{ status: "pending_finance" \}/,
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
