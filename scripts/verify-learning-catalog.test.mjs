import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import {
  ALLOWED_FUNCTION_EXECUTE,
  readRepositoryMigrations,
  scanSql,
} from "./verify-learning-schema.mjs";

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

// Authority (Aug 12), vendor assignments and completion bases (Aug 16),
// then query-plan reuse (Sep 11) and vendor certification scope (Sep 12).
const FORWARD_FUNCTIONS = [
  ["learning.is_certification_required(text, text)", "plpgsql", "s", "boolean"],
  [
    "learning.has_active_certification(uuid, text, text)",
    "plpgsql",
    "s",
    "boolean",
  ],
  [
    "learning.has_active_emergency_exception(uuid, text, text)",
    "plpgsql",
    "s",
    "boolean",
  ],
  ["core.has_live_cap(text, text)", "sql", "s", "boolean"],
  ["core.my_role_capabilities()", "sql", "s", "jsonb"],
  ["core.my_capabilities()", "sql", "s", "jsonb"],
  ["core.my_capability_snapshot()", "sql", "s", "jsonb"],
  [
    "private.cancel_ineffective_learning_role_assignments()",
    "plpgsql",
    "v",
    "integer",
  ],
  ["private.resolve_vendor_learning_assignments()", "plpgsql", "v", "jsonb"],
  ["learning.my_learning_snapshot_base()", "plpgsql", "s", "jsonb"],
  ["learning.sync_equivalent_role_practices()", "plpgsql", "v", "jsonb"],
  ["learning.sync_exact_completions()", "plpgsql", "v", "jsonb"],
];

for (const [signature, language, volatility, result] of FORWARD_FUNCTIONS) {
  test(`forward function contract is explicit: ${signature}`, () => {
    const snapshot = expectedSnapshot();
    const metadata = snapshot.functions.find(
      (entry) => entry.function === signature,
    );
    assert.ok(metadata, signature);
    assert.equal(metadata.language, language);
    assert.equal(metadata.volatility, volatility);
    assert.equal(metadata.result, result);
    assert.equal(metadata.owner, "postgres");
    assert.equal(metadata.securityDefiner, true);
    assert.deepEqual(metadata.config, ['search_path=""']);
    assert.ok(snapshot.privilegedFunctions.includes(signature));
    const name = signature.slice(0, signature.indexOf("("));
    assert.deepEqual(
      snapshot.functionPrivileges
        .filter((entry) => entry.function === signature)
        .map((entry) => entry.grantee)
        .sort(),
      [...(ALLOWED_FUNCTION_EXECUTE[name] ?? [])].sort(),
    );
  });

  test(`forward function metadata, inventory and ACL drift fail: ${signature}`, () => {
    for (const [field, value] of [
      ["owner", "service_role"],
      ["securityDefiner", false],
      ["language", "c"],
      ["config", ["search_path=public"]],
    ]) {
      expectDrift((snapshot) => {
        const metadata = snapshot.functions.find(
          (entry) => entry.function === signature,
        );
        assert.ok(metadata, signature);
        metadata[field] = value;
      }, /function metadata/i);
    }
    expectDrift((snapshot) => {
      snapshot.privilegedFunctions = snapshot.privilegedFunctions.filter(
        (entry) => entry !== signature,
      );
    }, /privileged function/i);
    expectDrift(
      (snapshot) =>
        snapshot.functionPrivileges.push({
          function: signature,
          grantee: "PUBLIC",
          privilege: "EXECUTE",
          grantable: false,
        }),
      /function privilege/i,
    );
    const grants = expectedSnapshot().functionPrivileges.filter(
      (entry) => entry.function === signature,
    );
    if (grants.length) {
      expectDrift((snapshot) => {
        snapshot.functionPrivileges = snapshot.functionPrivileges.filter(
          (entry) => entry.function !== signature,
        );
      }, /function privilege/i);
      expectDrift((snapshot) => {
        snapshot.functionPrivileges.find(
          (entry) => entry.function === signature,
        ).grantable = true;
      }, /function privilege/i);
    } else {
      for (const grantee of ["anon", "authenticated", "service_role"]) {
        expectDrift(
          (snapshot) =>
            snapshot.functionPrivileges.push({
              function: signature,
              grantee,
              privilege: "EXECUTE",
              grantable: false,
            }),
          /function privilege/i,
        );
      }
    }
  });
}

