import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  REQUIRED_TABLES,
  verifyLearningSchema,
} from "./verify-learning-schema.mjs";

const FOUNDATION_NAME = "20260812130000_learning_foundation.sql";
const ROLE_LIFECYCLE_NAME =
  "20260812140000_learning_role_authority_lifecycle.sql";
const ASSIGNMENT_LINEAGE_NAME =
  "20260812150000_learning_assignment_lineage_remediation.sql";
const SERVICES_NAME = "20260812160000_learning_services.sql";
const OLD_FOUNDATION_NAME = "20260812090000_learning_foundation.sql";
const migration = fileURLToPath(
  new URL(`../supabase/migrations/${FOUNDATION_NAME}`, import.meta.url),
);
const oldMigration = fileURLToPath(
  new URL(`../supabase/migrations/${OLD_FOUNDATION_NAME}`, import.meta.url),
);
const sql = readFileSync(migration, "utf8");
const roleLifecycleMigration = fileURLToPath(
  new URL(`../supabase/migrations/${ROLE_LIFECYCLE_NAME}`, import.meta.url),
);
const roleLifecycleSql = existsSync(roleLifecycleMigration)
  ? readFileSync(roleLifecycleMigration, "utf8")
  : "";
const assignmentLineageMigration = fileURLToPath(
  new URL(`../supabase/migrations/${ASSIGNMENT_LINEAGE_NAME}`, import.meta.url),
);
const assignmentLineageSql = existsSync(assignmentLineageMigration)
  ? readFileSync(assignmentLineageMigration, "utf8")
  : "";
const servicesMigration = fileURLToPath(
  new URL(`../supabase/migrations/${SERVICES_NAME}`, import.meta.url),
);
const servicesSql = existsSync(servicesMigration)
  ? readFileSync(servicesMigration, "utf8")
  : "";
const migrationDirectory = fileURLToPath(
  new URL("../supabase/migrations/", import.meta.url),
);
const repositoryMigrations = readdirSync(migrationDirectory)
  .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/i.test(name))
  .sort()
  .map((name) => ({
    name,
    sql: readFileSync(`${migrationDirectory}/${name}`, "utf8"),
  }));
const task1Catalog = readFileSync(
  fileURLToPath(new URL("../modules/learning/src/catalog.ts", import.meta.url)),
  "utf8",
);
const task1Registry = readFileSync(
  fileURLToPath(new URL("../packages/rbac/src/registry.ts", import.meta.url)),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../package.json", import.meta.url)),
    "utf8",
  ),
);

function replaceRequired(source, pattern, replacement) {
  assert.match(source, pattern, `Fixture did not contain ${pattern}.`);
  return source.replace(pattern, replacement);
}

function errorsFor(source) {
  return verifyLearningSchema(
    repositoryMigrations.map((migrationEntry) =>
      migrationEntry.name === FOUNDATION_NAME
        ? { ...migrationEntry, sql: source }
        : migrationEntry,
    ),
  ).join("\n");
}

function errorsForRoleLifecycle(source) {
  return verifyLearningSchema(
    repositoryMigrations.map((migrationEntry) =>
      migrationEntry.name === ROLE_LIFECYCLE_NAME
        ? { ...migrationEntry, sql: source }
        : migrationEntry,
    ),
  ).join("\n");
}

function errorsForAssignmentLineage(source) {
  return verifyLearningSchema(
    repositoryMigrations.map((migrationEntry) =>
      migrationEntry.name === ASSIGNMENT_LINEAGE_NAME
        ? { ...migrationEntry, sql: source }
        : migrationEntry,
    ),
  ).join("\n");
}

function errorsForServices(source) {
  return verifyLearningSchema(
    repositoryMigrations.map((migrationEntry) =>
      migrationEntry.name === SERVICES_NAME
        ? { ...migrationEntry, sql: source }
        : migrationEntry,
    ),
  ).join("\n");
}

function orderedErrors(laterSql) {
  return verifyLearningSchema([
    ...repositoryMigrations,
    { name: "20260812150000_learning_weakening.sql", sql: laterSql },
  ]).join("\n");
}

