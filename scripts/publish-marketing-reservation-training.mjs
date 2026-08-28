#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const assessment = JSON.parse(readFileSync(new URL(
  "../modules/learning/src/marketing-reservation-assessment.json", import.meta.url,
), "utf8"));
const catalogKey = "internal.role.warehouse.marketing.capability-practice.v1.curriculum";
const orientationKey = "internal.marketing_events_lead.orientation.v1";
const practiceKey = "internal.role.warehouse.marketing.capability-practice.v1";
const answerKey = {
  "reservation-availability": "respect-availability",
  "reservation-custody": "hold-not-issue",
  "reservation-details": "event-product-purpose",
  "reservation-authority": "reservation-only",
  "reservation-uncertain-response": "reconcile-before-retry",
};
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;

// Render only. Execute through the explicitly selected UAT connection/MCP tool.
// The default script rehearses publication and rolls back all catalog writes.
export function renderMarketingReservationTrainingSql({ projectRef, ownerEmail, reviewerEmail, commit = false }) {
  if (projectRef !== "kkoitlvydytdhlpxhuah") throw new Error("Only the approved UAT project kkoitlvydytdhlpxhuah is allowed.");
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailPattern.test(ownerEmail ?? "") || !emailPattern.test(reviewerEmail ?? "") || ownerEmail.toLowerCase() === reviewerEmail.toLowerCase()) {
    throw new Error("Distinct explicit owner and reviewer email addresses are required.");
  }
  if (ownerEmail.toLowerCase() !== "intra.test.admin@mwell.com.ph" || reviewerEmail.toLowerCase() !== "intra.test.legal.lead@mwell.com.ph") {
    throw new Error("Only the existing synthetic UAT governance actors may be attributed; no real employee signoff.");
  }
  const settings = { question_ids: assessment.questions.map((item) => item.id) };
  if (JSON.stringify(settings.question_ids) !== JSON.stringify(Object.keys(answerKey)) || assessment.passingScore !== 100 || assessment.maxAttempts !== 3) {
    throw new Error("Reservation assessment v1 changed; publish a new version.");
  }
  for (const question of assessment.questions) {
    if (!question.options.some((option) => option.id === answerKey[question.id])) throw new Error("Invalid private assessment answer key.");
  }
  const references = [{
    type: "application_assessment", id: assessment.id, version: 1,
    content_sha256: createHash("sha256").update(JSON.stringify(assessment)).digest("hex"),
  }, {
    type: "change_request", id: "2026-08-27-marketing-reservation",
    environment: "uat", publication: "synthetic UAT training/test content; not production human signoff",
  }];
  const baseComposition = [
    { key: orientationKey, version: 1, kind: "orientation", order: 0, mandatory: true },
    { key: practiceKey, version: 1, kind: "scenario", order: 1, mandatory: true },
  ];
  const compositionQuery = `select jsonb_agg(jsonb_build_object('key',r.requirement_key,'version',rv.version,
    'kind',rv.requirement_kind,'order',cr.sort_order,'mandatory',cr.mandatory) order by cr.sort_order)
    from learning.curriculum_requirements cr join learning.requirement_versions rv on rv.id=cr.requirement_version_id
    join learning.requirements r on r.id=rv.requirement_id where cr.curriculum_version_id`;
  const edgesQuery = `select jsonb_agg(jsonb_build_array(r.requirement_key,pr.requirement_key) order by r.requirement_key)
    from learning.curriculum_requirement_prerequisites e join learning.requirement_versions rv on rv.id=e.requirement_version_id
    join learning.requirements r on r.id=rv.requirement_id join learning.requirement_versions pv on pv.id=e.prerequisite_requirement_version_id
    join learning.requirements pr on pr.id=pv.requirement_id where e.curriculum_version_id`;
  const outcomesQuery = `select jsonb_agg(jsonb_build_array(r.requirement_key,o.module,o.capability) order by o.capability)
    from learning.curriculum_capability_outcomes o join learning.requirement_versions rv on rv.id=o.requirement_version_id
    join learning.requirements r on r.id=rv.requirement_id where o.curriculum_version_id`;

  return `-- UAT ONLY: ${projectRef}. No operational, role-grant, or learner-evidence writes.
begin isolation level read committed;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('mwell.learning.marketing-reservation.publisher'));
do $publish_marketing$
declare
  v_owner uuid;
  v_reviewer uuid;
  v_base learning.curriculum_versions%rowtype;
  v_curriculum learning.curriculum_versions%rowtype;
  v_root learning.requirements%rowtype;
  v_assessment learning.requirement_versions%rowtype;
  v_practice uuid;
begin
  select id into strict v_owner from core.profiles
    where lower(email)=lower(${literal(ownerEmail)}) and kind='employee' and status='active' for share;
  select id into strict v_reviewer from core.profiles
    where lower(email)=lower(${literal(reviewerEmail)}) and kind='employee' and status='active' for share;
  if v_owner=v_reviewer then raise exception 'Independent review is required'; end if;
  select cv.* into strict v_base from learning.curriculum_versions cv
    join learning.curricula c on c.id=cv.curriculum_id
    where c.catalog_key=${literal(catalogKey)} and c.status='active' and c.audience='internal'
      and c.governance_owner='platform' and cv.version=1
      and cv.status='published' and cv.effective_at<=statement_timestamp()
      and (cv.expires_at is null or cv.expires_at>statement_timestamp()) for share of c,cv;
  if v_base.owner_id<>v_owner or v_base.reviewer_id<>v_reviewer then
    raise exception 'Explicit actors must match the existing governed Marketing catalog';
  end if;
  if exists (select 1 from learning.curriculum_versions where curriculum_id=v_base.curriculum_id and version>2) then
    raise exception 'A newer Marketing curriculum exists; review it before publishing';
  end if;
  if (${compositionQuery}=v_base.id) is distinct from ${json(baseComposition)}
    or (${edgesQuery}=v_base.id) is distinct from ${json([[practiceKey, orientationKey]])}
    or (${outcomesQuery}=v_base.id) is distinct from ${json([[practiceKey, "warehouse", "request_stock"]])} then
    raise exception 'Existing Marketing curriculum composition differs from the reviewed baseline';
  end if;
  perform 1 from learning.requirement_versions rv join learning.curriculum_requirements cr on cr.requirement_version_id=rv.id
    where cr.curriculum_version_id=v_base.id order by rv.id for share of rv;
  if exists (select 1 from learning.requirement_versions rv
    join learning.curriculum_requirements cr on cr.requirement_version_id=rv.id
    join learning.requirements r on r.id=rv.requirement_id
    where cr.curriculum_version_id=v_base.id and (rv.status<>'published' or r.status<>'active'
      or rv.effective_at>statement_timestamp() or rv.expires_at<=statement_timestamp() or rv.waivable)) then
    raise exception 'Existing requirements must remain current, published, mandatory and non-waivable';
  end if;
  select rv.id into strict v_practice from learning.requirement_versions rv
    join learning.requirements r on r.id=rv.requirement_id where r.requirement_key=${literal(practiceKey)} and rv.version=1
    and rv.simulation_id='event-fulfillment-reconciliation-v1'
    and rv.pass_rules=${json({ required_checkpoints: ["plan-event-fulfillment", "reconcile-event-custody"] })};
  if not exists (select 1 from learning.role_curricula where curriculum_version_id=v_base.id
    and module='warehouse' and role='marketing' and audience='internal' and department_id is null
    and effective_at<=statement_timestamp() and (expires_at is null or expires_at>statement_timestamp())) then
    raise exception 'Current Marketing role mapping is missing';
  end if;

  insert into learning.requirements (requirement_key,audience,requirement_kind,governance_owner,status,created_by)
    values (${literal(assessment.id)},'internal','assessment','platform','active',v_owner)
    on conflict (requirement_key) do nothing;
  select * into strict v_root from learning.requirements where requirement_key=${literal(assessment.id)} for share;
  if v_root.audience<>'internal' or v_root.requirement_kind<>'assessment' or v_root.governance_owner<>'platform' or v_root.status<>'active' then
    raise exception 'Reservation requirement root conflicts with the governed catalog';
  end if;
  insert into learning.requirement_versions (
    requirement_id,audience,requirement_kind,governance_owner,version,status,title,assessment_settings,
    pass_rules,passing_score,max_attempts,estimated_minutes,waivable,change_reason,materiality,source_references,owner_id
  ) values (v_root.id,'internal','assessment','platform',1,'draft',${literal(assessment.title)},${json(settings)},
    '{}',100,3,6,false,'UAT training/test content: August 27 Marketing reservation controls','material',${json(references)},v_owner)
    on conflict (requirement_id,version) do nothing;
  select * into strict v_assessment from learning.requirement_versions where requirement_id=v_root.id and version=1 for update;
  if v_assessment.title<>${literal(assessment.title)} or v_assessment.audience<>'internal'
    or v_assessment.requirement_kind<>'assessment' or v_assessment.governance_owner<>'platform'
    or v_assessment.assessment_settings<>${json(settings)} or v_assessment.pass_rules<>'{}'::jsonb
    or v_assessment.passing_score is distinct from 100::numeric or v_assessment.max_attempts is distinct from 3
    or v_assessment.estimated_minutes<>6 or v_assessment.waivable or v_assessment.simulation_id is not null
    or v_assessment.content_reference is not null or v_assessment.source_references<>${json(references)}
    or v_assessment.owner_id<>v_owner or (v_assessment.reviewer_id is not null and v_assessment.reviewer_id<>v_reviewer)
    or v_assessment.status not in ('draft','in_review','approved','published') or v_assessment.expires_at is not null then
    raise exception 'Reservation assessment conflicts with immutable v1 content';
  end if;
  insert into private.learning_assessment_answer_keys (requirement_version_id,answer_key,created_by,updated_by)
    values (v_assessment.id,${json(answerKey)},v_owner,v_owner) on conflict (requirement_version_id) do nothing;
  if (select answer_key from private.learning_assessment_answer_keys where requirement_version_id=v_assessment.id) is distinct from ${json(answerKey)} then
    raise exception 'Private assessment answers conflict; publish a new requirement version';
  end if;
  update learning.requirement_versions set status='in_review' where id=v_assessment.id and status='draft';
  update learning.requirement_versions set status='approved',reviewer_id=v_reviewer,approved_at=statement_timestamp(),effective_at=statement_timestamp()
    where id=v_assessment.id and status='in_review';
  update learning.requirement_versions set status='published',published_at=effective_at where id=v_assessment.id and status='approved';

  insert into learning.curriculum_versions (
    curriculum_id,audience,version,status,change_reason,materiality,source_references,owner_id,supersedes_id
  ) values (v_base.curriculum_id,'internal',2,'draft','UAT training/test content: August 27 Marketing reservation controls','material',${json(references)},v_owner,v_base.id)
    on conflict (curriculum_id,version) do nothing;
  select * into strict v_curriculum from learning.curriculum_versions where curriculum_id=v_base.curriculum_id and version=2 for update;
  if v_curriculum.audience<>'internal' or v_curriculum.owner_id<>v_owner
    or v_curriculum.supersedes_id is distinct from v_base.id or v_curriculum.source_references<>${json(references)}
    or (v_curriculum.reviewer_id is not null and v_curriculum.reviewer_id<>v_reviewer)
    or v_curriculum.status not in ('draft','in_review','approved','published') or v_curriculum.expires_at is not null then
    raise exception 'Marketing curriculum v2 conflicts with the reviewed publication';
  end if;
  if v_curriculum.status in ('draft','in_review') then
    insert into learning.curriculum_requirements (curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
      select v_curriculum.id,requirement_version_id,'internal',sort_order,mandatory,v_owner
      from learning.curriculum_requirements where curriculum_version_id=v_base.id
      on conflict (curriculum_version_id,requirement_version_id) do nothing;
    insert into learning.curriculum_requirements (curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
      values (v_curriculum.id,v_assessment.id,'internal',2,true,v_owner)
      on conflict (curriculum_version_id,requirement_version_id) do nothing;
    insert into learning.curriculum_requirement_prerequisites (
      curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by
    ) select cr.id,v_curriculum.id,e.requirement_version_id,e.prerequisite_requirement_version_id,'internal',v_owner
      from learning.curriculum_requirement_prerequisites e join learning.curriculum_requirements cr
      on cr.curriculum_version_id=v_curriculum.id and cr.requirement_version_id=e.requirement_version_id
      where e.curriculum_version_id=v_base.id
      on conflict (curriculum_requirement_id,prerequisite_requirement_version_id) do nothing;
    insert into learning.curriculum_requirement_prerequisites (
      curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by
    ) select id,v_curriculum.id,v_assessment.id,v_practice,'internal',v_owner from learning.curriculum_requirements
      where curriculum_version_id=v_curriculum.id and requirement_version_id=v_assessment.id
      on conflict (curriculum_requirement_id,prerequisite_requirement_version_id) do nothing;
    insert into learning.curriculum_capability_outcomes (
      curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by
    ) select id,v_curriculum.id,requirement_version_id,'internal','warehouse',
      case when requirement_version_id=v_assessment.id then 'reserve_allocate' else 'request_stock' end,v_owner
      from learning.curriculum_requirements where curriculum_version_id=v_curriculum.id
      and requirement_version_id in (v_assessment.id,v_practice)
      on conflict (curriculum_requirement_id,module,capability) do nothing;
  end if;
  if (${compositionQuery}=v_curriculum.id) is distinct from ${json([...baseComposition, { key: assessment.id, version: 1, kind: "assessment", order: 2, mandatory: true }])}
    or (${edgesQuery}=v_curriculum.id) is distinct from ${json([[practiceKey, orientationKey], [assessment.id, practiceKey]])}
    or (${outcomesQuery}=v_curriculum.id) is distinct from ${json([[practiceKey, "warehouse", "request_stock"], [assessment.id, "warehouse", "reserve_allocate"]])} then
    raise exception 'Marketing curriculum v2 composition conflicts with the governed catalog';
  end if;
  update learning.curriculum_versions set status='in_review' where id=v_curriculum.id and status='draft';
  update learning.curriculum_versions set status='approved',reviewer_id=v_reviewer,approved_at=statement_timestamp(),effective_at=statement_timestamp()
    where id=v_curriculum.id and status='in_review';
  update learning.curriculum_versions set status='published',published_at=effective_at where id=v_curriculum.id and status='approved';
  insert into learning.role_curricula (module,role,curriculum_version_id,audience,department_id,effective_at,created_by)
    select 'warehouse','marketing',id,'internal',null,effective_at,v_owner from learning.curriculum_versions
    where id=v_curriculum.id and not exists (select 1 from learning.role_curricula where curriculum_version_id=v_curriculum.id);
  if (select count(*) from learning.role_curricula where curriculum_version_id=v_curriculum.id)<>1
    or not exists (select 1 from learning.role_curricula where curriculum_version_id=v_curriculum.id
      and module='warehouse' and role='marketing' and audience='internal' and department_id is null
      and effective_at<=statement_timestamp() and expires_at is null) then
    raise exception 'Marketing curriculum v2 role mapping conflicts with the governed catalog';
  end if;
end
$publish_marketing$;
select c.catalog_key,cv.version,cv.status,r.requirement_key,rv.title,rv.requirement_kind,rv.passing_score,rv.max_attempts,o.capability
  from learning.curricula c join learning.curriculum_versions cv on cv.curriculum_id=c.id
  join learning.curriculum_capability_outcomes o on o.curriculum_version_id=cv.id
  join learning.requirement_versions rv on rv.id=o.requirement_version_id join learning.requirements r on r.id=rv.requirement_id
  where c.catalog_key=${literal(catalogKey)} and cv.version=2 order by o.capability;
${commit ? "commit" : "rollback"};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    "project-ref": { type: "string" }, "owner-email": { type: "string" },
    "reviewer-email": { type: "string" }, commit: { type: "boolean", default: false },
  } });
  process.stdout.write(renderMarketingReservationTrainingSql({
    projectRef: values["project-ref"], ownerEmail: values["owner-email"],
    reviewerEmail: values["reviewer-email"], commit: values.commit,
  }));
}
