import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const policy = read('20260822110000_mpic_procurement_policy_alignment');
const sep = read('20260905090000_procurement_remediation');
const receipt = read('20260714175318_single_po_receipt_authority');
const forward = read('20260905203452_allow_fully_received_po_payment_evidence');
function fn(sql, name) {
  const start = sql.lastIndexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  const body = sql.indexOf('$$', start);
  return sql.slice(start, sql.indexOf('$$;', body + 2) + 3);
}
const actor = '00000000-0000-0000-0000-000000000001';
const vendor = '00000000-0000-0000-0000-000000000002';
const finance = '00000000-0000-0000-0000-000000000003';
const foreignActor = '00000000-0000-0000-0000-000000000004';
const profile = '00000000-0000-0000-0000-000000000005';
const rpc = async (db, name, payload) => (await db.query(`select ${name}($1::jsonb) result`, [JSON.stringify(payload)])).rows[0].result;
async function fixture(apply = true) {
  const db = new PGlite();
  try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema procurement; create schema private; create schema legal; create schema storage;
    grant usage on schema auth,core,procurement,private to authenticated,anon,service_role;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('email','qa@example.test') $$;
    create table core.test_capabilities(actor uuid, module text, cap text);
    create function core.has_live_cap(text,text) returns boolean language sql security definer as $$ select exists(select 1 from core.test_capabilities where actor=auth.uid() and module=$1 and cap=$2) $$;
    create function core.is_vendor() returns boolean language sql as $$ select coalesce(current_setting('test.vendor',true),'false')='true' $$;
    insert into core.test_capabilities values('${actor}','procurement','author_po'),('${finance}','procurement','view_finance');
    create table core.vendors(id uuid primary key,accreditation_status text,accreditation_expires_at date);
    create table procurement.policy_profiles(id uuid primary key,relationship text,status text,effective_from timestamptz,effective_to timestamptz,po_invoice_threshold numeric);
    create table procurement.requests(id text primary key,category text,estimated_amount numeric,policy_profile_id uuid);
    create table procurement.purchase_orders(id text primary key,request_id text references procurement.requests,status text not null,total numeric,core_vendor_id uuid,acceptance_evidence_version integer default 0,updated_at timestamptz);
    create table procurement.purchase_order_lines(id text primary key,purchase_order_id text references procurement.purchase_orders,quantity numeric,received_quantity numeric default 0,receiving_status text default 'open',unit_price numeric);
    create table legal.accreditation_cases(vendor_id uuid,jurisdiction text);
    create table legal.vendor_eligibility_decisions(id uuid,vendor_id uuid,status text,effective_at timestamptz,expires_at timestamptz,decided_at timestamptz,revision integer);
    create table legal.vendor_temporary_clearances(id uuid,vendor_id uuid,status text,effective_at timestamptz,expires_at timestamptz,request_id text,scope text,amount_limit numeric,decided_at timestamptz,revision integer);
    create table procurement.acceptance_packs(id uuid primary key default gen_random_uuid(),purchase_order_id text references procurement.purchase_orders,acceptance_type text default 'goods_receipt',status text,accepted_at timestamptz default now(),accepted_scope jsonb,accepted_amount numeric,exceptions jsonb default '[]');
    create table procurement.request_attachments(id text primary key,request_id text references procurement.requests,filename text,mime_type text check(mime_type in ('application/pdf','image/png','image/jpeg','image/webp')),size_bytes bigint check(size_bytes>0 and size_bytes<=10485760),storage_path text unique,sha256 text check(sha256~'^[0-9a-f]{64}$'),kind text,uploaded_by uuid,uploaded_by_email text,payment_po_id text references procurement.purchase_orders,payment_vendor_id uuid,payment_purpose text,payment_evidence_version integer);
    create table storage.objects(bucket_id text,name text,owner_id text,primary key(bucket_id,name));
    create table procurement.payment_readiness_packs(id uuid primary key default gen_random_uuid(),purchase_order_id text references procurement.purchase_orders,acceptance_pack_id uuid,acceptance_pack_ids uuid[],accepted_quantity numeric,acceptance_evidence_version integer,policy_version text,po_match boolean,invoice_or_si_storage_path text,milestone_support_storage_path text,tax_withholding_support_storage_path text,foreign_vendor_evidence_storage_path text,invoice_number text,invoice_date date,due_date date,invoice_amount numeric,tax_amount numeric,withholding_amount numeric,purchase_order_amount numeric,accepted_amount numeric,variance_amount numeric,status text,corrected_from uuid,evidence_stale boolean default false,evidence_stale_at timestamptz,released_amount numeric default 0,prepared_at timestamptz default now(),document_ids jsonb,finance_reviewed_by uuid,finance_reviewed_at timestamptz,finance_note text);
    create table procurement.vendor_invoice_identities(vendor_id uuid,invoice_identity text,current_pack_id uuid references procurement.payment_readiness_packs,primary key(vendor_id,invoice_identity));
    create table procurement.payment_releases(id uuid primary key default gen_random_uuid(),payment_readiness_pack_id uuid references procurement.payment_readiness_packs,purchase_order_id text,amount numeric,payment_reference text,payment_method text,paid_at date,status text default 'posted');
    create table procurement.payment_readiness_staleness_events(payment_readiness_pack_id uuid,purchase_order_id text,prior_status text,prior_acceptance_evidence_version integer,acceptance_evidence_version integer,reason text,unique(payment_readiness_pack_id,acceptance_evidence_version));
    insert into core.vendors values('${vendor}','approved',current_date+365);
    insert into procurement.policy_profiles values('${profile}','mwell_operating','active',now()-interval '1 day',null,200);
    insert into procurement.requests values('req_payment_12345678','goods',300,'${profile}'),('req_other_12345678','goods',300,'${profile}');
    insert into procurement.purchase_orders(id,request_id,status,total,core_vendor_id) values('po1','req_payment_12345678','issued',300,'${vendor}');
    insert into procurement.purchase_order_lines(id,purchase_order_id,quantity,unit_price) values('line1','po1',1,100),('line2','po1',2,100);`);
  for (const name of ['private.policy_request_vendor_eligibility_projection','private.policy_assert_request_vendor_eligible','private.policy_payment_evidence_blockers','private.policy_prepare_invoice_payment_readiness','procurement.prepare_invoice_payment_readiness','private.policy_assert_payment_pack_current','procurement.review_payment_readiness','procurement.release_payment']) await db.exec(fn(policy, name));
  await db.exec('alter function private.policy_prepare_invoice_payment_readiness(jsonb) rename to policy_prepare_invoice_payment_readiness_pre_sep05;');
  for (const name of ['procurement.register_payment_document','private.policy_prepare_invoice_payment_readiness','procurement.prepare_payment_readiness']) await db.exec(fn(sep, name));
  const valueSql = read('20260804171000_acceptance_value_derivation');
  await db.exec(fn(valueSql, 'private.derive_procurement_acceptance_value'));
  const invalidationSql = read('20260717143000_task3_receipt_authority_forward_convergence');
  await db.exec(fn(invalidationSql, 'private.invalidate_payment_readiness_for_acceptance_change'));
  await db.exec(`create trigger derive_value before insert or update of accepted_scope,accepted_amount on procurement.acceptance_packs for each row execute function private.derive_procurement_acceptance_value();
    create trigger invalidate after insert or delete or update of status,accepted_scope,exceptions on procurement.acceptance_packs for each row execute function private.invalidate_payment_readiness_for_acceptance_change();
    revoke all on all functions in schema private from public,anon,authenticated,service_role;
    revoke all on all functions in schema procurement from public,anon,service_role;
    grant execute on all functions in schema procurement to authenticated;
    set test.uid='${actor}';`);
  const start = receipt.indexOf('  select not exists (\n', receipt.indexOf("perform set_config('warehouse.procurement_po_line_queue', '[]', true)"));
  const end = receipt.indexOf('returning * into v_po;', start) + 'returning * into v_po;'.length;
  await db.exec(`do $$ declare v_po procurement.purchase_orders; v_closed boolean; begin
    select * into v_po from procurement.purchase_orders where id='po1';
    update procurement.purchase_order_lines set received_quantity=quantity where purchase_order_id=v_po.id;
    ${receipt.slice(start,end)} end $$;`);
  if (apply) await db.exec(forward);
  return db;
  } catch (error) { await db.close(); throw error; }
}
async function accept(db) {
  for (const [id, quantity] of [['line1',1],['line2',2]]) await db.query("insert into procurement.acceptance_packs(purchase_order_id,status,accepted_scope) values('po1','accepted',$1::jsonb)", [JSON.stringify({ lines: [{ poLineId:id, quantity }] })]);
}
async function documents(db, suffix = '') {
  const payload = { purchase_order_id:'po1',invoice_number:`INV-${suffix || 'A'}`,invoice_date:'2026-09-06',invoice_amount:300,tax_amount:0,withholding_amount:0 };
  const fields = { invoice:'invoice_or_si_storage_path',acceptance:'milestone_support_storage_path',tax:'tax_withholding_support_storage_path' };
  for (const [purpose, field] of Object.entries(fields)) {
    const id = `att_${purpose}${suffix}`;
    const storage_path = `request/req_payment_12345678/${id}.pdf`;
    await db.query('insert into storage.objects values($1,$2,$3)', ['procurement-requests',storage_path,actor]);
    const document = await rpc(db,'procurement.register_payment_document',{ purchase_order_id:'po1',purpose,attachment:{ id,storage_path,filename:`${id}.pdf`,mime_type:'application/pdf',size_bytes:100,sha256:'a'.repeat(64) } });
    assert.equal(document.uploaded_by,actor);
    payload[field] = document.id;
  }
  return payload;
}
test('fully received closed PO registers real SQL documents, binds exact acceptances and releases only after Finance review', async () => {
  const db = await fixture();
  try {
    assert.equal((await db.query("select status from procurement.purchase_orders where id='po1'")).rows[0].status,'closed');
    await accept(db);
    const payload = await documents(db);
    const pack = await rpc(db,'procurement.prepare_invoice_payment_readiness',payload);
    assert.equal(pack.accepted_quantity,3);
    assert.equal(pack.acceptance_pack_ids.length,2);
    assert.equal(pack.acceptance_evidence_version,2);
    assert.equal(pack.accepted_amount,300);
    assert.equal(Object.keys(pack.document_ids).length,3);
    await db.exec(`set test.uid='${finance}'`);
    await assert.rejects(rpc(db,'procurement.release_payment',{ payment_readiness_pack_id:pack.id,amount:300,payment_reference:'PAY1',paid_at:'2026-09-06' }),/Finance acceptance/);
    await rpc(db,'procurement.review_payment_readiness',{ id:pack.id,status:'accepted' });
    const paid = await rpc(db,'procurement.release_payment',{ payment_readiness_pack_id:pack.id,amount:300,payment_reference:'PAY1',paid_at:'2026-09-06' });
    assert.equal(paid.pack.status,'released');
    await assert.rejects(rpc(db,'procurement.release_payment',{ payment_readiness_pack_id:pack.id,amount:300,payment_reference:'PAY1',paid_at:'2026-09-06' }),/Finance acceptance|unpaid/);
  } finally { await db.close(); }
});

async function isolated(db, work) {
  await db.exec('begin');
  try { await work(); } finally { await db.exec('rollback'); }
}

test('draft, approved, cancelled, missing PO, unauthenticated, vendor and wrong actors cannot register or prepare', async () => {
  const db = await fixture();
  try {
    await accept(db);
    const payload = await documents(db);
    const attachment = { id:'att_probe',storage_path:'request/req_payment_12345678/probe.pdf',filename:'probe.pdf',mime_type:'application/pdf',size_bytes:100,sha256:'b'.repeat(64) };
    await db.query('insert into storage.objects values($1,$2,$3)', ['procurement-requests',attachment.storage_path,actor]);
    for (const status of ['draft','pending_approval','approved','cancelled']) await isolated(db, async () => {
      await db.query("update procurement.purchase_orders set status=$1 where id='po1'",[status]);
      // Each failing statement needs its own transaction in PostgreSQL.
      await db.exec('savepoint probe');
      await assert.rejects(rpc(db,'procurement.register_payment_document',{ purchase_order_id:'po1',purpose:'invoice',attachment }),/Issued purchase order/);
      await db.exec('rollback to probe');
      await assert.rejects(rpc(db,'procurement.prepare_payment_readiness',payload),/issued purchase order/);
    });
    await assert.rejects(rpc(db,'procurement.register_payment_document',{ purchase_order_id:'missing',purpose:'invoice',attachment }),/Issued purchase order/);
    await assert.rejects(rpc(db,'procurement.prepare_payment_readiness',{ ...payload,purchase_order_id:'missing' }),/Vendor-bound/);
    for (const uid of ['',foreignActor,finance]) {
      await db.query("select set_config('test.uid',$1,false)",[uid]);
      await assert.rejects(rpc(db,'procurement.register_payment_document',{ purchase_order_id:'po1',purpose:'invoice',attachment }),/authority/);
      await assert.rejects(rpc(db,'procurement.prepare_payment_readiness',payload),/authority/);
    }
    await db.exec(`set test.uid='${actor}'; set test.vendor='true'`);
    await assert.rejects(rpc(db,'procurement.register_payment_document',{ purchase_order_id:'po1',purpose:'invoice',attachment }),/authority/);
    await assert.rejects(rpc(db,'procurement.prepare_payment_readiness',payload),/authority/);
  } finally { await db.close(); }
});

test('SQL registration enforces owner, bucket, actual request lineage, document purpose and metadata constraints', async () => {
  const db = await fixture();
  try {
    const attachment = { id:'att_probe',storage_path:'request/req_payment_12345678/probe.pdf',filename:'probe.pdf',mime_type:'application/pdf',size_bytes:100,sha256:'b'.repeat(64) };
    const register = overrides => rpc(db,'procurement.register_payment_document',{ purchase_order_id:'po1',purpose:'invoice',attachment,...overrides });
    await assert.rejects(register(),/not found or not owned/);
    for (const [bucket,path,owner] of [['procurement-requests',attachment.storage_path,foreignActor],['other',attachment.storage_path,actor],['procurement-requests','request/req_other_12345678/probe.pdf',actor]]) await isolated(db, async () => {
      await db.query('insert into storage.objects values($1,$2,$3)',[bucket,path,owner]);
      await assert.rejects(register({ attachment:{ ...attachment,storage_path:path } }),/not found or not owned/);
    });
    await db.query('insert into storage.objects values($1,$2,$3)', ['procurement-requests',attachment.storage_path,actor]);
    await assert.rejects(register({ purpose:'arbitrary' }),/purpose/);
    for (const invalid of [{ sha256:'fake' },{ size_bytes:0 },{ mime_type:'text/html' }])
      await assert.rejects(register({ attachment:{ ...attachment,...invalid } }),/check constraint/);
    const row = await register();
    assert.equal(row.request_id,'req_payment_12345678');
    assert.equal(row.payment_vendor_id,vendor);
  } finally { await db.close(); }
});

test('readiness preserves acceptance, vendor scope, profile, amount, tax and exact document version checks', async () => {
  const db = await fixture();
  try {
    // Register before acceptance to prove acceptance changes invalidate documents.
    const before = await documents(db,'before');
    await assert.rejects(rpc(db,'procurement.prepare_payment_readiness',before),/acceptance evidence/);
    await accept(db);
    await assert.rejects(rpc(db,'procurement.prepare_payment_readiness',before),/current uploaded/);
    const payload = await documents(db);
    for (const [update,pattern] of [
      ["update core.vendors set accreditation_status='rejected'",/vendor eligibility/],
      ["update core.vendors set accreditation_expires_at=current_date-1",/vendor eligibility/],
      ["update procurement.policy_profiles set status='inactive'",/active policy profile/],
      ["update procurement.acceptance_packs set status='accepted_with_exceptions'",/current uploaded|acceptance evidence/],
      ["update procurement.request_attachments set payment_vendor_id='00000000-0000-0000-0000-000000000009' where payment_purpose='invoice'",/current uploaded invoice/],
      ["update procurement.request_attachments set payment_po_id=null where payment_purpose='invoice'",/current uploaded invoice/],
      ["update procurement.request_attachments set payment_purpose='foreign' where payment_purpose='invoice'",/current uploaded invoice/],
      ["delete from storage.objects where name like '%att_invoice.pdf'",/current uploaded invoice/],
    ]) await isolated(db, async () => { await db.exec(update); await assert.rejects(rpc(db,'procurement.prepare_payment_readiness',payload),pattern); });
    for (const invalid of [{ invoice_amount:301 },{ invoice_amount:0 },{ tax_amount:-1 },{ tax_amount:301 },{ withholding_amount:-1 },{ invoice_number:'' }])
      await assert.rejects(rpc(db,'procurement.prepare_payment_readiness',{ ...payload,...invalid }),/amount|tax|invoice/i);
    await assert.rejects(rpc(db,'procurement.prepare_payment_readiness',{ ...payload,invoice_or_si_storage_path:'https://fake.test/invoice.pdf' }),/current uploaded/);
    const pack = await rpc(db,'procurement.prepare_payment_readiness',payload);
    assert.equal(pack.accepted_quantity,3);
    await assert.rejects(rpc(db,'procurement.prepare_invoice_payment_readiness',{ ...payload,invoice_number:payload.invoice_number.toLowerCase() }),/Duplicate vendor invoice/);
    await db.exec(`set test.uid='${finance}'`);
    await rpc(db,'procurement.review_payment_readiness',{ id:pack.id,status:'accepted' });
    await assert.rejects(rpc(db,'procurement.release_payment',{ payment_readiness_pack_id:pack.id,amount:301,payment_reference:'PAY',paid_at:'2026-09-06' }),/unpaid invoice/);
    await assert.rejects(rpc(db,'procurement.release_payment',{ payment_readiness_pack_id:pack.id,amount:100,payment_reference:'',paid_at:'2026-09-06' }),/reference and date/);
    await db.exec(`set test.uid='${actor}'`);
    await assert.rejects(rpc(db,'procurement.release_payment',{ payment_readiness_pack_id:pack.id,amount:100,payment_reference:'PAY',paid_at:'2026-09-06' }),/Not authorized/);
    await assert.rejects(rpc(db,'procurement.review_payment_readiness',{ id:pack.id,status:'accepted' }),/Not authorized/);
  } finally { await db.close(); }
});

test('finalized acceptance changes preserve stale history and prevent Finance reuse', async () => {
  const db = await fixture();
  try {
    await accept(db);
    const pack = await rpc(db,'procurement.prepare_payment_readiness',await documents(db));
    await db.exec(`set test.uid='${finance}'`);
    await rpc(db,'procurement.review_payment_readiness',{ id:pack.id,status:'accepted' });
    await db.exec("update procurement.acceptance_packs set status='superseded' where accepted_scope->'lines'->0->>'poLineId'='line2'");
    await assert.rejects(rpc(db,'procurement.release_payment',{ payment_readiness_pack_id:pack.id,amount:100,payment_reference:'PAY',paid_at:'2026-09-06' }),/stale/);
    await assert.rejects(rpc(db,'procurement.review_payment_readiness',{ id:pack.id,status:'accepted' }),/stale/);
    const row = (await db.query('select status,evidence_stale,acceptance_pack_ids,acceptance_evidence_version,accepted_quantity from procurement.payment_readiness_packs where id=$1',[pack.id])).rows[0];
    assert.deepEqual(row,{ status:'accepted',evidence_stale:true,acceptance_pack_ids:pack.acceptance_pack_ids,acceptance_evidence_version:pack.acceptance_evidence_version,accepted_quantity:'3' });
    assert.equal((await db.query('select count(*)::int n from procurement.payment_readiness_staleness_events')).rows[0].n,1);
  } finally { await db.close(); }
});

test('quantity sums each selected pack line once and excludes superseded and other-PO evidence', async () => {
  const db = await fixture();
  try {
    await accept(db);
    await db.exec(`insert into procurement.acceptance_packs(purchase_order_id,status,accepted_scope)
      values('po1','superseded','{"lines":[{"poLineId":"line1","quantity":99}]}');
      insert into procurement.purchase_orders(id,request_id,status,total,core_vendor_id)
      values('po2','req_other_12345678','closed',900,'${vendor}');
      insert into procurement.acceptance_packs(purchase_order_id,status,accepted_scope)
      values('po2','accepted','{"lines":[{"poLineId":"other","quantity":99}]}');`);
    const expected = (await db.query("select id from procurement.acceptance_packs where purchase_order_id='po1' and status='accepted' order by accepted_at,id")).rows.map(row => row.id);
    const pack = await rpc(db,'procurement.prepare_payment_readiness',await documents(db));
    assert.deepEqual(pack.acceptance_pack_ids,expected);
    assert.equal(pack.accepted_quantity,3);
    assert.equal(pack.accepted_amount,300);
    assert.equal(pack.acceptance_evidence_version,(await db.query("select acceptance_evidence_version from procurement.purchase_orders where id='po1'")).rows[0].acceptance_evidence_version);
  } finally { await db.close(); }
});

test('actual acceptance SQL rejects over-QC quantities and duplicate lines before evidence can enter payment', async () => {
  const db = await fixture();
  try {
    await db.exec(`create schema warehouse;
      alter table procurement.requests add column requester_id uuid default '${actor}';
      create table procurement.acceptance_reviewer_assignments(request_id text,reviewer_id uuid,superseded_at timestamptz);
      create table warehouse.receipts(id text,procurement_po_id text);
      create table warehouse.quality_inspections(id text,source_id text,source_type text,procurement_po_line_id text,disposition text,quantity numeric);
      insert into warehouse.receipts values('receipt1','po1');
      insert into warehouse.quality_inspections values('qc1','receipt1','receipt','line1','accepted',1);`);
    await db.exec(fn(receipt,'private.policy_record_acceptance_pack'));
    await db.exec(fn(receipt,'procurement.record_acceptance_pack'));
    const line = { poLineId:'line1',quantity:2,warehouseReceiptId:'receipt1',qcInspectionIds:['qc1'] };
    const payload = { purchase_order_id:'po1',acceptance_type:'goods',warehouse_receipt_reference:'receipt1',accepted_scope:{ lines:[line] } };
    await assert.rejects(rpc(db,'procurement.record_acceptance_pack',payload),/exceeds Warehouse QC-accepted quantity/);
    await assert.rejects(rpc(db,'procurement.record_acceptance_pack',{ ...payload,accepted_scope:{ lines:[{ ...line,quantity:1 },{ ...line,quantity:1 }] } }),/duplicate PO-line/);
    assert.equal((await db.query('select count(*)::int n from procurement.acceptance_packs')).rows[0].n,0);
  } finally { await db.close(); }
});

test('unexpected installed definition drift aborts all prior status patches atomically', async () => {
  const db = await fixture(false);
  try {
    const signature = 'private.policy_payment_evidence_blockers(procurement.purchase_orders,procurement.requests,jsonb)';
    const definition = (await db.query('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
    await db.exec(definition.replace("p_po.status <> 'issued'","p_po.status != 'issued'"));
    const before = (await db.query("select pg_get_functiondef('procurement.register_payment_document(jsonb)'::regprocedure) definition")).rows[0].definition;
    await assert.rejects(db.exec(forward),/Payment function changed; review before applying/);
    assert.equal((await db.query("select pg_get_functiondef('procurement.register_payment_document(jsonb)'::regprocedure) definition")).rows[0].definition,before);
  } finally { await db.close(); }
});

test('forward correction preserves function identity, RBAC, private denial and surrounding financial definitions', async () => {
  const db = await fixture(false);
  const snapshot = async () => (await db.query("select p.oid,p.oid::regprocedure::text signature,p.proacl::text acl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','procurement') order by p.oid")).rows;
  try {
    const before = await snapshot();
    await db.exec(forward);
    const after = await snapshot();
    const changed = [];
    for (let i=0;i<before.length;i++) {
      const { definition:prior,...metadata } = before[i];
      const { definition:current,...nextMetadata } = after[i];
      assert.deepEqual(metadata,nextMetadata);
      if (prior!==current) changed.push(metadata.signature);
    }
    assert.deepEqual(changed.sort(),['private.policy_payment_evidence_blockers(procurement.purchase_orders,procurement.requests,jsonb)','private.policy_prepare_invoice_payment_readiness_pre_sep05(jsonb)','procurement.register_payment_document(jsonb)'].sort());
    await db.exec('set role authenticated');
    await assert.rejects(rpc(db,'private.policy_prepare_invoice_payment_readiness_pre_sep05',{}),/permission denied/);
    await db.exec('reset role; set role service_role');
    await assert.rejects(rpc(db,'procurement.register_payment_document',{}),/permission denied/);
    await db.exec('reset role; set role anon');
    await assert.rejects(rpc(db,'procurement.prepare_payment_readiness',{}),/permission denied/);
  } finally { await db.close(); }
});
