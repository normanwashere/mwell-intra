import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const MIGRATIONS = resolve(ROOT, "supabase", "migrations");
const MIGRATION_SUFFIX = "_security_database_launch_blocker_convergence.sql";
const SERVICE_VERIFIER_MIGRATION_SUFFIX =
  "_add_service_role_launch_verifier.sql";
const LIVE_CAP_CONVERGENCE_SUFFIX = "_converge_read_rpc_live_capabilities.sql";
const LAUNCH_READ_CONTRACT_SUFFIX = "_restore_launch_read_contracts.sql";
const COMMITMENT_BOUNDARY_SUFFIX = "_certify_commitment_readiness_boundary.sql";
const EXACT_RECEIPT_QUALITY_SUFFIX =
  "_restore_exact_receipt_quality_boundary.sql";
const VERIFIER = resolve(
  ROOT,
  "scripts",
  "verify-security-database-launch-blockers.mjs",
);

function convergenceMigration() {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(MIGRATION_SUFFIX))
    .sort();
  assert.equal(
    files.length,
    1,
    "exactly one security/database convergence migration is required",
  );
  assert.ok(
    files[0].slice(0, 14) > "20260815235959",
    "the convergence migration must be forward-only and dated after 2026-08-15",
  );
  return {
    file: files[0],
    sql: readFileSync(resolve(MIGRATIONS, files[0]), "utf8"),
  };
}

function serviceVerifierMigration() {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(SERVICE_VERIFIER_MIGRATION_SUFFIX))
    .sort();
  assert.equal(
    files.length,
    1,
    "exactly one service-role verifier migration is required",
  );
  return {
    file: files[0],
    sql: readFileSync(resolve(MIGRATIONS, files[0]), "utf8"),
  };
}

function liveCapConvergenceMigration() {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(LIVE_CAP_CONVERGENCE_SUFFIX))
    .sort();
  assert.equal(
    files.length,
    1,
    "exactly one read-RPC convergence migration is required",
  );
  return readFileSync(resolve(MIGRATIONS, files[0]), "utf8");
}

function launchReadContractMigration() {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(LAUNCH_READ_CONTRACT_SUFFIX))
    .sort();
  assert.equal(
    files.length,
    1,
    "exactly one launch read-contract migration is required",
  );
  return readFileSync(resolve(MIGRATIONS, files[0]), "utf8");
}

function commitmentBoundaryMigration() {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(COMMITMENT_BOUNDARY_SUFFIX))
    .sort();
  assert.equal(
    files.length,
    1,
    "exactly one commitment-boundary repair is required",
  );
  return readFileSync(resolve(MIGRATIONS, files[0]), "utf8");
}

function exactReceiptQualityMigration() {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(EXACT_RECEIPT_QUALITY_SUFFIX))
    .sort();
  assert.equal(
    files.length,
    1,
    "exactly one exact receipt-quality repair is required",
  );
  return readFileSync(resolve(MIGRATIONS, files[0]), "utf8");
}

