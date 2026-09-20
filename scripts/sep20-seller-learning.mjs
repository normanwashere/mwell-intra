import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EVENT_SELLER_SIMULATION, EVENT_SELLER_REQUIREMENT, EVENT_SELLER_CURRICULUM } from '../modules/learning/src/eventSellerTraining.ts';
import { EVENT_SELLER_CHOICE_RULES } from '../modules/learning/src/eventSellerTrainingAuthority.server.ts';
import { MANIFEST as m } from './sep20-seller-learning-manifest.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const manifestSha256 = sha256(JSON.stringify(m));
export const STAGES = ['draft', 'submit-review', 'approve-requirement', 'publish-requirement', 'approve-curriculum', 'publish-curriculum'];
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const j = (value) => `${q(JSON.stringify(value))}::jsonb`;
const ids = m.ids;
const requirementKey = EVENT_SELLER_REQUIREMENT.id;
const curriculumKey = EVENT_SELLER_CURRICULUM.id;
const passRules = { required_checkpoints: EVENT_SELLER_SIMULATION.checkpointIds };
const versions = `select id from learning.curriculum_versions where curriculum_id in
  (select id from learning.curricula where catalog_key=${q(curriculumKey)}) or id=${q(ids.curriculumVersion)}::uuid`;
const requirementVersions = `select id from learning.requirement_versions where requirement_id in
  (select id from learning.requirements where requirement_key=${q(requirementKey)}) or id=${q(ids.requirementVersion)}::uuid`;
const baseReference = {
  type: 'seller_learning_draft', manifest_sha256: manifestSha256,
  content_sha256: m.contentSha256, rules_sha256: m.rulesSha256,
  base_revision: m.baseRevision, source_state: m.sourceState,
  author_agent_id: m.authorAgentId, user_authorization_reference: m.userAuthorizationReference,
  custodian_attribution: 'Existing UAT test profiles are audit custodians only; neither performed human review.',
  human_review_claimed: false, publication_policy: m.publicationPolicy,
};

export function assertSource() {
  if (sha256(JSON.stringify({ simulation: EVENT_SELLER_SIMULATION, requirement: EVENT_SELLER_REQUIREMENT,
    curriculum: EVENT_SELLER_CURRICULUM })) !== m.contentSha256 ||
    sha256(JSON.stringify(EVENT_SELLER_CHOICE_RULES)) !== m.rulesSha256) throw new Error('Frozen seller source hash drift');
}

function rows(table, predicate) {
  return `(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from ${table} t where ${predicate})`;
}

// Full rows, all matching versions, graph, and mappings: even an unexpected addition changes the digest.
export function stateQuery() {
  return `select jsonb_build_object(
  'requirement_roots',${rows('learning.requirements', `t.requirement_key=${q(requirementKey)} or t.id=${q(ids.requirementRoot)}::uuid`)},
  'requirements',${rows('learning.requirement_versions', `t.id in (${requirementVersions})`)},
  'curriculum_roots',${rows('learning.curricula', `t.catalog_key=${q(curriculumKey)} or t.id=${q(ids.curriculumRoot)}::uuid`)},
  'curricula',${rows('learning.curriculum_versions', `t.id in (${versions})`)},
  'members',${rows('learning.curriculum_requirements', `t.curriculum_version_id in (${versions}) or t.requirement_version_id in (${requirementVersions})`)},
  'edges',${rows('learning.curriculum_requirement_prerequisites', `t.curriculum_version_id in (${versions}) or t.requirement_version_id in (${requirementVersions}) or t.prerequisite_requirement_version_id in (${requirementVersions})`)},
  'outcomes',${rows('learning.curriculum_capability_outcomes', `t.curriculum_version_id in (${versions}) or t.requirement_version_id in (${requirementVersions})`)},
  'mappings',${rows('learning.role_curricula', `(t.module='events' and t.role='seller') or t.curriculum_version_id in (${versions})`)},
  'orientation',(select jsonb_build_object('root',to_jsonb(orientation_root),'version',to_jsonb(orientation_version))
    from learning.requirements orientation_root join learning.requirement_versions orientation_version on orientation_version.requirement_id=orientation_root.id
    where orientation_version.id=${q(m.orientationVersionId)}::uuid)
  ) as state`;
}

export function fingerprintQuery() {
  return `select md5(state::text) as fingerprint from (${stateQuery()}) snapshot`;
}

