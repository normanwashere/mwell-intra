import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("covers Task 3 policy-negative and two-person Warehouse contracts", async () => {
  const source = await readFile(
    new URL("./full-intra-live-e2e.mjs", import.meta.url),
    "utf8",
  );
  for (const contract of [
    "expired accreditation",
    "unapproved scoped temporary clearance",
    "unsupported Direct Award",
    "split petty-cash use",
    "missing importation controls",
    "payment readiness without accepted receipt or service acceptance",
  ])
    assert.ok(source.includes(contract), contract);
  for (const workflow of [
    "procurementReceiptAuthorityWorkflow",
    "warehouseOperatorSurfaceWorkflow",
    "warehouseSupervisorControlWorkflow",
  ])
    assert.match(source, new RegExp(`async function ${workflow}\\(`));
  assert.match(source, /receive_purchase_order/);
  assert.match(source, /receive_procurement_po/);
  assert.match(source, /Procurement still exposes a receipt mutation control/);
  assert.match(source, /Warehouse Operator surface exposes an advanced or authoring workflow/);
  assert.match(source, /delegation never permits the requester/i);
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
