import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { CANDIDATE, PASS_RULES, REQUIREMENT, EVIDENCE_BACKED_PRACTICE, vendorBaselineQuery, renderAutomatedVendorEvidenceDryRun } from './publish-vendor-evidence-learning.mjs';
import { renderVendorEvidenceActivation, vendorPublishedFingerprintQuery } from './activate-vendor-evidence-learning.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const owner = '5f86c147-34aa-4722-be5b-ed085caf97eb';
const reviewer = 'ab803856-0f20-4d1a-abe6-8444052725f2';
const foundation = readFileSync(new URL('../supabase/migrations/20260812130000_learning_foundation.sql', import.meta.url), 'utf8');

test('actual lifecycle publishes inactive, preserves prior rows, rejects drift and requires exact independent SQL approval', async () => {
  const db = new PGlite();
  const dir = mkdtempSync(join(tmpdir(), 'vendor-inactive-local-'));
  try {
    await db.exec(`create schema core; create schema learning; create schema private;
      create table core.profiles(id uuid primary key,email text,kind text,status text);
      insert into core.profiles values('${owner}','intra.test.admin@mwell.com.ph','employee','active'),('${reviewer}','intra.test.legal.lead@mwell.com.ph','employee','active');
      create table core.departments(id uuid primary key);
      create table core.roles(module text,role text,is_active boolean,primary key(module,role));
      insert into core.roles values('core','platform_admin',true),('core','vendor_portal',true);
      create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
      insert into core.user_roles values('${owner}','core','platform_admin',now(),null);
      create table core.capabilities(module text,cap text,primary key(module,cap));
      insert into core.capabilities values('core','submit_accreditation');
      create function private.assert_learning_read_committed() returns void language sql as $$select$$;
      create function private.lock_learning_curriculum_graph(uuid[]) returns void language sql as $$select$$;`);
    for (const name of ['curricula','curriculum_versions','requirements','requirement_versions','curriculum_requirements',
      'curriculum_requirement_prerequisites','curriculum_capability_outcomes','role_curricula']) {
      const start = foundation.indexOf(`create table learning.${name} (`);
      assert.ok(start >= 0);
      await db.exec(foundation.slice(start, foundation.indexOf('\n);', start) + 3));
    }
    const root = (await db.query(`insert into learning.curricula(catalog_key,audience,governance_owner,created_by)
      values('vendor.role.core.vendor_portal.capability-practice.v1.curriculum','vendor','platform',$1) returning id`, [owner])).rows[0].id;
    const base = (await db.query(`insert into learning.curriculum_versions(curriculum_id,audience,version,status,change_reason,materiality,owner_id,reviewer_id,approved_at,published_at,effective_at)
      values($1,'vendor',1,'published','fixture','material',$2,$3,now(),now(),now()) returning id`, [root,owner,reviewer])).rows[0].id;
    const members = [];
    for (const [order,key,kind] of [[0,'vendor.vendor_representative.orientation.v1','orientation'],[1,'vendor.role.core.vendor_portal.capability-practice.v1','scenario']]) {
      const r = (await db.query(`insert into learning.requirements(requirement_key,audience,requirement_kind,governance_owner,created_by)
        values($1,'vendor',$2,'platform',$3) returning id`, [key,kind,owner])).rows[0].id;
      const rv = (await db.query(`insert into learning.requirement_versions(requirement_id,audience,requirement_kind,governance_owner,version,status,title,simulation_id,estimated_minutes,change_reason,materiality,source_references,owner_id,reviewer_id,approved_at,published_at,effective_at)
        values($1,'vendor',$2,'platform',1,'published',$3,'fixture',3,'fixture','material','[{"fixture":true}]',$4,$5,now(),now(),now()) returning id`, [r,kind,key,owner,reviewer])).rows[0].id;
      const cr = (await db.query(`insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
        values($1,$2,'vendor',$3,true,$4) returning id`, [base,rv,order,owner])).rows[0].id;
      members.push({rv,cr});
    }
    await db.query(`insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
      values($1,$2,$3,$4,'vendor',$5)`,[members[1].cr,base,members[1].rv,members[0].rv,owner]);
    await db.query(`insert into learning.curriculum_capability_outcomes(curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
      values($1,$2,$3,'vendor','core','submit_accreditation',$4)`,[members[1].cr,base,members[1].rv,owner]);
    await db.query(`insert into learning.role_curricula(module,role,curriculum_version_id,audience,effective_at,created_by)
      values('core','vendor_portal',$1,'vendor',now(),$2)`,[base,owner]);
    for (const fn of ['private.validate_curriculum_graph_publication(', 'learning.guard_content_lifecycle()', 'learning.guard_curriculum_composition()']) {
      const start = foundation.indexOf('create or replace function ' + fn);
      assert.ok(start >= 0);
      await db.exec(foundation.slice(start, foundation.indexOf('$$;',start)+3));
    }
    for (const table of ['requirement_versions','curriculum_versions']) await db.exec(`create trigger lifecycle before insert or update or delete on learning.${table} for each row execute function learning.guard_content_lifecycle()`);
    for (const table of ['curriculum_requirements','curriculum_requirement_prerequisites','curriculum_capability_outcomes']) await db.exec(`create trigger composition before insert or update or delete on learning.${table} for each row execute function learning.guard_curriculum_composition()`);
    const baselineFingerprint = (await db.query(vendorBaselineQuery())).rows[0].fingerprint;
    // Fictional local review artifacts, not Maxwell's review or production evidence.
    const artifact = {reviewMode:'automated',verdict:'approved',key:'vendor_evidence',projectRef:'kkoitlvydytdhlpxhuah',candidate:CANDIDATE,
      authorAgentId:'local-author',reviewerAgentId:'local-reviewer',userAuthorizationReference:'LOCAL FIXTURE ONLY; no actual review',
      reviewedAt:'2026-09-01T00:00:00Z',baselineFingerprint,inactivePublicationPolicy:'publish_inactive_no_role_maps',
      catalogSha256:hash(execFileSync('git',['show',CANDIDATE+':modules/learning/src/catalog.ts'])),passRulesSha256:hash(JSON.stringify(PASS_RULES))};
    const reviewArtifactPath = join(dir,'review.json');
    writeFileSync(reviewArtifactPath,JSON.stringify(artifact));
    const input = {projectRef:artifact.projectRef,candidate:CANDIDATE,authorAgentId:artifact.authorAgentId,reviewerAgentId:artifact.reviewerAgentId,
      userAuthorizationReference:artifact.userAuthorizationReference,reviewArtifactPath,reviewArtifactSha256:hash(JSON.stringify(artifact)),baselineFingerprint,mode:'publish-inactive-rehearsal'};
    const sql = renderAutomatedVendorEvidenceDryRun(input);
    assert.doesNotMatch(sql,/insert into learning.role_curricula|update learning.certifications|delete from learning/i);
    for (let i=0;i<2;i++) {
      const results = await db.exec(sql);
      const published = results.find(result=>result.rows?.[0]?.requirement_key)?.rows[0];
      assert.equal(published.status,'published');
      assert.deepEqual(published.pass_rules,PASS_RULES);
      assert.equal(published.source_references[1].human_review_claimed,false);
      assert.equal((await db.query(vendorBaselineQuery())).rows[0].fingerprint,baselineFingerprint);
      assert.equal((await db.query('select count(*)::int as n from learning.curriculum_versions')).rows[0].n,1);
    }
    assert.throws(()=>renderAutomatedVendorEvidenceDryRun({...input,baselineFingerprint:'0'.repeat(32)}),/exact vendor baseline/);
    for (const patch of [{baselineFingerprint:undefined},{baselineFingerprint:'0'.repeat(32)},{inactivePublicationPolicy:undefined},{inactivePublicationPolicy:'activate'}]) {
      const body=JSON.stringify({...artifact,...patch}); writeFileSync(reviewArtifactPath,body);
      assert.throws(()=>renderAutomatedVendorEvidenceDryRun({...input,reviewArtifactSha256:hash(body)}),/exact vendor baseline/);
    }
    writeFileSync(reviewArtifactPath,JSON.stringify(artifact));
    await db.query("update learning.curricula set status='retired' where id=$1",[root]);
    await assert.rejects(db.exec(sql));
    await db.exec('rollback');
    await db.query("update learning.curricula set status='active' where id=$1",[root]);
    assert.throws(()=>renderAutomatedVendorEvidenceDryRun({...input,mode:'apply'}),/execution approval/i);
    const execution = {reviewMode:'automated',executionApproved:true,authorAgentId:input.authorAgentId,reviewerAgentId:input.reviewerAgentId,
      projectRef:input.projectRef,candidate:input.candidate,baselineFingerprint,reviewArtifactSha256:input.reviewArtifactSha256,
      activationPolicy:'publish_inactive_no_role_maps',userAuthorizationReference:input.userAuthorizationReference,rehearsalSqlSha256:hash(sql)};
    const executionApprovalPath = join(dir,'execution.json');
    const renderApply = change => {
      const body=JSON.stringify({...execution,...change}); writeFileSync(executionApprovalPath,body);
      return renderAutomatedVendorEvidenceDryRun({...input,mode:'apply',executionApprovalPath,executionApprovalSha256:hash(body)});
    };
    for (const change of [{rehearsalSqlSha256:'0'.repeat(64)},{baselineFingerprint:'0'.repeat(32)},{reviewerAgentId:input.authorAgentId},{activationPolicy:'activate'}]) assert.throws(()=>renderApply(change),/exact inactive publication/);
    const apply = renderApply({});
    assert.match(apply,/commit;\s*$/);
    await db.exec(apply);
    assert.equal((await db.query(vendorBaselineQuery())).rows[0].fingerprint,baselineFingerprint);
    assert.equal((await db.query('select count(*)::int as n from learning.role_curricula')).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int as n from learning.curriculum_versions where status='published'")).rows[0].n,2);
    assert.equal((await db.query('select count(*)::int as n from learning.requirement_versions')).rows[0].n,4);
    const newPractice=(await db.query("select rv.* from learning.requirement_versions rv join learning.requirements r on r.id=rv.requirement_id where r.requirement_key=$1",[EVIDENCE_BACKED_PRACTICE])).rows[0];
    const oldPractice=(await db.query("select * from learning.requirement_versions where id=$1",[members[1].rv])).rows[0];
    assert.notEqual(newPractice.requirement_id,oldPractice.requirement_id);
    assert.equal(newPractice.version,1);
    for(const key of ['title','simulation_id','requirement_kind','pass_rules','assessment_settings','passing_score','max_attempts','content_reference']) assert.deepEqual(newPractice[key],oldPractice[key]);
    assert.equal(newPractice.status,'published');
    const membership=(await db.query("select cr.requirement_version_id from learning.curriculum_requirements cr join learning.curriculum_versions cv on cv.id=cr.curriculum_version_id where cv.version=2")).rows;
    assert.ok(membership.some(row=>row.requirement_version_id===newPractice.id));
    assert.ok(!membership.some(row=>row.requirement_version_id===oldPractice.id));
    const curricula=[];
    for(const cv of (await db.query('select * from learning.curriculum_versions order by version')).rows) {
      const requirements=[];
      const rows=(await db.query(`select rv.*,r.requirement_key,cr.mandatory from learning.curriculum_requirements cr
        join learning.requirement_versions rv on rv.id=cr.requirement_version_id join learning.requirements r on r.id=rv.requirement_id
        where cr.curriculum_version_id=$1 order by cr.sort_order`,[cv.id])).rows;
      for(const row of rows) {
        const prereqs=(await db.query(`select r.requirement_key from learning.curriculum_requirement_prerequisites e
          join learning.requirement_versions rv on rv.id=e.prerequisite_requirement_version_id join learning.requirements r on r.id=rv.requirement_id
          where e.curriculum_version_id=$1 and e.requirement_version_id=$2 order by r.requirement_key`,[cv.id,row.id])).rows;
        const outcomes=(await db.query('select module,capability from learning.curriculum_capability_outcomes where curriculum_version_id=$1 and requirement_version_id=$2 order by module,capability',[cv.id,row.id])).rows;
        requirements.push({id:row.requirement_key,version:row.version,audience:row.audience,kind:row.requirement_kind,title:row.title,
          mandatory:row.mandatory,simulationId:row.simulation_id,prerequisiteIds:prereqs.map(p=>p.requirement_key),capabilityOutcomes:outcomes});
      }
      curricula.push({curriculum:{id:'vendor.role.core.vendor_portal.capability-practice.v1.curriculum',version:cv.version,audience:'vendor'},requirements,source:'role'});
    }
    const localRequire=createRequire(new URL('../apps/shell/package.json',import.meta.url));
    const bundle=localRequire('esbuild').buildSync({entryPoints:[fileURLToPath(new URL('../modules/learning/src/taskReadiness.ts',import.meta.url))],
      bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
    const exports={exports:{}};
    new Function('module','exports','require',bundle)(exports,exports.exports,localRequire);
    const snapshot={curricula,progress:curricula.flatMap(c=>c.requirements.map(r=>({requirementId:r.id,requirementVersion:r.version,state:'not_started'}))),lockedCapabilities:[]};
    const projection=exports.exports.projectTaskLearning(snapshot,'vendor',[{module:'core',capability:'submit_accreditation'}],false);
    assert.equal(projection.status,'known');
    assert.ok(projection.neededNow.some(r=>r.id===REQUIREMENT));
    assert.ok(projection.neededNow.some(r=>r.id===EVIDENCE_BACKED_PRACTICE));
    assert.equal(projection.neededNow.filter(r=>r.id==='vendor.vendor_representative.orientation.v1').length,1);
    const publishedFingerprint=(await db.query(vendorPublishedFingerprintQuery())).rows[0].fingerprint;
    const health={surface:'public_alias',healthy:true,projectRef:input.projectRef,commit:input.candidate,observedAt:'2026-09-01T00:00:00Z'};
    const publicHealthPath=join(dir,'health.json');
    writeFileSync(publicHealthPath,JSON.stringify(health));
    const publicHealthSha256=hash(JSON.stringify(health));
    const activation={reviewMode:'automated',verdict:'approved',key:'vendor_evidence',authorAgentId:input.authorAgentId,reviewerAgentId:input.reviewerAgentId,
      candidate:input.candidate,projectRef:input.projectRef,baselineFingerprint,publishedFingerprint,publicHealthSha256,
      reviewArtifactSha256:input.reviewArtifactSha256,userAuthorizationReference:input.userAuthorizationReference,activationPolicy:'add_current_version_preserve_prior'};
    const activationReviewPath=join(dir,'activation.json');
    writeFileSync(activationReviewPath,JSON.stringify(activation));
    const activationInput={...input,mode:'rehearsal',publishedFingerprint,publicHealthPath,publicHealthSha256,activationReviewPath,activationReviewSha256:hash(JSON.stringify(activation))};
    const activationSql=renderVendorEvidenceActivation(activationInput);
    assert.match(activationSql,/rollback;\s*$/);
    await db.exec('begin');
    await db.query("insert into learning.curriculum_versions(curriculum_id,audience,version,status,change_reason,materiality,owner_id) values($1,'vendor',3,'draft','local newer-version fixture','material',$2)",[root,owner]);
    await assert.rejects(db.exec(activationSql),/Newer vendor curriculum/);
    await db.exec('rollback');
    await db.exec(activationSql);
    assert.equal((await db.query('select count(*)::int as n from learning.role_curricula')).rows[0].n,1);
    assert.throws(()=>renderVendorEvidenceActivation({...activationInput,publishedFingerprint:'0'.repeat(32)}),/activation review/);
    writeFileSync(publicHealthPath,JSON.stringify({...health,surface:'protected_preview'}));
    assert.throws(()=>renderVendorEvidenceActivation({...activationInput,publicHealthSha256:hash(JSON.stringify({...health,surface:'protected_preview'}))}),/public-alias/);
    writeFileSync(publicHealthPath,JSON.stringify(health));
    assert.throws(()=>renderVendorEvidenceActivation({...activationInput,mode:'apply'}),/artifact hash/);
    await assert.rejects(db.exec(apply),/newer content already exists/); await db.exec('rollback');
    await assert.rejects(db.query("update learning.requirement_versions set title='illegal rewrite' where requirement_id in (select id from learning.requirements where requirement_key=$1)",[REQUIREMENT]),/immutable/);
  } finally { await db.close(); rmSync(dir,{recursive:true,force:true}); }
});
