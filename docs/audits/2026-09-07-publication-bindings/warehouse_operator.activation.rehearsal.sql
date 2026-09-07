-- UAT activation ONLY after verified compatible PUBLIC runtime and separate graph review.
begin isolation level read committed;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $activate$
declare source_id uuid; target_id uuid; n integer;
begin
  select cv.id into strict source_id from learning.curriculum_versions cv join learning.curricula c on c.id=cv.curriculum_id
    where c.catalog_key='internal.warehouse.warehouse_operator.receiving-certification.v1' and cv.version=1 and cv.status='published';
  select cv.id into strict target_id from learning.curriculum_versions cv join learning.curricula c on c.id=cv.curriculum_id
    where c.catalog_key='internal.warehouse.warehouse_operator.receiving-certification.v1' and cv.version=2 and cv.status='published' and cv.audience='internal'
      and cv.effective_at<=statement_timestamp() and (cv.expires_at is null or cv.expires_at>statement_timestamp());
  perform private.lock_learning_curriculum_graph(array[source_id,target_id]);
  if exists(select 1 from learning.curriculum_versions newer join learning.curriculum_versions target on target.id=target_id
    where newer.curriculum_id=target.curriculum_id and newer.version>2) then raise exception 'Newer curriculum exists; activation review is stale'; end if;
  if (select md5(jsonb_build_object('curriculum',to_jsonb(c),'version',to_jsonb(cv),
    'members',(select jsonb_agg(to_jsonb(cr) order by cr.id) from learning.curriculum_requirements cr where cr.curriculum_version_id=cv.id),
    'requirements',(select jsonb_agg(to_jsonb(rv) order by rv.id) from learning.requirement_versions rv join learning.curriculum_requirements cr on cr.requirement_version_id=rv.id where cr.curriculum_version_id=cv.id),
    'edges',(select jsonb_agg(to_jsonb(e) order by e.id) from learning.curriculum_requirement_prerequisites e where e.curriculum_version_id=cv.id),
    'outcomes',(select jsonb_agg(to_jsonb(o) order by o.id) from learning.curriculum_capability_outcomes o where o.curriculum_version_id=cv.id),
    'mapping',(select jsonb_agg(to_jsonb(rc) order by rc.id) from learning.role_curricula rc where rc.curriculum_version_id=cv.id)
    )::text) as fingerprint from learning.curricula c join learning.curriculum_versions cv on cv.curriculum_id=c.id
    where c.catalog_key='internal.warehouse.warehouse_operator.receiving-certification.v1' and cv.version=1) is distinct from '63bd32726b57af27856d732707a4a137' or
    (select md5(jsonb_build_object('curriculum',to_jsonb(c),'version',to_jsonb(cv),
    'members',(select jsonb_agg(to_jsonb(cr) order by cr.id) from learning.curriculum_requirements cr where cr.curriculum_version_id=cv.id),
    'requirements',(select jsonb_agg(to_jsonb(rv) order by rv.id) from learning.requirement_versions rv join learning.curriculum_requirements cr on cr.requirement_version_id=rv.id where cr.curriculum_version_id=cv.id),
    'edges',(select jsonb_agg(to_jsonb(e) order by e.id) from learning.curriculum_requirement_prerequisites e where e.curriculum_version_id=cv.id),
    'outcomes',(select jsonb_agg(to_jsonb(o) order by o.id) from learning.curriculum_capability_outcomes o where o.curriculum_version_id=cv.id),
    'mapping',(select jsonb_agg(to_jsonb(rc) order by rc.id) from learning.role_curricula rc where rc.curriculum_version_id=cv.id)
    )::text) as fingerprint from learning.curricula c join learning.curriculum_versions cv on cv.curriculum_id=c.id
    where c.catalog_key='internal.warehouse.warehouse_operator.receiving-certification.v1' and cv.version=2) is distinct from '6a9727545ff5e910a0196d5fb87c63a3' then raise exception 'Activation baseline drift'; end if;
  if exists(select 1 from learning.role_curricula where curriculum_version_id=target_id) then raise exception 'Already mapped; review current state'; end if;
  if not exists(select 1 from core.profiles where id='5f86c147-34aa-4722-be5b-ed085caf97eb' and email='intra.test.admin@mwell.com.ph' and status='active' and kind='employee')
    then raise exception 'UAT custodian identity drift'; end if;
  insert into learning.role_curricula(module,role,curriculum_version_id,audience,department_id,effective_at,expires_at,created_by)
    select rc.module,rc.role,target_id,rc.audience,rc.department_id,statement_timestamp(),rc.expires_at,'5f86c147-34aa-4722-be5b-ed085caf97eb'::uuid
    from learning.role_curricula rc where rc.curriculum_version_id=source_id and rc.module='warehouse' and rc.role='warehouse_operator'
      and rc.effective_at<=statement_timestamp() and (rc.expires_at is null or rc.expires_at>statement_timestamp());
  get diagnostics n = row_count;
  if n=0 then raise exception 'Current source role mapping missing'; end if;
end;
$activate$;
rollback;
