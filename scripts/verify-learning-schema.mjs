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
  "curriculum_requirement_prerequisites",
  "curriculum_capability_outcomes",
  "role_curricula",
  "assignments",
  "assignment_requirements",
  "attempts",
  "attempt_events",
  "policy_acknowledgments",
  "certifications",
  "emergency_exceptions",
]);

const SERVICE_PRIVILEGES = Object.freeze({
  curricula: ["delete", "insert", "select", "update"],
  curriculum_versions: ["delete", "insert", "select", "update"],
  requirements: ["delete", "insert", "select", "update"],
  requirement_versions: ["delete", "insert", "select", "update"],
  curriculum_requirements: ["delete", "insert", "select", "update"],
  curriculum_requirement_prerequisites: [
    "delete",
    "insert",
    "select",
    "update",
  ],
  curriculum_capability_outcomes: ["delete", "insert", "select", "update"],
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
  [
    "learning_curriculum_requirement_prerequisites_published_read",
    "curriculum_requirement_prerequisites",
  ],
  [
    "learning_curriculum_requirement_prerequisites_platform_manage",
    "curriculum_requirement_prerequisites",
  ],
  [
    "learning_curriculum_capability_outcomes_published_read",
    "curriculum_capability_outcomes",
  ],
  [
    "learning_curriculum_capability_outcomes_platform_manage",
    "curriculum_capability_outcomes",
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
  ...Object.fromEntries(
    REQUIRED_TABLES.map((table) => [
      `learning_${table}_read_committed_guard`,
      {
        table: `learning.${table}`,
        events: "before insert or update or delete",
        function: "learning.guard_authoritative_write_isolation",
      },
    ]),
  ),
  learning_attempts_lifecycle_guard: {
    table: "learning.attempts",
    events: "before insert or update or delete",
    function: "learning.guard_attempt_lifecycle",
  },
  learning_assignments_lifecycle_guard: {
    table: "learning.assignments",
    events: "before insert or update or delete",
    function: "learning.guard_assignment_lifecycle",
  },
  learning_assignment_requirements_lifecycle_guard: {
    table: "learning.assignment_requirements",
    events: "before insert or update or delete",
    function: "learning.guard_assignment_requirement_lifecycle",
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
  learning_curriculum_requirement_prerequisites_composition_guard: {
    table: "learning.curriculum_requirement_prerequisites",
    events: "before insert or update or delete",
    function: "learning.guard_curriculum_composition",
  },
  learning_curriculum_capability_outcomes_composition_guard: {
    table: "learning.curriculum_capability_outcomes",
    events: "before insert or update or delete",
    function: "learning.guard_curriculum_composition",
  },
  learning_revoke_certifications_on_role_delete: {
    table: "core.user_roles",
    events: "before delete",
    function: "private.revoke_certifications_for_role_assignment",
  },
});

const ALLOWED_SECURITY_DEFINERS = new Set([
  "private.learning_has_active_profile",
  "private.learning_owns_department",
  "private.learning_is_active_employee_platform_admin",
  "private.assert_learning_read_committed",
  "private.lock_learning_curriculum_graph",
  "private.validate_curriculum_graph_publication",
  "private.validate_assignment_requirement_waiver",
  "private.validate_certification_issuance",
  "private.revoke_certifications_for_role_assignment",
  "private.validate_emergency_exception_issuance",
]);

const ALLOWED_FUNCTION_EXECUTE = Object.freeze({
  "private.learning_has_active_profile": ["authenticated", "service_role"],
  "private.learning_owns_department": ["authenticated", "service_role"],
  "private.learning_is_active_employee_platform_admin": [
    "authenticated",
    "service_role",
  ],
  "private.assert_learning_read_committed": ["service_role"],
  "private.lock_learning_curriculum_graph": ["service_role"],
  "private.validate_curriculum_graph_publication": ["service_role"],
});

const MODELED_FUNCTIONS = new Set([
  ...ALLOWED_SECURITY_DEFINERS,
  ...Object.values(REQUIRED_TRIGGERS).map((trigger) => trigger.function),
]);

const ISOLATION_GUARDED_FUNCTIONS = new Set([
  ...Object.values(REQUIRED_TRIGGERS).map((trigger) => trigger.function),
  "private.lock_learning_curriculum_graph",
  "private.validate_curriculum_graph_publication",
]);

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

function truncateAfterTopLevelReturn(body) {
  const stack = [];
  const tokenPattern = /'(?:''|[^'])*'|[a-z_][a-z0-9_]*|;/gi;
  let skipClosingWord = "";
  let match;
  while ((match = tokenPattern.exec(body))) {
    const token = match[0].toLowerCase();
    if (token.startsWith("'")) continue;
    if (skipClosingWord && token === skipClosingWord) {
      skipClosingWord = "";
      continue;
    }
    if (token === "end") {
      const closing = body
        .slice(tokenPattern.lastIndex)
        .match(/^\s+(if|case|loop)\b/i)?.[1]
        ?.toLowerCase();
      stack.pop();
      skipClosingWord = closing ?? "";
      continue;
    }
    if (["begin", "if", "case", "loop"].includes(token)) {
      stack.push(token);
      continue;
    }
    if (token === "return" && stack.length === 1 && stack[0] === "begin") {
      const semicolon = body.indexOf(";", tokenPattern.lastIndex);
      if (semicolon >= 0) return normalizeSql(body.slice(0, semicolon + 1));
    }
  }
  return normalizeSql(body);
}

