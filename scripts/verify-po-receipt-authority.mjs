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
  ['excess receipt facts reach the controlled exception ledger', /exception_type[\s\S]*?'excess'[\s\S]*?actual_quantity/i],
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
  ['commitment readiness has authoritative submit award and issue stages', /create or replace function private\.procurement_commitment_readiness(?=[\s\S]*?p_phase\s+not in \('submit','award','issue'\))(?=[\s\S]*?p_phase\s*=\s*'submit')(?=[\s\S]*?p_phase\s+in\s*\('award','issue'\))(?=[\s\S]*?p_phase\s*=\s*'issue')/i],
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
  ['goods acceptance uses only explicitly selected accepted QC rows', /policy_record_acceptance_pack[\s\S]*?quality\.id::text in[\s\S]*?quality\.disposition='accepted'/i],
  ['goods acceptance is requester or assigned technical reviewer scoped', /policy_record_acceptance_pack[\s\S]*?acceptance_reviewer_assignments/i],
  ['quality inspections preserve procurement PO-line identity', /alter table warehouse\.quality_inspections[\s\S]*?procurement_po_line_id/i],
  ['receipt QC is bound from an ordered transaction-local PO-line queue', /set_config\('warehouse\.procurement_po_line_queue'[\s\S]*?current_setting\('warehouse\.procurement_po_line_queue'/i],
  ['receipt posting rejects any unbound QC row', /quality_inspections[\s\S]*?procurement_po_line_id is null[\s\S]*?raise exception 'Receipt QC could not be bound/i],
  ['ordered receipt status includes open lines only', /ordered_quantity[\s\S]*?receiving_status\s*=\s*'open'/i],
  ['outstanding quantity subtracts accepted quantity only', /ordered_quantity[\s\S]*?-\s*coalesce\(totals\.accepted_quantity,\s*0\)[\s\S]*?outstanding/i],
  ['PO closure is recalculated under the locked PO', /v_closed[\s\S]*?receiving_status\s*=\s*'open'[\s\S]*?update procurement\.purchase_orders/i],
  ['Warehouse has an idempotent exception receipt RPC without stock posting', /create or replace function private\.warehouse_receive_procurement_po_exception[\s\S]*?begin_idempotent_command[\s\S]*?insert into warehouse\.quality_inspections/i],
  ['exception receipts create a pending controlled decision', /create table if not exists warehouse\.procurement_receipt_exception_decisions[\s\S]*?status text not null default 'pending'[\s\S]*?requested_by uuid/i],
  ['exception receipt QC remains pending until Supervisor decision', /warehouse_receive_procurement_po_exception[\s\S]*?v_disposition\s*:=\s*'pending'[\s\S]*?procurement_receipt_exception_decisions/i],
  ['exception resolution is idempotent and requires a different Supervisor', /warehouse_resolve_procurement_po_exception[\s\S]*?begin_idempotent_command[\s\S]*?release_quality_hold[\s\S]*?resolve_exceptions[\s\S]*?requested_by\s*=\s*auth\.uid\(\)/i],
  ['exception resolution atomically finalizes decision QC receipt and exception', /warehouse_resolve_procurement_po_exception[\s\S]*?for update[\s\S]*?update warehouse\.quality_inspections[\s\S]*?update warehouse\.receipts[\s\S]*?update warehouse\.exceptions[\s\S]*?update warehouse\.procurement_receipt_exception_decisions/i],
  ['exception resolution returns the post-decision receipt state', /warehouse_resolve_procurement_po_exception[\s\S]*?update warehouse\.receipts[\s\S]*?returning \* into v_receipt/i],
  ['private quality inspection is service-role only', /revoke all on function private\.warehouse_inspect_quality\(jsonb\) from public, anon, authenticated[\s\S]*?grant execute on function private\.warehouse_inspect_quality\(jsonb\) to service_role/i],
  ['quality disposition validates the caller PO line belongs to the receipt', /warehouse\.inspect_quality[\s\S]*?procurement_po_line_id[\s\S]*?jsonb_array_elements\(v_receipt\.lines\)/i],
  ['acceptance work items are requester or assigned-reviewer scoped', /procurement\.acceptance_work_items[\s\S]*?requester_id\s*=\s*auth\.uid\(\)[\s\S]*?acceptance_reviewer_assignments/i],
  ['acceptance work items expose no commercial facts', /create or replace function procurement\.acceptance_work_items/i],
  ['later commitment phases include earlier controls', /p_phase in \('award','issue'\)[\s\S]*?RFQ_COMMERCIAL_COMPARISON/i],
  ['commitment readiness and governed mutations share a request lock', /create or replace function private\.lock_procurement_request[\s\S]*?for update[\s\S]*?perform private\.lock_procurement_request/i],
  ['financial-protection waivers require reason basis and evidence', /v_decision\s*=\s*'waived'[\s\S]*?waiver_reason[\s\S]*?waiver_basis[\s\S]*?waiver_evidence_storage_path/i],
  ['readiness retains governed waiver facts', /'waiverReason'[\s\S]*?'waiverBasis'[\s\S]*?'waiverEvidenceStoragePath'/i],
  ['legacy Legal checklist schema converges before accreditation reads', /alter table legal\.requirement_checklist_items[\s\S]*?add column if not exists code[\s\S]*?add column if not exists decision/i],
  ['LGL004 N-A requires an explicit reviewer reason', /decision\s*=\s*'na'[\s\S]*?reviewer_note[\s\S]*?btrim/i],
  ['LGL004 supports foreign branches through exact equivalents', /branch_foreign[\s\S]*?foreign_equivalent/i],
  ['NDA cannot be waived through generic equivalence or not-applicable', /v_code\s*<>\s*'SIGN_NDA'[\s\S]*?foreign_equivalent/i],
  ['technology MNDA uses the earlier expiry trigger', /least\([\s\S]*?definitive_agreement_executed_at/i],
  ['technology MNDA return or destruction dates are recorded', /return_or_destroy_requested[\s\S]*?due_at/i],
  ['business-day calculation is stable and uses an explicit policy timezone', /create or replace function private\.add_business_days[\s\S]*?language plpgsql[\s\S]*?stable[\s\S]*?Asia\/Manila/i],
  ['direct adjust_stock execution is retired in its function body', /create or replace function warehouse\.adjust_stock[\s\S]*?Direct stock adjustment is retired/i],
  ['vendor return requires the authoritative returns capability', /create or replace function private\.warehouse_create_vendor_return[\s\S]*?core\.has_cap\('warehouse',\s*'manage_returns'\)/i],
  ['Finance is removed from the Supervisor approval capability', /delete from core\.role_capabilities[\s\S]*?role\s*=\s*'finance'[\s\S]*?cap\s*=\s*'approve_stock_adjustment'/i],
  ['stock decision separates Supervisor and Finance trusted capabilities', /warehouse_decide_stock_change[\s\S]*?pending_supervisor[\s\S]*?approve_stock_adjustment[\s\S]*?pending_finance[\s\S]*?approve_stock_adjustment_finance/i],
  ['stock approval projection preserves ordered active governed groups', /warehouse_list_stock_change_requests[\s\S]*?current_step[\s\S]*?approval_group\.is_active[\s\S]*?approval_group\.request_status\s*=\s*request\.status[\s\S]*?core\.has_cap\(approval_group\.module,\s*approval_group\.capability\)/i],
  ['manual stock changes create governed requests', /create or replace function private\.warehouse_request_stock_change[\s\S]*?insert into warehouse\.stock_change_requests[\s\S]*?insert into core\.approvals/i],
  ['direct adjust_stock execution is retired', /revoke all on function warehouse\.adjust_stock\(jsonb\) from public, anon, authenticated/i],
  ['locked stock approval applies signed deltas without clamping', /warehouse_decide_stock_change[\s\S]*?for update[\s\S]*?quantity\s*=\s*quantity\+v_request\.quantity_delta[\s\S]*?quantity\+v_request\.quantity_delta>=0/i],
  ['stock decision rejects caller-supplied approval tiers', /warehouse_decide_stock_change[\s\S]*?payload \? 'approval_tier'[\s\S]*?derived from the governed approval step/i],
  ['stock decision requires the locked active approval group capability', /warehouse_decide_stock_change[\s\S]*?v_group\.is_active[\s\S]*?v_group\.request_status<>v_request\.status[\s\S]*?core\.has_cap\(v_group\.module,v_group\.capability\)/i],
  ['receipt exception model covers every governed fact class and outcome', /requested_disposition[\s\S]*?'short'[\s\S]*?'excess'[\s\S]*?'damaged'[\s\S]*?'unidentified'[\s\S]*?decision[\s\S]*?'accept'[\s\S]*?'reject'[\s\S]*?'quarantine'[\s\S]*?'escalate'/i],
  ['quarantine creates active holds in the decision transaction', /warehouse_resolve_procurement_po_exception[\s\S]*?v_outcome='quarantine'[\s\S]*?insert into warehouse\.inventory_holds[\s\S]*?'active'/i],
  ['acceptance quantities bind exact receipt and QC inspection identities', /policy_record_acceptance_pack[\s\S]*?warehouseReceiptId[\s\S]*?qcInspectionIds[\s\S]*?quality\.id[\s\S]*?quality\.source_id=v_receipt_reference/i],
  ['acceptance work item aggregates only its cited accepted receipt', /acceptance_work_items(?=[\s\S]*?accepted_receipt)(?=[\s\S]*?inspection\.source_id\s*=\s*accepted_receipt\.id)(?=[\s\S]*?qcInspectionIds)/i],
  ['serialized manual stock changes are rejected at submission', /warehouse_request_stock_change[\s\S]*?v_product\.serialized[\s\S]*?identified cycle count/i],
  ['stock decisions require canonical status-capability pairs and configured membership', /warehouse_decide_stock_change(?=[\s\S]*?pending_supervisor[\s\S]*?approve_stock_adjustment)(?=[\s\S]*?pending_finance[\s\S]*?approve_stock_adjustment_finance)(?=[\s\S]*?member_roles[\s\S]*?core\.user_roles)/i],
  ['Finance actor must differ from the prior Supervisor actor', /warehouse_decide_stock_change[\s\S]*?pending_finance[\s\S]*?decided_by[\s\S]*?distinct/i],
  ['exception receipt validates caller drift against locked remaining quantity', /warehouse_receive_procurement_po_exception[\s\S]*?quantity\s*-\s*(?:\w+\.)?received_quantity[\s\S]*?v_expected\s*<>\s*v_remaining[\s\S]*?drift/i],
  ['only one active exception decision is allowed per PO line', /create unique index[\s\S]*?procurement_receipt_exception[\s\S]*?po_line_id[\s\S]*?where active/i],
  ['exception decisions revalidate cumulative ordered balance', /warehouse_resolve_procurement_po_exception_v3[\s\S]*?for update[\s\S]*?quantity\s*-\s*(?:\w+\.)?received_quantity[\s\S]*?remaining/i],
  ['quarantine postings are bounded by the locked ordered balance', /warehouse_resolve_procurement_po_exception_v3[\s\S]*?v_postable\s*:=\s*least\(v_actual,v_remaining\)[\s\S]*?update warehouse\.quality_inspections\s+set quantity=v_postable[\s\S]*?inventory_holds/i],
  ['unidentified custody defers product mapping until identification', /unidentified_receipt_custody[\s\S]*?observed_description[\s\S]*?identified_product_id/i],
  ['escalated receipt decisions remain actionable', /warehouse_resolve_procurement_po_exception_v3[\s\S]*?status in \('pending','escalated'\)/i],
  ['active holds reduce server reservation availability', /warehouse\.available_to_promise[\s\S]*?inventory_holds[\s\S]*?status='active'/i],
  ['hold release recalculates the locked PO status', /warehouse_release_quality_hold[\s\S]*?purchase_orders[\s\S]*?for update[\s\S]*?status/i],
  ['accepting a later receipt preserves prior current acceptance evidence', /policy_record_acceptance_pack[\s\S]*?warehouse_receipt_reference[\s\S]*?status='superseded'/i],
  ['approval membership joins the active role catalogue', /warehouse_decide_stock_change[\s\S]*?join core\.roles[\s\S]*?membership\.role[\s\S]*?catalogue_role\.is_active/i],
  ['active approval-group roles block rename or deactivation', /guard_active_approval_group_role[\s\S]*?core\.approval_groups[\s\S]*?member_roles[\s\S]*?cannot be renamed or deactivated/i],
  ['quarantine retains its PO-line claim through final hold disposition', /v_outcome\s*<>\s*'quarantine'[\s\S]*?procurement_receipt_exception_lines[\s\S]*?release_procurement_receipt_line_claim[\s\S]*?set active=false[\s\S]*?warehouse_release_quality_hold[\s\S]*?release_procurement_receipt_line_claim/i],
  ['unidentified mapping reselects the locked PO line with returning', /update procurement\.purchase_order_lines[\s\S]*?warehouse_product_id[\s\S]*?returning \* into v_line/i],
  ['reservation and every hold transition share the ordered product lock', /lock_warehouse_products[\s\S]*?order by product_id[\s\S]*?warehouse\.product:[\s\S]*?lock_inventory_hold_product[\s\S]*?before insert or update of status/i],
  ['physical excess has separate governed custody', /create table if not exists warehouse\.procurement_receipt_excess_custody[\s\S]*?ordered_quantity[\s\S]*?excess_quantity[\s\S]*?resolve_procurement_receipt_excess/i],
  ['payment readiness binds the aggregate active acceptance set', /payment_readiness_packs[\s\S]*?acceptance_pack_ids[\s\S]*?policy_prepare_payment_readiness[\s\S]*?array_agg\(acceptance\.id[\s\S]*?accepted_quantity/i],
  ['public QC wrapper is narrowly privileged while private QC stays denied', /create or replace function warehouse\.inspect_quality[\s\S]*?security definer[\s\S]*?core\.has_cap\('warehouse',\s*'inspect_quality'\)[\s\S]*?private\.warehouse_inspect_quality[\s\S]*?revoke all on function private\.warehouse_inspect_quality\(jsonb\) from public, anon, authenticated/i],
];

export async function verifyPoReceiptAuthority(migrationUrl) {
  const sql = await readFile(migrationUrl, 'utf8');
  const findings = REQUIRED_CONTRACTS
    .filter(([, pattern]) => !pattern.test(sql))
    .map(([message]) => message);
  if (/^\s*\+\s*create\s+or\s+replace\s+function/im.test(sql)) {
    findings.push('Migration contains a stray patch token before CREATE FUNCTION');
  }

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
  const acceptanceProjection = sql.match(
    /create or replace function procurement\.acceptance_work_items[\s\S]*?\$\$;/i,
  )?.[0] ?? '';
  if (/unit_price|vendor_name|core_vendor_id|\btotal\b|estimated_amount/i.test(acceptanceProjection)) {
    findings.push('Acceptance work-item projection leaks commercial facts');
  }
  const adjustStock = sql.match(
    /create or replace function warehouse\.adjust_stock[\s\S]*?\$\$;/i,
  )?.[0] ?? '';
  if (/has_cap\('warehouse',\s*'cycle_count'\)/i.test(adjustStock)) {
    findings.push('Latest adjust_stock still accepts cycle_count instead of approve_stock_adjustment');
  }
  const vendorReturn = sql.match(
    /create or replace function private\.warehouse_create_vendor_return[\s\S]*?\$\$;/i,
  )?.[0] ?? '';
  if (/has_cap\('warehouse',\s*'release_quality_hold'\)/i.test(vendorReturn)) {
    findings.push('Latest vendor-return authority still accepts release_quality_hold instead of manage_returns');
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
