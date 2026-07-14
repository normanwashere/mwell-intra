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
  ['temporary clearance requires explicit approval', /conditions->>'approved'\)::boolean\s+is\s+true/i],
  ['one database commitment predicate returns blockers', /create or replace function private\.procurement_commitment_readiness[\s\S]*?blockers/i],
  ['request submission uses the commitment predicate', /policy_submit_procurement_request[\s\S]*?procurement_commitment_readiness/i],
  ['PO approval uses the commitment predicate', /policy_approve_purchase_order[\s\S]*?procurement_commitment_readiness/i],
  ['PO issue uses the commitment predicate', /policy_issue_purchase_order[\s\S]*?procurement_commitment_readiness/i],
  ['commitment readiness is exposed read-only to the UI', /create or replace function procurement\.commitment_readiness/i],
  ['goods acceptance reads Warehouse receipts', /policy_record_acceptance_pack[\s\S]*?warehouse\.receipts/i],
  ['goods acceptance validates accepted PO-line quantities', /policy_record_acceptance_pack[\s\S]*?procurement_po_line_id[\s\S]*?accepted/i],
  ['legacy Procurement receipt projection is retired', /drop (?:table|view) if exists procurement\.receipts/i],
  ['quality inspections preserve procurement PO-line identity', /alter table warehouse\.quality_inspections[\s\S]*?procurement_po_line_id/i],
  ['receipt QC is bound from an ordered transaction-local PO-line queue', /set_config\('warehouse\.procurement_po_line_queue'[\s\S]*?current_setting\('warehouse\.procurement_po_line_queue'/i],
  ['receipt posting rejects any unbound QC row', /quality_inspections[\s\S]*?procurement_po_line_id is null[\s\S]*?raise exception 'Receipt QC could not be bound/i],
  ['ordered receipt status includes open lines only', /ordered_quantity[\s\S]*?receiving_status\s*=\s*'open'/i],
  ['outstanding quantity subtracts accepted quantity only', /ordered_quantity[\s\S]*?-\s*coalesce\(totals\.accepted_quantity,\s*0\)[\s\S]*?outstanding/i],
  ['PO closure is recalculated under the locked PO', /v_closed[\s\S]*?receiving_status\s*=\s*'open'[\s\S]*?update procurement\.purchase_orders/i],
  ['technology MNDA uses the earlier expiry trigger', /least\([\s\S]*?definitive_agreement_executed_at/i],
  ['technology MNDA return or destruction dates are recorded', /return_or_destroy_requested[\s\S]*?due_at/i],
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
