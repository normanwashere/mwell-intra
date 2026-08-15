-- Reconcile launch-critical read authority and keep multi-role onboarding lean.

-- These read RPCs perform their own capability checks. A previous grant
-- hardening pass left them service-only, which made authorized UAT screens fail.
grant execute on function core.list_departments()
  to authenticated, service_role;
grant execute on function core.list_rbac_catalog()
  to authenticated, service_role;
grant execute on function procurement.purchase_order_amendment_work_items(jsonb)
  to authenticated, service_role;
grant execute on function procurement.payment_readiness_staleness_work_items(jsonb)
  to authenticated, service_role;

-- Keep the private receipt projection private and expose a capability-filtered
-- read RPC instead of requiring authenticated users to execute private code.
create or replace function procurement.purchase_order_receipt_status(
  payload jsonb default '{}'::jsonb
)
returns table (
  purchase_order_id text,
  ordered_quantity numeric,
  accepted_quantity numeric,
  rejected_or_quarantined_quantity numeric,
  outstanding_quantity numeric,
  latest_warehouse_receipt_reference text,
  qc_status text,
  last_received_at timestamptz,
  accepted_lines jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required'
      using errcode = '28000';
  end if;
  if not core.has_cap('procurement', 'view_dashboard')
     and not core.has_cap('procurement', 'author_po')
     and not core.has_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized to view purchase-order receipt status'
      using errcode = '42501';
  end if;

  return query
  select status.*
  from private.procurement_po_receipt_status() status
  where nullif(payload->>'purchase_order_id', '') is null
     or status.purchase_order_id = payload->>'purchase_order_id';
end;
$$;

alter function procurement.purchase_order_receipt_status(jsonb)
  owner to postgres;
revoke all on function procurement.purchase_order_receipt_status(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function procurement.purchase_order_receipt_status(jsonb)
  to authenticated, service_role;

-- Events Viewer is a context-only supplemental role for Product. It must not
-- assign a second Leadership persona curriculum.
update learning.role_curricula
set expires_at = pg_catalog.clock_timestamp()
where module = 'events'
  and role = 'viewer'
  and effective_at <= pg_catalog.statement_timestamp()
  and (
    expires_at is null
    or expires_at > pg_catalog.statement_timestamp()
  );

update learning.assignments assignment
set status = 'cancelled',
    blocked_reason = null
where assignment.source_type = 'role'
  and assignment.status in ('assigned', 'in_progress', 'blocked')
  and exists (
    select 1
    from core.user_roles role_assignment
    where role_assignment.id = assignment.source_id
      and role_assignment.user_id = assignment.user_id
      and role_assignment.module = 'events'
      and role_assignment.role = 'viewer'
  );

-- Equivalent role variants reuse the same governed simulation. Completing it
-- once propagates the evidence to the user's other active, non-remedial role
-- assignments that reference the same published simulation version.
create or replace function learning.sync_equivalent_role_practices()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile core.profiles%rowtype;
  v_audience text;
  v_source record;
  v_target record;
  v_propagated integer := 0;
  v_now timestamptz;
begin
  perform private.assert_learning_read_committed();
  if v_user_id is null then
    raise exception 'Authentication is required for learning services'
      using errcode = '28000';
  end if;

  select profile.*
  into v_profile
  from core.profiles profile
  where profile.id = v_user_id
    and profile.status = 'active'
  for update;
  if not found or v_profile.kind not in ('employee', 'vendor') then
    raise exception 'An active employee or vendor profile is required';
  end if;
  v_audience := case v_profile.kind
    when 'employee' then 'internal'
    else 'vendor'
  end;

  for v_source in
    select distinct on (source_version.simulation_version_id)
      coalesce(
        nullif(
          source_requirement.progress->>'shared_completion_source_id',
          ''
        )::uuid,
        source_requirement.id
      ) as id,
      source_version.simulation_version_id,
      source_requirement.completed_at
    from learning.assignment_requirements source_requirement
    join learning.assignments source_assignment
      on source_assignment.id = source_requirement.assignment_id
     and source_assignment.user_id = source_requirement.user_id
     and source_assignment.audience = source_requirement.audience
    join learning.requirement_versions source_version
      on source_version.id = source_requirement.requirement_version_id
     and source_version.audience = source_requirement.audience
     and source_version.requirement_kind = 'scenario'
     and source_version.simulation_version_id is not null
    where source_requirement.user_id = v_user_id
      and source_requirement.audience = v_audience
      and source_requirement.status = 'passed'
      and source_assignment.source_type not in ('retraining', 'corrective')
      and source_assignment.status not in ('cancelled', 'superseded')
    order by source_version.simulation_version_id,
      source_requirement.completed_at,
      source_requirement.id
  loop
    for v_target in
      select
        target_requirement.id,
        target_requirement.assignment_id,
        target_requirement.status
      from learning.assignment_requirements target_requirement
      join learning.assignments target_assignment
        on target_assignment.id = target_requirement.assignment_id
       and target_assignment.user_id = target_requirement.user_id
       and target_assignment.audience = target_requirement.audience
      join learning.requirement_versions target_version
        on target_version.id = target_requirement.requirement_version_id
       and target_version.audience = target_requirement.audience
       and target_version.requirement_kind = 'scenario'
       and target_version.simulation_version_id =
         v_source.simulation_version_id
      where target_requirement.user_id = v_user_id
        and target_requirement.audience = v_audience
        and target_requirement.id <> v_source.id
        and target_requirement.status in (
          'not_started', 'in_progress', 'failed_retryable', 'needs_support'
        )
        and target_assignment.source_type not in ('retraining', 'corrective')
        and target_assignment.status in ('assigned', 'in_progress')
      order by target_assignment.id, target_requirement.id
      for update of target_assignment, target_requirement
    loop
      v_now := pg_catalog.clock_timestamp();

      update learning.assignments
      set status = 'in_progress',
          started_at = coalesce(started_at, v_now),
          blocked_reason = null
      where id = v_target.assignment_id
        and status = 'assigned';

      insert into learning.attempt_events(
        attempt_id,
        user_id,
        department_id,
        audience,
        event_type,
        actor_id,
        evidence_hash,
        detail,
        idempotency_key
      )
      select
        attempt.id,
        attempt.user_id,
        attempt.department_id,
        attempt.audience,
        'recovery',
        v_user_id,
        pg_catalog.encode(
          public.digest(
            pg_catalog.convert_to(
              attempt.id::text || ':' || v_source.id::text,
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ),
        pg_catalog.jsonb_build_object(
          'reason', 'equivalent_role_practice_superseded_attempt',
          'source_assignment_requirement_id', v_source.id,
          'target_assignment_requirement_id', v_target.id
        ),
        pg_catalog.gen_random_uuid()
      from learning.attempts attempt
      where attempt.assignment_requirement_id = v_target.id
        and attempt.user_id = v_user_id
        and attempt.status = 'in_progress'
      on conflict (attempt_id, idempotency_key) do nothing;

      update learning.attempts
      set status = 'abandoned',
          integrity_result = 'valid',
          completed_at = v_now
      where assignment_requirement_id = v_target.id
        and user_id = v_user_id
        and status = 'in_progress';

      if v_target.status <> 'in_progress' then
        update learning.assignment_requirements
        set status = 'in_progress',
            started_at = coalesce(started_at, v_now),
            completed_at = null
        where id = v_target.id;
      end if;

      update learning.assignment_requirements
      set status = 'passed',
          completed_at = v_now,
          progress = progress || pg_catalog.jsonb_build_object(
            'shared_completion_source_id', v_source.id,
            'shared_completion_propagated_at', v_now,
            'shared_completion_kind', 'equivalent_role_practice'
          )
      where id = v_target.id;

      insert into core.activity_log(
        module, entity_type, entity_id, action, actor, detail
      ) values (
        'learning',
        'assignment_requirement',
        v_target.id,
        'equivalent_role_practice_propagated',
        v_user_id,
        pg_catalog.jsonb_build_object(
          'source_assignment_requirement_id', v_source.id,
          'simulation_version_id', v_source.simulation_version_id,
          'previous_status', v_target.status
        )
      );

      update learning.assignments target_assignment
      set status = 'completed',
          completed_at = v_now,
          blocked_reason = null
      where target_assignment.id = v_target.assignment_id
        and target_assignment.status = 'in_progress'
        and not exists (
          select 1
          from learning.curriculum_requirements mandatory_requirement
          where mandatory_requirement.curriculum_version_id =
              target_assignment.curriculum_version_id
            and mandatory_requirement.audience = target_assignment.audience
            and mandatory_requirement.mandatory
            and not exists (
              select 1
              from learning.assignment_requirements completed_requirement
              where completed_requirement.assignment_id = target_assignment.id
                and completed_requirement.requirement_version_id =
                  mandatory_requirement.requirement_version_id
                and completed_requirement.status in ('passed', 'waived')
            )
        );

      v_propagated := v_propagated + 1;
    end loop;
  end loop;

  return pg_catalog.jsonb_build_object(
    'propagated_count', v_propagated
  );
end;
$$;

alter function learning.sync_equivalent_role_practices() owner to postgres;
revoke all on function learning.sync_equivalent_role_practices()
  from public, anon, authenticated, service_role;

alter function learning.sync_shared_completions()
  rename to sync_exact_completions;
alter function learning.sync_exact_completions() owner to postgres;
revoke all on function learning.sync_exact_completions()
  from public, anon, authenticated, service_role;

create or replace function learning.sync_shared_completions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exact jsonb;
  v_equivalent jsonb;
begin
  v_exact := learning.sync_exact_completions();
  v_equivalent := learning.sync_equivalent_role_practices();
  return pg_catalog.jsonb_build_object(
    'propagated_count',
    coalesce((v_exact->>'propagated_count')::integer, 0)
      + coalesce((v_equivalent->>'propagated_count')::integer, 0),
    'exact', v_exact,
    'equivalent_role_practices', v_equivalent
  );
end;
$$;

alter function learning.sync_shared_completions() owner to postgres;
revoke all on function learning.sync_shared_completions()
  from public, anon, authenticated, service_role;
grant execute on function learning.sync_shared_completions()
  to authenticated, service_role;