test("all execute expectations have explicit modeled signatures", () => {
  const snapshot = expectedSnapshot();
  for (const entry of snapshot.functionPrivileges) {
    assert.equal(typeof entry.function, "string");
    assert.ok(snapshot.functions.some((fn) => fn.function === entry.function));
  }
});

test("catalog comparison ignores object insertion order, not values or array order", () => {
  const reversed = JSON.parse(JSON.stringify(expectedSnapshot()), (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse())
      : value,
  );
  assert.deepEqual(catalogModule.verifyLearningCatalogSnapshot(reversed), []);
  reversed.functions[0].owner = "service_role";
  assert.match(
    catalogModule.verifyLearningCatalogSnapshot(reversed).join("\n"),
    /function metadata/i,
  );
});

test("forward authority ACLs retain service-only and read-only boundaries", () => {
  const snapshot = expectedSnapshot();
  const admin = "private.learning_is_active_employee_platform_admin()";
  assert.deepEqual(
    snapshot.functionPrivileges
      .filter((row) => row.function === admin)
      .map((row) => row.grantee),
    ["service_role"],
  );
  assert.deepEqual(
    snapshot.tablePrivileges.filter(
      (row) => row.table === "learning.mutation_capability_rules",
    ),
    [
      {
        table: "learning.mutation_capability_rules",
        grantee: "service_role",
        privilege: "SELECT",
        grantable: false,
      },
    ],
  );
  for (const table of ["core.roles", "core.role_capabilities"]) {
    assert.deepEqual(
      snapshot.tablePrivileges.filter(
        (row) => row.table === table && row.grantee === "authenticated",
      ),
      [
        {
          table,
          grantee: "authenticated",
          privilege: "SELECT",
          grantable: false,
        },
      ],
    );
    for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expectDrift(
        (changed) =>
          changed.tablePrivileges.push({
            table,
            grantee: "authenticated",
            privilege,
            grantable: false,
          }),
        /table privilege/i,
      );
    }
    expectDrift((changed) => {
      changed.tablePrivileges = changed.tablePrivileges.filter(
        (row) => !(row.table === table && row.grantee === "authenticated"),
      );
    }, /table privilege/i);
  }
  for (const grantee of ["PUBLIC", "anon", "authenticated"]) {
    expectDrift(
      (changed) =>
        changed.functionPrivileges.push({
          function: admin,
          grantee,
          privilege: "EXECUTE",
          grantable: false,
        }),
      /function privilege/i,
    );
    expectDrift(
      (changed) =>
        changed.tablePrivileges.push({
          table: "learning.mutation_capability_rules",
          grantee,
          privilege: "SELECT",
          grantable: false,
        }),
      /table privilege/i,
    );
  }
  expectDrift(
    (changed) =>
      changed.tablePrivileges.push({
        table: "learning.mutation_capability_rules",
        grantee: "service_role",
        privilege: "UPDATE",
        grantable: false,
      }),
    /table privilege/i,
  );
});