function functionBody(name, source = sql) {
  const match = source.match(
    new RegExp(
      `create or replace function (?:learning|private)\\.${name}\\([^)]*\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `Missing function ${name}.`);
  return match[1];
}

test("uses the monotonic forward foundation and satisfies the full contract", () => {
  assert.equal(existsSync(oldMigration), false);
  assert.equal(REQUIRED_TABLES.length, 15);
  assert.deepEqual(verifyLearningSchema(repositoryMigrations), []);
});

test("defines the monotonic Task 3 learning service boundary", () => {
  assert.equal(
    existsSync(servicesMigration),
    true,
    `${SERVICES_NAME} must exist`,
  );
  for (const signature of [
    "my_learning_snapshot()",
    "resolve_assignments()",
    "start_requirement(payload jsonb)",
    "record_simulation_checkpoint(payload jsonb)",
    "submit_assessment(payload jsonb)",
    "acknowledge_policy(payload jsonb)",
    "evaluate_certifications()",
    "request_support(payload jsonb)",
  ]) {
    assert.match(
      servicesSql,
      new RegExp(
        `create or replace function learning\\.${signature.replace(/[()]/g, "\\$&")}`,
        "i",
      ),
      signature,
    );
  }
  assert.deepEqual(verifyLearningSchema(repositoryMigrations), []);
});

test("rejects client-authored learning authority and weakened service guards", () => {
  assert.equal(existsSync(servicesMigration), true);
  for (const forbiddenKey of [
    "score",
    "passed",
    "answer_key",
    "certification_status",
    "certification_state",
  ]) {
    assert.match(
      servicesSql,
      new RegExp(`forbidden learning authority field[^;]+${forbiddenKey}`, "i"),
      forbiddenKey,
    );
  }
  for (const functionName of [
    "resolve_assignments",
    "start_requirement",
    "record_simulation_checkpoint",
    "submit_assessment",
    "acknowledge_policy",
    "evaluate_certifications",
    "request_support",
  ]) {
    const weakened = servicesSql.replace(
      new RegExp(
        `(create or replace function learning\\.${functionName}\\([^]*?)(perform private\\.assert_learning_read_committed\\(\\);)`,
        "i",
      ),
      "$1",
    );
    assert.notEqual(weakened, servicesSql, functionName);
    assert.match(
      errorsForServices(weakened),
      new RegExp(`${functionName}|function body|read committed`, "i"),
      functionName,
    );
  }
});

test("keeps answer keys private and certification bound to exact live authority", () => {
  assert.equal(existsSync(servicesMigration), true);
  assert.match(
    servicesSql,
    /create table private\.learning_assessment_answer_keys/i,
  );
  assert.doesNotMatch(
    servicesSql,
    /grant[^;]+private\.learning_assessment_answer_keys[^;]+authenticated/i,
  );
  assert.match(
    servicesSql,
    /submit_assessment[\s\S]*?private\.learning_assessment_answer_keys/i,
  );
  assert.doesNotMatch(
    servicesSql,
    /insert\s+into\s+core\.(?:user_roles|profile_department_scopes)/i,
  );
  assert.match(
    servicesSql,
    /evaluate_certifications[\s\S]*?source_role_assignment_id[\s\S]*?core\.user_roles[\s\S]*?learning\.curriculum_capability_outcomes/i,
  );
});

test("requires every checksum-pinned pre-foundation migration", () => {
  const omitted = repositoryMigrations.filter(
    (migrationEntry) => migrationEntry.name !== "20260706090100_core_rbac.sql",
  );
  assert.match(
    verifyLearningSchema(omitted).join("\n"),
    /missing.*pinned.*20260706090100_core_rbac|baseline.*incomplete/i,
  );

  const drifted = repositoryMigrations.map((migrationEntry) =>
    migrationEntry.name === "20260706090100_core_rbac.sql"
      ? {
          ...migrationEntry,
          sql: `${migrationEntry.sql}\ngrant service_role to authenticated;`,
        }
      : migrationEntry,
  );
  assert.match(
    verifyLearningSchema(drifted).join("\n"),
    /checksum.*20260706090100_core_rbac|baseline.*drift/i,
  );
});

test("rejects an unexpected earlier authority migration", () => {
  assert.match(
    verifyLearningSchema([
      ...repositoryMigrations,
      {
        name: "20260812125000_earlier_role_grant.sql",
        sql: "grant service_role to authenticated;",
      },
    ]).join("\n"),
    /unexpected.*earlier|unpinned.*20260812125000|role.*grant/i,
  );
});

test("does not certify a foundation-only migration set", () => {
  assert.match(
    verifyLearningSchema(sql).join("\n"),
    /pinned migration baseline|migration set.*incomplete/i,
  );
});

test("normalizes prerequisite and capability outcome graph lineage", () => {
  for (const table of [
    "curriculum_requirement_prerequisites",
    "curriculum_capability_outcomes",
  ]) {
    assert.ok(REQUIRED_TABLES.includes(table), table);
    assert.match(sql, new RegExp(`create table learning\\.${table}`, "i"));
  }

  assert.match(
    sql,
    /constraint curriculum_requirement_prerequisites_source_fk[\s\S]*?foreign key\s*\(\s*curriculum_requirement_id\s*,\s*curriculum_version_id\s*,\s*requirement_version_id\s*,\s*audience\s*\)[\s\S]*?references learning\.curriculum_requirements\s*\(\s*id\s*,\s*curriculum_version_id\s*,\s*requirement_version_id\s*,\s*audience\s*\)/i,
  );
  assert.match(
    sql,
    /constraint curriculum_requirement_prerequisites_target_fk[\s\S]*?foreign key\s*\(\s*curriculum_version_id\s*,\s*prerequisite_requirement_version_id\s*,\s*audience\s*\)[\s\S]*?references learning\.curriculum_requirements\s*\(\s*curriculum_version_id\s*,\s*requirement_version_id\s*,\s*audience\s*\)/i,
  );
  assert.match(
    sql,
    /constraint curriculum_capability_outcomes_source_fk[\s\S]*?foreign key\s*\(\s*curriculum_requirement_id\s*,\s*curriculum_version_id\s*,\s*requirement_version_id\s*,\s*audience\s*\)[\s\S]*?references learning\.curriculum_requirements\s*\(\s*id\s*,\s*curriculum_version_id\s*,\s*requirement_version_id\s*,\s*audience\s*\)/i,
  );
  assert.match(
    sql,
    /constraint curriculum_capability_outcomes_capability_fk[\s\S]*?foreign key\s*\(\s*module\s*,\s*capability\s*\)[\s\S]*?references core\.capabilities\s*\(\s*module\s*,\s*cap\s*\)/i,
  );
  assert.match(
    sql,
    /constraint curriculum_capability_outcomes_audience_check[\s\S]*?audience = 'vendor'[\s\S]*?module = 'core'[\s\S]*?capability = 'submit_accreditation'/i,
  );
  assert.doesNotMatch(
    sql.match(
      /constraint curriculum_capability_outcomes_audience_check[\s\S]*?\),\n\s*unique/i,
    )?.[0] ?? "",
    /manage_own_accreditation_draft|submit_documents/i,
  );
  assert.doesNotMatch(
    sql,
    /prerequisite_requirement_version_ids|capability_outcomes jsonb/i,
  );
});

test("binds certification to published effective graph outcomes", () => {
  const issuance = functionBody("validate_certification_issuance");
  for (const invariant of [
    /learning\.curriculum_capability_outcomes/i,
    /learning\.curriculum_requirement_prerequisites/i,
    /outcome\.module\s*=\s*new\.module/i,
    /outcome\.capability\s*=\s*new\.capability/i,
    /outcome\.audience\s*=\s*new\.audience/i,
    /requirement_version\.status\s*=\s*'published'/i,
    /requirement_version\.effective_at\s*<=\s*new\.effective_at/i,
    /requirement_version\.expires_at\s+is null/i,
    /prerequisite\.prerequisite_requirement_version_id\s*=\s*any\(new\.requirement_version_ids\)/i,
  ]) {
    assert.match(issuance, invariant);
  }

  const publication = functionBody("validate_curriculum_graph_publication");
  assert.match(publication, /learning\.requirement_versions/i);
  assert.match(publication, /requirement_version\.status\s*<>\s*'published'/i);
  assert.match(publication, /with recursive/i);
  assert.match(publication, /raise exception/i);
  assert.doesNotMatch(
    publication,
    /mandatory[\s\S]*?curriculum_capability_outcomes|capability outcome/i,
  );
});

test("keeps graph outcomes in parity with the Task 1 catalog and RBAC classification", () => {
  const classifications = new Map(
    [
      ...task1Registry.matchAll(
        /(readCapability|mutationCapability|onboardingWriteCapability)\('([^']+)', '([^']+)'\)/g,
      ),
    ].map((match) => [`${match[2]}:${match[3]}`, match[1]]),
  );
  assert.equal(
    classifications.get("core:manage_own_accreditation_draft"),
    "onboardingWriteCapability",
  );
  assert.equal(
    classifications.get("core:submit_accreditation"),
    "mutationCapability",
  );
  assert.match(
    task1Catalog,
    /kind: "orientation"[\s\S]*?mandatory: true[\s\S]*?capabilityOutcomes: \[\]/,
  );
  assert.match(
    task1Catalog,
    /VENDOR_EVIDENCE_REQUIREMENT_ID[\s\S]*?kind: "attestation"[\s\S]*?mandatory: true[\s\S]*?capabilityOutcomes: \[\]/,
  );
});

test("serializes authority deletion, graph mutation, and graph publication in lock order", () => {
  const issuance = functionBody("validate_certification_issuance");
  const roleLock = issuance.search(/core\.user_roles[\s\S]*?for key share/i);
  const graphLock = issuance.search(
    /private\.lock_learning_curriculum_graph\s*\(/i,
  );
  assert.ok(roleLock >= 0, "issuance must acquire a role-row KEY SHARE lock");
  assert.ok(
    graphLock > roleLock,
    "issuance must lock role authority before curriculum graph rows",
  );

  const graphLocker = functionBody("lock_learning_curriculum_graph");
  assert.match(
    graphLocker,
    /order by curriculum_version\.id[\s\S]*?for update/i,
  );

  for (const guard of [
    "guard_curriculum_composition",
    "validate_curriculum_graph_publication",
  ]) {
    const body = functionBody(guard);
    assert.match(body, /private\.lock_learning_curriculum_graph\s*\(/i, guard);
  }
  assert.match(
    sql,
    /Lock order:[\s\S]*?core\.user_roles[\s\S]*?learning\.curriculum_versions[\s\S]*?learning\.requirement_versions/i,
  );
});

test("revokes certifications only after final role authority loss", () => {
  assert.ok(
    existsSync(roleLifecycleMigration),
    `${ROLE_LIFECYCLE_NAME} must add the forward-safe role lifecycle repair`,
  );
  assert.match(
    roleLifecycleSql,
    /create or replace function private\.lock_certification_role_authority\(\)[\s\S]*?private\.assert_learning_read_committed\(\)[\s\S]*?from core\.roles role_definition[\s\S]*?for share[\s\S]*?from core\.user_roles role_assignment[\s\S]*?for key share[\s\S]*?from core\.role_capabilities role_capability[\s\S]*?for share/i,
  );
  assert.match(
    roleLifecycleSql,
    /create trigger learning_certifications_lock_role_authority\s+before insert on learning\.certifications\s+for each row execute function private\.lock_certification_role_authority\(\)/i,
  );
  assert.match(
    roleLifecycleSql,
    /create or replace function private\.revoke_certifications_for_role_authority_loss\(\)[\s\S]*?private\.assert_learning_read_committed\(\)[\s\S]*?tg_table_name = 'roles'[\s\S]*?from core\.roles final_role[\s\S]*?final_role\.is_active[\s\S]*?tg_table_name = 'role_capabilities'[\s\S]*?from core\.role_capabilities final_capability[\s\S]*?update learning\.certifications[\s\S]*?status = 'revoked'/i,
  );
  for (const [trigger, table, event] of [
    ["learning_role_deactivation_revoke", "roles", "update of is_active"],
    [
      "learning_role_capability_removal_revoke",
      "role_capabilities",
      "delete or update",
    ],
  ]) {
    assert.match(
      roleLifecycleSql,
      new RegExp(
        `create constraint trigger ${trigger}\\s+after ${event} on core\\.${table}\\s+deferrable initially deferred\\s+for each row execute function private\\.revoke_certifications_for_role_authority_loss\\(\\)`,
        "i",
      ),
      trigger,
    );
  }
  assert.match(
    roleLifecycleSql,
    /drop trigger if exists learning_curriculum_requirement_prerequisites_read_committed_guard\s+on learning\.curriculum_requirement_prerequisites[\s\S]*?create trigger learning_curr_req_prereq_read_committed_guard/i,
  );
});

test("rejects weakened role-authority lifecycle guards", () => {
  const immediate = replaceRequired(
    roleLifecycleSql,
    /deferrable initially deferred/i,
    "not deferrable",
  );
  assert.match(
    errorsForRoleLifecycle(immediate),
    /must be deferred|deferred constraint trigger|final-state trigger/i,
  );

  const forgedFinalCapability = replaceRequired(
    roleLifecycleSql,
    /if exists \(\s*select 1\s*from core\.role_capabilities final_capability[\s\S]*?\) then\s*return null;\s*end if;/i,
    "if false then return null; end if;",
  );
  assert.match(
    errorsForRoleLifecycle(forgedFinalCapability),
    /exact.*function body|final.*capability|authority.*revocation/i,
  );

  const earlyReturn = replaceRequired(
    roleLifecycleSql,
    /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)[\s\S]*?perform private\.assert_learning_read_committed\(\);)/i,
    "$1\n  if 2 > 1 then return null; end if;",
  );
  assert.match(
    errorsForRoleLifecycle(earlyReturn),
    /exact.*function body|authority.*revocation|control-flow/i,
  );

  assert.match(
    orderedErrors(
      "drop trigger learning_certifications_lock_role_authority on learning.certifications;",
    ),
    /lock_role_authority|role authority|trigger/i,
  );
});

test("pins complete modeled function catalog metadata", () => {
  const declarationMutations = [
    [
      /create or replace function private\.revoke_certifications_for_role_authority_loss\(\)/i,
      'create or replace function "Private"."revoke_certifications_for_role_authority_loss"()',
      "schema and name",
    ],
    [
      /create or replace function private\.revoke_certifications_for_role_authority_loss\(\)/i,
      "create function private.revoke_certifications_for_role_authority_loss()",
      "replacement form",
    ],
    [
      /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)\s*returns trigger\s*language plpgsql)\s*security definer/i,
      "$1\nstable\nsecurity definer",
      "STABLE",
    ],
    [
      /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)\s*returns trigger\s*language plpgsql)\s*security definer/i,
      "$1\nimmutable\nsecurity definer",
      "IMMUTABLE",
    ],
    [
      /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)\s*returns trigger\s*language plpgsql\s*security definer\s*set search_path = )''/i,
      "$1'', public",
      "expanded search_path",
    ],
    [
      /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)\s*returns trigger\s*language plpgsql\s*security definer\s*set search_path = ''\s*)as \$\$/i,
      (_match, declaration) => `${declaration}set row_security = off\nas $$`,
      "extra privileged SET",
    ],
    [
      /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)\s*)returns trigger/i,
      "$1returns boolean",
      "return type",
    ],
    [
      /create or replace function private\.revoke_certifications_for_role_authority_loss\(\)/i,
      "create or replace function private.revoke_certifications_for_role_authority_loss(dummy boolean)",
      "argument types",
    ],
    [
      /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)\s*returns trigger\s*)language plpgsql/i,
      "$1language sql",
      "language",
    ],
    [
      /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)\s*returns trigger\s*language plpgsql\s*)security definer/i,
      "$1security invoker",
      "security mode",
    ],
    [
      /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)\s*returns trigger\s*language plpgsql\s*)security definer/i,
      "$1leakproof\nsecurity definer",
      "leakproof",
    ],
    [
      /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)\s*returns trigger\s*language plpgsql\s*)security definer/i,
      "$1parallel safe\nsecurity definer",
      "parallel mode",
    ],
    [
      /(create or replace function private\.revoke_certifications_for_role_authority_loss\(\)\s*returns trigger\s*language plpgsql\s*)security definer/i,
      "$1strict\nsecurity definer",
      "strictness",
    ],
  ];

  for (const [pattern, replacement, label] of declarationMutations) {
    const mutated = replaceRequired(roleLifecycleSql, pattern, replacement);
    assert.match(
      errorsForRoleLifecycle(mutated),
      /function.*(?:declaration|metadata|signature|configuration)|proconfig|search_path/i,
      label,
    );
  }

  const wrongPrivilegeSignature = replaceRequired(
    sql,
    /revoke all on function private\.learning_has_active_profile\(text\)/i,
    "revoke all on function private.learning_has_active_profile(uuid)",
  );
  assert.match(
    errorsFor(wrongPrivilegeSignature),
    /function.*(?:signature|identity)|privilege.*target/i,
  );
});

test("reconciles existing invalid certifications with attributable evidence", () => {
  assert.match(
    roleLifecycleSql,
    /alter table learning\.certifications\s+add column if not exists revocation_reason text/i,
  );
  assert.match(
    roleLifecycleSql,
    /update learning\.certifications certification[\s\S]*?status = 'revoked'[\s\S]*?revoked_at = pg_catalog\.clock_timestamp\(\)[\s\S]*?revocation_reason[\s\S]*?from core\.roles[\s\S]*?core\.role_capabilities/i,
  );

  const withoutReconciliation = replaceRequired(
    roleLifecycleSql,
    /update learning\.certifications certification[\s\S]*?;(?=\s*(?:alter table|create|revoke|drop))/i,
    "",
  );
  assert.match(
    errorsForRoleLifecycle(withoutReconciliation),
    /existing active certification|one-time.*reconcil|authority reconciliation/i,
  );

  const withoutAttribution = replaceRequired(
    roleLifecycleSql,
    /revocation_reason = case[\s\S]*?end(?=\s*where certification\.status = 'active')/i,
    "revocation_reason = null",
  );
  assert.match(
    errorsForRoleLifecycle(withoutAttribution),
    /revocation.*reason|attribut|authority reconciliation/i,
  );

  const overBroadReconciliation = replaceRequired(
    roleLifecycleSql,
    /  \);\n\nalter table learning\.certifications\n  add constraint certifications_revocation_reason_check/i,
    "  ) or certification.status = 'active';\n\nalter table learning.certifications\n  add constraint certifications_revocation_reason_check",
  );
  assert.match(
    errorsForRoleLifecycle(overBroadReconciliation),
    /existing active certification|authority reconciliation|exact.*reconcil/i,
  );
});

test("binds certifications to immutable exact role-assignment lineage", () => {
  assert.ok(
    existsSync(assignmentLineageMigration),
    `${ASSIGNMENT_LINEAGE_NAME} must be a later forward migration`,
  );
  assert.match(
    assignmentLineageSql,
    /create or replace function private\.guard_role_assignment_identity\(\)[\s\S]*?new\.id is distinct from old\.id[\s\S]*?new\.user_id is distinct from old\.user_id[\s\S]*?new\.module is distinct from old\.module[\s\S]*?new\.role is distinct from old\.role[\s\S]*?raise exception 'Role assignment identity is immutable/i,
  );
  assert.match(
    assignmentLineageSql,
    /create trigger learning_guard_role_assignment_identity\s+before update of id, user_id, module, role on core\.user_roles\s+for each row execute function private\.guard_role_assignment_identity\(\)/i,
  );
  assert.match(
    assignmentLineageSql,
    /update learning\.certifications certification[\s\S]*?revocation_reason = case[\s\S]*?system:source_role_assignment_missing[\s\S]*?system:source_role_assignment_identity_mismatch[\s\S]*?from core\.user_roles source_assignment[\s\S]*?source_assignment\.id = certification\.source_role_assignment_id[\s\S]*?source_assignment\.user_id = certification\.user_id[\s\S]*?source_assignment\.module = certification\.module[\s\S]*?source_assignment\.role = certification\.source_role/i,
  );

  for (const predicate of [
    /source_assignment\.id = certification\.source_role_assignment_id/i,
    /source_assignment\.user_id = certification\.user_id/i,
    /source_assignment\.module = certification\.module/i,
    /source_assignment\.role = certification\.source_role/i,
  ]) {
    const weakened = replaceRequired(assignmentLineageSql, predicate, "true");
    assert.match(
      errorsForAssignmentLineage(weakened),
      /assignment.*lineage|exact.*assignment|reconciliation/i,
      String(predicate),
    );
  }

  const mutableIdentity = replaceRequired(
    assignmentLineageSql,
    /new\.role is distinct from old\.role/i,
    "false",
  );
  assert.match(
    errorsForAssignmentLineage(mutableIdentity),
    /assignment.*identity|immutable|function body/i,
  );

  const inertIdentityTrigger = replaceRequired(
    assignmentLineageSql,
    /on core\.user_roles\s+for each row execute function private\.guard_role_assignment_identity\(\)/i,
    "on core.user_roles when (false) for each row execute function private.guard_role_assignment_identity()",
  );
  assert.match(
    errorsForAssignmentLineage(inertIdentityTrigger),
    /trigger.*predicate|when.*not allowed|unconsumed trigger clause|weakened trigger/i,
  );
});

test("removes TRUNCATE from supported authority paths permanently", () => {
  for (const table of ["roles", "role_capabilities", "user_roles"]) {
    assert.match(
      roleLifecycleSql,
      new RegExp(
        `revoke truncate on table core\\.${table}\\s+from public, anon, authenticated, service_role`,
        "i",
      ),
      table,
    );

    const withoutRevoke = replaceRequired(
      roleLifecycleSql,
      new RegExp(
        `revoke truncate on table core\\.${table}\\s+from public, anon, authenticated, service_role\\s*;`,
        "i",
      ),
      "",
    );
    assert.match(
      errorsForRoleLifecycle(withoutRevoke),
      /truncate.*core\.|authority table.*truncate|row-level/i,
      table,
    );
  }

  for (const restoration of [
    "grant truncate on table core.role_capabilities to service_role;",
    "grant all privileges on table core.roles to service_role;",
    "grant all privileges on all tables in schema core to service_role;",
    "alter default privileges in schema core grant truncate on tables to service_role;",
    "alter default privileges in schema core grant all privileges on tables to service_role;",
  ]) {
    assert.match(
      orderedErrors(restoration),
      /truncate|default privileges|authority.*privilege|row-level/i,
      restoration,
    );
  }
});

test("indexes active certifications for role and capability revocation", () => {
  assert.match(
    roleLifecycleSql,
    /create index learning_active_certifications_role_authority_idx\s+on learning\.certifications\s*\(module, source_role, capability\)\s+where status = 'active'/i,
  );

  const withoutAuthorityIndex = replaceRequired(
    roleLifecycleSql,
    /create index learning_active_certifications_role_authority_idx[\s\S]*?;/i,
    "",
  );
  assert.match(
    errorsForRoleLifecycle(withoutAuthorityIndex),
    /active certification.*role authority.*index|missing.*role.*capability.*index/i,
  );
});

test("wires the environment-independent lifecycle test into root verification", () => {
  assert.equal(
    packageJson.scripts["verify:learning-role-lifecycle"],
    "node --test scripts/verify-learning-role-lifecycle.test.mjs",
  );
  assert.match(
    packageJson.scripts["verify:learning-schema"],
    /verify-learning-schema\.mjs[\s\S]*verify:learning-role-lifecycle/,
  );
});

test("rejects unsupported isolation on every authoritative mutation path", () => {
  const isolationGuard = functionBody("assert_learning_read_committed");
  assert.match(
    isolationGuard,
    /current_setting\('transaction_isolation'\)[\s\S]*?<>\s*'read committed'/i,
  );
  assert.match(isolationGuard, /raise exception/i);

  const triggerFunctions = new Set(
    [
      ...sql.matchAll(
        /create trigger learning_[a-z_]+[\s\S]*?execute function (?:learning|private)\.([a-z_]+)\(\);/gi,
      ),
    ].map((match) => match[1]),
  );
  for (const name of triggerFunctions) {
    assert.match(
      functionBody(name),
      /private\.assert_learning_read_committed\(\)/i,
      name,
    );
  }
  for (const table of REQUIRED_TABLES) {
    const triggerName =
      table === "curriculum_requirement_prerequisites"
        ? "learning_curr_req_prereq_read_committed_guard"
        : `learning_${table}_read_committed_guard`;
    assert.match(
      sql,
      new RegExp(
        `create trigger ${triggerName}[\\s\\S]*?before insert or update or delete on learning\\.${table}[\\s\\S]*?learning\\.guard_authoritative_write_isolation\\(\\)`,
        "i",
      ),
      table,
    );
  }
  assert.match(
    sql,
    /Supported isolation:[\s\S]*?READ COMMITTED[\s\S]*?Lock order:/i,
  );

  const unguardedFunction = replaceRequired(
    sql,
    /(create or replace function learning\.guard_attempt_lifecycle\(\)[\s\S]*?as \$\$\s*begin\s*)perform private\.assert_learning_read_committed\(\);/i,
    "$1",
  );
  assert.match(
    errorsFor(unguardedFunction),
    /guard_attempt_lifecycle.*read committed|authoritative mutation function/i,
  );

  const unguardedTable = replaceRequired(
    sql,
    /create trigger learning_attempt_events_read_committed_guard[\s\S]*?;/i,
    "",
  );
  assert.match(
    errorsFor(unguardedTable),
    /missing or weakened trigger.*read_committed_guard/i,
  );
});

test("keeps every trigger identifier catalog-stable", () => {
  const triggerNames = [
    ...`${sql}\n${roleLifecycleSql}`.matchAll(
      /^create (?:constraint )?trigger ([a-z_]+)/gim,
    ),
  ].map((match) => match[1]);
  assert.ok(triggerNames.length > 0);
  for (const name of triggerNames) {
    assert.ok(
      Buffer.byteLength(name, "utf8") <= 63,
      `${name} exceeds PostgreSQL's 63-byte identifier limit`,
    );
  }
});

