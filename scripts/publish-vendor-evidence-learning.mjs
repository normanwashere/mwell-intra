#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CANDIDATE = '0363ae28843d474bcb0efd4802bb91f15c9b135b';
export const REQUIREMENT = 'vendor.vendor_representative.evidence-and-acknowledgments.v1';
export const PASS_RULES = {
  required_checkpoints: ['review-evidence', 'complete'],
  checkpoint_outcomes: { 'review-evidence': ['reviewed'], complete: ['reviewed'] },
};
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

// Preparation only: no connection, credentials, commit mode, approval or role-map writes.
export function renderVendorEvidenceDryRun(input) {
  if (!input || input.projectRef !== 'kkoitlvydytdhlpxhuah' || input.candidate !== CANDIDATE) {
    throw new Error('Exact reviewed UAT project and candidate are required');
  }
  if (Object.keys(input).some((key) => !['projectRef', 'candidate', 'ownerEmail', 'reviewerEmail', 'reviewEvidence', 'reviewedAt', 'reviewConfirmed'].includes(key))) {
    throw new Error('Unknown input; no commit or publication mode is supported');
  }
  const email = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  for (const value of [input.ownerEmail, input.reviewerEmail]) {
    if (!email.test(value ?? '') || /(?:intra\.test|synthetic|example\.|test[+@])/i.test(value)) {
      throw new Error('Explicit real owner and reviewer addresses are required; no test identities');
    }
  }
  if (input.ownerEmail.toLowerCase() === input.reviewerEmail.toLowerCase()) throw new Error('Independent reviewer required');
  if (input.reviewConfirmed !== true || !/^https:\/\/[^\s]+$/.test(input.reviewEvidence ?? '') ||
      !Number.isFinite(Date.parse(input.reviewedAt)) || Date.parse(input.reviewedAt) > Date.now()) {
    throw new Error('Actual completed review evidence and timestamp are required');
  }
  const catalog = execFileSync('git', ['show', `${CANDIDATE}:modules/learning/src/catalog.ts`], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8',
  });
  const catalogHash = createHash('sha256').update(catalog).digest('hex');
  if (catalogHash !== 'b43d781bb62ea4db83eac1f61eb3dc73e2338eb3685fb28e5b2f3efa8b0cee48') {
    throw new Error('Reviewed catalog content hash mismatch');
  }
  const references = [{ type: 'application_catalog', commit: CANDIDATE,
    path: 'modules/learning/src/catalog.ts', sha256: catalogHash,
    simulation_id: 'vendor-evidence-review-v1', version: 1 },
  { type: 'human_review_reference', reference: input.reviewEvidence, reviewed_at: input.reviewedAt }];
  return `-- UAT-only draft rehearsal. Human evidence inputs are assertions, not verified signoff.
-- Run only after an authorized operator verifies the review evidence. Always rolls back.
begin isolation level read committed;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $vendor_draft$
declare owner_id uuid; reviewer_id uuid; base learning.curriculum_versions%rowtype;
  root_id uuid; requirement_id uuid; curriculum_id uuid; orientation_id uuid;
begin
  select p.id into strict owner_id from core.profiles p
    where lower(p.email)=lower(${literal(input.ownerEmail)}) and p.kind='employee' and p.status='active';
  select p.id into strict reviewer_id from core.profiles p
    where lower(p.email)=lower(${literal(input.reviewerEmail)}) and p.kind='employee' and p.status='active';
  if owner_id=reviewer_id then raise exception 'Independent reviewer required'; end if;
  if not exists(select 1 from core.user_roles ur join core.roles r on r.module=ur.module and r.role=ur.role
    where ur.user_id=owner_id and ur.module='core' and ur.role='platform_admin' and r.is_active
      and ur.effective_at<=statement_timestamp() and (ur.expires_at is null or ur.expires_at>statement_timestamp()))
    then raise exception 'Active platform-admin content owner required'; end if;
  select cv.* into strict base from learning.curriculum_versions cv join learning.curricula c on c.id=cv.curriculum_id
    where c.catalog_key='vendor.role.core.vendor_portal.capability-practice.v1.curriculum'
      and c.audience='vendor' and c.governance_owner='platform' and c.status='active'
      and cv.version=1 and cv.status='published' and cv.effective_at<=statement_timestamp()
      and (cv.expires_at is null or cv.expires_at>statement_timestamp()) for share of cv,c;
  if exists(select 1 from learning.curriculum_versions cv where cv.curriculum_id=base.curriculum_id and cv.version>1)
    or exists(select 1 from learning.requirements r where r.requirement_key=${literal(REQUIREMENT)})
    then raise exception 'Draft or newer content already exists: review instead of overwriting'; end if;
  if (select jsonb_agg(jsonb_build_array(r.requirement_key,rv.version,rv.requirement_kind,cr.sort_order,cr.mandatory) order by cr.sort_order)
    from learning.curriculum_requirements cr join learning.requirement_versions rv on rv.id=cr.requirement_version_id
    join learning.requirements r on r.id=rv.requirement_id where cr.curriculum_version_id=base.id)
    is distinct from '[ ["vendor.vendor_representative.orientation.v1",1,"orientation",0,true], ["vendor.role.core.vendor_portal.capability-practice.v1",1,"scenario",1,true] ]'::jsonb
    then raise exception 'Vendor base composition drift'; end if;
  select rv.id into strict orientation_id from learning.curriculum_requirements cr
    join learning.requirement_versions rv on rv.id=cr.requirement_version_id
    where cr.curriculum_version_id=base.id and cr.sort_order=0;
  insert into learning.requirements(requirement_key,audience,requirement_kind,governance_owner,created_by)
    values(${literal(REQUIREMENT)},'vendor','attestation','platform',owner_id) returning id into root_id;
  insert into learning.requirement_versions(requirement_id,audience,requirement_kind,governance_owner,version,status,
    title,simulation_id,content_reference,pass_rules,estimated_minutes,waivable,change_reason,materiality,source_references,owner_id)
    values(root_id,'vendor','attestation','platform',1,'draft','Vendor evidence and acknowledgments',
      'vendor-evidence-review-v1',null,${literal(JSON.stringify(PASS_RULES))}::jsonb,3,false,
      'Add vendor evidence learning review; no legal declaration or operational authority','material',
      ${literal(JSON.stringify(references))}::jsonb,owner_id) returning id into requirement_id;
  insert into learning.curriculum_versions(curriculum_id,audience,version,status,change_reason,materiality,source_references,owner_id,supersedes_id)
    values(base.curriculum_id,'vendor',2,'draft','Add mandatory vendor evidence learning review','material',
      ${literal(JSON.stringify(references))}::jsonb,owner_id,base.id) returning id into curriculum_id;
  insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
    select curriculum_id,cr.requirement_version_id,'vendor',case when cr.sort_order=0 then 0 else 2 end,cr.mandatory,owner_id
    from learning.curriculum_requirements cr where cr.curriculum_version_id=base.id;
  insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
    values(curriculum_id,requirement_id,'vendor',1,true,owner_id);
  insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    select cr.id,curriculum_id,e.requirement_version_id,e.prerequisite_requirement_version_id,'vendor',owner_id
    from learning.curriculum_requirement_prerequisites e join learning.curriculum_requirements cr
      on cr.curriculum_version_id=curriculum_id and cr.requirement_version_id=e.requirement_version_id
    where e.curriculum_version_id=base.id;
  insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    select cr.id,curriculum_id,requirement_id,orientation_id,'vendor',owner_id from learning.curriculum_requirements cr
    where cr.curriculum_version_id=curriculum_id and cr.requirement_version_id=requirement_id;
  insert into learning.curriculum_capability_outcomes(curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
    select cr.id,curriculum_id,o.requirement_version_id,'vendor',o.module,o.capability,owner_id
    from learning.curriculum_capability_outcomes o join learning.curriculum_requirements cr
      on cr.curriculum_version_id=curriculum_id and cr.requirement_version_id=o.requirement_version_id
    where o.curriculum_version_id=base.id;
end;
$vendor_draft$;
select r.requirement_key,rv.status,rv.pass_rules,rv.content_reference,rv.source_references
  from learning.requirements r join learning.requirement_versions rv on rv.requirement_id=r.id
  where r.requirement_key=${literal(REQUIREMENT)};
rollback;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Provide one local review-input JSON file; no defaults');
  process.stdout.write(renderVendorEvidenceDryRun(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
}
