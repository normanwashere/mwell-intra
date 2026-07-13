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
