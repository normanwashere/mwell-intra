import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

let catalogModule = {};
try {
  catalogModule = await import("./verify-learning-catalog.mjs");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

test("catalog verifier exposes an applied-PostgreSQL contract", () => {
  assert.equal(
    typeof catalogModule.verifyLearningCatalogSnapshot,
    "function",
    "verifyLearningCatalogSnapshot must be implemented",
  );
  assert.equal(
    typeof catalogModule.expectedLearningCatalogSnapshot,
    "function",
    "expectedLearningCatalogSnapshot must be implemented",
  );
  assert.equal(
    typeof catalogModule.assertDisposableLocalDatabaseUrl,
    "function",
    "assertDisposableLocalDatabaseUrl must be implemented",
  );
});

function expectedSnapshot() {
  return structuredClone(catalogModule.expectedLearningCatalogSnapshot());
}

function expectDrift(mutator, pattern) {
  const snapshot = expectedSnapshot();
  mutator(snapshot);
  assert.match(
    catalogModule.verifyLearningCatalogSnapshot(snapshot).join("\n"),
    pattern,
  );
}

test("local database guard accepts only the disposable Supabase PostgreSQL port", () => {
  assert.doesNotThrow(() =>
    catalogModule.assertDisposableLocalDatabaseUrl(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    ),
  );
  for (const unsafe of [
    "postgresql://postgres:postgres@db.example.com:5432/postgres",
    "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
    "postgresql://postgres:postgres@127.0.0.1:54322/production",
  ]) {
    assert.throws(
      () => catalogModule.assertDisposableLocalDatabaseUrl(unsafe),
      /disposable local Supabase database/i,
    );
  }
});

test("an exact expected catalog snapshot passes", () => {
  assert.deepEqual(
    catalogModule.verifyLearningCatalogSnapshot(expectedSnapshot()),
    [],
  );
});

test("catalog queries execute against PostgreSQL catalogs", async () => {
  const database = new PGlite();
  try {
    const snapshot = await catalogModule.loadLearningCatalogSnapshot(database);
    assert.deepEqual(Object.keys(snapshot).sort(), [
      "certificationIndexes",
      "dangerousMemberships",
      "functionPrivileges",
      "functions",
      "policies",
      "privilegedFunctions",
      "privilegedViews",
      "roles",
      "tablePrivileges",
      "tables",
      "triggers",
    ]);
  } finally {
    await database.close();
  }
});

test("complete function declaration metadata and configuration are authoritative", () => {
  expectDrift(
    (snapshot) =>
      snapshot.functions[0].config.push("session_replication_role=replica"),
    /function metadata/i,
  );
  expectDrift((snapshot) => {
    snapshot.functions[0].cost = 1;
  }, /function metadata/i);
  expectDrift((snapshot) => {
    snapshot.functions[0].support = "private.unapproved_support";
  }, /function metadata/i);
  expectDrift(
    (snapshot) => snapshot.functions[0].transformTypes.push("jsonb"),
    /function metadata/i,
  );
  expectDrift((snapshot) => {
    snapshot.functions[0].kind = "w";
  }, /function metadata/i);
});

test("unapproved privileged functions and views are rejected", () => {
  expectDrift(
    (snapshot) =>
      snapshot.privilegedFunctions.push("private.learning_backdoor()"),
    /privileged function/i,
  );
  expectDrift(
    (snapshot) => snapshot.privilegedViews.push("learning.unapproved_view"),
    /privileged view/i,
  );
});

test("RLS, policies, and trigger modes are exact", () => {
  expectDrift((snapshot) => {
    snapshot.tables[0].forceRls = false;
  }, /RLS/i);
  expectDrift((snapshot) => {
    snapshot.policies[0].command = "UPDATE";
  }, /polic/i);
  expectDrift((snapshot) => {
    snapshot.triggers[0].enabled = "D";
  }, /trigger/i);
});

test("function, table, and role privileges are exact", () => {
  expectDrift(
    (snapshot) =>
      snapshot.functionPrivileges.push({
        function: "private.assert_learning_read_committed()",
        grantee: "authenticated",
        privilege: "EXECUTE",
        grantable: false,
      }),
    /function privilege/i,
  );
  expectDrift(
    (snapshot) =>
      snapshot.tablePrivileges.push({
        table: "core.user_roles",
        grantee: "service_role",
        privilege: "TRUNCATE",
        grantable: false,
      }),
    /table privilege/i,
  );
  expectDrift((snapshot) => {
    snapshot.roles.find((role) => role.name === "authenticated").bypassRls =
      true;
  }, /role attribute/i);
  expectDrift(
    (snapshot) =>
      snapshot.dangerousMemberships.push({
        member: "authenticated",
        target: "service_role",
      }),
    /membership/i,
  );
});

test("certification indexes are an exact set", () => {
  expectDrift(
    (snapshot) => snapshot.certificationIndexes.pop(),
    /certification index/i,
  );
  expectDrift((snapshot) => {
    snapshot.certificationIndexes[0].keys = ["user_id"];
  }, /certification index/i);
});
