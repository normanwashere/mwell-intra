#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { buildSep07MerchFixtures, MERCH_PROJECT } from './uat-sep07-merch-fixtures.mjs';

const q = value => `'${String(value).replaceAll("'", "''")}'`;
export function verifySep07MerchSql() {
  return `do $verify$ begin
 if (select count(*) from procurement.purchase_orders where id in ('UAT-SEP07-PO-0005','UAT-SEP07-PO-0006')) <> 2 then raise exception 'Missing scoped POs'; end if;
 if exists (
 select 1 from procurement.purchase_orders po left join procurement.requests req on req.id=po.request_id
 where po.id in ('UAT-SEP07-PO-0005','UAT-SEP07-PO-0006') and (
 req.category is distinct from 'goods' or req.core_vendor_id is distinct from po.core_vendor_id
 or jsonb_array_length(po.lines) <> (select count(*) from procurement.purchase_order_lines l where l.purchase_order_id=po.id)
 or exists (select 1 from jsonb_array_elements(po.lines) j left join procurement.purchase_order_lines l on l.id=j->>'id' and l.purchase_order_id=po.id
 where l.id is null or l.warehouse_product_id is distinct from j->>'productId' or l.quantity is distinct from (j->>'quantity')::numeric or l.unit_price is distinct from (j->>'unitPrice')::numeric or l.uom is distinct from j->>'uom')
 )) then raise exception 'PO/request/normalized-line coherence failed'; end if;
 end $verify$;`;
}
export function renderSep07MerchSql({ projectRef, mode = 'rehearse' } = {}) {
  if (projectRef !== MERCH_PROJECT) throw new Error('Exact UAT project binding required; production forbidden');
  if (!['rehearse', 'apply'].includes(mode)) throw new Error('Expected rehearse or apply');
  const fixtures = buildSep07MerchFixtures();
  const statements = fixtures.map(f => {
    const table = `${f.schema}.${f.table}`, data = `${q(JSON.stringify(f.rows))}::jsonb`;
    const columns = Object.keys(f.rows[0]).join(', ');
    const identity = f.identity.map(k => `to_jsonb(existing)->${q(k)} is distinct from proposed->${q(k)}`).join(' or ');
    const collision = f.unique.map(k => `(existing.${k}::text = proposed->>${q(k)} and existing.id::text <> proposed->>'id')`).join(' or ');
    return `do $guard$ begin
 if exists (select 1 from ${table} existing cross join jsonb_array_elements(${data}) proposed where existing.id::text = proposed->>'id' and (${identity})) then raise exception '${table}: fixture ownership/identity conflict'; end if;
 ${collision ? `if exists (select 1 from ${table} existing cross join jsonb_array_elements(${data}) proposed where ${collision}) then raise exception '${table}: natural-key collision'; end if;` : ''}
 ${f.table === 'purchase_order_lines' ? `if exists (select 1 from ${table} existing cross join jsonb_array_elements(${data}) proposed where existing.purchase_order_id::text=proposed->>'purchase_order_id' and existing.line_no=(proposed->>'line_no')::int and existing.id::text<>proposed->>'id') then raise exception 'PO line slot collision'; end if;` : ''}
 end $guard$;
 insert into ${table} (${columns}) select ${columns} from jsonb_populate_recordset(null::${table}, ${data}) on conflict (id) do nothing;`;
  });
  return [
    `-- UAT ONLY ${MERCH_PROJECT}. Renderer does not connect. Executor MUST independently verify selected project.
-- Synthetic issued setup, NOT human approval: no approval attribution, receipts, inventory, grants or resets.
-- Default rollback rehearsal. Costs: jacket PHP500/unit, tumbler PHP150/unit; synthetic placeholders.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';`,
    `lock table ${fixtures.map(f => `${f.schema}.${f.table}`).join(', ')} in share row exclusive mode;`,
    `do $side_effect_guard$ begin
 if exists (select 1 from procurement.replenishment_recommendations where procurement_request_id in ('UAT-SEP07-REQ-0005','UAT-SEP07-REQ-0006')) then raise exception 'Existing replenishment linkage: refuse fixture trigger side effects'; end if;
 end $side_effect_guard$;`,
    ...statements,
    verifySep07MerchSql(),
    `select po.id, po.status, po.total, po.lines from procurement.purchase_orders po where po.id in ('UAT-SEP07-PO-0005','UAT-SEP07-PO-0006') order by po.id;`,
    mode === 'apply' ? 'commit;' : 'rollback;',
  ].join('\n\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = renderSep07MerchSql({ projectRef: process.env.SUPABASE_PROJECT_REF, mode: process.argv.includes('--apply') ? 'apply' : 'rehearse' });
  const outputIndex = process.argv.indexOf('--out');
  if (outputIndex !== -1) {
    if (!process.argv[outputIndex + 1]) throw new Error('--out requires a file path');
    writeFileSync(process.argv[outputIndex + 1], sql, { flag: 'wx' });
  } else process.stdout.write(sql);
}
