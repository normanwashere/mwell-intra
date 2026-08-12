import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, resolve } from "node:path";

export const FOUNDATION_MIGRATION_NAME =
  "20260812130000_learning_foundation.sql";

export const REQUIRED_TABLES = Object.freeze([
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
]);

const CONFIG_TABLES = new Set([
  "curricula",
  "curriculum_versions",
  "requirements",
  "requirement_versions",
  "curriculum_requirements",
  "role_curricula",
]);

const SERVICE_PRIVILEGES = Object.freeze({
  curricula: ["delete", "insert", "select", "update"],
  curriculum_versions: ["delete", "insert", "select", "update"],
  requirements: ["delete", "insert", "select", "update"],
  requirement_versions: ["delete", "insert", "select", "update"],
  curriculum_requirements: ["delete", "insert", "select", "update"],
  role_curricula: ["delete", "insert", "select", "update"],
  assignments: ["insert", "select", "update"],
  assignment_requirements: ["insert", "select", "update"],
  attempts: ["insert", "select", "update"],
  attempt_events: ["insert", "select"],
  policy_acknowledgments: ["insert", "select"],
  certifications: ["insert", "select", "update"],
  emergency_exceptions: ["insert", "select", "update"],
});

const EXPECTED_POLICIES = new Map([
  ["learning_curricula_published_read", "curricula"],
  ["learning_curricula_platform_manage", "curricula"],
  ["learning_curricula_department_manage", "curricula"],
  ["learning_curricula_legal_manage", "curricula"],
  ["learning_curriculum_versions_published_read", "curriculum_versions"],
  ["learning_curriculum_versions_platform_manage", "curriculum_versions"],
  ["learning_curriculum_versions_owner_manage", "curriculum_versions"],
  ["learning_requirements_published_read", "requirements"],
  ["learning_requirements_platform_manage", "requirements"],
  ["learning_requirements_owner_manage", "requirements"],
  ["learning_requirement_versions_published_read", "requirement_versions"],
  ["learning_requirement_versions_platform_manage", "requirement_versions"],
  ["learning_requirement_versions_owner_manage", "requirement_versions"],
  [
    "learning_curriculum_requirements_published_read",
    "curriculum_requirements",
  ],
  [
    "learning_curriculum_requirements_platform_manage",
    "curriculum_requirements",
  ],
  ["learning_role_curricula_published_read", "role_curricula"],
  ["learning_role_curricula_platform_manage", "role_curricula"],
  ["learning_assignments_learner_read", "assignments"],
  ["learning_assignments_vendor_read", "assignments"],
  ["learning_assignments_department_owner_read", "assignments"],
  ["learning_assignments_platform_read", "assignments"],
  ["learning_assignment_requirements_learner_read", "assignment_requirements"],
  [
    "learning_assignment_requirements_department_owner_read",
    "assignment_requirements",
  ],
  ["learning_assignment_requirements_platform_read", "assignment_requirements"],
  ["learning_attempts_learner_read", "attempts"],
  ["learning_attempts_department_owner_read", "attempts"],
  ["learning_attempts_platform_read", "attempts"],
  ["learning_attempt_events_learner_read", "attempt_events"],
  ["learning_attempt_events_department_owner_read", "attempt_events"],
  ["learning_attempt_events_platform_read", "attempt_events"],
  ["learning_policy_acknowledgments_learner_read", "policy_acknowledgments"],
  [
    "learning_policy_acknowledgments_department_owner_read",
    "policy_acknowledgments",
  ],
  ["learning_policy_acknowledgments_legal_read", "policy_acknowledgments"],
  [
    "learning_policy_acknowledgments_legal_vendor_read",
    "policy_acknowledgments",
  ],
  ["learning_policy_acknowledgments_platform_read", "policy_acknowledgments"],
  ["learning_certifications_learner_read", "certifications"],
  ["learning_certifications_department_owner_read", "certifications"],
  ["learning_certifications_platform_read", "certifications"],
  ["learning_emergency_exceptions_learner_read", "emergency_exceptions"],
  [
    "learning_emergency_exceptions_department_owner_read",
    "emergency_exceptions",
  ],
  ["learning_emergency_exceptions_platform_read", "emergency_exceptions"],
]);

const REQUIRED_TRIGGERS = Object.freeze({
  learning_attempts_lifecycle_guard: {
    table: "learning.attempts",
    events: "before insert or update or delete",
    function: "learning.guard_attempt_lifecycle",
  },
  learning_attempt_events_append_only: {
    table: "learning.attempt_events",
    events: "before update or delete",
    function: "learning.reject_evidence_mutation",
  },
  learning_policy_acknowledgments_append_only: {
    table: "learning.policy_acknowledgments",
    events: "before update or delete",
    function: "learning.reject_evidence_mutation",
  },
  learning_assignment_requirements_validate_waiver: {
    table: "learning.assignment_requirements",
    events: "before insert or update",
    function: "private.validate_assignment_requirement_waiver",
  },
  learning_certifications_validate_issuance: {
    table: "learning.certifications",
    events: "before insert",
    function: "private.validate_certification_issuance",
  },
  learning_certifications_lifecycle_guard: {
    table: "learning.certifications",
    events: "before update or delete",
    function: "learning.guard_certification_lifecycle",
  },
  learning_emergency_exceptions_validate_issuance: {
    table: "learning.emergency_exceptions",
    events: "before insert",
    function: "private.validate_emergency_exception_issuance",
  },
  learning_emergency_exceptions_lifecycle_guard: {
    table: "learning.emergency_exceptions",
    events: "before update or delete",
    function: "learning.guard_emergency_exception_lifecycle",
  },
  learning_curriculum_versions_lifecycle_guard: {
    table: "learning.curriculum_versions",
    events: "before insert or update or delete",
    function: "learning.guard_content_lifecycle",
  },
  learning_requirement_versions_lifecycle_guard: {
    table: "learning.requirement_versions",
    events: "before insert or update or delete",
    function: "learning.guard_content_lifecycle",
  },
  learning_curriculum_requirements_composition_guard: {
    table: "learning.curriculum_requirements",
    events: "before insert or update or delete",
    function: "learning.guard_curriculum_composition",
  },
  learning_revoke_certifications_on_role_delete: {
    table: "core.user_roles",
    events: "before delete",
    function: "private.revoke_certifications_for_role_assignment",
  },
});

