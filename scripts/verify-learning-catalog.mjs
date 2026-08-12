import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ALLOWED_FUNCTION_EXECUTE,
  ALLOWED_SECURITY_DEFINERS,
  EXPECTED_POLICIES,
  MODELED_FUNCTIONS,
  REQUIRED_TABLES,
  REQUIRED_TRIGGERS,
  SERVICE_PRIVILEGES,
} from "./verify-learning-schema.mjs";

const LOCAL_DATABASE_PORT = "54322";

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
  return rows;
}

export function expectedLearningCatalogSnapshot() {
  return normalizeSnapshot({
    functions: FUNCTION_SPECS,
    privilegedFunctions: FUNCTION_SPECS.filter((spec) =>
      ALLOWED_SECURITY_DEFINERS.has(
        spec.function.slice(0, spec.function.indexOf("(")),
      ),
    ).map((spec) => spec.function),
    privilegedViews: [],
    tables: REQUIRED_TABLES.map((table) => ({
      table: `learning.${table}`,
      rls: true,
      forceRls: true,
    })),
    policies: [...EXPECTED_POLICIES].map(([name, table]) => ({
      name,
      table: `learning.${table}`,
      permissive: true,
      command: name.endsWith("_manage") ? "ALL" : "SELECT",
      roles: ["authenticated"],
      qualPresent: true,
      withCheckPresent: name.endsWith("_manage"),
    })),
    triggers: Object.entries(REQUIRED_TRIGGERS).map(([name, spec]) =>
      triggerSpec(name, spec),
    ),
    functionPrivileges: expectedFunctionPrivileges(),
    tablePrivileges: expectedTablePrivileges(),
    roles: [
      {
        name: "anon",
        superuser: false,
        bypassRls: false,
        replication: false,
      },
      {
        name: "authenticated",
        superuser: false,
        bypassRls: false,
        replication: false,
      },
      {
        name: "service_role",
        superuser: false,
        bypassRls: true,
        replication: false,
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
    tables: sorted(snapshot.tables ?? [], (row) => row.table),
    policies: sorted(snapshot.policies ?? [], (row) => row.name).map((row) => ({
      ...row,
      roles: [...(row.roles ?? [])].sort(),
    })),
    triggers: sorted(snapshot.triggers ?? [], (row) => row.name).map((row) => ({
      ...row,
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

export function verifyLearningCatalogSnapshot(input) {
  const expected = expectedLearningCatalogSnapshot();
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
    tables,
    policies,
    triggers,
    functionPrivileges,
    tablePrivileges,
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
      select n.nspname || '.' || c.relname as "table",
             c.relrowsecurity as rls,
             c.relforcerowsecurity as "forceRls"
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'learning' and c.relkind in ('r', 'p')
      order by 1
    `),
    client.query(`
      select policyname as name,
             schemaname || '.' || tablename as "table",
             permissive = 'PERMISSIVE' as permissive,
             cmd as command,
             roles,
             qual is not null and btrim(qual) not in ('', 'true', '(true)') as "qualPresent",
             with_check is not null and btrim(with_check) not in ('', 'true', '(true)') as "withCheckPresent"
      from pg_catalog.pg_policies
      where schemaname = 'learning'
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
        coalesce(constraint_row.condeferrable, false) as deferrable,
        coalesce(constraint_row.condeferred, false) as "initiallyDeferred"
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class table_class on table_class.oid = t.tgrelid
      join pg_catalog.pg_namespace table_ns on table_ns.oid = table_class.relnamespace
      join pg_catalog.pg_proc function_proc on function_proc.oid = t.tgfoid
      join pg_catalog.pg_namespace function_ns on function_ns.oid = function_proc.pronamespace
      left join pg_catalog.pg_constraint constraint_row on constraint_row.oid = t.tgconstraint
      where not t.tgisinternal
        and (table_ns.nspname = 'learning' or (table_ns.nspname = 'core' and t.tgname like 'learning_%'))
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
        )
        and privilege.grantee <> c.relowner
      order by 1, 2, 3
    `),
    client.query(`
      select rolname as name,
             rolsuper as superuser,
             rolbypassrls as "bypassRls",
             rolreplication as replication
      from pg_catalog.pg_roles
      where rolname in ('anon', 'authenticated', 'service_role')
      order by rolname
    `),
    client.query(`
      with recursive memberships(member_oid, target_oid) as (
        select member, roleid from pg_catalog.pg_auth_members
        union
        select memberships.member_oid, inherited.roleid
        from memberships
        join pg_catalog.pg_auth_members inherited
          on inherited.member = memberships.target_oid
      )
      select member.rolname as member, target.rolname as target
      from memberships
      join pg_catalog.pg_roles member on member.oid = memberships.member_oid
      join pg_catalog.pg_roles target on target.oid = memberships.target_oid
      where member.rolname in ('anon', 'authenticated')
        and (
          target.rolname = 'service_role'
          or target.rolsuper
          or target.rolbypassrls
          or target.rolreplication
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
    tables: tables.rows,
    policies: policies.rows,
    triggers: triggers.rows,
    functionPrivileges: functionPrivileges.rows,
    tablePrivileges: tablePrivileges.rows,
    roles: roles.rows,
    dangerousMemberships: dangerousMemberships.rows,
    certificationIndexes: certificationIndexes.rows,
  });
}

async function run() {
  const connectionString = assertDisposableLocalDatabaseUrl(
    process.env.MWELL_LOCAL_DATABASE_URL ?? "",
  );
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const snapshot = await loadLearningCatalogSnapshot(client);
    const errors = verifyLearningCatalogSnapshot(snapshot);
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
