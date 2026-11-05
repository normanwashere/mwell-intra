import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import {
  readRepositoryMigrations,
  scanSql,
} from "./verify-learning-schema.mjs";
import { expectedLearningCatalogSnapshot } from "./verify-learning-catalog.mjs";
import {
  seedFixture,
  cleanupFixture,
  verifyMissingCompletionEvidence,
} from "./verify-learning-concurrency.mjs";

async function fixtureDatabase() {
  const database = new PGlite({ extensions: { btree_gist } });
  try {
    // Supabase auth substrate only. Application tables, checks, indexes,
    // certification functions and triggers below are unmodified repository SQL.
    await database.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema core; create schema learning; create schema private; create schema extensions;
      create extension btree_gist with schema extensions;
      set search_path = public, extensions;
      set check_function_bodies = off;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    `);
    const manifest = JSON.parse(
      readFileSync(
        new URL("./qa/canonical-replay-manifest.json", import.meta.url),
        "utf8",
      ),
    );
    const executed = new Set(
      manifest.sources
        .filter((row) => row.action === "execute-forward")
        .map((row) => row.file),
    );
    const sources = [
      {
        name: "canonical-cutover",
        sql: readFileSync(
          new URL(
            "./qa/fixtures/canonical-uat-baseline/20260717175559_baseline_live_intra_cutover_without_operational_fixtures.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      },
      ...readRepositoryMigrations().filter((row) => executed.has(row.name)),
    ];
    const coreTables = new Set([
      "vendors",
      "profiles",
      "capabilities",
      "roles",
      "role_capabilities",
      "user_roles",
      "departments",
      "profile_department_scopes",
      "activity_log",
    ]);
    const governed = (name) =>
      name?.startsWith("learning.") ||
      name === "private.learning_assessment_answer_keys" ||
      (name?.startsWith("core.") && coreTables.has(name.slice(5)));
    const functions = new Set(
      expectedLearningCatalogSnapshot().functions.map(
        (row) => row.function.split("(")[0],
      ),
    );
    for (const name of [
      "core.has_cap",
      "learning.resolve_assignments_base",
      "learning.start_requirement_base",
    ])
      functions.add(name);
    for (const source of sources) {
      for (const sql of scanSql(source.sql)) {
        const table = sql.match(
          /^(?:create table(?: if not exists)?|alter table)\s+([a-z_]+\.[a-z_]+)/i,
        )?.[1];
        const indexTable = sql.match(
          /^create (?:unique )?index[\s\S]*?\bon\s+([a-z_]+\.[a-z_]+)/i,
        )?.[1];
        const fn = sql.match(
          /^(?:create(?: or replace)? function|alter function|(?:grant|revoke)\s+[\s\S]*?\s+on function)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(/i,
        )?.[1];
        const trigger = sql.match(
          /^(?:create(?: constraint)?|drop) trigger[\s\S]*?\bon\s+([a-z_]+\.[a-z_]+)/i,
        )?.[1];
        const learningTrigger =
          trigger?.startsWith("learning.") ||
          (trigger?.startsWith("core.") &&
            /\btrigger (?:if exists )?learning_/i.test(sql));
        const coreConstraint =
          /^do\b/i.test(sql) &&
          [
            "profile_department_scopes_no_overlap",
            "user_roles_role_integrity_fk",
            "roles_module_format_check",
            "user_roles_effective_window_check",
          ].some((name) => sql.includes(`conname = '${name}'`));
        if (
          governed(table) ||
          governed(indexTable) ||
          (fn && functions.has(fn)) ||
          learningTrigger ||
          coreConstraint
        ) {
          try {
            await database.exec(sql);
          } catch (error) {
            error.message = `${source.name}: ${error.message}`;
            throw error;
          }
        }
      }
    }
    await database.exec("set check_function_bodies = on");
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}

test("complete seed satisfies actual current constraints and trigger-enabled issuance", async () => {
  const database = await fixtureDatabase();
  try {
    await seedFixture(database);
    assert.deepEqual(
      (await database.query("show session_replication_role")).rows,
      [{ session_replication_role: "origin" }],
    );
    const counts = await database.query(`select
      (select count(*)::integer from core.profiles) as profiles,
      (select count(*)::integer from core.user_roles) as roles,
      (select count(*)::integer from learning.assignments) as assignments,
      (select count(*)::integer from learning.attempts) as attempts`);
    assert.deepEqual(counts.rows, [
      { profiles: 10, roles: 8, assignments: 7, attempts: 6 },
    ]);
    const triggers = await database.query(
      `select tgname, tgenabled from pg_trigger where not tgisinternal`,
    );
    for (const expected of expectedLearningCatalogSnapshot().triggers) {
      assert.equal(
        triggers.rows.find((row) => row.tgname === expected.name)?.tgenabled,
        "O",
        expected.name,
      );
    }
    const orientation = await database.query(
      "select simulation_id, pass_rules from learning.requirement_versions",
    );
    assert.deepEqual(orientation.rows, [
      {
        simulation_id: "learning-ci-orientation-v1",
        pass_rules: { required_checkpoints: ["complete"] },
      },
    ]);
    for (const invalid of [
      { simulation_id: null },
      { simulation_id: " " },
      { pass_rules: { required_checkpoints: [] } },
      { pass_rules: { required_checkpoints: "complete" } },
    ]) {
      await assert.rejects(
        database.query(
          `
        insert into learning.requirement_versions
        select (jsonb_populate_record(null::learning.requirement_versions,
          to_jsonb(rv) || jsonb_build_object('id', gen_random_uuid(), 'version', 2, 'status', 'draft') || $1::jsonb)).*
        from learning.requirement_versions rv`,
          [JSON.stringify(invalid)],
        ),
        (error) =>
          error.code === "23514" &&
          error.constraint === "requirement_versions_orientation_runtime_check",
      );
    }
    await verifyMissingCompletionEvidence(database);
    const issued = await database.query(`
      insert into learning.certifications(
        id, user_id, department_id, audience, assignment_id, source_role_assignment_id,
        source_role, module, capability, curriculum_version_id, requirement_version_ids,
        status, issued_at, effective_at, issued_by, evidence_references
      ) select ('90000000-0000-4000-8000-' || right(a.user_id::text, 12))::uuid,
        a.user_id, a.department_id, a.audience, a.id, a.source_id,
        'operator', 'learning_ci', 'operate', a.curriculum_version_id,
        array[r.requirement_version_id], 'active', transaction_timestamp(), transaction_timestamp(),
        'ci:applied-postgres', '[{"source":"ci"}]'::jsonb
      from learning.assignments a join learning.assignment_requirements r on r.assignment_id = a.id
      where exists(select 1 from learning.attempts t where t.assignment_requirement_id = r.id)
      returning user_id, evidence_references`);
    assert.equal(issued.rows.length, 6);
    for (const row of issued.rows) {
      const suffix = row.user_id.slice(-12);
      assert.deepEqual(row.evidence_references, [
        {
          assignment_requirement_id: `71000000-0000-4000-8000-${suffix}`,
          source_assignment_requirement_id: `71000000-0000-4000-8000-${suffix}`,
          requirement_version_id: "40000000-0000-4000-8000-000000000002",
          status: "passed",
          attempt_ids: [`91000000-0000-4000-8000-${suffix}`],
          acknowledgment_ids: [],
        },
      ]);
    }
    await cleanupFixture(database);
    for (const table of [
      "core.profiles",
      "core.departments",
      "core.capabilities",
      "core.roles",
      "core.role_capabilities",
      "core.user_roles",
      ...expectedLearningCatalogSnapshot().tables.map((row) => row.table),
    ]) {
      assert.equal(
        (await database.query(`select count(*)::integer as n from ${table}`))
          .rows[0].n,
        0,
        table,
      );
    }
    assert.equal(
      (await database.query("show session_replication_role")).rows[0]
        .session_replication_role,
      "origin",
    );
  } finally {
    await database.close();
  }
});

function recorder(implementation = async () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return implementation(sql, parameters);
    },
  };
}

test("six race fixtures carry exact owned valid attempts; missing-evidence case stays deliberately incomplete", async () => {
  const client = recorder();
  await seedFixture(client);
  const attempts = client.calls.filter((call) =>
    /insert into learning\.attempts\(/.test(call.sql),
  );
  assert.equal(attempts.length, 6);
  for (let index = 0; index < 6; index++) {
    const suffix = String(index + 1).padStart(12, "0");
    assert.deepEqual(attempts[index].parameters.slice(0, 3), [
      `91000000-0000-4000-8000-${suffix}`,
      `71000000-0000-4000-8000-${suffix}`,
      `60000000-0000-4000-8000-${suffix}`,
    ]);
    assert.match(attempts[index].sql, /'attestation', 'passed', 'valid'/);
  }
  assert.equal(
    client.calls.filter((call) =>
      /insert into learning\.assignment_requirements\(/.test(call.sql),
    ).length,
    7,
  );
  assert.equal(
    client.calls.at(-1).sql,
    "set session_replication_role = origin",
  );
});

test("scoped attempts are removed before their parent requirements", async () => {
  const client = recorder();
  await cleanupFixture(client);
  const attemptIndex = client.calls.findIndex((call) =>
    /delete from learning\.attempts /.test(call.sql),
  );
  const requirementIndex = client.calls.findIndex((call) =>
    /delete from learning\.assignment_requirements /.test(call.sql),
  );
  assert.ok(attemptIndex > 0 && attemptIndex < requirementIndex);
  assert.equal(
    client.calls[attemptIndex].sql,
    "delete from learning.attempts where id = any($1::uuid[])",
  );
  assert.equal(client.calls[attemptIndex].parameters[0].length, 8);
  assert.ok(
    client.calls[attemptIndex].parameters[0].every((id) =>
      /^91000000-0000-4000-8000-00000000000[1-8]$/.test(id),
    ),
  );
  assert.equal(
    client.calls.at(-1).sql,
    "set session_replication_role = origin",
  );
});

test("fixture failure always restores normal trigger behavior", async () => {
  for (const prepare of [seedFixture, cleanupFixture]) {
    const client = recorder(async (sql) => {
      if (/learning\.attempts/.test(sql)) throw new Error("fixture failure");
      return { rows: [] };
    });
    await assert.rejects(prepare(client), /fixture failure/);
    assert.equal(
      client.calls.at(-1).sql,
      "set session_replication_role = origin",
    );
  }
});

test("negative proof requires the real missing-evidence rejection and always rolls back", async () => {
  for (const [message, shouldPass] of [
    ["Certification completion lacks authoritative evidence", true],
    ["unrelated database error", false],
  ]) {
    const client = recorder(async (sql) => {
      if (/insert into learning\.certifications/.test(sql))
        throw new Error(message);
      return { rows: [] };
    });
    if (shouldPass) await verifyMissingCompletionEvidence(client);
    else
      await assert.rejects(
        verifyMissingCompletionEvidence(client),
        assert.AssertionError,
      );
    assert.equal(client.calls.at(-1).sql, "rollback");
  }
  const client = recorder();
  await assert.rejects(verifyMissingCompletionEvidence(client));
  assert.equal(client.calls.at(-1).sql, "rollback");
});
