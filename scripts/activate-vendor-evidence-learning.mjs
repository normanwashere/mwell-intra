#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderAutomatedVendorEvidenceDryRun, vendorBaselineQuery } from './publish-vendor-evidence-learning.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
function checked(path, sha) {
  if (!/^[a-f0-9]{64}$/.test(sha ?? '')) throw new Error('Exact artifact hash required');
  const bytes = readFileSync(path);
  if (hash(bytes) !== sha) throw new Error('Artifact hash mismatch');
  return JSON.parse(bytes.toString('utf8'));
}

export function vendorPublishedFingerprintQuery() {
  return `select md5(jsonb_build_object(
    'root',to_jsonb(c),'version',to_jsonb(cv),
    'members',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_requirements x where x.curriculum_version_id=cv.id),
    'requirements',(select jsonb_agg(jsonb_build_object('root',to_jsonb(r),'version',to_jsonb(rv)) order by rv.id) from learning.curriculum_requirements m join learning.requirement_versions rv on rv.id=m.requirement_version_id join learning.requirements r on r.id=rv.requirement_id where m.curriculum_version_id=cv.id),
    'edges',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_requirement_prerequisites x where x.curriculum_version_id=cv.id),
    'outcomes',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_capability_outcomes x where x.curriculum_version_id=cv.id),
    'maps',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.role_curricula x where x.curriculum_version_id=cv.id)
  )::text) as fingerprint from learning.curricula c join learning.curriculum_versions cv on cv.curriculum_id=c.id
  where c.catalog_key='vendor.role.core.vendor_portal.capability-practice.v1.curriculum' and cv.version=2`;
}

