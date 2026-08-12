#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REQUIRED_TABLES = [
  "curricula",
  "curriculum_versions",
  "requirements",
  "requirement_versions",
  "curriculum_requirements",
  "role_curricula",
  "assignments",
  "assignment_requirements",
  "attempts",
  "attempt_events",
  "policy_acknowledgments",
  "certifications",
  "emergency_exceptions",
];

const APPEND_ONLY_TABLES = [
  "attempts",
  "attempt_events",
  "policy_acknowledgments",
];

const AUTHORITATIVE_EVIDENCE_TABLES = [
  ...APPEND_ONLY_TABLES,
  "certifications",
  "emergency_exceptions",
];

const REQUIRED_RELATIONSHIPS = [
  [
    "Curriculum versions must reference curricula.",
    /constraint curriculum_versions_curriculum_fk\s+foreign key[\s\S]*?references learning\.curricula/i,
  ],
  [
    "Requirement versions must reference requirements.",
    /constraint requirement_versions_requirement_fk\s+foreign key[\s\S]*?references learning\.requirements/i,
  ],
  [
    "Curriculum requirements must reference curriculum versions.",
    /constraint curriculum_requirements_curriculum_fk\s+foreign key[\s\S]*?references learning\.curriculum_versions/i,
  ],
  [
    "Curriculum requirements must reference requirement versions.",
    /constraint curriculum_requirements_requirement_fk\s+foreign key[\s\S]*?references learning\.requirement_versions/i,
  ],
  [
    "Role curricula must reference core roles.",
    /constraint role_curricula_role_fk\s+foreign key[\s\S]*?references core\.roles/i,
  ],
  [
    "Assignments must reference curriculum versions.",
    /constraint assignments_curriculum_fk\s+foreign key[\s\S]*?references learning\.curriculum_versions/i,
  ],
  [
    "Assignment requirements must reference assignments.",
    /constraint assignment_requirements_assignment_fk\s+foreign key[\s\S]*?references learning\.assignments/i,
  ],
  [
    "Attempts must reference assignment requirements.",
    /constraint attempts_assignment_requirement_fk\s+foreign key[\s\S]*?references learning\.assignment_requirements/i,
  ],
  [
    "Attempt events must reference attempts with an explicit foreign key.",
    /constraint attempt_events_attempt_fk\s+foreign key[\s\S]*?references learning\.attempts/i,
  ],
  [
    "Policy acknowledgments must reference assignment requirements.",
    /constraint policy_acknowledgments_assignment_requirement_fk\s+foreign key[\s\S]*?references learning\.assignment_requirements/i,
  ],
  [
    "Certifications must reference core role assignments.",
    /constraint certifications_role_assignment_fk\s+foreign key[\s\S]*?references core\.user_roles/i,
  ],
  [
    "Certifications must reference core capabilities.",
    /constraint certifications_capability_fk\s+foreign key[\s\S]*?references core\.capabilities/i,
  ],
  [
    "Emergency exceptions must reference core capabilities.",
    /constraint emergency_exceptions_capability_fk\s+foreign key[\s\S]*?references core\.capabilities/i,
  ],
];

