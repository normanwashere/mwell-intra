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
  {
    name: "procurement.save_policy_profile",
    parameterType: "jsonb",
    requiredBody: [
      "private.policy_profile_validate_profile(v_profile, false)",
      "last_modified_by = v_actor",
      "revision = revision + 1",
    ],
    placeholderFailure: "placeholder save_policy_profile body",
  },
  {
    name: "procurement.activate_policy_profile",
    parameterType: "jsonb",
    requiredBody: [
      "private.policy_profile_validate_profile(v_profile, true)",
      "last_modified_by is not distinct from v_actor",
      "for update",
    ],
    placeholderFailure: "placeholder activate_policy_profile body",
  },
  {
    name: "procurement.resolve_policy_conflict",
    parameterType: "jsonb",
    requiredBody: [
      "last_modified_by is not distinct from v_actor",
      "for update",
    ],
    placeholderFailure: "placeholder resolve_policy_conflict body",
  },
  {
    name: "procurement.get_effective_policy_profile",
    parameterType: "timestamptz",
    requiredBody: ["relationship = 'mwell_operating'", "status = 'active'"],
    placeholderFailure: "placeholder get_effective_policy_profile body",
  },
  {
    name: "private.policy_confirm_route_decision",
    parameterType: "jsonb",
    requiredBody: [
      "private.policy_route_confirmation_input",
      "private.policy_derive_procurement_route",
      "client-provided solicitation, tier, profile, and reasons are intentionally ignored",
    ],
    placeholderFailure: "placeholder confirm_route_decision body",
  },
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

  for (const {
    name,
    parameterType,
    requiredBody,
    placeholderFailure,
  } of requiredFunctions) {
    const definition = functionDefinition(text, name, parameterType);
    if (!definition) {
      failures.push(`missing ${name}(${parameterType})`);
    } else if (
      !definition.includes("security definer") ||
      !definition.includes("set search_path = ''")
    ) {
      failures.push("unsafe policy RPC search_path");
    } else if (requiredBody.some((token) => !definition.includes(token))) {
      failures.push(placeholderFailure);
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
  const governedWritePolicies = [
    "create policy policy_profiles_governed_insert",
    "create policy policy_profiles_governed_update",
    "create policy policy_profile_events_governed_insert",
    "create policy policy_conflicts_governed_update",
  ];
  for (const writePolicy of governedWritePolicies) {
    const start = text.indexOf(writePolicy);
    const statement =
      start === -1 ? "" : text.slice(start, text.indexOf(";", start) + 1);
    if (!statement) {
      failures.push("missing governed write RLS policy");
      break;
    }
    if (
      !statement.includes("private.policy_profile_can_manage()") ||
      /(?:using|with check)\s*\(\s*true\s*\)/.test(statement)
    ) {
      failures.push("permissive governed write RLS policy");
      break;
    }
  }
  if (
    /grant\s+(?:all|insert|update|delete)[^;]*\bon\s+(?:procurement\.(?:policy_profiles|policy_profile_events|policy_conflicts|solicitation_communications|policy_sla_events)|legal\.vendor_probation_reviews)[^;]*\bto\s+[^;]*\bservice_role\b/.test(
      text,
    )
  ) {
    failures.push("broad service_role policy-table grant");
  }
  if (
    !text.includes("revoke all on procurement.policy_profiles,") ||
    !text.includes("from service_role")
  ) {
    failures.push("missing service_role policy-table mutation revocation");
  }
  if (
    !text.includes("last_modified_by uuid not null") ||
    !text.includes("revision integer not null default 1") ||
    !text.includes("profile_actor_id uuid not null") ||
    !text.includes("profile_revision integer not null")
  ) {
    failures.push("missing latest-modifier maker-checker control");
  }
  if (
    !text.includes("formal_bid_amount is not null and formal_bid_amount > 0") ||
    !text.includes("source_profile_id is not null")
  ) {
    failures.push("missing relationship-aware operating-profile constraint");
  }
  if (
    !text.includes("control_sources ?& array[") ||
    !text.includes("jsonb_object_length(p_profile.control_sources) <> 16")
  ) {
    failures.push("missing complete control_sources constraint");
  }
  if (!text.includes("sealed_bid_minimum_responses <= invite_target_max")) {
    failures.push("missing sealed-bid invitation ceiling");
  }
  if (
    !text.includes("private.policy_profile_validate_profile") ||
    !text.includes("private.policy_profile_source_lineage_is_valid") ||
    !text.includes("private.policy_profile_control_sources_are_complete") ||
    !text.includes("mpic procurement policy february2025.docx") ||
    !text.includes(
      "mwell procurement policy and procedures - revised modern visual updated.docx",
    ) ||
    !text.includes("v_parent.status = 'active'")
  ) {
    failures.push("missing policy lineage and control-source validation");
  }
  if (!text.includes("unresolved conflicts block activation")) {
    failures.push("missing unresolved-conflict activation gate");
  }
  if (!text.includes("last_modified_by is not distinct from v_actor")) {
    failures.push("missing latest-modifier maker-checker control");
  }
  const activationDefinition = functionDefinition(
    text,
    "procurement.activate_policy_profile",
    "jsonb",
  );
  if (
    !activationDefinition?.includes(
      "last_modified_by is not distinct from v_actor",
    )
  ) {
    failures.push("missing latest-modifier maker-checker control");
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
  const deriveStart = text.indexOf(
    "create or replace function private.policy_derive_procurement_route(",
  );
  const deriveDefinition = deriveStart === -1
    ? ""
    : text.slice(deriveStart, text.indexOf("$$;", deriveStart) + 3);
  if (!deriveDefinition || [
    "request_id text",
    "requested_mode text default null",
    "for update",
    "effective_policy_profile_required",
    "requirement_kind_required",
    "private.policy_route_exception_is_eligible",
    "solicitation_type",
    "procurement_mode",
    "governance_tier",
  ].some((token) => !deriveDefinition.includes(token))) {
    failures.push("placeholder policy_derive_procurement_route body");
  }
  if (!text.includes("legacy_mapping_requires_review")) {
    failures.push("missing legacy route remediation marker");
  }
  const confirmationStart = text.indexOf(
    "create or replace function private.policy_route_confirmation_input(",
  );
  const confirmationDefinition = confirmationStart === -1
    ? ""
    : text.slice(confirmationStart, text.indexOf("$$;", confirmationStart) + 3);
  if (!confirmationDefinition || !confirmationDefinition.includes(
    "v_expected_version is null or v_expected_version <> p_current_version",
  )) {
    failures.push("missing governed route version guard");
  }
  for (const token of [
    "create or replace function private.policy_normalized_risk_facts",
    "create or replace function private.policy_normalized_risk_reasons",
    "create or replace function private.policy_legacy_route_mapping",
    "risk:complex",
    "risk:technical",
    "risk:strategic",
    "risk:high_risk",
    "risk:data_sensitive",
    "risk:importation",
    "p_method = 'small_purchase'",
    "private.policy_route_confirmation_input",
    "private.policy_route_exception_contract",
  ]) {
    if (!text.includes(token)) failures.push("missing governed route backfill contract");
  }
  if (!text.includes("insert into core.policy_remediation_queue(module, entity_type, entity_id, policy_version, reason_code, details)")) {
    failures.push("missing legacy route remediation queue insert");
  }
  if (!text.includes("create or replace function procurement.submit_request(payload jsonb)") ||
      !text.includes("as $$ select private.policy_submit_procurement_request(payload) $$")) {
    failures.push("missing governed procurement submission delegation");
  }
  for (const token of [
    "record_solicitation_communication",
    "invite_sourcing_vendors",
    "acknowledge_sourcing_invitation",
    "source_additional_and_requote",
    "cumulative extension cannot exceed",
    "alter column original_submission_deadline set not null",
    "current_invitation_communication_id",
    "invitation_acknowledgement",
    "acknowledgedcommunicationid",
    "revoke insert, update, delete on procurement.sourcing_events",
    "bid_window_working_days",
    "max_extension_working_days",
    "failed_bid_reason",
    "notificationgroupid",
    "vendor_acknowledgement_hours",
    "clarification_hours",
    "the exception author cannot approve their own request",
  ]) {
    if (!text.includes(token)) failures.push(`missing governed sourcing control ${token}`);
  }
  const sourcingTransition = functionDefinition(text, "procurement.transition_sourcing_event", "jsonb");
  if (!sourcingTransition?.includes("for update") || !sourcingTransition.includes("approved evaluation exception")) {
    failures.push("missing governed sourcing transition enforcement");
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
