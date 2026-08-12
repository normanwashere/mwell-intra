import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, resolve } from "node:path";

export const FOUNDATION_MIGRATION_NAME =
  "20260812130000_learning_foundation.sql";
const ROLE_LIFECYCLE_MIGRATION_NAME =
  "20260812140000_learning_role_authority_lifecycle.sql";
const ASSIGNMENT_LINEAGE_MIGRATION_NAME =
  "20260812150000_learning_assignment_lineage_remediation.sql";
export const SERVICES_MIGRATION_NAME = "20260812160000_learning_services.sql";
export const SERVICE_CONTRACT_ALIGNMENT_MIGRATION_NAME =
  "20260812170000_learning_service_contract_alignment.sql";
export const COMPLETION_ALIGNMENT_MIGRATION_NAME =
  "20260812180000_learning_completion_alignment.sql";
export const COMPLETION_HARDENING_MIGRATION_NAME =
  "20260812190000_learning_completion_evidence_hardening.sql";
export const AUTHORITY_MIGRATION_NAME = "20260812200000_learning_authority.sql";
export const ORIENTATION_RUNTIME_MIGRATION_NAME =
  "20260812210000_learning_orientation_runtime.sql";
const PINNED_LEARNING_MIGRATION_SHA256 = Object.freeze({
  [FOUNDATION_MIGRATION_NAME]:
    "b5b954f0fdb9ff52748047ca4a17916896227934ecd43c22951ea4489fc129ad",
  [ROLE_LIFECYCLE_MIGRATION_NAME]:
    "8668f05d2dc557da3d086ec3bdf78d82e4016d3bdbb212898d0d811f5225e736",
  [ASSIGNMENT_LINEAGE_MIGRATION_NAME]:
    "c5047ff95b5a545624c8dad090e1ff9c13ed2a977034ffc146a162740d8175ef",
  [SERVICES_MIGRATION_NAME]:
    "7b4b704249d37683e8764b4cff5496c49ebb5e5a825b8653921c8346c6e2703f",
  [SERVICE_CONTRACT_ALIGNMENT_MIGRATION_NAME]:
    "a4001fd52c284eda4cbb04a813b6346d724d8416da6671a8ecd143037e2c1fbc",
  [COMPLETION_ALIGNMENT_MIGRATION_NAME]:
    "1e7daab3d83417e8d49325712eacbdff3114e29cbe0f8c5790985002ea465cc5",
  [COMPLETION_HARDENING_MIGRATION_NAME]:
    "9914f21c7fa21e452973ca75d08348b307edb0c0f72580fa46263112e8e0f0d5",
  [AUTHORITY_MIGRATION_NAME]:
    "a8ad714d8ae7a5f637ecb62af1cb9b4688a256041f42673e86d598ea36085f39",
  [ORIENTATION_RUNTIME_MIGRATION_NAME]:
    "4b1fb8f1989e8412658de7e986208b3fdc1299a24885b2112b807485dcbf0f41",
});
export const PRIVATE_ANSWER_KEY_TABLE =
  "private.learning_assessment_answer_keys";
export const LEARNING_SERVICE_FUNCTIONS = Object.freeze([
  "learning.my_learning_snapshot",
  "learning.resolve_assignments",
  "learning.start_requirement",
  "learning.record_simulation_checkpoint",
  "learning.submit_assessment",
  "learning.acknowledge_policy",
  "learning.evaluate_certifications",
  "learning.request_support",
  "learning.sync_shared_completions",
]);
export const LEARNING_AUTHORITY_FUNCTIONS = Object.freeze([
  "learning.is_certification_required",
  "learning.has_active_certification",
  "learning.has_active_emergency_exception",
  "core.has_live_cap",
  "core.my_role_capabilities",
  "core.my_capabilities",
  "core.my_capability_snapshot",
]);
const LEARNING_SERVICE_MUTATORS = Object.freeze(
  LEARNING_SERVICE_FUNCTIONS.filter(
    (name) => name !== "learning.my_learning_snapshot",
  ),
);
const PRIVATE_ANSWER_KEY_TABLE_SHA256 =
  "91f8b561ceb5a3ed93420ecbad2637ab63745ee681a1d44ae5c2df82ff69d36b";
const PRIVATE_ANSWER_KEY_CONSTRAINT_SHA256 =
  "550241953604633cc7ef427e5838cb293d3f0ba17de327e666fbc3265b300cde";
const PRIVATE_ANSWER_KEY_VALIDATION_SHA256 =
  "d0622d2f434b9b559f5efbf534aad9696a7d1790e361da949f9b2b5b048c22ef";
const ROLE_AUTHORITY_TABLES = Object.freeze([
  "roles",
  "role_capabilities",
  "user_roles",
]);
const UNSAFE_AUTHORITY_TRUNCATE_ROLES = Object.freeze([
  "public",
  "anon",
  "authenticated",
  "service_role",
]);
const ROLE_AUTHORITY_INDEX_NAME =
  "learning_active_certifications_role_authority_idx";
const ROLE_AUTHORITY_RECONCILIATION_SHA256 =
  "fd8e41af904fc15cc4b453220adf3cc98b8da21e15119b52c558c6654b464cfc";
const ASSIGNMENT_LINEAGE_RECONCILIATION_SHA256 =
  "3b8a7487ca7665544f20633c83b716679837d149b59b97ec56f0542b8165b988";

const PINNED_BASELINE_MIGRATION_NAMES = Object.freeze(
  `
20260706090000_core_schema_identity.sql
20260706090100_core_rbac.sql
20260706090200_core_vendors.sql
20260706090300_core_documents.sql
20260706090400_core_approvals.sql
20260706090500_core_activity_log.sql
20260706090600_core_notifications.sql
20260706090700_core_rls_policies.sql
20260706090800_core_rpcs.sql
20260706090900_core_expose_postgrest.sql
20260706091000_core_seed_rbac.sql
20260706092000_warehouse_schema.sql
20260706092100_warehouse_step2_deltas.sql
20260706092200_warehouse_rls.sql
20260706092300_warehouse_evidence_storage.sql
20260706092400_warehouse_rpcs.sql
20260706092500_warehouse_demo_auth_users.sql
20260706100000_reconcile_provisional_rbac.sql
20260706110000_procurement_schema.sql
20260706120000_legal_schema.sql
20260706130000_cross_module_wiring.sql
20260706140000_scheduled_jobs.sql
20260706150000_vendor_tier_reconcile.sql
20260706160000_rate_limits_and_uploads.sql
20260706170000_warehouse_rls_tighten.sql
20260706180000_finance_keys.sql
20260706190000_procurement_policy_alignment.sql
20260707090000_document_storage_buckets.sql
20260707100000_procurement_approval_rpcs.sql
20260707110000_warehouse_actor_identity.sql
20260707120000_retention_enforcement.sql
20260707130000_rbac_ladder_grants.sql
20260708140000_lockdown_legacy_public_procurement_requests.sql
20260708141000_grant_current_app_role_for_legacy_policies.sql
20260709152000_live_intra_cutover_contract.sql
20260709161000_live_intra_followup_action_rpcs.sql
20260709162500_lockdown_legacy_public_procurement_request_grants.sql
20260709173500_production_readiness_indexes_and_legacy_rbac_policy.sql
20260710040105_repair_procurement_submission_contract.sql
20260710041319_govern_procurement_attachments.sql
20260710041816_govern_vendor_invitation_delivery.sql
20260710043410_govern_warehouse_csv_exports.sql
20260710044627_harden_finance_read_model.sql
20260710093000_p0_p1_production_readiness_fixes.sql
20260710120000_harden_operational_anon_grants.sql
20260710150000_warehouse_w1_control_schema.sql
20260710160000_warehouse_w1_quality_and_approval_rpcs.sql
20260710170000_warehouse_w1_imports_po_and_reporting.sql
20260710180000_govern_cycle_count_draft_creation.sql
20260710210000_policy_aligned_legal_procurement.sql
20260711090000_department_doa_administration.sql
20260711100000_rls_advisor_hardening.sql
20260711110000_policy_rpc_search_paths.sql
20260711123000_temporary_department_doa_seed.sql
20260711150000_allow_admin_legal_doa_read.sql
20260713170000_current_function_advisor_hardening.sql
20260713190000_governed_rpc_wrapper_execution.sql
20260713191000_warehouse_policy_core_capabilities.sql
20260713192000_storage_evidence_core_capabilities.sql
20260714133000_intra_role_workspaces.sql
20260714134500_user_role_claim_sync.sql
20260714160000_command_log_explicit_client_deny.sql
20260714175057_core_organization_extensibility.sql
20260714175318_single_po_receipt_authority.sql
20260717143000_task3_receipt_authority_forward_convergence.sql
20260718003000_receipt_reconciliation_rls.sql
20260718004000_current_rls_and_fk_indexes.sql
20260718005000_expose_intra_postgrest_schemas.sql
20260718006000_historical_migration_forward_convergence.sql
20260718150000_fix_stock_approval_projection_uuid_join.sql
20260718160000_grant_approval_groups_to_service_role.sql
20260718170000_harden_service_verification_and_digest_resolution.sql
20260718180000_fix_receipt_quantity_and_service_finance_readback.sql
20260718190000_restore_governed_receive_stock.sql
20260718191000_restore_warehouse_actor_helpers.sql
20260718192000_restore_exception_pack_audit_timestamp.sql
20260718193000_harden_receive_stock_server_defaults.sql
20260718194000_restore_warehouse_evidence_registration.sql
20260718195000_align_evidence_document_entity_identity.sql
20260718196000_harden_cycle_count_server_defaults.sql
20260718197000_converge_warehouse_rbac_gates.sql
20260718198000_converge_stock_change_governance.sql
20260718199000_align_stock_approval_entity_identity.sql
20260718200000_serialize_quality_holds_with_reservations.sql
20260718201000_refresh_atp_inside_product_lock.sql
20260718202000_block_issue_from_held_stock_identity.sql
20260721200000_cross_department_wms_persistence.sql
20260721210000_cross_department_wms_advisor_remediation.sql
20260722114000_govern_admin_role_changes_and_seed_doa.sql
20260722120000_legal_vendor_lifecycle_hardening.sql
20260722120500_procurement_event_workflow_remediation.sql
20260722121000_warehouse_procurement_lineage_and_read_scope.sql
20260722121500_product_readiness_and_pricing_governance.sql
20260722124731_insights_correctness_and_provenance.sql
20260722150000_advisor_intent_and_private_function_hardening.sql
20260722151000_index_new_governance_foreign_keys.sql
20260722170000_restore_receipt_status_projection_access.sql
20260722173000_finish_governance_performance_hardening.sql
20260722174500_restore_governed_warehouse_wrapper_execution.sql
20260722180000_vendor_lifecycle_authority_remediation.sql
20260722183000_vendor_lifecycle_advisor_hardening.sql
20260722200000_warehouse_procurement_handoff_presentation.sql
20260723010000_insights_projection_read_only.sql
20260723020000_product_certification_cleanup.sql
20260723031500_insights_warehouse_source_route.sql
20260723040000_my_work_quality_route.sql
20260804150000_inventory_release_lifecycle_remediation.sql
20260804153000_inventory_release_lifecycle_index_hardening.sql
20260804154500_inventory_release_rls_performance.sql
20260804170000_procurement_to_payment_completion.sql
20260804171000_acceptance_value_derivation.sql
20260804172000_procurement_payment_fk_indexes.sql
20260804173000_insufficient_bid_exception_workflow.sql
20260804174000_procurement_cost_center_validation.sql
20260804175000_procurement_requester_po_visibility.sql
20260804180000_procurement_goods_receiving_boundary.sql
20260804200000_operational_flow_completion.sql
20260804201000_fix_replenishment_procurement_handoff.sql
20260804202000_index_operational_flow_foreign_keys.sql
20260804203000_knowledge_feedback.sql
20260806090000_receiving_boundary_replay_order.sql
20260806093000_user_scoped_warehouse_import_staging.sql
20260806094500_knowledge_feedback_rls_initplan.sql
20260806100000_vendor_readiness_array_append.sql
20260806101500_repair_commitment_readiness_ownership.sql
20260806103000_drop_reconciliation_recovery_snapshot.sql
20260810142147_restore_doa_assignment_audit_timestamp.sql
20260810155237_block_transfer_of_held_inventory.sql
20260810155350_procurement_legal_database_authority_remediation.sql
20260810160000_finance_event_authority_remediation.sql
20260812120000_vendor_accreditation_draft_rbac.sql
  `
    .trim()
    .split(/\s+/),
);
const PINNED_BASELINE_SHA256 =
  "e705fe63579325ae5167dc1c75fdef410e2102f17d237d65e31136bf880b5e85";

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
  "mutation_capability_rules",
]);