export function preflightSql() {
  return `begin read only;
select statement_timestamp() as observed_at, md5(state::text) as fingerprint, state,
  (select jsonb_agg(jsonb_build_object('id',id,'name',full_name,'kind',kind,'status',status) order by id)
    from core.profiles where id in (${q(m.ownerId)},${q(m.reviewerId)})) as audit_custodians,
  to_regprocedure('private.event_seller_learning_ready()') is not null as readiness_helper_present
from (${stateQuery()}) snapshot;
commit;`;
}

function readArtifact(path, hash, kind) {
  if (typeof path !== 'string' || !path.trim() || !/^[a-f0-9]{64}$/.test(hash ?? '')) throw new Error(`${kind} artifact and hash required`);
  const bytes = readFileSync(path);
  if (sha256(bytes) !== hash) throw new Error(`${kind} artifact hash mismatch`);
  return JSON.parse(bytes.toString('utf8'));
}

function actualTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now();
}

export function reviewReference(input) {
  const a = readArtifact(input.reviewArtifactPath, input.reviewArtifactSha256, 'Review');
  if (a.schemaVersion !== 1 || a.reviewMode !== 'automated' || a.humanReviewClaimed !== false ||
    a.verdict !== 'approved' || a.scope !== 'seller_learning_content_and_inactive_publication' ||
    a.projectRef !== m.projectRef || a.authorAgentId !== m.authorAgentId || a.reviewerAgentId !== m.reviewerAgentId ||
    a.authorAgentId === a.reviewerAgentId || a.manifestSha256 !== manifestSha256 ||
    a.contentSha256 !== m.contentSha256 || a.rulesSha256 !== m.rulesSha256 ||
    !actualTimestamp(a.reviewedAt) || a.userAuthorizationReference !== m.userAuthorizationReference ||
    !Array.isArray(a.findings) || a.activationApproved !== false) throw new Error('Independent AI artifact does not approve the exact manifest');
  return { type: 'seller_learning_ai_review', review_mode: 'automated', human_review_claimed: false,
    author_agent_id: a.authorAgentId, reviewer_agent_id: a.reviewerAgentId,
    manifest_sha256: manifestSha256, review_artifact_sha256: input.reviewArtifactSha256,
    reviewed_at: a.reviewedAt, user_authorization_reference: a.userAuthorizationReference,
    publication_policy: m.publicationPolicy, activation_approved: false,
    custodian_attribution: baseReference.custodian_attribution };
}

const expectedStages = {
  'submit-review': ['draft', 'draft'],
  'approve-requirement': ['in_review', 'in_review'],
  'publish-requirement': ['approved', 'in_review'],
  'approve-curriculum': ['published', 'in_review'],
  'publish-curriculum': ['published', 'approved'],
  'activate-role-mapping': ['published', 'published'],
};