test("keeps authenticated content access read-only for attributable future RPCs", () => {
  assert.doesNotMatch(
    sql,
    /grant\s+(?:insert|update|delete|[^;]*,\s*(?:insert|update|delete))[^;]*on learning\.[a-z_]+ to authenticated/i,
  );
  for (const table of REQUIRED_TABLES) {
    assert.match(
      sql,
      new RegExp(`grant select on learning\\.${table} to authenticated;`, "i"),
      table,
    );
  }
});

test("requires one active-profile helper in every authenticated policy path", () => {
  const policies = [
    ...sql.matchAll(
      /create policy ([a-z_]+) on learning\.[a-z_]+[\s\S]*?\n\);/gi,
    ),
  ];
  assert.ok(policies.length > 0);
  for (const policy of policies) {
    assert.match(
      policy[0],
      /private\.learning_has_active_profile\s*\(/i,
      policy[1],
    );
  }
  assert.match(
    functionBody("learning_has_active_profile"),
    /profile\.status\s*=\s*'active'/i,
  );

  const branchBypass = replaceRequired(
    sql,
    /create policy learning_assignments_learner_read[\s\S]*?\n\);/i,
    `create policy learning_assignments_learner_read on learning.assignments
for select to authenticated
using (
  (
    user_id = (select auth.uid())
    and private.learning_has_active_profile(audience)
    and not core.is_vendor()
  )
  or (user_id = (select auth.uid()) and not core.is_vendor())
);`,
  );
  assert.match(
    errorsFor(branchBypass),
    /active profile.*every.*path|policy.*active profile/i,
  );
});

