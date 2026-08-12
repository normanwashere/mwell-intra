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
      "defaultPrivileges",
      "functionPrivileges",
      "functions",
      "governedTableOwners",
      "policies",
      "privilegedFunctions",
      "privilegedViews",
      "roles",
      "schemaPrivileges",
      "schemas",
      "tablePrivileges",
      "tables",
      "triggers",
    ]);
  } finally {
    await database.close();
  }
});

test("catalog queries expose ACL state and transitive service-role escalation", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create role anon nologin noinherit;
      create role authenticated nologin noinherit;
      create role service_role nologin noinherit bypassrls;
      create role learning_bridge nologin noinherit;
      create role learning_superuser nologin noinherit superuser;
      grant learning_superuser to learning_bridge;
      grant learning_bridge to service_role;
      create schema core;
      create schema private;
      create schema learning;
      grant usage on schema core, private, learning to authenticated, service_role;
      alter default privileges in schema core grant select on tables to authenticated;
    `);
    const snapshot = await catalogModule.loadLearningCatalogSnapshot(database);
    assert.deepEqual(snapshot.schemas, [
      { schema: "core", owner: "postgres" },
      { schema: "learning", owner: "postgres" },
      { schema: "private", owner: "postgres" },
    ]);
    assert.ok(
      snapshot.schemaPrivileges.some(
        (entry) =>
          entry.schema === "learning" &&
          entry.grantee === "authenticated" &&
          entry.privilege === "USAGE",
      ),
    );
    assert.ok(
      snapshot.defaultPrivileges.some(
        (entry) =>
          entry.schema === "core" &&
          entry.grantee === "authenticated" &&
          entry.privilege === "SELECT",
      ),
    );
    assert.ok(
      snapshot.dangerousMemberships.some(
        (entry) =>
          entry.member === "service_role" &&
          entry.target === "learning_superuser" &&
          entry.depth === 2 &&
          entry.targetSuperuser,
      ),
    );
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
  const trigger = expectedSnapshot().triggers[0];
  assert.equal(trigger.predicate, null);
  assert.deepEqual(trigger.arguments, []);
  assert.equal(trigger.argumentCount, 0);
  assert.equal(trigger.oldTransitionTable, null);
  assert.equal(trigger.newTransitionTable, null);
  expectDrift((snapshot) => {
    snapshot.triggers[0].predicate = "false";
  }, /trigger/i);
  expectDrift((snapshot) => {
    snapshot.triggers[0].arguments = ["inert"];
  }, /trigger/i);
  expectDrift((snapshot) => {
    snapshot.triggers[0].argumentCount = 1;
  }, /trigger/i);
  expectDrift((snapshot) => {
    snapshot.triggers[0].oldTransitionTable = "old_rows";
  }, /trigger/i);
  expectDrift((snapshot) => {
    snapshot.triggers[0].newTransitionTable = "new_rows";
  }, /trigger/i);
});

test("policy USING and WITH CHECK expressions are exact", () => {
  const readablePolicy = expectedSnapshot().policies.find(
    (policy) => typeof policy.qual === "string" && policy.qual.length > 0,
  );
  assert.ok(readablePolicy, "expected at least one policy with USING");
  expectDrift((snapshot) => {
    const policy = snapshot.policies.find(
      (candidate) => candidate.name === readablePolicy.name,
    );
    policy.qual = `(${policy.qual}) OR true`;
  }, /policy/i);

  const writablePolicy = expectedSnapshot().policies.find(
    (policy) =>
      typeof policy.withCheck === "string" && policy.withCheck.length > 0,
  );
  assert.ok(writablePolicy, "expected at least one policy with WITH CHECK");
  expectDrift((snapshot) => {
    const policy = snapshot.policies.find(
      (candidate) => candidate.name === writablePolicy.name,
    );
    policy.withCheck = `(${policy.withCheck}) OR true`;
  }, /policy/i);
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
  expectDrift((snapshot) => {
    snapshot.roles.find((role) => role.name === "service_role").bypassRls =
      false;
  }, /role attribute/i);
  expectDrift((snapshot) => {
    snapshot.roles.find((role) => role.name === "authenticated").createRole =
      true;
  }, /role attribute/i);
  expectDrift(
    (snapshot) =>
      snapshot.dangerousMemberships.push({
        member: "service_role",
        target: "postgres",
        depth: 1,
        adminOption: false,
        inheritOption: true,
        setOption: true,
        targetSuperuser: true,
        targetBypassRls: true,
        targetReplication: true,
      }),
    /membership/i,
  );
});

test("schema ownership, schema ACLs, table owners, and default ACLs are exact", () => {
  const expected = expectedSnapshot();
  assert.deepEqual(
    expected.schemas.map((schema) => schema.schema),
    ["core", "learning", "private"],
  );
  assert.ok(expected.schemaPrivileges.length > 0);
  assert.ok(expected.governedTableOwners.length > 0);
  assert.ok(expected.defaultPrivileges.length > 0);

  expectDrift((snapshot) => {
    snapshot.schemas.find((schema) => schema.schema === "learning").owner =
      "service_role";
  }, /schema ownership/i);
  expectDrift(
    (snapshot) =>
      snapshot.schemaPrivileges.push({
        schema: "learning",
        grantee: "authenticated",
        privilege: "CREATE",
        grantable: false,
      }),
    /schema privilege/i,
  );
  expectDrift((snapshot) => {
    snapshot.governedTableOwners[0].owner = "service_role";
  }, /table owner/i);
  expectDrift(
    (snapshot) =>
      snapshot.defaultPrivileges.push({
        owner: "postgres",
        schema: "learning",
        objectType: "TABLE",
        grantee: "authenticated",
        privilege: "INSERT",
        grantable: false,
      }),
    /default privilege/i,
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
