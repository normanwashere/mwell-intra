#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { MERCH_PROJECT, buildSep07MerchFixtures } from './uat-sep07-merch-fixtures.mjs';
import { buildSep08MerchFixtures, SEP08_LOCATION, SEP08_BINS } from './uat-sep08-merch-fixtures.mjs';

const q = value => `'${String(value).replaceAll("'", "''")}'`;
const array = values => `array[${values.map(q).join(',')}]::text[]`;
export function renderSep08MerchSql({ projectRef, mode = 'rehearse' } = {}) {
  if (projectRef !== MERCH_PROJECT) throw new Error('Exact UAT project binding required; production forbidden');
  if (!['apply', 'rehearse'].includes(mode)) throw new Error('Expected apply or rehearse');
  const fixtures = buildSep08MerchFixtures();
  const ids = table => fixtures.find(f => f.table === table).rows.map(r => r.id);
  const poIds = array(ids('purchase_orders')), requestIds = array(ids('requests'));
  const fingerprint = `jsonb_build_object(${fixtures.flatMap(f => [q(`${f.schema}.${f.table}`), `(select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) from ${f.schema}.${f.table} t where not (t.id::text=any(${array(f.rows.map(r => r.id))})))`]).join(',')})`;
  const guardsAndInserts = fixtures.map(f => {
    const table = `${f.schema}.${f.table}`, data = `${q(JSON.stringify(f.rows))}::jsonb`, columns = Object.keys(f.rows[0]).join(', ');
    const identity = f.identity.map(k => `to_jsonb(e)->${q(k)} is distinct from p->${q(k)}`).join(' or ');
    const collision = f.unique.map(k => `(e.${k}::text=p->>${q(k)} and e.id::text<>p->>'id')`).join(' or ');
    return `if exists(select 1 from ${table} e cross join jsonb_array_elements(${data}) p where e.id::text=p->>'id' and (${identity})) then raise exception '${table}: ownership conflict'; end if;
${collision ? `if exists(select 1 from ${table} e cross join jsonb_array_elements(${data}) p where ${collision}) then raise exception '${table}: natural-key collision'; end if;` : ''}
${f.table === 'purchase_order_lines' ? `if exists(select 1 from ${table} e cross join jsonb_array_elements(${data}) p where e.purchase_order_id=p->>'purchase_order_id' and e.line_no=(p->>'line_no')::int and e.id<>p->>'id') then raise exception 'PO line slot collision'; end if;` : ''}
insert into ${table} (${columns}) select ${columns} from jsonb_populate_recordset(null::${table}, ${data}) on conflict(id) do nothing;`;
  });
  const vendors = buildSep07MerchFixtures().find(f => f.table === 'vendors').rows;
  return `-- UAT ONLY ${MERCH_PROJECT}; executor MUST independently verify the selected connection.
-- New VERIFY/TESTER1/TESTER2 identities only. No auth, approvals, policy grants, stock, receipts or resets.
-- VERIFY is disposable workflow input; TESTER1/TESTER2 must remain untouched by automation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table ${fixtures.map(f => `${f.schema}.${f.table}`).join(',')} in share row exclusive mode;
do $seed$
declare before_existing jsonb;
begin
before_existing := ${fingerprint};
${vendors.map(v => `if not exists(select 1 from core.vendors where id=${q(v.id)}::uuid and trade_name=${q(v.trade_name)} and tin=${q(v.tin)}) then raise exception 'Existing Sep7 vendor identity missing/drifted'; end if;`).join('\n')}
if not exists(select 1 from warehouse.locations where id=${q(SEP08_LOCATION)} and type='warehouse' and active) then raise exception 'Expected active UAT warehouse missing'; end if;
if exists(select 1 from procurement.replenishment_recommendations where procurement_request_id=any(${requestIds})) then raise exception 'Existing replenishment linkage: refuse trigger side effects'; end if;
${guardsAndInserts.join('\n')}
if (select count(*) from warehouse.storage_areas where id=any(${array(Object.values(SEP08_BINS))}) and location_id=${q(SEP08_LOCATION)} and active)<>1 then raise exception 'Expected active verification bin missing'; end if;
if (select count(*) from procurement.purchase_orders where id=any(${poIds}))<>6 then raise exception 'Missing scoped POs'; end if;
if exists(select 1 from procurement.purchase_orders po left join procurement.requests req on req.id=po.request_id where po.id=any(${poIds}) and (
req.category is distinct from 'goods' or req.core_vendor_id is distinct from po.core_vendor_id
or jsonb_array_length(po.lines)<>(select count(*) from procurement.purchase_order_lines l where l.purchase_order_id=po.id)
or exists(select 1 from jsonb_array_elements(po.lines) j left join procurement.purchase_order_lines l on l.id=j->>'id' and l.purchase_order_id=po.id where l.id is null or l.warehouse_product_id is distinct from j->>'productId' or l.quantity is distinct from (j->>'quantity')::numeric or l.unit_price is distinct from (j->>'unitPrice')::numeric or l.uom is distinct from j->>'uom')
)) then raise exception 'PO/request/normalized-line coherence failed'; end if;
if before_existing is distinct from ${fingerprint} then raise exception 'Preexisting rows changed: rollback required'; end if;
end $seed$;
select id,po_number,vendor_name,status,expected_date,total,lines from procurement.purchase_orders where id=any(${poIds}) order by id;
${mode === 'apply' ? 'commit;' : 'rollback;'}
`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = renderSep08MerchSql({ projectRef: process.env.SUPABASE_PROJECT_REF, mode: process.argv.includes('--apply') ? 'apply' : 'rehearse' });
  const i = process.argv.indexOf('--out');
  if (i === -1) process.stdout.write(sql);
  else { if (!process.argv[i + 1]) throw new Error('--out requires path'); writeFileSync(process.argv[i + 1], sql, { flag: 'wx' }); }
}
