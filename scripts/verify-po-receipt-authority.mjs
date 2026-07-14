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
