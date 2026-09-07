#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { renderVendorEvidenceDryRun } from './publish-vendor-evidence-learning.mjs';
import { SCOPED_READINESS_CANDIDATES } from '../modules/learning/src/scopedReadinessCandidates.ts';
import { SCOPED_READINESS_CANDIDATE_RULES } from '../modules/learning/src/scopedReadinessCandidateAuthority.server.ts';
import { OPS_HASHES, OPS_RULES_HASH, renderOpsAdditions } from './ops-mapping-additions.mjs';

export const RULES_HASH = 'deeb1dff8e5fa2998e59655bb66511a78a20becb5e01f8fafaaa8fd631f65a98';

export const CORRECTIONS = {
  warehouse_operator: {
    module: 'warehouse', role: 'warehouse_operator', capability: 'inspect_quality',
    curriculum: 'internal.warehouse.warehouse_operator.receiving-certification.v1',
    requirement: 'internal.role.warehouse.warehouse_operator.capability-practice.v1',
    additiveRequirement: 'internal.role.warehouse.warehouse_operator.quality-inspection.v1',
    simulation: 'warehouse-quality-inspection-review-v1',
    contentHash: '03ac69bd9e0ecf09898af99ac706085ea17f1860b222c1b3fa36f98efed062c8',
  },
  finance: {
    module: 'procurement', role: 'finance', capability: 'review_payment_readiness',
    curriculum: 'internal.role.procurement.finance.capability-practice.v1.curriculum',
    requirement: 'internal.role.procurement.finance.capability-practice.v1',
    additiveRequirement: 'internal.role.procurement.finance.payment-readiness.v1',
    simulation: 'procurement-payment-readiness-review-v1',
    contentHash: '901e4ee97aec872dd7efd4cc2d7975c59f15dfdedd8a29f986201d3072c6ac2b',
  },
  admin: {
    module: 'procurement', role: 'admin', capability: 'review_payment_readiness',
    curriculum: 'internal.role.procurement.admin.capability-practice.v1.curriculum',
    requirement: 'internal.role.procurement.admin.capability-practice.v1',
    additiveRequirement: 'internal.role.procurement.admin.payment-readiness.v1',
    simulation: 'procurement-payment-readiness-review-v1',
    contentHash: '901e4ee97aec872dd7efd4cc2d7975c59f15dfdedd8a29f986201d3072c6ac2b',
  },
};
const q = (x) => `'${String(x).replaceAll("'", "''")}'`;

export function scopedPassRules(content) {
  return { required_checkpoints: content.checkpointIds,
    checkpoint_outcomes: Object.fromEntries(content.embeddedSteps.map((step) => {
      const rule = SCOPED_READINESS_CANDIDATE_RULES[`${content.id}:${step.checkpointId}`];
      if (!rule || !step.choices.some((choice) => choice.id === rule.acceptedChoiceId)) throw new Error('Approved choice rule missing');
      return [step.checkpointId, [rule.acceptedChoiceId]];
    })) };
}

// The fingerprint covers full source rows, including content, provenance and graph.
export function baselineQuery(key, version = 1) {
  const c = CORRECTIONS[key];
  if (!c || ![1, 2].includes(version)) throw new Error('Unsupported correction');
  return `select md5(jsonb_build_object('curriculum',to_jsonb(c),'version',to_jsonb(cv),
    'members',(select jsonb_agg(to_jsonb(cr) order by cr.id) from learning.curriculum_requirements cr where cr.curriculum_version_id=cv.id),
    'requirements',(select jsonb_agg(to_jsonb(rv) order by rv.id) from learning.requirement_versions rv join learning.curriculum_requirements cr on cr.requirement_version_id=rv.id where cr.curriculum_version_id=cv.id),
    'edges',(select jsonb_agg(to_jsonb(e) order by e.id) from learning.curriculum_requirement_prerequisites e where e.curriculum_version_id=cv.id),
    'outcomes',(select jsonb_agg(to_jsonb(o) order by o.id) from learning.curriculum_capability_outcomes o where o.curriculum_version_id=cv.id),
    'mapping',(select jsonb_agg(to_jsonb(rc) order by rc.id) from learning.role_curricula rc where rc.curriculum_version_id=cv.id)
    )::text) as fingerprint from learning.curricula c join learning.curriculum_versions cv on cv.curriculum_id=c.id
    where c.catalog_key=${q(c.curriculum)} and cv.version=${version}`;
}

