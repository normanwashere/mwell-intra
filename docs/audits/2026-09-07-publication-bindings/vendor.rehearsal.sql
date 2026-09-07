-- UAT-only automated-review custodian inactive publication rehearsal; no role mappings.
-- Renderer only; execution requires separate authorization.
begin isolation level read committed;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $vendor_draft$
<<vendor_publication>>
declare owner_id uuid; reviewer_actor uuid; base learning.curriculum_versions%rowtype;
  root_id uuid; requirement_id uuid; curriculum_id uuid; orientation_id uuid;
  original_practice_id uuid; practice_id uuid;
  practice_root learning.requirements%rowtype; practice_version learning.requirement_versions%rowtype;
begin
  select p.id into strict owner_id from core.profiles p
    where lower(p.email)=lower('intra.test.admin@mwell.com.ph') and p.kind='employee' and p.status='active';
  select p.id into strict reviewer_actor from core.profiles p
    where lower(p.email)=lower('intra.test.legal.lead@mwell.com.ph') and p.kind='employee' and p.status='active';
  if owner_id<>'5f86c147-34aa-4722-be5b-ed085caf97eb'::uuid or reviewer_actor<>'ab803856-0f20-4d1a-abe6-8444052725f2'::uuid then raise exception 'UAT custodian identity drift'; end if;
  if owner_id=reviewer_actor then raise exception 'Independent reviewer required'; end if;
  if not exists(select 1 from core.user_roles ur join core.roles r on r.module=ur.module and r.role=ur.role
    where ur.user_id=owner_id and ur.module='core' and ur.role='platform_admin' and r.is_active
      and ur.effective_at<=statement_timestamp() and (ur.expires_at is null or ur.expires_at>statement_timestamp()))
    then raise exception 'Active platform-admin content owner required'; end if;
  select cv.* into strict base from learning.curriculum_versions cv join learning.curricula c on c.id=cv.curriculum_id
    where c.catalog_key='vendor.role.core.vendor_portal.capability-practice.v1.curriculum'
      and c.audience='vendor' and c.governance_owner='platform' and c.status='active'
      and cv.version=1 and cv.status='published' and cv.effective_at<=statement_timestamp()
      and (cv.expires_at is null or cv.expires_at>statement_timestamp()) for share of cv,c;
  perform private.lock_learning_curriculum_graph(array[base.id]);
  if (select md5(jsonb_build_object(
    'root',to_jsonb(c),'version',to_jsonb(cv),
    'members',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_requirements x where x.curriculum_version_id=cv.id),
    'requirements',(select jsonb_agg(jsonb_build_object('root',to_jsonb(r),'version',to_jsonb(rv)) order by rv.id) from learning.curriculum_requirements m join learning.requirement_versions rv on rv.id=m.requirement_version_id join learning.requirements r on r.id=rv.requirement_id where m.curriculum_version_id=cv.id),
    'edges',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_requirement_prerequisites x where x.curriculum_version_id=cv.id),
    'outcomes',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_capability_outcomes x where x.curriculum_version_id=cv.id),
    'maps',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.role_curricula x where x.curriculum_version_id=cv.id)
  )::text) as fingerprint from learning.curricula c join learning.curriculum_versions cv on cv.curriculum_id=c.id
  where c.catalog_key='vendor.role.core.vendor_portal.capability-practice.v1.curriculum' and cv.version=1) is distinct from 'eb8668999e6f7826e1ec8ebc05ef6a7a' then raise exception 'Vendor baseline drift'; end if;
  if exists(select 1 from learning.curriculum_versions cv where cv.curriculum_id=base.curriculum_id and cv.version>1)
    or exists(select 1 from learning.requirements r where r.requirement_key='vendor.vendor_representative.evidence-and-acknowledgments.v1')
    or exists(select 1 from learning.requirements r where r.requirement_key='vendor.vendor_representative.evidence-backed-submission-practice.v1')
    then raise exception 'Draft or newer content already exists: review instead of overwriting'; end if;
  if (select jsonb_agg(jsonb_build_array(r.requirement_key,rv.version,rv.requirement_kind,cr.sort_order,cr.mandatory) order by cr.sort_order)
    from learning.curriculum_requirements cr join learning.requirement_versions rv on rv.id=cr.requirement_version_id
    join learning.requirements r on r.id=rv.requirement_id where cr.curriculum_version_id=base.id)
    is distinct from '[ ["vendor.vendor_representative.orientation.v1",1,"orientation",0,true], ["vendor.role.core.vendor_portal.capability-practice.v1",1,"scenario",1,true] ]'::jsonb
    then raise exception 'Vendor base composition drift'; end if;
  select rv.id into strict orientation_id from learning.curriculum_requirements cr
    join learning.requirement_versions rv on rv.id=cr.requirement_version_id
    where cr.curriculum_version_id=base.id and cr.sort_order=0;
  if (select jsonb_agg(jsonb_build_array(r.requirement_key,p.requirement_key) order by r.requirement_key)
    from learning.curriculum_requirement_prerequisites e
    join learning.requirement_versions rv on rv.id=e.requirement_version_id
    join learning.requirements r on r.id=rv.requirement_id
    join learning.requirement_versions pv on pv.id=e.prerequisite_requirement_version_id
    join learning.requirements p on p.id=pv.requirement_id where e.curriculum_version_id=base.id)
    is distinct from '[["vendor.role.core.vendor_portal.capability-practice.v1","vendor.vendor_representative.orientation.v1"]]'::jsonb
    then raise exception 'Vendor base prerequisite drift'; end if;
  if (select jsonb_agg(jsonb_build_array(r.requirement_key,o.module,o.capability) order by r.requirement_key,o.module,o.capability)
    from learning.curriculum_capability_outcomes o join learning.requirement_versions rv on rv.id=o.requirement_version_id
    join learning.requirements r on r.id=rv.requirement_id where o.curriculum_version_id=base.id)
    is distinct from '[["vendor.role.core.vendor_portal.capability-practice.v1","core","submit_accreditation"]]'::jsonb
    then raise exception 'Vendor base outcome drift'; end if;
  select cr.requirement_version_id into strict original_practice_id from learning.curriculum_requirements cr
    where cr.curriculum_version_id=base.id and cr.sort_order=1;
  practice_id := original_practice_id;
  
  select rv.* into strict practice_version from learning.requirement_versions rv where rv.id=original_practice_id
    and rv.status='published' and rv.requirement_kind='scenario' and rv.effective_at<=statement_timestamp()
    and (rv.expires_at is null or rv.expires_at>statement_timestamp()) for share;
  select r.* into strict practice_root from learning.requirements r where r.id=practice_version.requirement_id for share;
  practice_root := jsonb_populate_record(practice_root,jsonb_build_object('id',gen_random_uuid(),
    'requirement_key','vendor.vendor_representative.evidence-backed-submission-practice.v1','created_by',owner_id,'created_at',statement_timestamp()));
  insert into learning.requirements select practice_root.*;
  practice_version := jsonb_populate_record(practice_version,jsonb_build_object('id',gen_random_uuid(),
    'requirement_id',practice_root.id,'version',1,'status','draft','owner_id',owner_id,
    'reviewer_id',null,'approved_at',null,'published_at',null,'effective_at',null,'expires_at',null,
    'created_at',statement_timestamp(),'supersedes_id',null,'materiality','material',
    'change_reason','Distinct evidence-backed practice identity; preserved prior content and certificates',
    'source_references',practice_version.source_references || '[{"type":"application_catalog","commit":"06c9b80bc6c09c343800756ebcadc0efdb88619f","path":"modules/learning/src/catalog.ts","sha256":"bce1c0278fdc7b4498ac42539497d004a4c980b1e56488f63c6fd4d01b9ea906","simulation_id":"vendor-evidence-review-v1","version":1},{"type":"automated_review_reference","review_mode":"automated","reference":"docs/audits/2026-09-07-publication-bindings/vendor.review.json","artifact_sha256":"1336bb8155c85a92e6cd4c60773dd8e462e753391a9446951b20d6dcd45edd74","pass_rules_sha256":"bcb08d0d5a727341ebb4ecf78e88dec547710407d901d5c92752b9bf3b1d9068","author_agent_id":"01a06fa0-d12a-73d0-a143-5e6c7f3a745e","reviewer_agent_id":"01a06fa2-a909-7bd0-84a1-90c820ec9c5f","reviewed_at":"2026-09-07T03:48:26Z","user_authorization_reference":"2026-09-07 explicit user-authorized automated independent vendor changed-graph publication binding review","custodian_attribution":"Existing UAT test accounts are audit custodians only, not human authors or reviewers.","human_review_claimed":false},{"type":"publication_baseline","baseline_fingerprint":"eb8668999e6f7826e1ec8ebc05ef6a7a","activation_policy":"publish_inactive_no_role_maps","human_review_claimed":false}]'::jsonb));
  insert into learning.requirement_versions select practice_version.*;
  practice_id := practice_version.id;
  
  insert into learning.requirements(requirement_key,audience,requirement_kind,governance_owner,created_by)
    values('vendor.vendor_representative.evidence-and-acknowledgments.v1','vendor','attestation','platform',owner_id) returning id into root_id;
  insert into learning.requirement_versions(requirement_id,audience,requirement_kind,governance_owner,version,status,
    title,simulation_id,content_reference,pass_rules,estimated_minutes,waivable,change_reason,materiality,source_references,owner_id)
    values(root_id,'vendor','attestation','platform',1,'draft','Vendor evidence and acknowledgments',
      'vendor-evidence-review-v1',null,'{"required_checkpoints":["review-evidence","complete"],"checkpoint_outcomes":{"review-evidence":["reviewed"],"complete":["reviewed"]}}'::jsonb,3,false,
      'Add vendor evidence learning review; no legal declaration or operational authority','material',
      '[{"type":"application_catalog","commit":"06c9b80bc6c09c343800756ebcadc0efdb88619f","path":"modules/learning/src/catalog.ts","sha256":"bce1c0278fdc7b4498ac42539497d004a4c980b1e56488f63c6fd4d01b9ea906","simulation_id":"vendor-evidence-review-v1","version":1},{"type":"automated_review_reference","review_mode":"automated","reference":"docs/audits/2026-09-07-publication-bindings/vendor.review.json","artifact_sha256":"1336bb8155c85a92e6cd4c60773dd8e462e753391a9446951b20d6dcd45edd74","pass_rules_sha256":"bcb08d0d5a727341ebb4ecf78e88dec547710407d901d5c92752b9bf3b1d9068","author_agent_id":"01a06fa0-d12a-73d0-a143-5e6c7f3a745e","reviewer_agent_id":"01a06fa2-a909-7bd0-84a1-90c820ec9c5f","reviewed_at":"2026-09-07T03:48:26Z","user_authorization_reference":"2026-09-07 explicit user-authorized automated independent vendor changed-graph publication binding review","custodian_attribution":"Existing UAT test accounts are audit custodians only, not human authors or reviewers.","human_review_claimed":false},{"type":"publication_baseline","baseline_fingerprint":"eb8668999e6f7826e1ec8ebc05ef6a7a","activation_policy":"publish_inactive_no_role_maps","human_review_claimed":false}]'::jsonb,owner_id) returning id into requirement_id;
  insert into learning.curriculum_versions(curriculum_id,audience,version,status,change_reason,materiality,source_references,owner_id,supersedes_id)
    values(base.curriculum_id,'vendor',2,'draft','Add mandatory vendor evidence learning review','material',
      '[{"type":"application_catalog","commit":"06c9b80bc6c09c343800756ebcadc0efdb88619f","path":"modules/learning/src/catalog.ts","sha256":"bce1c0278fdc7b4498ac42539497d004a4c980b1e56488f63c6fd4d01b9ea906","simulation_id":"vendor-evidence-review-v1","version":1},{"type":"automated_review_reference","review_mode":"automated","reference":"docs/audits/2026-09-07-publication-bindings/vendor.review.json","artifact_sha256":"1336bb8155c85a92e6cd4c60773dd8e462e753391a9446951b20d6dcd45edd74","pass_rules_sha256":"bcb08d0d5a727341ebb4ecf78e88dec547710407d901d5c92752b9bf3b1d9068","author_agent_id":"01a06fa0-d12a-73d0-a143-5e6c7f3a745e","reviewer_agent_id":"01a06fa2-a909-7bd0-84a1-90c820ec9c5f","reviewed_at":"2026-09-07T03:48:26Z","user_authorization_reference":"2026-09-07 explicit user-authorized automated independent vendor changed-graph publication binding review","custodian_attribution":"Existing UAT test accounts are audit custodians only, not human authors or reviewers.","human_review_claimed":false},{"type":"publication_baseline","baseline_fingerprint":"eb8668999e6f7826e1ec8ebc05ef6a7a","activation_policy":"publish_inactive_no_role_maps","human_review_claimed":false}]'::jsonb,owner_id,base.id) returning id into curriculum_id;
  insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
    select curriculum_id,case when cr.requirement_version_id=original_practice_id then practice_id else cr.requirement_version_id end,'vendor',case when cr.sort_order=0 then 0 else 2 end,cr.mandatory,owner_id
    from learning.curriculum_requirements cr where cr.curriculum_version_id=base.id;
  insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
    values(curriculum_id,requirement_id,'vendor',1,true,owner_id);
  insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    select cr.id,curriculum_id,cr.requirement_version_id,e.prerequisite_requirement_version_id,'vendor',owner_id
    from learning.curriculum_requirement_prerequisites e join learning.curriculum_requirements cr
      on cr.curriculum_version_id=curriculum_id and cr.requirement_version_id=case when e.requirement_version_id=original_practice_id then practice_id else e.requirement_version_id end
    where e.curriculum_version_id=base.id;
  insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    select cr.id,curriculum_id,requirement_id,orientation_id,'vendor',owner_id from learning.curriculum_requirements cr
    where cr.curriculum_version_id=curriculum_id and cr.requirement_version_id=requirement_id;
  insert into learning.curriculum_capability_outcomes(curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
    select cr.id,curriculum_id,cr.requirement_version_id,'vendor',o.module,o.capability,owner_id
    from learning.curriculum_capability_outcomes o join learning.curriculum_requirements cr
      on cr.curriculum_version_id=curriculum_id and cr.requirement_version_id=case when o.requirement_version_id=original_practice_id then practice_id else o.requirement_version_id end
    where o.curriculum_version_id=base.id;
  insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    select cr.id,curriculum_id,cr.requirement_version_id,requirement_id,'vendor',owner_id
    from learning.curriculum_requirements cr where cr.curriculum_version_id=curriculum_id and cr.sort_order=2;
  if (select count(*) from learning.curriculum_requirement_prerequisites e where e.curriculum_version_id=curriculum_id)<>3
    or exists(select 1 from learning.curriculum_requirement_prerequisites e
      left join learning.curriculum_requirements child on child.curriculum_version_id=e.curriculum_version_id and child.requirement_version_id=e.requirement_version_id
      left join learning.curriculum_requirements parent on parent.curriculum_version_id=e.curriculum_version_id and parent.requirement_version_id=e.prerequisite_requirement_version_id
      where e.curriculum_version_id=curriculum_id and (child.id is null or parent.id is null or parent.sort_order>=child.sort_order))
    then raise exception 'Vendor proposed prerequisite graph invalid'; end if;
  if (select count(*) from learning.curriculum_capability_outcomes o where o.curriculum_version_id=curriculum_id)<>1
    or exists(select 1 from learning.curriculum_capability_outcomes o where o.curriculum_version_id=curriculum_id and o.requirement_version_id=requirement_id)
    then raise exception 'Vendor evidence must not grant authority'; end if;
  
  if (select md5(jsonb_build_object(
    'root',to_jsonb(c),'version',to_jsonb(cv),
    'members',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_requirements x where x.curriculum_version_id=cv.id),
    'requirements',(select jsonb_agg(jsonb_build_object('root',to_jsonb(r),'version',to_jsonb(rv)) order by rv.id) from learning.curriculum_requirements m join learning.requirement_versions rv on rv.id=m.requirement_version_id join learning.requirements r on r.id=rv.requirement_id where m.curriculum_version_id=cv.id),
    'edges',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_requirement_prerequisites x where x.curriculum_version_id=cv.id),
    'outcomes',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_capability_outcomes x where x.curriculum_version_id=cv.id),
    'maps',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.role_curricula x where x.curriculum_version_id=cv.id)
  )::text) as fingerprint from learning.curricula c join learning.curriculum_versions cv on cv.curriculum_id=c.id
  where c.catalog_key='vendor.role.core.vendor_portal.capability-practice.v1.curriculum' and cv.version=1) is distinct from 'eb8668999e6f7826e1ec8ebc05ef6a7a' then raise exception 'Vendor baseline changed'; end if;
  if exists(select rv.requirement_id from learning.curriculum_requirements cr join learning.requirement_versions rv on rv.id=cr.requirement_version_id
    where cr.curriculum_version_id=curriculum_id group by rv.requirement_id having count(*)>1) then raise exception 'Duplicate vendor requirement roots'; end if;
  update learning.requirement_versions set status='in_review' where id in (vendor_publication.requirement_id,practice_id) and status='draft';
  update learning.requirement_versions rv set status='approved',reviewer_id=reviewer_actor,approved_at=statement_timestamp(),effective_at=statement_timestamp()
    where rv.id in (vendor_publication.requirement_id,practice_id) and status='in_review';
  update learning.requirement_versions set status='published',published_at=effective_at where id in (vendor_publication.requirement_id,practice_id) and status='approved';
  update learning.curriculum_versions set status='in_review' where id=vendor_publication.curriculum_id and status='draft';
  update learning.curriculum_versions cv set status='approved',reviewer_id=reviewer_actor,approved_at=statement_timestamp(),effective_at=statement_timestamp()
    where cv.id=vendor_publication.curriculum_id and status='in_review';
  update learning.curriculum_versions set status='published',published_at=effective_at where id=vendor_publication.curriculum_id and status='approved';
  if not exists(select 1 from learning.requirement_versions rv where rv.id=vendor_publication.requirement_id and rv.status='published')
    or not exists(select 1 from learning.requirement_versions rv where rv.id=practice_id and rv.status='published')
    or not exists(select 1 from learning.curriculum_versions cv where cv.id=vendor_publication.curriculum_id and cv.status='published')
    then raise exception 'Vendor inactive publication incomplete'; end if;
  if (select md5(jsonb_build_object(
    'root',to_jsonb(c),'version',to_jsonb(cv),
    'members',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_requirements x where x.curriculum_version_id=cv.id),
    'requirements',(select jsonb_agg(jsonb_build_object('root',to_jsonb(r),'version',to_jsonb(rv)) order by rv.id) from learning.curriculum_requirements m join learning.requirement_versions rv on rv.id=m.requirement_version_id join learning.requirements r on r.id=rv.requirement_id where m.curriculum_version_id=cv.id),
    'edges',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_requirement_prerequisites x where x.curriculum_version_id=cv.id),
    'outcomes',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.curriculum_capability_outcomes x where x.curriculum_version_id=cv.id),
    'maps',(select jsonb_agg(to_jsonb(x) order by x.id) from learning.role_curricula x where x.curriculum_version_id=cv.id)
  )::text) as fingerprint from learning.curricula c join learning.curriculum_versions cv on cv.curriculum_id=c.id
  where c.catalog_key='vendor.role.core.vendor_portal.capability-practice.v1.curriculum' and cv.version=1) is distinct from 'eb8668999e6f7826e1ec8ebc05ef6a7a' then raise exception 'Vendor publication modified baseline'; end if;
  if exists(select 1 from learning.role_curricula rc where rc.curriculum_version_id=curriculum_id) then raise exception 'Vendor publication must remain inactive'; end if;
  
end;
$vendor_draft$;
select r.requirement_key,rv.status,rv.pass_rules,rv.content_reference,rv.source_references
  from learning.requirements r join learning.requirement_versions rv on rv.requirement_id=r.id
  where r.requirement_key='vendor.vendor_representative.evidence-and-acknowledgments.v1';
select child.sort_order as child_order,parent.sort_order as prerequisite_order
  from learning.curriculum_requirement_prerequisites e
  join learning.curriculum_requirements child on child.id=e.curriculum_requirement_id
  join learning.curriculum_requirements parent on parent.curriculum_version_id=e.curriculum_version_id and parent.requirement_version_id=e.prerequisite_requirement_version_id
  join learning.curriculum_versions cv on cv.id=e.curriculum_version_id
  join learning.curricula c on c.id=cv.curriculum_id
  where c.catalog_key='vendor.role.core.vendor_portal.capability-practice.v1.curriculum' and cv.version=2
  order by child.sort_order,parent.sort_order;
rollback;
