-- Complete the temporary UAT approval ladders without replacing the named
-- department final approvers. These broad assignments are launch-test data and
-- remain replaceable through the governed Admin/Legal revision workflow.

do $$
declare
  v_procurement_head uuid;
  v_legal_lead uuid;
  v_finance_controller uuid;
begin
  select id into v_procurement_head
  from core.profiles
  where lower(email) = 'intra.test.procurement.lead@mwell.com.ph'
    and kind = 'employee'
    and status = 'active';

  select id into v_legal_lead
  from core.profiles
  where lower(email) = 'intra.test.legal.lead@mwell.com.ph'
    and kind = 'employee'
    and status = 'active';

  select id into v_finance_controller
  from core.profiles
  where lower(email) = 'intra.test.finance@mwell.com.ph'
    and kind = 'employee'
    and status = 'active';

  if v_procurement_head is null or v_legal_lead is null or v_finance_controller is null then
    raise exception 'Temporary UAT DOA ladders require active Procurement, Legal, and Finance test profiles';
  end if;

  insert into procurement.doa_assignments(
    id, matrix_id, department, category, min_amount, max_amount,
    tier, approver_user_id, active
  )
  select gen_random_uuid(), matrix.id, matrix.department, null, 0, null,
    'dept_head', final_assignment.approver_user_id, true
  from procurement.doa_matrices matrix
  join lateral (
    select assignment.approver_user_id
    from procurement.doa_assignments assignment
    where assignment.matrix_id = matrix.id
      and assignment.tier = 'final_approver'
      and assignment.active
      and assignment.approver_user_id is not null
    order by assignment.min_amount, assignment.id
    limit 1
  ) final_assignment on true
  where matrix.active
    and matrix.status = 'active'
    and matrix.version like 'UAT-TEMP-%'
    and not exists (
      select 1
      from procurement.doa_assignments existing
      where existing.matrix_id = matrix.id
        and existing.tier = 'dept_head'
        and existing.active
    );

  insert into procurement.doa_assignments(
    id, matrix_id, department, category, min_amount, max_amount,
    tier, approver_user_id, active
  )
  select gen_random_uuid(), matrix.id, matrix.department, null, 0, null,
    required.tier, required.approver_user_id, true
  from procurement.doa_matrices matrix
  cross join lateral (
    values
      ('procurement_head'::text, v_procurement_head),
      ('legal'::text, v_legal_lead),
      ('finance'::text, v_finance_controller)
  ) required(tier, approver_user_id)
  where matrix.active
    and matrix.status = 'active'
    and matrix.version like 'UAT-TEMP-%'
    and not exists (
      select 1
      from procurement.doa_assignments existing
      where existing.matrix_id = matrix.id
        and existing.tier = required.tier
        and existing.active
    );

  if exists (
    select 1
    from procurement.doa_matrices matrix
    cross join unnest(array[
      'dept_head', 'procurement_head', 'legal', 'finance', 'final_approver'
    ]::text[]) required(tier)
    where matrix.active
      and matrix.status = 'active'
      and matrix.version like 'UAT-TEMP-%'
      and (
        select count(*)
        from procurement.doa_assignments assignment
        where assignment.matrix_id = matrix.id
          and assignment.tier = required.tier
          and assignment.active
          and assignment.category is null
          and assignment.min_amount = 0
          and assignment.max_amount is null
          and assignment.approver_user_id is not null
      ) <> 1
  ) then
    raise exception 'Every temporary UAT DOA matrix must have exactly one open named assignment for each governed tier';
  end if;
end
$$;
