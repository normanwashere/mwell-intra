import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url),'utf8');
const authority = read('20260812200000_learning_authority.sql');
const scoped = read('20260816203000_scope_certification_pathways_to_assigned_roles.sql');
const migration = read('20260911171901_learning_authority_plan_reuse.sql');
const fn = (source,name) => {
  const start=source.indexOf(`create or replace function ${name}(`);
  assert(start>=0);
  return source.slice(start,source.indexOf('$$;',start)+3);
};
const actor='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const department='33333333-3333-4333-8333-333333333333';
const id='44444444-4444-4444-8444-444444444444';
const variations=[
  '',
  "update learning.certifications set status='revoked'",
  "update learning.certifications set expires_at=now()-interval '1 day'",
  "update learning.certifications set effective_at=now()+interval '1 day'",
  'update core.roles set is_active=false',
  "update core.user_roles set expires_at=now()-interval '1 day'",
  "update core.profile_department_scopes set effective_to=current_date-1",
  'update core.departments set is_active=false',
  "update learning.curriculum_versions set status='draft'",
  "update learning.requirement_versions set status='draft'",
  "update learning.role_curricula set expires_at=now()-interval '1 day'",
  "update learning.requirement_versions set waivable=true",
  "update learning.emergency_exceptions set grantor_id=user_id",
  "update learning.emergency_exceptions set approver_id=grantor_id",
  "update learning.emergency_exceptions set expires_at=now()-interval '1 day'",
  "update learning.emergency_exceptions set waives_legal_acknowledgment=true",
  'delete from core.role_capabilities',
  "select set_config('test.actor','','false')",
];
test('query-plan reuse preserves real learning predicates, ACLs and fresh role/scope/publication decisions',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`
      create schema core;create schema learning;create schema auth;create role authenticated;create role anon;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create table core.user_roles(id uuid,user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
      create table core.roles(module text,role text,is_active boolean);
      create table core.role_capabilities(module text,role text,cap text);
      create table core.profile_department_scopes(profile_id uuid,department_id uuid,effective_from date,effective_to date);
      create table core.departments(id uuid,is_active boolean);
      create table learning.mutation_capability_rules(module text,capability text);
      create table learning.role_curricula(module text,role text,effective_at timestamptz,expires_at timestamptz,department_id uuid,curriculum_version_id uuid,audience text);
      create table learning.curriculum_versions(id uuid,audience text,status text,effective_at timestamptz,expires_at timestamptz);
      create table learning.requirement_versions(id uuid,audience text,status text,effective_at timestamptz,expires_at timestamptz,requirement_kind text,waivable boolean);
      create table learning.curriculum_capability_outcomes(curriculum_version_id uuid,audience text,module text,capability text,requirement_version_id uuid,curriculum_requirement_id uuid);
      create table learning.curriculum_requirements(id uuid,curriculum_version_id uuid,requirement_version_id uuid,audience text,mandatory boolean);
      create table learning.certifications(user_id uuid,source_role_assignment_id uuid,module text,source_role text,capability text,department_id uuid,status text,effective_at timestamptz,expires_at timestamptz);
      create table learning.emergency_exceptions(user_id uuid,department_id uuid,module text,capability text,audience text,status text,effective_at timestamptz,expires_at timestamptz,grantor_id uuid,approver_id uuid,waives_legal_acknowledgment boolean);
      insert into core.user_roles values('${id}','${actor}','warehouse','operator',now()-interval '1 day',null);
      insert into core.roles values('warehouse','operator',true);
      insert into core.role_capabilities values('warehouse','operator','manage_returns');
      insert into core.profile_department_scopes values('${actor}','${department}',current_date-1,null);
      insert into core.departments values('${department}',true);
      insert into learning.mutation_capability_rules values('warehouse','manage_returns');
      insert into learning.role_curricula values('warehouse','operator',now()-interval '1 day',null,'${department}','${id}','internal');
      insert into learning.curriculum_versions values('${id}','internal','published',now()-interval '1 day',null);
      insert into learning.requirement_versions values('${id}','internal','published',now()-interval '1 day',null,'policy',false);
      insert into learning.curriculum_capability_outcomes values('${id}','internal','warehouse','manage_returns','${id}','${id}');
      insert into learning.curriculum_requirements values('${id}','${id}','${id}','internal',true);
      insert into learning.certifications values('${actor}','${id}','warehouse','operator','manage_returns','${department}','active',now()-interval '1 day',null);
      insert into learning.emergency_exceptions values('${actor}','${department}','warehouse','manage_returns','internal','active',now()-interval '1 day',now()+interval '1 day','${other}','${id}',false);
      ${fn(scoped,'learning.is_certification_required')}
      ${fn(authority,'learning.has_active_certification')}
      ${fn(authority,'learning.has_active_emergency_exception')}
      revoke all on all functions in schema learning from public,anon,authenticated;
      set test.actor='${actor}';
    `);
    const original=(await db.query("select proname,prosrc,proacl,proowner,provolatile,prosecdef,proconfig from pg_proc where pronamespace='learning'::regnamespace order by proname")).rows;
    const snapshot=async()=>{
      const outcomes=[];
      for(const variation of variations){
        await db.exec('begin');
        if(variation) await db.exec(variation);
        outcomes.push((await db.query(`select learning.is_certification_required('warehouse','manage_returns') required,
          learning.has_active_certification('${actor}','warehouse','manage_returns') certified,
          learning.has_active_emergency_exception('${actor}','warehouse','manage_returns') emergency,
          learning.has_active_certification('${other}','warehouse','manage_returns') foreign_actor,
          learning.is_certification_required(null,null) null_capability`)).rows[0]);
        await db.exec('rollback');
      }
      return outcomes;
    };
    const before=await snapshot();
    assert.deepEqual(before[0],{required:true,certified:true,emergency:false,foreign_actor:false,null_capability:false});
    assert.equal(before[1].certified,false);
    assert.equal(before[11].emergency,true);
    await db.exec(migration);
    assert.deepEqual(await snapshot(),before);
    const after=(await db.query("select proname,prosrc,proacl,proowner,provolatile,prosecdef,proconfig from pg_proc where pronamespace='learning'::regnamespace order by proname")).rows;
    for(let i=0;i<original.length;i++){
      assert(after[i].prosrc.includes(original[i].prosrc.replace(/;\s*$/,'')), 'Original SELECT must be unchanged');
      assert.deepEqual({...after[i],prosrc:null},{...original[i],prosrc:null}, 'Owner, grants and security attributes must not change');
    }
    await db.exec(migration);
    assert.deepEqual(await snapshot(),before);
  } finally {await db.close();}
});