function functionBody(sql, qualifiedName) {
  const start = sql
    .toLowerCase()
    .indexOf(`create or replace function ${qualifiedName}`);
  assert.notEqual(start, -1, `missing ${qualifiedName}`);
  const end = sql.indexOf("$$;", start);
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`);
  return sql.slice(start, end + 3);
}

test("adds one post-20260815 forward-only convergence migration", () => {
  const { sql } = convergenceMigration();
  assert.match(sql, /forward-only/i);
  assert.doesNotMatch(sql, /alter\s+table\s+supabase_migrations/i);
  assert.doesNotMatch(sql, /drop\s+(?:table|schema)/i);
});

test("restores the principal-bound 12-column My Work contract", () => {
  const { sql } = convergenceMigration();
  assert.match(
    sql,
    /returns table\s*\(\s*id text,\s*principal_id uuid,\s*source text,\s*title text,\s*description text,\s*status text,\s*priority text,\s*due_at timestamptz,\s*href text,\s*required_module text,\s*required_capability text,\s*source_record_exists boolean\s*\)/i,
  );
  assert.match(
    sql,
    /create view core\.v_my_work with \(security_invoker\s*=\s*true\)/i,
  );
  assert.match(
    sql,
    /grant select on core\.v_my_work to authenticated,\s*service_role/i,
  );
  assert.match(functionBody(sql, "core.my_work"), /auth\.uid\(\)/i);
  assert.match(functionBody(sql, "core.my_work"), /core\.has_live_cap\(/i);
});

test("converges authenticated raw-cap RPCs through catalog introspection", () => {
  const { sql } = convergenceMigration();
  for (const invariant of [
    /from pg_catalog\.pg_proc/i,
    /learning\.mutation_capability_rules/i,
    /pg_catalog\.pg_get_functiondef/i,
    /pg_catalog\.has_function_privilege\('authenticated'/i,
    /core\.has_live_cap/i,
    /revoke execute on function[\s\S]*?from authenticated/i,
    /security definer/i,
  ]) {
    assert.match(sql, invariant);
  }
  assert.match(sql, /jsonb.*single.*capability|single.*capability.*jsonb/is);
  assert.match(sql, /ambiguous|fail.closed|revoke.*remaining/is);
});

test("enforces active profiles and time-bounded privileged roles", () => {
  const { sql } = convergenceMigration();
  assert.match(sql, /alter table core\.user_roles[\s\S]*?effective_at/i);
  assert.match(sql, /alter table core\.user_roles[\s\S]*?expires_at/i);
  const hasCap = functionBody(sql, "core.has_cap");
  assert.match(hasCap, /join core\.profiles/i);
  assert.match(hasCap, /profile\.status\s*=\s*'active'/i);
  assert.match(hasCap, /role_assignment\.effective_at\s*<=/i);
  assert.match(hasCap, /role_assignment\.expires_at is null/i);
  const assign = functionBody(sql, "core.assign_user_role");
  assert.match(assign, /profile\.status\s*=\s*'active'/i);
  assert.match(assign, /effective_at,\s*expires_at/i);
  assert.match(assign, /core\.has_live_cap\('core',\s*'manage_rbac'\)/i);
});

test("prevents removal or expiry of the final effective platform administrator", () => {
  const { sql } = convergenceMigration();
  const revoke = functionBody(sql, "core.revoke_user_role");
  assert.match(revoke, /lock table core\.user_roles/i);
  assert.match(revoke, /core[\s\S]*platform_admin/i);
  assert.match(revoke, /last effective platform administrator/i);
  assert.match(sql, /prevent_last_platform_admin_expiry/i);
});

test("reconciles certifications and archives duplicate completed assignments", () => {
  const { sql } = convergenceMigration();
  assert.match(
    sql,
    /row_number\(\) over\s*\(\s*partition by[\s\S]*?curriculum_version_id[\s\S]*?source_id/i,
  );
  assert.match(sql, /update learning\.certifications[\s\S]*?assignment_id/i);
  assert.match(sql, /status\s*=\s*'superseded'/i);
  assert.match(sql, /superseded_by_id/i);
  assert.match(sql, /learning_one_completed_assignment_idx/i);
  assert.match(sql, /learning\.evaluate_certifications\(\)/i);
});

test("adds the two assessment answer-key foreign-key indexes", () => {
  const { sql } = convergenceMigration();
  assert.match(
    sql,
    /create index if not exists learning_assessment_answer_keys_created_by_fkey_idx\s+on private\.learning_assessment_answer_keys\s*\(created_by\)/i,
  );
  assert.match(
    sql,
    /create index if not exists learning_assessment_answer_keys_updated_by_fkey_idx\s+on private\.learning_assessment_answer_keys\s*\(updated_by\)/i,
  );
  assert.doesNotMatch(sql, /drop\s+index/i);
});

test("runtime verifier fails closed on raw boundaries or missing critical objects", async () => {
  assert.equal(existsSync(VERIFIER), true, "runtime verifier is missing");
  const { verifySecurityDatabaseLaunchBlockers } = await import(
    `./verify-security-database-launch-blockers.mjs?test=${Date.now()}`
  );

  const badQuery = async (sql) => {
    if (sql.includes("raw_boundaries")) {
      return {
        rows: [{ raw_boundaries: 1, examples: ["warehouse.issue(jsonb)"] }],
      };
    }
    return { rows: [{ missing_objects: [] }] };
  };
  await assert.rejects(
    verifySecurityDatabaseLaunchBlockers(badQuery),
    /authenticated raw-cap certification-controlled RPC/i,
  );

  const missingObjectQuery = async (sql) => {
    if (sql.includes("raw_boundaries")) {
      return { rows: [{ raw_boundaries: 0, examples: [] }] };
    }
    return {
      rows: [{ missing_objects: ["core.v_my_work exact 12-column contract"] }],
    };
  };
  await assert.rejects(
    verifySecurityDatabaseLaunchBlockers(missingObjectQuery),
    /critical launch objects are missing.*core\.v_my_work/i,
  );

  const goodQuery = async (sql) => {
    if (sql.includes("raw_boundaries"))
      return { rows: [{ raw_boundaries: 0, examples: [] }] };
    return { rows: [{ missing_objects: [] }] };
  };
  const result = await verifySecurityDatabaseLaunchBlockers(goodQuery);
  assert.deepEqual(result, { rawBoundaries: 0, missingObjects: [] });
});

test("runtime verifier binds the vaulted service credential to the guarded UAT project", async () => {
  const { resolveVerifierConfig } = await import(
    `./verify-security-database-launch-blockers.mjs?env=${Date.now()}`
  );
  assert.deepEqual(
    resolveVerifierConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://kkoitlvydytdhlpxhuah.supabase.co",
      SUPABASE_PROJECT_REF: "kkoitlvydytdhlpxhuah",
      SUPABASE_SERVICE_ROLE_KEY: "vaulted-test-key",
    }),
    {
      url: "https://kkoitlvydytdhlpxhuah.supabase.co",
      serviceRoleKey: "vaulted-test-key",
    },
  );
  assert.throws(
    () =>
      resolveVerifierConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://unsafe-project.supabase.co",
        SUPABASE_PROJECT_REF: "unsafe.host.example",
        SUPABASE_SERVICE_ROLE_KEY: "secret",
      }),
    /vaulted service-role credential|guarded project/i,
  );
});

test("service-role launch verifier is read-only and unavailable to app roles", () => {
  const { sql } = serviceVerifierMigration();
  assert.match(sql, /core\.verify_security_database_launch_blockers\(\)/i);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/i);
  assert.match(
    sql,
    /revoke all on function core\.verify_security_database_launch_blockers\(\) from authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function core\.verify_security_database_launch_blockers\(\) to service_role/i,
  );
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate)\b/i);
});

test("later authenticated read RPCs converge to live capabilities", () => {
  const sql = liveCapConvergenceMigration();
  assert.match(sql, /pg_catalog\.pg_get_functiondef/i);
  assert.match(sql, /learning\.mutation_capability_rules/i);
  assert.match(sql, /pg_catalog\.has_function_privilege\('authenticated'/i);
  assert.match(sql, /core\.has_live_cap\(/i);
  assert.match(sql, /execute revised_definition/i);
  assert.doesNotMatch(sql, /revoke execute[\s\S]*authenticated/i);
});

test("launch read contracts restore authenticated access and detect grant drift", () => {
  const sql = launchReadContractMigration();
  for (const signature of [
    "procurement.commitment_readiness(jsonb)",
    "procurement.purchase_order_receipt_status(jsonb)",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `grant execute on function ${signature.replace(/[().]/g, "\\$&")}[\\s\\S]*?authenticated`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `has_function_privilege\\([\\s\\S]*?'authenticated'[\\s\\S]*?'${signature.replace(/[().]/g, "\\$&")}'`,
        "i",
      ),
    );
  }
  assert.match(sql, /core\.verify_launch_read_contracts\(\)/i);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/i);
  assert.match(
    sql,
    /revoke all on function core\.verify_launch_read_contracts\(\)[\s\S]*?authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function core\.verify_launch_read_contracts\(\)[\s\S]*?service_role/i,
  );
  assert.doesNotMatch(sql, /\b(drop|truncate)\b/i);
});

test("runtime verifier checks both critical read grants", () => {
  const source = readFileSync(VERIFIER, "utf8");
  assert.match(
    source,
    /authenticated execute on procurement\.commitment_readiness\(jsonb\)/i,
  );
  assert.match(
    source,
    /authenticated execute on procurement\.purchase_order_receipt_status\(jsonb\)/i,
  );
  assert.match(source, /\.rpc\("verify_launch_read_contracts"\)/);
  assert.match(source, /Critical launch grants are missing/);
});

test("authenticated commitment readiness uses live certified capabilities", () => {
  const sql = commitmentBoundaryMigration();
  const body = functionBody(sql, "procurement.commitment_readiness");
  assert.match(body, /core\.has_live_cap\('procurement', 'view_dashboard'\)/i);
  assert.match(body, /core\.has_live_cap\('procurement', 'author_po'\)/i);
  assert.match(body, /core\.has_live_cap\('procurement', 'approve_award'\)/i);
  assert.doesNotMatch(body, /core\.has_cap\(/i);
  assert.match(
    sql,
    /grant execute on function procurement\.commitment_readiness\(jsonb\)[\s\S]*?authenticated/i,
  );
});

test("launch verification preserves exact PO-line quality delegation", () => {
  const sql = exactReceiptQualityMigration();
  const qualityBoundary = functionBody(sql, "warehouse.inspect_quality");
  assert.match(qualityBoundary, /core\.has_live_cap\('warehouse', 'inspect_quality'\)/i);
  assert.match(
    qualityBoundary,
    /return private\.warehouse_inspect_quality_v2\(payload\)/i,
  );
  assert.doesNotMatch(
    qualityBoundary,
    /return private\.warehouse_inspect_quality\(payload\)/i,
  );
  const verifier = functionBody(sql, "core.verify_launch_read_contracts");
  assert.match(verifier, /warehouse\.inspect_quality exact PO-line delegate/i);
  assert.match(
    verifier,
    /private\.warehouse_inspect_quality_v2\(jsonb\) unavailable to authenticated/i,
  );
  assert.match(
    sql,
    /revoke all on function core\.verify_launch_read_contracts\(\)[\s\S]*?authenticated/i,
  );
});

test("runtime critical-object verification checks the exact quality boundary", () => {
  const source = readFileSync(VERIFIER, "utf8");
  assert.match(source, /warehouse\.inspect_quality exact PO-line delegate/i);
  assert.match(
    source,
    /private\.warehouse_inspect_quality_v2 unavailable to authenticated/i,
  );
});

test("package exposes the runtime database verification command", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(ROOT, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["verify:security-db-launch-blockers"],
    "node scripts/verify-security-database-launch-blockers.mjs",
  );
});
