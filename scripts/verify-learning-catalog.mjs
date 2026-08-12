import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ALLOWED_FUNCTION_EXECUTE,
  ALLOWED_SECURITY_DEFINERS,
  extractExpectedLearningPolicies,
  MODELED_FUNCTIONS,
  PRIVATE_ANSWER_KEY_TABLE,
  readRepositoryMigrations,
  REQUIRED_TABLES,
  REQUIRED_TRIGGERS,
  SERVICE_PRIVILEGES,
} from "./verify-learning-schema.mjs";

const LOCAL_DATABASE_PORT = "54322";
const EXPECTED_POLICY_SPECS = Object.freeze(
  extractExpectedLearningPolicies(readRepositoryMigrations()),
);

const FUNCTION_SPECS = Object.freeze([
  fn(
    "private.learning_has_active_profile",
    "text",
    "boolean",
    "sql",
    "s",
    true,
  ),
  fn("private.learning_owns_department", "uuid", "boolean", "sql", "s", true),
  fn(
    "private.learning_is_active_employee_platform_admin",
    "",
    "boolean",
    "sql",
    "s",
    true,
  ),
  fn(
    "private.assert_learning_read_committed",
    "",
    "void",
    "plpgsql",
    "s",
    true,
  ),
  fn(
    "private.lock_learning_curriculum_graph",
    "uuid[]",
    "void",
    "plpgsql",
    "v",
    true,
  ),
  fn(
    "private.validate_curriculum_graph_publication",
    "uuid, text, timestamp with time zone",
    "void",
    "plpgsql",
    "v",
    true,
  ),
  fn(
    "private.validate_assignment_requirement_waiver",
    "",
    "trigger",
    "plpgsql",
    "v",
    true,
  ),
  fn(
    "private.validate_certification_issuance",
    "",
    "trigger",
    "plpgsql",
    "v",
    true,
  ),
  fn(
    "private.lock_certification_role_authority",
    "",
    "trigger",
    "plpgsql",
    "v",
    true,
  ),
  fn(
    "private.revoke_certifications_for_role_assignment",
    "",
    "trigger",
    "plpgsql",
    "v",
    true,
  ),
  fn(
    "private.revoke_certifications_for_role_assignment_v2",
    "",
    "trigger",
    "plpgsql",
    "v",
    true,
  ),
  fn(
    "private.revoke_certifications_for_role_authority_loss",
    "",
    "trigger",
    "plpgsql",
    "v",
    true,
  ),
  fn(
    "private.guard_role_assignment_identity",
    "",
    "trigger",
    "plpgsql",
    "v",
    false,
  ),
  fn(
    "private.validate_emergency_exception_issuance",
    "",
    "trigger",
    "plpgsql",
    "v",
    true,
  ),
  fn(
    "learning.guard_authoritative_write_isolation",
    "",
    "trigger",
    "plpgsql",
    "v",
    false,
  ),
  fn("learning.reject_evidence_mutation", "", "trigger", "plpgsql", "v", false),
  fn("learning.guard_attempt_lifecycle", "", "trigger", "plpgsql", "v", false),
  fn(
    "learning.guard_assignment_lifecycle",
    "",
    "trigger",
    "plpgsql",
    "v",
    false,
  ),
  fn(
    "learning.guard_assignment_requirement_lifecycle",
    "",
    "trigger",
    "plpgsql",
    "v",
    false,
  ),
  fn(
    "learning.guard_certification_lifecycle",
    "",
    "trigger",
    "plpgsql",
    "v",
    false,
  ),
  fn(
    "learning.guard_certification_lifecycle_v2",
    "",
    "trigger",
    "plpgsql",
    "v",
    false,
  ),
  fn(
    "learning.guard_emergency_exception_lifecycle",
    "",
    "trigger",
    "plpgsql",
    "v",
    false,
  ),
  fn("learning.guard_content_lifecycle", "", "trigger", "plpgsql", "v", false),
  fn(
    "learning.guard_curriculum_composition",
    "",
    "trigger",
    "plpgsql",
    "v",
    false,
  ),
  fn("learning.my_learning_snapshot", "", "jsonb", "plpgsql", "s", true),
  fn("learning.resolve_assignments", "", "jsonb", "plpgsql", "v", true),
  fn("learning.start_requirement", "jsonb", "jsonb", "plpgsql", "v", true),
  fn(
    "learning.record_simulation_checkpoint",
    "jsonb",
    "jsonb",
    "plpgsql",
    "v",
    true,
  ),
  fn("learning.submit_assessment", "jsonb", "jsonb", "plpgsql", "v", true),
  fn("learning.acknowledge_policy", "jsonb", "jsonb", "plpgsql", "v", true),
  fn("learning.evaluate_certifications", "", "jsonb", "plpgsql", "v", true),
  fn("learning.request_support", "jsonb", "jsonb", "plpgsql", "v", true),
  fn("learning.sync_shared_completions", "", "jsonb", "plpgsql", "v", true),
]);

