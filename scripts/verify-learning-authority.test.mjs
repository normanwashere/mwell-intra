import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrationPath = fileURLToPath(
  new URL(
    "../supabase/migrations/20260812200000_learning_authority.sql",
    import.meta.url,
  ),
);
const registrySql = readFileSync(
  fileURLToPath(new URL("../packages/rbac/src/registry.ts", import.meta.url)),
  "utf8",
);
const migrationSql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const migrationDirectory = dirname(migrationPath);
const mutationRuleStatements = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .flatMap((name) => {
    const sql = readFileSync(resolve(migrationDirectory, name), "utf8");
    return [
      ...sql.matchAll(
        /insert\s+into\s+learning\.mutation_capability_rules\s*\([^)]*\)\s*values\s*([\s\S]*?);/gi,
      ),
    ].map((match) => match[1]);
  });

const mutationCapabilities = [
  ...registrySql.matchAll(/mutationCapability\('([^']+)',\s*'([^']+)'\)/g),
]
  .map((match) => `${match[1]}:${match[2]}`)
  .sort();

function functionBody(name) {
  return (
    migrationSql.match(
      new RegExp(
        `create or replace function ${name.replaceAll(".", "\\.")}\\([^]*?\\n\\$\\$;`,
        "i",
      ),
    )?.[0] ?? ""
  );
}

test("creates the certified capability authority migration", () => {
  assert.equal(existsSync(migrationPath), true);
  assert.match(
    migrationSql,
    /create table learning\.mutation_capability_rules/i,
  );
  assert.match(
    migrationSql,
    /alter table learning\.mutation_capability_rules force row level security/i,
  );
});

test("keeps the SQL mutation rule catalog in exact RBAC parity", () => {
  const seeded = [
    ...mutationRuleStatements
      .join("\n")
      .matchAll(/\('([^']+)',\s*'([^']+)'\)/g),
  ]
    .map((match) => `${match[1]}:${match[2]}`)
    .filter((key) => mutationCapabilities.includes(key))
    .sort();
  assert.deepEqual([...new Set(seeded)], mutationCapabilities);
});

test("requires both current role authority and current certification", () => {
  const certification = functionBody("learning.has_active_certification");
  assert.match(certification, /certification\.user_id = p_user_id/i);
  assert.match(certification, /certification\.status = 'active'/i);
  assert.match(certification, /certification\.effective_at <=/i);
  assert.match(certification, /certification\.expires_at is null/i);
  assert.match(
    certification,
    /source_assignment\.id = certification\.source_role_assignment_id/i,
  );
  assert.match(
    certification,
    /source_assignment\.user_id = certification\.user_id/i,
  );
  assert.match(
    certification,
    /source_assignment\.module = certification\.module/i,
  );
  assert.match(
    certification,
    /source_assignment\.role = certification\.source_role/i,
  );
  assert.match(
    certification,
    /join core\.role_capabilities source_capability/i,
  );
  assert.match(
    certification,
    /source_capability\.module = certification\.module/i,
  );
  assert.match(
    certification,
    /source_capability\.role = certification\.source_role/i,
  );
  assert.match(
    certification,
    /source_capability\.cap = certification\.capability/i,
  );
  assert.match(
    certification,
    /join core\.profile_department_scopes certification_scope/i,
  );
  assert.match(
    certification,
    /certification_scope\.department_id = certification\.department_id/i,
  );
  assert.match(
    certification,
    /certification_scope\.effective_from <= current_date/i,
  );

  const live = functionBody("core.has_live_cap");
  assert.match(live, /core\.has_cap\(p_module, p_cap\)/i);
  assert.match(
    live,
    /not learning\.is_certification_required\(p_module, p_cap\)/i,
  );
  assert.match(
    live,
    /learning\.has_active_certification\(auth\.uid\(\), p_module, p_cap\)/i,
  );
  assert.match(
    live,
    /learning\.has_active_emergency_exception\(auth\.uid\(\), p_module, p_cap\)/i,
  );
});

test("accepts only independent, current exceptions that cannot waive policy", () => {
  const body = functionBody("learning.has_active_emergency_exception");
  for (const invariant of [
    /exception\.status = 'active'/i,
    /exception\.effective_at <=/i,
    /exception\.expires_at >/i,
    /exception\.grantor_id <> exception\.user_id/i,
    /exception\.approver_id <> exception\.user_id/i,
    /exception\.grantor_id <> exception\.approver_id/i,
    /exception\.waives_legal_acknowledgment = false/i,
    /requirement_version\.requirement_kind = 'policy'/i,
    /not requirement_version\.waivable/i,
    /join core\.profile_department_scopes beneficiary_scope/i,
    /beneficiary_scope\.department_id = exception\.department_id/i,
    /beneficiary_scope\.effective_from <= current_date/i,
  ]) {
    assert.match(body, invariant);
  }
});

test("returns raw and effective capability projections separately", () => {
  const raw = functionBody("core.my_role_capabilities");
  assert.match(raw, /from core\.user_roles/i);
  assert.match(raw, /join core\.role_capabilities/i);
  assert.doesNotMatch(raw, /has_live_cap/i);

  const effective = functionBody("core.my_capabilities");
  assert.match(effective, /core\.has_live_cap\(/i);
  assert.match(effective, /core\.my_role_capabilities\(\)/i);

  const snapshot = functionBody("core.my_capability_snapshot");
  assert.match(snapshot, /core\.my_role_capabilities\(\)/i);
  assert.match(snapshot, /core\.my_capabilities\(\)/i);
  assert.match(snapshot, /'roleCapabilities'/i);
  assert.match(snapshot, /'userCapabilities'/i);
});

test("exposes only bounded authenticated authority RPCs", () => {
  assert.match(
    migrationSql,
    /grant select on table learning\.mutation_capability_rules\s+to service_role/i,
  );
  assert.doesNotMatch(
    migrationSql,
    /grant[^;]*(?:insert|update|delete)[^;]*on table learning\.mutation_capability_rules/i,
  );
  for (const signature of [
    "core.my_capability_snapshot()",
    "core.my_role_capabilities()",
    "core.my_capabilities()",
  ]) {
    assert.match(
      migrationSql,
      new RegExp(
        `revoke all on function ${signature.replace(/[().]/g, "\\$&")} from public, anon`,
        "i",
      ),
    );
    assert.match(
      migrationSql,
      new RegExp(
        `grant execute on function ${signature.replace(/[().]/g, "\\$&")} to authenticated, service_role`,
        "i",
      ),
    );
  }
});
