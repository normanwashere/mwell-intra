import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { procurementModule } from '../packages/rbac/src/modules/procurement.ts';
import { CURRENT_LIVE_ROLES } from './qa/live-e2e-scenarios.mjs';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const completion = read('20260913214911_govern_replenishment_request_completion');
const policy = read('20260822110000_mpic_procurement_policy_alignment');
const authority = read('20260813203240_task_1_database_authority_remediation');
const files = { attachments: read('20260710041319_govern_procurement_attachments'), privacy: read('20260815154702_procurement_finance_requester_privacy'),
  intake: read('20260816223000_deduplicate_procurement_intake_collaborators'), original: read('20260804201000_fix_replenishment_procurement_handoff') };
function fn(sql, name, last = false) {
  const marker = `create or replace function ${name}(`, start = last ? sql.lastIndexOf(marker) : sql.indexOf(marker);
  assert(start >= 0, name); const end = sql.indexOf('$$;', start); assert(end > start, name); return sql.slice(start, end + 3);
}
const actor = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const requestId = 'req_33333333333343338333333333333333';
const recCap = 'warehouse.recommend_replenishment', manageCap = 'procurement.manage_replenishment', createCap = 'procurement.create_request';
const recommendation = { action: 'recommend', product_id: 'merch', recommended_quantity: 2, on_hand: 0, reorder_point: 2, lead_time_days: 14, stockout_risk: 'critical', rationale: 'Accepted inventory need' };
const requirements = Object.fromEntries(['acceptanceCriteria','deliveryTerms','paymentTerms','shippingTerms','validityPeriod','responseDeadline'].map(key => [key, `Explicit fixture ${key}`]));
const payload = () => ({ id: requestId, title: 'Explicit purchase request', description: 'Planning completion', department: 'operations', cost_center: 'approved-cost-center', budget_code: 'approved-budget',
  needed_by: '2099-01-01', requirement_kind: 'materials', requested_mode: 'competitive_bidding', category: 'goods', estimated_amount: 50,
  lines: [{ id: 'rl_fixture', description: 'merch', quantity: 2, uom: 'unit', unitPrice: 25 }], justification: { need: recommendation.rationale },
  solicitation_requirements: requirements, compliance: { routeConfirmed: false, riskFacts: { comparable: true } },
  attachments: ['spec', 'budget'].map(kind => ({ id: `att_${kind}`, kind, filename: `${kind}.pdf`, mime_type: 'application/pdf', size_bytes: 100,
    storage_path: `request/${requestId}/${kind}.pdf`, sha256: 'a'.repeat(64) })) });

