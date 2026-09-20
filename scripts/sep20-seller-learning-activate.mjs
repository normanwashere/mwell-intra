import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MANIFEST as m } from './sep20-seller-learning-manifest.mjs';
import { assertSource, fingerprintQuery, graphCheck, manifestSha256, reviewReference, sha256, stateQuery } from './sep20-seller-learning.mjs';

export const MAPPING_ID = '575ba1a0-5aed-4619-8ef7-5dfcee5b42d7';
const q = v => `'${String(v).replaceAll("'", "''")}'`;

export function renderSellerActivation(input) {
  assertSource();
  const allowed = ['operation', 'mode', 'baselineFingerprint', 'reviewArtifactPath', 'reviewArtifactSha256', 'executionApprovalPath', 'executionApprovalSha256'];
  if (!input || Object.keys(input).some(k => !allowed.includes(k)) || input.operation !== 'activate-role-mapping'
    || !['rehearsal', 'apply'].includes(input.mode ?? 'rehearsal') || !/^[a-f0-9]{32}$/.test(input.baselineFingerprint ?? '')) throw new Error('Exact activation operation and fresh fingerprint required');
  // This artifact verifies published content provenance. It does NOT authorize activation.
  const reference = reviewReference(input);
  const sql = `-- RENDER ONLY: ${m.projectRef}; activate-role-mapping; parent authorization only.
-- One global events.seller mapping. No accounts, memberships, completions or certificates.
begin isolation level read committed;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $seller_activation$
declare r learning.requirement_versions%rowtype; cv learning.curriculum_versions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('sep20-seller-learning',0));
  perform 1 from core.user_roles where user_id=${q(m.ownerId)}::uuid for share;
  if not exists(select 1 from core.profiles where id=${q(m.ownerId)}::uuid and lower(email)='intra.test.admin@mwell.com.ph' and kind='employee' and status='active')
    or not exists(select 1 from core.profiles where id=${q(m.reviewerId)}::uuid and lower(email)='intra.test.legal.lead@mwell.com.ph' and kind='employee' and status='active')
    or not exists(select 1 from core.user_roles ur join core.roles role on role.module=ur.module and role.role=ur.role
      where ur.user_id=${q(m.ownerId)}::uuid and ur.module='core' and ur.role='platform_admin' and role.is_active
      and ur.effective_at<=statement_timestamp() and (ur.expires_at is null or ur.expires_at>statement_timestamp()))
    then raise exception 'UAT audit custodian/owner authority drift'; end if;
  perform 1 from learning.curricula where id=${q(m.ids.curriculumRoot)}::uuid for update;
  perform private.lock_learning_curriculum_graph(array[${q(m.ids.curriculumVersion)}::uuid]);
  perform 1 from learning.requirement_versions where id in (${q(m.ids.requirementVersion)},${q(m.orientationVersionId)}) order by id for share;
  if (${fingerprintQuery()}) is distinct from ${q(input.baselineFingerprint)} then raise exception 'Activation baseline drift'; end if;
  if exists(select 1 from learning.role_curricula where module='events' and role='seller' or curriculum_version_id=${q(m.ids.curriculumVersion)}::uuid)
    then raise exception 'Seller mapping already exists; inspect, never replay'; end if;
  if to_regprocedure('private.event_seller_learning_ready()') is null then raise exception 'Seller readiness helper missing'; end if;
  if not exists(select 1 from core.roles where module='events' and role='seller' and is_active)
    or (select array_agg(cap order by cap) from core.role_capabilities where module='events' and role='seller')
      is distinct from array['record_event_outcome','view_event_custody']::text[] then raise exception 'Narrow seller role not deployed'; end if;
  if (select md5(jsonb_build_object('root',to_jsonb(root),'version',to_jsonb(v))::text)
    from learning.requirements root join learning.requirement_versions v on v.requirement_id=root.id where v.id=${q(m.orientationVersionId)}::uuid)
    is distinct from ${q(m.orientationFingerprint)} then raise exception 'Pinned orientation drift'; end if;
  ${graphCheck('activate-role-mapping', reference)}
  if r.effective_at>transaction_timestamp() or cv.effective_at>transaction_timestamp()
    or r.published_at is null or cv.published_at is null then raise exception 'Published seller graph not effective'; end if;
  insert into learning.role_curricula(id,module,role,curriculum_version_id,audience,department_id,effective_at,expires_at,created_by)
    values(${q(MAPPING_ID)},'events','seller',${q(m.ids.curriculumVersion)},'internal',null,transaction_timestamp(),null,${q(m.ownerId)});
  if not private.event_seller_learning_ready() then raise exception 'Exact seller graph readiness failed; mapping rolled back'; end if;
end;
$seller_activation$;
select md5(state::text) as fingerprint,state,private.event_seller_learning_ready() as ready from (${stateQuery()}) snapshot;
rollback;
`;
  if ((input.mode ?? 'rehearsal') === 'rehearsal') return sql;
  if (typeof input.executionApprovalPath !== 'string' || !/^[a-f0-9]{64}$/.test(input.executionApprovalSha256 ?? '')) throw new Error('Separate parent activation approval required');
  const bytes = readFileSync(input.executionApprovalPath);
  if (sha256(bytes) !== input.executionApprovalSha256) throw new Error('Activation approval hash mismatch');
  const a = JSON.parse(bytes.toString('utf8'));
  if (a.schemaVersion !== 1 || a.executionApproved !== true || a.projectRef !== m.projectRef || a.manifestSha256 !== manifestSha256
    || a.operation !== input.operation || a.baselineFingerprint !== input.baselineFingerprint || a.rehearsalSqlSha256 !== sha256(sql)
    || a.reviewArtifactSha256 !== input.reviewArtifactSha256 || a.authorizedByAgentId !== '01a0b4fc-57b0-7351-84ee-b8baeb3a422c'
    || !Number.isFinite(Date.parse(a.authorizedAt)) || Date.parse(a.authorizedAt) > Date.now() || a.userAuthorizationReference !== m.userAuthorizationReference
    || a.roleIsolationVerified !== true || typeof a.roleIsolationEvidence !== 'string' || a.roleIsolationEvidence.trim().length < 12
    || typeof a.runtimeEvidence !== 'string' || a.runtimeEvidence.trim().length < 12) throw new Error('Exact separate parent activation, isolation and runtime approval required');
  return sql.replace(/rollback;\s*$/, 'commit;\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== 'render' || process.argv.length !== 4) throw new Error('Usage: node scripts/sep20-seller-learning-activate.mjs render <activation-input.json>. Renders only.');
  console.log(renderSellerActivation(JSON.parse(readFileSync(process.argv[3], 'utf8'))));
}