function withoutStaticallyUnreachableBranches(body) {
  let reachable = body;
  let previous;
  do {
    previous = reachable;
    reachable = reachable
      .replace(
        /\bif\s+(?:false|1\s*=\s*0|0\s*=\s*1)\s+then\b[\s\S]*?\bend if\s*;/g,
        " ",
      )
      .replace(
        /\bcase\s+when\s+(?:false|1\s*=\s*0|0\s*=\s*1)\s+then\b[\s\S]*?\bend\s*;/g,
        " ",
      )
      .replace(
        /\bif\s+(?:true|1\s*=\s*1|not\s+false)\s+then\s+([\s\S]*?)\bend if\s*;/g,
        (statement, branch) =>
          /\breturn\b/.test(branch) ? ` ${branch} ` : statement,
      )
      .replace(
        /\bcase\s+when\s+(?:true|1\s*=\s*1|not\s+false)\s+then\s+([\s\S]*?)\bend(?: case)?\s*;/g,
        (statement, branch) =>
          /\breturn\b/.test(branch) ? ` ${branch} ` : statement,
      );
  } while (reachable !== previous);
  return truncateAfterTopLevelReturn(reachable);
}

function parenthesizedClause(statement, keyword) {
  const lower = statement.toLowerCase();
  const keywordIndex = lower.search(new RegExp(`\\b${keyword}\\s*\\(`));
  if (keywordIndex < 0) return "";
  const start = statement.indexOf("(", keywordIndex);
  let depth = 0;
  let quote = "";
  for (let index = start; index < statement.length; index += 1) {
    const char = statement[index];
    const next = statement[index + 1];
    if (quote) {
      if (char === quote && next === quote) index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return statement.slice(start + 1, index);
    }
  }
  return "";
}

function hasPolicyTautology(expression) {
  const normalized = normalizeSql(expression);
  if (/\btrue\b/.test(normalized)) return true;
  if (
    /\b(\d+(?:\.\d+)?)\s*=\s*\1\b/.test(normalized) ||
    /\b([a-z_][a-z0-9_.]*)\s*(?:=|is not distinct from)\s*\1\b/.test(
      normalized,
    ) ||
    /('(?:''|[^'])*')\s*=\s*\1/.test(normalized)
  ) {
    return true;
  }
  return false;
}

function unwrapBooleanExpression(expression) {
  let value = expression.trim();
  let changed = true;
  while (changed && value.startsWith("(") && value.endsWith(")")) {
    changed = false;
    let depth = 0;
    let quote = "";
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      const next = value[index + 1];
      if (quote) {
        if (char === quote && next === quote) index += 1;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0 && index === value.length - 1) {
          value = value.slice(1, -1).trim();
          changed = true;
        } else if (depth === 0) {
          break;
        }
      }
    }
  }
  return value;
}