async function capabilities(db, caps, id = actor) {
  await db.query("select set_config('test.actor',$1,false),set_config('test.caps',$2,false)", [id, JSON.stringify(caps)]);
}
async function fixture(t, patched = true) {
  const db = new PGlite(); t.after(() => db.close());
  // Actual command/creator/policy bodies and constraints below; only peripheral
  // tables and controllable effective-capability evaluator are local fixtures.
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema warehouse; create schema procurement; create schema private; create schema storage;
    grant usage on schema auth,core,warehouse,procurement,private,storage to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{"email":"fixture@example.invalid"}'::jsonb$$;
    create function core.has_live_cap(m text,c text) returns boolean language sql stable as $$select auth.uid() is not null and coalesce(current_setting('test.caps',true)::jsonb ? (m||'.'||c),false)$$;
    create function core.has_cap(m text,c text) returns boolean language sql stable as $$select core.has_live_cap(m,c)$$;
    create function storage.foldername(t text) returns text[] language sql immutable as $$select string_to_array(t,'/')$$;
    create table core.profiles(id uuid primary key,full_name text,status text default 'active',kind text default 'employee');
    insert into core.profiles(id) values('${actor}'),('${other}');
    create table core.user_roles(user_id uuid,module text,role text);
    create table warehouse.products(id text primary key); insert into warehouse.products values('merch');
    create table procurement.requests(id text primary key default ('req_'||replace(gen_random_uuid()::text,'-','')),status text default 'draft',
      title text,description text,requester_id uuid,requester_name text,requester_email text,department text,cost_center text,project_code text,budget_code text,
      needed_by date,core_vendor_id uuid,vendor_name text,estimated_amount numeric,category text,sourcing_method text,sourcing_override boolean default false,
      justification jsonb,attachments jsonb default '[]',compliance jsonb default '{}',lines jsonb default '[]',created_at timestamptz default now(),updated_at timestamptz default now(),
      requirement_kind text check(requirement_kind in ('materials','services')),solicitation_requirements jsonb default '{}',
      solicitation_type text,procurement_mode text,governance_tier text,policy_profile_id uuid,route_reasons jsonb,route_version integer default 0,route_confirmed_at timestamptz,route_confirmed_by uuid);
    create table procurement.purchase_orders(id text primary key);
    create table procurement.request_collaborators(request_id text references procurement.requests(id),user_id uuid,access_level text,reason text,granted_by uuid,
      granted_at timestamptz default now(),revoked_by uuid,revoked_at timestamptz,primary key(request_id,user_id));
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    create table procurement.policy_profiles(id uuid primary key default gen_random_uuid(),code text default 'fixture',version integer default 1,
      relationship text default 'mwell_operating',status text default 'active',effective_from timestamptz default '2000-01-01',effective_to timestamptz,
      formal_bid_amount numeric default 1000000,petty_cash_max_amount numeric default 10000,repeat_order_max_amount numeric default 100000);
    insert into procurement.policy_profiles default values;
    create table procurement.route_decisions(id uuid primary key default gen_random_uuid(),request_id text references procurement.requests(id),policy_version text,request_version integer,
      method text,reasons text[],risk_facts jsonb,status text,confirmed_by uuid,confirmed_at timestamptz default now(),solicitation_type text,procurement_mode text,governance_tier text,policy_profile_id uuid,
      unique(request_id,request_version));
    create table procurement.exception_packs(id uuid primary key,request_id text,status text,exception_type text,mode text,route_decision_id uuid,request_version integer,policy_profile_id uuid,
      submitted_at timestamptz,revision integer,request_fingerprint text);
  `);
  const cutover = read('20260709152000_live_intra_cutover_contract');
  await db.exec(cutover.slice(cutover.indexOf('create table if not exists core.activity_log'), cutover.indexOf('create table if not exists core.notifications')));
  const operational = read('20260804200000_operational_flow_completion');
  await db.exec(operational.slice(operational.indexOf('create table if not exists procurement.replenishment_recommendations'), operational.indexOf('create table if not exists core.finance_close_entries')));
  await db.exec(files.attachments.slice(0, files.attachments.indexOf('create or replace function procurement.prepare_request_attachment_access')));
  await db.exec('alter function procurement.create_request(jsonb) rename to create_request_pre_requester_privacy');
  await db.exec(fn(files.privacy, 'private.assert_minimum_request_contract'));
  await db.exec(fn(files.intake, 'procurement.create_request'));
  await db.exec('alter function procurement.create_request(jsonb) rename to create_request_pre_policy_route');
  await db.exec(fn(policy,'private.policy_exception_pack_binding_blockers',true));
  await db.exec(fn(policy,'private.policy_exception_pack_blockers',true));
  for (const name of ['private.policy_normalized_risk_facts','private.policy_normalized_risk_reasons','private.policy_normalize_solicitation_requirements',
    'private.policy_route_exception_contract','private.policy_route_exception_is_eligible','private.policy_route_legacy_method','private.policy_derive_procurement_route','procurement.create_request']) await db.exec(fn(policy,name,true));
  await db.exec(fn(policy, 'private.policy_route_confirmation_input'));
  await db.exec(fn(policy,'private.policy_confirm_route_decision',true));
  await db.exec(fn(policy,'procurement.confirm_route_decision'));
  await db.exec(files.original);
  await db.exec('alter function procurement.manage_replenishment_recommendation(jsonb) rename to manage_replenishment_recommendation_uncertified_impl');
  await db.exec(fn(authority,'procurement.manage_replenishment_recommendation'));
  for (const line of authority.split('\n')) {
    const acl = line.match(/^(revoke all|grant execute) on function (.+) (from|to) (.+);$/);
    if (acl && acl[2].split(', ').includes('procurement.manage_replenishment_recommendation(jsonb)')) {
      await db.exec(`${acl[1]} on function procurement.manage_replenishment_recommendation(jsonb) ${acl[3]} ${acl[4]};`);
    }
  }
  await db.exec(read('20260913175711_align_replenishment_action_authority_and_snapshot'));
  if (patched) await db.exec(completion);
  await capabilities(db,[recCap]);
  const r = await invoke(db,recommendation);
  await capabilities(db,[manageCap,createCap]); await invoke(db,{id:r.id,action:'accept'});
  for (const a of payload().attachments) await db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['procurement-requests',a.storage_path,actor]);
  return { db, id:r.id };
}
async function invoke(db,p) { return (await db.query('select procurement.manage_replenishment_recommendation($1::jsonb) as r',[JSON.stringify(p)])).rows[0].r; }
async function snapshot(db) { return (await db.query(`select
  (select jsonb_agg(to_jsonb(r) order by id) from procurement.replenishment_recommendations r) recs,
  (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from procurement.requests r) requests,
  (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from procurement.request_attachments r) attachments,
  (select coalesce(jsonb_agg(to_jsonb(r) order by request_id,user_id),'[]') from procurement.request_collaborators r) collaborators,
  (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from core.activity_log r) audit,
  (select count(*) from procurement.route_decisions) routes`)).rows[0]; }

test('actual old handoff creates an unroutable legacy shape; canonical-ready regression is RED without candidate', async t => {
  const {db,id}=await fixture(t,false); await invoke(db,{id,action:'handoff'});
  const r=(await snapshot(db)).requests[0]; assert.equal(r.requirement_kind,null); assert.equal(r.justification.need,undefined);
  const route=(await db.query('select private.policy_derive_procurement_route($1) r',[r.id])).rows[0].r;
  assert.equal(route.status,'blocked'); assert(route.blockers.includes('estimated_amount_required'));
});
test('canonical completion creates one owned draft; route confirmation remains a separate authorized action', async t => {
  const {db,id}=await fixture(t,process.env.REPLENISHMENT_COMPLETION_BASELINE!=='1');
  const r=await invoke(db,{id,action:'handoff',request:payload()}); const state=await snapshot(db), q=state.requests[0];
  assert.equal(q.requirement_kind,'materials');
  assert.equal(r.status,'handed_off'); assert.equal(r.procurement_request_id,requestId); assert.equal(q.status,'draft');
  assert.equal(q.estimated_amount,50); assert.equal(q.requester_id,actor);
  assert.equal(q.justification.need,recommendation.rationale); assert.equal(q.justification.replenishmentRecommendationId,id);
  assert.equal(q.compliance.routeConfirmed,false); assert.equal(state.routes,0); assert.equal(state.attachments.length,2);
  assert.equal((await db.query('select private.policy_derive_procurement_route($1) r',[requestId])).rows[0].r.status,'derived');
  await assert.rejects(db.query('select procurement.confirm_route_decision($1::jsonb)',[JSON.stringify({request_id:requestId,requested_mode:'competitive_bidding',expected_route_version:0})]),/Not authorized/);
  await capabilities(db,[manageCap,createCap,'procurement.manage_rfp']);
  await db.query('select procurement.confirm_route_decision($1::jsonb)',[JSON.stringify({request_id:requestId,requested_mode:'competitive_bidding',expected_route_version:0})]);
  assert.equal((await snapshot(db)).routes,1); assert.equal((await snapshot(db)).requests[0].status,'draft');
});
for(const defect of ['missing-request','null-kind','wrong-kind','wrong-product','wrong-quantity','extra-line','foreign-lineage','foreign-evidence','foreign-evidence-path','absent-evidence','no-create','no-manage','absent-actor','missing-budget','missing-terms','missing-price','failed-link','already-linked','changed-need']) test(`${defect} retains accepted snapshot without request or audit orphans`,async t=>{
  const {db,id}=await fixture(t), request=payload();
  if(defect==='null-kind') request.requirement_kind=null;
  if(defect==='wrong-kind') request.requirement_kind='goods';
  if(defect==='wrong-product') request.lines[0].description='foreign';
  if(defect==='wrong-quantity') request.lines[0].quantity=3;
  if(defect==='extra-line') request.lines.push({...request.lines[0]});
  if(defect==='foreign-lineage') request.justification.replenishmentRecommendationId=other;
  if(defect==='foreign-evidence') await db.query('update storage.objects set owner_id=$1',[other]);
  if(defect==='foreign-evidence-path') { request.attachments[0].storage_path='request/req_foreign/spec.pdf'; await db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['procurement-requests',request.attachments[0].storage_path,actor]); }
  if(defect==='absent-evidence') await db.exec('delete from storage.objects');
  if(defect==='no-create') await capabilities(db,[manageCap]);
  if(defect==='no-manage') await capabilities(db,[createCap]);
  if(defect==='absent-actor') await capabilities(db,[manageCap,createCap],'');
  if(defect==='missing-budget') delete request.budget_code;
  if(defect==='missing-terms') request.solicitation_requirements={};
  if(defect==='missing-price') delete request.lines[0].unitPrice;
  if(defect==='changed-need') request.justification.need='Substituted need';
  if(defect==='already-linked') await db.exec(`insert into procurement.requests(id,title) values('req_retained','Retained draft'); update procurement.replenishment_recommendations set procurement_request_id='req_retained';`);
  if(defect==='failed-link') await db.exec(`create function private.reject_link() returns trigger language plpgsql as $$begin if new.status='handed_off' then raise exception 'Injected post-creation link failure'; end if; return new; end$$;
    create trigger reject_link before update on procurement.replenishment_recommendations for each row execute function private.reject_link();`);
  const before=await snapshot(db);
  await assert.rejects(invoke(db,{id,action:'handoff',...(defect==='missing-request'?{}:{request})}));
  assert.deepEqual(await snapshot(db),before);
});
test('overlapping duplicate submissions create one request; decided snapshot and ACL remain protected',async t=>{
  const {db,id}=await fixture(t); const before=(await db.query("select pg_get_functiondef('procurement.manage_replenishment_recommendation(jsonb)'::regprocedure) body")).rows[0].body;
  const second=payload(); second.id='req_44444444444444448444444444444444';
  for(const attachment of second.attachments) {
    attachment.storage_path=attachment.storage_path.replace(requestId,second.id);
    await db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['procurement-requests',attachment.storage_path,actor]);
  }
  const results=await Promise.allSettled([invoke(db,{id,action:'handoff',request:payload()}),invoke(db,{id,action:'handoff',request:second})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal((await snapshot(db)).requests.length,1);
  assert.equal((await db.query("select pg_get_functiondef('procurement.manage_replenishment_recommendation(jsonb)'::regprocedure) body")).rows[0].body,before);
  for(const role of ['anon','authenticated']) assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,'private.create_replenishment_request(procurement.replenishment_recommendations,jsonb)'])).rows[0].allowed,false);
  // PGlite serializes one backend: this is overlapping-call coverage, not a two-session lock-wait proof.
});

test('actual outer ACL denies anon while authenticated nested creation works',async t=>{
  const {db,id}=await fixture(t);
  await db.exec('set role anon');
  await assert.rejects(invoke(db,{id,action:'handoff',request:payload()}),/permission denied/);
  await db.exec('reset role; set role authenticated');
  const result=await invoke(db,{id,action:'handoff',request:payload()});
  assert.equal(result.status,'handed_off'); await db.exec('reset role');
});

test('explicit services remains services despite goods category; caller cannot confirm, submit or replace the actor',async t=>{
  const {db,id}=await fixture(t); const request=payload();
  request.requirement_kind='services'; request.status='submitted'; request.requester_id=other;
  request.requester_email='foreign@example.invalid'; request.requester_name='Foreign';
  request.attachments[0].uploaded_by_email='foreign@example.invalid';
  request.compliance.routeConfirmed=true; request.compliance.routeConfirmedByEmail='foreign@example.invalid';
  await invoke(db,{id,action:'handoff',request});
  const saved=(await snapshot(db)).requests[0];
  assert.equal(saved.requirement_kind,'services'); assert.equal(saved.category,'goods'); assert.equal(saved.status,'draft');
  assert.equal(saved.requester_id,actor); assert.equal(saved.route_confirmed_at,null); assert.equal(saved.compliance.routeConfirmed,false);
  assert.equal(saved.requester_email,'fixture@example.invalid'); assert.equal(saved.requester_name,null);
  assert.equal(saved.attachments[0].uploadedByEmail,'fixture@example.invalid');
  assert.equal(saved.compliance.routeConfirmedByEmail,undefined);
});

test('all canonical management roles and the 11-persona roster retain creation authority without new grants',()=>{
  const management=Object.entries(procurementModule.roles).filter(([,role])=>role.capabilities.includes('manage_replenishment'));
  assert.deepEqual(management.map(([name])=>name).sort(),['admin','procurement_officer']);
  for(const [,role] of management) assert(role.capabilities.includes('create_request'));
  assert.equal(CURRENT_LIVE_ROLES.length,11);
  assert.deepEqual(CURRENT_LIVE_ROLES.filter(p=>(p.assignments.procurement??[]).some(r=>management.some(([name])=>name===r))).map(p=>p.role),['procurement_lead']);
});
