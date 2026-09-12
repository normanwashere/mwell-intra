import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const old = read('20260812200000_learning_authority');
const start = old.indexOf('create or replace function learning.has_active_certification(');
const previous = old.slice(start, old.indexOf('$$;', start) + 3);
const migration = read('20260912131000_vendor_certification_scope_authority');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [user, department, role, assignment, curriculum, requirement, vendor] = [1, 2, 3, 4, 5, 6, 7].map(id);

test('completed vendor training works without internal scope; source, identity and learning guards remain strict', async () => {
  const db = new PGlite();
  const check = async () => (await db.query(`select learning.has_active_certification('${user}','core','submit_accreditation') as allowed`)).rows[0].allowed;
  try {
    await db.exec(`
      create schema learning; create schema core; create schema legal;
      create role authenticated; create role anon; create role service_role;
      create table core.user_roles(id uuid,user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
      create table core.roles(module text,role text,is_active boolean);
      create table core.role_capabilities(module text,role text,cap text);
      create table core.departments(id uuid,code text,is_active boolean);
      create table core.profile_department_scopes(profile_id uuid,department_id uuid,effective_from date,effective_to date);
      create table core.profiles(id uuid,kind text,status text,vendor_id uuid);
      create table legal.vendor_invites(auth_user_id uuid,vendor_id uuid,status text,accepted_generation int,link_generation int);
      create table learning.certifications(user_id uuid,department_id uuid,source_role_assignment_id uuid,source_role text,
        module text,capability text,status text,effective_at timestamptz,expires_at timestamptz,audience text,
        assignment_id uuid,curriculum_version_id uuid,requirement_version_ids uuid[]);
      create table learning.assignments(id uuid,user_id uuid,department_id uuid,profile_kind text,audience text,
        source_type text,source_id uuid,status text,curriculum_version_id uuid);
      create table learning.curriculum_versions(id uuid,audience text,status text,effective_at timestamptz,expires_at timestamptz);
      create table learning.requirement_versions(id uuid,audience text,status text,effective_at timestamptz,expires_at timestamptz);
      create table learning.assignment_requirements(assignment_id uuid,user_id uuid,department_id uuid,audience text,
        requirement_version_id uuid,status text);
      insert into core.user_roles values('${role}','${user}','core','vendor_portal',now()-interval '1 day',null);
      insert into core.roles values('core','vendor_portal',true);
      insert into core.role_capabilities values('core','vendor_portal','submit_accreditation');
      insert into core.departments values('${department}','legal_compliance',true);
      insert into core.profiles values('${user}','vendor','active','${vendor}');
      insert into legal.vendor_invites values('${user}','${vendor}','accepted',1,1);
      insert into learning.certifications values('${user}','${department}','${role}','vendor_portal','core','submit_accreditation',
        'active',now()-interval '1 day',null,'vendor','${assignment}','${curriculum}',array['${requirement}']::uuid[]);
      insert into learning.assignments values('${assignment}','${user}','${department}','vendor','vendor','role','${role}','completed','${curriculum}');
      insert into learning.curriculum_versions values('${curriculum}','vendor','published',now()-interval '1 day',null);
      insert into learning.requirement_versions values('${requirement}','vendor','published',now()-interval '1 day',null);
      insert into learning.assignment_requirements values('${assignment}','${user}','${department}','vendor','${requirement}','passed');
      ${previous}
      revoke all on function learning.has_active_certification(uuid,text,text) from public,anon,authenticated,service_role;
    `);
    assert.equal(await check(), false, 'Reproduce the current false denial for a legitimately completed vendor');
    const beforeAcl = (await db.query("select proacl,proowner from pg_proc where oid='learning.has_active_certification(uuid,text,text)'::regprocedure")).rows;
    await db.exec(migration);
    assert.equal(await check(), true);
    await db.exec("update learning.assignment_requirements set status='waived'");
    assert.equal(await check(), true, 'A recorded governed waiver retains its already-issued certification');
    await db.exec("update learning.assignment_requirements set status='passed'");
    assert.deepEqual((await db.query("select proacl,proowner from pg_proc where oid='learning.has_active_certification(uuid,text,text)'::regprocedure")).rows, beforeAcl);
    assert.equal((await db.query('select count(*)::int n from core.profile_department_scopes')).rows[0].n, 0);
    const invalid = [
      "update learning.certifications set status='revoked'",
      "update learning.certifications set expires_at=now()-interval '1 day'",
      "update learning.certifications set effective_at=now()+interval '1 day'",
      `update learning.certifications set source_role_assignment_id='${id(90)}'`,
      "update core.user_roles set effective_at=now()+interval '1 day'",
      "update core.user_roles set expires_at=now()-interval '1 day'",
      'update core.roles set is_active=false',
      'delete from core.role_capabilities',
      'update core.departments set is_active=false',
      "update core.departments set code='finance'",
      "update core.profiles set kind='employee'",
      "update core.profiles set status='inactive'",
      `update core.profiles set vendor_id='${id(99)}'`,
      "update legal.vendor_invites set status='sent'",
      'update legal.vendor_invites set accepted_generation=0',
      'delete from legal.vendor_invites',
      "update learning.certifications set audience='internal'",
      "update learning.assignments set status='assigned'",
      `update learning.assignments set source_id='${id(90)}'`,
      `update learning.assignments set user_id='${id(90)}'`,
      `update learning.assignments set department_id='${id(90)}'`,
      "update learning.assignments set profile_kind='employee'",
      "update learning.assignments set audience='internal'",
      "update learning.curriculum_versions set status='draft'",
      "update learning.curriculum_versions set expires_at=now()-interval '1 day'",
      "update learning.requirement_versions set status='draft'",
      "update learning.requirement_versions set effective_at=now()+interval '1 day'",
      "update learning.assignment_requirements set status='not_started'",
      `update learning.assignment_requirements set user_id='${id(90)}'`,
      "update learning.certifications set requirement_version_ids='{}'",
      `update learning.certifications set requirement_version_ids=array['${id(90)}']::uuid[]`,
    ];
    for (const sql of invalid) {
      await db.exec('begin');
      try { await db.exec(sql); assert.equal(await check(), false, sql); }
      finally { await db.exec('rollback'); }
    }
    // Employee certifications still require their actual, effective department.
    await db.exec(`delete from legal.vendor_invites;
      update core.profiles set kind='employee';
      update learning.certifications set audience='internal';
      insert into core.profile_department_scopes values('${user}','${department}',current_date-1,null);`);
    assert.equal(await check(), true);
    await db.exec('update core.profile_department_scopes set effective_to=current_date-1');
    assert.equal(await check(), false);
    await db.exec('update core.profile_department_scopes set effective_to=null, effective_from=current_date+1');
    assert.equal(await check(), false);
    await db.exec(migration);
    assert.equal(await check(), false, 'Reapplying does not add authority');
  } finally { await db.close(); }
});