const CERTIFICATION_INDEXES = Object.freeze([
  index("certifications_pkey", ["id"], { primary: true, unique: true }),
  index(
    "learning_one_active_certification_idx",
    [
      "user_id",
      "department_id",
      "module",
      "capability",
      "source_role_assignment_id",
    ],
    { predicate: "status = 'active'", unique: true },
  ),
  index("learning_certifications_user_fk_idx", ["user_id"]),
  index("learning_certifications_department_fk_idx", ["department_id"]),
  index("learning_certifications_assignment_fk_idx", [
    "assignment_id",
    "user_id",
    "department_id",
    "audience",
    "curriculum_version_id",
  ]),
  index("learning_certifications_capability_fk_idx", ["module", "capability"]),
  index("learning_certifications_curriculum_fk_idx", [
    "curriculum_version_id",
    "audience",
  ]),
  index("learning_certifications_source_role_assignment_idx", [
    "source_role_assignment_id",
  ]),
  index("learning_certifications_user_status_idx", [
    "user_id",
    "status",
    "expires_at",
  ]),
  index(
    "learning_active_certifications_role_authority_idx",
    ["module", "source_role", "capability"],
    { predicate: "status = 'active'" },
  ),
]);

function fn(
  name,
  identityArguments,
  result,
  language,
  volatility,
  securityDefiner,
) {
  return {
    function: `${name}(${identityArguments})`,
    owner: "postgres",
    identityArguments,
    result,
    language,
    volatility,
    securityDefiner,
    kind: "f",
    returnsSet: false,
    strict: false,
    leakproof: false,
    parallel: "u",
    cost: 100,
    rows: 0,
    support: "-",
    config: ['search_path=""'],
    defaultCount: 0,
    argumentDefaults: "",
    variadic: "-",
    transformTypes: [],
    sqlBody: false,
    binary: "",
  };
}

function index(name, keys, options = {}) {
  return {
    name,
    keys,
    include: [],
    predicate: options.predicate ?? null,
    unique: options.unique ?? false,
    primary: options.primary ?? false,
    valid: true,
    ready: true,
  };
}

function triggerSpec(name, spec) {
  const events = ["insert", "update", "delete", "truncate"]
    .filter((event) => new RegExp(`\\b${event}\\b`).test(spec.events))
    .map((event) => event.toUpperCase())
    .sort();
  const updateColumns =
    spec.events
      .match(/update of ([a-z_, ]+)/)?.[1]
      ?.split(",")
      .map((column) => column.trim())
      .sort() ?? [];
  return {
    name,
    table: spec.table,
    function: spec.function,
    timing: spec.events.startsWith("after") ? "AFTER" : "BEFORE",
    events,
    updateColumns,
    row: true,
    enabled: "O",
    constraint: spec.constraint ?? false,
    deferrable: spec.constraint ?? false,
    initiallyDeferred: spec.deferred ?? false,
    predicate: null,
    arguments: [],
    argumentCount: 0,
    oldTransitionTable: null,
    newTransitionTable: null,
    referencedTable: null,
    parentTrigger: null,
    constraintIndex: null,
    internal: false,
  };
}

function expectedFunctionPrivileges() {
  const signatureByName = new Map(
    FUNCTION_SPECS.map((spec) => [
      spec.function.slice(0, spec.function.indexOf("(")),
      spec.function,
    ]),
  );
  return Object.entries(ALLOWED_FUNCTION_EXECUTE).flatMap(
    ([functionName, grantees]) =>
      grantees.map((grantee) => ({
        function: signatureByName.get(functionName),
        grantee,
        privilege: "EXECUTE",
        grantable: false,
      })),
  );
}

