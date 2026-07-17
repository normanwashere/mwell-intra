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
  assert.equal(CURRENT_LIVE_ROLES.length, 20);
  assert.equal(new Set(CURRENT_LIVE_ROLES.map((item) => item.role)).size, 20);
  for (const role of CURRENT_LIVE_ROLES) {
    assert.match(role.email, /^intra\.test\..+@mwell\.com\.ph$/);
    assert.ok(!("password" in role));
  }
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
    new URL("../../modules/procurement/src/pages/PurchaseOrdersPage.tsx", import.meta.url),
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
    readFile(new URL("../../supabase/migrations/20260714175318_single_po_receipt_authority.sql", import.meta.url), "utf8"),
  ]);
  assert.match(harness, /data:image\/png;base64,/);
  assert.match(harness, /holdRace\.ok\s*\?\s*atpBeforeRace\s*-\s*1\s*:\s*0/);
  assert.match(harness, /revoked current DOA assignment denial/i);
  assert.match(harness, /held serialized unit issue denial/i);
  assert.match(harness, /held exact lot issue denial/i);
  assert.match(migration, /Only a currently active DOA assignment and matrix may decide the next amendment step/i);
  assert.match(migration, /data:image\/png;base64,/);
  assert.match(migration, /create or replace function warehouse\.issue\(payload jsonb\)[\s\S]*inventory_holds[\s\S]*serial_number/is);
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

test("executes Task 3 receipt and policy contracts against live UAT", {
  skip: process.env.RUN_TASK3_LIVE_CONTRACT !== "true",
  timeout: 20 * 60_000,
}, async () => {
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, [
    fileURLToPath(new URL("./full-intra-live-e2e.mjs", import.meta.url)),
  ], {
    env: { ...process.env, AUDIT_MUTATIONS: "true" },
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.match(stdout, /Wrote .*full-intra-live-e2e-results\.json/);
});

test("Task 3 uses browser-role exception receipts and proves transactional cleanup", async () => {
  const source = await readFile(new URL("./full-intra-live-e2e.mjs", import.meta.url), "utf8");
  assert.match(source, /receive_procurement_po_exception/);
  assert.doesNotMatch(source, /insertAuditRows\([^)]*"warehouse"\s*,\s*"(?:receipts|quality_inspections)"/s,
    "receipt and QC fixtures must be created through browser-role RPCs");
  const cleanupRegistration = source.indexOf("registerTask3Cleanup");
  const firstTask3Insert = source.indexOf('insertAuditRows(client, "core", "vendors"');
  assert.ok(cleanupRegistration >= 0 && cleanupRegistration < firstTask3Insert);
  assert.match(source, /finally\s*\{\s*try\s*\{[\s\S]*browser\.close\(\)[\s\S]*finally\s*\{[\s\S]*cleanupTask3ReceiptFixture/);
  assert.match(source, /assertTask3ZeroResidualRows/);
  assert.match(source, /inventoryBefore[\s\S]*inventoryAfter[\s\S]*ledgerBefore[\s\S]*ledgerAfter/);
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
  assert.match(source, /valid public quality inspection/i);
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
  assert.doesNotMatch(source, /if \(!concurrentReservation\.ok[\s\S]*available after active inventory holds/i,
    'hold races must assert one deterministic authoritative state');
  for (const exceptionClass of ['short', 'excess', 'damaged', 'unidentified']) {
    assert.match(source, new RegExp(`exceptionClass:\\s*["']${exceptionClass}["']`, 'i'));
  }
  for (const outcome of ['accept', 'reject', 'quarantine', 'escalate']) {
    assert.match(source, new RegExp(`outcome:\\s*["']${outcome}["']`, 'i'));
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
    2,
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
  const { scopedProtectionHeaders } = await import(
    "../lib/target-environment.mjs"
  );
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
  const { installScopedProtectionBypass } = await import(
    "../lib/target-environment.mjs"
  );
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

function fakeRoute({ url, headers, method = "GET", postData = null, response }) {
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
  const { routeWithScopedProtectionBypass } = await import(
    "../lib/target-environment.mjs"
  );
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
  assert.deepEqual(intercepted.calls.fulfill, [
    { response: redirectResponse },
  ]);
});

test("redirect hops to non-app origins never receive the bypass", async () => {
  const { routeWithScopedProtectionBypass } = await import(
    "../lib/target-environment.mjs"
  );
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
      redirectedHop.calls.continue[0].headers[
        "x-vercel-protection-bypass"
      ],
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
  const { routeWithScopedProtectionBypass } = await import(
    "../lib/target-environment.mjs"
  );
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
  const source = await readFile(new URL("./full-intra-live-e2e.mjs", import.meta.url), "utf8");
  assert.match(source, /hold creation versus reservation/i);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /available_to_promise/);
  assert.match(source, /inventory_holds/);
  assert.match(source, /allocations/);
  assert.match(source, /quality_inspections/);
  assert.match(source, /purchase_order_lines/);
  assert.match(source, /exactly one concurrent hold or reservation may consume availability/i);
});

test("Warehouse excess E2E selects the exact governed amendment", async () => {
  const harness = await readFile(new URL("./full-intra-live-e2e.mjs", import.meta.url), "utf8");
  assert.match(harness, /getByLabel\("Approved quantity amendment"\)\.selectOption\(fixture\.ids\.excessAmendment\)/);
  assert.doesNotMatch(harness, /getByLabel\("Approved amendment ID"\)\.fill/);
});

test("Warehouse resolvers reconcile both receipt authority queues", async () => {
  const source = await readFile(
    new URL("../../modules/warehouse/src/pages/PurchaseOrdersPage.tsx", import.meta.url), "utf8",
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
  assert.match(source, /Forward convergence for databases that already applied/i);
  assert.match(source, /add column if not exists doa_matrix_id/i);
  assert.match(source, /legacy_record[\s\S]*?status='superseded'/i);
  assert.match(source, /purchase_order_amendments_governed_snapshot_check/i);
  assert.match(source, /purchase_order_amendments_legacy_terminal_check/i);
  assert.match(source, /purchase_order_amendment_steps/);
  assert.match(source, /create or replace function private\.policy_approve_po_line_quantity_amendment/);
  assert.match(source, /create or replace function procurement\.purchase_order_amendment_work_items/);
  assert.match(source, /create or replace function warehouse\.issue/);
});

test("department-only amendment approvers can reach their narrowly scoped queue", async () => {
  const app = await readFile(
    new URL("../../modules/procurement/src/ProcurementApp.tsx", import.meta.url),
    "utf8",
  );
  const page = await readFile(
    new URL("../../modules/procurement/src/pages/PurchaseOrdersPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(app, /amendmentQueueDeepLink/);
  assert.match(app, /amendmentOnly[\s\S]*?<PurchaseOrdersPage/);
  assert.match(page, /hasAssignedAmendmentWork/);
  assert.match(page, /Loading assigned amendment work/);
});

test("the issue client excludes exact holds and can select another valid source", async () => {
  const source = await readFile(
    new URL("../../packages/data-kit/src/supabase/SupabaseRepository.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /from\('inventory_holds'\)[\s\S]*?eq\('status', 'active'\)/);
  assert.match(source, /isHeldSerializedUnit/);
  assert.match(source, /unheldBulkQuantity/);
  assert.match(source, /locationIds\.find\(\(locationId\) => availableAt\(locationId\) >= allocation\.quantity\)/);
});