function splitTopLevelBoolean(expression, operator) {
  const value = unwrapBooleanExpression(expression);
  const lower = value.toLowerCase();
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote) {
      if (char === quote && next === quote) index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (
      depth === 0 &&
      lower.slice(index, index + operator.length) === operator &&
      !/[a-z0-9_$]/i.test(value[index - 1] ?? "") &&
      !/[a-z0-9_$]/i.test(value[index + operator.length] ?? "")
    ) {
      parts.push(value.slice(start, index).trim());
      start = index + operator.length;
      index += operator.length - 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function hasPositiveActiveProfileGuard(expression) {
  const value = normalizeSql(expression);
  const helper = /private\.learning_has_active_profile\s*\([^)]*\)/;
  if (!helper.test(value)) return false;
  if (
    /\bnot\s*(?:\(\s*)*private\.learning_has_active_profile\s*\(/.test(value) ||
    /private\.learning_has_active_profile\s*\([^)]*\)\s*(?:=\s*false|!=\s*true|<>\s*true|is\s+false|is\s+not\s+true)/.test(
      value,
    )
  ) {
    return false;
  }
  return true;
}

function activeProfileGuardsEveryPath(expression) {
  const value = unwrapBooleanExpression(expression);
  const alternatives = splitTopLevelBoolean(value, "or");
  if (alternatives.length > 1) {
    return alternatives.every(activeProfileGuardsEveryPath);
  }
  const conjunctions = splitTopLevelBoolean(value, "and");
  if (conjunctions.length > 1) {
    return conjunctions.some(activeProfileGuardsEveryPath);
  }
  return hasPositiveActiveProfileGuard(value);
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
  const normalized = normalizeSql(statement).replaceAll('"', "");
  const isFoundation = migrationName === FOUNDATION_MIGRATION_NAME;
  let match;

  if (normalized === "create schema if not exists learning") {
    if (!isFoundation)
      state.errors.push(
        `${migrationName}: learning schema bootstrap may not repeat.`,
      );
    return;
  }

  if (
    normalized ===
    "grant usage on schema learning to authenticated, service_role"
  ) {
    if (!isFoundation)
      state.errors.push(
        `${migrationName}: learning schema grants are immutable.`,
      );
    return;
  }

  if (
    /^alter role authenticator set pgrst\.db_schemas = 'public, core, warehouse, procurement, legal, product, learning, graphql_public'$/.test(
      normalized,
    )
  ) {
    if (!isFoundation)
      state.errors.push(
        `${migrationName}: exposed schema configuration is immutable.`,
      );
    return;
  }

  if (
    /^alter table core\.user_roles add column if not exists id uuid not null default gen_random_uuid\(\)$/.test(
      normalized,
    ) ||
    /^create unique index if not exists (?:core_user_roles_id_key|core_user_roles_assignment_identity_key|core_profiles_id_kind_key) on core\.(?:user_roles|profiles)\([^)]*\)$/.test(
      normalized,
    )
  ) {
    if (!isFoundation)
      state.errors.push(
        `${migrationName}: authority identity bootstrap may not repeat.`,
      );
    return;
  }

  if (/^notify pgrst, 'reload (?:config|schema)'$/.test(normalized)) {
    if (!isFoundation)
      state.errors.push(
        `${migrationName}: unmodeled PostgREST notification is denied.`,
      );
    return;
  }

  match = normalized.match(
    /^create table(?: if not exists)? learning\.([a-z_]+)\b/,
  );
  if (match) {
    if (!REQUIRED_TABLES.includes(match[1])) {
      state.errors.push(
        `${migrationName}: unmodeled learning table ${match[1]} is outside the governed boundary.`,
      );
      return;
    }
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
    if (!rls) {
      state.errors.push(
        `${migrationName}: RLS change targets unmodeled learning table ${match[1]}.`,
      );
      return;
    }
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
    if (!rls) {
      state.errors.push(
        `${migrationName}: FORCE RLS change targets unmodeled learning table ${match[1]}.`,
      );
      return;
    }
    rls.forced = match[2] === "force";
    return;
  }

  match = normalized.match(
    /^alter table(?: only)? ((?:learning|core)\.[a-z_]+) (enable(?: always| replica)?|disable) trigger (all|user|[a-z_]+)$/,
  );
  if (match) {
    const table = match[1];
    const triggerName = match[3];
    if (
      !isFoundation &&
      !["all", "user"].includes(triggerName) &&
      !Object.hasOwn(REQUIRED_TRIGGERS, triggerName)
    ) {
      state.errors.push(
        `${migrationName}: unmodeled trigger mode change for ${triggerName} is default-denied.`,
      );
      return;
    }
    if (!state.disabledTriggers.has(table))
      state.disabledTriggers.set(table, new Set());
    const disabled = state.disabledTriggers.get(table);
    if (match[2] === "disable" || match[2] === "enable replica")
      disabled.add(match[3]);
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
    /^alter table(?: only)? learning\.certifications\b/.test(normalized) &&
    /\badd\b/.test(normalized) &&
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
    const name = match[1].replaceAll('"', "");
    if (!isFoundation && !EXPECTED_POLICIES.has(name)) {
      state.errors.push(
        `${migrationName}: dropping unmodeled policy ${name} is default-denied.`,
      );
      return;
    }
    state.policies.delete(name);
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
    if (/\bwith grant option\b/.test(normalized)) {
      state.errors.push(
        `${migrationName}: learning privileges may not be delegated with GRANT OPTION.`,
      );
      return;
    }
    if (!REQUIRED_TABLES.includes(table)) {
      state.errors.push(
        `${migrationName}: privilege on unmodeled learning object ${table} is forbidden.`,
      );
      return;
    }
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
    /^grant execute on function ([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\([^)]*\) to (.+)$/,
  );
  if (match) {
    if (/\bwith grant option\b/.test(normalized)) {
      state.errors.push(
        `${migrationName}: function EXECUTE may not be delegated with GRANT OPTION.`,
      );
      return;
    }
    const functionEntry = state.functions.get(match[1]);
    if (!functionEntry) {
      state.errors.push(
        `${migrationName}: EXECUTE granted on unknown function ${match[1]}.`,
      );
      return;
    }
    for (const role of parseGrantees(match[2]))
      functionEntry.executeRoles.add(role);
    return;
  }

  match = normalized.match(
    /^revoke (?:all(?: privileges)?|execute) on function ([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\([^)]*\) from (.+?)(?: cascade| restrict)?$/,
  );
  if (match) {
    const functionEntry = state.functions.get(match[1]);
    if (!functionEntry) {
      if (!isFoundation) {
        state.errors.push(
          `${migrationName}: privilege change targets unknown function ${match[1]}.`,
        );
      }
      return;
    }
    for (const role of parseGrantees(match[2]))
      functionEntry.executeRoles.delete(role);
    return;
  }

  if (
    /^(grant|revoke)\b/.test(normalized) &&
    /\bon (?:all )?functions?\b/.test(normalized)
  ) {
    state.errors.push(
      `${migrationName}: unparsed or schema-wide function privilege is unsafe.`,
    );
    return;
  }

  match = normalized.match(
    /^revoke (.+?) on (?:table )?learning\.([a-z_]+) from (.+?)(?: cascade| restrict)?$/,
  );
  if (match) {
    const [, privilegeSql, table, granteeSql] = match;
    if (!REQUIRED_TABLES.includes(table)) {
      state.errors.push(
        `${migrationName}: privilege on unmodeled learning object ${table} is forbidden.`,
      );
      return;
    }
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
    /^create (or replace )?function ([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(/,
  );
  if (match) {
    if (!MODELED_FUNCTIONS.has(match[2])) {
      state.errors.push(
        `${migrationName}: unmodeled procedural function ${match[2]} is default-denied.`,
      );
      return;
    }
    const existingExecute = state.functions.get(match[2])?.executeRoles;
    state.functions.set(match[2], {
      statement,
      body: functionBody(statement),
      reachableBody: withoutStaticallyUnreachableBranches(
        functionBody(statement),
      ),
      securityDefiner: /\bsecurity definer\b/.test(normalized),
      executeRoles:
        match[1] && existingExecute
          ? new Set(existingExecute)
          : new Set(["public"]),
      migrationName,
    });
    return;
  }

  match = normalized.match(
    /^drop function(?: if exists)? ([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(/,
  );
  if (match) {
    if (!isFoundation) {
      state.errors.push(
        `${migrationName}: dropping a modeled function is default-denied.`,
      );
      return;
    }
    state.functions.delete(match[1]);
    return;
  }

  if (/^alter function\b/.test(normalized)) {
    state.errors.push(
      `${migrationName}: ALTER FUNCTION is not safely analyzable in the learning security boundary.`,
    );
    return;
  }

  match = normalized.match(
    /^create (?:or replace )?trigger ([a-z_]+) (.+?) on ((?:learning|core)\.[a-z_]+) for each row execute function ((?:learning|private)\.[a-z_]+)\s*\(/,
  );
  if (match) {
    if (!Object.hasOwn(REQUIRED_TRIGGERS, match[1])) {
      state.errors.push(
        `${migrationName}: unmodeled trigger ${match[1]} is default-denied.`,
      );
      return;
    }
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
    if (!isFoundation && !Object.hasOwn(REQUIRED_TRIGGERS, match[1])) {
      state.errors.push(
        `${migrationName}: dropping unmodeled trigger ${match[1]} is default-denied.`,
      );
      return;
    }
    state.triggers.delete(match[1]);
    return;
  }

  match = normalized.match(
    /^create (unique )?index(?: if not exists)? ([a-z_]+) on learning\.([a-z_]+)\s*\(([^]*?)\)(?: where .+)?$/,
  );
  if (match) {
    if (!isFoundation && !state.indexes.has(match[2])) {
      state.errors.push(
        `${migrationName}: unmodeled index ${match[2]} is default-denied.`,
      );
      return;
    }
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
    /^drop index(?: concurrently)?(?: if exists)? (.+?)(?: cascade| restrict)?$/,
  );
  if (match) {
    if (!isFoundation) {
      state.errors.push(
        `${migrationName}: DROP INDEX is default-denied in the learning boundary.`,
      );
      return;
    }
    for (const rawName of splitTopLevel(match[1])) {
      const name = rawName
        .trim()
        .replace(/^learning\./, "")
        .replaceAll('"', "");
      state.indexes.delete(name);
    }
    return;
  }

  if (/^(?:alter|create|drop) (?:role|user)\b/.test(normalized)) {
    state.errors.push(
      `${migrationName}: role changes, including membership and BYPASSRLS paths, are default-denied.`,
    );
    return;
  }

  state.errors.push(
    `${migrationName}: unmodeled executable statement is default-denied: ${normalized.slice(0, 96)}.`,
  );
}

function requirePattern(errors, value, pattern, message) {
  if (!pattern.test(value)) errors.push(message);
}

function requireFunction(state, name, patterns, message) {
  const functionEntry = state.functions.get(name);
  const body = functionEntry?.reachableBody ?? "";
  if (!body || patterns.some((pattern) => !pattern.test(body))) {
    const unreachable =
      functionEntry?.body && functionEntry.body !== functionEntry.reachableBody;
    state.errors.push(
      unreachable ? `${message} Guard logic is unreachable.` : message,
    );
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
      "curriculum_requirement_prerequisites",
      /constraint curriculum_requirement_prerequisites_source_fk foreign key\s*\( curriculum_requirement_id, curriculum_version_id, requirement_version_id, audience \) references learning\.curriculum_requirements\s*\( id, curriculum_version_id, requirement_version_id, audience \)/,
      "Prerequisite sources must remain in one curriculum graph and audience.",
    ],
    [
      "curriculum_requirement_prerequisites",
      /constraint curriculum_requirement_prerequisites_target_fk foreign key\s*\( curriculum_version_id, prerequisite_requirement_version_id, audience \) references learning\.curriculum_requirements\s*\( curriculum_version_id, requirement_version_id, audience \)/,
      "Prerequisite targets must remain in one curriculum graph and audience.",
    ],
    [
      "curriculum_capability_outcomes",
      /constraint curriculum_capability_outcomes_source_fk foreign key\s*\( curriculum_requirement_id, curriculum_version_id, requirement_version_id, audience \) references learning\.curriculum_requirements\s*\( id, curriculum_version_id, requirement_version_id, audience \)/,
      "Capability outcomes must remain in one curriculum graph and audience.",
    ],
    [
      "curriculum_capability_outcomes",
      /constraint curriculum_capability_outcomes_capability_fk foreign key\s*\(module, capability\) references core\.capabilities\s*\(module, cap\)/,
      "Capability outcomes must reference canonical RBAC capabilities.",
    ],
    [
      "curriculum_capability_outcomes",
      /constraint curriculum_capability_outcomes_audience_check check\s*\( audience = 'internal' or \( audience = 'vendor' and module = 'core' and capability = 'submit_accreditation' \) \)/,
      "Vendor curriculum outcomes must allow only certification-gated core:submit_accreditation.",
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
    [
      "emergency_exceptions",
      /revoked_at is null or \(revoked_at >= created_at and revoked_at >= approved_at\)/,
      "Emergency exception cancellation must follow creation and approval without waiting for effectivity.",
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
    /revoked_at is null or revoked_at >= issued_at/,
    "Certification revocation must follow issuance.",
  );
  requirePattern(
    state.errors,
    normalizeSql(state.tables.get("certifications") ?? ""),
    /superseded_at is null or superseded_at >= issued_at/,
    "Certification supersession must follow issuance.",
  );
  if (
    /prerequisite_requirement_version_ids|capability_outcomes jsonb/.test(
      normalizeSql(state.tables.get("curriculum_requirements") ?? ""),
    )
  ) {
    state.errors.push(
      "Curriculum prerequisites and capability outcomes must be normalized relationally.",
    );
  }
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
    const expectedByRole = {
      public: [],
      anon: [],
      authenticated: ["select"],
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

  for (const [role, tables] of state.privileges) {
    if (["public", "anon", "authenticated", "service_role"].includes(role))
      continue;
    for (const [table, privileges] of tables) {
      if (privileges.size > 0) {
        state.errors.push(
          `Unsafe learning table grantee ${role} has [${[...privileges].sort().join(", ")}] on learning.${table}.`,
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
    const usingExpression = parenthesizedClause(policy.statement, "using");
    const checkExpression = parenthesizedClause(
      policy.statement,
      "with\\s+check",
    );
    if (
      /\busing\(\(*true\)*\)/.test(compactPolicy) ||
      /\bwithcheck\(\(*true\)*\)/.test(compactPolicy) ||
      hasPolicyTautology(usingExpression) ||
      hasPolicyTautology(checkExpression)
    ) {
      state.errors.push(
        `Policy ${name} contains an unsafe permissive or tautological expression.`,
      );
    }
    const policyExpressions = [usingExpression, checkExpression].filter(
      Boolean,
    );
    if (
      policyExpressions.length === 0 ||
      policyExpressions.some(
        (expression) => !activeProfileGuardsEveryPath(expression),
      )
    ) {
      state.errors.push(
        `Policy ${name} must require the shared fail-closed active profile helper on every authorization path.`,
      );
    }
  }

  for (const [name] of EXPECTED_POLICIES) {
    if (!state.policies.has(name))
      state.errors.push(`Missing required bounded policy ${name}.`);
  }

  const boundedPolicyRules = [
    [
      "learning_curricula_published_read",
      [/status = 'active'/, /private\.learning_has_active_profile\(audience\)/],
    ],
    [
      "learning_requirements_published_read",
      [/status = 'active'/, /private\.learning_has_active_profile\(audience\)/],
    ],
    [
      "learning_curriculum_versions_published_read",
      [
        /status = 'published'/,
        /effective_at <= now\(\)/,
        /expires_at is null or expires_at > now\(\)/,
        /private\.learning_has_active_profile\(audience\)/,
      ],
    ],
    [
      "learning_requirement_versions_published_read",
      [
        /status = 'published'/,
        /effective_at <= now\(\)/,
        /expires_at is null or expires_at > now\(\)/,
        /private\.learning_has_active_profile\(audience\)/,
      ],
    ],
    [
      "learning_role_curricula_published_read",
      [
        /effective_at <= now\(\)/,
        /expires_at is null or expires_at > now\(\)/,
        /private\.learning_has_active_profile\(audience\)/,
      ],
    ],
    [
      "learning_curriculum_requirement_prerequisites_published_read",
      [
        /version\.id = learning\.curriculum_requirement_prerequisites\.curriculum_version_id/,
        /version\.audience = learning\.curriculum_requirement_prerequisites\.audience/,
        /version\.status = 'published'/,
        /version\.effective_at <= now\(\)/,
      ],
    ],
    [
      "learning_curriculum_capability_outcomes_published_read",
      [
        /version\.id = learning\.curriculum_capability_outcomes\.curriculum_version_id/,
        /version\.audience = learning\.curriculum_capability_outcomes\.audience/,
        /version\.status = 'published'/,
        /version\.effective_at <= now\(\)/,
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
    "learning_curriculum_requirement_prerequisites_platform_manage",
    "learning_curriculum_capability_outcomes_platform_manage",
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
      /private\.learning_has_active_profile\(audience\)/,
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
      !policyHas(learner, /private\.learning_has_active_profile\(audience\)/)
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
    "private.assert_learning_read_committed",
    [
      /current_setting\('transaction_isolation'\)/,
      /<> 'read committed'/,
      /raise exception/,
    ],
    "Authoritative learning writes must reject isolation levels other than READ COMMITTED.",
  );
  requireFunction(
    state,
    "private.learning_has_active_profile",
    [
      /profile\.status = 'active'/,
      /profile\.kind = 'employee'/,
      /profile\.kind = 'vendor'/,
    ],
    "All authenticated RLS paths must share one fail-closed active profile helper.",
  );
  requireFunction(
    state,
    "private.learning_is_active_employee_platform_admin",
    [
      /private\.learning_has_active_profile\('internal'\)/,
      /core\.has_cap\('core', 'manage_rbac'\)/,
    ],
    "Platform policy helper must fail closed to an active employee Platform Administrator.",
  );
  requireFunction(
    state,
    "learning.guard_authoritative_write_isolation",
    [/private\.assert_learning_read_committed\(\)/, /return old/, /return new/],
    "Every governed learning table needs a reusable READ COMMITTED mutation guard.",
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
    "learning.guard_assignment_lifecycle",
    [
      /tg_op = 'delete'/,
      /old\.status in \('completed', 'expired', 'superseded', 'cancelled'\)/,
      /terminal assignment evidence is immutable/,
      /raise exception/,
    ],
    "Assignment lifecycle guard must make terminal evidence monotonic.",
  );
  requireFunction(
    state,
    "learning.guard_assignment_requirement_lifecycle",
    [
      /tg_op = 'delete'/,
      /old\.status in \('passed', 'waived', 'expired'\)/,
      /terminal assignment requirement evidence is immutable/,
      /raise exception/,
    ],
    "Assignment-requirement lifecycle guard must make terminal evidence monotonic.",
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
      /new\.revoked_at := pg_catalog\.clock_timestamp\(\)/,
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
      /private\.validate_curriculum_graph_publication/,
      /finalized learning content is immutable/,
      /raise exception/,
    ],
    "Content lifecycle guard is missing or inert.",
  );
  requireFunction(
    state,
    "learning.guard_curriculum_composition",
    [
      /private\.lock_learning_curriculum_graph/,
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
      /requirement_version\.audience = 'vendor'/,
      /not requirement_version\.waivable/,
      /parent_requirement\.governance_owner = 'legal'/,
      /parent_requirement\.requirement_kind = 'policy'/,
      /raise exception/,
    ],
    "Assignment-requirement waiver guard must reject vendor, non-waivable, and Legal policy requirements.",
  );
  requireFunction(
    state,
    "private.lock_learning_curriculum_graph",
    [/order by curriculum_version\.id/, /for update/],
    "Curriculum graph locks must be acquired in stable parent UUID order.",
  );
  requireFunction(
    state,
    "private.validate_curriculum_graph_publication",
    [
      /private\.lock_learning_curriculum_graph/,
      /learning\.requirement_versions/,
      /requirement_version\.status <> 'published'/,
      /requirement_version\.effective_at > target_effective_at/,
      /with recursive prerequisite_walk/,
      /raise exception/,
    ],
    "Curriculum publication must lock and validate the complete published effective graph.",
  );

  const publication =
    state.functions.get("private.validate_curriculum_graph_publication")
      ?.reachableBody ?? "";
  if (
    /curriculum_requirement\.mandatory[\s\S]*?learning\.curriculum_capability_outcomes/.test(
      publication,
    ) ||
    /mandatory curriculum requirements need a capability outcome/.test(
      publication,
    )
  ) {
    state.errors.push(
      "Curriculum publication must permit mandatory orientation, prerequisite, and evidence nodes without direct outcomes.",
    );
  }
  requireFunction(
    state,
    "private.validate_certification_issuance",
    [
      /core\.user_roles/,
      /for key share of role_assignment/,
      /private\.lock_learning_curriculum_graph/,
      /profile\.status <> 'active'/,
      /core\.role_capabilities/,
      /learning\.role_curricula/,
      /learning\.curriculum_versions/,
      /curriculum_version\.status = 'published'/,
      /candidate\.curriculum_version_id = new\.curriculum_version_id/,
      /learning\.curriculum_requirements/,
      /learning\.curriculum_capability_outcomes/,
      /learning\.curriculum_requirement_prerequisites/,
      /outcome\.module = new\.module/,
      /outcome\.capability = new\.capability/,
      /requirement_version\.status = 'published'/,
      /requirement_version\.effective_at <= new\.effective_at/,
      /prerequisite\.prerequisite_requirement_version_id = any\(new\.requirement_version_ids\)/,
      /learning\.assignment_requirements/,
      /raise exception/,
    ],
    "Certification issuance validator must serialize and prove active role, declared capability outcome, published curriculum, audience, and requirement lineage.",
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
      /new\.status <> 'active'/,
      /new\.revoked_at is not null/,
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

  const issuance =
    state.functions.get("private.validate_certification_issuance")
      ?.reachableBody ?? "";
  const roleLock = issuance.indexOf("for key share of role_assignment");
  const graphLock = issuance.indexOf("private.lock_learning_curriculum_graph");
  if (roleLock < 0 || graphLock <= roleLock) {
    state.errors.push(
      "Certification issuance must lock live role authority before curriculum graph rows.",
    );
  }

  for (const name of MODELED_FUNCTIONS) {
    if (!state.functions.has(name)) {
      state.errors.push(`Missing modeled learning function ${name}.`);
    }
  }

  for (const name of ISOLATION_GUARDED_FUNCTIONS) {
    const body = state.functions.get(name)?.reachableBody ?? "";
    if (!/private\.assert_learning_read_committed\(\)/.test(body)) {
      state.errors.push(
        `Authoritative mutation function ${name} must invoke the READ COMMITTED guard.`,
      );
    }
  }

  for (const [name, functionEntry] of state.functions) {
    const canonicalFunctionSql = normalizeSql(
      functionEntry.statement,
    ).replaceAll('"', "");
    if (
      /\bexecute\b|\b(?:alter|create|drop|grant|revoke)\s+(?:table|policy|view|materialized view|role|user|function|procedure|trigger)\b|\bset\s+(?:local\s+|session\s+)?role\b|\bset_config\s*\(\s*'(?:role|row_security|session_replication_role)'/.test(
        functionEntry.reachableBody,
      )
    ) {
      state.errors.push(
        `Modeled function ${name} contains unmodeled dynamic DDL or privilege control.`,
      );
    }
    if (
      functionEntry.securityDefiner &&
      (/\blearning\./.test(canonicalFunctionSql) ||
        /\bsearch_path\s*(?:=|to)\s*'?learning\b/.test(canonicalFunctionSql)) &&
      !ALLOWED_SECURITY_DEFINERS.has(name)
    ) {
      state.errors.push(
        `Unknown SECURITY DEFINER function ${name} touches learning data.`,
      );
    }
    if (
      functionEntry.securityDefiner &&
      !/\bset search_path = ''/.test(canonicalFunctionSql)
    ) {
      state.errors.push(
        `SECURITY DEFINER function ${name} must pin an empty search_path.`,
      );
    }

    const expectedRoles = new Set(ALLOWED_FUNCTION_EXECUTE[name] ?? []);
    const actualRoles = functionEntry.executeRoles;
    const unexpected = [...actualRoles].filter(
      (role) => !expectedRoles.has(role),
    );
    const missing = [...expectedRoles].filter((role) => !actualRoles.has(role));
    if (unexpected.length > 0 || missing.length > 0) {
      state.errors.push(
        `Unsafe EXECUTE privilege on function ${name}: expected [${[...expectedRoles].sort().join(", ")}], found [${[...actualRoles].sort().join(", ")}].`,
      );
    }
  }
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
        `Required trigger ${name} is disabled or non-origin in effective migration state.`,
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