export function graphCheck(operation, reference) {
  const [requirementStatus, curriculumStatus] = expectedStages[operation];
  const reqRefs = ['approved', 'published'].includes(requirementStatus) ? [baseReference, reference] : [baseReference];
  const cvRefs = ['approved', 'published'].includes(curriculumStatus) ? [baseReference, reference] : [baseReference];
  return `
  select * into strict r from learning.requirement_versions where id=${q(ids.requirementVersion)}::uuid;
  select * into strict cv from learning.curriculum_versions where id=${q(ids.curriculumVersion)}::uuid;
  if r.status<>${q(requirementStatus)} or cv.status<>${q(curriculumStatus)} then raise exception 'Wrong seller stage; no replay or auto-advance'; end if;
  if (select count(*) from learning.requirement_versions where requirement_id=${q(ids.requirementRoot)}::uuid)<>1
    or (select count(*) from learning.curriculum_versions where curriculum_id=${q(ids.curriculumRoot)}::uuid)<>1
    or not exists(select 1 from learning.requirements where id=${q(ids.requirementRoot)}::uuid and requirement_key=${q(requirementKey)}
      and audience='internal' and requirement_kind='scenario' and governance_owner='platform' and owner_department_id is null and status='active' and created_by=${q(m.ownerId)}::uuid)
    or not exists(select 1 from learning.curricula where id=${q(ids.curriculumRoot)}::uuid and catalog_key=${q(curriculumKey)}
      and audience='internal' and governance_owner='platform' and owner_department_id is null and status='active' and created_by=${q(m.ownerId)}::uuid)
    then raise exception 'Seller root/version drift'; end if;
  if r.requirement_id<>${q(ids.requirementRoot)}::uuid or r.audience<>'internal' or r.requirement_kind<>'scenario'
    or r.governance_owner<>'platform' or r.owner_department_id is not null or r.version<>1
    or r.title<>${q(EVENT_SELLER_SIMULATION.title)} or r.simulation_id is distinct from ${q(EVENT_SELLER_SIMULATION.id)}
    or r.content_reference is distinct from 'modules/learning/src/eventSellerTraining.ts#event-seller-custody-v1'
    or r.pass_rules<>${j(passRules)} or r.assessment_settings<>'{}'::jsonb or r.passing_score is not null
    or r.max_attempts is distinct from 3 or r.waivable or r.estimated_minutes<>${m.estimatedMinutes}
    or r.owner_id<>${q(m.ownerId)}::uuid or r.source_references<>${j(reqRefs)} or r.expires_at is not null or r.supersedes_id is not null
    or r.change_reason<>${q(m.changeReason)} or r.materiality<>'material'
    or cv.curriculum_id<>${q(ids.curriculumRoot)}::uuid or cv.audience<>'internal' or cv.version<>1
    or cv.owner_id<>${q(m.ownerId)}::uuid or cv.source_references<>${j(cvRefs)} or cv.expires_at is not null or cv.supersedes_id is not null
    or cv.change_reason<>${q(m.changeReason)} or cv.materiality<>'material'
    then raise exception 'Seller manifest/content drift'; end if;
  if (r.status in ('draft','in_review') and (r.reviewer_id is not null or r.approved_at is not null or r.published_at is not null or r.effective_at is not null))
    or (r.status in ('approved','published') and (r.reviewer_id is distinct from ${q(m.reviewerId)}::uuid or r.approved_at is null or r.effective_at is null))
    or (cv.status in ('draft','in_review') and (cv.reviewer_id is not null or cv.approved_at is not null or cv.published_at is not null or cv.effective_at is not null))
    or (cv.status in ('approved','published') and (cv.reviewer_id is distinct from ${q(m.reviewerId)}::uuid or cv.approved_at is null or cv.effective_at is null))
    then raise exception 'Seller governance attribution drift'; end if;
  if (select jsonb_agg(jsonb_build_array(id,requirement_version_id,sort_order,mandatory,audience,created_by) order by sort_order)
      from learning.curriculum_requirements where curriculum_version_id=cv.id) is distinct from
      ${j([[ids.orientationMember, m.orientationVersionId, 1, true, 'internal', m.ownerId], [ids.sellerMember, ids.requirementVersion, 2, true, 'internal', m.ownerId]])}
    or (select jsonb_agg(jsonb_build_array(id,curriculum_requirement_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by) order by id)
      from learning.curriculum_requirement_prerequisites where curriculum_version_id=cv.id) is distinct from
      ${j([[ids.prerequisite, ids.sellerMember, ids.requirementVersion, m.orientationVersionId, 'internal', m.ownerId]])}
    or (select jsonb_agg(jsonb_build_array(id,curriculum_requirement_id,requirement_version_id,module,capability,audience,created_by) order by id)
      from learning.curriculum_capability_outcomes where curriculum_version_id=cv.id) is distinct from
      ${j([[ids.outcome, ids.sellerMember, ids.requirementVersion, 'events', 'record_event_outcome', 'internal', m.ownerId]])}
    then raise exception 'Seller membership/prerequisite/outcome drift'; end if;`;
}

