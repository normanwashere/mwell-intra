import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REQUIRED_CONTRACTS = [
  ['Procurement receipt mutation is revoked and removed', /drop function if exists procurement\.receive_purchase_order\(jsonb\)/i],
  ['legacy Warehouse receipt mutation is removed', /drop function if exists warehouse\.receive_against_procurement_po\(jsonb\)/i],
  ['Warehouse receipt authority checks receive_stock', /core\.has_cap\('warehouse',\s*'receive_stock'\)/i],
  ['PO is locked before receipt validation', /from procurement\.purchase_orders[\s\S]*?for update/i],
  ['PO lines are locked before stock posting', /from procurement\.purchase_order_lines[\s\S]*?for update/i],
  ['only issued POs are receivable', /status <> 'issued'/i],
  ['cancelled or rejected PO lines are rejected', /receiving_status <> 'open'/i],
  ['excess receipts are rejected', /received_quantity \+ v_quantity > v_line\.quantity/i],
  ['only accepted receipt lines may post stock', /disposition[\s\S]*?<> 'accepted'/i],
  ['idempotency payload hashes are compared', /payload_hash[\s\S]*?warehouse_payload_hash/i],
  ['Procurement receives a security-invoker status view', /create or replace view procurement\.v_purchase_order_receipt_status\s+with \(security_invoker\s*=\s*true\)/i],
  ['status view exposes accepted quantity', /accepted_quantity/i],
  ['status view exposes rejected or quarantined quantity', /rejected_or_quarantined_quantity/i],
  ['status view exposes outstanding quantity', /outstanding_quantity/i],
  ['status view exposes the latest Warehouse receipt reference', /latest_warehouse_receipt_reference/i],
  ['status view exposes QC status', /qc_status/i],
  ['policy evidence records review status', /create table if not exists procurement\.policy_evidence[\s\S]*?review_status/i],
  ['legacy Procurement receipt history is archived and reconciled', /alter table procurement\.receipts[\s\S]*?authority_status[\s\S]*?receipt_reconciliations/i],
  ['legacy Procurement receipt writes are revoked', /revoke (?:insert,\s*update,\s*delete|all) on procurement\.receipts from authenticated/i],
  ['temporary clearance requires explicit approval', /conditions->>'approved'\)::boolean\s+is\s+true/i],
  ['one database commitment predicate returns blockers', /create or replace function private\.procurement_commitment_readiness[\s\S]*?blockers/i],
  ['commitment readiness has authoritative submit award and issue stages', /create or replace function private\.procurement_commitment_readiness(?=[\s\S]*?p_phase\s+not in \('submit','award','issue'\))(?=[\s\S]*?p_phase\s*=\s*'submit')(?=[\s\S]*?p_phase\s*=\s*'award')(?=[\s\S]*?p_phase\s*=\s*'issue')/i],
  ['exception packs bind exact vendor route request and version', /exception_pack\.vendor_id\s*=\s*p_vendor_id[\s\S]*?exception_pack\.route_decision_id\s*=\s*v_route\.id[\s\S]*?exception_pack\.request_version\s*=\s*v_route\.request_version/i],
  ['exception pack vendor and route binding is immutable', /create or replace function private\.enforce_exception_pack_binding_immutable[\s\S]*?vendor_id[\s\S]*?route_decision_id[\s\S]*?request_version/i],
  ['policy evidence has governed create review and supersede RPCs', /procurement\.create_policy_evidence[\s\S]*?procurement\.review_policy_evidence[\s\S]*?procurement\.supersede_policy_evidence/i],
  ['financial protections have governed create review and supersede RPCs', /procurement\.create_financial_protection[\s\S]*?procurement\.review_financial_protection[\s\S]*?procurement\.supersede_financial_protection/i],
  ['request submission uses the commitment predicate', /policy_submit_procurement_request[\s\S]*?procurement_commitment_readiness/i],
  ['PO approval uses the commitment predicate', /policy_approve_purchase_order[\s\S]*?procurement_commitment_readiness/i],
  ['PO issue uses the commitment predicate', /policy_issue_purchase_order[\s\S]*?procurement_commitment_readiness/i],
  ['commitment readiness is exposed read-only to the UI', /create or replace function procurement\.commitment_readiness/i],
  ['public readiness enforces capability and request record scope', /procurement\.commitment_readiness[\s\S]*?auth\.uid\(\)\s*<>\s*v_requester_id[\s\S]*?core\.has_cap/i],
  ['goods acceptance reads Warehouse receipts', /policy_record_acceptance_pack[\s\S]*?warehouse\.receipts/i],
  ['goods acceptance validates accepted PO-line quantities', /policy_record_acceptance_pack[\s\S]*?procurement_po_line_id[\s\S]*?accepted/i],
  ['goods acceptance rejects duplicate PO-line ids', /policy_record_acceptance_pack[\s\S]*?group by[\s\S]*?poLineId[\s\S]*?having count\(\*\) > 1/i],
  ['goods acceptance uses grouped QC accepted totals', /policy_record_acceptance_pack[\s\S]*?group by quality\.procurement_po_line_id/i],
  ['goods acceptance is requester or assigned technical reviewer scoped', /policy_record_acceptance_pack[\s\S]*?acceptance_reviewer_assignments/i],
  ['quality inspections preserve procurement PO-line identity', /alter table warehouse\.quality_inspections[\s\S]*?procurement_po_line_id/i],
  ['receipt QC is bound from an ordered transaction-local PO-line queue', /set_config\('warehouse\.procurement_po_line_queue'[\s\S]*?current_setting\('warehouse\.procurement_po_line_queue'/i],
  ['receipt posting rejects any unbound QC row', /quality_inspections[\s\S]*?procurement_po_line_id is null[\s\S]*?raise exception 'Receipt QC could not be bound/i],
  ['ordered receipt status includes open lines only', /ordered_quantity[\s\S]*?receiving_status\s*=\s*'open'/i],
  ['outstanding quantity subtracts accepted quantity only', /ordered_quantity[\s\S]*?-\s*coalesce\(totals\.accepted_quantity,\s*0\)[\s\S]*?outstanding/i],
  ['PO closure is recalculated under the locked PO', /v_closed[\s\S]*?receiving_status\s*=\s*'open'[\s\S]*?update procurement\.purchase_orders/i],
  ['Warehouse has an idempotent exception receipt RPC without stock posting', /create or replace function private\.warehouse_receive_procurement_po_exception[\s\S]*?begin_idempotent_command[\s\S]*?insert into warehouse\.quality_inspections/i],
  ['quality disposition validates the caller PO line belongs to the receipt', /warehouse\.inspect_quality[\s\S]*?procurement_po_line_id[\s\S]*?jsonb_array_elements\(v_receipt\.lines\)/i],
  ['legacy Legal checklist schema converges before accreditation reads', /alter table legal\.requirement_checklist_items[\s\S]*?add column if not exists code[\s\S]*?add column if not exists decision/i],
  ['LGL004 supports foreign branches through exact equivalents', /branch_foreign[\s\S]*?foreign_equivalent/i],
  ['NDA cannot be waived through generic equivalence or not-applicable', /v_code\s*<>\s*'SIGN_NDA'[\s\S]*?foreign_equivalent/i],
  ['technology MNDA uses the earlier expiry trigger', /least\([\s\S]*?definitive_agreement_executed_at/i],
  ['technology MNDA return or destruction dates are recorded', /return_or_destroy_requested[\s\S]*?due_at/i],
  ['business-day calculation is stable and uses an explicit policy timezone', /create or replace function private\.add_business_days[\s\S]*?language plpgsql[\s\S]*?stable[\s\S]*?Asia\/Manila/i],
];

export async function verifyPoReceiptAuthority(migrationUrl) {
  const sql = await readFile(migrationUrl, 'utf8');
  const findings = REQUIRED_CONTRACTS
    .filter(([, pattern]) => !pattern.test(sql))
    .map(([message]) => message);

  const view = sql.match(
    /create or replace view procurement\.v_purchase_order_receipt_status[\s\S]*?;\s*(?:revoke|grant)/i,
  )?.[0] ?? '';
  if (/evidence_urls|storage_path|object_path/i.test(view)) {
    findings.push('Procurement receipt status leaks private Warehouse evidence paths');
  }
  if (/outstanding_quantity[\s\S]*?-\s*coalesce\(totals\.rejected_quantity/i.test(view)) {
    findings.push('Outstanding quantity incorrectly subtracts rejected or quarantined quantities');
  }
  if (/quality\.product_id\s*=\s*receipt_line\.product_id/i.test(view)) {
    findings.push('Receipt disposition joins by product instead of procurement PO-line identity');
  }
  if (/drop (?:table|view) if exists procurement\.receipts/i.test(sql)) findings.push('Legacy Procurement receipt history is destructively dropped');
  if (/grant execute on function private\.(?:vendor_accreditation_readiness|procurement_commitment_readiness|warehouse_receive_procurement_po(?:_exception)?|policy_record_acceptance_pack)\([^)]*\)\s+to authenticated/i.test(sql)) findings.push('Authenticated users can execute private security-definer policy functions');
  if (/grant select on procurement\.v_purchase_order_commitment_readiness\s+to authenticated/i.test(sql)) findings.push('Authenticated users can read the unscoped commitment-readiness view');
  if (/riskFacts,technical|risk_facts,technical/i.test(sql)) {
    findings.push('Generic technical risk is incorrectly treated as the technology-service-provider axis');
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const migrationUrl = new URL(
    '../supabase/migrations/20260714175318_single_po_receipt_authority.sql',
    import.meta.url,
  );
  const findings = await verifyPoReceiptAuthority(migrationUrl);
  if (findings.length) {
    console.error(findings.map((finding) => `- ${finding}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('PO receipt authority contract verified.');
  }
}