export function renderVendorEvidenceActivation({ publishedFingerprint, publicHealthPath, publicHealthSha256,
  activationReviewPath, activationReviewSha256, mode='rehearsal', executionApprovalPath, executionApprovalSha256, ...input }) {
  if (!['rehearsal','apply'].includes(mode) || !/^[a-f0-9]{32}$/.test(publishedFingerprint ?? '')) throw new Error('Exact vendor activation mode and fingerprint required');
  renderAutomatedVendorEvidenceDryRun({...input,mode:'publish-inactive-rehearsal'});
  const health=checked(publicHealthPath,publicHealthSha256);
  const review=checked(activationReviewPath,activationReviewSha256);
  if (health.surface!=='public_alias' || health.healthy!==true || health.projectRef!==input.projectRef ||
    health.commit!==input.candidate || !Number.isFinite(Date.parse(health.observedAt)) || Date.parse(health.observedAt)>Date.now()) throw new Error('Compatible public-alias runtime evidence required');
  if (review.reviewMode!=='automated' || review.verdict!=='approved' || review.key!=='vendor_evidence' ||
    review.authorAgentId!==input.authorAgentId || review.reviewerAgentId!==input.reviewerAgentId ||
    review.candidate!==input.candidate || review.projectRef!==input.projectRef ||
    review.baselineFingerprint!==input.baselineFingerprint || review.publishedFingerprint!==publishedFingerprint ||
    review.publicHealthSha256!==publicHealthSha256 || review.reviewArtifactSha256!==input.reviewArtifactSha256 ||
    review.userAuthorizationReference!==input.userAuthorizationReference ||
    review.activationPolicy!=='add_current_version_preserve_prior') throw new Error('Exact independent vendor activation review required');
  const sql=`-- UAT vendor activation scaffold: render only, fail closed on incompatible shared obligations.
begin isolation level read committed;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $activate$
declare source_id uuid; target_id uuid; root_id uuid;
begin
  select c.id into strict root_id from learning.curricula c where
    c.catalog_key='vendor.role.core.vendor_portal.capability-practice.v1.curriculum'
    and c.status='active' and c.audience='vendor' and c.governance_owner='platform' for update;
  select cv.id into strict source_id from learning.curriculum_versions cv where cv.curriculum_id=root_id and cv.version=1
    and cv.status='published' and cv.effective_at<=statement_timestamp() and (cv.expires_at is null or cv.expires_at>statement_timestamp());
  select cv.id into strict target_id from learning.curriculum_versions cv where cv.curriculum_id=root_id and cv.version=2
    and cv.status='published' and cv.effective_at<=statement_timestamp() and (cv.expires_at is null or cv.expires_at>statement_timestamp());
  perform private.lock_learning_curriculum_graph(array[source_id,target_id]);
  if exists(select 1 from learning.curriculum_versions cv where cv.curriculum_id=root_id and cv.version>2)
    then raise exception 'Newer vendor curriculum exists; activation review stale'; end if;
  if (${vendorBaselineQuery()}) is distinct from ${q(input.baselineFingerprint)} or
    (${vendorPublishedFingerprintQuery()}) is distinct from ${q(publishedFingerprint)}
    then raise exception 'Vendor activation fingerprint drift'; end if;
  if exists(select 1 from learning.role_curricula rc where rc.curriculum_version_id=target_id)
    then raise exception 'Vendor v2 already mapped'; end if;
  if not exists(select 1 from core.profiles p join core.user_roles ur on ur.user_id=p.id
    join core.roles r on r.module=ur.module and r.role=ur.role
    where p.id='5f86c147-34aa-4722-be5b-ed085caf97eb' and p.email='intra.test.admin@mwell.com.ph'
    and p.kind='employee' and p.status='active' and ur.module='core' and ur.role='platform_admin' and r.is_active
    and ur.effective_at<=statement_timestamp() and (ur.expires_at is null or ur.expires_at>statement_timestamp()))
    then raise exception 'Active vendor activation custodian authority required'; end if;
  -- Both versions remain visible. Shared roots must retain identical obligations.
  if exists(
    select 1 from learning.curriculum_requirements a join learning.requirement_versions ar on ar.id=a.requirement_version_id
    join learning.curriculum_requirements b on b.curriculum_version_id=target_id
    join learning.requirement_versions br on br.id=b.requirement_version_id and br.requirement_id=ar.requirement_id
    where a.curriculum_version_id=source_id and (
      ar.id<>br.id or a.mandatory<>b.mandatory or
      (select coalesce(jsonb_agg(e.prerequisite_requirement_version_id order by e.prerequisite_requirement_version_id),'[]'::jsonb) from learning.curriculum_requirement_prerequisites e where e.curriculum_version_id=source_id and e.requirement_version_id=ar.id)
      is distinct from
      (select coalesce(jsonb_agg(e.prerequisite_requirement_version_id order by e.prerequisite_requirement_version_id),'[]'::jsonb) from learning.curriculum_requirement_prerequisites e where e.curriculum_version_id=target_id and e.requirement_version_id=br.id) or
      (select coalesce(jsonb_agg(jsonb_build_array(o.module,o.capability) order by o.module,o.capability),'[]'::jsonb) from learning.curriculum_capability_outcomes o where o.curriculum_version_id=source_id and o.requirement_version_id=ar.id)
      is distinct from
      (select coalesce(jsonb_agg(jsonb_build_array(o.module,o.capability) order by o.module,o.capability),'[]'::jsonb) from learning.curriculum_capability_outcomes o where o.curriculum_version_id=target_id and o.requirement_version_id=br.id)
    )) then raise exception 'Vendor additive activation has conflicting shared requirement definitions'; end if;
  insert into learning.role_curricula(module,role,curriculum_version_id,audience,department_id,effective_at,expires_at,created_by)
    select rc.module,rc.role,target_id,rc.audience,rc.department_id,statement_timestamp(),rc.expires_at,'5f86c147-34aa-4722-be5b-ed085caf97eb'::uuid
    from learning.role_curricula rc join core.roles r on r.module=rc.module and r.role=rc.role and r.is_active
    where rc.curriculum_version_id=source_id and rc.module='core' and rc.role='vendor_portal' and rc.audience='vendor'
      and rc.effective_at<=statement_timestamp() and (rc.expires_at is null or rc.expires_at>statement_timestamp());
  if not found then raise exception 'Current vendor source mapping missing'; end if;
end;
$activate$;
rollback;
`;
  if(mode==='rehearsal') return sql;
  const execution=checked(executionApprovalPath,executionApprovalSha256);
  if(execution.reviewMode!=='automated' || execution.executionApproved!==true ||
    execution.reviewerAgentId!==input.reviewerAgentId || execution.candidate!==input.candidate ||
    execution.activationReviewSha256!==activationReviewSha256 || execution.rehearsalSqlSha256!==hash(sql))
    throw new Error('Exact vendor activation SQL execution approval required');
  return sql.slice(0,-'rollback;\n'.length)+'commit;\n';
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==3) throw new Error('Explicit vendor activation JSON required; renderer only');
  process.stdout.write(renderVendorEvidenceActivation(JSON.parse(readFileSync(process.argv[2],'utf8'))));
}
