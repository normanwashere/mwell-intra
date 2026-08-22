import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql",
);

const requiredTables = [
  "procurement.policy_profiles",
  "procurement.policy_profile_events",
  "procurement.policy_conflicts",
  "procurement.solicitation_communications",
  "procurement.policy_sla_events",
  "legal.vendor_probation_reviews",
];

const requiredRequestColumns = [
  "requirement_kind",
  "solicitation_type",
  "procurement_mode",
  "governance_tier",
  "policy_profile_id",
  "route_reasons",
];

const requiredFunctions = [
  ["procurement.save_policy_profile", "jsonb"],
  ["procurement.activate_policy_profile", "jsonb"],
  ["procurement.resolve_policy_conflict", "jsonb"],
  ["procurement.get_effective_policy_profile", "timestamptz"],
];

const normalized = (sql) => sql.toLowerCase().replace(/\s+/g, " ").trim();

function functionDefinition(text, functionName, parameterType) {
  const signature = functionName.replace(".", "\\.");
  const expression = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+${signature}\\s*\\(\\s*(?:[a-z_]+\\s+)?${parameterType}\\s*\\)[\\s\\S]*?\\$\\$;`,
  );
  return text.match(expression)?.[0] ?? null;
}

export function verifyMigrationText(sql) {
  const text = normalized(sql);
  const failures = [];

  for (const table of requiredTables) {
    if (!text.includes(`create table if not exists ${table}`)) {
      failures.push(`missing ${table}`);
      continue;
    }
    if (!text.includes(`alter table ${table} force row level security`)) {
      failures.push("missing forced RLS");
    }
  }

  for (const column of requiredRequestColumns) {
    if (
      !text.includes(`add column if not exists ${column}`) &&
      !text.includes(`add column ${column}`)
    ) {
      failures.push(`missing ${column}`);
    }
  }

  for (const control of [
    "formal_bid_amount",
    "control_sources jsonb",
    "source_filename",
    "source_organization",
    "effective_from",
    "effective_to",
    "document_hash",
    "exclude using gist",
  ]) {
    if (!text.includes(control))
      failures.push(`missing profile control ${control}`);
  }

  for (const [functionName, parameterType] of requiredFunctions) {
    const definition = functionDefinition(text, functionName, parameterType);
    if (!definition) {
      failures.push(`missing ${functionName}(${parameterType})`);
    } else if (
      !definition.includes("security definer") ||
      !definition.includes("set search_path = ''")
    ) {
      failures.push("missing hardened policy RPC");
    }
  }

  if (!text.includes("set search_path = ''")) {
    failures.push("missing empty search_path");
  }
  if (
    !text.includes("core.has_live_cap('core', 'manage_rbac')") ||
    !text.includes("core.has_live_cap('legal', 'manage_doa')")
  ) {
    failures.push("missing existing policy-manager capability predicate");
  }
  if (!text.includes("for update")) {
    failures.push("missing governed activation locking");
  }
  for (const writePolicy of [
    "create policy policy_profiles_governed_insert",
    "create policy policy_profiles_governed_update",
    "create policy policy_profile_events_governed_insert",
    "create policy policy_conflicts_governed_update",
  ]) {
    if (!text.includes(writePolicy)) {
      failures.push("missing governed write RLS policy");
      break;
    }
  }
  if (!text.includes("unresolved conflicts block activation")) {
    failures.push("missing unresolved-conflict activation gate");
  }
  if (!text.includes("created_by is not distinct from v_actor")) {
    failures.push("missing maker-checker conflict resolution");
  }
  if (!text.includes("policy profile events are immutable")) {
    failures.push("missing immutable policy events");
  }
  if (
    !text.includes("revoke all on function") ||
    !text.includes("from public, anon, authenticated")
  ) {
    failures.push("missing function grant revocation");
  }
  if (
    !text.includes("grant execute on function") ||
    !text.includes("to authenticated, service_role")
  ) {
    failures.push("missing narrowed function grant");
  }
  if (/estimated_amount[^;]{0,500}then\s*'rfp'/.test(text)) {
    failures.push("amount-driven RFP route logic is forbidden");
  }

  return { failures };
}

function main() {
  if (!fs.existsSync(migrationPath)) {
    console.error(`Missing policy alignment migration: ${migrationPath}`);
    process.exitCode = 1;
    return;
  }

  const result = verifyMigrationText(fs.readFileSync(migrationPath, "utf8"));
  if (result.failures.length > 0) {
    console.error(result.failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("MPIC procurement policy alignment migration contract verified.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