function expectedTablePrivileges() {
  const rows = [];
  for (const table of REQUIRED_TABLES) {
    rows.push({
      table: `learning.${table}`,
      grantee: "authenticated",
      privilege: "SELECT",
      grantable: false,
    });
    for (const privilege of SERVICE_PRIVILEGES[table]) {
      rows.push({
        table: `learning.${table}`,
        grantee: "service_role",
        privilege: privilege.toUpperCase(),
        grantable: false,
      });
    }
  }
  for (const table of ["roles", "role_capabilities", "user_roles"]) {
    for (const privilege of [
      "DELETE",
      "INSERT",
      "MAINTAIN",
      "REFERENCES",
      "SELECT",
      "TRIGGER",
      "UPDATE",
    ]) {
      rows.push({
        table: `core.${table}`,
        grantee: "service_role",
        privilege,
        grantable: false,
      });
    }
  }
  rows.push({
    table: "core.user_roles",
    grantee: "authenticated",
    privilege: "SELECT",
    grantable: false,
  });
  for (const privilege of ["DELETE", "INSERT", "SELECT", "UPDATE"]) {
    rows.push({
      table: PRIVATE_ANSWER_KEY_TABLE,
      grantee: "service_role",
      privilege,
      grantable: false,
    });
  }
  return rows;
}

function expectedSchemaPrivileges() {
  return ["core", "learning", "private"].flatMap((schema) =>
    ["authenticated", "service_role"].map((grantee) => ({
      schema,
      grantee,
      privilege: "USAGE",
      grantable: false,
    })),
  );
}

function expectedDefaultPrivileges() {
  return [
    "SELECT",
    "DELETE",
    "INSERT",
    "MAINTAIN",
    "REFERENCES",
    "SELECT",
    "TRIGGER",
    "TRUNCATE",
    "UPDATE",
  ].map((privilege, index) => ({
    owner: "postgres",
    schema: "core",
    objectType: "TABLE",
    grantee: index === 0 ? "authenticated" : "service_role",
    privilege,
    grantable: false,
  }));
}

export function expectedLearningCatalogSnapshot({
  policies = EXPECTED_POLICY_SPECS,
} = {}) {
  return normalizeSnapshot({
    functions: FUNCTION_SPECS,
    privilegedFunctions: FUNCTION_SPECS.filter((spec) =>
      ALLOWED_SECURITY_DEFINERS.has(
        spec.function.slice(0, spec.function.indexOf("(")),
      ),
    ).map((spec) => spec.function),
    privilegedViews: [],
    schemas: ["core", "learning", "private"].map((schema) => ({
      schema,
      owner: "postgres",
    })),
    schemaPrivileges: expectedSchemaPrivileges(),
    tables: [
      ...REQUIRED_TABLES.map((table) => ({
        table: `learning.${table}`,
        rls: true,
        forceRls: true,
      })),
      {
        table: PRIVATE_ANSWER_KEY_TABLE,
        rls: true,
        forceRls: true,
      },
    ],
    policies,
    triggers: Object.entries(REQUIRED_TRIGGERS).map(([name, spec]) =>
      triggerSpec(name, spec),
    ),
    functionPrivileges: expectedFunctionPrivileges(),
    tablePrivileges: expectedTablePrivileges(),
    governedTableOwners: [
      ...REQUIRED_TABLES.map((table) => `learning.${table}`),
      "core.roles",
      "core.role_capabilities",
      "core.user_roles",
      PRIVATE_ANSWER_KEY_TABLE,
    ].map((table) => ({ table, owner: "postgres" })),
    defaultPrivileges: expectedDefaultPrivileges(),
    roles: [
      {
        name: "anon",
        superuser: false,
        inherit: false,
        createRole: false,
        createDb: false,
        canLogin: false,
        bypassRls: false,
        replication: false,
        connectionLimit: -1,
      },
      {
        name: "authenticated",
        superuser: false,
        inherit: false,
        createRole: false,
        createDb: false,
        canLogin: false,
        bypassRls: false,
        replication: false,
        connectionLimit: -1,
      },
      {
        name: "service_role",
        superuser: false,
        inherit: false,
        createRole: false,
        createDb: false,
        canLogin: false,
        bypassRls: true,
        replication: false,
        connectionLimit: -1,
      },
    ],
    dangerousMemberships: [],
    certificationIndexes: CERTIFICATION_INDEXES,
  });
}