function tableSql(sql, table) {
  return (
    sql.match(
      new RegExp(
        `create table(?: if not exists)? learning\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,
        "i",
      ),
    )?.[0] ?? ""
  );
}

function requireMatch(errors, sql, pattern, message) {
  if (!pattern.test(sql)) errors.push(message);
}

export function verifyLearningSchema(sql) {
  const errors = [];

  requireMatch(
    errors,
    sql,
    /create schema if not exists learning/i,
    "Missing learning schema.",
  );
  requireMatch(
    errors,
    sql,
    /grant usage on schema learning to authenticated, service_role/i,
    "Learning schema usage is not explicitly granted.",
  );

  for (const table of REQUIRED_TABLES) {
    const definition = tableSql(sql, table);
    if (!definition) {
      errors.push(`Missing table learning.${table}.`);
      continue;
    }
    if (!/id uuid primary key default gen_random_uuid\(\)/i.test(definition)) {
      errors.push(`learning.${table} must have a generated UUID primary key.`);
    }
    if (!/created_at timestamptz not null default now\(\)/i.test(definition)) {
      errors.push(
        `learning.${table} must have an authoritative created_at timestamp.`,
      );
    }
    requireMatch(
      errors,
      sql,
      new RegExp(
        `alter table learning\\.${table} enable row level security`,
        "i",
      ),
      `learning.${table} must enable RLS.`,
    );
    requireMatch(
      errors,
      sql,
      new RegExp(
        `alter table learning\\.${table} force row level security`,
        "i",
      ),
      `learning.${table} must force RLS.`,
    );
    requireMatch(
      errors,
      sql,
      new RegExp(
        `revoke all on learning\\.${table} from public, anon, authenticated`,
        "i",
      ),
      `learning.${table} must start from explicit least-privilege grants.`,
    );
    requireMatch(
      errors,
      sql,
      new RegExp(`grant select on learning\\.${table} to authenticated`, "i"),
      `learning.${table} needs an explicit authenticated SELECT grant.`,
    );
  }

  for (const [message, pattern] of REQUIRED_RELATIONSHIPS) {
    requireMatch(errors, sql, pattern, message);
  }

  for (const [constraint, states] of [
    [
      "curriculum_versions_status_check",
      "'draft', 'in_review', 'approved', 'scheduled', 'published', 'superseded', 'retired'",
    ],
    [
      "requirement_versions_status_check",
      "'draft', 'in_review', 'approved', 'scheduled', 'published', 'superseded', 'retired'",
    ],
    [
      "assignments_status_check",
      "'assigned', 'in_progress', 'completed', 'blocked', 'expired', 'superseded', 'cancelled'",
    ],
    [
      "assignment_requirements_status_check",
      "'not_started', 'in_progress', 'passed', 'failed_retryable', 'needs_support', 'expired', 'waived'",
    ],
    [
      "certifications_status_check",
      "'active', 'expired', 'revoked', 'superseded'",
    ],
  ]) {
    requireMatch(
      errors,
      sql,
      new RegExp(
        `constraint ${constraint}\\s+check\\s*\\(status in \\(${states}\\)\\)`,
        "i",
      ),
      `Missing approved state model: ${constraint}.`,
    );
  }

  for (const table of APPEND_ONLY_TABLES) {
    requireMatch(
      errors,
      sql,
      new RegExp(
        `create trigger learning_${table}_append_only[\\s\\S]*?before update or delete on learning\\.${table}[\\s\\S]*?learning\\.reject_evidence_mutation\\(\\)`,
        "i",
      ),
      `learning.${table} must be append-only.`,
    );
  }
  requireMatch(
    errors,
    sql,
    /create trigger learning_certifications_lifecycle_guard[\s\S]*?before update or delete on learning\.certifications[\s\S]*?learning\.guard_certification_lifecycle\(\)/i,
    "learning.certifications needs an immutable-issuance lifecycle guard.",
  );
  requireMatch(
    errors,
    sql,
    /create trigger learning_emergency_exceptions_lifecycle_guard[\s\S]*?before update or delete on learning\.emergency_exceptions[\s\S]*?learning\.guard_emergency_exception_lifecycle\(\)/i,
    "learning.emergency_exceptions needs an immutable-approval lifecycle guard.",
  );

  for (const table of AUTHORITATIVE_EVIDENCE_TABLES) {
    const unsafeGrant = new RegExp(
      `grant\\s+(?:insert|update|delete|all)(?:\\s*\\([^)]*\\))?\\s+on\\s+(?:table\\s+)?learning\\.${table}\\s+to\\s+authenticated`,
      "i",
    );
    if (unsafeGrant.test(sql)) {
      errors.push(
        `Authenticated clients must not write learning.${table} directly.`,
      );
    }
  }

  requireMatch(
    errors,
    sql,
    /create unique index learning_one_active_certification_idx\s+on learning\.certifications\s*\(user_id, department_id, module, capability, source_role_assignment_id\)\s+where status = 'active'/i,
    "One active certification per authority source must be unique.",
  );
  requireMatch(
    errors,
    sql,
    /create unique index learning_one_open_assignment_idx\s+on learning\.assignments\s*\(user_id, curriculum_version_id, source_type, source_id\)\s+where status in \('assigned', 'in_progress', 'blocked'\)/i,
    "One open assignment per source must be unique.",
  );
  requireMatch(
    errors,
    sql,
    /create unique index learning_one_global_role_curriculum_idx[\s\S]*?on learning\.role_curricula\(module, role, curriculum_version_id\)[\s\S]*?where department_id is null/i,
    "Global role curriculum mappings must be unique.",
  );
  requireMatch(
    errors,
    sql,
    /create unique index learning_one_scoped_role_curriculum_idx[\s\S]*?on learning\.role_curricula\(module, role, curriculum_version_id, department_id\)[\s\S]*?where department_id is not null/i,
    "Department role curriculum mappings must be unique.",
  );

  requireMatch(
    errors,
    sql,
    /constraint emergency_exceptions_independent_approval_check\s+check\s*\(grantor_id\s*<>\s*approver_id\)/i,
    "Emergency exception grantor must differ from the approver.",
  );
  requireMatch(
    errors,
    sql,
    /constraint emergency_exceptions_duration_check[\s\S]*?expires_at\s*<=\s*effective_at\s*\+\s*interval\s*'24 hours'/i,
    "Emergency exceptions must expire within 24 hours.",
  );
  requireMatch(
    errors,
    sql,
    /constraint emergency_exceptions_no_legal_waiver_check\s+check\s*\(waives_legal_acknowledgment\s*=\s*false\)/i,
    "Emergency exceptions cannot waive a Legal acknowledgment.",
  );
  requireMatch(
    errors,
    sql,
    /constraint requirement_versions_legal_waiver_check[\s\S]*?governance_owner\s*<>\s*'legal'[\s\S]*?requirement_kind\s*<>\s*'policy'[\s\S]*?not waivable/i,
    "Legal policy acknowledgment requirements must be non-waivable.",
  );

  for (const table of ["curriculum_versions", "requirement_versions"]) {
    requireMatch(
      errors,
      sql,
      new RegExp(
        `create trigger learning_${table}_published_immutable[\\s\\S]*?before update or delete on learning\\.${table}[\\s\\S]*?learning\\.guard_published_content\\(\\)`,
        "i",
      ),
      `Published learning.${table} content must be immutable.`,
    );
  }

  requireMatch(
    errors,
    sql,
    /create policy learning_assignments_learner_read[\s\S]*?user_id\s*=\s*\(select auth\.uid\(\)\)[\s\S]*?private\.learning_audience_matches_current_profile\(audience\)/i,
    "Learners need an audience-safe self-only assignment policy.",
  );
  requireMatch(
    errors,
    sql,
    /create policy learning_assignments_department_owner_read[\s\S]*?private\.learning_owns_department\(department_id\)[\s\S]*?audience\s*=\s*'internal'/i,
    "Department owners need internal department-scoped assignment reads.",
  );
  requireMatch(
    errors,
    sql,
    /create policy learning_policy_acknowledgments_legal_read[\s\S]*?core\.has_cap\('legal', 'review_accreditation'\)[\s\S]*?not core\.is_vendor\(\)[\s\S]*?audience\s*=\s*'internal'/i,
    "Legal policy evidence must use an internal-only Legal policy.",
  );
  requireMatch(
    errors,
    sql,
    /create policy learning_policy_acknowledgments_legal_vendor_read[\s\S]*?core\.has_cap\('legal', 'review_accreditation'\)[\s\S]*?not core\.is_vendor\(\)[\s\S]*?audience\s*=\s*'vendor'/i,
    "Vendor policy evidence needs a separate Legal policy.",
  );
  requireMatch(
    errors,
    sql,
    /create policy learning_curricula_platform_manage[\s\S]*?for all to authenticated[\s\S]*?core\.has_cap\('core', 'manage_rbac'\)/i,
    "Platform Administrators need a technical configuration policy.",
  );
  requireMatch(
    errors,
    sql,
    /create policy learning_assignments_vendor_read[\s\S]*?core\.is_vendor\(\)[\s\S]*?user_id\s*=\s*\(select auth\.uid\(\)\)[\s\S]*?audience\s*=\s*'vendor'/i,
    "Vendor assignment reads must be self-only and vendor-audience-only.",
  );
  requireMatch(
    errors,
    sql,
    /constraint role_curricula_audience_boundary_check[\s\S]*?audience = 'vendor'[\s\S]*?module = 'core'[\s\S]*?role = 'vendor_portal'[\s\S]*?audience = 'internal'/i,
    "Role curricula must keep vendor and internal mappings separate.",
  );
  requireMatch(
    errors,
    sql,
    /foreign key\s*\(\s*requirement_id\s*,\s*audience\s*,\s*requirement_kind\s*,\s*governance_owner\s*\)[\s\S]*?references learning\.requirements\s*\(\s*id\s*,\s*audience\s*,\s*requirement_kind\s*,\s*governance_owner\s*\)/i,
    "Requirement versions must preserve non-null audience and ownership authority.",
  );
  requireMatch(
    errors,
    sql,
    /curriculum\.id = learning\.curriculum_versions\.curriculum_id[\s\S]*?curriculum\.audience = learning\.curriculum_versions\.audience/i,
    "Curriculum version owner policies must correlate the audience explicitly.",
  );
  if (/curriculum\.audience\s*=\s*audience\b/i.test(sql)) {
    errors.push(
      "Curriculum version policies must correlate the outer audience explicitly.",
    );
  }
  for (const table of [
    "assignments",
    "assignment_requirements",
    "attempts",
    "attempt_events",
    "policy_acknowledgments",
    "certifications",
    "emergency_exceptions",
  ]) {
    requireMatch(
      errors,
      sql,
      new RegExp(
        `create policy learning_${table}_platform_read[\\s\\S]*?core\\.has_cap\\('core', 'manage_rbac'\\)[\\s\\S]*?audience\\s*=\\s*'internal'`,
        "i",
      ),
      `Platform evidence policy for learning.${table} must remain internal-only.`,
    );
  }

  requireMatch(
    errors,
    sql,
    /alter table core\.user_roles\s+add column if not exists id uuid not null default gen_random_uuid\(\)/i,
    "Role assignments need a stable source identity.",
  );
  requireMatch(
    errors,
    sql,
    /foreign key \(source_role_assignment_id, user_id, module, source_role\)[\s\S]*?references core\.user_roles\(id, user_id, module, role\)[\s\S]*?on delete restrict/i,
    "Certifications must reference existing user role authority.",
  );
  if (
    /insert into core\.user_roles[\s\S]*?from learning\.certifications/i.test(
      sql,
    ) ||
    /insert into core\.profile_department_scopes[\s\S]*?from learning\.certifications/i.test(
      sql,
    )
  ) {
    errors.push("Certifications must never grant roles or department scope.");
  }

  return errors;
}

function run() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const migration = resolve(
    root,
    "supabase/migrations/20260812090000_learning_foundation.sql",
  );
  const errors = verifyLearningSchema(readFileSync(migration, "utf8"));
  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log(
    `Learning schema contract passed (${REQUIRED_TABLES.length} governed tables).`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  run();
}