test("accepts only a bare positive active-profile policy atom", () => {
  const activeProfileAtom = /private\.learning_has_active_profile\(audience\)/i;
  for (const wrapped of [
    "private.learning_has_active_profile(audience) is not null",
    "private.learning_has_active_profile(audience) is distinct from true",
    "coalesce(private.learning_has_active_profile(audience), true)",
    "private.learning_has_active_profile(audience) = true",
  ]) {
    const weakened = replaceRequired(sql, activeProfileAtom, wrapped);
    assert.match(
      errorsFor(weakened),
      /exact positive|bare positive|active profile.*authorization path/i,
      wrapped,
    );
  }
});

test("rejects vendor waivers and makes assignment terminal evidence monotonic", () => {
  assert.match(
    functionBody("validate_assignment_requirement_waiver"),
    /requirement_version\.audience\s*=\s*'vendor'[\s\S]*?raise exception/i,
  );
  for (const guard of [
    "guard_assignment_lifecycle",
    "guard_assignment_requirement_lifecycle",
  ]) {
    const body = functionBody(guard);
    assert.match(body, /tg_op\s*=\s*'DELETE'/i, guard);
    assert.match(body, /terminal[\s\S]*?immutable/i, guard);
    assert.match(body, /raise exception/i, guard);
  }
  const certifications = sql.match(
    /create table learning\.certifications\s*\([\s\S]*?\n\);/i,
  )?.[0];
  const exceptions = sql.match(
    /create table learning\.emergency_exceptions\s*\([\s\S]*?\n\);/i,
  )?.[0];
  assert.match(
    certifications ?? "",
    /revoked_at is null or revoked_at >= issued_at/i,
  );
  assert.match(
    certifications ?? "",
    /superseded_at is null or superseded_at >= issued_at/i,
  );
  assert.match(
    exceptions ?? "",
    /revoked_at is null[\s\S]*?revoked_at >= created_at[\s\S]*?revoked_at >= approved_at/i,
  );
  assert.doesNotMatch(
    exceptions ?? "",
    /revoked_at is null or revoked_at >= effective_at/i,
  );
  assert.match(
    functionBody("guard_emergency_exception_lifecycle"),
    /new\.revoked_at\s*:=\s*pg_catalog\.clock_timestamp\(\)/i,
  );
  assert.match(
    functionBody("validate_emergency_exception_issuance"),
    /new\.status\s*<>\s*'active'[\s\S]*?new\.revoked_at\s+is not null[\s\S]*?raise exception/i,
  );
});

