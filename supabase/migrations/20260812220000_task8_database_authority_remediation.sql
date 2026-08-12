-- Task 8 authority remediation is forward-only. Governed receiving requires
-- effective live capability, and policy evidence is pinned to the canonical
-- hash on the matching published controlled-document source reference.

create or replace function warehouse.receive_stock(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt warehouse.receipts;
  v_actor text;
begin
  if not core.has_live_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: receive_stock';
  end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'receipt' then
    payload := pg_catalog.jsonb_set(
      payload,
      '{receipt}',
      warehouse.force_actor_on_object(payload->'receipt', v_actor)
    );
    payload := pg_catalog.jsonb_set(
      payload,
      '{receipt,created_at}',
      pg_catalog.to_jsonb(pg_catalog.now()),
      true
    );
    payload := pg_catalog.jsonb_set(
      payload,
      '{receipt,quality_status}',
      pg_catalog.to_jsonb('pending'::text),
      true
    );
  end if;
  if payload ? 'movements' then
    payload := pg_catalog.jsonb_set(
      payload,
      '{movements}',
      warehouse.force_actor_on_array(payload->'movements', v_actor)
    );
  end if;
  if coalesce(pg_catalog.jsonb_array_length(payload->'lots'), 0) > 0 then
    insert into warehouse.lots
    select *
    from pg_catalog.jsonb_populate_recordset(
      null::warehouse.lots,
      payload->'lots'
    );
  end if;
  if coalesce(pg_catalog.jsonb_array_length(payload->'units'), 0) > 0 then
    insert into warehouse.inventory_units
    select *
    from pg_catalog.jsonb_populate_recordset(
      null::warehouse.inventory_units,
      payload->'units'
    );
  end if;
  if coalesce(
    pg_catalog.jsonb_array_length(payload->'stock_deltas'),
    0
  ) > 0 then
    insert into warehouse.stock_levels(
      product_id,
      location_id,
      bin_id,
      lot_id,
      quantity
    )
    select product_id, location_id, bin_id, lot_id, greatest(0, quantity)
    from pg_catalog.jsonb_populate_recordset(
      null::warehouse.stock_levels,
      (
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'product_id', delta->>'product_id',
          'location_id', delta->>'location_id',
          'bin_id', delta->>'bin_id',
          'lot_id', delta->>'lot_id',
          'quantity', (delta->>'delta')::integer
        ))
        from pg_catalog.jsonb_array_elements(payload->'stock_deltas') delta
      )
    )
    on conflict(product_id, location_id, bin_id, lot_id)
    do update set quantity = greatest(
      0,
      warehouse.stock_levels.quantity + excluded.quantity
    );
  end if;
  if coalesce(
    pg_catalog.jsonb_array_length(payload->'movements'),
    0
  ) > 0 then
    insert into warehouse.movements
    select *
    from pg_catalog.jsonb_populate_recordset(
      null::warehouse.movements,
      payload->'movements'
    );
  end if;
  insert into warehouse.receipts
  select *
  from pg_catalog.jsonb_populate_record(
    null::warehouse.receipts,
    payload->'receipt'
  )
  returning * into v_receipt;
  perform warehouse.register_evidence_docs(
    'receipt',
    v_receipt.id,
    v_receipt.evidence_urls
  );
  return pg_catalog.to_jsonb(v_receipt);
end;
$$;