export function renderMappingCorrection({ key, baselineFingerprint, mode = 'draft', executionApprovalPath, executionApprovalSha256, ...review }) {
  if (!['draft','publish-rehearsal','apply'].includes(mode)) throw new Error('Unknown preparation mode');
  const c = CORRECTIONS[key];
  if (!c || !/^[a-f0-9]{32}$/.test(baselineFingerprint ?? '')) throw new Error('Exact correction and reviewed baseline fingerprint required');
  const automated = review.reviewMode === 'automated';
  if (mode !== 'draft' && !automated) throw new Error('Legacy human path remains draft-only');
  if (automated) {
    const allowed = ['projectRef', 'candidate', 'ownerEmail', 'reviewerEmail', 'reviewEvidence', 'reviewedAt',
      'reviewMode', 'authorAgentId', 'reviewerAgentId', 'reviewArtifactPath', 'reviewArtifactSha256', 'reviewedContentSha256', 'userAuthorizationReference'];
    if (Object.keys(review).some((name) => !allowed.includes(name)) || review.projectRef !== 'kkoitlvydytdhlpxhuah' ||
      !/^[a-f0-9]{40}$/.test(review.candidate ?? '') || review.ownerEmail !== 'intra.test.admin@mwell.com.ph' ||
      review.reviewerEmail !== 'intra.test.legal.lead@mwell.com.ph' ||
      !/^[a-zA-Z0-9_.:-]{3,160}$/.test(review.authorAgentId ?? '') ||
      !/^[a-zA-Z0-9_.:-]{3,160}$/.test(review.reviewerAgentId ?? '') || review.authorAgentId === review.reviewerAgentId ||
      !/^[a-f0-9]{64}$/.test(review.reviewArtifactSha256 ?? '') || review.reviewedContentSha256 !== c.contentHash ||
      typeof review.reviewArtifactPath !== 'string' || !review.reviewArtifactPath.trim() ||
      typeof review.userAuthorizationReference !== 'string' || review.userAuthorizationReference.trim().length < 12 ||
      !Number.isFinite(Date.parse(review.reviewedAt)) || Date.parse(review.reviewedAt) > Date.now()) {
      throw new Error('Explicit UAT automated review, independent agent evidence, exact content hash and authorization required');
    }
    const artifactBytes = readFileSync(review.reviewArtifactPath);
    if (createHash('sha256').update(artifactBytes).digest('hex') !== review.reviewArtifactSha256) throw new Error('Review artifact hash mismatch');
    const artifact = JSON.parse(artifactBytes.toString('utf8'));
    if (artifact.reviewMode !== 'automated' || artifact.verdict !== 'approved' ||
      artifact.authorAgentId !== review.authorAgentId || artifact.reviewerAgentId !== review.reviewerAgentId ||
      artifact.contentSha256 !== c.contentHash || artifact.rulesSha256 !== RULES_HASH || artifact.baselineFingerprint !== baselineFingerprint ||
      artifact.candidate !== review.candidate || artifact.projectRef !== review.projectRef || artifact.key !== key ||
      artifact.reviewedAt !== review.reviewedAt || artifact.userAuthorizationReference !== review.userAuthorizationReference) {
      throw new Error('Review artifact does not approve this exact content and baseline');
    }
    if (key === 'warehouse_operator' && (artifact.opsRulesSha256 !== OPS_RULES_HASH ||
      Object.entries(OPS_HASHES).some(([id, hash]) => artifact.opsContentHashes?.[id] !== hash))) {
      throw new Error('Full operator curriculum requires exact additional Ops content review');
    }
    if (mode !== 'draft' && (artifact.publicationPolicy !== 'publish_inactive_no_role_mapping' ||
      artifact.runtimeCandidate !== review.candidate || artifact.projectRef !== 'kkoitlvydytdhlpxhuah')) {
      throw new Error('Exact runtime candidate and inactive publication policy review required');
    }
    if (mode === 'apply') {
      const rehearsal = renderMappingCorrection({ ...review, key, baselineFingerprint, mode: 'publish-rehearsal' });
      if (!/^[a-f0-9]{64}$/.test(executionApprovalSha256 ?? '')) throw new Error('Execution approval artifact required');
      const executionBytes = readFileSync(executionApprovalPath);
      if (createHash('sha256').update(executionBytes).digest('hex') !== executionApprovalSha256) throw new Error('Execution approval hash mismatch');
      const execution = JSON.parse(executionBytes.toString('utf8'));
      if (execution.executionApproved !== true || execution.candidate !== review.candidate || execution.key !== key ||
        execution.baselineFingerprint !== baselineFingerprint || execution.reviewerAgentId !== review.reviewerAgentId ||
        execution.rehearsalSqlSha256 !== createHash('sha256').update(rehearsal).digest('hex')) {
        throw new Error('Apply requires explicit approval of exact publication rehearsal SQL');
      }
    }
  } else {
    // Preserve the existing genuine human-review path unchanged.
    renderVendorEvidenceDryRun(review);
  }
  const content = SCOPED_READINESS_CANDIDATES.find((draft) => draft.id === c.simulation);
  if (createHash('sha256').update(JSON.stringify(SCOPED_READINESS_CANDIDATE_RULES)).digest('hex') !== RULES_HASH) {
    throw new Error('Scoped evaluation rules drift');
  }
  if (!content || createHash('sha256').update(JSON.stringify(content)).digest('hex') !== c.contentHash ||
      JSON.stringify(content.capabilityOutcomes) !== JSON.stringify([{ module: c.module, capability: c.capability }])) {
    throw new Error('Scoped review content drift');
  }
  const passRules = scopedPassRules(content);
  const reference = { type: 'draft_mapping_content', candidate: review.candidate,
    review_reference: automated ? review.reviewArtifactPath : review.reviewEvidence, reviewed_at: review.reviewedAt,
    baseline_fingerprint: baselineFingerprint, simulation_id: content.id, content_sha256: c.contentHash,
    source: 'modules/learning/src/scopedReadinessCandidates.ts', rules_sha256: RULES_HASH,
    runtime_status: mode === 'draft' ? 'draft_runtime_registration_not_asserted' : 'registered_in_exact_reviewed_candidate',
    registered_runtime_candidate: mode === 'draft' ? null : review.candidate,
    publication_state: mode === 'draft' ? 'draft_not_approved' : 'reviewed_publication_inactive_no_role_mapping' };
  if (automated) Object.assign(reference, {
    review_mode: 'automated', author_agent_id: review.authorAgentId, reviewer_agent_id: review.reviewerAgentId,
    review_artifact_sha256: review.reviewArtifactSha256, user_authorization_reference: review.userAuthorizationReference,
    custodian_attribution: 'Existing UAT test profiles are audit custodians only; neither performed human review.',
    human_review_claimed: false,
  });
  return `-- UAT ONLY. Mode: ${mode === 'draft' ? 'draft' : 'reviewed publication'}. Execute only through main after review.
begin isolation level read committed;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $draft$
declare b learning.curriculum_versions%rowtype; v learning.curriculum_versions%rowtype;
  old_r learning.requirement_versions%rowtype; new_r learning.requirement_versions%rowtype;
  new_root learning.requirements%rowtype;
  extra_root learning.requirements%rowtype; extra_r learning.requirement_versions%rowtype;
  owner_actor uuid; reviewer_actor uuid;
begin
  select id into strict owner_actor from core.profiles where lower(email)=lower(${q(review.ownerEmail)}) and kind='employee' and status='active';
  select id into strict reviewer_actor from core.profiles where lower(email)=lower(${q(review.reviewerEmail)}) and kind='employee' and status='active';
  ${automated ? "if owner_actor<>'5f86c147-34aa-4722-be5b-ed085caf97eb'::uuid or reviewer_actor<>'ab803856-0f20-4d1a-abe6-8444052725f2'::uuid then raise exception 'UAT audit custodian identity drift'; end if;" : ''}
  if owner_actor=reviewer_actor then raise exception 'Independent actors required'; end if;
  if not exists(select 1 from core.user_roles ur join core.roles r on r.module=ur.module and r.role=ur.role
    where ur.user_id=owner_actor and ur.module='core' and ur.role='platform_admin' and r.is_active
    and ur.effective_at<=statement_timestamp() and (ur.expires_at is null or ur.expires_at>statement_timestamp()))
    then raise exception 'Active platform administrator required'; end if;
  if not exists(select 1 from core.role_capabilities where module=${q(c.module)} and role=${q(c.role)} and cap=${q(c.capability)})
    then raise exception 'Correction cannot grant absent role authority'; end if;
  select cv.* into strict b from learning.curriculum_versions cv join learning.curricula root on root.id=cv.curriculum_id
    where root.catalog_key=${q(c.curriculum)} and root.audience='internal' and root.governance_owner='platform' and root.status='active'
    and cv.version=1 and cv.status='published' and cv.effective_at<=statement_timestamp()
    and (cv.expires_at is null or cv.expires_at>statement_timestamp()) for share of cv,root;
  perform private.lock_learning_curriculum_graph(array[b.id]);
  if (${baselineQuery(key)}) is distinct from ${q(baselineFingerprint)} then raise exception 'Reviewed baseline drift'; end if;
  if exists(select 1 from learning.curriculum_versions cv where cv.curriculum_id=b.curriculum_id and cv.version>1)
    then raise exception 'Newer curriculum exists; never overwrite'; end if;
  select rv.* into strict old_r from learning.requirement_versions rv join learning.requirements root on root.id=rv.requirement_id
    join learning.curriculum_requirements cr on cr.requirement_version_id=rv.id and cr.curriculum_version_id=b.id
    where root.requirement_key=${q(c.requirement)} and rv.version=1 and rv.status='published' and rv.requirement_kind='scenario'
    and rv.effective_at<=statement_timestamp() and (rv.expires_at is null or rv.expires_at>statement_timestamp()) for share of rv;
  if exists(select 1 from learning.requirements r where r.requirement_key=${q(c.additiveRequirement)})
    then raise exception 'Additive requirement already exists; never overwrite'; end if;
  select * into strict new_root from learning.requirements where id=old_r.requirement_id;
  new_root := jsonb_populate_record(new_root,jsonb_build_object('id',gen_random_uuid(),'requirement_key',${q(c.additiveRequirement)},
    'created_by',owner_actor,'created_at',statement_timestamp(),'status','active'));
  insert into learning.requirements select new_root.*;
  new_r := jsonb_populate_record(old_r,jsonb_build_object('id',gen_random_uuid(),'requirement_id',new_root.id,'version',1,'status','draft',
    'owner_id',owner_actor,'reviewer_id',null,'approved_at',null,'published_at',null,'effective_at',null,'expires_at',null,
    'created_at',statement_timestamp(),'supersedes_id',null,'materiality','material',
    'change_reason',${q(mode === 'draft' ? `Draft explicit ${c.capability} learning coverage; not approved` : `Automated-reviewed ${c.capability} learning coverage for ${review.candidate}; inactive publication`)},
    'title',${q(content.title)},'simulation_id',${q(content.id)},
    'content_reference','modules/learning/src/scopedReadinessCandidates.ts#${content.id}',
    'assessment_settings','{}'::jsonb,'passing_score',null,'max_attempts',null,'estimated_minutes',6,
    'source_references',old_r.source_references||jsonb_build_array(${q(JSON.stringify(reference))}::jsonb),
    'pass_rules',${q(JSON.stringify(passRules))}::jsonb));
  insert into learning.requirement_versions select new_r.*;
  v := jsonb_populate_record(b,jsonb_build_object('id',gen_random_uuid(),'version',2,'status','draft',
    'owner_id',owner_actor,'reviewer_id',null,'approved_at',null,'published_at',null,'effective_at',null,'expires_at',null,
    'created_at',statement_timestamp(),'supersedes_id',b.id,'materiality','material',
    'change_reason',${q(mode === 'draft' ? `Draft ${c.capability} mapping; independent review required` : `Automated-reviewed ${c.capability} curriculum for ${review.candidate}; role activation separate`)},
    'source_references',b.source_references||jsonb_build_array(${q(JSON.stringify(reference))}::jsonb)));
  insert into learning.curriculum_versions select v.*;
  insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
    select v.id,cr.requirement_version_id,cr.audience,cr.sort_order,cr.mandatory,owner_actor
    from learning.curriculum_requirements cr where cr.curriculum_version_id=b.id;
  insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
    select v.id,new_r.id,'internal',max(cr.sort_order)+1,true,owner_actor from learning.curriculum_requirements cr where cr.curriculum_version_id=b.id;
  insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    select cr.id,v.id,cr.requirement_version_id,e.prerequisite_requirement_version_id,e.audience,owner_actor
    from learning.curriculum_requirement_prerequisites e join learning.curriculum_requirements cr
    on cr.curriculum_version_id=v.id and cr.requirement_version_id=e.requirement_version_id
    where e.curriculum_version_id=b.id;
  insert into learning.curriculum_capability_outcomes(curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
    select cr.id,v.id,cr.requirement_version_id,o.audience,o.module,o.capability,owner_actor
    from learning.curriculum_capability_outcomes o join learning.curriculum_requirements cr
    on cr.curriculum_version_id=v.id and cr.requirement_version_id=o.requirement_version_id
    where o.curriculum_version_id=b.id;
  insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    select cr.id,v.id,new_r.id,old_r.id,'internal',owner_actor from learning.curriculum_requirements cr
    where cr.curriculum_version_id=v.id and cr.requirement_version_id=new_r.id;
  insert into learning.curriculum_capability_outcomes(curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
    select cr.id,v.id,new_r.id,'internal',${q(c.module)},${q(c.capability)},owner_actor from learning.curriculum_requirements cr
    where cr.curriculum_version_id=v.id and cr.requirement_version_id=new_r.id;
  if (${baselineQuery(key)}) is distinct from ${q(baselineFingerprint)} then raise exception 'Baseline changed'; end if;
  ${key === 'warehouse_operator' ? renderOpsAdditions(reference) : ''}
  if exists(select rv.requirement_id from learning.curriculum_requirements cr
    join learning.requirement_versions rv on rv.id=cr.requirement_version_id
    where cr.curriculum_version_id=v.id group by rv.requirement_id having count(*)>1)
    then raise exception 'Competing requirement versions in proposed curriculum'; end if;
  ${mode === 'draft' ? '' : `
  update learning.requirement_versions set status='in_review' where id=new_r.id and status='draft';
  update learning.requirement_versions set status='approved',reviewer_id=reviewer_actor,approved_at=statement_timestamp(),effective_at=statement_timestamp()
    where id=new_r.id and status='in_review';
  update learning.requirement_versions set status='published',published_at=effective_at where id=new_r.id and status='approved';
  for extra_r in select rv.* from learning.requirement_versions rv join learning.curriculum_requirements cr on cr.requirement_version_id=rv.id
    where cr.curriculum_version_id=v.id and rv.status='draft' loop
    update learning.requirement_versions set status='in_review' where id=extra_r.id;
    update learning.requirement_versions set status='approved',reviewer_id=reviewer_actor,approved_at=statement_timestamp(),effective_at=statement_timestamp() where id=extra_r.id;
    update learning.requirement_versions set status='published',published_at=effective_at where id=extra_r.id;
  end loop;
  update learning.curriculum_versions set status='in_review' where id=v.id and status='draft';
  update learning.curriculum_versions set status='approved',reviewer_id=reviewer_actor,approved_at=statement_timestamp(),effective_at=statement_timestamp()
    where id=v.id and status='in_review';
  update learning.curriculum_versions set status='published',published_at=effective_at where id=v.id and status='approved';
  `}
end;
$draft$;
select cv.status,rv.version as requirement_version,rv.simulation_id,rv.pass_rules,rv.source_references,
  (select jsonb_agg(jsonb_build_array(o.module,o.capability) order by o.module,o.capability) from learning.curriculum_capability_outcomes o where o.curriculum_version_id=cv.id) as outcomes,
  (select count(*)::int from learning.curriculum_requirement_prerequisites e where e.curriculum_version_id=cv.id) as edges,
  (select count(*)=count(distinct member.requirement_id) from learning.curriculum_requirements membership
    join learning.requirement_versions member on member.id=membership.requirement_version_id
    where membership.curriculum_version_id=cv.id) as unique_requirement_roots
  from learning.curriculum_versions cv join learning.curricula c on c.id=cv.curriculum_id
  join learning.curriculum_requirements cr on cr.curriculum_version_id=cv.id
  join learning.requirement_versions rv on rv.id=cr.requirement_version_id
  where c.catalog_key=${q(c.curriculum)} and cv.version=2 and rv.requirement_id in
    (select id from learning.requirements where requirement_key=${q(c.additiveRequirement)});
${mode === 'apply' ? 'commit' : 'rollback'};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--baseline' && process.argv.length === 4) process.stdout.write(`${baselineQuery(process.argv[3])};\n`);
  else if (process.argv.length === 3) process.stdout.write(renderMappingCorrection(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
  else throw new Error('Provide review-input JSON, or --baseline warehouse_operator|finance|admin. Rendering only; no connection.');
}
