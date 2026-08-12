import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  REQUIRED_TABLES,
  verifyLearningSchema,
} from "./verify-learning-schema.mjs";

const migration = fileURLToPath(
  new URL(
    "../supabase/migrations/20260812090000_learning_foundation.sql",
    import.meta.url,
  ),
);

const sql = readFileSync(migration, "utf8");

function replaceRequired(source, pattern, replacement) {
  assert.match(source, pattern, `Fixture did not contain ${pattern}.`);
  return source.replace(pattern, replacement);
}

test("learning foundation satisfies the complete static schema contract", () => {
  assert.equal(REQUIRED_TABLES.length, 13);
  assert.deepEqual(verifyLearningSchema(sql), []);
});

test("every authoritative table has identity, timestamp, RLS, and explicit grants", () => {
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
    assert.match(
      sql,
      new RegExp(
        `alter table learning\\.${table} enable row level security`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `alter table learning\\.${table} force row level security`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on learning\\.${table} from public, anon, authenticated`,
        "i",
      ),
    );
  }
});

test("the verifier rejects a missing table or RLS boundary", () => {
  const withoutAttempts = replaceRequired(
    sql,
    /create table learning\.attempts\s*\([\s\S]*?\n\);/i,
    "",
  );
  assert.match(verifyLearningSchema(withoutAttempts).join("\n"), /attempts/i);

  const withoutForcedRls = replaceRequired(
    sql,
    /alter table learning\.assignments force row level security;/i,
    "",
  );
  assert.match(
    verifyLearningSchema(withoutForcedRls).join("\n"),
    /assignments.*force RLS/i,
  );
});

test("authoritative learning evidence is immutable or lifecycle-guarded and never client-writable", () => {
  for (const table of [
    "attempts",
    "attempt_events",
    "policy_acknowledgments",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `create trigger learning_${table}_append_only[\\s\\S]*?before update or delete on learning\\.${table}`,
        "i",
      ),
    );
  }
  assert.match(
    sql,
    /create trigger learning_certifications_lifecycle_guard[\s\S]*?before update or delete on learning\.certifications[\s\S]*?learning\.guard_certification_lifecycle\(\)/i,
  );
  assert.match(
    sql,
    /create trigger learning_emergency_exceptions_lifecycle_guard[\s\S]*?before update or delete on learning\.emergency_exceptions[\s\S]*?learning\.guard_emergency_exception_lifecycle\(\)/i,
  );

  assert.doesNotMatch(
    sql,
    /grant\s+(?:insert|update|delete|all)(?:\s*\([^)]*\))?\s+on\s+(?:table\s+)?learning\.(?:attempts|attempt_events|policy_acknowledgments|certifications|emergency_exceptions)\s+to\s+authenticated/i,
  );

  const unsafeGrant = `${sql}\n+grant insert on learning.certifications to authenticated;`;
  assert.match(
    verifyLearningSchema(unsafeGrant).join("\n"),
    /authenticated.*certifications|certifications.*authenticated/i,
  );

  const withoutEvidenceTrigger = replaceRequired(
    sql,
    /create trigger learning_attempt_events_append_only[\s\S]*?for each row execute function learning\.reject_evidence_mutation\(\);/i,
    "",
  );
  assert.match(
    verifyLearningSchema(withoutEvidenceTrigger).join("\n"),
    /attempt_events.*append-only/i,
  );
});

test("published content is immutable and Legal acknowledgments are non-waivable", () => {
  assert.match(
    sql,
    /create trigger learning_curriculum_versions_published_immutable[\s\S]*?on learning\.curriculum_versions/i,
  );
  assert.match(
    sql,
    /create trigger learning_requirement_versions_published_immutable[\s\S]*?on learning\.requirement_versions/i,
  );
  assert.match(
    sql,
    /requirement_versions_legal_waiver_check[\s\S]*governance_owner\s*<>\s*'legal'[\s\S]*requirement_kind\s*<>\s*'policy'[\s\S]*not waivable/i,
  );

  const waivableLegalPolicy = replaceRequired(
    sql,
    /constraint requirement_versions_legal_waiver_check[\s\S]*?\n\s*\)/i,
    "constraint requirement_versions_legal_waiver_check check (true)\n  )",
  );
  assert.match(
    verifyLearningSchema(waivableLegalPolicy).join("\n"),
    /Legal policy.*non-waivable/i,
  );
});

test("emergency exceptions require independent approval and expire within 24 hours", () => {
  assert.match(
    sql,
    /constraint emergency_exceptions_independent_approval_check\s+check\s*\(grantor_id\s*<>\s*approver_id\)/i,
  );
  assert.match(
    sql,
    /constraint emergency_exceptions_duration_check[\s\S]*expires_at\s*<=\s*effective_at\s*\+\s*interval\s*'24 hours'/i,
  );
  assert.match(
    sql,
    /constraint emergency_exceptions_no_legal_waiver_check\s+check\s*\(waives_legal_acknowledgment\s*=\s*false\)/i,
  );

  const selfApproval = replaceRequired(
    sql,
    /constraint emergency_exceptions_independent_approval_check\s+check\s*\(grantor_id\s*<>\s*approver_id\)/i,
    "constraint emergency_exceptions_independent_approval_check check (true)",
  );
  assert.match(
    verifyLearningSchema(selfApproval).join("\n"),
    /grantor.*approver/i,
  );

  const longException = replaceRequired(
    sql,
    /interval\s*'24 hours'/i,
    "interval '48 hours'",
  );
  assert.match(verifyLearningSchema(longException).join("\n"), /24 hours/i);
});

test("active certifications and open assignments are unique by authority source", () => {
  assert.match(
    sql,
    /create unique index learning_one_active_certification_idx\s+on learning\.certifications\s*\(user_id, department_id, module, capability, source_role_assignment_id\)\s+where status = 'active'/i,
  );
  assert.match(
    sql,
    /create unique index learning_one_open_assignment_idx\s+on learning\.assignments\s*\(user_id, curriculum_version_id, source_type, source_id\)\s+where status in \('assigned', 'in_progress', 'blocked'\)/i,
  );

  const withoutCertificationIndex = replaceRequired(
    sql,
    /create unique index learning_one_active_certification_idx[\s\S]*?;/i,
    "",
  );
  assert.match(
    verifyLearningSchema(withoutCertificationIndex).join("\n"),
    /active certification.*unique/i,
  );
});

test("learner, department owner, Legal, Platform, and vendor read scopes stay distinct", () => {
  assert.match(
    sql,
    /create policy learning_assignments_learner_read[\s\S]*?user_id\s*=\s*\(select auth\.uid\(\)\)[\s\S]*?private\.learning_audience_matches_current_profile\(audience\)/i,
  );
  assert.match(
    sql,
    /create policy learning_assignments_department_owner_read[\s\S]*?private\.learning_owns_department\(department_id\)[\s\S]*?audience\s*=\s*'internal'/i,
  );
  assert.match(
    sql,
    /create policy learning_policy_acknowledgments_legal_read[\s\S]*?core\.has_cap\('legal', 'review_accreditation'\)[\s\S]*?not core\.is_vendor\(\)[\s\S]*?audience\s*=\s*'internal'/i,
  );
  assert.match(
    sql,
    /create policy learning_policy_acknowledgments_legal_vendor_read[\s\S]*?core\.has_cap\('legal', 'review_accreditation'\)[\s\S]*?not core\.is_vendor\(\)[\s\S]*?audience\s*=\s*'vendor'/i,
  );
  assert.match(
    sql,
    /create policy learning_curricula_platform_manage[\s\S]*?for all to authenticated[\s\S]*?core\.has_cap\('core', 'manage_rbac'\)/i,
  );
  assert.match(
    sql,
    /create policy learning_assignments_vendor_read[\s\S]*?core\.is_vendor\(\)[\s\S]*?user_id\s*=\s*\(select auth\.uid\(\)\)[\s\S]*?audience\s*=\s*'vendor'/i,
  );

  const collapsedAudience = replaceRequired(
    sql,
    /core\.is_vendor\(\)[\s\S]*?user_id\s*=\s*\(select auth\.uid\(\)\)[\s\S]*?audience\s*=\s*'vendor'/i,
    "true",
  );
  assert.match(
    verifyLearningSchema(collapsedAudience).join("\n"),
    /vendor.*audience|audience.*vendor/i,
  );

  for (const table of [
    "assignments",
    "assignment_requirements",
    "attempts",
    "attempt_events",
    "policy_acknowledgments",
    "certifications",
    "emergency_exceptions",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `create policy learning_${table}_platform_read[\\s\\S]*?core\\.has_cap\\('core', 'manage_rbac'\\)[\\s\\S]*?audience\\s*=\\s*'internal'`,
        "i",
      ),
    );
  }
});

test("audience ownership references and policy correlations fail closed", () => {
  assert.match(
    sql,
    /foreign key\s*\(\s*requirement_id\s*,\s*audience\s*,\s*requirement_kind\s*,\s*governance_owner\s*\)[\s\S]*?references learning\.requirements\s*\(\s*id\s*,\s*audience\s*,\s*requirement_kind\s*,\s*governance_owner\s*\)/i,
  );
  assert.doesNotMatch(
    sql,
    /constraint requirement_versions_requirement_fk\s+foreign key\s*\([^)]*owner_department_id[^)]*\)/i,
  );
  assert.match(
    sql,
    /curriculum\.id = learning\.curriculum_versions\.curriculum_id[\s\S]*?curriculum\.audience = learning\.curriculum_versions\.audience/i,
  );

  const ambiguousAudience = replaceRequired(
    sql,
    /curriculum\.audience = learning\.curriculum_versions\.audience/i,
    "curriculum.audience = audience",
  );
  assert.match(
    verifyLearningSchema(ambiguousAudience).join("\n"),
    /correlate.*audience|audience.*correlat/i,
  );
});

test("global and department role curricula cannot duplicate", () => {
  assert.match(
    sql,
    /create unique index learning_one_global_role_curriculum_idx[\s\S]*?on learning\.role_curricula\(module, role, curriculum_version_id\)[\s\S]*?where department_id is null/i,
  );
  assert.match(
    sql,
    /create unique index learning_one_scoped_role_curriculum_idx[\s\S]*?on learning\.role_curricula\(module, role, curriculum_version_id, department_id\)[\s\S]*?where department_id is not null/i,
  );
});

test("version, assignment, evidence, and authority lineage use explicit foreign keys", () => {
  const requiredRelationships = [
    /curriculum_versions_curriculum_fk[\s\S]*?references learning\.curricula/i,
    /requirement_versions_requirement_fk[\s\S]*?references learning\.requirements/i,
    /curriculum_requirements_curriculum_fk[\s\S]*?references learning\.curriculum_versions/i,
    /curriculum_requirements_requirement_fk[\s\S]*?references learning\.requirement_versions/i,
    /role_curricula_role_fk[\s\S]*?references core\.roles/i,
    /assignments_curriculum_fk[\s\S]*?references learning\.curriculum_versions/i,
    /assignment_requirements_assignment_fk[\s\S]*?references learning\.assignments/i,
    /attempts_assignment_requirement_fk[\s\S]*?references learning\.assignment_requirements/i,
    /attempt_events_attempt_fk[\s\S]*?references learning\.attempts/i,
    /policy_acknowledgments_assignment_requirement_fk[\s\S]*?references learning\.assignment_requirements/i,
    /certifications_role_assignment_fk[\s\S]*?references core\.user_roles/i,
    /certifications_capability_fk[\s\S]*?references core\.capabilities/i,
    /emergency_exceptions_capability_fk[\s\S]*?references core\.capabilities/i,
  ];

  for (const relationship of requiredRelationships) {
    assert.match(sql, relationship);
  }

  const severedAttemptLineage = replaceRequired(
    sql,
    /constraint attempt_events_attempt_fk[\s\S]*?on delete restrict,/i,
    "constraint attempt_events_attempt_fk check (true),",
  );
  assert.match(
    verifyLearningSchema(severedAttemptLineage).join("\n"),
    /attempt events.*attempts|attempt.*event.*foreign key/i,
  );
});

test("certifications reference existing role authority without granting roles or scope", () => {
  assert.match(
    sql,
    /alter table core\.user_roles\s+add column if not exists id uuid not null default gen_random_uuid\(\)/i,
  );
  assert.match(
    sql,
    /foreign key \(source_role_assignment_id, user_id, module, source_role\)[\s\S]*?references core\.user_roles\(id, user_id, module, role\)[\s\S]*?on delete restrict/i,
  );
  assert.doesNotMatch(
    sql,
    /insert into core\.user_roles[\s\S]*?from learning\.certifications|create policy[\s\S]*?learning\.certifications[\s\S]*?core\.profile_department_scopes[\s\S]*?for insert/i,
  );
});
