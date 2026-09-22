import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const actor = '00000000-0000-4000-8000-000000000011';
const requester = '00000000-0000-4000-8000-000000000012';
const other = '00000000-0000-4000-8000-000000000013';
const checker = '00000000-0000-4000-8000-000000000014';
const matrix = '00000000-0000-4000-8000-000000000015';
const draft = '00000000-0000-4000-8000-000000000016';
const read = file => readFileSync(`supabase/migrations/${file}`, 'utf8');
function definition(sql, name) {
  const start = sql.indexOf(`create or replace function ${name}(`);
  const end = sql.indexOf('$$;', start);
  assert.ok(start >= 0 && end > start, name);
  return sql.slice(start, end + 3);
}
async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  // Only authentication/session and certification are test dependencies. The
  // real eligibility, locked decision, activation and role checks run below.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema private; create schema procurement;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email','head@example.test') $$;
    create table core.profiles(id uuid primary key,kind text,status text,full_name text,email text);
    create table core.departments(code text primary key,is_active boolean);
    create table core.roles(module text,role text,is_active boolean,primary key(module,role));
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz default now(),expires_at timestamptz);
    create table core.role_capabilities(module text,role text,cap text);
    create function core.is_vendor() returns boolean language sql stable as $$ select exists(select 1 from core.profiles where id=auth.uid() and kind='vendor') $$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$
      select exists(select 1 from core.user_roles u join core.roles r using(module,role)
        join core.role_capabilities c using(module,role) join core.profiles p on p.id=u.user_id
        where u.user_id=auth.uid() and p.status='active' and r.is_active and u.module=$1 and c.cap=$2
        and u.effective_at<=statement_timestamp() and (u.expires_at is null or u.expires_at>statement_timestamp())) $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$
      select core.has_cap($1,$2) and coalesce(current_setting('test.certified',true),'true')<>'false' $$;
    create function core.has_module_role(text) returns boolean language sql stable as $$ select exists(select 1 from core.user_roles where user_id=auth.uid() and module=$1) $$;
    create function private.policy_can_manage_doa() returns boolean language sql stable as $$ select core.has_live_cap('legal','manage_doa') $$;
    create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    create table procurement.requests(id text primary key,requester_id uuid,status text,department text,category text,estimated_amount numeric,
      decided_at timestamptz,decided_by_email text,decision_note text,updated_at timestamptz);
    create table procurement.approval_steps(id text primary key,request_id text,status text,step_order int,assigned_user_id uuid,tier text,
      matrix_version text,request_version int default 1,note text,decided_at timestamptz,decided_by_email text,signature jsonb);
    create table procurement.doa_matrices(id uuid primary key,department text,version text unique,active boolean,status text,created_by uuid,
      effective_at timestamptz,expires_at timestamptz,updated_at timestamptz,activated_by uuid,activated_at timestamptz,approved_by_name text,approved_at timestamptz);
    create table procurement.doa_assignments(id uuid primary key default gen_random_uuid(),matrix_id uuid,department text,tier text,
      min_amount numeric,max_amount numeric,category text,active boolean,approver_user_id uuid);
    insert into core.profiles values('${actor}','employee','active','Department Head','head@example.test'),
      ('${requester}','employee','active','Requester','requester@example.test'),('${other}','employee','active','Procurement','procurement@example.test'),
      ('${checker}','employee','active','Policy checker','checker@example.test');
    insert into core.departments values('operations',true),('marketing',true);
    insert into core.roles values('procurement','approver',true),('procurement','admin',true),('procurement','finance',true),('procurement','procurement_officer',true),('legal','legal_admin',true);
    insert into core.role_capabilities select module,role,case when module='legal' then 'manage_doa' else 'approve_request' end from core.roles;
    insert into core.user_roles(user_id,module,role) values('${actor}','procurement','approver'),('${other}','procurement','admin'),('${checker}','legal','legal_admin');
    insert into procurement.requests(id,requester_id,status,department,category,estimated_amount) values('request','${requester}','under_review','operations','goods',340);
    insert into procurement.approval_steps(id,request_id,status,step_order,assigned_user_id,tier,matrix_version) values
      ('department','request','approved',1,'${actor}','dept_head','OPS-1'),('procurement','request','approved',2,'${other}','procurement_head','OPS-1'),
      ('final','request','pending',3,'${actor}','final_approver','OPS-1');
    insert into procurement.doa_matrices values('${matrix}','operations','OPS-1',true,'active','${checker}',now()-interval '1 day',null,null,'${other}',now(),'Approved owner',now()),
      ('${draft}','operations','OPS-DRAFT',false,'draft','${other}',now()-interval '1 day',null,null,null,null,'Pending activation',now());
    insert into procurement.doa_assignments(matrix_id,department,tier,min_amount,max_amount,category,active,approver_user_id) values
      ('${matrix}','operations','final_approver',100,500,'goods',true,'${actor}'),('${draft}','operations','final_approver',100,500,'goods',true,'${actor}');
    select set_config('test.actor','${actor}',false);
  `);
  const baseline = read('20260905090000_procurement_remediation.sql');
  await db.exec(definition(read('20260810155350_procurement_legal_database_authority_remediation.sql'), 'procurement.decide_request_step')
    .replace('function procurement.decide_request_step(', 'function procurement.decide_request_step_uncertified_impl('));
  for (const name of ['private.has_current_procurement_tier','procurement.request_decision_eligibility','procurement.decide_request_step']) await db.exec(definition(baseline,name));
  await db.exec(definition(read('20260711090000_department_doa_administration.sql'),'private.policy_activate_doa_matrix'));
  await db.exec(definition(read('20260816230000_repair_quality_acceptance_and_doa_activation.sql'),'procurement.activate_doa_matrix'));
  await db.exec(`
    grant usage on schema auth,core,procurement to authenticated;
    revoke all on function private.policy_activate_doa_matrix(jsonb) from public,anon,authenticated,service_role;
    revoke all on function procurement.decide_request_step_uncertified_impl(jsonb) from public,anon,authenticated;
    grant execute on function procurement.decide_request_step_uncertified_impl(jsonb) to service_role;
    revoke all on function procurement.decide_request_step(jsonb), procurement.request_decision_eligibility(jsonb), procurement.activate_doa_matrix(jsonb) from public,anon,service_role;
    grant execute on function procurement.decide_request_step(jsonb), procurement.request_decision_eligibility(jsonb), procurement.activate_doa_matrix(jsonb) to authenticated;
  `);
  await db.exec(read('20260922111953_procurement_doa_tier_guard.sql'));
  await db.exec(read('20260922123940_procurement_final_approval_doa_authority.sql'));
  return db;
}
const rpc = (db,name,payload) => db.transaction(async tx => {
  await tx.exec('set local role authenticated');
  return (await tx.query(`select ${name}($1::jsonb) result`,[JSON.stringify(payload)])).rows[0].result;
});
const eligible = db => rpc(db,'procurement.request_decision_eligibility',{request_id:'request'});
const signature = {signature_png:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',signer_name:'Department Head',signature_method:'typed'};
const decide = (db,override={}) => rpc(db,'procurement.decide_request_step',{request_id:'request',step_id:'final',tier:'final_approver',decision:'approved',signature,...override});
const snapshot = async db => (await db.query(`select jsonb_build_object('requests',(select jsonb_agg(to_jsonb(r) order by id) from procurement.requests r),
  'steps',(select jsonb_agg(to_jsonb(s) order by id) from procurement.approval_steps s),'audit',(select jsonb_agg(to_jsonb(a)) from core.activity_log a)) data`)).rows[0].data;

test('named department head completes final DOA approval without Procurement admin or changed history',async t=>{
  const db=await fixture(t), before=await snapshot(db);
  assert.equal((await eligible(db)).canDecide,true);
  assert.equal((await decide(db)).status,'approved');
  const after=await snapshot(db);
  assert.deepEqual(after.steps.filter(s=>s.id!=='final'),before.steps.filter(s=>s.id!=='final'));
  assert.deepEqual(after.steps.find(s=>s.id==='final').signature,signature);
  assert.equal(after.audit.length,1);
  assert.equal(after.audit[0].actor,actor);
  assert.equal((await db.query('select role from core.user_roles where user_id=$1',[actor])).rows[0].role,'approver');
});
for(const [label,mutation,code] of [
  ['wrong department',"update procurement.requests set department='marketing'",'approval_doa_required'],
  ['wrong category',"update procurement.requests set category='services'",'approval_doa_required'],
  ['below amount band','update procurement.requests set estimated_amount=99.99','approval_doa_required'],
  ['above amount band','update procurement.requests set estimated_amount=500.01','approval_doa_required'],
  ['unknown amount','update procurement.requests set estimated_amount=null','approval_doa_required'],
  ['nonfinite amount',"update procurement.requests set estimated_amount='NaN'; update procurement.doa_assignments set max_amount=null",'approval_doa_required'],
  ['infinite amount',"update procurement.requests set estimated_amount='Infinity'; update procurement.doa_assignments set max_amount=null",'approval_doa_required'],
  ['negative amount','update procurement.requests set estimated_amount=-1','approval_doa_required'],
  ['NaN lower assignment bound',`update procurement.doa_assignments set min_amount='NaN' where matrix_id='${matrix}'`,'approval_doa_required'],
  ['NaN upper assignment bound',`update procurement.doa_assignments set max_amount='NaN' where matrix_id='${matrix}'`,'approval_doa_required'],
  ['infinite upper assignment bound',`update procurement.doa_assignments set max_amount='Infinity' where matrix_id='${matrix}'`,'approval_doa_required'],
  ['inactive matrix',`update procurement.doa_matrices set active=false where id='${matrix}'`,'approval_doa_required'],
  ['draft matrix',`update procurement.doa_matrices set status='draft' where id='${matrix}'`,'approval_doa_required'],
  ['future matrix',`update procurement.doa_matrices set effective_at=now()+interval '1 day' where id='${matrix}'`,'approval_doa_required'],
  ['expired matrix',`update procurement.doa_matrices set expires_at=now()-interval '1 second' where id='${matrix}'`,'approval_doa_required'],
  ['revoked DOA assignment',`update procurement.doa_assignments set active=false where matrix_id='${matrix}'`,'approval_doa_required'],
  ['assignment department drift',`update procurement.doa_assignments set department='marketing' where matrix_id='${matrix}'`,'approval_doa_required'],
  ['inactive department',"update core.departments set is_active=false where code='operations'",'approval_doa_required'],
  ['missing step version',"update procurement.approval_steps set matrix_version=null where id='final'",'approval_doa_required'],
  ['stale step version',"update procurement.approval_steps set matrix_version='OPS-OLD' where id='final'",'approval_doa_required'],
  ['changed DOA actor',`update procurement.doa_assignments set approver_user_id='${other}' where matrix_id='${matrix}'`,'approval_doa_required'],
  ['missing role','delete from core.user_roles where user_id=\''+actor+'\'','approval_role_required'],
  ['expired role',`update core.user_roles set expires_at=now()-interval '1 second' where user_id='${actor}'`,'approval_role_required'],
  ['future role',`update core.user_roles set effective_at=now()+interval '1 day' where user_id='${actor}'`,'approval_role_required'],
  ['inactive role',"update core.roles set is_active=false where role='approver'",'approval_role_required'],
  ['removed approval capability',"delete from core.role_capabilities where role='approver'",'approval_role_required'],
  ['inactive employee',`update core.profiles set status='inactive' where id='${actor}'`,'approval_role_required'],
  ['missing profile',`delete from core.profiles where id='${actor}'`,'approval_role_required'],
  ['nonemployee profile',`update core.profiles set kind='external' where id='${actor}'`,'approval_role_required'],
  ['missing certification',"select set_config('test.certified','false',false)",'approval_training_required'],
]) test(`${label} denies eligibility and direct decision without writes`,async t=>{
  const db=await fixture(t); await db.exec(mutation);
  const before=await snapshot(db), result=await eligible(db);
  assert.equal(result.canDecide,false); assert.equal(result.reasonCode,code);
  await assert.rejects(decide(db)); assert.deepEqual(await snapshot(db),before);
});
for(const amount of [100,500]) test(`inclusive DOA amount boundary ${amount} is usable`,async t=>{
  const db=await fixture(t); await db.query('update procurement.requests set estimated_amount=$1',[amount]);
  assert.equal((await decide(db)).status,'approved');
});
test('an explicit all-category DOA band is usable',async t=>{
  const db=await fixture(t); await db.exec('update procurement.doa_assignments set category=null');
  assert.equal((await decide(db)).status,'approved');
});
for(const target of [actor,other]) test(`overlapping final assignments fail closed, actor ${target}`,async t=>{
  const db=await fixture(t); await db.exec(`insert into procurement.doa_assignments(matrix_id,department,tier,min_amount,max_amount,category,active,approver_user_id)
    values('${matrix}','operations','final_approver',0,null,null,true,'${target}')`);
  assert.equal((await eligible(db)).reasonCode,'approval_doa_required'); await assert.rejects(decide(db));
});
test('two current matrices cannot select an arbitrary final authority',async t=>{
  const db=await fixture(t); await db.exec(`update procurement.doa_matrices set active=true,status='active' where id='${draft}'`);
  assert.equal((await eligible(db)).reasonCode,'approval_doa_required'); await assert.rejects(decide(db));
});
for(const [label,mutation] of [
  ['self request',`update procurement.requests set requester_id='${actor}'`],
  ['unassigned step',"update procurement.approval_steps set assigned_user_id=null where id='final'"],
  ['unassigned Procurement admin',`select set_config('test.actor','${other}',false)`],
  ['vendor',`update core.profiles set kind='vendor' where id='${actor}'`],
  ['anonymous caller',"select set_config('test.actor','',false)"],
  ['earlier pending step',"update procurement.approval_steps set status='pending' where id='procurement'"],
  ['already closed request',"update procurement.requests set status='approved'"],
]) test(`${label} cannot use final authority`,async t=>{
  const db=await fixture(t); await db.exec(mutation); const before=await snapshot(db);
  assert.equal((await eligible(db)).canDecide,false); await assert.rejects(decide(db)); assert.deepEqual(await snapshot(db),before);
});
for(const override of [{step_id:'department'},{tier:'procurement_head'},{signature:null},{decision:'invented'}]) test(`decision payload validation preserved: ${JSON.stringify(override)}`,async t=>{
  const db=await fixture(t), before=await snapshot(db);
  assert.equal((await eligible(db)).canDecide,true); await assert.rejects(decide(db,override)); assert.deepEqual(await snapshot(db),before);
});
test('step-id-only compatibility still uses the actual request DOA',async t=>{
  const db=await fixture(t); assert.equal((await decide(db,{request_id:undefined})).status,'approved');
});
test('reject and repeat decision keep existing status and immutable audit behavior',async t=>{
  const db=await fixture(t); assert.equal((await decide(db,{decision:'rejected',signature:null,note:'Not needed'})).status,'rejected');
  const after=await snapshot(db); await assert.rejects(decide(db)); assert.deepEqual(await snapshot(db),after);
});
test('separate policy checker can activate a named department-head final assignment',async t=>{
  const db=await fixture(t); await db.exec(`select set_config('test.actor','${checker}',false)`);
  assert.equal((await rpc(db,'procurement.activate_doa_matrix',{matrix_id:draft})).status,'active');
  // A new policy does not silently rewrite the current request's frozen ladder.
  await db.exec(`select set_config('test.actor','${actor}',false)`);
  assert.equal((await eligible(db)).reasonCode,'approval_doa_required');
  assert.equal((await db.query("select matrix_version from procurement.approval_steps where id='final'")).rows[0].matrix_version,'OPS-1');
});
test('policy activation still rejects expired assignees and maker self-activation',async t=>{
  const db=await fixture(t); await db.exec(`select set_config('test.actor','${checker}',false); update core.user_roles set expires_at=now()-interval '1 day' where user_id='${actor}'`);
  await assert.rejects(rpc(db,'procurement.activate_doa_matrix',{matrix_id:draft}),/required role/i);
  await db.exec(`update core.user_roles set expires_at=null; update procurement.doa_matrices set created_by='${checker}' where id='${draft}'`);
  await assert.rejects(rpc(db,'procurement.activate_doa_matrix',{matrix_id:draft}),/separate DOA checker/i);
});
test('legacy delegate and scoped helper are not API bypasses',async t=>{
  const db=await fixture(t);
  for(const name of ['procurement.decide_request_step_uncertified_impl(jsonb)','private.procurement_final_doa_matches(procurement.requests,procurement.approval_steps)']) {
    const {rows}=await db.query("select has_function_privilege('anon',$1,'execute') a,has_function_privilege('authenticated',$1,'execute') b,has_function_privilege('service_role',$1,'execute') c",[name]);
    assert.deepEqual(rows[0],{a:false,b:false,c:false});
  }
  await assert.rejects(rpc(db,'procurement.decide_request_step_uncertified_impl',{request_id:'request',decision:'approved',signature}),/permission denied/i);
});

for (const [tier,module,role,wrongRole] of [
  ['dept_head','procurement','approver','finance'],
  ['procurement_head','procurement','procurement_officer','approver'],
  ['procurement_head','procurement','admin','finance'],
  ['finance','procurement','finance','approver'],
  ['legal','legal','legal_admin','approver'],
]) {
  for (const allowed of [true,false]) test(`nonfinal ${tier}/${role} ${allowed?'retains authority':'rejects the wrong role'} without final DOA`,async t=>{
    const db=await fixture(t);
    await db.exec('delete from procurement.doa_assignments; delete from procurement.doa_matrices');
    await db.query("update procurement.approval_steps set tier=$1 where id='final'",[tier]);
    await db.query('delete from core.user_roles where user_id=$1',[actor]);
    await db.query('insert into core.user_roles(user_id,module,role) values($1,$2,$3)',[actor,allowed?module:'procurement',allowed?role:wrongRole]);
    await db.exec("insert into core.role_capabilities values('legal','legal_admin','review_accreditation')");
    const before=await snapshot(db);
    if (allowed) {
      assert.equal((await eligible(db)).canDecide,true);
      assert.equal((await decide(db,{tier})).status,'approved');
      const after=await snapshot(db);
      assert.deepEqual(after.steps.filter(s=>s.id!=='final'),before.steps.filter(s=>s.id!=='final'));
      assert.deepEqual(after.steps.find(s=>s.id==='final').signature,signature);
      assert.equal(after.audit.length,1);
      assert.equal(after.audit[0].detail.tier,tier);
    } else {
      assert.equal((await eligible(db)).reasonCode,'approval_role_required');
      await assert.rejects(decide(db,{tier}));
      assert.deepEqual(await snapshot(db),before);
    }
  });
}