function normalizePredicate(predicate) {
  if (predicate == null) return null;
  let value = predicate
    .replace(/::(?:text|character varying)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  while (value.startsWith("(") && value.endsWith(")")) {
    value = value.slice(1, -1).trim();
  }
  return value.replace(/\s*=\s*/g, " = ");
}

function normalizePolicyExpression(expression) {
  if (expression == null) return null;
  return expression.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

function sorted(values, key) {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

function normalizeSnapshot(snapshot) {
  return {
    functions: sorted(snapshot.functions ?? [], (row) => row.function).map(
      (row) => ({
        ...row,
        cost: Number(row.cost),
        rows: Number(row.rows),
        defaultCount: Number(row.defaultCount),
        config: [...(row.config ?? [])].sort(),
        transformTypes: [...(row.transformTypes ?? [])].sort(),
      }),
    ),
    privilegedFunctions: [...(snapshot.privilegedFunctions ?? [])].sort(),
    privilegedViews: [...(snapshot.privilegedViews ?? [])].sort(),
    schemas: sorted(snapshot.schemas ?? [], (row) => row.schema),
    schemaPrivileges: sorted(
      snapshot.schemaPrivileges ?? [],
      (row) => `${row.schema}:${row.grantee}:${row.privilege}`,
    ),
    tables: sorted(snapshot.tables ?? [], (row) => row.table),
    policies: sorted(snapshot.policies ?? [], (row) => row.name).map((row) => ({
      ...row,
      roles: [...(row.roles ?? [])].sort(),
      qual: normalizePolicyExpression(row.qual),
      withCheck: normalizePolicyExpression(row.withCheck),
    })),
    triggers: sorted(snapshot.triggers ?? [], (row) => row.name).map((row) => ({
      ...row,
      argumentCount: Number(row.argumentCount),
      events: [...(row.events ?? [])].sort(),
      updateColumns: [...(row.updateColumns ?? [])].sort(),
    })),
    functionPrivileges: sorted(
      snapshot.functionPrivileges ?? [],
      (row) => `${row.function}:${row.grantee}:${row.privilege}`,
    ),
    tablePrivileges: sorted(
      snapshot.tablePrivileges ?? [],
      (row) => `${row.table}:${row.grantee}:${row.privilege}`,
    ),
    governedTableOwners: sorted(
      snapshot.governedTableOwners ?? [],
      (row) => row.table,
    ),
    defaultPrivileges: sorted(
      snapshot.defaultPrivileges ?? [],
      (row) =>
        `${row.owner}:${row.schema}:${row.objectType}:${row.grantee}:${row.privilege}`,
    ),
    roles: sorted(snapshot.roles ?? [], (row) => row.name),
    dangerousMemberships: sorted(
      snapshot.dangerousMemberships ?? [],
      (row) => `${row.member}:${row.target}`,
    ),
    certificationIndexes: sorted(
      snapshot.certificationIndexes ?? [],
      (row) => row.name,
    ).map((row) => ({
      ...row,
      keys: [...(row.keys ?? [])],
      include: [...(row.include ?? [])],
      predicate: normalizePredicate(row.predicate),
    })),
  };
}

function compareSection(errors, label, expected, actual) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(
      `${label} drift: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

export function verifyLearningCatalogSnapshot(
  input,
  expectedInput = expectedLearningCatalogSnapshot(),
) {
  const expected = normalizeSnapshot(expectedInput);
  const actual = normalizeSnapshot(input);
  const errors = [];
  compareSection(
    errors,
    "Learning function metadata",
    expected.functions,
    actual.functions,
  );
  compareSection(
    errors,
    "Learning privileged function inventory",
    expected.privilegedFunctions,
    actual.privilegedFunctions,
  );
  compareSection(
    errors,
    "Learning privileged view inventory",
    expected.privilegedViews,
    actual.privilegedViews,
  );
  compareSection(
    errors,
    "Governed schema ownership",
    expected.schemas,
    actual.schemas,
  );
  compareSection(
    errors,
    "Governed schema privilege catalog",
    expected.schemaPrivileges,
    actual.schemaPrivileges,
  );
  compareSection(errors, "Learning table RLS", expected.tables, actual.tables);
  compareSection(
    errors,
    "Learning policy catalog",
    expected.policies,
    actual.policies,
  );
  compareSection(
    errors,
    "Learning trigger catalog",
    expected.triggers,
    actual.triggers,
  );
  compareSection(
    errors,
    "Learning function privilege catalog",
    expected.functionPrivileges,
    actual.functionPrivileges,
  );
  compareSection(
    errors,
    "Learning table privilege catalog",
    expected.tablePrivileges,
    actual.tablePrivileges,
  );
  compareSection(
    errors,
    "Governed table owner catalog",
    expected.governedTableOwners,
    actual.governedTableOwners,
  );
  compareSection(
    errors,
    "Governed default privilege catalog",
    expected.defaultPrivileges,
    actual.defaultPrivileges,
  );
  compareSection(
    errors,
    "Application role attributes",
    expected.roles,
    actual.roles,
  );
  compareSection(
    errors,
    "Dangerous application role membership",
    expected.dangerousMemberships,
    actual.dangerousMemberships,
  );
  compareSection(
    errors,
    "Exact certification index catalog",
    expected.certificationIndexes,
    actual.certificationIndexes,
  );
  return errors;
}

export function assertDisposableLocalDatabaseUrl(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Expected a disposable local Supabase database URL.");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !loopbackHosts.has(url.hostname) ||
    url.port !== LOCAL_DATABASE_PORT ||
    url.pathname !== "/postgres" ||
    url.username !== "postgres"
  ) {
    throw new Error(
      "Refusing to run outside the disposable local Supabase database on port 54322.",
    );
  }
  return connectionString;
}

const FUNCTION_NAMES = FUNCTION_SPECS.map((spec) =>
  spec.function.slice(0, spec.function.indexOf("(")),
);

export async function loadLearningCatalogSnapshot(client) {
  const [
    functions,
    privilegedFunctions,
    privilegedViews,
    schemas,
    schemaPrivileges,
    tables,
    policies,
    triggers,
    functionPrivileges,
    tablePrivileges,
    governedTableOwners,
    defaultPrivileges,
    roles,
    dangerousMemberships,
    certificationIndexes,
  ] = await Promise.all([
    client.query(
      `
        select
          n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' as "function",
          owner.rolname as owner,
          pg_catalog.oidvectortypes(p.proargtypes) as "identityArguments",
          pg_catalog.format_type(p.prorettype, null) as result,
          language.lanname as language,
          p.provolatile as volatility,
          p.prosecdef as "securityDefiner",
          p.prokind as kind,
          p.proretset as "returnsSet",
          p.proisstrict as strict,
          p.proleakproof as leakproof,
          p.proparallel as parallel,
          p.procost as cost,
          p.prorows as rows,
          p.prosupport::regproc::text as support,
          coalesce(p.proconfig, '{}'::text[]) as config,
          p.pronargdefaults as "defaultCount",
          coalesce(pg_catalog.pg_get_expr(p.proargdefaults, 0), '') as "argumentDefaults",
          case when p.provariadic = 0 then '-' else p.provariadic::regtype::text end as variadic,
          coalesce(
            (select array_agg(pg_catalog.format_type(type_oid, null) order by type_oid)
             from unnest(p.protrftypes) as type_oid),
            '{}'::text[]
          ) as "transformTypes",
          p.prosqlbody is not null as "sqlBody",
          coalesce(p.probin, '') as binary
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        join pg_catalog.pg_roles owner on owner.oid = p.proowner
        join pg_catalog.pg_language language on language.oid = p.prolang
        where n.nspname || '.' || p.proname = any($1::text[])
        order by 1
      `,
      [FUNCTION_NAMES],
    ),
    client.query(`
      select n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' as "function"
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef
        and (
          n.nspname = 'learning'
          or (n.nspname = 'private' and (p.proname like '%learning%' or p.prosrc ~* 'learning\\.'))
        )
      order by 1
    `),
    client.query(`
      select n.nspname || '.' || c.relname as view
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('v', 'm')
        and not ('security_invoker=true' = any(coalesce(c.reloptions, '{}'::text[])))
        and (
          n.nspname = 'learning'
          or pg_catalog.pg_get_viewdef(c.oid, true) ~* 'learning\\.'
        )
      order by 1
    `),
    client.query(`
      select namespace.nspname as schema,
             owner.rolname as owner
      from pg_catalog.pg_namespace namespace
      join pg_catalog.pg_roles owner on owner.oid = namespace.nspowner
      where namespace.nspname in ('core', 'private', 'learning')
      order by namespace.nspname
    `),
    client.query(`
      select namespace.nspname as schema,
             coalesce(grantee.rolname, 'PUBLIC') as grantee,
             privilege.privilege_type as privilege,
             privilege.is_grantable as grantable
      from pg_catalog.pg_namespace namespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
      ) privilege
      left join pg_catalog.pg_roles grantee on grantee.oid = privilege.grantee
      where namespace.nspname in ('core', 'private', 'learning')
        and privilege.grantee <> namespace.nspowner
      order by 1, 2, 3
    `),
    client.query(`
      select n.nspname || '.' || c.relname as "table",
             c.relrowsecurity as rls,
             c.relforcerowsecurity as "forceRls"
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and (
          n.nspname = 'learning'
          or (
            n.nspname = 'private'
            and c.relname = 'learning_assessment_answer_keys'
          )
        )
      order by 1
    `),
    client.query(`
      select policyname as name,
             schemaname || '.' || tablename as "table",
             permissive = 'PERMISSIVE' as permissive,
             cmd as command,
             roles,
             qual,
             with_check as "withCheck"
      from pg_catalog.pg_policies
      where schemaname = 'learning'
        or (
          schemaname = 'private'
          and tablename = 'learning_assessment_answer_keys'
        )
      order by policyname
    `),
    client.query(`
      select
        t.tgname as name,
        table_ns.nspname || '.' || table_class.relname as "table",
        function_ns.nspname || '.' || function_proc.proname as "function",
        case when (t.tgtype & 2) <> 0 then 'BEFORE'
             when (t.tgtype & 64) <> 0 then 'INSTEAD OF'
             else 'AFTER' end as timing,
        array_remove(array[
          case when (t.tgtype & 4) <> 0 then 'INSERT' end,
          case when (t.tgtype & 16) <> 0 then 'UPDATE' end,
          case when (t.tgtype & 8) <> 0 then 'DELETE' end,
          case when (t.tgtype & 32) <> 0 then 'TRUNCATE' end
        ], null) as events,
        coalesce((
          select array_agg(attribute.attname order by attribute.attname)
          from unnest(t.tgattr::smallint[]) as trigger_attribute(attnum)
          join pg_catalog.pg_attribute attribute
            on attribute.attrelid = t.tgrelid
           and attribute.attnum = trigger_attribute.attnum
        ), '{}'::text[]) as "updateColumns",
        (t.tgtype & 1) <> 0 as "row",
        t.tgenabled as enabled,
        t.tgconstraint <> 0 as "constraint",
        t.tgdeferrable as deferrable,
        t.tginitdeferred as "initiallyDeferred",
        pg_catalog.pg_get_expr(t.tgqual, t.tgrelid, false) as predicate,
        t.tgnargs as "argumentCount",
        encode(t.tgargs, 'hex') as "argumentsHex",
        t.tgoldtable as "oldTransitionTable",
        t.tgnewtable as "newTransitionTable",
        case when t.tgconstrrelid = 0 then null
             else referenced_ns.nspname || '.' || referenced_class.relname end as "referencedTable",
        parent_trigger.tgname as "parentTrigger",
        constraint_index.relname as "constraintIndex",
        t.tgisinternal as internal
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class table_class on table_class.oid = t.tgrelid
      join pg_catalog.pg_namespace table_ns on table_ns.oid = table_class.relnamespace
      join pg_catalog.pg_proc function_proc on function_proc.oid = t.tgfoid
      join pg_catalog.pg_namespace function_ns on function_ns.oid = function_proc.pronamespace
      left join pg_catalog.pg_class referenced_class on referenced_class.oid = t.tgconstrrelid
      left join pg_catalog.pg_namespace referenced_ns on referenced_ns.oid = referenced_class.relnamespace
      left join pg_catalog.pg_trigger parent_trigger on parent_trigger.oid = t.tgparentid
      left join pg_catalog.pg_class constraint_index on constraint_index.oid = t.tgconstrindid
      where not t.tgisinternal
        and (
          table_ns.nspname = 'learning'
          or (table_ns.nspname = 'core' and t.tgname like 'learning_%')
          or (
            table_ns.nspname = 'private'
            and table_class.relname = 'learning_assessment_answer_keys'
          )
        )
      order by t.tgname
    `),
    client.query(
      `
        select
          n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' as "function",
          coalesce(grantee.rolname, 'PUBLIC') as grantee,
          privilege.privilege_type as privilege,
          privilege.is_grantable as grantable
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        cross join lateral pg_catalog.aclexplode(
          coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) privilege
        left join pg_catalog.pg_roles grantee on grantee.oid = privilege.grantee
        where n.nspname || '.' || p.proname = any($1::text[])
          and privilege.grantee <> p.proowner
        order by 1, 2, 3
      `,
      [FUNCTION_NAMES],
    ),
    client.query(`
      select
        n.nspname || '.' || c.relname as "table",
        coalesce(grantee.rolname, 'PUBLIC') as grantee,
        privilege.privilege_type as privilege,
        privilege.is_grantable as grantable
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) privilege
      left join pg_catalog.pg_roles grantee on grantee.oid = privilege.grantee
      where c.relkind in ('r', 'p')
        and (
          n.nspname = 'learning'
          or (n.nspname = 'core' and c.relname in ('roles', 'role_capabilities', 'user_roles'))
          or (
            n.nspname = 'private'
            and c.relname = 'learning_assessment_answer_keys'
          )
        )
        and privilege.grantee <> c.relowner
      order by 1, 2, 3
    `),
    client.query(`
      select namespace.nspname || '.' || relation.relname as "table",
             owner.rolname as owner
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_roles owner on owner.oid = relation.relowner
      where relation.relkind in ('r', 'p')
        and (
          namespace.nspname = 'learning'
          or (
            namespace.nspname = 'core'
            and relation.relname in ('roles', 'role_capabilities', 'user_roles')
          )
          or (
            namespace.nspname = 'private'
            and relation.relname = 'learning_assessment_answer_keys'
          )
        )
      order by 1
    `),
    client.query(`
      select owner.rolname as owner,
             case when defaults.defaclnamespace = 0 then '<global>'
                  else namespace.nspname end as schema,
             case defaults.defaclobjtype
               when 'r' then 'TABLE'
               when 'S' then 'SEQUENCE'
               when 'f' then 'FUNCTION'
               when 'T' then 'TYPE'
               when 'n' then 'SCHEMA'
               else defaults.defaclobjtype::text
             end as "objectType",
             coalesce(grantee.rolname, 'PUBLIC') as grantee,
             privilege.privilege_type as privilege,
             privilege.is_grantable as grantable
      from pg_catalog.pg_default_acl defaults
      join pg_catalog.pg_roles owner on owner.oid = defaults.defaclrole
      left join pg_catalog.pg_namespace namespace on namespace.oid = defaults.defaclnamespace
      cross join lateral pg_catalog.aclexplode(defaults.defaclacl) privilege
      left join pg_catalog.pg_roles grantee on grantee.oid = privilege.grantee
      where (
          (defaults.defaclnamespace = 0 and owner.rolname = 'postgres')
          or namespace.nspname in ('core', 'private', 'learning')
        )
        and privilege.grantee <> defaults.defaclrole
      order by 1, 2, 3, 4, 5
    `),
    client.query(`
      select rolname as name,
             rolsuper as superuser,
             rolinherit as inherit,
             rolcreaterole as "createRole",
             rolcreatedb as "createDb",
             rolcanlogin as "canLogin",
             rolbypassrls as "bypassRls",
             rolreplication as replication,
             rolconnlimit as "connectionLimit"
      from pg_catalog.pg_roles
      where rolname in ('anon', 'authenticated', 'service_role')
      order by rolname
    `),
    client.query(`
      with recursive memberships(
        member_oid,
        target_oid,
        depth,
        oid_path,
        role_path,
        admin_options,
        inherit_options,
        set_options,
        grantors
      ) as (
        select membership.member,
               membership.roleid,
               1,
               array[membership.member, membership.roleid],
               array[member.rolname, target.rolname],
               array[membership.admin_option],
               array[membership.inherit_option],
               array[membership.set_option],
               array[grantor.rolname]
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles member on member.oid = membership.member
        join pg_catalog.pg_roles target on target.oid = membership.roleid
        join pg_catalog.pg_roles grantor on grantor.oid = membership.grantor
        where member.rolname in ('anon', 'authenticated', 'service_role')
        union
        select memberships.member_oid,
               inherited.roleid,
               memberships.depth + 1,
               memberships.oid_path || inherited.roleid,
               memberships.role_path || target.rolname,
               memberships.admin_options || inherited.admin_option,
               memberships.inherit_options || inherited.inherit_option,
               memberships.set_options || inherited.set_option,
               memberships.grantors || grantor.rolname
        from memberships
        join pg_catalog.pg_auth_members inherited
          on inherited.member = memberships.target_oid
        join pg_catalog.pg_roles target on target.oid = inherited.roleid
        join pg_catalog.pg_roles grantor on grantor.oid = inherited.grantor
        where not inherited.roleid = any(memberships.oid_path)
      )
      select member.rolname as member,
             target.rolname as target,
             memberships.depth,
             memberships.role_path as path,
             memberships.admin_options as "adminOptions",
             memberships.inherit_options as "inheritOptions",
             memberships.set_options as "setOptions",
             memberships.grantors,
             target.rolsuper as "targetSuperuser",
             target.rolbypassrls as "targetBypassRls",
             target.rolreplication as "targetReplication",
             target.rolcreaterole as "targetCreateRole",
             target.rolcreatedb as "targetCreateDb"
      from memberships
      join pg_catalog.pg_roles member on member.oid = memberships.member_oid
      join pg_catalog.pg_roles target on target.oid = memberships.target_oid
      where (
          target.rolname = 'service_role'
          or target.rolsuper
          or target.rolbypassrls
          or target.rolreplication
          or target.rolcreaterole
          or target.rolcreatedb
        )
      order by 1, 2
    `),
    client.query(`
      select
        index_class.relname as name,
        coalesce((
          select array_agg(pg_catalog.pg_get_indexdef(index_row.indexrelid, ordinal, true) order by ordinal)
          from generate_series(1, index_row.indnkeyatts) ordinal
        ), '{}'::text[]) as keys,
        coalesce((
          select array_agg(pg_catalog.pg_get_indexdef(index_row.indexrelid, ordinal, true) order by ordinal)
          from generate_series(index_row.indnkeyatts + 1, index_row.indnatts) ordinal
        ), '{}'::text[]) as "include",
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid) as predicate,
        index_row.indisunique as "unique",
        index_row.indisprimary as "primary",
        index_row.indisvalid as valid,
        index_row.indisready as ready
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class table_class on table_class.oid = index_row.indrelid
      join pg_catalog.pg_namespace table_ns on table_ns.oid = table_class.relnamespace
      join pg_catalog.pg_class index_class on index_class.oid = index_row.indexrelid
      where table_ns.nspname = 'learning' and table_class.relname = 'certifications'
      order by index_class.relname
    `),
  ]);

  return normalizeSnapshot({
    functions: functions.rows,
    privilegedFunctions: privilegedFunctions.rows.map((row) => row.function),
    privilegedViews: privilegedViews.rows.map((row) => row.view),
    schemas: schemas.rows,
    schemaPrivileges: schemaPrivileges.rows,
    tables: tables.rows,
    policies: policies.rows,
    triggers: triggers.rows.map(({ argumentsHex, ...row }) => ({
      ...row,
      arguments:
        argumentsHex.length === 0
          ? []
          : Buffer.from(argumentsHex, "hex")
              .toString("utf8")
              .split("\0")
              .filter(Boolean),
    })),
    functionPrivileges: functionPrivileges.rows,
    tablePrivileges: tablePrivileges.rows,
    governedTableOwners: governedTableOwners.rows,
    defaultPrivileges: defaultPrivileges.rows,
    roles: roles.rows,
    dangerousMemberships: dangerousMemberships.rows,
    certificationIndexes: certificationIndexes.rows,
  });
}

function quotedIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(
      `Unsafe SQL identifier in learning policy contract: ${value}`,
    );
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export async function loadCanonicalExpectedPolicyCatalog(client) {
  const temporaryPolicies = EXPECTED_POLICY_SPECS.map((policy, index) => ({
    ...policy,
    temporaryName: `learning_verify_${String(index).padStart(2, "0")}`,
  }));
  await client.query("begin");
  try {
    for (const policy of temporaryPolicies) {
      const [schema, table] = policy.table.split(".");
      const roles = policy.roles.map(quotedIdentifier).join(", ");
      const usingClause = policy.qual ? ` using (${policy.qual})` : "";
      const checkClause = policy.withCheck
        ? ` with check (${policy.withCheck})`
        : "";
      await client.query(
        `create policy ${quotedIdentifier(policy.temporaryName)} on ${quotedIdentifier(schema)}.${quotedIdentifier(table)} as ${policy.permissive ? "permissive" : "restrictive"} for ${policy.command} to ${roles}${usingClause}${checkClause}`,
      );
    }
    const result = await client.query(
      `select policyname as name,
              schemaname || '.' || tablename as "table",
              permissive = 'PERMISSIVE' as permissive,
              cmd as command,
              roles,
              qual,
              with_check as "withCheck"
       from pg_catalog.pg_policies
       where schemaname = 'learning' and policyname = any($1::text[])
       order by policyname`,
      [temporaryPolicies.map((policy) => policy.temporaryName)],
    );
    const sourceNameByTemporaryName = new Map(
      temporaryPolicies.map((policy) => [policy.temporaryName, policy.name]),
    );
    return result.rows.map((policy) => ({
      ...policy,
      name: sourceNameByTemporaryName.get(policy.name),
    }));
  } finally {
    await client.query("rollback");
  }
}

async function run() {
  const connectionString = assertDisposableLocalDatabaseUrl(
    process.env.MWELL_LOCAL_DATABASE_URL ?? "",
  );
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const policies = await loadCanonicalExpectedPolicyCatalog(client);
    const expected = expectedLearningCatalogSnapshot({ policies });
    const snapshot = await loadLearningCatalogSnapshot(client);
    const errors = verifyLearningCatalogSnapshot(snapshot, expected);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    console.log(
      `Applied PostgreSQL learning catalog passed (${snapshot.functions.length} functions, ${snapshot.tables.length} governed tables).`,
    );
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await run();
}