test("catalog discovers modeled definers even without a direct learning reference", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create schema private; create schema core; create schema learning;
      create function private.lock_certification_role_authority() returns trigger
        language plpgsql security definer set search_path = '' as $$begin return new; end$$;
      create function private.validate_emergency_exception_issuance() returns trigger
        language plpgsql security definer set search_path = '' as $$begin return new; end$$;
      create function core.my_capabilities() returns jsonb
        language sql stable security definer set search_path = '' as $$select '{}'::jsonb$$;
      create function private.unreviewed_learning_helper() returns boolean
        language sql security definer as $$select true$$;
    `);
    let snapshot = await catalogModule.loadLearningCatalogSnapshot(database);
    for (const signature of [
      "private.lock_certification_role_authority()",
      "private.validate_emergency_exception_issuance()",
      "core.my_capabilities()",
    ]) {
      assert.ok(snapshot.privilegedFunctions.includes(signature), signature);
    }
    assert.ok(
      snapshot.privilegedFunctions.includes(
        "private.unreviewed_learning_helper()",
      ),
    );
    await database.exec(
      "alter function private.lock_certification_role_authority() security invoker",
    );
    snapshot = await catalogModule.loadLearningCatalogSnapshot(database);
    assert.equal(
      snapshot.privilegedFunctions.includes(
        "private.lock_certification_role_authority()",
      ),
      false,
    );
    assert.equal(
      snapshot.functions.find(
        (row) => row.function === "private.lock_certification_role_authority()",
      ).securityDefiner,
      false,
    );
    assert.match(
      catalogModule.verifyLearningCatalogSnapshot(snapshot).join("\n"),
      /function metadata.*|privileged function/is,
    );
  } finally {
    await database.close();
  }
});

test("trigger column arrays use PostgreSQL text[] and retain exact column names", async () => {
  const database = new PGlite();
  const queries = [];
  try {
    await database.exec(`
      create schema learning;
      create table learning.column_fixture(id uuid, module text, role text, user_id uuid);
      create function learning.column_guard() returns trigger language plpgsql as $$begin return new; end$$;
      create trigger all_columns before update on learning.column_fixture for each row execute function learning.column_guard();
      create trigger identity_columns before update of id, module, role, user_id on learning.column_fixture for each row execute function learning.column_guard();
    `);
    const snapshot = await catalogModule.loadLearningCatalogSnapshot({
      query(sql, values) {
        queries.push(sql);
        return database.query(sql, values);
      },
    });
    assert.match(
      queries.find((sql) => sql.includes("t.tgname as name")),
      /array_agg\(attribute\.attname::text order by attribute\.attname\)/,
    );
    assert.deepEqual(
      snapshot.triggers.find((row) => row.name === "all_columns").updateColumns,
      [],
    );
    assert.deepEqual(
      snapshot.triggers.find((row) => row.name === "identity_columns")
        .updateColumns,
      ["id", "module", "role", "user_id"],
    );
    for (const columns of [
      [],
      ["id"],
      ["id", "module", "role", "other_id"],
      "{id,module,role,user_id}",
    ]) {
      expectDrift((changed) => {
        const trigger = changed.triggers.find(
          (row) => row.updateColumns.length > 0,
        );
        assert.ok(trigger);
        trigger.updateColumns = columns;
      }, /trigger/i);
    }
  } finally {
    await database.close();
  }
});

test("reviewed forward SQL produces every modeled declaration and execute ACL", async () => {
  const database = new PGlite();
  const expected = expectedSnapshot();
  const names = new Set(
    expected.functions.map((row) => row.function.split("(")[0]),
  );
  names.add("learning.resolve_assignments_base");
  names.add("learning.start_requirement_base");
  const migrations = readRepositoryMigrations();
  try {
    // Declaration/ACL fixture only: no application functions are called and no
    // authority behavior is inferred from disabled function-body validation.
    await database.exec(`
      create role anon nologin noinherit;
      create role authenticated nologin noinherit;
      create role service_role nologin noinherit bypassrls;
      create schema core; create schema private; create schema learning;
      set check_function_bodies = off;
      create table core.capabilities(module text, cap text, primary key(module, cap));
      insert into core.capabilities(module, cap) values ('core', 'manage_rbac');
      create table core.activity_log(module text, entity_type text, entity_id text, action text, actor uuid, detail jsonb);
    `);
    for (const migration of migrations) {
      for (const statement of scanSql(migration.sql)) {
        const name = statement.match(
          /^(?:create(?: or replace)? function|alter function|(?:grant|revoke)\s+[\s\S]*?\s+on function)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(/i,
        )?.[1];
        if (name && names.has(name)) await database.exec(statement);
        if (
          migration.name === "20260812200000_learning_authority.sql" &&
          /^(?:create table|alter table|revoke all on table|grant select on table) learning\.mutation_capability_rules\b/i.test(
            statement,
          )
        ) {
          await database.exec(statement);
        }
        if (
          migration.name ===
            "20260816090000_security_database_launch_blocker_convergence.sql" &&
          /^do \$converge\$/i.test(statement) &&
          statement.includes("capability_pattern constant text")
        ) {
          await database.exec(
            "insert into learning.mutation_capability_rules(module, capability) values ('core', 'manage_rbac')",
          );
          await database.exec(statement);
        }
        if (
          migration.name ===
            "20260911171901_learning_authority_plan_reuse.sql" &&
          /^do \$plans\$/i.test(statement)
        ) {
          await database.exec(statement);
        }
      }
    }
    const actual = await catalogModule.loadLearningCatalogSnapshot(database);
    assert.deepEqual(actual.functions, expected.functions);
    assert.deepEqual(actual.privilegedFunctions, expected.privilegedFunctions);
    assert.deepEqual(actual.functionPrivileges, expected.functionPrivileges);
    assert.deepEqual(
      actual.tablePrivileges.filter(
        (row) => row.table === "learning.mutation_capability_rules",
      ),
      expected.tablePrivileges.filter(
        (row) => row.table === "learning.mutation_capability_rules",
      ),
    );
    // This SELECT comes from the canonical cutover, not the excluded MVP ACLs.
    await database.exec(
      "create table core.roles(id integer); create table core.role_capabilities(id integer); create table core.user_roles(id integer)",
    );
    const cutover = readFileSync(
      new URL(
        "./qa/fixtures/canonical-uat-baseline/20260717175559_baseline_live_intra_cutover_without_operational_fixtures.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const grant = scanSql(cutover).find((statement) =>
      /^grant select on all tables in schema core to anon, authenticated$/i.test(
        statement,
      ),
    );
    assert.ok(grant);
    await database.exec(grant);
    const hardened = await catalogModule.loadLearningCatalogSnapshot(database);
    assert.deepEqual(
      hardened.tablePrivileges.filter(
        (row) =>
          row.table.startsWith("core.") && row.grantee === "authenticated",
      ),
      expected.tablePrivileges.filter(
        (row) =>
          row.table.startsWith("core.") && row.grantee === "authenticated",
      ),
    );
  } finally {
    await database.close();
  }
});

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

test("catalog models the exact Task 3 RPC owners and execute grants", () => {
  const snapshot = expectedSnapshot();
  const expectedFunctions = [
    "learning.acknowledge_policy(jsonb)",
    "learning.evaluate_certifications()",
    "learning.my_learning_snapshot()",
    "learning.record_simulation_checkpoint(jsonb)",
    "learning.request_support(jsonb)",
    "learning.resolve_assignments()",
    "learning.start_requirement(jsonb)",
    "learning.submit_assessment(jsonb)",
    "learning.sync_shared_completions()",
  ];
  const functions = snapshot.functions
    .filter((entry) => entry.function.startsWith("learning."))
    .map((entry) => entry.function)
    .filter((name) => expectedFunctions.includes(name))
    .sort();
  assert.deepEqual(functions, expectedFunctions);
  for (const functionName of expectedFunctions) {
    const metadata = snapshot.functions.find(
      (entry) => entry.function === functionName,
    );
    assert.equal(metadata.owner, "postgres", functionName);
    assert.equal(metadata.securityDefiner, true, functionName);
    assert.deepEqual(metadata.config, ['search_path=""'], functionName);
    assert.deepEqual(
      snapshot.functionPrivileges
        .filter((entry) => entry.function === functionName)
        .map((entry) => entry.grantee)
        .sort(),
      ["authenticated", "service_role"],
      functionName,
    );
  }
});

test("catalog keeps transition bases private and installs evidence validation", () => {
  const snapshot = expectedSnapshot();
  const privateFunctions = [
    "private.resolve_assignments_base()",
    "private.start_requirement_base(jsonb)",
    "private.validate_certification_completion_evidence()",
  ];
  for (const functionName of privateFunctions) {
    const metadata = snapshot.functions.find(
      (entry) => entry.function === functionName,
    );
    assert.equal(metadata?.owner, "postgres", functionName);
    assert.equal(metadata?.securityDefiner, true, functionName);
    assert.deepEqual(metadata?.config, ['search_path=""'], functionName);
    assert.deepEqual(
      snapshot.functionPrivileges.filter(
        (entry) => entry.function === functionName,
      ),
      [],
      functionName,
    );
  }

  assert.ok(
    snapshot.triggers.some(
      (trigger) =>
        trigger.name === "learning_certifications_completion_evidence" &&
        trigger.table === "learning.certifications" &&
        trigger.function ===
          "private.validate_certification_completion_evidence" &&
        trigger.timing === "BEFORE" &&
        trigger.events.join(",") === "INSERT",
    ),
  );
});

test("catalog models the private answer-key table as forced-RLS service authority", () => {
  const snapshot = expectedSnapshot();
  assert.deepEqual(
    snapshot.tables.find(
      (entry) => entry.table === "private.learning_assessment_answer_keys",
    ),
    {
      table: "private.learning_assessment_answer_keys",
      rls: true,
      forceRls: true,
    },
  );
  assert.deepEqual(
    snapshot.governedTableOwners.find(
      (entry) => entry.table === "private.learning_assessment_answer_keys",
    ),
    {
      table: "private.learning_assessment_answer_keys",
      owner: "postgres",
    },
  );
  assert.deepEqual(
    snapshot.tablePrivileges
      .filter(
        (entry) => entry.table === "private.learning_assessment_answer_keys",
      )
      .map((entry) => `${entry.grantee}:${entry.privilege}`)
      .sort(),
    [
      "service_role:DELETE",
      "service_role:INSERT",
      "service_role:SELECT",
      "service_role:UPDATE",
    ],
  );
  assert.equal(
    snapshot.policies.some(
      (entry) => entry.table === "private.learning_assessment_answer_keys",
    ),
    false,
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
      -- Supabase postgres 17.6.1.158 / 20230529180330_alter_api_roles_for_inherit.sql
      alter role authenticated inherit;
      alter role anon inherit;
      alter role service_role inherit;
      create role learning_bridge nologin noinherit;
      create role learning_superuser nologin noinherit superuser;
      grant learning_superuser to learning_bridge;
      grant learning_bridge to service_role;
      create schema core;
      create schema private;
      create schema learning;
      grant usage on schema core, private, learning to authenticated, service_role;
      alter default privileges in schema core grant select on tables to authenticated;
      alter default privileges grant insert on tables to authenticated;
    `);
    const snapshot = await catalogModule.loadLearningCatalogSnapshot(database);
    assert.deepEqual(snapshot.roles, expectedSnapshot().roles);
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
      snapshot.defaultPrivileges.some(
        (entry) =>
          entry.schema === "<global>" &&
          entry.owner === "postgres" &&
          entry.objectType === "TABLE" &&
          entry.grantee === "authenticated" &&
          entry.privilege === "INSERT",
      ),
    );
    assert.match(
      catalogModule.verifyLearningCatalogSnapshot(snapshot).join("\n"),
      /default privilege/i,
      "an unsafe global default ACL must fail the exact applied catalog",
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

test("native Supabase role attributes remain exact with INHERIT", () => {
  const expected = expectedSnapshot();
  assert.deepEqual(
    expected.roles,
    ["anon", "authenticated", "service_role"].map((name) => ({
      name,
      superuser: false,
      inherit: true,
      createRole: false,
      createDb: false,
      canLogin: false,
      bypassRls: name === "service_role",
      replication: false,
      connectionLimit: -1,
    })),
  );
  for (const role of expected.roles) {
    for (const field of [
      "superuser",
      "inherit",
      "createRole",
      "createDb",
      "canLogin",
      "bypassRls",
      "replication",
      "connectionLimit",
    ]) {
      expectDrift((snapshot) => {
        snapshot.roles.find((row) => row.name === role.name)[field] =
          field === "connectionLimit" ? 0 : !role[field];
      }, /role attribute/i);
    }
  }
});

test("canonical default ACL scope excludes MVP grants and rejects every added grant", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("./qa/canonical-replay-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    manifest.sources.find(
      (row) => row.file === "20260706090000_core_schema_identity.sql",
    ).action,
    "preserve-history",
  );
  const executed = new Set(
    manifest.sources
      .filter((row) => row.action === "execute-forward")
      .map((row) => row.file),
  );
  const sql = [
    ...manifest.baseline.map((row) =>
      readFileSync(
        new URL(
          `./qa/fixtures/canonical-uat-baseline/${row.file}`,
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    ...readRepositoryMigrations()
      .filter((row) => executed.has(row.name))
      .map((row) => row.sql),
  ];
  const scopedDefaults = sql
    .flatMap((source) => scanSql(source))
    .filter(
      (statement) =>
        /^alter default privileges\b/i.test(statement) &&
        (!/\bin schema\b/i.test(statement) ||
          /\bin schema (?:core|learning|private)\b/i.test(statement)),
    );
  assert.ok(scopedDefaults.length > 0);
  for (const statement of scopedDefaults)
    assert.match(statement, /\brevoke\b/i);
  assert.deepEqual(expectedSnapshot().defaultPrivileges, []);
  for (const schema of ["<global>", "core", "learning", "private"]) {
    for (const grantee of ["PUBLIC", "anon", "authenticated", "service_role"]) {
      expectDrift(
        (snapshot) =>
          snapshot.defaultPrivileges.push({
            owner: "postgres",
            schema,
            objectType: "TABLE",
            grantee,
            privilege: "SELECT",
            grantable: false,
          }),
        /default privilege/i,
      );
    }
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
  assert.deepEqual(expected.defaultPrivileges, []);

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
