import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = (name) => readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
const scoped = await migration('20260828150000_scoped_action_evidence');
const atomicReconcile = await migration('20260828160000_atomic_finance_reconciliation');
const operations = await migration('20260804200000_operational_flow_completion');
const authority = await migration('20260810160000_finance_event_authority_remediation');
const certified = await migration('20260813203240_task_1_database_authority_remediation');
const privacy = await migration('20260815154702_procurement_finance_requester_privacy');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const finance = ['warehouse.manage_finance_close'];
const events = ['events.manage_events'];

// Execute the actual historical function bodies, not permissive stand-ins for
// the wrapped business functions. Only unrelated tables/auth/rate limits are fixtures.
function functionSql(sql, name) {
  const escaped = name.replaceAll('.', '\\.');
  const match = sql.match(new RegExp(`create or replace function ${escaped}\\([\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, `Missing function ${name}`);
  return match[0];
}
function tableSql(sql, name) {
  const start = sql.indexOf(`create table if not exists ${name} (`);
  assert.ok(start >= 0, `Missing table ${name}`);
  return sql.slice(start, sql.indexOf('\n);', start) + 3);
}
async function actor(db, id, caps = []) {
  await db.query("select set_config('app.actor', $1, false), set_config('app.caps', $2, false)", [id ?? '', caps.join(',')]);
}
async function rpc(db, name, payload) {
  return (await db.query(`select ${name}($1::jsonb) as result`, [JSON.stringify(payload)])).rows[0].result;
}
async function fixture(documentType = 'text', apply = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema core; create schema private; create schema warehouse; create schema procurement; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.actor', true),'')::uuid $$;
    create function core.has_live_cap(m text,c text) returns boolean language sql stable as $$
      select (m||'.'||c)=any(string_to_array(current_setting('app.caps',true),',')) $$;
    create function core.has_cap(m text,c text) returns boolean language sql stable as $$ select core.has_live_cap(m,c) $$;
    create table core.profiles(id uuid primary key,status text default 'active',full_name text,email text);
    insert into core.profiles(id) values ('${A}'),('${B}'),('${C}'),('${D}');
    create table core.activity_log(id bigserial primary key,module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    create table storage.buckets(id text primary key,public boolean);
    insert into storage.buckets values ('documents',false);
    create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage,core,warehouse,private to authenticated,anon;
    grant all on storage.objects to authenticated,anon;
    create policy legacy_broad_policy on storage.objects for all to authenticated using(true) with check(true);
    create table warehouse.events(id text primary key,start_date date default '2026-08-01',end_date date);
    insert into warehouse.events(id) values ('event-A'),('event-B');
    create table warehouse.allocations(id text,event_id text,quantity integer,status text);
    insert into warehouse.allocations values ('allocation-A','event-A',1,'issued');
    create table procurement.requests(id text primary key);
    create table procurement.purchase_orders(id text primary key,request_id text);
    create table procurement.payment_readiness_packs(id uuid primary key,purchase_order_id text,invoice_or_si_storage_path text);
    create table procurement.payment_releases(id uuid primary key,purchase_order_id text,payment_readiness_pack_id uuid,payment_reference text);
    create table procurement.request_attachments(id text primary key,request_id text,storage_path text);
    create table warehouse.receipts(id text primary key,procurement_po_id text);
    insert into procurement.purchase_orders(id) values ('PO-A'),('PO-B');
    insert into procurement.requests values ('PR-A');
    insert into procurement.payment_readiness_packs(id) values ('${A}');
    insert into procurement.payment_releases(id) values ('${A}');
    insert into warehouse.receipts(id) values ('RC-A');
  `);
  const docs = await migration(documentType === 'uuid' ? '20260706090300_core_documents' : '20260709152000_live_intra_cutover_contract');
  await db.exec(tableSql(docs, 'core.documents'));
  await db.exec(tableSql(operations, 'warehouse.event_reconciliations'));
  await db.exec(tableSql(operations, 'core.finance_close_entries'));
  await db.exec(`alter table core.finance_close_entries add updated_at timestamptz default now(),
    add reconciled_by uuid,add reconciled_at timestamptz,add source_record_type text,add source_record_id text,
    add evidence_record_type text,add evidence_record_id text;`);
  await db.exec(tableSql(certified, 'warehouse.event_settlements'));
  for (const name of ['warehouse.save_event_reconciliation','core.manage_finance_close_entry']) {
    await db.exec(functionSql(authority,name));
    await db.exec(`alter function ${name}(jsonb) rename to ${name.split('.')[1]}_uncertified_impl`);
    await db.exec(functionSql(certified,name));
  }
  for (const name of ['private.assert_finance_close_binding','private.finance_close_evidence_reference','private.finance_close_actor_lineage']) {
    await db.exec(functionSql(privacy,name));
  }
  const viewStart = privacy.indexOf('create view core.finance_close_entry_lineage');
  await db.exec(privacy.slice(viewStart, privacy.indexOf(';',viewStart)+1));
  await db.exec('alter function core.manage_finance_close_entry(jsonb) rename to manage_finance_close_entry_pre_requester_privacy');
  await db.exec(functionSql(privacy,'core.manage_finance_close_entry'));
  for (const name of ['20260826103000_event_reconciliation_finance_handoff','20260826123000_event_settlement_close_controls',
    '20260826133000_enforce_event_settlement_actor_separation','20260826143000_preflight_event_settlement_actor_lineage']) {
    await db.exec(await migration(name));
  }
  if (apply) {
    await db.exec(scoped);
    await db.exec(await migration('20260828170000_action_evidence_rate_limit'));
    await db.exec(atomicReconcile);
  }
  return db;
}
async function prepare(db, sourceType='purchase_order', sourceId='PO-A') {
  return rpc(db,'core.prepare_action_evidence',{source_type:sourceType,source_id:sourceId,filename:'proof.pdf',mime_type:'application/pdf',size_bytes:8});
}
async function complete(db, prepared) {
  await db.query('insert into storage.objects values ($1,$2,$3)', ['documents',prepared.storage_path,{size:8,mimetype:'application/pdf'}]);
  return rpc(db,'core.complete_action_evidence',{id:prepared.id});
}
const save = (doc, extra={}) => ({action:'save',period_start:'2026-08-01',period_end:'2026-08-31',entry_type:'inventory_valuation',
  source_module:'warehouse',source_reference:'PO-A',source_record_type:'purchase_order',source_record_id:'PO-A',
  evidence_record_type:'core_document',evidence_record_id:doc.document_id,evidence_url:doc.reference,amount:100,...extra});

for (const variant of ['text','uuid']) {
  test(`scoped evidence with real ${variant} document registry and underlying workflow functions`, async (t) => {
    const db = await fixture(variant);
    t.after(() => db.close());
    let doc;
    await t.test('authorization, source existence, role revocation and file validation fail closed', async () => {
      await actor(db,A,[]);
      await assert.rejects(prepare(db),/Not authorized/);
      await actor(db,null,finance);
      await assert.rejects(prepare(db),/Not authorized/);
      await actor(db,A,finance);
      await assert.rejects(prepare(db,'purchase_order','missing'),/Not authorized/);
      await assert.rejects(prepare(db,'arbitrary','PO-A'),/Not authorized/);
      await assert.rejects(rpc(db,'core.prepare_action_evidence',{source_type:'purchase_order',source_id:'PO-A',filename:'proof',mime_type:'text/html',size_bytes:5}),/Invalid evidence file/);
      await assert.rejects(rpc(db,'core.prepare_action_evidence',{source_type:'purchase_order',source_id:'PO-A',filename:'proof.pdf',mime_type:'application/pdf',size_bytes:4194305}),/4 MB/);
      const boundary = await rpc(db,'core.prepare_action_evidence',{source_type:'purchase_order',source_id:'PO-A',filename:'proof.pdf',mime_type:'application/pdf',size_bytes:4194304});
      assert.equal((await db.query('select size_bytes::int from private.action_evidence where id=$1',[boundary.id])).rows[0].size_bytes,4194304);
      await assert.rejects(db.query('update private.action_evidence set size_bytes=4194305 where id=$1',[boundary.id]),/check constraint/);
      for (const caps of [['events.view_events'],['events.approve_settlement'],finance]) {
        await actor(db,A,caps);
        await assert.rejects(prepare(db,'event_reconciliation','event-A'),/Not authorized/);
      }
      await actor(db,A,events);
      await assert.rejects(prepare(db,'purchase_order','PO-A'),/Not authorized/);
      await actor(db,A,finance);
      for (const [type,id] of [['procurement_request','PR-A'],['warehouse_receipt','RC-A'],['payment_readiness_pack',A],['payment_release',A]]) {
        assert.match((await prepare(db,type,id)).storage_path,/^business-evidence\//);
      }
      const pending = await prepare(db);
      await actor(db,A,[]);
      await assert.rejects(rpc(db,'core.complete_action_evidence',{id:pending.id}),/Not authorized/);
      await actor(db,B,finance);
      await assert.rejects(rpc(db,'core.complete_action_evidence',{id:pending.id}),/Not authorized/);
      await actor(db,A,finance);
      await db.query("update core.profiles set status='inactive' where id=$1",[A]);
      await assert.rejects(prepare(db),/Not authorized/);
      await db.query("update core.profiles set status='active' where id=$1",[A]);
    });
    await t.test('requires matching stored object; registers once without casting business IDs to UUID', async () => {
      const pending = await prepare(db);
      await assert.rejects(rpc(db,'core.complete_action_evidence',{id:pending.id}),/incomplete/);
      await db.query('insert into storage.objects values ($1,$2,$3)', ['documents',pending.storage_path,{size:9,mimetype:'application/pdf'}]);
      await assert.rejects(rpc(db,'core.complete_action_evidence',{id:pending.id}),/incomplete/);
      await db.query('delete from storage.objects where name=$1',[pending.storage_path]);
      doc = await complete(db,pending);
      assert.equal(doc.reference,`evidence://${pending.id}`);
      assert.deepEqual(await rpc(db,'core.complete_action_evidence',{id:pending.id}),doc);
      const rows = (await db.query('select id::text,entity_type,entity_id::text from core.documents')).rows;
      assert.deepEqual(rows,[{id:pending.id,entity_type:'action_evidence',entity_id:pending.id}]);
      assert.equal((await db.query("select count(*)::int as n from core.activity_log where action='registered'")).rows[0].n,1);
    });
    await t.test('private wrappers and Storage remain inaccessible despite broad legacy policies', async () => {
      for (const signature of ['warehouse.save_event_reconciliation_pre_action_evidence(jsonb)',
        'core.manage_finance_close_entry_pre_action_evidence(jsonb)','private.assert_action_evidence(text,text,text,boolean)',
        'private.assert_finance_close_binding(text,text,text,text)','private.finance_close_evidence_reference(text,text)']) {
        assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') as allowed",[signature])).rows[0].allowed,false);
      }
      for (const name of ['prepare_action_evidence','complete_action_evidence','action_evidence_access']) {
        assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') as allowed",[`core.${name}(jsonb)`])).rows[0].allowed,false);
      }
      await db.exec('set role authenticated');
      try {
        assert.equal((await db.query("select * from storage.objects where name like 'business-evidence/%'")).rows.length,0);
        await assert.rejects(db.query("insert into storage.objects values ('documents','business-evidence/forged.pdf','{}')"),/row-level security/);
        await assert.rejects(db.query('select * from private.action_evidence'),/permission denied/);
      } finally { await db.exec('reset role'); }
    });
    await t.test('previews require current authorization and an attached reviewable record', async () => {
      assert.equal((await rpc(db,'core.action_evidence_access',{reference:doc.reference})).expires_in,300);
      await actor(db,B,finance);
      await assert.rejects(rpc(db,'core.action_evidence_access',{reference:doc.reference}),/not been attached/);
      await actor(db,A,[]);
      await assert.rejects(rpc(db,'core.action_evidence_access',{reference:doc.reference}),/Not authorized/);
      await actor(db,A,finance);
    });
    await t.test('Finance binds durable identity, preserves optimistic concurrency and independent posting', async () => {
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',save(doc,{source_record_id:'PO-B'})),/does not belong/);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',save(doc,{evidence_record_type:null})),/identity/);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',save(doc,{evidence_url:'https://example.com/other'})),/identity/);
      await actor(db,B,finance);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',save(doc)),/does not belong/);
      await actor(db,A,finance);
      const entry = await rpc(db,'core.manage_finance_close_entry',save(doc,{evidence_url:null}));
      assert.equal(entry.evidence_url,doc.reference);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{action:'post',id:entry.id,expected_updated_at:entry.updated_at}),/second Finance/);
      await actor(db,B,finance);
      assert.match((await rpc(db,'core.action_evidence_access',{reference:doc.reference})).storage_path,/^business-evidence\//);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{action:'post',id:entry.id,expected_updated_at:'2020-01-01'}),/changed/);
      const posted = await rpc(db,'core.manage_finance_close_entry',{action:'post',id:entry.id,expected_updated_at:entry.updated_at});
      assert.equal(posted.evidence_url,doc.reference);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{action:'reconcile',id:entry.id,expected_updated_at:posted.updated_at}),/third Finance/);
      await actor(db,C,finance);
      assert.equal((await rpc(db,'core.manage_finance_close_entry',{action:'reconcile',id:entry.id,expected_updated_at:posted.updated_at})).status,'reconciled');
    });
    await t.test('Finance resolves no-URL payment and document identities only after source binding validation', async () => {
      await actor(db,A,finance);
      await db.query("update procurement.payment_releases set purchase_order_id='PO-A',payment_reference='PAY-001' where id=$1",[A]);
      const payment = save(doc,{source_reference:'CANONICAL-PAY',evidence_record_type:'payment_release',evidence_record_id:A,evidence_url:null});
      assert.equal((await rpc(db,'core.manage_finance_close_entry',payment)).evidence_url,'PAY-001');
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{...payment,source_record_id:'PO-B'}),/does not belong/);
      await db.query('insert into procurement.purchase_orders(id) values ($1)',[B]);
      await db.query("insert into core.documents(id,entity_type,entity_id,doc_type,storage_path) values ($1,'purchase_order',$2,'contract','registered/contract.pdf')",[D,B]);
      const document = save(doc,{source_reference:'CANONICAL-DOC',source_record_id:B,evidence_record_id:D,evidence_url:null});
      assert.equal((await rpc(db,'core.manage_finance_close_entry',document)).evidence_url,'registered/contract.pdf');
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{...document,evidence_url:'arbitrary/private.pdf'}),/permanent HTTPS/);
      await db.query("update core.documents set storage_path='https://storage.test/storage/v1/object/sign/documents/file?token=secret' where id::text=$1",[D]);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',document),/permanent HTTPS/);
      await actor(db,A,['warehouse.view_finance']);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',payment),/Not authorized/);
    });
    await t.test('Event submit, independent approval, post and reconcile retain the same registered reference', async () => {
      await actor(db,A,events);
      const eventDoc = await complete(db,await prepare(db,'event_reconciliation','event-A'));
      const eventPayload = {action:'submit',event_id:'event-A',sold_units:1,gross_sales_amount:100,evidence_url:eventDoc.reference};
      await assert.rejects(rpc(db,'warehouse.save_event_reconciliation',{...eventPayload,event_id:'event-B'}),/does not belong/);
      await assert.rejects(rpc(db,'warehouse.save_event_reconciliation',{...eventPayload,sold_units:0}),/account for all/);
      const submitted = await rpc(db,'warehouse.save_event_reconciliation',eventPayload);
      await actor(db,A,[...events,'events.approve_settlement']);
      await assert.rejects(rpc(db,'warehouse.save_event_reconciliation',{action:'approve',event_id:'event-A',expected_updated_at:submitted.updated_at,finance_reference:'FIN-A'}),/second Finance/);
      await actor(db,B,['events.approve_settlement']);
      assert.match((await rpc(db,'core.action_evidence_access',{reference:eventDoc.reference})).storage_path,/business-evidence/);
      const approved = await rpc(db,'warehouse.save_event_reconciliation',{action:'approve',event_id:'event-A',expected_updated_at:submitted.updated_at,finance_reference:'FIN-A'});
      let entry = (await db.query('select * from core.finance_close_entries where id=$1',[approved.finance_close_entry_id])).rows[0];
      assert.equal(entry.evidence_url,eventDoc.reference);
      await actor(db,B,finance);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{action:'post',id:entry.id,expected_updated_at:entry.updated_at}),/settlement approver cannot post/);
      await actor(db,C,finance);
      entry = await rpc(db,'core.manage_finance_close_entry',{action:'post',id:entry.id,expected_updated_at:entry.updated_at});
      assert.equal(entry.status,'posted');
      assert.equal(entry.evidence_url,eventDoc.reference);
      for (const [id, message] of [[A,/preparer cannot reconcile/],[B,/settlement approver cannot reconcile/],[C,/third Finance/]]) {
        await actor(db,id,finance);
        await assert.rejects(rpc(db,'core.manage_finance_close_entry',{action:'reconcile',id:entry.id,expected_updated_at:entry.updated_at}),message);
      }
      await actor(db,D,[]);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{action:'reconcile',id:entry.id,expected_updated_at:entry.updated_at}),/Not authorized/);
      await actor(db,D,finance);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{action:'reconcile',id:entry.id}),/Refresh/);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{action:'reconcile',id:entry.id,expected_updated_at:submitted.updated_at}),/changed/);
      assert.equal((await db.query('select reconciled_by from core.finance_close_entries where id=$1',[entry.id])).rows[0].reconciled_by,null);
      const reconciled = await rpc(db,'core.manage_finance_close_entry',{action:'reconcile',id:entry.id,expected_updated_at:entry.updated_at,reconciliation_note:'Verified settlement'});
      assert.equal(reconciled.status,'reconciled');
      assert.equal(reconciled.reconciled_by,D);
      assert.ok(reconciled.reconciled_at);
      assert.equal(reconciled.prepared_by,A);
      assert.equal(reconciled.posted_by,C);
      assert.equal(reconciled.settlement_approved_by,B);
      assert.equal(reconciled.evidence_url,eventDoc.reference);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{action:'reconcile',id:entry.id,expected_updated_at:entry.updated_at}),/changed/);
      await assert.rejects(rpc(db,'core.manage_finance_close_entry',{action:'reconcile',id:entry.id,expected_updated_at:reconciled.updated_at}),/Post the entry/);
      const audit = (await db.query("select actor,detail from core.activity_log where entity_id=$1 and action='reconcile'",[entry.id])).rows;
      assert.deepEqual(audit,[{actor:D,detail:{entry_type:'event_settlement',status:'reconciled',amount:100}}]);
    });
    await t.test('rejects forged references, arbitrary paths, public Storage and expiring links', async () => {
      await actor(db,A,events);
      for (const reference of [`evidence://${D}`,'business-evidence/private.pdf','https://storage.test/storage/v1/object/sign/documents/a?token=x',
        'https://storage.test/storage/v1/object/public/documents/a','https://host.test/file?X-Amz-Signature=secret','https://u:p@host.test/file']) {
        await assert.rejects(rpc(db,'warehouse.save_event_reconciliation',{action:'save',event_id:'event-B',evidence_url:reference}),/does not belong|permanent HTTPS/);
      }
      const saved = await rpc(db,'warehouse.save_event_reconciliation',{action:'save',event_id:'event-B',evidence_url:'https://example.com/permanent'});
      assert.equal(saved.evidence_url,'https://example.com/permanent');
    });
    await t.test('revoked documents and missing objects cannot be reopened', async () => {
      await actor(db,A,finance);
      await db.query("update core.documents set status='rejected' where id::text=$1",[doc.document_id]);
      await assert.rejects(rpc(db,'core.action_evidence_access',{reference:doc.reference}),/incomplete|does not belong/);
      await db.query("update core.documents set status='submitted' where id::text=$1",[doc.document_id]);
      await db.exec("delete from procurement.purchase_orders where id='PO-A'");
      await assert.rejects(db.query("select private.assert_finance_close_binding('purchase_order','PO-A','core_document',$1)",[doc.document_id]),/Not authorized/);
      await db.exec("insert into procurement.purchase_orders(id) values ('PO-A')");
      await db.exec('delete from storage.objects');
      await assert.rejects(rpc(db,'core.action_evidence_access',{reference:doc.reference}),/incomplete|does not belong/);
    });
  });
}