export const SERVICE_PRIVILEGES = Object.freeze({
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
  mutation_capability_rules: ["select"],
});

export const EXPECTED_POLICIES = new Map([
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

export const REQUIRED_TRIGGERS = Object.freeze({
  ...Object.fromEntries(
    REQUIRED_TABLES.map((table) => {
      const name =
        table === "curriculum_requirement_prerequisites"
          ? "learning_curr_req_prereq_read_committed_guard"
          : `learning_${table}_read_committed_guard`;
      return [
        name,
        {
          table: `learning.${table}`,
          events: "before insert or update or delete",
          function: "learning.guard_authoritative_write_isolation",
        },
      ];
    }),
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
  learning_certifications_lock_role_authority: {
    table: "learning.certifications",
    events: "before insert",
    function: "private.lock_certification_role_authority",
  },
  learning_certifications_completion_evidence: {
    table: "learning.certifications",
    events: "before insert",
    function: "private.validate_certification_completion_evidence",
  },
  learning_certifications_lifecycle_guard: {
    table: "learning.certifications",
    events: "before update or delete",
    function: "learning.guard_certification_lifecycle_v2",
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
    function: "private.revoke_certifications_for_role_assignment_v2",
  },
  learning_guard_role_assignment_identity: {
    table: "core.user_roles",
    events: "before update of id, user_id, module, role",
    function: "private.guard_role_assignment_identity",
  },
  learning_role_deactivation_revoke: {
    table: "core.roles",
    events: "after update of is_active",
    function: "private.revoke_certifications_for_role_authority_loss",
    constraint: true,
    deferred: true,
  },
  learning_role_capability_removal_revoke: {
    table: "core.role_capabilities",
    events: "after delete or update",
    function: "private.revoke_certifications_for_role_authority_loss",
    constraint: true,
    deferred: true,
  },
});

export const ALLOWED_SECURITY_DEFINERS = new Set([
  "private.learning_has_active_profile",
  "private.learning_owns_department",
  "private.learning_is_active_employee_platform_admin",
  "private.assert_learning_read_committed",
  "private.lock_learning_curriculum_graph",
  "private.validate_curriculum_graph_publication",
  "private.validate_assignment_requirement_waiver",
  "private.validate_certification_issuance",
  "private.lock_certification_role_authority",
  "private.revoke_certifications_for_role_assignment",
  "private.revoke_certifications_for_role_assignment_v2",
  "private.revoke_certifications_for_role_authority_loss",
  "private.validate_emergency_exception_issuance",
  "private.resolve_assignments_base",
  "private.start_requirement_base",
  "private.validate_certification_completion_evidence",
  ...LEARNING_SERVICE_FUNCTIONS,
  ...LEARNING_AUTHORITY_FUNCTIONS,
]);

export const ALLOWED_FUNCTION_EXECUTE = Object.freeze({
  "private.learning_has_active_profile": ["authenticated", "service_role"],
  "private.learning_owns_department": ["authenticated", "service_role"],
  "private.learning_is_active_employee_platform_admin": [
    "authenticated",
    "service_role",
  ],
  "private.assert_learning_read_committed": ["service_role"],
  "private.lock_learning_curriculum_graph": ["service_role"],
  "private.validate_curriculum_graph_publication": ["service_role"],
  "learning.is_certification_required": ["service_role"],
  "learning.has_active_certification": ["service_role"],
  "learning.has_active_emergency_exception": ["service_role"],
  "core.has_live_cap": ["authenticated", "service_role"],
  "core.my_role_capabilities": ["authenticated", "service_role"],
  "core.my_capabilities": ["authenticated", "service_role"],
  "core.my_capability_snapshot": ["authenticated", "service_role"],
  ...Object.fromEntries(
    LEARNING_SERVICE_FUNCTIONS.map((name) => [
      name,
      ["authenticated", "service_role"],
    ]),
  ),
});

export const MODELED_FUNCTIONS = new Set([
  ...ALLOWED_SECURITY_DEFINERS,
  ...Object.values(REQUIRED_TRIGGERS).map((trigger) => trigger.function),
  "learning.guard_certification_lifecycle",
]);

export const EXPECTED_FUNCTION_DECLARATION_SQL = Object.freeze({
  "private.learning_has_active_profile":
    "create or replace function private.learning_has_active_profile(required_audience text) returns boolean language sql stable security definer set search_path = ''",
  "private.learning_owns_department":
    "create or replace function private.learning_owns_department(target_department_id uuid) returns boolean language sql stable security definer set search_path = ''",
  "private.learning_is_active_employee_platform_admin":
    "create or replace function private.learning_is_active_employee_platform_admin() returns boolean language sql stable security definer set search_path = ''",
  "private.assert_learning_read_committed":
    "create or replace function private.assert_learning_read_committed() returns void language plpgsql stable security definer set search_path = ''",
  "private.lock_learning_curriculum_graph":
    "create or replace function private.lock_learning_curriculum_graph(target_curriculum_version_ids uuid[]) returns void language plpgsql security definer set search_path = ''",
  "private.validate_curriculum_graph_publication":
    "create or replace function private.validate_curriculum_graph_publication(target_curriculum_version_id uuid, target_audience text, target_effective_at timestamptz) returns void language plpgsql security definer set search_path = ''",
  "private.validate_assignment_requirement_waiver":
    "create or replace function private.validate_assignment_requirement_waiver() returns trigger language plpgsql security definer set search_path = ''",
  "private.validate_certification_issuance":
    "create or replace function private.validate_certification_issuance() returns trigger language plpgsql security definer set search_path = ''",
  "private.lock_certification_role_authority":
    "create or replace function private.lock_certification_role_authority() returns trigger language plpgsql security definer set search_path = ''",
  "private.revoke_certifications_for_role_assignment":
    "create or replace function private.revoke_certifications_for_role_assignment() returns trigger language plpgsql security definer set search_path = ''",
  "private.revoke_certifications_for_role_assignment_v2":
    "create or replace function private.revoke_certifications_for_role_assignment_v2() returns trigger language plpgsql security definer set search_path = ''",
  "private.revoke_certifications_for_role_authority_loss":
    "create or replace function private.revoke_certifications_for_role_authority_loss() returns trigger language plpgsql security definer set search_path = ''",
  "private.guard_role_assignment_identity":
    "create or replace function private.guard_role_assignment_identity() returns trigger language plpgsql set search_path = ''",
  "private.validate_emergency_exception_issuance":
    "create or replace function private.validate_emergency_exception_issuance() returns trigger language plpgsql security definer set search_path = ''",
  "private.resolve_assignments_base":
    "create or replace function private.resolve_assignments_base() returns jsonb language plpgsql security definer set search_path = ''",
  "private.start_requirement_base":
    "create or replace function private.start_requirement_base(payload jsonb) returns jsonb language plpgsql security definer set search_path = ''",
  "private.validate_certification_completion_evidence":
    "create or replace function private.validate_certification_completion_evidence() returns trigger language plpgsql security definer set search_path = ''",
  "learning.guard_authoritative_write_isolation":
    "create or replace function learning.guard_authoritative_write_isolation() returns trigger language plpgsql set search_path = ''",
  "learning.reject_evidence_mutation":
    "create or replace function learning.reject_evidence_mutation() returns trigger language plpgsql set search_path = ''",
  "learning.guard_attempt_lifecycle":
    "create or replace function learning.guard_attempt_lifecycle() returns trigger language plpgsql set search_path = ''",
  "learning.guard_assignment_lifecycle":
    "create or replace function learning.guard_assignment_lifecycle() returns trigger language plpgsql set search_path = ''",
  "learning.guard_assignment_requirement_lifecycle":
    "create or replace function learning.guard_assignment_requirement_lifecycle() returns trigger language plpgsql set search_path = ''",
  "learning.guard_certification_lifecycle":
    "create or replace function learning.guard_certification_lifecycle() returns trigger language plpgsql set search_path = ''",
  "learning.guard_certification_lifecycle_v2":
    "create or replace function learning.guard_certification_lifecycle_v2() returns trigger language plpgsql set search_path = ''",
  "learning.guard_emergency_exception_lifecycle":
    "create or replace function learning.guard_emergency_exception_lifecycle() returns trigger language plpgsql set search_path = ''",
  "learning.guard_content_lifecycle":
    "create or replace function learning.guard_content_lifecycle() returns trigger language plpgsql set search_path = ''",
  "learning.guard_curriculum_composition":
    "create or replace function learning.guard_curriculum_composition() returns trigger language plpgsql set search_path = ''",
  "learning.my_learning_snapshot":
    "create or replace function learning.my_learning_snapshot() returns jsonb language plpgsql stable security definer set search_path = ''",
  "learning.resolve_assignments":
    "create or replace function learning.resolve_assignments() returns jsonb language plpgsql security definer set search_path = ''",
  "learning.start_requirement":
    "create or replace function learning.start_requirement(payload jsonb) returns jsonb language plpgsql security definer set search_path = ''",
  "learning.record_simulation_checkpoint":
    "create or replace function learning.record_simulation_checkpoint(payload jsonb) returns jsonb language plpgsql security definer set search_path = ''",
  "learning.submit_assessment":
    "create or replace function learning.submit_assessment(payload jsonb) returns jsonb language plpgsql security definer set search_path = ''",
  "learning.acknowledge_policy":
    "create or replace function learning.acknowledge_policy(payload jsonb) returns jsonb language plpgsql security definer set search_path = ''",
  "learning.evaluate_certifications":
    "create or replace function learning.evaluate_certifications() returns jsonb language plpgsql security definer set search_path = ''",
  "learning.request_support":
    "create or replace function learning.request_support(payload jsonb) returns jsonb language plpgsql security definer set search_path = ''",
  "learning.sync_shared_completions":
    "create or replace function learning.sync_shared_completions() returns jsonb language plpgsql security definer set search_path = ''",
  "learning.is_certification_required":
    "create or replace function learning.is_certification_required(p_module text, p_cap text) returns boolean language sql stable security definer set search_path = ''",
  "learning.has_active_certification":
    "create or replace function learning.has_active_certification(p_user_id uuid, p_module text, p_cap text) returns boolean language sql stable security definer set search_path = ''",
  "learning.has_active_emergency_exception":
    "create or replace function learning.has_active_emergency_exception(p_user_id uuid, p_module text, p_cap text) returns boolean language sql stable security definer set search_path = ''",
  "core.has_live_cap":
    "create or replace function core.has_live_cap(p_module text, p_cap text) returns boolean language sql stable security definer set search_path = ''",
  "core.my_role_capabilities":
    "create or replace function core.my_role_capabilities() returns jsonb language sql stable security definer set search_path = ''",
  "core.my_capabilities":
    "create or replace function core.my_capabilities() returns jsonb language sql stable security definer set search_path = ''",
  "core.my_capability_snapshot":
    "create or replace function core.my_capability_snapshot() returns jsonb language sql stable security definer set search_path = ''",
});

export const EXPECTED_FUNCTION_BODY_SHA256 = Object.freeze({
  "private.learning_has_active_profile":
    "e7dbe840969ff13aab7311d8d69ccfa67111712fdb19eb026465318815c93736",
  "private.learning_owns_department":
    "e54ad205024e794bd9a6be8d33453704a3b87f52232677e41aa636cec3c1f232",
  "private.learning_is_active_employee_platform_admin":
    "fe11255a9cb0860b5d7726f512e9d8432ea08b783d0e612a3702da58119efe00",
  "private.assert_learning_read_committed":
    "701e87936d124ab17432092a2b21e81c056c2a1cc76d351300f241593a2c0956",
  "private.lock_learning_curriculum_graph":
    "d73aa7ec65a506ceeda369fdbdc223b34e07cec1788df4045cd63ce3a0908c91",
  "private.validate_curriculum_graph_publication":
    "27cbe195b141622a2ee4870a6ab00f3c790076257d1cc4fc66d9ab2c3d06992b",
  "private.validate_assignment_requirement_waiver":
    "35738e87fd94279a142944b8e2b811e685bdfc26e9319384fbcb9c42fda12164",
  "private.validate_certification_issuance":
    "a5512194464bfaec1e3b7a0a8376a3f14ae02abc9531b8e37a3a0f1d69bb1f54",
  "private.lock_certification_role_authority":
    "4cbc6a01858221c42ac3854d11db00e52fcb1355b6224195352b2601ea8ecbd9",
  "private.revoke_certifications_for_role_assignment":
    "28832f0ca9ad37097ebc088b66f2aaf3cd0eede660a9236216bb5daeb507a067",
  "private.revoke_certifications_for_role_assignment_v2":
    "b6293eed92f8cc615dcb82ff840f119d95527cd4a961a66a93aa08146456c676",
  "private.revoke_certifications_for_role_authority_loss":
    "942e3d91a5165026516d16d4ad3bd89bcc98f17da2fe5825bb5d7bf196fce007",
  "private.guard_role_assignment_identity":
    "4eef02b98abe2b97e08120c9ffb8898a9f9690d84af8d0080be6e8bd032929d3",
  "private.validate_emergency_exception_issuance":
    "0055e93a905b56fc6d96db9aeb6850f9761da39fa1bd10421917f37c321b1531",
  "private.resolve_assignments_base":
    "2729f8eca28b7cc7d078141a0edc8f3dd340fd7f5c1fe9521a210bebb45389c2",
  "private.start_requirement_base":
    "1aec7f8e3061da6c8a2abb0a2f5cb8ef1f443edb635cb8381525363afe64deb6",
  "private.validate_certification_completion_evidence":
    "d98966e8976de20a95333b7a0e42defa9dab2551f63a2bc647ba3263158a82c6",
  "learning.guard_authoritative_write_isolation":
    "2f58975130b5a9e41bc212084a6ff31f5232c8cd34946ac170b4b3fbe3ca220e",
  "learning.reject_evidence_mutation":
    "a4cdda80721ae3aee20bcb47d4075dca860a1224b37bb3beb4c0b31d2a5fe0b5",
  "learning.guard_attempt_lifecycle":
    "78c59d7afcfa0a6bea17f65f5ebea16459801819cc45adc8fdcefc51c0498d89",
  "learning.guard_assignment_lifecycle":
    "554c1fb8d28e360bc4c38dbab39212650ccfd218ca6212fa219526972cf30729",
  "learning.guard_assignment_requirement_lifecycle":
    "faee2f823db6bb6715a156b78c298d2d6a113cb40a47715ca54df783e0bd7b39",
  "learning.guard_certification_lifecycle":
    "6ba8320387788360a850514cc8bd86217a08f2d26cc097b35bd84592bdc9ebbe",
  "learning.guard_certification_lifecycle_v2":
    "1910230a304676339d8ec85b91e27240f97d3d2d0c3862b79788f99acb5086fb",
  "learning.guard_emergency_exception_lifecycle":
    "de3b13bcb9feb8e5970c38362288fa27cd3e5e2f21f5ef422ba3a9466a393ad0",
  "learning.guard_content_lifecycle":
    "6d30f12e16c785517bb47dc34d84f2fc0c8649d39b0b160ec8761e4c470938ce",
  "learning.guard_curriculum_composition":
    "0aea39b911deac9b688cd3a58270a3b9135f23dd4921338911f1864b15c10d3c",
  "learning.my_learning_snapshot":
    "4a6203bf714bff317d95701056a98f05d2c0abfcb368d4813402db2928dc4ff8",
  "learning.resolve_assignments":
    "8a409569481656f0f58bece2a386fccc123732dcb06e39d2df3d9738923fe710",
  "learning.start_requirement":
    "294cecabf70371a8a74a9bbf0630100ae2b72e50c7d52024709500c189714e99",
  "learning.record_simulation_checkpoint":
    "283ca2e692fff9563407a7de9e7ae0a4e6fbb9159cfe09f52e6a611525089de0",
  "learning.submit_assessment":
    "80b8209dad35a8110ef3430ffabeabd9a96639f7d949bf2d9c2d7e9938080e55",
  "learning.acknowledge_policy":
    "6de1d3f3c539de860eecc5f42c93811fd26188e448af2302c255e433061ffadb",
  "learning.request_support":
    "ec8f155cf19db9b50f394b6c9b0d160a2805f248e3ecedc34fe5e0e2add17a98",
  "learning.sync_shared_completions":
    "fe31819ed19667879c0000c39bc70f87fa87d51a382e50d5ac947c2f5acd9b28",
  "learning.evaluate_certifications":
    "56e74e7e7c111c1ebd3507f4a34dbe9cfeba0c31c4071b6b09683f032351aa61",
  "learning.is_certification_required":
    "3e08a165d77de2450428101f120aa58edd922257cf2dbe3204986258c761d117",
  "learning.has_active_certification":
    "37d45d895749a23d9c2de27fcd4290c1170a22b69cd54af00daa6a82d44250c1",
  "learning.has_active_emergency_exception":
    "4a501b0bce890b95ddc312be0507b9a927380b2ad55fc5144c03a80ae891954f",
  "core.has_live_cap":
    "13e15136d4891f6681d20b9f1b72c271bc48bb0c14005b43fc7dc3ced9ebdb85",
  "core.my_role_capabilities":
    "9ba8b932c27960bccab9f8a57383628d53ed5dd4195b23001037c8dfebdfcc5c",
  "core.my_capabilities":
    "755b11dd3450af510ee231ab71440adc3a4da79d28b2d4af0e835088e4124536",
  "core.my_capability_snapshot":
    "cd47c4c23045f75cf37a0658e5be612711199bf05ba7a1f2ea7d6a9e9ec4d19c",
});

const ISOLATION_GUARDED_FUNCTIONS = new Set([
  ...Object.values(REQUIRED_TRIGGERS).map((trigger) => trigger.function),
  "private.lock_learning_curriculum_graph",
  "private.validate_curriculum_graph_publication",
  ...LEARNING_SERVICE_MUTATORS,
]);

function normalizeSql(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim().replace(/;$/, "");
}

function canonicalFunctionDeclaration(statement) {
  const bodyStart = statement.match(/\bas\s+(\$[a-z_][a-z0-9_]*\$|\$\$)/i);
  const declaration = bodyStart
    ? statement.slice(0, bodyStart.index)
    : statement;
  return normalizeSql(declaration);
}

function functionArgumentType(argumentDeclaration) {
  const tokens = normalizeSql(argumentDeclaration).split(/\s+/);
  if (["in", "out", "inout", "variadic"].includes(tokens[0])) {
    tokens.shift();
  }
  if (tokens.length < 2) return tokens.join(" ");
  tokens.shift();
  return tokens.join(" ");
}

function functionProconfig(declarationSuffix) {
  const proconfig = [];
  const settingPattern =
    /\bset\s+([a-z_][a-z0-9_.]*)\s*(?:=|to)\s+([\s\S]*?)(?=\s+\bset\s+[a-z_][a-z0-9_.]*\s*(?:=|to)|$)/gi;
  let match;
  while ((match = settingPattern.exec(declarationSuffix))) {
    let value = normalizeSql(match[2]);
    if (/^'(?:''|[^'])*'$/.test(value)) {
      value = value.slice(1, -1).replaceAll("''", "'");
    }
    proconfig.push(`${match[1].toLowerCase()}=${value}`);
  }
  return proconfig;
}

function parseFunctionDeclaration(statement) {
  const declaration = canonicalFunctionDeclaration(statement);
  const match = declaration.match(
    /^create(?: or replace)? function ([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\(([^()]*)\)\s+returns\s+(.+?)\s+language\s+([a-z_][a-z0-9_]*)([\s\S]*)$/,
  );
  if (!match) return null;

  const argumentDeclarations = match[3].trim()
    ? splitTopLevel(match[3]).map(normalizeSql)
    : [];
  const suffix = normalizeSql(match[6]);
  const volatility = suffix.match(/\b(immutable|stable|volatile)\b/)?.[1];
  const parallel = suffix.match(/\bparallel\s+(safe|restricted|unsafe)\b/)?.[1];

  return {
    orReplace: /^create or replace function\b/.test(declaration),
    schema: match[1],
    name: match[2],
    qualifiedName: `${match[1]}.${match[2]}`,
    argumentDeclarations,
    argumentTypes: argumentDeclarations.map(functionArgumentType),
    returnType: normalizeSql(match[4]),
    language: match[5],
    volatility: volatility ?? "volatile",
    securityMode: /\bsecurity definer\b/.test(suffix) ? "definer" : "invoker",
    leakproof:
      /\bleakproof\b/.test(suffix) && !/\bnot leakproof\b/.test(suffix),
    parallel: parallel ?? "unsafe",
    strict:
      /\bstrict\b/.test(suffix) ||
      /\breturns null on null input\b/.test(suffix),
    proconfig: functionProconfig(suffix),
    declaration,
  };
}

function functionMetadataDrift(actual, expected) {
  const fields = [
    "orReplace",
    "schema",
    "name",
    "argumentDeclarations",
    "argumentTypes",
    "returnType",
    "language",
    "volatility",
    "securityMode",
    "leakproof",
    "parallel",
    "strict",
    "proconfig",
  ];
  return fields.filter(
    (field) =>
      JSON.stringify(actual?.[field]) !== JSON.stringify(expected[field]),
  );
}

function canonicalMigrationSql(value) {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function digestFunctionBody(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digestMigrationBaseline(migrations) {
  const digest = createHash("sha256");
  for (const migration of migrations) {
    digest.update(migration.name);
    digest.update("\0");
    digest.update(canonicalMigrationSql(migration.sql));
    digest.update("\0");
  }
  return digest.digest("hex");
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

export function extractExpectedLearningPolicies(input) {
  const policies = new Map();
  for (const migration of asMigrations(input).filter(
    (entry) => entry.name >= FOUNDATION_MIGRATION_NAME,
  )) {
    for (const statement of scanSql(migration.sql)) {
      const normalized = normalizeSql(statement).replaceAll('"', "");
      const create = normalized.match(
        /^create policy ([a-z_][a-z0-9_]*) on learning\.([a-z_][a-z0-9_]*)\b/,
      );
      if (create) {
        const command =
          normalized.match(/\bfor (all|select|insert|update|delete)\b/)?.[1] ??
          "all";
        const roleSql = normalized.match(
          /\bto ([\s\S]+?)(?=\s+using\s*\(|\s+with check\s*\(|$)/,
        )?.[1];
        policies.set(create[1], {
          name: create[1],
          table: `learning.${create[2]}`,
          permissive: !/\bas restrictive\b/.test(normalized),
          command: command.toUpperCase(),
          roles: roleSql ? parseGrantees(roleSql) : ["public"],
          qual: parenthesizedClause(statement, "using") || null,
          withCheck: parenthesizedClause(statement, "with check") || null,
        });
        continue;
      }

      const drop = normalized.match(
        /^drop policy(?: if exists)? ([a-z_][a-z0-9_]*) on learning\.[a-z_][a-z0-9_]*$/,
      );
      if (drop) policies.delete(drop[1]);
    }
  }
  return [...policies.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function readRepositoryMigrations() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const migrationDirectory = resolve(root, "supabase/migrations");
  return readdirSync(migrationDirectory)
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(resolve(migrationDirectory, name), "utf8"),
    }));
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
  const value = unwrapBooleanExpression(normalizeSql(expression));
  return /^private\.learning_has_active_profile\s*\(\s*(?:audience|'internal'|'vendor')\s*\)$/.test(
    value,
  );
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
    .sort((left, right) => left.name.localeCompare(right.name));
}

function validateMigrationInventory(state, migrations) {
  const migrationNamePattern = /^\d{14}_[a-z0-9_]+\.sql$/i;
  const seen = new Set();
  for (const migration of migrations) {
    if (!migrationNamePattern.test(migration.name)) {
      state.errors.push(
        `Malformed SQL migration name ${migration.name}; the complete migration set cannot be verified.`,
      );
    }
    if (seen.has(migration.name)) {
      state.errors.push(
        `Duplicate migration ${migration.name} makes ordered authority state ambiguous.`,
      );
    }
    seen.add(migration.name);
  }

  const migrationByName = new Map(
    migrations.map((migration) => [migration.name, migration]),
  );
  for (const [name, expectedDigest] of Object.entries(
    PINNED_LEARNING_MIGRATION_SHA256,
  )) {
    const migration = migrationByName.get(name);
    if (!migration) {
      state.errors.push(`Pinned learning migration is missing: ${name}.`);
      continue;
    }
    const actualDigest = createHash("sha256")
      .update(canonicalMigrationSql(migration.sql))
      .digest("hex");
    if (actualDigest !== expectedDigest) {
      state.errors.push(
        `Pinned learning migration checksum drifted: ${name}. Add a forward migration instead of rewriting applied history.`,
      );
    }
  }

  const baseline = migrations.filter(
    (migration) => migration.name < FOUNDATION_MIGRATION_NAME,
  );
  const actualNames = new Set(baseline.map((migration) => migration.name));
  const expectedNames = new Set(PINNED_BASELINE_MIGRATION_NAMES);
  const missing = PINNED_BASELINE_MIGRATION_NAMES.filter(
    (name) => !actualNames.has(name),
  );
  const unexpected = baseline
    .map((migration) => migration.name)
    .filter((name) => !expectedNames.has(name));

  if (missing.length > 0) {
    state.errors.push(
      `Pinned migration baseline is incomplete; missing ${missing.join(", ")}.`,
    );
  }
  if (unexpected.length > 0) {
    state.errors.push(
      `Unexpected earlier unpinned migration(s): ${unexpected.join(", ")}.`,
    );
  }
  if (
    missing.length === 0 &&
    unexpected.length === 0 &&
    baseline.length === PINNED_BASELINE_MIGRATION_NAMES.length &&
    digestMigrationBaseline(baseline) !== PINNED_BASELINE_SHA256
  ) {
    state.errors.push(
      "Pinned migration baseline checksum drifted; re-review all historical authority before updating the pin.",
    );
  }
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
    roleAuthorityLifecycle: {
      revocationReasonColumn: false,
      historicalRevocationAttribution: false,
      activeCertificationReconciliation: false,
      assignmentLineageReconciliation: false,
      revocationReasonConstraint: false,
      truncateRevokes: new Map(
        ROLE_AUTHORITY_TABLES.map((table) => [table, new Set()]),
      ),
    },
    learningServices: {
      privateAnswerKeys: {
        created: false,
        rlsEnabled: false,
        rlsForced: false,
        owner: null,
        privileges: new Map(
          ["public", "anon", "authenticated", "service_role"].map((role) => [
            role,
            new Set(),
          ]),
        ),
        authorityConstraintAdded: false,
        authorityConstraintValidated: false,
      },
      functionOwners: new Map(),
    },
    errors: [],
  };
}

function moveModeledFunction(state, fromName, toName) {
  const functionEntry = state.functions.get(fromName);
  if (!functionEntry || state.functions.has(toName)) return false;

  const escapedFromName = fromName.replaceAll(".", "\\.");
  const statement = functionEntry.statement.replace(
    new RegExp(
      `(create(?: or replace)? function\\s+)${escapedFromName}(?=\\s*\\()`,
      "i",
    ),
    `$1${toName}`,
  );
  const metadata = parseFunctionDeclaration(statement);
  if (!metadata || metadata.qualifiedName !== toName) return false;

  state.functions.delete(fromName);
  state.functions.set(toName, {
    ...functionEntry,
    statement,
    metadata,
  });
  if (state.learningServices.functionOwners.has(fromName)) {
    const owner = state.learningServices.functionOwners.get(fromName);
    state.learningServices.functionOwners.delete(fromName);
    state.learningServices.functionOwners.set(toName, owner);
  }
  return true;
}

function processStatement(state, statement, migrationName) {
  const normalized = normalizeSql(statement).replaceAll('"', "");
  const isFoundation = migrationName === FOUNDATION_MIGRATION_NAME;
  const isRoleLifecycle = migrationName === ROLE_LIFECYCLE_MIGRATION_NAME;
  const isAssignmentLineage =
    migrationName === ASSIGNMENT_LINEAGE_MIGRATION_NAME;
  const isLearningServices = migrationName === SERVICES_MIGRATION_NAME;
  const isServiceContractAlignment =
    migrationName === SERVICE_CONTRACT_ALIGNMENT_MIGRATION_NAME;
  const isCompletionAlignment =
    migrationName === COMPLETION_ALIGNMENT_MIGRATION_NAME;
  const isCompletionHardening =
    migrationName === COMPLETION_HARDENING_MIGRATION_NAME;
  const isAuthority = migrationName === AUTHORITY_MIGRATION_NAME;
  const isOrientationRuntime =
    migrationName === ORIENTATION_RUNTIME_MIGRATION_NAME;
  let match;

  if (
    isOrientationRuntime &&
    /^alter table learning\.requirement_versions add constraint requirement_versions_orientation_runtime_check check \(/.test(
      normalized,
    )
  ) {
    return;
  }
  if (
    isOrientationRuntime &&
    normalized ===
      "alter table learning.requirement_versions validate constraint requirement_versions_orientation_runtime_check"
  ) {
    return;
  }

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

  if (
    normalized ===
    "alter table learning.certifications add column if not exists revocation_reason text"
  ) {
    if (!isRoleLifecycle) {
      state.errors.push(
        `${migrationName}: certification revocation attribution may only be introduced by the modeled lifecycle migration.`,
      );
    } else {
      state.roleAuthorityLifecycle.revocationReasonColumn = true;
    }
    return;
  }

  if (
    normalized ===
    "update learning.certifications set revocation_reason = 'system:historical_revocation_backfill' where status = 'revoked' and revocation_reason is null"
  ) {
    if (
      !isRoleLifecycle ||
      state.triggers.has("learning_certifications_lifecycle_guard")
    ) {
      state.errors.push(
        `${migrationName}: historical certification attribution must run in the locked modeled lifecycle window.`,
      );
    } else {
      state.roleAuthorityLifecycle.historicalRevocationAttribution = true;
    }
    return;
  }

  if (
    isAssignmentLineage &&
    /^update learning\.certifications certification set\b/.test(normalized)
  ) {
    const reconciliationPatterns = [
      /set status = 'revoked', revoked_at = pg_catalog\.clock_timestamp\(\), revocation_reason = case/,
      /then 'system:source_role_assignment_missing'/,
      /else 'system:source_role_assignment_identity_mismatch' end/,
      /from core\.user_roles source_assignment/,
      /source_assignment\.id = certification\.source_role_assignment_id/,
      /source_assignment\.user_id = certification\.user_id/,
      /source_assignment\.module = certification\.module/,
      /source_assignment\.role = certification\.source_role/,
      /where certification\.status = 'active'/,
    ];
    if (
      createHash("sha256").update(normalized).digest("hex") !==
        ASSIGNMENT_LINEAGE_RECONCILIATION_SHA256 ||
      reconciliationPatterns.some((pattern) => !pattern.test(normalized))
    ) {
      state.errors.push(
        `${migrationName}: exact role-assignment lineage reconciliation is missing or weakened.`,
      );
    } else {
      state.roleAuthorityLifecycle.assignmentLineageReconciliation = true;
    }
    return;
  }

  if (/^update learning\.certifications certification set\b/.test(normalized)) {
    const reconciliationPatterns = [
      /set status = 'revoked', revoked_at = pg_catalog\.clock_timestamp\(\), revocation_reason = case/,
      /then 'system:source_role_inactive'/,
      /else 'system:source_role_capability_missing' end/,
      /from core\.roles source_role/,
      /source_role\.module = certification\.module/,
      /source_role\.role = certification\.source_role/,
      /source_role\.is_active/,
      /where certification\.status = 'active'/,
      /or not exists \( select 1 from core\.role_capabilities source_capability/,
      /source_capability\.module = certification\.module/,
      /source_capability\.role = certification\.source_role/,
      /source_capability\.cap = certification\.capability/,
    ];
    if (
      !isRoleLifecycle ||
      state.triggers.has("learning_certifications_lifecycle_guard") ||
      createHash("sha256").update(normalized).digest("hex") !==
        ROLE_AUTHORITY_RECONCILIATION_SHA256 ||
      reconciliationPatterns.some((pattern) => !pattern.test(normalized))
    ) {
      state.errors.push(
        `${migrationName}: one-time existing active certification authority reconciliation is missing or weakened.`,
      );
    } else {
      state.roleAuthorityLifecycle.activeCertificationReconciliation = true;
    }
    return;
  }

  if (
    /^alter table learning\.certifications add constraint certifications_revocation_reason_check check \( \(status = 'revoked'\) = \(nullif\(pg_catalog\.btrim\(revocation_reason\), ''\) is not null\) \)$/.test(
      normalized,
    )
  ) {
    if (!isRoleLifecycle) {
      state.errors.push(
        `${migrationName}: certification revocation attribution constraint is outside the modeled lifecycle migration.`,
      );
    } else {
      state.roleAuthorityLifecycle.revocationReasonConstraint = true;
    }
    return;
  }

  if (/^notify pgrst, 'reload (?:config|schema)'$/.test(normalized)) {
    if (!isFoundation)
      state.errors.push(
        `${migrationName}: unmodeled PostgREST notification is denied.`,
      );
    return;
  }

  if (
    /^create table private\.learning_assessment_answer_keys\b/.test(normalized)
  ) {
    if (
      !isLearningServices ||
      createHash("sha256").update(normalized).digest("hex") !==
        PRIVATE_ANSWER_KEY_TABLE_SHA256
    ) {
      state.errors.push(
        `${migrationName}: private assessment answer-key table must match the exact reviewed definition and foreign keys.`,
      );
    } else {
      state.learningServices.privateAnswerKeys.created = true;
    }
    return;
  }

  match = normalized.match(
    /^alter table private\.learning_assessment_answer_keys (enable|disable) row level security$/,
  );
  if (match) {
    if (!isLearningServices || match[1] !== "enable") {
      state.errors.push(
        `${migrationName}: private assessment answer-key RLS must be enabled only by the reviewed services migration.`,
      );
    } else {
      state.learningServices.privateAnswerKeys.rlsEnabled = true;
    }
    return;
  }

  match = normalized.match(
    /^alter table private\.learning_assessment_answer_keys (force|no force) row level security$/,
  );
  if (match) {
    if (!isLearningServices || match[1] !== "force") {
      state.errors.push(
        `${migrationName}: private assessment answer-key RLS must remain forced.`,
      );
    } else {
      state.learningServices.privateAnswerKeys.rlsForced = true;
    }
    return;
  }

  match = normalized.match(
    /^alter table private\.learning_assessment_answer_keys owner to ([a-z_][a-z0-9_]*)$/,
  );
  if (match) {
    if (!isLearningServices || match[1] !== "postgres") {
      state.errors.push(
        `${migrationName}: private assessment answer-key table must be owned by postgres.`,
      );
    } else {
      state.learningServices.privateAnswerKeys.owner = match[1];
    }
    return;
  }

  match = normalized.match(
    /^revoke all(?: privileges)? on (?:table )?private\.learning_assessment_answer_keys from (.+?)(?: cascade| restrict)?$/,
  );
  if (match) {
    const grantees = parseGrantees(match[1]);
    const expected = ["public", "anon", "authenticated", "service_role"];
    if (
      !isLearningServices ||
      grantees.length !== expected.length ||
      expected.some((role) => !grantees.includes(role))
    ) {
      state.errors.push(
        `${migrationName}: private answer-key table revoke must cover every client role exactly.`,
      );
    } else {
      for (const role of grantees) {
        state.learningServices.privateAnswerKeys.privileges.get(role).clear();
      }
    }
    return;
  }

  match = normalized.match(
    /^grant (.+?) on (?:table )?private\.learning_assessment_answer_keys to (.+)$/,
  );
  if (match) {
    const privileges = expandPrivileges(match[1]).sort();
    const grantees = parseGrantees(match[2]);
    const expectedPrivileges = ["delete", "insert", "select", "update"];
    if (
      !isLearningServices ||
      /\bwith grant option\b/.test(normalized) ||
      grantees.length !== 1 ||
      grantees[0] !== "service_role" ||
      JSON.stringify(privileges) !== JSON.stringify(expectedPrivileges)
    ) {
      state.errors.push(
        `${migrationName}: private answer-key table permits only non-delegable service-role SELECT, INSERT, UPDATE, and DELETE.`,
      );
    } else {
      const granted =
        state.learningServices.privateAnswerKeys.privileges.get("service_role");
      for (const privilege of privileges) granted.add(privilege);
    }
    return;
  }

  if (
    /^alter table learning\.requirement_versions add constraint requirement_versions_private_answer_key_check\b/.test(
      normalized,
    )
  ) {
    if (
      !isLearningServices ||
      createHash("sha256").update(normalized).digest("hex") !==
        PRIVATE_ANSWER_KEY_CONSTRAINT_SHA256
    ) {
      state.errors.push(
        `${migrationName}: learner-readable assessment settings must reject every reviewed answer-key spelling.`,
      );
    } else {
      state.learningServices.privateAnswerKeys.authorityConstraintAdded = true;
    }
    return;
  }

  if (
    /^alter table learning\.requirement_versions validate constraint requirement_versions_private_answer_key_check$/.test(
      normalized,
    )
  ) {
    if (
      !isLearningServices ||
      createHash("sha256").update(normalized).digest("hex") !==
        PRIVATE_ANSWER_KEY_VALIDATION_SHA256
    ) {
      state.errors.push(
        `${migrationName}: private answer-key constraint validation is not the reviewed statement.`,
      );
    } else {
      state.learningServices.privateAnswerKeys.authorityConstraintValidated = true;
    }
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

  if (
    isAuthority &&
    /^insert into learning\.mutation_capability_rules\s*\(module, capability\) values\b/.test(
      normalized,
    )
  ) {
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
    const modeledOnTable = Object.values(REQUIRED_TRIGGERS).some(
      (trigger) => trigger.table === table,
    );
    if (
      !isFoundation &&
      (!modeledOnTable ||
        (!["all", "user"].includes(triggerName) &&
          !Object.hasOwn(REQUIRED_TRIGGERS, triggerName)))
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
    /^revoke (.+?) on (?:table )?core\.(roles|role_capabilities|user_roles) from (.+?)(?: cascade| restrict)?$/,
  );
  if (match) {
    const privileges = expandPrivileges(match[1]);
    const grantees = parseGrantees(match[3]);
    const exactGrantees =
      grantees.length === UNSAFE_AUTHORITY_TRUNCATE_ROLES.length &&
      UNSAFE_AUTHORITY_TRUNCATE_ROLES.every((role) => grantees.includes(role));
    if (
      !isRoleLifecycle ||
      privileges.length !== 1 ||
      privileges[0] !== "truncate" ||
      !exactGrantees
    ) {
      state.errors.push(
        `${migrationName}: authority table privilege changes must be the exact modeled TRUNCATE denial.`,
      );
      return;
    }
    const revoked = state.roleAuthorityLifecycle.truncateRevokes.get(match[2]);
    for (const role of grantees) revoked.add(role);
    return;
  }

  if (
    /^grant .+ on (?:table )?core\.(?:roles|role_capabilities|user_roles) to /.test(
      normalized,
    ) ||
    /^grant .+ on all tables in schema core to /.test(normalized)
  ) {
    state.errors.push(
      `${migrationName}: authority table privileges cannot restore TRUNCATE or bypass row-level constrained role updates.`,
    );
    return;
  }

  if (/^alter default privileges\b/.test(normalized)) {
    state.errors.push(
      `${migrationName}: DEFAULT PRIVILEGES changes are denied after the pinned baseline and cannot restore authority-table TRUNCATE.`,
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
    /^grant execute on function ([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(([^)]*)\) to (.+)$/,
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
    const privilegeArgumentTypes = match[2].trim()
      ? splitTopLevel(match[2]).map(normalizeSql)
      : [];
    if (
      JSON.stringify(privilegeArgumentTypes) !==
      JSON.stringify(functionEntry.metadata.argumentTypes)
    ) {
      state.errors.push(
        `${migrationName}: function privilege target ${match[1]} has an unexpected signature.`,
      );
      return;
    }
    for (const role of parseGrantees(match[3]))
      functionEntry.executeRoles.add(role);
    return;
  }

  match = normalized.match(
    /^revoke (?:all(?: privileges)?|execute) on function ([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(([^)]*)\) from (.+?)(?: cascade| restrict)?$/,
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
    const privilegeArgumentTypes = match[2].trim()
      ? splitTopLevel(match[2]).map(normalizeSql)
      : [];
    if (
      JSON.stringify(privilegeArgumentTypes) !==
      JSON.stringify(functionEntry.metadata.argumentTypes)
    ) {
      state.errors.push(
        `${migrationName}: function privilege target ${match[1]} has an unexpected signature.`,
      );
      return;
    }
    for (const role of parseGrantees(match[3]))
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
    const metadata = parseFunctionDeclaration(statement);
    if (!metadata) {
      state.errors.push(
        `${migrationName}: modeled function declaration metadata is not safely analyzable.`,
      );
      return;
    }
    if (!MODELED_FUNCTIONS.has(metadata.qualifiedName)) {
      state.errors.push(
        `${migrationName}: unmodeled procedural function ${metadata.qualifiedName} is default-denied.`,
      );
      return;
    }
    const existingFunction = state.functions.get(metadata.qualifiedName);
    const approvedSnapshotAlignment =
      isServiceContractAlignment &&
      metadata.qualifiedName === "learning.my_learning_snapshot" &&
      metadata.argumentTypes.length === 0 &&
      existingFunction?.migrationName === SERVICES_MIGRATION_NAME;
    const approvedCompletionAlignment =
      isCompletionAlignment &&
      !existingFunction &&
      new Map([
        ["learning.sync_shared_completions", []],
        ["learning.resolve_assignments", []],
        ["learning.start_requirement", ["jsonb"]],
        ["private.validate_certification_completion_evidence", []],
      ])
        .get(metadata.qualifiedName)
        ?.join("|") === metadata.argumentTypes.join("|");
    const approvedCompletionHardening =
      isCompletionHardening &&
      ((metadata.qualifiedName === "learning.my_learning_snapshot" &&
        metadata.argumentTypes.length === 0 &&
        existingFunction?.migrationName ===
          SERVICE_CONTRACT_ALIGNMENT_MIGRATION_NAME) ||
        (metadata.qualifiedName === "learning.sync_shared_completions" &&
          metadata.argumentTypes.length === 0 &&
          existingFunction?.migrationName ===
            COMPLETION_ALIGNMENT_MIGRATION_NAME) ||
        (existingFunction &&
          new Map([
            ["learning.resolve_assignments", []],
            ["learning.start_requirement", ["jsonb"]],
            ["private.resolve_assignments_base", []],
            ["private.start_requirement_base", ["jsonb"]],
            ["private.validate_certification_completion_evidence", []],
          ])
            .get(metadata.qualifiedName)
            ?.join("|") === metadata.argumentTypes.join("|")));
    const approvedAuthority =
      isAuthority &&
      LEARNING_AUTHORITY_FUNCTIONS.includes(metadata.qualifiedName);
    if (isServiceContractAlignment && !approvedSnapshotAlignment) {
      state.errors.push(
        `${migrationName}: only the exact no-argument learning.my_learning_snapshot replacement is approved.`,
      );
      return;
    }
    if (isCompletionAlignment && !approvedCompletionAlignment) {
      state.errors.push(
        `${migrationName}: only the exact no-argument learning.sync_shared_completions declaration is approved.`,
      );
      return;
    }
    if (isCompletionHardening && !approvedCompletionHardening) {
      state.errors.push(
        `${migrationName}: only exact reviewed completion-hardening function declarations are approved.`,
      );
      return;
    }
    if (isAuthority && !approvedAuthority) {
      state.errors.push(
        `${migrationName}: only exact reviewed learning authority function declarations are approved.`,
      );
      return;
    }
    if (
      existingFunction &&
      !approvedSnapshotAlignment &&
      !approvedCompletionHardening
    ) {
      state.errors.push(
        `${migrationName}: replacement or overload of modeled function ${metadata.qualifiedName} is default-denied.`,
      );
      return;
    }
    state.functions.set(metadata.qualifiedName, {
      statement,
      body: functionBody(statement),
      reachableBody: withoutStaticallyUnreachableBranches(
        functionBody(statement),
      ),
      metadata,
      securityDefiner: metadata.securityMode === "definer",
      executeRoles: new Set(["public"]),
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

  match = normalized.match(
    /^alter function ((?:learning|private|core)\.[a-z_][a-z0-9_]*)\s*\(([^)]*)\) owner to ([a-z_][a-z0-9_]*)$/,
  );
  if (match) {
    const functionEntry = state.functions.get(match[1]);
    const argumentTypes = match[2].trim()
      ? splitTopLevel(match[2]).map(normalizeSql)
      : [];
    const approvedCompletionOwner =
      (isCompletionAlignment || isCompletionHardening) &&
      new Set([
        "learning.my_learning_snapshot",
        "learning.sync_shared_completions",
        "learning.resolve_assignments",
        "learning.start_requirement",
        "private.resolve_assignments_base",
        "private.start_requirement_base",
        "private.validate_certification_completion_evidence",
      ]).has(match[1]);
    const approvedServiceOwner =
      (isLearningServices && LEARNING_SERVICE_FUNCTIONS.includes(match[1])) ||
      (isServiceContractAlignment &&
        match[1] === "learning.my_learning_snapshot") ||
      approvedCompletionOwner ||
      (isAuthority && LEARNING_AUTHORITY_FUNCTIONS.includes(match[1]));
    if (
      !approvedServiceOwner ||
      match[3] !== "postgres" ||
      !functionEntry ||
      JSON.stringify(argumentTypes) !==
        JSON.stringify(functionEntry.metadata.argumentTypes)
    ) {
      state.errors.push(
        `${migrationName}: learning service function ownership must target the exact reviewed signature and postgres owner.`,
      );
    } else {
      state.learningServices.functionOwners.set(match[1], match[3]);
    }
    return;
  }

  const approvedFunctionMoves = new Map([
    [
      "alter function learning.resolve_assignments() rename to resolve_assignments_base",
      ["learning.resolve_assignments", "learning.resolve_assignments_base"],
    ],
    [
      "alter function learning.resolve_assignments_base() set schema private",
      ["learning.resolve_assignments_base", "private.resolve_assignments_base"],
    ],
    [
      "alter function learning.start_requirement(jsonb) rename to start_requirement_base",
      ["learning.start_requirement", "learning.start_requirement_base"],
    ],
    [
      "alter function learning.start_requirement_base(jsonb) set schema private",
      ["learning.start_requirement_base", "private.start_requirement_base"],
    ],
  ]);
  if (approvedFunctionMoves.has(normalized)) {
    const [fromName, toName] = approvedFunctionMoves.get(normalized);
    if (
      !(isCompletionAlignment || isCompletionHardening) ||
      !moveModeledFunction(state, fromName, toName)
    ) {
      state.errors.push(
        `${migrationName}: reviewed completion-alignment function move could not be applied exactly.`,
      );
    }
    return;
  }

  if (/^alter function\b/.test(normalized)) {
    state.errors.push(
      `${migrationName}: unmodeled ALTER FUNCTION is denied in the learning security boundary.`,
    );
    return;
  }

  if (
    /^create (?:or replace )?(?:constraint )?trigger\b/.test(normalized) &&
    /\bon (?:learning|core)\./.test(normalized)
  ) {
    match = normalized.match(
      /^create (?:or replace )?(constraint )?trigger ([a-z_][a-z0-9_]*) ((?:before|after|instead of) .+?) on ((?:learning|core)\.[a-z_][a-z0-9_]*)(?: (deferrable initially deferred|not deferrable))? for each row execute function ((?:learning|private)\.[a-z_][a-z0-9_]*)\(\)$/,
    );
    if (!match) {
      state.errors.push(
        `${migrationName}: unconsumed trigger clause; required triggers may not use predicates, arguments, transition tables, or unmodeled attributes.`,
      );
      return;
    }
    if (!Object.hasOwn(REQUIRED_TRIGGERS, match[2])) {
      state.errors.push(
        `${migrationName}: unmodeled trigger ${match[2]} is default-denied.`,
      );
      return;
    }
    state.triggers.set(match[2], {
      name: match[2],
      events: match[3],
      table: match[4],
      function: match[6],
      constraint: Boolean(match[1]),
      deferred: match[5] === "deferrable initially deferred",
      predicate: null,
      arguments: [],
      oldTransitionTable: null,
      newTransitionTable: null,
      migrationName,
    });
    return;
  }

  match = normalized.match(
    /^drop trigger(?: if exists)? ([a-z_]+) on ((?:learning|core)\.[a-z_]+)(?: cascade| restrict)?$/,
  );
  if (match) {
    const isLegacyRename =
      isRoleLifecycle &&
      match[1] ===
        "learning_curriculum_requirement_prerequisites_read_committed_guard" &&
      match[2] === "learning.curriculum_requirement_prerequisites";
    if (!Object.hasOwn(REQUIRED_TRIGGERS, match[1]) && !isLegacyRename) {
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
    const isModeledRoleAuthorityIndex =
      isRoleLifecycle && match[2] === ROLE_AUTHORITY_INDEX_NAME;
    if (
      !isFoundation &&
      !state.indexes.has(match[2]) &&
      !isModeledRoleAuthorityIndex
    ) {
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
    if (table === "mutation_capability_rules") {
      requirePattern(
        state.errors,
        normalized,
        /primary key \(module, capability\)/,
        "Mutation capability rules need the canonical composite primary key.",
      );
    } else {
      requirePattern(
        state.errors,
        normalized,
        /\bid uuid primary key default gen_random_uuid\(\)/,
        `learning.${table} needs a generated UUID primary key.`,
      );
    }
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
      authenticated: table === "mutation_capability_rules" ? [] : ["select"],
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
        `Policy ${name} must require an exact positive active profile helper atom on every authorization path.`,
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
    "learning.guard_certification_lifecycle_v2",
    [
      /tg_op = 'delete'/,
      /old\.status <> 'active'/,
      /revocation_reason/,
      /attributable reason/,
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
    "private.lock_certification_role_authority",
    [
      /core\.roles role_definition/,
      /role_definition\.is_active/,
      /core\.user_roles role_assignment/,
      /role_assignment\.id = new\.source_role_assignment_id/,
      /core\.role_capabilities role_capability/,
      /role_capability\.cap = new\.capability/,
      /for key share/,
      /for share/,
      /raise exception/,
    ],
    "Certification issuance must lock final live role, assignment, and capability authority.",
  );
  requireFunction(
    state,
    "private.revoke_certifications_for_role_authority_loss",
    [
      /tg_table_name = 'roles'/,
      /core\.roles final_role/,
      /final_role\.is_active/,
      /tg_table_name = 'role_capabilities'/,
      /core\.role_capabilities final_capability/,
      /final_capability\.cap = old\.cap/,
      /update learning\.certifications/,
      /source_role = old\.role/,
      /capability = old\.cap/,
      /system:source_role_inactive/,
      /system:source_role_capability_missing/,
      /status = 'revoked'/,
      /status = 'active'/,
    ],
    "Final role deactivation or capability removal must revoke dependent active certifications without deleting history.",
  );
  requireFunction(
    state,
    "private.revoke_certifications_for_role_assignment_v2",
    [
      /update learning\.certifications/,
      /status = 'revoked'/,
      /system:source_role_assignment_removed/,
      /source_role_assignment_id = old\.id/,
    ],
    "Role deletion must revoke dependent active certifications without deleting history.",
  );
  requireFunction(
    state,
    "private.guard_role_assignment_identity",
    [
      /new\.id is distinct from old\.id/,
      /new\.user_id is distinct from old\.user_id/,
      /new\.module is distinct from old\.module/,
      /new\.role is distinct from old\.role/,
      /role assignment identity is immutable/,
      /raise exception/,
    ],
    "Role-assignment identity fields must be immutable while unrelated updates remain supported.",
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

  const authorityLock =
    state.functions.get("private.lock_certification_role_authority")
      ?.reachableBody ?? "";
  const roleDefinitionLock = authorityLock.indexOf(
    "core.roles role_definition",
  );
  const roleAssignmentLock = authorityLock.indexOf(
    "core.user_roles role_assignment",
  );
  const roleCapabilityLock = authorityLock.indexOf(
    "core.role_capabilities role_capability",
  );
  if (
    roleDefinitionLock < 0 ||
    roleAssignmentLock <= roleDefinitionLock ||
    roleCapabilityLock <= roleAssignmentLock
  ) {
    state.errors.push(
      "Certification authority locks must follow role, assignment, then capability order before graph validation.",
    );
  }

  for (const name of MODELED_FUNCTIONS) {
    if (!state.functions.has(name)) {
      state.errors.push(`Missing modeled learning function ${name}.`);
      continue;
    }
    const functionEntry = state.functions.get(name);
    const expectedDeclaration = EXPECTED_FUNCTION_DECLARATION_SQL[name];
    if (!expectedDeclaration) {
      state.errors.push(
        `Modeled function ${name} has no pinned exact declaration metadata.`,
      );
    } else {
      const expectedMetadata = parseFunctionDeclaration(expectedDeclaration);
      const drift = functionMetadataDrift(
        functionEntry.metadata,
        expectedMetadata,
      );
      if (drift.length > 0) {
        state.errors.push(
          `Modeled function ${name} declaration metadata drifted (${drift.join(", ")}); exact signature, return type, language, volatility, security, leakproof, parallel, strictness, and proconfig are required.`,
        );
      }
    }
    if (functionEntry.securityDefiner !== ALLOWED_SECURITY_DEFINERS.has(name)) {
      state.errors.push(
        `Modeled function ${name} has an unexpected SECURITY DEFINER security mode.`,
      );
    }
    const expectedDigest = EXPECTED_FUNCTION_BODY_SHA256[name];
    if (!expectedDigest) {
      state.errors.push(
        `Modeled function ${name} has no pinned exact function body.`,
      );
    } else if (digestFunctionBody(functionEntry.body) !== expectedDigest) {
      state.errors.push(
        `Exact guarded function body drifted for ${name} (${digestFunctionBody(functionEntry.body)}); control-flow changes require explicit verifier review.`,
      );
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
    if (
      trigger.constraint !== Boolean(expected.constraint) ||
      trigger.deferred !== Boolean(expected.deferred)
    ) {
      state.errors.push(
        expected.deferred
          ? `Required final-state trigger ${name} must be a deferred constraint trigger.`
          : `Required trigger ${name} has an unexpected constraint/deferred mode.`,
      );
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

  const authorityIndex = state.indexes.get(ROLE_AUTHORITY_INDEX_NAME);
  if (
    !authorityIndex ||
    authorityIndex.table !== "certifications" ||
    authorityIndex.unique ||
    authorityIndex.columns.join(",") !== "module,source_role,capability" ||
    !/where status = 'active'/.test(authorityIndex.normalized)
  ) {
    state.errors.push(
      "Missing active certification role authority index on (module, source_role, capability).",
    );
  }
}

function validateRoleAuthorityLifecycle(state) {
  const lifecycle = state.roleAuthorityLifecycle;
  if (!lifecycle.revocationReasonColumn) {
    state.errors.push(
      "Certification authority lifecycle must add attributable revocation reasons.",
    );
  }
  if (!lifecycle.historicalRevocationAttribution) {
    state.errors.push(
      "Existing revoked certifications need one-time revocation attribution.",
    );
  }
  if (!lifecycle.activeCertificationReconciliation) {
    state.errors.push(
      "Existing active certifications need one-time role authority reconciliation.",
    );
  }
  if (!lifecycle.assignmentLineageReconciliation) {
    state.errors.push(
      "Existing active certifications need exact role-assignment lineage reconciliation.",
    );
  }
  if (!lifecycle.revocationReasonConstraint) {
    state.errors.push(
      "Certification revocation status and attributable reason must remain constrained.",
    );
  }
  for (const table of ROLE_AUTHORITY_TABLES) {
    const revoked = lifecycle.truncateRevokes.get(table);
    const missing = UNSAFE_AUTHORITY_TRUNCATE_ROLES.filter(
      (role) => !revoked.has(role),
    );
    if (missing.length > 0) {
      state.errors.push(
        `TRUNCATE on core.${table} must be revoked from unsafe roles so supported authority changes remain row-level.`,
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

function validateLearningServices(state) {
  const privateTable = state.learningServices.privateAnswerKeys;
  if (!privateTable.created) {
    state.errors.push(
      `Missing exact ${PRIVATE_ANSWER_KEY_TABLE} definition and authority foreign keys.`,
    );
  }
  if (!privateTable.rlsEnabled || !privateTable.rlsForced) {
    state.errors.push(
      `${PRIVATE_ANSWER_KEY_TABLE} must have enabled and forced RLS with no client policy.`,
    );
  }
  if (privateTable.owner !== "postgres") {
    state.errors.push(`${PRIVATE_ANSWER_KEY_TABLE} must be owned by postgres.`);
  }
  const expectedPrivileges = {
    public: [],
    anon: [],
    authenticated: [],
    service_role: ["delete", "insert", "select", "update"],
  };
  for (const [role, expected] of Object.entries(expectedPrivileges)) {
    const actual = [...(privateTable.privileges.get(role) ?? [])].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      state.errors.push(
        `Unsafe effective grant on ${PRIVATE_ANSWER_KEY_TABLE} for ${role}: expected [${expected.join(", ")}], found [${actual.join(", ")}].`,
      );
    }
  }
  if (
    !privateTable.authorityConstraintAdded ||
    !privateTable.authorityConstraintValidated
  ) {
    state.errors.push(
      "Learner-readable assessment settings must have a validated constraint excluding answer-key authority.",
    );
  }
  for (const functionName of LEARNING_SERVICE_FUNCTIONS) {
    if (
      state.learningServices.functionOwners.get(functionName) !== "postgres"
    ) {
      state.errors.push(
        `Learning service function ${functionName} must have an exact postgres ownership statement.`,
      );
    }
  }
}

export function verifyLearningSchema(input) {
  const migrations = asMigrations(input);
  const state = createState();

  validateMigrationInventory(state, migrations);

  if (
    !migrations.some(
      (migration) => migration.name === FOUNDATION_MIGRATION_NAME,
    )
  ) {
    state.errors.push(
      `Missing forward foundation migration ${FOUNDATION_MIGRATION_NAME}.`,
    );
  }
  if (
    !migrations.some((migration) => migration.name === SERVICES_MIGRATION_NAME)
  ) {
    state.errors.push(
      `Missing forward learning services migration ${SERVICES_MIGRATION_NAME}.`,
    );
  }

  for (const migration of migrations.filter(
    (entry) => entry.name >= FOUNDATION_MIGRATION_NAME,
  )) {
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
  validateRoleAuthorityLifecycle(state);
  validateAuthorityIsolation(state);
  validateLearningServices(state);

  return [...new Set(state.errors)];
}

function run() {
  const migrations = readRepositoryMigrations();
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
