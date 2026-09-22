import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const actor = '00000000-0000-4000-8000-000000000001';
const maker = '00000000-0000-4000-8000-000000000002';
const requester = '00000000-0000-4000-8000-000000000003';
const matrix = '00000000-0000-4000-8000-000000000004';
const previous = '00000000-0000-4000-8000-000000000005';
const assignee = '00000000-0000-4000-8000-000000000006';
const read = file => readFileSync(`supabase/migrations/${file}`, 'utf8');
function definition(sql, name) {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert(start >= 0, name);
  const end = sql.indexOf('$$;', start);
  assert(end > start);
  return sql.slice(start, end + 3);
}
async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema private; create schema procurement;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function core.is_vendor() returns boolean language sql stable as $$ select coalesce(current_setting('test.vendor',true),'false')='true' $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$ select coalesce(current_setting('test.certified',true),'true')<>'false' $$;
    create function private.policy_can_manage_doa() returns boolean language sql stable as $$ select core.has_live_cap('legal','manage_doa') $$;
    create table core.profiles(id uuid primary key,status text,kind text,full_name text,email text);
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz default now(),expires_at timestamptz);
    create table core.roles(module text,role text,is_active boolean);
    create table core.role_capabilities(module text,role text,cap text);
    create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    create table procurement.requests(id text primary key,requester_id uuid,status text);
    create table procurement.approval_steps(id text,request_id text,status text,step_order int,assigned_user_id uuid,tier text);
    create table procurement.doa_matrices(id uuid primary key,department text,version text,active boolean,status text,created_by uuid,
      updated_at timestamptz,activated_by uuid,activated_at timestamptz,approved_by_name text,approved_at timestamptz);
    create table procurement.doa_assignments(id int primary key,matrix_id uuid,tier text,min_amount numeric,max_amount numeric,category text,active boolean,approver_user_id uuid);
    insert into core.profiles values('${actor}','active','employee','Reviewer','reviewer@example.test'),('${maker}','active','employee','Maker','maker@example.test');
    insert into core.roles values('procurement','approver',true),('procurement','admin',true),('procurement','procurement_officer',true),('procurement','finance',true),('legal','legal_reviewer',true);
    insert into core.role_capabilities select module,role,case when module='legal' then 'review_accreditation' else 'approve_request' end from core.roles;
    insert into core.user_roles(user_id,module,role) values('${actor}','procurement','approver');
    insert into procurement.requests values('request','${requester}','under_review');
    insert into procurement.approval_steps values('step','request','pending',3,'${actor}','final_approver');
    insert into procurement.doa_matrices values('${matrix}','marketing','NEW',false,'draft','${maker}',null,null,null,null,null),
      ('${previous}','marketing','OLD',true,'active','${maker}',null,null,null,null,null);
    insert into procurement.doa_assignments values(1,'${matrix}','final_approver',0,null,null,true,'${actor}');
    select set_config('test.actor','${actor}',false);
  `);
  const baseline = read('20260905090000_procurement_remediation.sql');
  for (const name of ['private.has_current_procurement_tier', 'procurement.request_decision_eligibility']) await db.exec(definition(baseline, name));
  await db.exec(definition(read('20260711090000_department_doa_administration.sql'), 'private.policy_activate_doa_matrix'));
  await db.exec(definition(read('20260816230000_repair_quality_acceptance_and_doa_activation.sql'), 'procurement.activate_doa_matrix'));
  await db.exec(`
    grant usage on schema auth,core,procurement to authenticated;
    revoke all on function private.has_current_procurement_tier(text) from public,anon,authenticated,service_role;
    revoke all on function private.policy_activate_doa_matrix(jsonb) from public,anon,authenticated;
    revoke all on function procurement.request_decision_eligibility(jsonb) from public,anon,service_role;
    grant execute on function procurement.request_decision_eligibility(jsonb) to authenticated;
    revoke all on function procurement.activate_doa_matrix(jsonb) from public,anon;
    grant execute on function procurement.activate_doa_matrix(jsonb) to authenticated,service_role;
  `);
  await db.exec(read('20260922111953_procurement_doa_tier_guard.sql'));
  return db;
}
const rpc = (db, name, payload) => db.transaction(async tx => {
  await tx.exec('set local role authenticated');
  return (await tx.query(`select ${name}($1::jsonb) result`, [JSON.stringify(payload)])).rows[0].result;
});
const eligibility = db => rpc(db, 'procurement.request_decision_eligibility', { request_id: 'request' });
const activate = db => rpc(db, 'procurement.activate_doa_matrix', { matrix_id: matrix });

test('wrong final-approver role is not described as a training problem', async t => {
  const db = await fixture(t);
  const result = await eligibility(db);
  assert.equal(result.canDecide, false);
  assert.equal(result.reasonCode, 'approval_role_required');
  assert.match(result.reason, /assigned approval step.*administrator/i);
});
test('DOA activation rejects wrong tier before superseding existing policy', async t => {
  const db = await fixture(t);
  await assert.rejects(activate(db), /required role.*approval step/i);
  assert.equal((await db.query('select active from procurement.doa_matrices where id=$1',[previous])).rows[0].active, true);
  assert.equal((await db.query('select count(*)::int n from core.activity_log')).rows[0].n, 0);
});
test('genuine missing certification keeps role authority separate', async t => {
  const db = await fixture(t);
  await db.exec("update core.user_roles set role='admin'; select set_config('test.certified','false',false)");
  const result = await eligibility(db);
  assert.equal(result.canDecide, false);
  assert.equal(result.reasonCode, 'approval_training_required');
  assert.match(result.reason, /required training/i);
});
test('current final approver remains eligible and separate checker can activate valid policy', async t => {
  const db = await fixture(t);
  await db.exec("update core.user_roles set role='admin'");
  assert.equal((await eligibility(db)).canDecide, true);
  assert.equal((await activate(db)).status, 'active');
  assert.equal((await db.query('select active from procurement.doa_matrices where id=$1',[previous])).rows[0].active, false);
});
for (const [label, mutation] of [
  ['expired assignment', "update core.user_roles set expires_at=now()-interval '1 second'"],
  ['future assignment', "update core.user_roles set effective_at=now()+interval '1 day'"],
  ['inactive role', 'update core.roles set is_active=false'],
  ['inactive employee', "update core.profiles set status='inactive'"],
  ['removed capability', 'delete from core.role_capabilities'],
  ['missing profile', 'delete from core.profiles'],
]) test(`${label} cannot activate a policy or decide a request`, async t => {
  const db = await fixture(t);
  await db.exec("update core.user_roles set role='admin'");
  await db.exec(mutation);
  assert.equal((await eligibility(db)).canDecide, false);
  await assert.rejects(activate(db), /required role|active employee/i);
});
test('requester self-decision, different assignee, and vendor stay denied', async t => {
  const db = await fixture(t);
  await db.exec("update core.user_roles set role='admin'");
  await db.exec(`update procurement.requests set requester_id='${actor}'`);
  assert.match((await eligibility(db)).reason, /own request/i);
  await db.exec(`update procurement.requests set requester_id='${requester}'; update procurement.approval_steps set assigned_user_id='${maker}'`);
  assert.match((await eligibility(db)).reason, /assigned approver/i);
  await db.exec("select set_config('test.vendor','true',false)");
  assert.equal((await eligibility(db)).reason, 'Request unavailable');
});
test('activation still requires a separate checker', async t => {
  const db = await fixture(t);
  await db.exec(`update core.user_roles set role='admin'; update procurement.doa_matrices set created_by='${actor}' where id='${matrix}'`);
  await assert.rejects(activate(db), /separate DOA checker/i);
});
for (const [label, checkerRole, assignedRole, allowed] of [
  ['checker tier cannot substitute for ineligible assignee', 'admin', 'approver', false],
  ['checker need not hold the different assignee tier', 'approver', 'admin', true],
  ['distinct eligible checker and assignee work normally', 'admin', 'admin', true],
]) test(label, async t => {
  const db = await fixture(t);
  await db.query('update core.user_roles set role=$1', [checkerRole]);
  await db.query("insert into core.profiles values($1,'active','employee','Assignee','assignee@example.test')", [assignee]);
  await db.query("insert into core.user_roles(user_id,module,role) values($1,'procurement',$2)", [assignee, assignedRole]);
  await db.query('update procurement.doa_assignments set approver_user_id=$1', [assignee]);
  if (allowed) assert.equal((await activate(db)).status, 'active');
  else {
    await assert.rejects(activate(db), /required role.*approval step/i);
    assert.equal((await db.query('select active from procurement.doa_matrices where id=$1', [previous])).rows[0].active, true);
  }
});
test('all existing tier mappings stay unchanged', async t => {
  const db = await fixture(t);
  for (const [tier,module,role] of [['dept_head','procurement','approver'],['procurement_head','procurement','procurement_officer'],['finance','procurement','finance'],['final_approver','procurement','admin'],['legal','legal','legal_reviewer']]) {
    await db.query('update core.user_roles set module=$1,role=$2', [module,role]);
    await db.query('update procurement.approval_steps set tier=$1', [tier]);
    assert.equal((await eligibility(db)).canDecide, true, tier);
  }
});
test('arbitrary-user tier helper is private, not an exposed authorization probe', async t => {
  const db = await fixture(t);
  const {rows} = await db.query("select has_function_privilege('anon','private.procurement_actor_has_current_tier(uuid,text)','execute') a, has_function_privilege('authenticated','private.procurement_actor_has_current_tier(uuid,text)','execute') b, has_function_privilege('service_role','private.procurement_actor_has_current_tier(uuid,text)','execute') c");
  assert.deepEqual(rows[0],{a:false,b:false,c:false});
});
test('historical private activation ACLs remain closed and ordinary users cannot bypass the checker', async t => {
  const db = await fixture(t);
  const { rows } = await db.query("select has_function_privilege('anon','private.policy_activate_doa_matrix(jsonb)','execute') a, has_function_privilege('authenticated','private.policy_activate_doa_matrix(jsonb)','execute') b, has_function_privilege('service_role','private.policy_activate_doa_matrix(jsonb)','execute') c");
  assert.deepEqual(rows[0], { a: false, b: false, c: false });
  await assert.rejects(rpc(db, 'private.policy_activate_doa_matrix', { id: matrix }), /permission denied/i);
  assert.equal((await db.query('select status from procurement.doa_matrices where id=$1', [matrix])).rows[0].status, 'draft');
});
