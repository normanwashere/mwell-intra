import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = new URL('../../../supabase/migrations/20260920030900_event_seller_learning_readiness.sql', import.meta.url);
const checkpoints = ['verify-assignment', 'verify-custody', 'record-outcome', 'retry-intent', 'reverse-correction', 'handoff-finance'];

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema private; create schema learning;
    create table learning.curricula(id text,catalog_key text,audience text,status text);
    create table learning.requirements(id text,requirement_key text,audience text,requirement_kind text,status text);
    create table learning.curriculum_versions(id text,curriculum_id text,version int,audience text,status text,owner_id text,reviewer_id text,
      approved_at timestamptz,published_at timestamptz,effective_at timestamptz,expires_at timestamptz);
    create table learning.requirement_versions(id text,requirement_id text,version int,audience text,requirement_kind text,status text,owner_id text,reviewer_id text,
      approved_at timestamptz,published_at timestamptz,effective_at timestamptz,expires_at timestamptz,
      simulation_id text,max_attempts int,waivable boolean,assessment_settings jsonb,passing_score numeric,pass_rules jsonb);
    create table learning.curriculum_requirements(id text,curriculum_version_id text,requirement_version_id text,audience text,sort_order int,mandatory boolean);
    create table learning.curriculum_requirement_prerequisites(curriculum_requirement_id text,curriculum_version_id text,requirement_version_id text,prerequisite_requirement_version_id text,audience text);
    create table learning.curriculum_capability_outcomes(curriculum_requirement_id text,curriculum_version_id text,requirement_version_id text,audience text,module text,capability text);
    create table learning.role_curricula(id text,module text,role text,curriculum_version_id text,audience text,department_id text,effective_at timestamptz,expires_at timestamptz);
    create table learning.certifications(id text);`);
  if (existsSync(migration)) await db.exec(readFileSync(migration, 'utf8'));
  return db;
}

async function seed(db) {
  await db.exec(`insert into learning.curricula values('c','internal.role.events.seller.v1','internal','active');
    insert into learning.curriculum_versions values('cv','c',1,'internal','published','owner','reviewer',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day',null);
    insert into learning.requirements values('r','internal.role.events.seller.custody-practice.v1','internal','scenario','active'),
      ('o','internal.general_employee.orientation.v1','internal','orientation','active');
    insert into learning.requirement_versions values('rv','r',1,'internal','scenario','published','owner','reviewer',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day',null,
      'event-seller-custody-v1',3,false,'{}',null,'{"required_checkpoints":${JSON.stringify(checkpoints)}}'),
      ('ov','o',1,'internal','orientation','published','owner','reviewer',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day',null,
      'internal.general_employee.orientation.v1',null,false,'{}',null,'{"required_checkpoints":["complete"]}');
    insert into learning.curriculum_requirements values('cm-o','cv','ov','internal',1,true),('cm-r','cv','rv','internal',2,true);
    insert into learning.curriculum_requirement_prerequisites values('cm-r','cv','rv','ov','internal');
    insert into learning.curriculum_capability_outcomes values('cm-r','cv','rv','internal','events','record_event_outcome');
    insert into learning.role_curricula values('rc','events','seller','cv','internal',null,now()-interval '1 day',null);`);
}

async function ready(db) {
  assert.notEqual((await db.query("select to_regprocedure('private.event_seller_learning_ready()')::text id")).rows[0].id, null, 'Seller publication readiness helper must exist');
  return (await db.query('select private.event_seller_learning_ready() ready')).rows[0].ready;
}

test('seller publication readiness is exact, read-only and private', async (t) => {
  const db = await fixture();
  try {
    await t.test('missing publication fails closed; approved graph is ready without certifying a user', async () => {
      assert.equal(await ready(db), false);
      await seed(db);
      assert.equal(await ready(db), true);
      assert.equal((await db.query('select count(*)::int n from learning.certifications')).rows[0].n, 0);
    });
    await t.test('rejects incomplete, stale, broadened and wrongly scoped graphs', async () => {
      assert.equal(await ready(db), true);
      const mutations = [
        "delete from learning.role_curricula",
        "update learning.role_curricula set department_id='another-department'",
        "update learning.role_curricula set role='coordinator'",
        "update learning.role_curricula set effective_at=now()+interval '1 day'",
        "update learning.role_curricula set expires_at=now()",
        "update learning.curricula set status='retired'",
        ...["status='draft'", "status='approved'", "reviewer_id=owner_id", "approved_at=null", "published_at=null", "effective_at=now()+interval '1 day'", "expires_at=now()", "version=2"].map(set => `update learning.curriculum_versions set ${set}`),
        "update learning.requirements set status='retired' where id='r'",
        ...["status='in_review'", "status='approved'", "reviewer_id=owner_id", "approved_at=null", "published_at=null", "effective_at=now()+interval '1 day'", "expires_at=now()", "simulation_id='event-fulfillment-reconciliation-v1'", "max_attempts=99", "waivable=true", "audience='vendor'", "version=2", "assessment_settings='{\"skip\":true}'", "passing_score=0", "pass_rules='{\"required_checkpoints\":[\"verify-assignment\"]}'"].map(set => `update learning.requirement_versions set ${set} where id='rv'`),
        "update learning.requirement_versions set status='draft' where id='ov'",
        "update learning.requirement_versions set expires_at=now() where id='ov'",
        "delete from learning.curriculum_requirements where id='cm-o'",
        "update learning.curriculum_requirements set mandatory=false where id='cm-r'",
        "update learning.curriculum_requirements set sort_order=3 where id='cm-r'",
        "insert into learning.curriculum_requirements values('extra','cv','rv','internal',3,true)",
        "delete from learning.curriculum_requirement_prerequisites",
        "update learning.curriculum_requirement_prerequisites set prerequisite_requirement_version_id='rv'",
        "insert into learning.curriculum_requirement_prerequisites values('cm-o','cv','ov','rv','internal')",
        "delete from learning.curriculum_capability_outcomes",
        "update learning.curriculum_capability_outcomes set capability='manage_events'",
        "insert into learning.curriculum_capability_outcomes values('cm-r','cv','rv','internal','events','approve_settlement')",
        "insert into learning.curriculum_capability_outcomes values('cm-o','cv','ov','internal','events','record_event_outcome')",
      ];
      for (const mutation of mutations) {
        await db.exec('begin');
        try { await db.exec(mutation); assert.equal(await ready(db), false, mutation); }
        finally { await db.exec('rollback'); }
      }
      assert.equal(await ready(db), true);
    });
    await t.test('has no direct anon, authenticated or service role execute grant', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const row = (await db.query("select has_function_privilege($1,'private.event_seller_learning_ready()','execute') allowed", [role])).rows[0];
        assert.equal(row.allowed, false, role);
      }
    });
  } finally { await db.close(); }
});
