-- UAT ONLY. Mode: reviewed publication. Execute only through main after review.
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
  select id into strict owner_actor from core.profiles where lower(email)=lower('intra.test.admin@mwell.com.ph') and kind='employee' and status='active';
  select id into strict reviewer_actor from core.profiles where lower(email)=lower('intra.test.legal.lead@mwell.com.ph') and kind='employee' and status='active';
  if owner_actor<>'5f86c147-34aa-4722-be5b-ed085caf97eb'::uuid or reviewer_actor<>'ab803856-0f20-4d1a-abe6-8444052725f2'::uuid then raise exception 'UAT audit custodian identity drift'; end if;
  if owner_actor=reviewer_actor then raise exception 'Independent actors required'; end if;
  if not exists(select 1 from core.user_roles ur join core.roles r on r.module=ur.module and r.role=ur.role
    where ur.user_id=owner_actor and ur.module='core' and ur.role='platform_admin' and r.is_active
    and ur.effective_at<=statement_timestamp() and (ur.expires_at is null or ur.expires_at>statement_timestamp()))
    then raise exception 'Active platform administrator required'; end if;
  if not exists(select 1 from core.role_capabilities where module='warehouse' and role='warehouse_operator' and cap='inspect_quality')
    then raise exception 'Correction cannot grant absent role authority'; end if;
  select cv.* into strict b from learning.curriculum_versions cv join learning.curricula root on root.id=cv.curriculum_id
    where root.catalog_key='internal.warehouse.warehouse_operator.receiving-certification.v1' and root.audience='internal' and root.governance_owner='platform' and root.status='active'
    and cv.version=1 and cv.status='published' and cv.effective_at<=statement_timestamp()
    and (cv.expires_at is null or cv.expires_at>statement_timestamp()) for share of cv,root;
  perform private.lock_learning_curriculum_graph(array[b.id]);
  if (select md5(jsonb_build_object('curriculum',to_jsonb(c),'version',to_jsonb(cv),
    'members',(select jsonb_agg(to_jsonb(cr) order by cr.id) from learning.curriculum_requirements cr where cr.curriculum_version_id=cv.id),
    'requirements',(select jsonb_agg(to_jsonb(rv) order by rv.id) from learning.requirement_versions rv join learning.curriculum_requirements cr on cr.requirement_version_id=rv.id where cr.curriculum_version_id=cv.id),
    'edges',(select jsonb_agg(to_jsonb(e) order by e.id) from learning.curriculum_requirement_prerequisites e where e.curriculum_version_id=cv.id),
    'outcomes',(select jsonb_agg(to_jsonb(o) order by o.id) from learning.curriculum_capability_outcomes o where o.curriculum_version_id=cv.id),
    'mapping',(select jsonb_agg(to_jsonb(rc) order by rc.id) from learning.role_curricula rc where rc.curriculum_version_id=cv.id)
    )::text) as fingerprint from learning.curricula c join learning.curriculum_versions cv on cv.curriculum_id=c.id
    where c.catalog_key='internal.warehouse.warehouse_operator.receiving-certification.v1' and cv.version=1) is distinct from '63bd32726b57af27856d732707a4a137' then raise exception 'Reviewed baseline drift'; end if;
  if exists(select 1 from learning.curriculum_versions cv where cv.curriculum_id=b.curriculum_id and cv.version>1)
    then raise exception 'Newer curriculum exists; never overwrite'; end if;
  select rv.* into strict old_r from learning.requirement_versions rv join learning.requirements root on root.id=rv.requirement_id
    join learning.curriculum_requirements cr on cr.requirement_version_id=rv.id and cr.curriculum_version_id=b.id
    where root.requirement_key='internal.role.warehouse.warehouse_operator.capability-practice.v1' and rv.version=1 and rv.status='published' and rv.requirement_kind='scenario'
    and rv.effective_at<=statement_timestamp() and (rv.expires_at is null or rv.expires_at>statement_timestamp()) for share of rv;
  if exists(select 1 from learning.requirements r where r.requirement_key='internal.role.warehouse.warehouse_operator.quality-inspection.v1')
    then raise exception 'Additive requirement already exists; never overwrite'; end if;
  select * into strict new_root from learning.requirements where id=old_r.requirement_id;
  new_root := jsonb_populate_record(new_root,jsonb_build_object('id',gen_random_uuid(),'requirement_key','internal.role.warehouse.warehouse_operator.quality-inspection.v1',
    'created_by',owner_actor,'created_at',statement_timestamp(),'status','active'));
  insert into learning.requirements select new_root.*;
  new_r := jsonb_populate_record(old_r,jsonb_build_object('id',gen_random_uuid(),'requirement_id',new_root.id,'version',1,'status','draft',
    'owner_id',owner_actor,'reviewer_id',null,'approved_at',null,'published_at',null,'effective_at',null,'expires_at',null,
    'created_at',statement_timestamp(),'supersedes_id',null,'materiality','material',
    'change_reason','Automated-reviewed inspect_quality learning coverage for 06c9b80bc6c09c343800756ebcadc0efdb88619f; inactive publication',
    'title','Inspect source-bound stock and route exceptions','simulation_id','warehouse-quality-inspection-review-v1',
    'content_reference','modules/learning/src/scopedReadinessCandidates.ts#warehouse-quality-inspection-review-v1',
    'assessment_settings','{}'::jsonb,'passing_score',null,'max_attempts',null,'estimated_minutes',6,
    'source_references',old_r.source_references||jsonb_build_array('{"type":"draft_mapping_content","candidate":"06c9b80bc6c09c343800756ebcadc0efdb88619f","review_reference":"docs/audits/2026-09-07-publication-bindings/warehouse_operator.review.json","reviewed_at":"2026-09-07T03:31:51Z","baseline_fingerprint":"63bd32726b57af27856d732707a4a137","simulation_id":"warehouse-quality-inspection-review-v1","content_sha256":"03ac69bd9e0ecf09898af99ac706085ea17f1860b222c1b3fa36f98efed062c8","source":"modules/learning/src/scopedReadinessCandidates.ts","rules_sha256":"deeb1dff8e5fa2998e59655bb66511a78a20becb5e01f8fafaaa8fd631f65a98","runtime_status":"registered_in_exact_reviewed_candidate","registered_runtime_candidate":"06c9b80bc6c09c343800756ebcadc0efdb88619f","publication_state":"reviewed_publication_inactive_no_role_mapping","review_mode":"automated","author_agent_id":"01a06fa0-d12a-73d0-a143-5e6c7f3a745e","reviewer_agent_id":"01a06fa2-a909-7bd0-84a1-90c820ec9c5f","review_artifact_sha256":"e1668c8b107237d8d82d42756abf282f21264142019173474092564bc7e9d26e","user_authorization_reference":"2026-09-07 current task explicit automated independent review and per-key publication binding request; no human signoff","custodian_attribution":"Existing UAT test profiles are audit custodians only; neither performed human review.","human_review_claimed":false}'::jsonb),
    'pass_rules','{"required_checkpoints":["confirm-source","hold-with-evidence","confirm-handoff"],"checkpoint_outcomes":{"confirm-source":["exact-source"],"hold-with-evidence":["complete-hold"],"confirm-handoff":["verify-route"]}}'::jsonb));
  insert into learning.requirement_versions select new_r.*;
  v := jsonb_populate_record(b,jsonb_build_object('id',gen_random_uuid(),'version',2,'status','draft',
    'owner_id',owner_actor,'reviewer_id',null,'approved_at',null,'published_at',null,'effective_at',null,'expires_at',null,
    'created_at',statement_timestamp(),'supersedes_id',b.id,'materiality','material',
    'change_reason','Automated-reviewed inspect_quality curriculum for 06c9b80bc6c09c343800756ebcadc0efdb88619f; role activation separate',
    'source_references',b.source_references||jsonb_build_array('{"type":"draft_mapping_content","candidate":"06c9b80bc6c09c343800756ebcadc0efdb88619f","review_reference":"docs/audits/2026-09-07-publication-bindings/warehouse_operator.review.json","reviewed_at":"2026-09-07T03:31:51Z","baseline_fingerprint":"63bd32726b57af27856d732707a4a137","simulation_id":"warehouse-quality-inspection-review-v1","content_sha256":"03ac69bd9e0ecf09898af99ac706085ea17f1860b222c1b3fa36f98efed062c8","source":"modules/learning/src/scopedReadinessCandidates.ts","rules_sha256":"deeb1dff8e5fa2998e59655bb66511a78a20becb5e01f8fafaaa8fd631f65a98","runtime_status":"registered_in_exact_reviewed_candidate","registered_runtime_candidate":"06c9b80bc6c09c343800756ebcadc0efdb88619f","publication_state":"reviewed_publication_inactive_no_role_mapping","review_mode":"automated","author_agent_id":"01a06fa0-d12a-73d0-a143-5e6c7f3a745e","reviewer_agent_id":"01a06fa2-a909-7bd0-84a1-90c820ec9c5f","review_artifact_sha256":"e1668c8b107237d8d82d42756abf282f21264142019173474092564bc7e9d26e","user_authorization_reference":"2026-09-07 current task explicit automated independent review and per-key publication binding request; no human signoff","custodian_attribution":"Existing UAT test profiles are audit custodians only; neither performed human review.","human_review_claimed":false}'::jsonb)));
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
    select cr.id,v.id,new_r.id,'internal','warehouse','inspect_quality',owner_actor from learning.curriculum_requirements cr
    where cr.curriculum_version_id=v.id and cr.requirement_version_id=new_r.id;
  if (select md5(jsonb_build_object('curriculum',to_jsonb(c),'version',to_jsonb(cv),
    'members',(select jsonb_agg(to_jsonb(cr) order by cr.id) from learning.curriculum_requirements cr where cr.curriculum_version_id=cv.id),
    'requirements',(select jsonb_agg(to_jsonb(rv) order by rv.id) from learning.requirement_versions rv join learning.curriculum_requirements cr on cr.requirement_version_id=rv.id where cr.curriculum_version_id=cv.id),
    'edges',(select jsonb_agg(to_jsonb(e) order by e.id) from learning.curriculum_requirement_prerequisites e where e.curriculum_version_id=cv.id),
    'outcomes',(select jsonb_agg(to_jsonb(o) order by o.id) from learning.curriculum_capability_outcomes o where o.curriculum_version_id=cv.id),
    'mapping',(select jsonb_agg(to_jsonb(rc) order by rc.id) from learning.role_curricula rc where rc.curriculum_version_id=cv.id)
    )::text) as fingerprint from learning.curricula c join learning.curriculum_versions cv on cv.curriculum_id=c.id
    where c.catalog_key='internal.warehouse.warehouse_operator.receiving-certification.v1' and cv.version=1) is distinct from '63bd32726b57af27856d732707a4a137' then raise exception 'Baseline changed'; end if;
  
  if exists(select 1 from learning.requirements where requirement_key='internal.role.warehouse.warehouse_operator.putaway.v1') then raise exception 'Ops additive root already exists'; end if;
  if not exists(select 1 from core.role_capabilities where module='warehouse' and role='warehouse_operator' and cap='transfer_stock') then raise exception 'Ops additive outcome lacks existing role grant'; end if;
  select * into strict extra_root from learning.requirements where id=old_r.requirement_id;
  extra_root := jsonb_populate_record(extra_root,jsonb_build_object('id',gen_random_uuid(),'requirement_key','internal.role.warehouse.warehouse_operator.putaway.v1','created_by',owner_actor,'created_at',statement_timestamp()));
  insert into learning.requirements select extra_root.*;
  extra_r := jsonb_populate_record(new_r,jsonb_build_object('id',gen_random_uuid(),'requirement_id',extra_root.id,
    'title','Put away eligible stock into its verified destination','simulation_id','warehouse-putaway-review-v1','pass_rules','{"required_checkpoints":["eligible-source","destination-quantity","readback"],"checkpoint_outcomes":{"eligible-source":["verify"],"destination-quantity":["verify"],"readback":["verify"]}}'::jsonb,
    'content_reference','modules/learning/src/opsCustodyCandidates.ts#warehouse-putaway-review-v1',
    'source_references',old_r.source_references||jsonb_build_array('{"type":"draft_mapping_content","candidate":"06c9b80bc6c09c343800756ebcadc0efdb88619f","review_reference":"docs/audits/2026-09-07-publication-bindings/warehouse_operator.review.json","reviewed_at":"2026-09-07T03:31:51Z","baseline_fingerprint":"63bd32726b57af27856d732707a4a137","simulation_id":"warehouse-putaway-review-v1","content_sha256":"444e9c98a0f18cd5099076a5b476b1d93d5fdf23c351dfad481c7d0674a5ba76","source":"modules/learning/src/opsCustodyCandidates.ts","rules_sha256":"0353e6083a2f33d426a5078833451dfec6ec804546c022a62d70c605eda4e87f","runtime_status":"registered_in_exact_reviewed_candidate","registered_runtime_candidate":"06c9b80bc6c09c343800756ebcadc0efdb88619f","publication_state":"reviewed_publication_inactive_no_role_mapping","review_mode":"automated","author_agent_id":"01a06fa0-d12a-73d0-a143-5e6c7f3a745e","reviewer_agent_id":"01a06fa2-a909-7bd0-84a1-90c820ec9c5f","review_artifact_sha256":"e1668c8b107237d8d82d42756abf282f21264142019173474092564bc7e9d26e","user_authorization_reference":"2026-09-07 current task explicit automated independent review and per-key publication binding request; no human signoff","custodian_attribution":"Existing UAT test profiles are audit custodians only; neither performed human review.","human_review_claimed":false}'::jsonb)));
  insert into learning.requirement_versions select extra_r.*;
  insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
    select v.id,extra_r.id,'internal',max(sort_order)+1,true,owner_actor from learning.curriculum_requirements where curriculum_version_id=v.id;
  insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    select id,v.id,extra_r.id,old_r.id,'internal',owner_actor from learning.curriculum_requirements where curriculum_version_id=v.id and requirement_version_id=extra_r.id;
  insert into learning.curriculum_capability_outcomes(curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
    select id,v.id,extra_r.id,'internal','warehouse','transfer_stock',owner_actor from learning.curriculum_requirements where curriculum_version_id=v.id and requirement_version_id=extra_r.id;
  

  if exists(select 1 from learning.requirements where requirement_key='internal.role.warehouse.warehouse_operator.pick-pack.v1') then raise exception 'Ops additive root already exists'; end if;
  if not exists(select 1 from core.role_capabilities where module='warehouse' and role='warehouse_operator' and cap='reserve_allocate') then raise exception 'Ops additive outcome lacks existing role grant'; end if;
if not exists(select 1 from core.role_capabilities where module='warehouse' and role='warehouse_operator' and cap='issue_items') then raise exception 'Ops additive outcome lacks existing role grant'; end if;
  select * into strict extra_root from learning.requirements where id=old_r.requirement_id;
  extra_root := jsonb_populate_record(extra_root,jsonb_build_object('id',gen_random_uuid(),'requirement_key','internal.role.warehouse.warehouse_operator.pick-pack.v1','created_by',owner_actor,'created_at',statement_timestamp()));
  insert into learning.requirements select extra_root.*;
  extra_r := jsonb_populate_record(new_r,jsonb_build_object('id',gen_random_uuid(),'requirement_id',extra_root.id,
    'title','Allocate, verify picks and hand off packing for independent release','simulation_id','warehouse-pick-pack-review-v1','pass_rules','{"required_checkpoints":["allocation","verified-pick","pack-handoff"],"checkpoint_outcomes":{"allocation":["verify"],"verified-pick":["verify"],"pack-handoff":["verify"]}}'::jsonb,
    'content_reference','modules/learning/src/opsCustodyCandidates.ts#warehouse-pick-pack-review-v1',
    'source_references',old_r.source_references||jsonb_build_array('{"type":"draft_mapping_content","candidate":"06c9b80bc6c09c343800756ebcadc0efdb88619f","review_reference":"docs/audits/2026-09-07-publication-bindings/warehouse_operator.review.json","reviewed_at":"2026-09-07T03:31:51Z","baseline_fingerprint":"63bd32726b57af27856d732707a4a137","simulation_id":"warehouse-pick-pack-review-v1","content_sha256":"d46411fbf73f14c9ef20cc8814e5733bd5fb6cddd65fb2c53c520993a5f31470","source":"modules/learning/src/opsCustodyCandidates.ts","rules_sha256":"0353e6083a2f33d426a5078833451dfec6ec804546c022a62d70c605eda4e87f","runtime_status":"registered_in_exact_reviewed_candidate","registered_runtime_candidate":"06c9b80bc6c09c343800756ebcadc0efdb88619f","publication_state":"reviewed_publication_inactive_no_role_mapping","review_mode":"automated","author_agent_id":"01a06fa0-d12a-73d0-a143-5e6c7f3a745e","reviewer_agent_id":"01a06fa2-a909-7bd0-84a1-90c820ec9c5f","review_artifact_sha256":"e1668c8b107237d8d82d42756abf282f21264142019173474092564bc7e9d26e","user_authorization_reference":"2026-09-07 current task explicit automated independent review and per-key publication binding request; no human signoff","custodian_attribution":"Existing UAT test profiles are audit custodians only; neither performed human review.","human_review_claimed":false}'::jsonb)));
  insert into learning.requirement_versions select extra_r.*;
  insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
    select v.id,extra_r.id,'internal',max(sort_order)+1,true,owner_actor from learning.curriculum_requirements where curriculum_version_id=v.id;
  insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    select id,v.id,extra_r.id,old_r.id,'internal',owner_actor from learning.curriculum_requirements where curriculum_version_id=v.id and requirement_version_id=extra_r.id;
  insert into learning.curriculum_capability_outcomes(curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
    select id,v.id,extra_r.id,'internal','warehouse','reserve_allocate',owner_actor from learning.curriculum_requirements where curriculum_version_id=v.id and requirement_version_id=extra_r.id;
insert into learning.curriculum_capability_outcomes(curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
    select id,v.id,extra_r.id,'internal','warehouse','issue_items',owner_actor from learning.curriculum_requirements where curriculum_version_id=v.id and requirement_version_id=extra_r.id;
  
  if exists(select rv.requirement_id from learning.curriculum_requirements cr
    join learning.requirement_versions rv on rv.id=cr.requirement_version_id
    where cr.curriculum_version_id=v.id group by rv.requirement_id having count(*)>1)
    then raise exception 'Competing requirement versions in proposed curriculum'; end if;
  
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
  where c.catalog_key='internal.warehouse.warehouse_operator.receiving-certification.v1' and cv.version=2 and rv.requirement_id in
    (select id from learning.requirements where requirement_key='internal.role.warehouse.warehouse_operator.quality-inspection.v1');
rollback;
