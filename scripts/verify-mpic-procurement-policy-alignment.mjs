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
  "procurement.purchase_order_lifecycle_state",
  "procurement.purchase_order_lifecycle_events",
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
    name: "procurement.acknowledge_purchase_order",
    parameterType: "jsonb",
    requiredBody: ["private.policy_po_lifecycle_transition", "vendor_acknowledged"],
    placeholderFailure: "placeholder acknowledge_purchase_order body",
  },
  {
    name: "procurement.record_vendor_delivery_notice",
    parameterType: "jsonb",
    requiredBody: ["private.policy_po_lifecycle_transition", "delivery_notice"],
    placeholderFailure: "placeholder record_vendor_delivery_notice body",
  },
  {
    name: "procurement.request_purchase_order_closure",
    parameterType: "jsonb",
    requiredBody: ["for update", "expected_revision", "closure_reason", "replayed"],
    placeholderFailure: "placeholder request_purchase_order_closure body",
  },
  {
    name: "procurement.approve_purchase_order_closure",
    parameterType: "jsonb",
    requiredBody: ["maker and checker", "private.policy_po_lifecycle_transition", "for update"],
    placeholderFailure: "placeholder approve_purchase_order_closure body",
  },
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
  const definitions = [...text.matchAll(new RegExp(expression.source, 'g'))];
  const finalGovernedDefinition = functionName.includes('purchase_order')
    || functionName.includes('po_lifecycle')
    || functionName.includes('payment')
    || functionName.includes('vendor')
    || functionName.includes('invite_sourcing');
  return definitions.at(finalGovernedDefinition ? -1 : 0)?.[0] ?? null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPrivateTask8ExecutionRevocation(text, signature) {
  return new RegExp(
    `revoke\\s+(?:all|execute)\\s+on\\s+function\\s+[^;]*${escapeRegExp(signature)}[^;]*from\\s+public,\\s*anon,\\s*authenticated`,
    "i",
  ).test(text);
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

  if (!text.includes("'policycontrolsources'")) {
    failures.push('sourcing workspace does not expose request-bound control provenance');
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
      !statement.includes("core.has_live_cap('core', 'manage_rbac')") ||
      !statement.includes("core.has_live_cap('legal', 'manage_doa')") ||
      statement.includes("private.policy_profile_can_manage()") ||
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
    !text.includes("source_document_status text not null default 'draft_for_review'") ||
    !text.includes("status <> 'active' or source_document_status = 'approved'") ||
    !text.includes("v_profile.source_document_status <> 'approved'")
  ) {
    failures.push("missing draft-source activation gate");
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
      "mwell procurement policy and procedures - revised modern visual - word updated.docx",
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
  for (const signature of [
    "private.policy_exception_active_profile()",
    "private.policy_exception_request_fingerprint(procurement.requests,text,uuid,integer)",
    "private.policy_exception_evidence_fingerprint(jsonb)",
    "private.policy_exception_repeat_snapshot(procurement.requests,jsonb,procurement.policy_profiles)",
    "private.policy_exception_submission_snapshot(procurement.requests,text,jsonb,procurement.policy_profiles)",
    "private.policy_exception_pack_blockers(text,text,procurement.policy_profiles,numeric)",
    "private.policy_exception_pack_binding_blockers(procurement.exception_packs,procurement.requests,procurement.policy_profiles)",
  ]) {
    if (!hasPrivateTask8ExecutionRevocation(text, signature)) {
      failures.push(`missing private Task 8 execution revocation ${signature}`);
    }
  }
  const bindingDefinition = "create or replace function private.policy_exception_pack_binding_blockers(";
  const bindingRevocation = "revoke execute on function private.policy_exception_pack_binding_blockers(procurement.exception_packs,procurement.requests,procurement.policy_profiles) from public, anon, authenticated;";
  const bindingDefinitionIndex = text.lastIndexOf(bindingDefinition);
  const bindingRevocationIndex = text.indexOf(bindingRevocation);
  const nextPrivateFunctionIndex = text.indexOf(
    "create or replace function private.policy_exception_pack_blockers(",
    bindingDefinitionIndex,
  );
  if (
    bindingDefinitionIndex === -1 ||
    bindingRevocationIndex < bindingDefinitionIndex ||
    (nextPrivateFunctionIndex !== -1 && bindingRevocationIndex > nextPrivateFunctionIndex)
  ) {
    failures.push("private binding helper revocation must immediately follow its final definition");
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
    "v_request.estimated_amount >= v_profile.formal_bid_amount",
    "not coalesce((v_risk->>'comparable')::boolean, true)",
    "coalesce((v_risk->>'complex')::boolean, false)",
    "coalesce((v_risk->>'technical')::boolean, false)",
    "coalesce((v_risk->>'strategic')::boolean, false)",
    "coalesce((v_risk->>'highrisk')::boolean, false)",
    "coalesce((v_risk->>'datasensitive')::boolean, false)",
    "solicitation_type",
    "procurement_mode",
    "governance_tier",
  ].some((token) => !deriveDefinition.includes(token))) {
    failures.push("placeholder policy_derive_procurement_route body");
  }
  if (!text.includes("legacy_mapping_requires_review")) {
    failures.push("missing legacy route remediation marker");
  }
  if (/coalesce\(\(v_risk->>'importation'\)::boolean, false\)[^;]{0,200}then\s*'rfp'/.test(deriveDefinition)) {
    failures.push("importation alone must not force RFP");
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
    "max_extension_calendar_days",
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

  for (const token of [
    "create table if not exists procurement.commercial_tabulations",
    "create table if not exists procurement.technical_evaluations",
    "create table if not exists procurement.award_recommendations",
    "create table if not exists procurement.award_recommendation_variance_decisions",
    "create or replace function private.policy_add_manila_working_days",
    "asia/manila",
    "procurement.policy_holidays",
    "technicalcompliance",
    "totallifecyclecost",
    "paymentterms",
    "written variance justification is required",
    "the recommendation author cannot approve their own variance",
    "finance approval must be independent from the department head decision",
    "a submitted technical evaluation is required for every usable response",
    "policy_variance_review_eligibility",
    "policy_can_view_variance_request",
    "varianceeligibility",
    "submittedbyname",
    "reviewername",
    "doaassignmentid",
    "current approved best-value recommendation with complete technical evidence",
    "new.status in ('response_closed', 'failed_bid')",
    "an approved best-value recommendation is required before award",
    "revoke all on procurement.policy_holidays, procurement.commercial_tabulations",
  ]) {
    if (!text.includes(token)) failures.push(`missing best-value governance control ${token}`);
  }
  for (const [name, required] of [
    ["procurement.save_commercial_tabulation", "policy_evaluation_event"],
    ["procurement.submit_technical_evaluation", "policy_add_manila_working_days"],
    ["procurement.submit_award_recommendation", "risk_evidence_reference"],
    ["procurement.review_recommendation_variance", "expected_version"],
  ]) {
    const definition = functionDefinition(text, name, "jsonb");
    if (!definition?.includes(required) || !definition.includes("security definer") || !definition.includes("set search_path = ''")) {
      failures.push(`missing hardened best-value RPC ${name}`);
    }
  }

  for (const table of [
    'legal.vendor_eligibility_decisions',
    'legal.vendor_sample_custody_events',
  ]) {
    if (!text.includes(`create table if not exists ${table}`)) {
      failures.push(`missing Task 10 table ${table}`);
    }
    if (!text.includes(`alter table ${table} force row level security`)) {
      failures.push(`missing forced RLS for Task 10 table ${table}`);
    }
  }
  for (const token of [
    "status in ('approved', 'probation', 'provisional', 'expired', 'suspended', 'rejected', 'temporary_clearance')",
    "decision in ('pass', 'extend', 'revoke', 'suspend')",
    'po_win_rate',
    'delivery_commitment_rate',
    'return_or_rejection_count',
    'document_timeliness_rate',
    'sample purpose, custodian, evaluation, disposition, and an mwell-requested po link are required',
    'private.policy_vendor_eligibility_projection',
    'private.policy_assert_request_vendor_eligible',
    'client-provided payment readiness is intentionally ignored',
    'foreign-vendor tax, withholding, and payment-control evidence is required',
  ]) {
    if (!text.includes(token)) failures.push(`missing Task 10 control ${token}`);
  }
  for (const [name, required] of [
    ['legal.record_vendor_eligibility_decision', 'expected_revision'],
    ['legal.record_vendor_sample_custody', 'expected_revision'],
    ['legal.vendor_eligibility_projection', 'legal/vmo'],
    ['procurement.invite_sourcing_vendors', 'private.policy_assert_request_vendor_eligible'],
    ['procurement.issue_purchase_order', 'private.policy_assert_request_vendor_eligible'],
    ['procurement.prepare_invoice_payment_readiness', 'private.policy_prepare_invoice_payment_readiness'],
  ]) {
    const definition = functionDefinition(text, name, 'jsonb');
    if (!definition?.includes(required) || !definition.includes('security definer') || !definition.includes("set search_path = ''")) {
      failures.push(`missing hardened Task 10 RPC ${name}`);
    }
  }
  for (const signature of [
    'private.policy_vendor_eligibility_projection(uuid,text,timestamptz)',
    'private.policy_assert_request_vendor_eligible(uuid,text,text)',
    'private.policy_payment_evidence_blockers(procurement.purchase_orders,procurement.requests,jsonb)',
    'private.policy_prepare_invoice_payment_readiness(jsonb)',
  ]) {
    if (!hasPrivateTask8ExecutionRevocation(text, signature)) {
      failures.push(`missing private Task 10 execution revocation ${signature}`);
    }
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
  console.log("Canonical Mwell procurement policy alignment migration contract verified.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