function draftSql() {
  return `
  if exists(select 1 from learning.requirements where requirement_key=${q(requirementKey)})
    or exists(select 1 from learning.curricula where catalog_key=${q(curriculumKey)}) then raise exception 'Seller roots already exist; no overwrite'; end if;
  insert into learning.requirements(id,requirement_key,audience,requirement_kind,governance_owner,created_by)
    values(${q(ids.requirementRoot)},${q(requirementKey)},'internal','scenario','platform',${q(m.ownerId)});
  insert into learning.requirement_versions(id,requirement_id,audience,requirement_kind,governance_owner,version,status,title,
    content_reference,simulation_id,assessment_settings,pass_rules,passing_score,max_attempts,estimated_minutes,waivable,
    change_reason,materiality,source_references,owner_id)
    values(${q(ids.requirementVersion)},${q(ids.requirementRoot)},'internal','scenario','platform',1,'draft',${q(EVENT_SELLER_SIMULATION.title)},
    'modules/learning/src/eventSellerTraining.ts#event-seller-custody-v1',${q(EVENT_SELLER_SIMULATION.id)},'{}'::jsonb,${j(passRules)},null,3,${m.estimatedMinutes},false,
    ${q(m.changeReason)},'material',${j([baseReference])},${q(m.ownerId)});
  insert into learning.curricula(id,catalog_key,audience,governance_owner,created_by)
    values(${q(ids.curriculumRoot)},${q(curriculumKey)},'internal','platform',${q(m.ownerId)});
  insert into learning.curriculum_versions(id,curriculum_id,audience,version,status,change_reason,materiality,source_references,owner_id)
    values(${q(ids.curriculumVersion)},${q(ids.curriculumRoot)},'internal',1,'draft',${q(m.changeReason)},'material',${j([baseReference])},${q(m.ownerId)});
  insert into learning.curriculum_requirements(id,curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by) values
    (${q(ids.orientationMember)},${q(ids.curriculumVersion)},${q(m.orientationVersionId)},'internal',1,true,${q(m.ownerId)}),
    (${q(ids.sellerMember)},${q(ids.curriculumVersion)},${q(ids.requirementVersion)},'internal',2,true,${q(m.ownerId)});
  insert into learning.curriculum_requirement_prerequisites(id,curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    values(${q(ids.prerequisite)},${q(ids.sellerMember)},${q(ids.curriculumVersion)},${q(ids.requirementVersion)},${q(m.orientationVersionId)},'internal',${q(m.ownerId)});
  insert into learning.curriculum_capability_outcomes(id,curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
    values(${q(ids.outcome)},${q(ids.sellerMember)},${q(ids.curriculumVersion)},${q(ids.requirementVersion)},'internal','events','record_event_outcome',${q(m.ownerId)});`;
}

function mutationSql(operation, reference) {
  if (operation === 'draft') return draftSql();
  let mutation;
  if (operation === 'submit-review') {
    mutation = `update learning.requirement_versions set status='in_review' where id=r.id;
  update learning.curriculum_versions set status='in_review' where id=cv.id;`;
  } else {
    const table = operation.endsWith('requirement') ? 'requirement_versions' : 'curriculum_versions';
    const id = operation.endsWith('requirement') ? 'r.id' : 'cv.id';
    mutation = operation.startsWith('approve-')
      ? `update learning.${table} set status='approved',reviewer_id=${q(m.reviewerId)},approved_at=statement_timestamp(),
    effective_at=statement_timestamp(),source_references=${j([baseReference, reference])} where id=${id};`
      : `update learning.${table} set status='published',published_at=statement_timestamp(),effective_at=statement_timestamp() where id=${id};`;
  }
  return graphCheck(operation, reference) + '\n  ' + mutation;
}

