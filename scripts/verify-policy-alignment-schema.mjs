import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const migration = path.resolve(
  process.cwd(),
  'supabase/migrations/20260710210000_policy_aligned_legal_procurement.sql',
);

if (!fs.existsSync(migration)) {
  console.error(`Missing policy-alignment migration: ${migration}`);
  process.exit(1);
}

const sql = fs.readFileSync(migration, 'utf8');
const doaMigrationPath = path.resolve(
  process.cwd(),
  'supabase/migrations/20260711090000_department_doa_administration.sql',
);
const doaSql = fs.existsSync(doaMigrationPath)
  ? fs.readFileSync(doaMigrationPath, 'utf8')
  : '';
const required = [
  'legal.policy_definitions',
  'legal.vendor_application_snapshots',
  'legal.vendor_technology_qualifications',
  'legal.accreditation_dispositions',
  'legal.instrument_documents',
  'legal.instrument_signatures',
  'legal.instrument_lifecycle_events',
  'procurement.route_decisions',
  'procurement.sourcing_events',
  'procurement.sourcing_responses',
  'procurement.exception_packs',
  'procurement.doa_matrices',
  'procurement.doa_assignments',
  'procurement.financial_protection_requirements',
  'procurement.acceptance_packs',
  'procurement.payment_readiness_packs',
  'core.policy_remediation_queue',
];

const failures = [];
for (const relation of required) {
  if (!sql.includes(`create table if not exists ${relation}`)) {
    failures.push(`missing table ${relation}`);
  }
  if (!sql.includes(`alter table ${relation} enable row level security`)) {
    failures.push(`missing RLS enable for ${relation}`);
  }
  if (!sql.includes(`alter table ${relation} force row level security`)) {
    failures.push(`missing forced RLS for ${relation}`);
  }
}

for (const token of [
  'document_hash text not null',
  'policy_version text not null',
  'policy_decision_required',
  'security definer',
  "set search_path = ''",
  'revoke all on function',
  'from public, anon',
  'grant execute on function',
  'to authenticated, service_role',
  'auth.uid()',
  'core.has_cap',
  'private.policy_issue_purchase_order',
  'private.policy_assert_po_vendor_eligible',
  'private.policy_record_acceptance_pack',
  'private.policy_prepare_payment_readiness',
  'private.policy_review_payment_readiness',
  "v_request.status<>'approved'",
  'A governed Warehouse receipt is required for goods acceptance',
  'Payment readiness evidence is incomplete',
]) {
  if (!sql.toLowerCase().includes(token.toLowerCase()))
    failures.push(`missing control: ${token}`);
}

for (const token of [
  'alter column department set not null',
  'private.policy_save_doa_matrix',
  'private.policy_activate_doa_matrix',
  "core.has_cap('legal','manage_doa')",
  'm.department = v_request.department',
  'doa_matrix_activated',
]) {
  if (!doaSql.toLowerCase().includes(token.toLowerCase())) {
    failures.push(`missing department DOA control: ${token}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(
  `Policy-alignment schema contract verified (${required.length} governed tables).`,
);