create or replace function learning.acknowledge_policy(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_canonical_requirement_key constant text :=
    'internal.warehouse.receiving-custody-policy.v1';
  v_canonical_document_id constant text := 'OPS-WH-RCV-001';
  v_canonical_document_version constant text := '4.2';
  v_canonical_evidence_hash constant text :=
    '9b13c375513649ddab0af15ce7188a22fcbcefe7d861a7002e759cefb88e0cc0';
  v_requirement_id uuid;
  v_idempotency_key uuid;
  v_document_id text;
  v_document_version text;
  v_submitted_evidence_hash text;
  v_published_evidence_hash text;
  v_matching_source_count integer := 0;
  v_source_type text;
  v_source_id uuid;
  v_locked_assignment record;
  v_assignment learning.assignments%rowtype;
  v_assignment_requirement learning.assignment_requirements%rowtype;
  v_requirement_version learning.requirement_versions%rowtype;
  v_acknowledgment learning.policy_acknowledgments%rowtype;
  v_inserted integer := 0;
begin
  perform private.assert_learning_read_committed();
  if v_user_id is null then
    raise exception 'Authentication is required for learning services'
      using errcode = '28000';
  end if;
  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'object' then
    raise exception 'A learning command payload object is required';
  end if;
  if payload ?| array[
    'score', 'passed', 'answer_key', 'certification_status',
    'certification_state'
  ] then
    raise exception 'Forbidden learning authority field: score, passed, answer_key, certification_status, certification_state';
  end if;
  if payload - array[
    'assignment_requirement_id', 'controlled_document_id',
    'controlled_document_version', 'evidence_hash', 'idempotency_key'
  ] <> '{}'::jsonb then
    raise exception 'Unknown policy-acknowledgment payload field';
  end if;

  v_requirement_id := nullif(payload->>'assignment_requirement_id', '')::uuid;
  v_idempotency_key := nullif(payload->>'idempotency_key', '')::uuid;
  v_document_id := nullif(pg_catalog.btrim(payload->>'controlled_document_id'), '');
  v_document_version := nullif(
    pg_catalog.btrim(payload->>'controlled_document_version'),
    ''
  );
  v_submitted_evidence_hash := pg_catalog.lower(
    nullif(pg_catalog.btrim(payload->>'evidence_hash'), '')
  );
  if v_requirement_id is null
     or v_idempotency_key is null
     or v_document_id is null
     or v_document_version is null
     or v_submitted_evidence_hash is null
     or v_submitted_evidence_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Requirement, controlled document, evidence hash, and idempotency identifiers are required';
  end if;

  select assignment.source_type, assignment.source_id
  into v_source_type, v_source_id
  from learning.assignment_requirements assignment_requirement
  join learning.assignments assignment
    on assignment.id = assignment_requirement.assignment_id
  where assignment_requirement.id = v_requirement_id
    and assignment_requirement.user_id = v_user_id;
  if not found then
    raise exception 'Learning requirement is not assigned to the caller';
  end if;

  if v_source_type = 'role' then
    perform 1
    from core.roles role_definition
    join core.user_roles role_assignment
      on role_assignment.module = role_definition.module
     and role_assignment.role = role_definition.role
    where role_assignment.id = v_source_id
      and role_assignment.user_id = v_user_id
      and role_definition.is_active
    for key share of role_assignment;
    if not found then
      raise exception 'The source role assignment is no longer active';
    end if;
  end if;

  select
    assignment as assignment_row,
    assignment_requirement as requirement_row
  into v_locked_assignment
  from learning.assignments assignment
  join learning.assignment_requirements assignment_requirement
    on assignment_requirement.assignment_id = assignment.id
  where assignment_requirement.id = v_requirement_id
    and assignment_requirement.user_id = v_user_id
    and assignment.user_id = v_user_id
    and assignment.status in ('in_progress', 'completed')
  for update of assignment, assignment_requirement;
  if not found then
    raise exception 'Policy requirement must be started before acknowledgment';
  end if;
  v_assignment := v_locked_assignment.assignment_row;
  v_assignment_requirement := v_locked_assignment.requirement_row;

  perform private.lock_learning_curriculum_graph(
    array[v_assignment.curriculum_version_id]
  );

  select requirement_version.*
  into v_requirement_version
  from learning.requirement_versions requirement_version
  where requirement_version.id = v_assignment_requirement.requirement_version_id
    and requirement_version.audience = v_assignment.audience
    and requirement_version.requirement_kind = 'policy'
    and requirement_version.status = 'published'
    and exists (
      select 1
      from learning.requirements requirement
      where requirement.id = requirement_version.requirement_id
        and requirement.requirement_key = v_canonical_requirement_key
    )
    and requirement_version.effective_at <= pg_catalog.statement_timestamp()
    and (
      requirement_version.expires_at is null
      or requirement_version.expires_at > pg_catalog.statement_timestamp()
    )
  for share;
  if not found then
    raise exception 'The canonical receiving custody policy must be published and effective';
  end if;

  if v_document_id <> v_canonical_document_id
     or v_document_version <> v_canonical_document_version then
    raise exception 'Acknowledgment does not match the canonical receiving custody policy document';
  end if;

  if exists (
    select 1
    from learning.curriculum_requirement_prerequisites prerequisite
    where prerequisite.curriculum_version_id = v_assignment.curriculum_version_id
      and prerequisite.requirement_version_id = v_assignment_requirement.requirement_version_id
      and prerequisite.audience = v_assignment.audience
      and not exists (
        select 1
        from learning.assignment_requirements completed_prerequisite
        where completed_prerequisite.assignment_id = v_assignment.id
          and completed_prerequisite.requirement_version_id =
            prerequisite.prerequisite_requirement_version_id
          and completed_prerequisite.status in ('passed', 'waived')
      )
  ) then
    raise exception 'Complete prerequisite learning requirements first';
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.min(
      pg_catalog.lower(
        nullif(pg_catalog.btrim(source_reference->>'evidence_hash'), '')
      )
    )
  into v_matching_source_count, v_published_evidence_hash
  from pg_catalog.jsonb_array_elements(
    v_requirement_version.source_references
  ) source_reference
  where source_reference->>'controlled_document_id' = v_document_id
    and source_reference->>'controlled_document_version' = v_document_version;

  if v_matching_source_count <> 1 then
    raise exception 'Acknowledgment does not match one canonical published controlled document';
  end if;
  if v_published_evidence_hash is null
     or v_published_evidence_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Published controlled document is missing a canonical evidence hash';
  end if;
  if v_published_evidence_hash <> v_canonical_evidence_hash then
    raise exception 'Published controlled document hash does not match the authoritative receiving custody policy';
  end if;
  if v_submitted_evidence_hash <> v_canonical_evidence_hash then
    raise exception 'Evidence hash does not match the published controlled document';
  end if;

  select acknowledgment.* into v_acknowledgment
  from learning.policy_acknowledgments acknowledgment
  where acknowledgment.assignment_requirement_id = v_assignment_requirement.id
    and acknowledgment.user_id = v_user_id
    and acknowledgment.controlled_document_id = v_document_id
    and acknowledgment.controlled_document_version = v_document_version
    and acknowledgment.evidence_hash = v_canonical_evidence_hash;
  if found then
    return pg_catalog.to_jsonb(v_acknowledgment);
  end if;
  if v_assignment_requirement.status <> 'in_progress' then
    raise exception 'Policy requirement is already finalized';
  end if;

  insert into learning.policy_acknowledgments(
    assignment_requirement_id,
    user_id,
    department_id,
    audience,
    requirement_version_id,
    controlled_document_id,
    controlled_document_version,
    accepted_at,
    evidence_hash,
    actor_id
  ) values (
    v_assignment_requirement.id,
    v_user_id,
    v_assignment.department_id,
    v_assignment.audience,
    v_assignment_requirement.requirement_version_id,
    v_document_id,
    v_document_version,
    pg_catalog.clock_timestamp(),
    v_canonical_evidence_hash,
    v_user_id
  )
  on conflict (
    user_id,
    requirement_version_id,
    controlled_document_id,
    controlled_document_version
  ) do nothing
  returning * into v_acknowledgment;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select acknowledgment.* into v_acknowledgment
    from learning.policy_acknowledgments acknowledgment
    where acknowledgment.user_id = v_user_id
      and acknowledgment.requirement_version_id =
        v_assignment_requirement.requirement_version_id
      and acknowledgment.controlled_document_id = v_document_id
      and acknowledgment.controlled_document_version = v_document_version
      and acknowledgment.evidence_hash = v_canonical_evidence_hash;
    if not found then
      raise exception 'Existing policy acknowledgment is not bound to canonical evidence';
    end if;
    return pg_catalog.to_jsonb(v_acknowledgment);
  end if;

  update learning.assignment_requirements
  set status = 'passed',
      completed_at = pg_catalog.clock_timestamp(),
      progress = progress || pg_catalog.jsonb_build_object(
        'controlled_document_id', v_document_id,
        'controlled_document_version', v_document_version,
        'acknowledgment_id', v_acknowledgment.id
      )
  where id = v_assignment_requirement.id;

  insert into core.activity_log(
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'learning', 'assignment_requirement', v_assignment_requirement.id,
    'policy_acknowledged', v_user_id,
    pg_catalog.jsonb_build_object(
      'acknowledgment_id', v_acknowledgment.id,
      'controlled_document_id', v_document_id,
      'controlled_document_version', v_document_version,
      'evidence_hash', v_canonical_evidence_hash,
      'idempotency_key', v_idempotency_key
    )
  );

  if not exists (
    select 1
    from learning.curriculum_requirements curriculum_requirement
    join learning.assignment_requirements pending_requirement
      on pending_requirement.assignment_id = v_assignment.id
     and pending_requirement.requirement_version_id =
       curriculum_requirement.requirement_version_id
    where curriculum_requirement.curriculum_version_id =
        v_assignment.curriculum_version_id
      and curriculum_requirement.audience = v_assignment.audience
      and curriculum_requirement.mandatory
      and pending_requirement.status not in ('passed', 'waived')
  ) then
    update learning.assignments
    set status = 'completed',
        completed_at = pg_catalog.clock_timestamp(),
        blocked_reason = null
    where id = v_assignment.id;
  end if;

  return pg_catalog.to_jsonb(v_acknowledgment);
end;
$$;

alter function warehouse.receive_stock(jsonb) owner to postgres;
alter function learning.acknowledge_policy(jsonb) owner to postgres;

revoke all on function warehouse.receive_stock(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function learning.acknowledge_policy(jsonb)
  from public, anon, authenticated, service_role;

grant execute on function warehouse.receive_stock(jsonb)
  to authenticated, service_role;
grant execute on function learning.acknowledge_policy(jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';
