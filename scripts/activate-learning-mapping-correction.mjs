#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CORRECTIONS, baselineQuery, renderMappingCorrection } from './rehearse-learning-mapping-correction.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const q = (x) => `'${String(x).replaceAll("'", "''")}'`;

function checkedJson(path, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? '')) throw new Error('Explicit evidence hash required');
  const bytes = readFileSync(path);
  if (hash(bytes) !== expectedHash) throw new Error('Evidence hash mismatch');
  return JSON.parse(bytes.toString('utf8'));
}

export function renderMappingActivation({ publishedFingerprint, publicHealthPath, publicHealthSha256,
  activationReviewPath, activationReviewSha256, mode = 'rehearsal', executionApprovalPath, executionApprovalSha256, ...input }) {
  if (!['rehearsal', 'apply'].includes(mode) || input.reviewMode !== 'automated' || !/^[a-f0-9]{32}$/.test(publishedFingerprint ?? '')) {
    throw new Error('Explicit automated activation inputs required');
  }
  renderMappingCorrection({ ...input, mode: 'draft' });
  const health = checkedJson(publicHealthPath, publicHealthSha256);
  const activation = checkedJson(activationReviewPath, activationReviewSha256);
  if (health.surface !== 'public_alias' || health.healthy !== true || health.projectRef !== input.projectRef || health.commit !== input.candidate ||
      !Number.isFinite(Date.parse(health.observedAt)) || Date.parse(health.observedAt) > Date.now()) {
    throw new Error('Compatible public-alias health evidence required; protected preview is insufficient');
  }
  if (activation.verdict !== 'approved' || activation.reviewMode !== 'automated' || activation.key !== input.key ||
      activation.candidate !== input.candidate || activation.projectRef !== input.projectRef || activation.publishedFingerprint !== publishedFingerprint ||
      activation.baselineFingerprint !== input.baselineFingerprint || activation.reviewerAgentId !== input.reviewerAgentId ||
      activation.publicHealthSha256 !== publicHealthSha256 || activation.activationPolicy !== 'add_current_version_preserve_prior') {
    throw new Error('Exact separate activation review required');
  }
  const c = CORRECTIONS[input.key];
  const sql = `-- UAT activation ONLY after verified compatible PUBLIC runtime and separate graph review.
begin isolation level read committed;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $activate$
declare source_id uuid; target_id uuid; n integer;
begin
  select cv.id into strict source_id from learning.curriculum_versions cv join learning.curricula c on c.id=cv.curriculum_id
    where c.catalog_key=${q(c.curriculum)} and cv.version=1 and cv.status='published';
  select cv.id into strict target_id from learning.curriculum_versions cv join learning.curricula c on c.id=cv.curriculum_id
    where c.catalog_key=${q(c.curriculum)} and cv.version=2 and cv.status='published' and cv.audience='internal'
      and cv.effective_at<=statement_timestamp() and (cv.expires_at is null or cv.expires_at>statement_timestamp());
  perform private.lock_learning_curriculum_graph(array[source_id,target_id]);
  if exists(select 1 from learning.curriculum_versions newer join learning.curriculum_versions target on target.id=target_id
    where newer.curriculum_id=target.curriculum_id and newer.version>2) then raise exception 'Newer curriculum exists; activation review is stale'; end if;
  if (${baselineQuery(input.key)}) is distinct from ${q(input.baselineFingerprint)} or
    (${baselineQuery(input.key, 2)}) is distinct from ${q(publishedFingerprint)} then raise exception 'Activation baseline drift'; end if;
  if exists(select 1 from learning.role_curricula where curriculum_version_id=target_id) then raise exception 'Already mapped; review current state'; end if;
  if not exists(select 1 from core.profiles where id='5f86c147-34aa-4722-be5b-ed085caf97eb' and email='intra.test.admin@mwell.com.ph' and status='active' and kind='employee')
    then raise exception 'UAT custodian identity drift'; end if;
  insert into learning.role_curricula(module,role,curriculum_version_id,audience,department_id,effective_at,expires_at,created_by)
    select rc.module,rc.role,target_id,rc.audience,rc.department_id,statement_timestamp(),rc.expires_at,'5f86c147-34aa-4722-be5b-ed085caf97eb'::uuid
    from learning.role_curricula rc where rc.curriculum_version_id=source_id and rc.module=${q(c.module)} and rc.role=${q(c.role)}
      and rc.effective_at<=statement_timestamp() and (rc.expires_at is null or rc.expires_at>statement_timestamp());
  get diagnostics n = row_count;
  if n=0 then raise exception 'Current source role mapping missing'; end if;
end;
$activate$;
rollback;
`;
  if (mode === 'rehearsal') return sql;
  const execution = checkedJson(executionApprovalPath, executionApprovalSha256);
  if (execution.executionApproved !== true || execution.rehearsalSqlSha256 !== hash(sql) ||
      execution.candidate !== input.candidate || execution.key !== input.key || execution.reviewerAgentId !== input.reviewerAgentId) {
    throw new Error('Exact activation SQL execution approval required');
  }
  return sql.slice(0, -'rollback;\n'.length) + 'commit;\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Explicit activation-input JSON required; render only');
  process.stdout.write(renderMappingActivation(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
}
