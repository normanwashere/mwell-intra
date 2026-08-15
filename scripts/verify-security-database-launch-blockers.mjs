import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(path.resolve("apps/shell/package.json"));
const { createClient } = require("@supabase/supabase-js");

const RAW_BOUNDARY_QUERY = `
with raw_boundaries as (
  select distinct
    procedure.oid,
    namespace.nspname || '.' || procedure.proname || '('
      || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')' as signature
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  cross join lateral pg_catalog.regexp_matches(
    pg_catalog.pg_get_functiondef(procedure.oid),
    'core[.]has_cap[[:space:]]*[(][[:space:]]*''([^'']+)''[[:space:]]*,[[:space:]]*''([^'']+)''[[:space:]]*[)]',
    'gi'
  ) as raw_pair
  join learning.mutation_capability_rules rule
    on rule.module = raw_pair[1]
   and rule.capability = raw_pair[2]
  where procedure.prokind = 'f'
    and procedure.prosecdef
    and namespace.nspname not in ('pg_catalog', 'information_schema')
    and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
)
select
  count(*)::integer as raw_boundaries,
  coalesce(
    pg_catalog.jsonb_agg(signature order by signature),
    '[]'::jsonb
  ) as examples
from raw_boundaries;
`;

const CRITICAL_OBJECT_QUERY = `
with checks(label, present) as (
  values
    (
      'core.v_my_work exact 12-column contract',
      (
        select pg_catalog.array_agg(column_name::text order by ordinal_position)
        from information_schema.columns
        where table_schema = 'core' and table_name = 'v_my_work'
      ) = array[
        'id', 'principal_id', 'source', 'title', 'description', 'status',
        'priority', 'due_at', 'href', 'required_module',
        'required_capability', 'source_record_exists'
      ]::text[]
    ),
    (
      'core.has_live_cap(text,text)',
      pg_catalog.to_regprocedure('core.has_live_cap(text,text)') is not null
    ),
    (
      'core.user_roles.effective_at',
      exists (
        select 1 from information_schema.columns
        where table_schema = 'core'
          and table_name = 'user_roles'
          and column_name = 'effective_at'
          and is_nullable = 'NO'
      )
    ),
    (
      'core.user_roles.expires_at',
      exists (
        select 1 from information_schema.columns
        where table_schema = 'core'
          and table_name = 'user_roles'
          and column_name = 'expires_at'
      )
    ),
    (
      'core.prevent_last_platform_admin_expiry()',
      pg_catalog.to_regprocedure('core.prevent_last_platform_admin_expiry()') is not null
    ),
    (
      'core_user_roles_last_admin_guard trigger',
      exists (
        select 1
        from pg_catalog.pg_trigger trigger_definition
        where trigger_definition.tgrelid = 'core.user_roles'::regclass
          and trigger_definition.tgname = 'core_user_roles_last_admin_guard'
          and not trigger_definition.tgisinternal
      )
    ),
    (
      'core_profiles_last_admin_guard trigger',
      exists (
        select 1
        from pg_catalog.pg_trigger trigger_definition
        where trigger_definition.tgrelid = 'core.profiles'::regclass
          and trigger_definition.tgname = 'core_profiles_last_admin_guard'
          and not trigger_definition.tgisinternal
      )
    ),
    (
      'learning_one_completed_assignment_idx',
      pg_catalog.to_regclass('learning.learning_one_completed_assignment_idx') is not null
    ),
    (
      'learning_assessment_answer_keys_created_by_fkey_idx',
      pg_catalog.to_regclass(
        'private.learning_assessment_answer_keys_created_by_fkey_idx'
      ) is not null
    ),
    (
      'learning_assessment_answer_keys_updated_by_fkey_idx',
      pg_catalog.to_regclass(
        'private.learning_assessment_answer_keys_updated_by_fkey_idx'
      ) is not null
    )
)
select coalesce(
  pg_catalog.array_agg(label order by label) filter (where not present),
  array[]::text[]
) as missing_objects
from checks;
`;

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return value === "{}" ? [] : [value];
    }
  }
  return [value];
}

export async function verifySecurityDatabaseLaunchBlockers(query) {
  const boundaryResult = await query(RAW_BOUNDARY_QUERY);
  const boundary = boundaryResult.rows?.[0] ?? {};
  const rawBoundaries = Number(boundary.raw_boundaries ?? 0);
  const examples = normalizeArray(boundary.examples);

  if (!Number.isInteger(rawBoundaries) || rawBoundaries < 0) {
    throw new Error("Invalid raw-boundary verification response");
  }
  if (rawBoundaries !== 0) {
    const detail = examples.length > 0 ? `: ${examples.join(", ")}` : "";
    throw new Error(
      `${rawBoundaries} authenticated raw-cap certification-controlled RPC boundary/boundaries remain${detail}`,
    );
  }

  const objectResult = await query(CRITICAL_OBJECT_QUERY);
  const missingObjects = normalizeArray(
    objectResult.rows?.[0]?.missing_objects,
  );
  if (missingObjects.length > 0) {
    throw new Error(
      `Critical launch objects are missing: ${missingObjects.join(", ")}`,
    );
  }

  return { rawBoundaries, missingObjects };
}

export function resolveVerifierConfig(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() || env.SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const projectRef = env.SUPABASE_PROJECT_REF?.trim();
  if (!url || !serviceRoleKey || !projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error(
      "Provide the UAT Supabase URL, project ref, and vaulted service-role credential",
    );
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== `${projectRef}.supabase.co`) {
    throw new Error("Supabase URL and project ref do not identify the same guarded project");
  }
  return { url: parsed.origin, serviceRoleKey };
}

async function runCli() {
  const { url, serviceRoleKey } = resolveVerifierConfig();
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client
    .schema("core")
    .rpc("verify_security_database_launch_blockers");
  if (error) {
    throw new Error(`UAT launch verifier RPC failed: ${error.message}`);
  }
  const rawBoundaries = Number(data?.raw_boundaries ?? -1);
  const examples = normalizeArray(data?.examples);
  const missingObjects = normalizeArray(data?.missing_objects);
  if (rawBoundaries !== 0) {
    const detail = examples.length > 0 ? `: ${examples.join(", ")}` : "";
    throw new Error(
      `${rawBoundaries} authenticated raw-cap certification-controlled RPC boundary/boundaries remain${detail}`,
    );
  }
  if (missingObjects.length > 0) {
    throw new Error(
      `Critical launch objects are missing: ${missingObjects.join(", ")}`,
    );
  }
  process.stdout.write(
    `Security/database launch-blocker verification passed: ${JSON.stringify({ rawBoundaries, missingObjects })}\n`,
  );
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runCli().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
