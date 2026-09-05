import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const sql = readFileSync('supabase/migrations/20260905090000_procurement_remediation.sql','utf8');
const actor='00000000-0000-0000-0000-000000000001';
const vendor='00000000-0000-0000-0000-000000000002';
const other='00000000-0000-0000-0000-000000000003';
async function fixture() {
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema procurement; create schema private; create schema core; create schema auth; create schema legal; create schema storage;
    create function auth.uid() returns uuid language sql as $$ select '${actor}'::uuid $$;
    create function auth.jwt() returns jsonb language sql as $$ select '{"email":"reviewer@example.test"}'::jsonb $$;
    create function core.is_vendor() returns boolean language sql as $$ select false $$;
    create function core.current_vendor_id() returns uuid language sql as $$ select '${vendor}'::uuid $$;
    create function core.has_live_cap(text,text) returns boolean language sql as $$ select true $$;
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz default now(),expires_at timestamptz);
    create table core.profiles(id uuid,status text);
    create table core.roles(module text,role text,is_active boolean);
    create table core.role_capabilities(module text,role text,cap text);
    insert into core.profiles values('${actor}','active');
    insert into core.roles values('legal','legal_reviewer',true);
    insert into core.role_capabilities values('legal','legal_reviewer','review_accreditation');
    insert into core.user_roles(user_id,module,role) values('${actor}','legal','legal_reviewer');
    create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    create table core.vendors(id uuid primary key,legal_name text);
    insert into core.vendors values('${vendor}','Vendor');
    create table procurement.requests(id text primary key,requester_id uuid,status text,title text,lines jsonb,justification jsonb,attachments jsonb,estimated_amount numeric,core_vendor_id uuid,vendor_name text,route_version integer,compliance jsonb,route_confirmed_at timestamptz,route_confirmed_by uuid,decided_at timestamptz,decided_by_email text,decision_note text,submitted_at timestamptz,updated_at timestamptz,solicitation_requirements jsonb);
    create table procurement.approval_steps(id text primary key,request_id text,status text,step_order integer,assigned_user_id uuid,tier text);
    create table procurement.exception_packs(request_id text,status text,final_approval_step_id text references procurement.approval_steps(id) on delete restrict);
    create table procurement.sourcing_events(request_id text,status text);
    create table procurement.route_decisions(request_id text,status text);
    create table procurement.purchase_orders(id text primary key,request_id text,status text,core_vendor_id uuid,po_number text,vendor_name text,lines jsonb,total numeric,expected_date date,issued_at timestamptz,acceptance_evidence_version integer);
    create table procurement.request_attachments(id text primary key,request_id text,filename text,mime_type text,size_bytes bigint,storage_path text unique,sha256 text,kind text,uploaded_by uuid,uploaded_by_email text,uploaded_at timestamptz default now());
    create table storage.objects(bucket_id text,name text,owner_id text);
    create table legal.accreditation_cases(vendor_id uuid,jurisdiction text);
    create table procurement.payment_readiness_packs(id uuid primary key default gen_random_uuid(),purchase_order_id text,invoice_number text,status text,evidence_stale boolean default false,prepared_at timestamptz default clock_timestamp(),released_amount numeric default 0);
    create function procurement.prepare_request_attachment_access(jsonb) returns jsonb language sql as $$ select $1 $$;
    create function private.policy_po_lifecycle_transition(text,integer,text,text,jsonb) returns jsonb language sql as $$ select $5 $$;
    create function procurement.decide_request_step_uncertified_impl(jsonb) returns jsonb language sql as $$ select '{"delegated":true}'::jsonb $$;
    create function private.policy_po_lifecycle_projection(text) returns jsonb language sql as $$ select '{"revision":1}'::jsonb $$;
    create function procurement.acknowledge_purchase_order(jsonb) returns jsonb language sql as $$ select $1 $$;
    create function private.policy_prepare_invoice_payment_readiness(payload jsonb) returns jsonb language plpgsql as $$ declare p procurement.payment_readiness_packs; begin
      insert into procurement.payment_readiness_packs(purchase_order_id,invoice_number,status) values(payload->>'purchase_order_id',payload->>'invoice_number','ready_for_finance') returning * into p;
      return to_jsonb(p)||payload; end $$;
    insert into procurement.requests(id,requester_id,status,title,lines,attachments,route_version,compliance) values('req_test1234','${actor}','draft','Original','[{"id":"line1","description":"Service","quantity":1,"unitPrice":1000}]','[]',1,'{"routeConfirmed":true}');
    insert into procurement.purchase_orders values('po1','req_test1234','issued','${vendor}','PO1','Vendor','[{"description":"Service","quantity":1,"unitPrice":1000}]',1000,'2026-10-01',now(),2);
  `);
  await db.exec(sql);
  return db;
}
async function rpc(db,name,payload) { return (await db.query(`select ${name}($1::jsonb) result`,[JSON.stringify(payload)])).rows[0].result; }
async function documents(db) {
  const ids={};
  for (const purpose of ['invoice','acceptance','tax','foreign']) {
    const id=`att_${purpose}`;
    const path=`request/req_test1234/${id}.pdf`;
    await db.query('insert into storage.objects values($1,$2,$3)',['procurement-requests',path,actor]);
    await rpc(db,'procurement.register_payment_document',{purchase_order_id:'po1',purpose,attachment:{id,filename:`${purpose}.pdf`,mime_type:'application/pdf',size_bytes:100,sha256:'a'.repeat(64),storage_path:path}});
    ids[purpose]=id;
  }
  return {purchase_order_id:'po1',invoice_number:' INV  X ',invoice_or_si_storage_path:ids.invoice,milestone_support_storage_path:ids.acceptance,tax_withholding_support_storage_path:ids.tax,foreign_vendor_evidence_storage_path:ids.foreign};
}

test('F01/F07: exact assigned certified Legal authority, self and other assignees denied',async () => {
  const db=await fixture();
  try {
    await db.exec(`update procurement.requests set status='submitted',requester_id='${other}'; insert into procurement.approval_steps values('step','req_test1234','pending',1,'${actor}','legal')`);
    assert.equal((await rpc(db,'procurement.request_decision_eligibility',{request_id:'req_test1234'})).canDecide,true);
    assert.equal((await rpc(db,'procurement.decide_request_step',{request_id:'req_test1234'})).delegated,true);
    await db.exec(`update procurement.approval_steps set assigned_user_id='${other}'`);
    await assert.rejects(rpc(db,'procurement.decide_request_step',{request_id:'req_test1234'}),/assigned/);
    await db.exec(`update procurement.approval_steps set assigned_user_id='${actor}'; update procurement.requests set requester_id='${actor}'`);
    await assert.rejects(rpc(db,'procurement.decide_request_step',{request_id:'req_test1234'}),/own request/);
    await db.exec(`update procurement.requests set requester_id='${other}'; create or replace function core.has_live_cap(text,text) returns boolean language sql as $$ select false $$`);
    await assert.rejects(rpc(db,'procurement.decide_request_step',{request_id:'req_test1234'}),/certification/);
  } finally { await db.close(); }
});
test('F03: same-lineage owner revision preserves history and invalidates approvals, stale and foreign actors fail',async () => {
  const db=await fixture();
  try {
    await db.exec("delete from procurement.purchase_orders; update procurement.requests set status='rejected'; insert into procurement.route_decisions values('req_test1234','confirmed')");
    const payload={id:'req_test1234',expected_revision:0,title:'Corrected',justification:{need:'Correct need'},lines:[{id:'line1',description:'Fixed',quantity:2,unitPrice:300}],vendor_id:vendor};
    const attachment={id:'att_budget',filename:'budget.pdf',mime_type:'application/pdf',size_bytes:1024,storage_path:'request/req_test1234/att_budget.pdf',sha256:'b'.repeat(64),kind:'budget'};
    await assert.rejects(rpc(db,'procurement.revise_request',{...payload,attachments:[attachment]}),/evidence not found/);
    await db.query('insert into storage.objects values($1,$2,$3)',['procurement-requests',attachment.storage_path,actor]);
    payload.attachments=[attachment];
    const result=await rpc(db,'procurement.revise_request',payload);
    assert.equal(result.id,'req_test1234'); assert.equal(result.revision,1); assert.equal(result.status,'draft'); assert.equal(result.estimated_amount,600); assert.equal(result.compliance.routeConfirmed,false);
    assert.equal(result.attachments[0].kind,'budget'); assert.equal(result.attachments[0].sizeBytes,1024);
    assert.equal((await db.query('select count(*)::int n from procurement.request_revisions')).rows[0].n,1);
    assert.equal((await db.query('select status from procurement.route_decisions')).rows[0].status,'policy_decision_required');
    await assert.rejects(rpc(db,'procurement.revise_request',payload),/reload/);
    await db.exec(`update procurement.requests set requester_id='${other}'`);
    await assert.rejects(rpc(db,'procurement.revise_request',{...payload,expected_revision:1}),/owner/);
  } finally { await db.close(); }
});
test('F04/F05/F06: jurisdiction, governed files, normalized duplicate prevention and returned lineage',async () => {
  const db=await fixture();
  try {
    await db.exec(`insert into legal.accreditation_cases values('${vendor}','SG')`);
    assert.equal((await rpc(db,'procurement.payment_evidence_options',{purchase_order_id:'po1'})).foreignVendor,true);
    await db.exec("update legal.accreditation_cases set jurisdiction='PH'; update procurement.requests set compliance='{\"importation\":true}'");
    assert.equal((await rpc(db,'procurement.payment_evidence_options',{purchase_order_id:'po1'})).foreignVendor,false);
    const payload=await documents(db);
    await assert.rejects(rpc(db,'private.policy_prepare_invoice_payment_readiness',{...payload,invoice_or_si_storage_path:'https://example.test/file'}),/uploaded invoice/);
    await db.exec("update procurement.request_attachments set payment_evidence_version=1 where payment_purpose='invoice'");
    await assert.rejects(rpc(db,'private.policy_prepare_invoice_payment_readiness',payload),/uploaded invoice/);
    await db.exec("update procurement.request_attachments set payment_evidence_version=2 where payment_purpose='invoice'");
    await db.exec(`update procurement.request_attachments set payment_vendor_id='${other}' where payment_purpose='invoice'`);
    await assert.rejects(rpc(db,'private.policy_prepare_invoice_payment_readiness',payload),/uploaded invoice/);
    await db.exec(`update procurement.request_attachments set payment_vendor_id='${vendor}' where payment_purpose='invoice'`);
    const first=await rpc(db,'private.policy_prepare_invoice_payment_readiness',payload);
    assert.equal(first.invoice_number,'inv x');
    await assert.rejects(rpc(db,'private.policy_prepare_invoice_payment_readiness',{...payload,invoice_number:'inv x'}),/Duplicate/);
    await db.query("update procurement.payment_readiness_packs set status='returned' where id=$1",[first.id]);
    const corrected=await rpc(db,'private.policy_prepare_invoice_payment_readiness',{...payload,corrected_from:first.id});
    assert.notEqual(corrected.id,first.id);
    await assert.rejects(rpc(db,'private.policy_prepare_invoice_payment_readiness',{...payload,corrected_from:first.id}),/Duplicate/);
    await rpc(db,'private.policy_prepare_invoice_payment_readiness',{...payload,invoice_number:'Y'});
    const attempts=await Promise.allSettled([rpc(db,'procurement.prepare_payment_readiness',{...payload,invoice_number:'Z'}),rpc(db,'procurement.prepare_payment_readiness',{...payload,invoice_number:' z '})]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await db.query("select count(*)::int n from procurement.vendor_invoice_identities where invoice_identity='z'")).rows[0].n,1);
  } finally { await db.close(); }
});
test('F11: vendor PO contains commercial content and acknowledgement binds its hash',async () => {
  const db=await fixture();
  try {
    const [po]=await rpc(db,'procurement.vendor_purchase_order_acknowledgements',{});
    assert.equal(po.lines[0].description,'Service'); assert.equal(po.total,1000); assert.equal(po.documentHash.length,64);
    await rpc(db,'procurement.acknowledge_purchase_order',{purchase_order_id:'po1',expected_revision:1,document_hash:po.documentHash});
    await db.exec('update procurement.purchase_orders set total=1100');
    await assert.rejects(rpc(db,'procurement.acknowledge_purchase_order',{purchase_order_id:'po1',expected_revision:1,document_hash:po.documentHash}),/changed/);
    await db.exec(`update procurement.purchase_orders set core_vendor_id='${other}'`);
    assert.deepEqual(await rpc(db,'procurement.vendor_purchase_order_acknowledgements',{}),[]);
  } finally { await db.close(); }
});