test("declares every governed table with UUID identity, timestamp, and terminal RLS", () => {
  for (const table of REQUIRED_TABLES) {
    const tableSql = sql.match(
      new RegExp(
        `create table learning\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,
        "i",
      ),
    )?.[0];
    assert.ok(tableSql, `Missing learning.${table}.`);
    assert.match(tableSql, /id uuid primary key default gen_random_uuid\(\)/i);
    assert.match(tableSql, /created_at timestamptz not null default now\(\)/i);
  }

  const disabled = `${sql}\nalter table learning.certifications disable row level security;`;
  assert.match(errorsFor(disabled), /certifications.*RLS.*disabled/i);

  const commentedOnly = replaceRequired(
    sql,
    /alter table learning\.attempts enable row level security;/i,
    "-- alter table learning.attempts enable row level security;",
  );
  assert.match(errorsFor(commentedOnly), /attempts.*enable RLS/i);
});

test("rejects unknown permissive policies and evaluates each policy as a bounded statement", () => {
  const permissive = `${sql}\ncreate policy learning_certifications_open_read on learning.certifications for select to authenticated using (true);`;
  assert.match(errorsFor(permissive), /unknown.*policy|permissive.*policy/i);

  const nestedTrue = replaceRequired(
    sql,
    /create policy learning_curricula_published_read[\s\S]*?\n\);/i,
    "create policy learning_curricula_published_read on learning.curricula for select to authenticated using (((true)));",
  );
  assert.match(
    errorsFor(nestedTrue),
    /curricula.*published.*policy|permissive.*policy/i,
  );

  const weakenedLearner = replaceRequired(
    sql,
    /create policy learning_assignments_learner_read[\s\S]*?\n\);/i,
    "create policy learning_assignments_learner_read on learning.assignments for select to authenticated using (true);",
  );
  assert.match(
    errorsFor(weakenedLearner),
    /assignments.*learner.*policy|learner.*assignment.*policy/i,
  );
});

test("rejects every direct evidence-write grant spelling and unsafe grantee", () => {
  const mutations = [
    "grant insert, update on learning.certifications to authenticated;",
    "grant all privileges on learning.attempt_events to authenticated;",
    "grant insert on learning.policy_acknowledgments to public;",
    "grant update on learning.assignment_requirements to authenticated;",
    "grant truncate on learning.attempts to service_role;",
  ];

  for (const grant of mutations) {
    assert.match(
      errorsFor(`${sql}\n${grant}`),
      /unsafe.*grant|privilege|grant.*learning/i,
      grant,
    );
  }
});

test("uses exact least-privilege service grants with no evidence TRUNCATE", () => {
  assert.doesNotMatch(sql, /grant\s+all(?:\s+privileges)?\s+on\s+learning\./i);
  for (const table of [
    "attempts",
    "attempt_events",
    "policy_acknowledgments",
    "certifications",
    "emergency_exceptions",
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`grant[\\s\\S]*?truncate[\\s\\S]*?learning\\.${table}`, "i"),
    );
  }
  assert.match(
    sql,
    /grant select, insert, update on learning\.attempts to service_role;/i,
  );
  assert.match(
    sql,
    /grant select, insert on learning\.attempt_events to service_role;/i,
  );
});

test("detaches certification history from live role deletion and validates issuance", () => {
  assert.doesNotMatch(
    sql,
    /foreign key\s*\([^)]*source_role_assignment_id[^)]*\)[\s\S]*?references core\.user_roles/i,
  );
  assert.match(
    sql,
    /create trigger learning_certifications_validate_issuance[\s\S]*?before insert on learning\.certifications[\s\S]*?private\.validate_certification_issuance\(\)/i,
  );
  assert.match(
    sql,
    /create trigger learning_revoke_certifications_on_role_delete[\s\S]*?before delete on core\.user_roles[\s\S]*?private\.revoke_certifications_for_role_assignment\(\)/i,
  );

  const body = functionBody("validate_certification_issuance");
  for (const requirement of [
    /core\.user_roles/i,
    /profile\.status\s*<>\s*'active'/i,
    /core\.role_capabilities/i,
    /learning\.role_curricula/i,
    /learning\.curriculum_versions/i,
    /curriculum_version\.status\s*=\s*'published'/i,
    /candidate\.curriculum_version_id\s*=\s*new\.curriculum_version_id/i,
    /learning\.curriculum_requirements/i,
    /learning\.assignment_requirements/i,
  ]) {
    assert.match(body, requirement);
  }
  assert.match(
    functionBody("revoke_certifications_for_role_assignment"),
    /update learning\.certifications[\s\S]*?status = 'revoked'[\s\S]*?source_role_assignment_id = old\.id/i,
  );
});

test("structurally binds requirement-version department ownership and authorizes from its parent", () => {
  assert.match(
    sql,
    /constraint requirement_versions_department_owner_fk\s+foreign key\s*\(\s*requirement_id\s*,\s*audience\s*,\s*requirement_kind\s*,\s*governance_owner\s*,\s*owner_department_id\s*\)[\s\S]*?references learning\.requirements\s*\(\s*id\s*,\s*audience\s*,\s*requirement_kind\s*,\s*governance_owner\s*,\s*owner_department_id\s*\)/i,
  );
  assert.match(
    sql,
    /create policy learning_requirement_versions_owner_manage[\s\S]*?from learning\.requirements parent_requirement[\s\S]*?parent_requirement\.owner_department_id/i,
  );
});

test("freezes curriculum composition after approval and verifies active guard bodies", () => {
  assert.match(
    sql,
    /create trigger learning_curriculum_requirements_composition_guard[\s\S]*?before insert or update or delete on learning\.curriculum_requirements[\s\S]*?learning\.guard_curriculum_composition\(\)/i,
  );
  const body = functionBody("guard_curriculum_composition");
  assert.match(body, /approved.*scheduled.*published.*superseded.*retired/is);
  assert.match(body, /raise exception/i);

  const inert = replaceRequired(
    sql,
    /create or replace function learning\.guard_curriculum_composition\(\)[\s\S]*?\$\$;/i,
    "create or replace function learning.guard_curriculum_composition() returns trigger language plpgsql as $$ begin return new; end; $$;",
  );
  assert.match(
    errorsFor(inert),
    /composition.*guard.*inert|composition.*immutable/i,
  );
});

test("rejects all prohibited waivers, including service-written Legal policy waivers", () => {
  assert.match(
    sql,
    /create trigger learning_assignment_requirements_validate_waiver[\s\S]*?before insert or update[\s\S]*?on learning\.assignment_requirements[\s\S]*?private\.validate_assignment_requirement_waiver\(\)/i,
  );
  const body = functionBody("validate_assignment_requirement_waiver");
  assert.match(body, /not requirement_version\.waivable/i);
  assert.match(body, /governance_owner\s*=\s*'legal'/i);
  assert.match(body, /requirement_kind\s*=\s*'policy'/i);
  assert.match(body, /raise exception/i);
});

test("allows only one in-progress-to-terminal attempt transition", () => {
  assert.match(
    sql,
    /create trigger learning_attempts_lifecycle_guard[\s\S]*?before insert or update or delete on learning\.attempts[\s\S]*?learning\.guard_attempt_lifecycle\(\)/i,
  );
  const body = functionBody("guard_attempt_lifecycle");
  assert.match(body, /old\.status\s*<>\s*'in_progress'/i);
  assert.match(
    body,
    /new\.status\s+not in\s*\(\s*'passed'.*'failed'.*'abandoned'.*'invalidated'/is,
  );
  assert.match(
    body,
    /array\['status', 'score', 'integrity_result', 'submitted_at', 'completed_at'\]/i,
  );
  assert.match(body, /raise exception/i);
});

test("keeps events and acknowledgments append-only with non-inert guards", () => {
  for (const table of ["attempt_events", "policy_acknowledgments"]) {
    assert.match(
      sql,
      new RegExp(
        `create trigger learning_${table}_append_only[\\s\\S]*?before update or delete on learning\\.${table}[\\s\\S]*?learning\\.reject_evidence_mutation\\(\\)`,
        "i",
      ),
    );
  }
  assert.match(functionBody("reject_evidence_mutation"), /raise exception/i);

  const inert = replaceRequired(
    sql,
    /create or replace function learning\.reject_evidence_mutation\(\)[\s\S]*?\$\$;/i,
    "create or replace function learning.reject_evidence_mutation() returns trigger language plpgsql as $$ begin -- raise exception 'append-only';\nreturn new; end; $$;",
  );
  assert.match(errorsFor(inert), /append-only.*guard.*inert|evidence.*guard/i);
});

test("completes structural audience isolation and rejects vendor Platform profiles", () => {
  for (const relationship of [
    /foreign key \(supersedes_id, audience\)[\s\S]*?references learning\.curriculum_versions\(id, audience\)/i,
    /foreign key \(supersedes_id, audience\)[\s\S]*?references learning\.requirement_versions\(id, audience\)/i,
    /foreign key \(superseded_by_id, user_id, department_id, audience\)[\s\S]*?references learning\.assignments\(id, user_id, department_id, audience\)/i,
    /foreign key \(user_id, profile_kind\)[\s\S]*?references core\.profiles\(id, kind\)/i,
  ]) {
    assert.match(sql, relationship);
  }
  assert.match(
    sql,
    /constraint assignments_profile_audience_check[\s\S]*?profile_kind = 'employee'.*audience = 'internal'.*profile_kind = 'vendor'.*audience = 'vendor'/is,
  );
  assert.match(
    functionBody("learning_is_active_employee_platform_admin"),
    /private\.learning_has_active_profile\('internal'\)[\s\S]*?core\.has_cap\('core', 'manage_rbac'\)/i,
  );
});

test("validates emergency grantor, approver, beneficiary, scope, and chronology", () => {
  const body = functionBody("validate_emergency_exception_issuance");
  for (const requirement of [
    /grantor_profile\.kind\s*=\s*'employee'/i,
    /grantor_profile\.status\s*=\s*'active'/i,
    /grantor_role\.role\s*=\s*'platform_admin'/i,
    /approver_profile\.kind\s*=\s*'employee'/i,
    /approver_profile\.status\s*=\s*'active'/i,
    /approver_scope\.department_id\s*=\s*new\.department_id/i,
    /approver_capability\.cap\s*=\s*new\.capability/i,
  ]) {
    assert.match(body, requirement);
  }
  assert.match(
    sql,
    /grantor_id <> approver_id[\s\S]*?grantor_id <> user_id[\s\S]*?approver_id <> user_id/i,
  );
  assert.match(
    sql,
    /approved_at >= created_at[\s\S]*?approved_at <= effective_at[\s\S]*?expires_at <= effective_at \+ interval '24 hours'/i,
  );
});

test("enforces lifecycle transitions and timestamp chronology", () => {
  const contentBody = functionBody("guard_content_lifecycle");
  assert.match(contentBody, /tg_op = 'INSERT'.*new\.status <> 'draft'/is);
  assert.match(contentBody, /old\.status = 'draft'.*new\.status.*in_review/is);
  assert.match(
    contentBody,
    /old\.status = 'in_review'.*new\.status.*approved/is,
  );
  assert.match(contentBody, /finalized learning content is immutable/i);

  for (const chronology of [
    /published_at >= approved_at/i,
    /published_at <= effective_at/i,
    /issued_at <= created_at/i,
    /issued_at <= effective_at/i,
    /started_at <= submitted_at/i,
    /submitted_at <= completed_at/i,
  ]) {
    assert.match(sql, chronology);
  }
});

test("qualifies outer policy correlations", () => {
  assert.match(
    sql,
    /version\.id = learning\.curriculum_requirements\.curriculum_version_id/i,
  );
  assert.match(
    sql,
    /requirement_version\.id = learning\.policy_acknowledgments\.requirement_version_id/i,
  );
  assert.doesNotMatch(sql, /version\.id = curriculum_version_id\b/i);
  assert.doesNotMatch(
    sql,
    /requirement_version\.id = requirement_version_id\b/i,
  );
});

test("indexes every foreign key by its complete leading child columns", () => {
  const withoutAssignmentCurriculumIndex = replaceRequired(
    sql,
    /create index learning_assignments_curriculum_fk_idx[\s\S]*?;/i,
    "",
  );
  assert.match(
    errorsFor(withoutAssignmentCurriculumIndex),
    /assignments_curriculum_fk.*leading.*index|missing.*index.*assignments_curriculum_fk/i,
  );
});

test("preserves business uniqueness and certification authority isolation", () => {
  assert.match(
    sql,
    /create unique index learning_one_active_certification_idx\s+on learning\.certifications\s*\(user_id, department_id, module, capability, source_role_assignment_id\)\s+where status = 'active'/i,
  );
  assert.match(
    sql,
    /create unique index learning_one_open_assignment_idx\s+on learning\.assignments\s*\(user_id, curriculum_version_id, source_type, source_id\)\s+where status in \('assigned', 'in_progress', 'blocked'\)/i,
  );
  assert.doesNotMatch(
    sql,
    /insert into core\.user_roles[\s\S]*?from learning\.certifications|insert into core\.profile_department_scopes[\s\S]*?from learning\.certifications/i,
  );
});

test("evaluates ordered later migrations and rejects terminal weakening", () => {
  const weakenings = [
    "alter table learning.certifications disable row level security;",
    "create policy learning_attempts_open on learning.attempts for select to public using (true);",
    "grant all privileges on learning.assignment_requirements to public;",
    "drop trigger learning_attempt_events_append_only on learning.attempt_events;",
    "create or replace function learning.reject_evidence_mutation() returns trigger language plpgsql as $$ begin return new; end; $$;",
    "alter table learning.certifications drop constraint certifications_assignment_fk;",
    "alter table learning.assignments drop column audience;",
    "alter trigger learning_attempt_events_append_only on learning.attempt_events rename to learning_attempt_events_unchecked;",
    "grant select on all tables in schema learning to public;",
    "alter table learning.certifications add constraint certifications_live_role_fk foreign key (source_role_assignment_id) references core.user_roles(id) on delete restrict;",
  ];

  for (const weakening of weakenings) {
    assert.match(
      orderedErrors(weakening),
      /RLS|policy|grant|trigger|guard|constraint|weakening/i,
      weakening,
    );
  }
});

test("rejects round-two policy, function, trigger, DDL, grantee, and role bypasses", () => {
  const bypasses = [
    {
      sql: replaceRequired(
        sql,
        /create policy learning_assignments_learner_read[\s\S]*?\n\);/i,
        "create policy learning_assignments_learner_read on learning.assignments for select to authenticated using (user_id = (select auth.uid()) and private.learning_has_active_profile(audience) or true);",
      ),
      error: /tautolog|permissive|policy/i,
    },
    {
      sql: replaceRequired(
        sql,
        /create policy learning_assignments_learner_read[\s\S]*?\n\);/i,
        "create policy learning_assignments_learner_read on learning.assignments for select to authenticated using (user_id = (select auth.uid()) and private.learning_has_active_profile(audience) or 1 = 1);",
      ),
      error: /tautolog|permissive|policy/i,
    },
    {
      sql: `${sql}\ncreate function private.learning_dump() returns setof learning.certifications language sql security definer set search_path = '' as $$ select * from learning.certifications $$;`,
      error:
        /unknown.*security definer|privileged.*function|function.*learning/i,
    },
    {
      sql: `${sql}\ncreate function private.quoted_learning_dump() returns setof uuid language sql security definer set search_path = '' as $$ select id from "learning"."certifications" $$; revoke all on function private.quoted_learning_dump() from public;`,
      error:
        /unknown.*security definer|privileged.*function|function.*learning/i,
    },
    {
      sql: `${sql}\ngrant execute on function private.validate_certification_issuance() to authenticated;`,
      error: /execute|function.*grant/i,
    },
    {
      sql: replaceRequired(
        sql,
        /create or replace function learning\.reject_evidence_mutation\(\)[\s\S]*?\$\$;/i,
        "create or replace function learning.reject_evidence_mutation() returns trigger language plpgsql as $$ begin if false then raise exception 'append-only'; end if; return new; end; $$;",
      ),
      error: /unreachable|inert|guard/i,
    },
    {
      sql: replaceRequired(
        sql,
        /create or replace function learning\.reject_evidence_mutation\(\)[\s\S]*?\$\$;/i,
        "create or replace function learning.reject_evidence_mutation() returns trigger language plpgsql as $$ begin return new; if true then raise exception 'append-only'; end if; end; $$;",
      ),
      error: /unreachable|inert|guard/i,
    },
  ];

  for (const bypass of bypasses) {
    assert.match(errorsFor(bypass.sql), bypass.error);
  }

  const laterBypasses = [
    "alter table learning.attempt_events enable replica trigger learning_attempt_events_append_only;",
    "drop index if exists learning.learning_assignments_curriculum_fk_idx cascade;",
    "drop index concurrently if exists learning_assignments_curriculum_fk_idx;",
    "alter table learning.certifications add foreign key (source_role_assignment_id) references core.user_roles(id);",
    "grant select on learning.certifications to reporting_login;",
    "alter role reporting_login bypassrls;",
    "create role learning_backdoor login bypassrls;",
  ];
  for (const weakening of laterBypasses) {
    assert.match(
      orderedErrors(weakening),
      /trigger|index|role assignment|user_roles|grantee|grant|bypassrls|role/i,
      weakening,
    );
  }
});

test("pins modeled function security mode and rejects overload shadowing", () => {
  const securityInvoker = replaceRequired(
    sql,
    /(create or replace function private\.learning_has_active_profile\([^]*?\bstable\s+)security definer/i,
    "$1security invoker",
  );
  assert.match(
    errorsFor(securityInvoker),
    /security definer|security mode|function metadata/i,
  );

  const exactRejectBody = functionBody("reject_evidence_mutation").trim();
  assert.match(
    orderedErrors(`
      create or replace function learning.reject_evidence_mutation()
      returns trigger language plpgsql set search_path = '' as $$
      begin
        perform private.assert_learning_read_committed();
        return new;
        raise exception 'Authoritative learning evidence is append-only';
      end;
      $$;

      create or replace function learning.reject_evidence_mutation(dummy boolean)
      returns trigger language plpgsql set search_path = '' as $$
      ${exactRejectBody}
      $$;
    `),
    /replacement|overload|duplicate.*function|function declaration/i,
  );
});

test("default-denies round-three view, procedural, privilege, and role bypasses", () => {
  const laterBypasses = [
    "create view learning.certification_export with (security_invoker = false) as select * from learning.certifications; grant select on learning.certification_export to authenticated;",
    "create materialized view public.learning_evidence_cache as select * from learning.attempt_events; grant select on public.learning_evidence_cache to authenticated;",
    "do $$ begin execute 'alter table learning.certifications disable row level security'; end $$;",
    "grant service_role to authenticated;",
    "set role service_role;",
    "create procedure private.learning_backdoor() language plpgsql as $$ begin execute 'alter table learning.attempts disable row level security'; end $$;",
    "create event trigger learning_ddl_backdoor on ddl_command_end execute function private.learning_dump();",
    "alter default privileges in schema learning grant select on tables to authenticated;",
    "alter table learning.certifications disable trigger learning_unmodeled_side_effect;",
    "alter table core.capabilities disable trigger user;",
    "grant select on learning.certifications to authenticated with grant option;",
    "grant execute on function private.assert_learning_read_committed() to service_role with grant option;",
    "create or replace function learning.reject_evidence_mutation() returns trigger language plpgsql set search_path = '' as $$ begin perform private.assert_learning_read_committed(); execute 'alter table learning.certifications disable row level security'; raise exception 'Authoritative learning evidence is append-only'; end; $$;",
  ];
  for (const bypass of laterBypasses) {
    assert.match(
      orderedErrors(bypass),
      /unmodeled|view|procedural|privilege|role|statement|unsafe|default-deny|grant option|delegated|replacement|overload/i,
      bypass,
    );
  }

  for (const appendedBypass of [
    "create view learning.foundation_export as select * from learning.certifications;",
    "do $$ begin execute 'alter table learning.certifications disable row level security'; end $$;",
    "grant service_role to authenticated;",
  ]) {
    assert.match(
      errorsFor(`${sql}\n${appendedBypass}`),
      /unmodeled|view|procedural|role|statement|unsafe|default-deny/i,
      appendedBypass,
    );
  }

  const negatedProfile = replaceRequired(
    sql,
    /private\.learning_has_active_profile\(audience\)/i,
    "not private.learning_has_active_profile(audience)",
  );
  assert.match(
    errorsFor(negatedProfile),
    /positive|negated|active profile|authorization path/i,
  );

  for (const earlyReturn of [
    "if true then return new; end if;",
    "if 1 = 1 then return new; end if;",
    "case when true then return new; end case;",
    "if 2 > 1 then begin if 3 > 2 then return new; end if; end; end if;",
  ]) {
    const inert = replaceRequired(
      sql,
      /create or replace function learning\.reject_evidence_mutation\(\)[\s\S]*?\$\$;/i,
      `create or replace function learning.reject_evidence_mutation() returns trigger language plpgsql as $$ begin ${earlyReturn} raise exception 'Authoritative learning evidence is append-only'; end; $$;`,
    );
    assert.match(errorsFor(inert), /unreachable|inert|guard/i, earlyReturn);
  }

  const nestedConstantReturn = replaceRequired(
    sql,
    /(create or replace function learning\.reject_evidence_mutation\(\)[\s\S]*?perform private\.assert_learning_read_committed\(\);)/i,
    `$1

  if 2 > 1 then
    begin
      if 3 > 2 then
        return new;
      end if;
    end;
  end if;`,
  );
  assert.match(
    errorsFor(nestedConstantReturn),
    /exact.*function body|guard body.*drift|unreachable|inert/i,
  );
});

test("rejects removed locks, graph lineage, active-profile, and monotonic guards", () => {
  const mutations = [
    [
      /for key share of role_assignment/i,
      "",
      /role.*lock|issuance.*serial|key share/i,
    ],
    [
      /from learning\.curriculum_capability_outcomes outcome\s+where outcome\.curriculum_version_id = new\.curriculum_version_id/i,
      "from learning.curriculum_requirements outcome where outcome.curriculum_version_id = new.curriculum_version_id",
      /capability outcome|graph lineage|certification/i,
    ],
    [
      /from learning\.curriculum_requirement_prerequisites prerequisite\s+where prerequisite\.curriculum_version_id = new\.curriculum_version_id/i,
      "from learning.curriculum_requirements prerequisite where prerequisite.curriculum_version_id = new.curriculum_version_id",
      /prerequisite|graph lineage|certification/i,
    ],
    [
      /requirement_version\.audience = 'vendor'/i,
      "false",
      /vendor.*waiv|waiv.*vendor/i,
    ],
    [
      /private\.learning_has_active_profile\(audience\)/i,
      "true",
      /active profile|policy/i,
    ],
    [
      /create trigger learning_assignments_lifecycle_guard[\s\S]*?;/i,
      "",
      /assignment.*lifecycle|trigger/i,
    ],
  ];
  for (const [pattern, replacement, expected] of mutations) {
    const weakened = replaceRequired(sql, pattern, replacement);
    assert.match(errorsFor(weakened), expected, String(pattern));
  }
});

test("rejects mutations for every repaired trigger and structural invariant", () => {
  const inertFunctions = [
    "guard_attempt_lifecycle",
    "guard_certification_lifecycle",
    "guard_emergency_exception_lifecycle",
    "guard_content_lifecycle",
    "guard_curriculum_composition",
  ];
  for (const name of inertFunctions) {
    const inert = replaceRequired(
      sql,
      new RegExp(
        `create or replace function learning\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`,
        "i",
      ),
      `create or replace function learning.${name}() returns trigger language plpgsql as $$ begin return new; end; $$;`,
    );
    assert.match(
      errorsFor(inert),
      /guard|lifecycle|composition|immutable/i,
      name,
    );
  }

  for (const name of [
    "validate_assignment_requirement_waiver",
    "validate_certification_issuance",
    "validate_emergency_exception_issuance",
  ]) {
    const inert = replaceRequired(
      sql,
      new RegExp(
        `create or replace function private\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`,
        "i",
      ),
      `create or replace function private.${name}() returns trigger language plpgsql as $$ begin return new; end; $$;`,
    );
    assert.match(
      errorsFor(inert),
      /waiver|certification|emergency exception|validator/i,
      name,
    );
  }

  const forgedOwner = replaceRequired(
    sql,
    /constraint requirement_versions_department_owner_fk[\s\S]*?on delete restrict,/i,
    "constraint requirement_versions_department_owner_fk check (true),",
  );
  assert.match(errorsFor(forgedOwner), /department ownership.*parent/i);

  const severedProfileKind = replaceRequired(
    sql,
    /constraint assignments_profile_audience_check[\s\S]*?\n\s*\),/i,
    "constraint assignments_profile_audience_check check (true),",
  );
  assert.match(
    errorsFor(severedProfileKind),
    /structurally separate.*audience/i,
  );

  const unqualifiedPolicy = replaceRequired(
    sql,
    /version\.id = learning\.curriculum_requirements\.curriculum_version_id/i,
    "version.id = curriculum_version_id",
  );
  assert.match(errorsFor(unqualifiedPolicy), /qualify.*correlation/i);

  const missingChronology = replaceRequired(
    sql,
    /issued_at <= effective_at/i,
    "true",
  );
  assert.match(
    errorsFor(missingChronology),
    /issued before becoming effective/i,
  );
});