export function renderSellerLearning(input) {
  assertSource();
  const allowed = ['operation', 'mode', 'baselineFingerprint', 'reviewArtifactPath', 'reviewArtifactSha256', 'executionApprovalPath', 'executionApprovalSha256'];
  if (!input || Object.keys(input).some((key) => !allowed.includes(key)) || !STAGES.includes(input.operation) ||
    !['rehearsal', 'apply'].includes(input.mode ?? 'rehearsal') || !/^[a-f0-9]{32}$/.test(input.baselineFingerprint ?? '')) {
    throw new Error('Exact single stage and fresh baseline fingerprint required; unknown options refused');
  }
  const needsReview = !['draft', 'submit-review'].includes(input.operation);
  const reference = needsReview ? reviewReference(input) : null;
  const sql = `-- RENDER ONLY: UAT ${m.projectRef}; stage ${input.operation}; manifest ${manifestSha256}.
-- Parent executes separately. AI review only; test profiles are audit custodians, not human reviewers.
begin isolation level read committed;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $seller$
declare r learning.requirement_versions%rowtype; cv learning.curriculum_versions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('sep20-seller-learning',0));
  perform 1 from core.user_roles where user_id=${q(m.ownerId)}::uuid for share;
  if not exists(select 1 from core.profiles where id=${q(m.ownerId)}::uuid and lower(email)='intra.test.admin@mwell.com.ph' and kind='employee' and status='active')
    or not exists(select 1 from core.profiles where id=${q(m.reviewerId)}::uuid and lower(email)='intra.test.legal.lead@mwell.com.ph' and kind='employee' and status='active')
    or not exists(select 1 from core.user_roles ur join core.roles role on role.module=ur.module and role.role=ur.role
      where ur.user_id=${q(m.ownerId)}::uuid and ur.module='core' and ur.role='platform_admin' and role.is_active
      and ur.effective_at<=statement_timestamp() and (ur.expires_at is null or ur.expires_at>statement_timestamp()))
    then raise exception 'UAT audit custodians or active owner authority drift'; end if;
  perform 1 from learning.curricula where catalog_key=${q(curriculumKey)} for update;
  perform 1 from learning.requirements where requirement_key in (${q(requirementKey)},'internal.general_employee.orientation.v1') order by id for share;
  perform private.lock_learning_curriculum_graph(array(select id from learning.curriculum_versions where id in (${versions})));
  perform 1 from learning.requirement_versions where id in (${requirementVersions}) or id=${q(m.orientationVersionId)}::uuid order by id for update;
  if (${fingerprintQuery()}) is distinct from ${q(input.baselineFingerprint)} then raise exception 'Live seller baseline drift'; end if;
  if (select md5(jsonb_build_object('root',to_jsonb(root),'version',to_jsonb(v))::text)
    from learning.requirements root join learning.requirement_versions v on v.requirement_id=root.id where v.id=${q(m.orientationVersionId)}::uuid)
    is distinct from ${q(m.orientationFingerprint)} then raise exception 'Pinned orientation drift'; end if;
  if not exists(select 1 from learning.requirement_versions where id=${q(m.orientationVersionId)}::uuid and status='published'
    and audience='internal' and requirement_kind='orientation' and effective_at<=statement_timestamp()
    and (expires_at is null or expires_at>statement_timestamp())) then raise exception 'Orientation must remain published and effective'; end if;
  if exists(select 1 from learning.role_curricula where (module='events' and role='seller') or curriculum_version_id in (${versions}))
    then raise exception 'Seller mapping already exists; inactive publication only'; end if;
  ${mutationSql(input.operation, reference)}
end;
$seller$;
select md5(state::text) as fingerprint, state from (${stateQuery()}) snapshot;
rollback;
`;
  if ((input.mode ?? 'rehearsal') === 'rehearsal') return sql;
  const a = readArtifact(input.executionApprovalPath, input.executionApprovalSha256, 'Execution approval');
  if (a.schemaVersion !== 1 || a.executionApproved !== true || a.projectRef !== m.projectRef || a.manifestSha256 !== manifestSha256 ||
    a.operation !== input.operation || a.baselineFingerprint !== input.baselineFingerprint || a.rehearsalSqlSha256 !== sha256(sql) ||
    a.reviewArtifactSha256 !== (input.reviewArtifactSha256 ?? null) || !actualTimestamp(a.authorizedAt) ||
    a.authorizedByAgentId !== '01a0b4fc-57b0-7351-84ee-b8baeb3a422c' || a.userAuthorizationReference !== m.userAuthorizationReference) {
    throw new Error('Execution approval does not bind exact stage, state, review and rehearsal SQL');
  }
  if (input.operation.startsWith('publish-') && (a.roleIsolationVerified !== true ||
    typeof a.roleIsolationEvidence !== 'string' || a.roleIsolationEvidence.trim().length < 12 ||
    typeof a.runtimeEvidence !== 'string' || a.runtimeEvidence.trim().length < 12)) throw new Error('Publication requires separate role isolation and runtime evidence');
  return sql.replace(/rollback;\s*$/, 'commit;\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, path] = process.argv.slice(2);
  assertSource();
  if (command === 'manifest' && !path) console.log(JSON.stringify({ manifest: m, manifestSha256,
    content: { simulation: EVENT_SELLER_SIMULATION, requirement: EVENT_SELLER_REQUIREMENT, curriculum: EVENT_SELLER_CURRICULUM } }, null, 2));
  else if (command === 'preflight' && !path) console.log(preflightSql());
  else if (command === 'render' && path && process.argv.length === 4) console.log(renderSellerLearning(JSON.parse(readFileSync(path, 'utf8'))));
  else throw new Error('Usage: node scripts/sep20-seller-learning.mjs manifest | preflight | render <stage-input.json>. This tool never connects to a database.');
}