test('evidence upload limit is actor-scoped and works without a legacy helper', async (t) => {
  const db = await fixture();
  t.after(() => db.close());
  await actor(db,A,finance);
  for (let i=0; i<100; i++) await prepare(db);
  await assert.rejects(prepare(db), /upload limit reached/);
  assert.equal((await db.query('select count(*)::int count from private.action_evidence')).rows[0].count,100);
  await actor(db,B,finance);
  assert.match((await prepare(db)).storage_path,/^business-evidence\//);
  await actor(db,A,finance);
  await db.query("update private.action_evidence set created_at=now()-interval '2 hours' where uploaded_by=$1",[A]);
  assert.match((await prepare(db)).storage_path,/^business-evidence\//);
});

test('migration fails closed if documents bucket is public', async (t) => {
  const db = await fixture('text',false);
  t.after(() => db.close());
  await db.exec("update storage.buckets set public=true where id='documents'");
  await assert.rejects(db.exec(scoped),/private documents bucket/);
});

test('atomic reconcile migration repairs existing Event handoffs independently of evidence migration', async (t) => {
  const db = await fixture('text',false);
  t.after(() => db.close());
  await actor(db,A,events);
  const submitted = await rpc(db,'warehouse.save_event_reconciliation',{action:'submit',event_id:'event-A',sold_units:1,
    gross_sales_amount:100,evidence_url:'https://example.com/permanent'});
  await actor(db,B,['events.approve_settlement']);
  const approved = await rpc(db,'warehouse.save_event_reconciliation',{action:'approve',event_id:'event-A',
    expected_updated_at:submitted.updated_at,finance_reference:'FIN-BASELINE'});
  let entry = (await db.query('select * from core.finance_close_entries where id=$1',[approved.finance_close_entry_id])).rows[0];
  await actor(db,C,finance);
  entry = await rpc(db,'core.manage_finance_close_entry',{action:'post',id:entry.id,expected_updated_at:entry.updated_at});
  await db.exec(atomicReconcile);
  await actor(db,D,finance);
  const reconciled = await rpc(db,'core.manage_finance_close_entry',{action:'reconcile',id:entry.id,expected_updated_at:entry.updated_at});
  assert.equal(reconciled.status,'reconciled');
  assert.equal(reconciled.reconciled_by,D);
  assert.equal((await db.query("select has_function_privilege('authenticated','core.manage_finance_close_entry_uncertified_impl(jsonb)','execute') as allowed")).rows[0].allowed,false);
});

test('atomic migration changes only the existing reconcile UPDATE, not workflow authority', () => {
  const previous = functionSql(authority,'core.manage_finance_close_entry').replace('core.manage_finance_close_entry(payload','core.manage_finance_close_entry_uncertified_impl(payload');
  const next = functionSql(atomicReconcile,'core.manage_finance_close_entry_uncertified_impl');
  assert.equal(next.replaceAll('\r\n','\n'),previous.replaceAll('\r\n','\n').replace("status = 'reconciled',","status = 'reconciled', reconciled_by = auth.uid(), reconciled_at = now(),"));
});