function normalizeSql(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim().replace(/;$/, "");
}

function scanSql(source, { splitStatements = true } = {}) {
  const statements = [];
  let output = "";
  let state = "normal";
  let blockDepth = 0;
  let dollarDelimiter = "";

  function finishStatement() {
    const statement = output.trim();
    if (statement) statements.push(statement);
    output = "";
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (char === "\n") {
        output += "\n";
        state = "normal";
      }
      continue;
    }

    if (state === "block-comment") {
      if (char === "/" && next === "*") {
        blockDepth += 1;
        index += 1;
      } else if (char === "*" && next === "/") {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) {
          output += " ";
          state = "normal";
        }
      } else if (char === "\n") {
        output += "\n";
      }
      continue;
    }

    if (state === "single-quote") {
      output += char;
      if (char === "'" && next === "'") {
        output += next;
        index += 1;
      } else if (char === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double-quote") {
      output += char;
      if (char === '"' && next === '"') {
        output += next;
        index += 1;
      } else if (char === '"') {
        state = "normal";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (source.startsWith(dollarDelimiter, index)) {
        output += dollarDelimiter;
        index += dollarDelimiter.length - 1;
        state = "normal";
      } else {
        output += char;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block-comment";
      blockDepth = 1;
      index += 1;
      continue;
    }
    if (char === "'") {
      output += char;
      state = "single-quote";
      continue;
    }
    if (char === '"') {
      output += char;
      state = "double-quote";
      continue;
    }
    if (char === "$") {
      const delimiter = source
        .slice(index)
        .match(/^\$[a-z_][a-z0-9_]*\$|^\$\$/i)?.[0];
      if (delimiter) {
        output += delimiter;
        dollarDelimiter = delimiter;
        state = "dollar-quote";
        index += delimiter.length - 1;
        continue;
      }
    }
    if (char === ";" && splitStatements) {
      finishStatement();
      continue;
    }
    output += char;
  }

  if (
    state === "block-comment" ||
    state === "single-quote" ||
    state === "double-quote" ||
    state === "dollar-quote"
  ) {
    throw new Error(`Unterminated SQL ${state}.`);
  }
  if (splitStatements) {
    finishStatement();
    return statements;
  }
  return output;
}

function splitTopLevel(value) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote) {
      current += char;
      if (char === quote && next === quote) {
        current += next;
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
    } else if (char === "(") {
      depth += 1;
      current += char;
    } else if (char === ")") {
      depth -= 1;
      current += char;
    } else if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function identifiers(value) {
  return splitTopLevel(value).map((part) =>
    part.trim().replace(/^"|"$/g, "").split(/\s+/)[0].toLowerCase(),
  );
}

function functionBody(statement) {
  const match = statement.match(/\bas\s+(\$[a-z_][a-z0-9_]*\$|\$\$)/i);
  if (!match) return "";
  const delimiter = match[1];
  const start = match.index + match[0].length;
  const end = statement.lastIndexOf(delimiter);
  if (end < start) return "";
  return normalizeSql(
    scanSql(statement.slice(start, end), { splitStatements: false }),
  );
}

function asMigrations(input) {
  if (typeof input === "string") {
    return [{ name: FOUNDATION_MIGRATION_NAME, sql: input }];
  }
  if (!Array.isArray(input)) {
    throw new TypeError(
      "verifyLearningSchema expects SQL text or ordered migrations.",
    );
  }
  return input
    .map((migration) => {
      if (
        !migration ||
        typeof migration.name !== "string" ||
        typeof migration.sql !== "string"
      ) {
        throw new TypeError("Each migration needs string name and sql fields.");
      }
      return { name: basename(migration.name), sql: migration.sql };
    })
    .filter((migration) => migration.name >= FOUNDATION_MIGRATION_NAME)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function emptyPrivileges() {
  const privileges = new Map();
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    privileges.set(
      role,
      new Map(REQUIRED_TABLES.map((table) => [table, new Set()])),
    );
  }
  return privileges;
}

function expandPrivileges(value) {
  const names = splitTopLevel(value).map((privilege) =>
    privilege
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim()
      .toLowerCase(),
  );
  if (names.some((name) => name === "all" || name === "all privileges")) {
    return [
      "delete",
      "insert",
      "references",
      "select",
      "trigger",
      "truncate",
      "update",
    ];
  }
  return names;
}

function parseGrantees(value) {
  return splitTopLevel(value.replace(/\s+with grant option\s*$/i, "")).map(
    (role) => role.trim().replace(/^"|"$/g, "").toLowerCase(),
  );
}

function createState() {
  return {
    tables: new Map(),
    rls: new Map(
      REQUIRED_TABLES.map((table) => [
        table,
        { enabled: false, forced: false, sawEnable: false, disabledBy: "" },
      ]),
    ),
    privileges: emptyPrivileges(),
    policies: new Map(),
    functions: new Map(),
    triggers: new Map(),
    disabledTriggers: new Map(),
    indexes: new Map(),
    errors: [],
  };
}

function processStatement(state, statement, migrationName) {
  const normalized = normalizeSql(statement);
  let match;

  match = normalized.match(
    /^create table(?: if not exists)? learning\.([a-z_]+)\b/,
  );
  if (match) {
    state.tables.set(match[1], statement);
    return;
  }

  match = normalized.match(/^drop table(?: if exists)? learning\.([a-z_]+)\b/);
  if (match) {
    state.tables.delete(match[1]);
    state.errors.push(
      `${migrationName}: dropping learning.${match[1]} is a schema weakening.`,
    );
    return;
  }

  match = normalized.match(
    /^alter table(?: only)? learning\.([a-z_]+) (enable|disable) row level security$/,
  );
  if (match) {
    const rls = state.rls.get(match[1]);
    if (!rls) return;
    rls.enabled = match[2] === "enable";
    rls.sawEnable ||= match[2] === "enable";
    if (match[2] === "disable") rls.disabledBy = migrationName;
    return;
  }

  match = normalized.match(
    /^alter table(?: only)? learning\.([a-z_]+) (force|no force) row level security$/,
  );
  if (match) {
    const rls = state.rls.get(match[1]);
    if (rls) rls.forced = match[2] === "force";
    return;
  }

  match = normalized.match(
    /^alter table(?: only)? ((?:learning|core)\.[a-z_]+) (enable|disable) trigger (all|user|[a-z_]+)$/,
  );
  if (match) {
    const table = match[1];
    if (!state.disabledTriggers.has(table))
      state.disabledTriggers.set(table, new Set());
    const disabled = state.disabledTriggers.get(table);
    if (match[2] === "disable") disabled.add(match[3]);
    else if (match[3] === "all" || match[3] === "user") disabled.clear();
    else disabled.delete(match[3]);
    return;
  }

  if (
    /^alter table(?: only)? learning\.[a-z_]+ drop constraint\b/.test(
      normalized,
    )
  ) {
    state.errors.push(
      `${migrationName}: dropping a learning constraint is a schema weakening.`,
    );
    return;
  }

  if (
    /^alter table(?: only)? learning\.[a-z_]+ (?:drop column|alter column [a-z_]+ drop not null)\b/.test(
      normalized,
    )
  ) {
    state.errors.push(
      `${migrationName}: dropping a learning column invariant is a schema weakening.`,
    );
    return;
  }

  if (
    /^alter table(?: only)? learning\.certifications add constraint\b/.test(
      normalized,
    ) &&
    /references core\.user_roles/.test(normalized)
  ) {
    state.errors.push(
      `${migrationName}: certification history must not reference live core.user_roles rows.`,
    );
    return;
  }

  match = normalized.match(
    /^create policy ("?[a-z_]+"?) on learning\.([a-z_]+)\b/,
  );
  if (match) {
    const name = match[1].replaceAll('"', "");
    state.policies.set(name, {
      name,
      table: match[2],
      statement,
      normalized,
      migrationName,
    });
    return;
  }

  match = normalized.match(
    /^drop policy(?: if exists)? ("?[a-z_]+"?) on learning\.([a-z_]+)$/,
  );
  if (match) {
    state.policies.delete(match[1].replaceAll('"', ""));
    return;
  }

  if (
    /^alter policy\b/.test(normalized) &&
    /\bon learning\./.test(normalized)
  ) {
    state.errors.push(
      `${migrationName}: ALTER POLICY on learning is not safely analyzable; drop and recreate it.`,
    );
    return;
  }

  if (
    /^alter trigger\b/.test(normalized) &&
    /\bon (?:learning|core)\./.test(normalized)
  ) {
    state.errors.push(
      `${migrationName}: ALTER TRIGGER can weaken a required learning guard.`,
    );
    return;
  }

  match = normalized.match(
    /^grant (.+?) on (?:table )?learning\.([a-z_]+) to (.+)$/,
  );
  if (match) {
    const [, privilegeSql, table, granteeSql] = match;
    for (const role of parseGrantees(granteeSql)) {
      if (!state.privileges.has(role)) state.privileges.set(role, new Map());
      const roleTables = state.privileges.get(role);
      if (!roleTables.has(table)) roleTables.set(table, new Set());
      const granted = roleTables.get(table);
      for (const privilege of expandPrivileges(privilegeSql))
        granted.add(privilege);
    }
    return;
  }

  match = normalized.match(
    /^revoke (.+?) on (?:table )?learning\.([a-z_]+) from (.+?)(?: cascade| restrict)?$/,
  );
  if (match) {
    const [, privilegeSql, table, granteeSql] = match;
    for (const role of parseGrantees(granteeSql)) {
      const granted = state.privileges.get(role)?.get(table);
      if (!granted) continue;
      const privileges = expandPrivileges(privilegeSql);
      if (/^all(?: privileges)?$/i.test(privilegeSql.trim())) granted.clear();
      else for (const privilege of privileges) granted.delete(privilege);
    }
    return;
  }

  if (
    /^(grant|revoke)\b/.test(normalized) &&
    /\bon (?:table )?learning\.[a-z_]+\b/.test(normalized)
  ) {
    state.errors.push(
      `${migrationName}: unparsed learning grant or revoke statement is unsafe.`,
    );
    return;
  }

  if (
    /^(grant|revoke)\b/.test(normalized) &&
    /\bon all tables in schema learning\b/.test(normalized)
  ) {
    state.errors.push(
      `${migrationName}: schema-wide learning table grants are unsafe.`,
    );
    return;
  }

  match = normalized.match(
    /^create or replace function ((?:learning|private)\.[a-z_]+)\s*\(/,
  );
  if (match) {
    state.functions.set(match[1], {
      statement,
      body: functionBody(statement),
      migrationName,
    });
    return;
  }

  match = normalized.match(
    /^drop function(?: if exists)? ((?:learning|private)\.[a-z_]+)\s*\(/,
  );
  if (match) {
    state.functions.delete(match[1]);
    return;
  }

  match = normalized.match(
    /^create (?:or replace )?trigger ([a-z_]+) (.+?) on ((?:learning|core)\.[a-z_]+) for each row execute function ((?:learning|private)\.[a-z_]+)\s*\(/,
  );
  if (match) {
    state.triggers.set(match[1], {
      name: match[1],
      events: match[2],
      table: match[3],
      function: match[4],
      migrationName,
    });
    return;
  }

  match = normalized.match(
    /^drop trigger(?: if exists)? ([a-z_]+) on ((?:learning|core)\.[a-z_]+)(?: cascade| restrict)?$/,
  );
  if (match) {
    state.triggers.delete(match[1]);
    return;
  }

  match = normalized.match(
    /^create (unique )?index(?: if not exists)? ([a-z_]+) on learning\.([a-z_]+)\s*\(([^]*?)\)(?: where .+)?$/,
  );
  if (match) {
    state.indexes.set(match[2], {
      name: match[2],
      table: match[3],
      columns: identifiers(match[4]),
      unique: Boolean(match[1]),
      normalized,
    });
    return;
  }

  match = normalized.match(
    /^drop index(?: concurrently)?(?: if exists)? (?:learning\.)?([a-z_]+)$/,
  );
  if (match) state.indexes.delete(match[1]);
}

function requirePattern(errors, value, pattern, message) {
  if (!pattern.test(value)) errors.push(message);
}

function requireFunction(state, name, patterns, message) {
  const body = state.functions.get(name)?.body ?? "";
  if (!body || patterns.some((pattern) => !pattern.test(body))) {
    state.errors.push(message);
  }
}

function tableBody(statement) {
  const start = statement.indexOf("(");
  const end = statement.lastIndexOf(")");
  return start >= 0 && end > start ? statement.slice(start + 1, end) : "";
}

function tableIndexCandidates(state, table, statement) {
  const candidates = [...state.indexes.values()]
    .filter((index) => index.table === table)
    .map((index) => index.columns);
  for (const segment of splitTopLevel(tableBody(statement))) {
    const normalized = normalizeSql(segment);
    const tableKey = normalized.match(
      /^(?:constraint [a-z_]+ )?(?:primary key|unique)\s*\(([^)]+)\)/,
    );
    if (tableKey) candidates.push(identifiers(tableKey[1]));
    const columnKey = normalized.match(
      /^("?[a-z_]+"?)\s+.+\b(primary key|unique)\b/,
    );
    if (columnKey) candidates.push([columnKey[1].replaceAll('"', "")]);
  }
  return candidates;
}

function foreignKeys(statement, table) {
  const keys = [];
  for (const segment of splitTopLevel(tableBody(statement))) {
    const normalized = normalizeSql(segment);
    const named = normalized.match(
      /^constraint ([a-z_]+) foreign key\s*\(([^)]+)\)/,
    );
    if (named) {
      keys.push({ name: named[1], columns: identifiers(named[2]) });
      continue;
    }
    const inline = normalized.match(
      /^("?[a-z_]+"?)\s+.+\breferences\s+[a-z_]+\.[a-z_]+\s*\(/,
    );
    if (inline) {
      const column = inline[1].replaceAll('"', "");
      keys.push({ name: `${table}_${column}_inline_fk`, columns: [column] });
    }
  }
  return keys;
}

function validateTables(state) {
  for (const table of REQUIRED_TABLES) {
    const statement = state.tables.get(table);
    if (!statement) {
      state.errors.push(`Missing learning.${table} table.`);
      continue;
    }
    const normalized = normalizeSql(statement);
    requirePattern(
      state.errors,
      normalized,
      /\bid uuid primary key default gen_random_uuid\(\)/,
      `learning.${table} needs a generated UUID primary key.`,
    );
    requirePattern(
      state.errors,
      normalized,
      /\bcreated_at timestamptz not null default now\(\)/,
      `learning.${table} needs an authoritative created_at timestamp.`,
    );
  }

  const tablePatterns = [
    [
      "curriculum_versions",
      /constraint curriculum_versions_supersedes_fk foreign key\s*\(supersedes_id, audience\) references learning\.curriculum_versions\s*\(id, audience\)/,
      "Curriculum supersession must preserve audience.",
    ],
    [
      "requirement_versions",
      /constraint requirement_versions_department_owner_fk foreign key\s*\( requirement_id, audience, requirement_kind, governance_owner, owner_department_id \) references learning\.requirements\s*\( id, audience, requirement_kind, governance_owner, owner_department_id \)/,
      "Requirement-version department ownership must be structurally bound to its parent.",
    ],
    [
      "requirement_versions",
      /constraint requirement_versions_supersedes_fk foreign key\s*\(supersedes_id, audience\) references learning\.requirement_versions\s*\(id, audience\)/,
      "Requirement supersession must preserve audience.",
    ],
    [
      "assignments",
      /constraint assignments_profile_fk foreign key\s*\(user_id, profile_kind\) references core\.profiles\s*\(id, kind\)/,
      "Assignments must bind user identity to profile kind.",
    ],
    [
      "assignments",
      /constraint assignments_profile_audience_check check\s*\( \(profile_kind = 'employee' and audience = 'internal'\) or \(profile_kind = 'vendor' and audience = 'vendor'\) \)/,
      "Assignments must structurally separate internal and vendor audiences.",
    ],
    [
      "assignments",
      /constraint assignments_superseded_by_fk foreign key\s*\(superseded_by_id, user_id, department_id, audience\) references learning\.assignments\s*\(id, user_id, department_id, audience\)/,
      "Assignment supersession must preserve beneficiary, department, and audience.",
    ],
    [
      "certifications",
      /constraint certifications_assignment_fk foreign key\s*\( assignment_id, user_id, department_id, audience, curriculum_version_id \) references learning\.assignments\s*\( id, user_id, department_id, audience, curriculum_version_id \)/,
      "Certification assignment and curriculum lineage must be structural.",
    ],
    [
      "certifications",
      /constraint certifications_requirement_evidence_check check\s*\( cardinality\(requirement_version_ids\) > 0 and array_position\(requirement_version_ids, null\) is null \)/,
      "Certification requirement IDs must be non-empty and non-null.",
    ],
    [
      "emergency_exceptions",
      /grantor_id <> approver_id and grantor_id <> user_id and approver_id <> user_id/,
      "Emergency exception grantor, approver, and beneficiary must be independent.",
    ],
    [
      "emergency_exceptions",
      /approved_at >= created_at and approved_at <= effective_at and expires_at > effective_at and expires_at <= effective_at \+ interval '24 hours'/,
      "Emergency exception chronology and 24-hour limit are required.",
    ],
  ];
  for (const [table, pattern, message] of tablePatterns) {
    requirePattern(
      state.errors,
      normalizeSql(state.tables.get(table) ?? ""),
      pattern,
      message,
    );
  }

  if (
    /references core\.user_roles/.test(
      normalizeSql(state.tables.get("certifications") ?? ""),
    )
  ) {
    state.errors.push(
      "Certification history must not foreign-key live core.user_roles rows.",
    );
  }

  for (const table of ["curriculum_versions", "requirement_versions"]) {
    const normalized = normalizeSql(state.tables.get(table) ?? "");
    requirePattern(
      state.errors,
      normalized,
      /approved_at is null or approved_at >= created_at/,
      `learning.${table} must order approval after creation.`,
    );
    requirePattern(
      state.errors,
      normalized,
      /published_at is null or \(approved_at is not null and published_at >= approved_at\)/,
      `learning.${table} must order publication after approval.`,
    );
    requirePattern(
      state.errors,
      normalized,
      /published_at is null or \(effective_at is not null and published_at <= effective_at\)/,
      `learning.${table} must order publication before effectiveness.`,
    );
  }
  requirePattern(
    state.errors,
    normalizeSql(state.tables.get("certifications") ?? ""),
    /issued_at <= effective_at/,
    "Certifications must be issued before becoming effective.",
  );
  requirePattern(
    state.errors,
    normalizeSql(state.tables.get("certifications") ?? ""),
    /issued_at <= created_at/,
    "Certifications cannot claim a future issuance timestamp.",
  );
  requirePattern(
    state.errors,
    normalizeSql(state.tables.get("attempts") ?? ""),
    /started_at <= submitted_at/,
    "Attempt submission must follow start time.",
  );
  requirePattern(
    state.errors,
    normalizeSql(state.tables.get("attempts") ?? ""),
    /submitted_at <= completed_at/,
    "Attempt completion must follow submission when submitted.",
  );
}

function validateRls(state) {
  for (const table of REQUIRED_TABLES) {
    const rls = state.rls.get(table);
    if (!rls?.sawEnable)
      state.errors.push(`learning.${table} must enable RLS in executable SQL.`);
    else if (!rls.enabled)
      state.errors.push(
        `learning.${table} RLS is disabled in effective migration state by ${rls.disabledBy}.`,
      );
    if (!rls?.forced)
      state.errors.push(
        `learning.${table} must force RLS in effective migration state.`,
      );
  }
}

function validatePrivileges(state) {
  for (const table of REQUIRED_TABLES) {
    const expectedAuthenticated = CONFIG_TABLES.has(table)
      ? ["delete", "insert", "select", "update"]
      : ["select"];
    const expectedByRole = {
      public: [],
      anon: [],
      authenticated: expectedAuthenticated,
      service_role: SERVICE_PRIVILEGES[table],
    };
    for (const [role, expected] of Object.entries(expectedByRole)) {
      const actual = [...(state.privileges.get(role)?.get(table) ?? [])].sort();
      const wanted = [...expected].sort();
      if (actual.join(",") !== wanted.join(",")) {
        state.errors.push(
          `Unsafe effective grant on learning.${table} for ${role}: expected [${wanted.join(", ")}], found [${actual.join(", ")}].`,
        );
      }
    }
  }
}

function policyHas(policy, pattern) {
  return pattern.test(policy?.normalized ?? "");
}

function validatePolicies(state) {
  for (const [name, policy] of state.policies) {
    const expectedTable = EXPECTED_POLICIES.get(name);
    if (!expectedTable) {
      state.errors.push(
        `Unknown permissive learning policy ${name} on learning.${policy.table}.`,
      );
      continue;
    }
    if (policy.table !== expectedTable) {
      state.errors.push(
        `Policy ${name} targets learning.${policy.table}, expected learning.${expectedTable}.`,
      );
    }
    if (
      !/\bto authenticated\b/.test(policy.normalized) ||
      /\bto (?:public|anon|service_role)\b/.test(policy.normalized)
    ) {
      state.errors.push(`Policy ${name} must be scoped only to authenticated.`);
    }
    const compactPolicy = policy.normalized.replace(/\s+/g, "");
    if (
      /\busing\(\(*true\)*\)/.test(compactPolicy) ||
      /\bwithcheck\(\(*true\)*\)/.test(compactPolicy)
    ) {
      state.errors.push(`Policy ${name} is an unsafe permissive policy.`);
    }
  }

  for (const [name] of EXPECTED_POLICIES) {
    if (!state.policies.has(name))
      state.errors.push(`Missing required bounded policy ${name}.`);
  }

  const boundedPolicyRules = [
    [
      "learning_curricula_published_read",
      [
        /status = 'active'/,
        /private\.learning_audience_matches_current_profile\(audience\)/,
      ],
    ],
    [
      "learning_requirements_published_read",
      [
        /status = 'active'/,
        /private\.learning_audience_matches_current_profile\(audience\)/,
      ],
    ],
    [
      "learning_curriculum_versions_published_read",
      [
        /status = 'published'/,
        /effective_at <= now\(\)/,
        /expires_at is null or expires_at > now\(\)/,
        /private\.learning_audience_matches_current_profile\(audience\)/,
      ],
    ],
    [
      "learning_requirement_versions_published_read",
      [
        /status = 'published'/,
        /effective_at <= now\(\)/,
        /expires_at is null or expires_at > now\(\)/,
        /private\.learning_audience_matches_current_profile\(audience\)/,
      ],
    ],
    [
      "learning_role_curricula_published_read",
      [
        /effective_at <= now\(\)/,
        /expires_at is null or expires_at > now\(\)/,
        /private\.learning_audience_matches_current_profile\(audience\)/,
      ],
    ],
    [
      "learning_curricula_department_manage",
      [
        /audience = 'internal'/,
        /governance_owner = 'department'/,
        /private\.learning_owns_department\(owner_department_id\)/,
      ],
    ],
    [
      "learning_requirements_owner_manage",
      [
        /audience = 'internal'/,
        /governance_owner = 'department'/,
        /private\.learning_owns_department\(owner_department_id\)/,
        /core\.has_cap\('legal', 'review_accreditation'\)/,
        /not core\.is_vendor\(\)/,
      ],
    ],
    [
      "learning_curriculum_versions_owner_manage",
      [
        /curriculum\.id = learning\.curriculum_versions\.curriculum_id/,
        /curriculum\.audience = learning\.curriculum_versions\.audience/,
        /private\.learning_owns_department\(curriculum\.owner_department_id\)/,
        /not core\.is_vendor\(\)/,
      ],
    ],
    [
      "learning_curricula_legal_manage",
      [
        /governance_owner = 'legal'/,
        /core\.has_cap\('legal', 'review_accreditation'\)/,
        /not core\.is_vendor\(\)/,
      ],
    ],
  ];
  for (const [name, patterns] of boundedPolicyRules) {
    const policy = state.policies.get(name);
    if (patterns.some((pattern) => !policyHas(policy, pattern))) {
      state.errors.push(
        `${name} is missing a required bounded policy predicate.`,
      );
    }
  }

  for (const name of [
    "learning_curricula_platform_manage",
    "learning_curriculum_versions_platform_manage",
    "learning_requirements_platform_manage",
    "learning_requirement_versions_platform_manage",
    "learning_curriculum_requirements_platform_manage",
    "learning_role_curricula_platform_manage",
  ]) {
    const policy = state.policies.get(name);
    if (
      !policyHas(policy, /for all to authenticated/) ||
      !policyHas(
        policy,
        /private\.learning_is_active_employee_platform_admin\(\)/,
      )
    ) {
      state.errors.push(
        `${name} must require an active employee Platform Administrator.`,
      );
    }
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
    const policy = state.policies.get(`learning_${table}_platform_read`);
    if (
      !policyHas(
        policy,
        /private\.learning_is_active_employee_platform_admin\(\)/,
      ) ||
      !policyHas(policy, /audience = 'internal'/)
    ) {
      state.errors.push(
        `Platform evidence policy for learning.${table} must reject vendors and remain internal-only.`,
      );
    }
  }

  const assignmentsLearner = state.policies.get(
    "learning_assignments_learner_read",
  );
  if (
    !policyHas(assignmentsLearner, /not core\.is_vendor\(\)/) ||
    !policyHas(assignmentsLearner, /user_id = \(select auth\.uid\(\)\)/) ||
    !policyHas(
      assignmentsLearner,
      /private\.learning_audience_matches_current_profile\(audience\)/,
    )
  ) {
    state.errors.push(
      "Assignments learner policy must be bounded to an active internal self and matching audience.",
    );
  }

  const assignmentsVendor = state.policies.get(
    "learning_assignments_vendor_read",
  );
  if (
    !policyHas(assignmentsVendor, /core\.is_vendor\(\)/) ||
    !policyHas(assignmentsVendor, /user_id = \(select auth\.uid\(\)\)/) ||
    !policyHas(assignmentsVendor, /audience = 'vendor'/)
  ) {
    state.errors.push(
      "Vendor assignment policy must be self-only and vendor-audience-only.",
    );
  }

  for (const table of [
    "assignment_requirements",
    "attempts",
    "attempt_events",
    "policy_acknowledgments",
    "certifications",
  ]) {
    const learner = state.policies.get(`learning_${table}_learner_read`);
    if (
      !policyHas(learner, /user_id = \(select auth\.uid\(\)\)/) ||
      !policyHas(
        learner,
        /private\.learning_audience_matches_current_profile\(audience\)/,
      )
    ) {
      state.errors.push(
        `Learner policy for learning.${table} must be self-only and audience-safe.`,
      );
    }
  }

  const exceptionLearner = state.policies.get(
    "learning_emergency_exceptions_learner_read",
  );
  if (
    !policyHas(exceptionLearner, /user_id = \(select auth\.uid\(\)\)/) ||
    !policyHas(exceptionLearner, /not core\.is_vendor\(\)/) ||
    !policyHas(exceptionLearner, /audience = 'internal'/)
  ) {
    state.errors.push(
      "Emergency-exception learner policy must be internal and self-only.",
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
    const owner = state.policies.get(`learning_${table}_department_owner_read`);
    if (
      !policyHas(owner, /private\.learning_owns_department\(department_id\)/) ||
      !policyHas(owner, /audience = 'internal'/)
    ) {
      state.errors.push(
        `Department-owner policy for learning.${table} must be internally scoped.`,
      );
    }
  }

  const requirementOwner = state.policies.get(
    "learning_requirement_versions_owner_manage",
  );
  for (const pattern of [
    /from learning\.requirements parent_requirement/,
    /parent_requirement\.id = learning\.requirement_versions\.requirement_id/,
    /parent_requirement\.owner_department_id is not distinct from learning\.requirement_versions\.owner_department_id/,
    /private\.learning_owns_department\(parent_requirement\.owner_department_id\)/,
  ]) {
    if (!policyHas(requirementOwner, pattern)) {
      state.errors.push(
        "Requirement-version owner policy must authorize from the structurally matching parent requirement.",
      );
      break;
    }
  }

  const compositionRead = state.policies.get(
    "learning_curriculum_requirements_published_read",
  );
  if (
    !policyHas(
      compositionRead,
      /version\.id = learning\.curriculum_requirements\.curriculum_version_id/,
    ) ||
    !policyHas(
      compositionRead,
      /version\.audience = learning\.curriculum_requirements\.audience/,
    )
  ) {
    state.errors.push(
      "Curriculum composition read policy must qualify its outer version and audience correlation.",
    );
  }

  for (const name of [
    "learning_policy_acknowledgments_legal_read",
    "learning_policy_acknowledgments_legal_vendor_read",
  ]) {
    const policy = state.policies.get(name);
    if (
      !policyHas(policy, /core\.has_cap\('legal', 'review_accreditation'\)/) ||
      !policyHas(policy, /not core\.is_vendor\(\)/) ||
      !policyHas(
        policy,
        /requirement_version\.id = learning\.policy_acknowledgments\.requirement_version_id/,
      )
    ) {
      state.errors.push(
        `${name} must be a bounded, employee-only Legal policy with qualified requirement lineage.`,
      );
    }
  }
}

function validateFunctions(state) {
  requireFunction(
    state,
    "private.learning_is_active_employee_platform_admin",
    [
      /profile\.kind = 'employee'/,
      /profile\.status = 'active'/,
      /core\.has_cap\('core', 'manage_rbac'\)/,
    ],
    "Platform policy helper must fail closed to an active employee Platform Administrator.",
  );
  requireFunction(
    state,
    "learning.reject_evidence_mutation",
    [/raise exception/],
    "Append-only evidence guard is missing or inert.",
  );
  requireFunction(
    state,
    "learning.guard_attempt_lifecycle",
    [
      /old\.status <> 'in_progress'/,
      /new\.status not in \('passed', 'failed', 'abandoned', 'invalidated'\)/,
      /array\['status', 'score', 'integrity_result', 'submitted_at', 'completed_at'\]/,
      /raise exception/,
    ],
    "Attempt lifecycle guard is missing or inert.",
  );
  requireFunction(
    state,
    "learning.guard_certification_lifecycle",
    [
      /tg_op = 'delete'/,
      /old\.status <> 'active'/,
      /certification issuance evidence is immutable/,
      /raise exception/,
    ],
    "Certification lifecycle guard is missing or inert.",
  );
  requireFunction(
    state,
    "learning.guard_emergency_exception_lifecycle",
    [
      /tg_op = 'delete'/,
      /old\.status <> 'active'/,
      /emergency exception approval evidence is immutable/,
      /raise exception/,
    ],
    "Emergency exception lifecycle guard is missing or inert.",
  );
  requireFunction(
    state,
    "learning.guard_content_lifecycle",
    [
      /tg_op = 'insert'/,
      /new\.status <> 'draft'/,
      /old\.status = 'draft'/,
      /old\.status = 'in_review'/,
      /finalized learning content is immutable/,
      /raise exception/,
    ],
    "Content lifecycle guard is missing or inert.",
  );
  requireFunction(
    state,
    "learning.guard_curriculum_composition",
    [
      /approved/,
      /scheduled/,
      /published/,
      /superseded/,
      /retired/,
      /raise exception/,
    ],
    "Curriculum composition guard is missing or inert; published composition must be immutable.",
  );
  requireFunction(
    state,
    "private.validate_assignment_requirement_waiver",
    [
      /not requirement_version\.waivable/,
      /parent_requirement\.governance_owner = 'legal'/,
      /parent_requirement\.requirement_kind = 'policy'/,
      /raise exception/,
    ],
    "Assignment-requirement waiver guard must reject non-waivable and Legal policy requirements.",
  );
  requireFunction(
    state,
    "private.validate_certification_issuance",
    [
      /core\.user_roles/,
      /profile\.status <> 'active'/,
      /core\.role_capabilities/,
      /learning\.role_curricula/,
      /learning\.curriculum_versions/,
      /curriculum_version\.status = 'published'/,
      /candidate\.curriculum_version_id = new\.curriculum_version_id/,
      /learning\.curriculum_requirements/,
      /learning\.assignment_requirements/,
      /raise exception/,
    ],
    "Certification issuance validator must prove active role, capability, published curriculum, audience, and requirement lineage.",
  );
  requireFunction(
    state,
    "private.revoke_certifications_for_role_assignment",
    [
      /update learning\.certifications/,
      /status = 'revoked'/,
      /source_role_assignment_id = old\.id/,
    ],
    "Role deletion must revoke dependent active certifications without deleting history.",
  );
  requireFunction(
    state,
    "private.validate_emergency_exception_issuance",
    [
      /beneficiary_profile\.kind = 'employee'/,
      /grantor_profile\.status = 'active'/,
      /grantor_role\.role = 'platform_admin'/,
      /approver_profile\.status = 'active'/,
      /approver_scope\.department_id = new\.department_id/,
      /approver_capability\.cap = new\.capability/,
      /raise exception/,
    ],
    "Emergency exception issuance must validate active independent parties, capability, and department scope.",
  );
}

function validateTriggers(state) {
  for (const [name, expected] of Object.entries(REQUIRED_TRIGGERS)) {
    const trigger = state.triggers.get(name);
    if (
      !trigger ||
      trigger.table !== expected.table ||
      trigger.events !== expected.events ||
      trigger.function !== expected.function
    ) {
      state.errors.push(
        `Missing or weakened trigger ${name} on ${expected.table}.`,
      );
      continue;
    }
    const disabled = state.disabledTriggers.get(expected.table);
    if (disabled?.has("all") || disabled?.has("user") || disabled?.has(name)) {
      state.errors.push(
        `Required trigger ${name} is disabled in effective migration state.`,
      );
    }
  }
}

function validateIndexes(state) {
  for (const table of REQUIRED_TABLES) {
    const statement = state.tables.get(table);
    if (!statement) continue;
    const candidates = tableIndexCandidates(state, table, statement);
    for (const foreignKey of foreignKeys(statement, table)) {
      const covered = candidates.some(
        (candidate) =>
          candidate.length >= foreignKey.columns.length &&
          foreignKey.columns.every(
            (column, index) => candidate[index] === column,
          ),
      );
      if (!covered) {
        state.errors.push(
          `Foreign key ${foreignKey.name} on learning.${table} is missing a complete leading-column index.`,
        );
      }
    }
  }

  const businessIndexes = [
    [
      "learning_one_active_certification_idx",
      "certifications",
      [
        "user_id",
        "department_id",
        "module",
        "capability",
        "source_role_assignment_id",
      ],
      /where status = 'active'/,
    ],
    [
      "learning_one_open_assignment_idx",
      "assignments",
      ["user_id", "curriculum_version_id", "source_type", "source_id"],
      /where status in \('assigned', 'in_progress', 'blocked'\)/,
    ],
    [
      "learning_one_global_role_curriculum_idx",
      "role_curricula",
      ["module", "role", "curriculum_version_id"],
      /where department_id is null/,
    ],
    [
      "learning_one_scoped_role_curriculum_idx",
      "role_curricula",
      ["module", "role", "curriculum_version_id", "department_id"],
      /where department_id is not null/,
    ],
  ];
  for (const [name, table, columns, predicate] of businessIndexes) {
    const index = state.indexes.get(name);
    if (
      !index ||
      index.table !== table ||
      !index.unique ||
      index.columns.join(",") !== columns.join(",") ||
      !predicate.test(index.normalized)
    ) {
      state.errors.push(
        `Missing or weakened business uniqueness index ${name}.`,
      );
    }
  }
}

function validateAuthorityIsolation(state) {
  const executableSql = [...state.tables.values(), ...state.functions.values()]
    .map((value) => value.statement ?? value)
    .join("\n");
  if (
    /insert\s+into\s+core\.(?:user_roles|profile_department_scopes)[\s\S]*?learning\.certifications/i.test(
      executableSql,
    )
  ) {
    state.errors.push(
      "Certifications must never grant roles or department scope.",
    );
  }
}

export function verifyLearningSchema(input) {
  const migrations = asMigrations(input);
  const state = createState();

  if (
    !migrations.some(
      (migration) => migration.name === FOUNDATION_MIGRATION_NAME,
    )
  ) {
    state.errors.push(
      `Missing forward foundation migration ${FOUNDATION_MIGRATION_NAME}.`,
    );
  }

  for (const migration of migrations) {
    let statements;
    try {
      statements = scanSql(migration.sql);
    } catch (error) {
      state.errors.push(`${migration.name}: ${error.message}`);
      continue;
    }
    for (const statement of statements)
      processStatement(state, statement, migration.name);
  }

  validateTables(state);
  validateRls(state);
  validatePrivileges(state);
  validatePolicies(state);
  validateFunctions(state);
  validateTriggers(state);
  validateIndexes(state);
  validateAuthorityIsolation(state);

  return [...new Set(state.errors)];
}

function run() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const migrationDirectory = resolve(root, "supabase/migrations");
  const migrations = readdirSync(migrationDirectory)
    .filter(
      (name) =>
        /^\d{14}_[a-z0-9_]+\.sql$/i.test(name) &&
        name >= FOUNDATION_MIGRATION_NAME,
    )
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(resolve(migrationDirectory, name), "utf8"),
    }));
  const errors = verifyLearningSchema(migrations);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log(
    `Learning schema contract passed (${REQUIRED_TABLES.length} governed tables across ${migrations.length} effective migration${migrations.length === 1 ? "" : "s"}).`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  run();
}
