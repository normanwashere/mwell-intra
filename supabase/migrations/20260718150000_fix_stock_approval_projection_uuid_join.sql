-- Stock-change request identifiers are UUIDs while the shared approval ledger
-- deliberately stores polymorphic entity identifiers as text.
create or replace function private.warehouse_list_stock_change_requests(payload jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_limit integer := least(greatest(coalesce((payload->>'limit')::integer,50),1),100);
  v_status text := nullif(payload->>'status','');
  v_search text := nullif(pg_catalog.btrim(coalesce(payload->>'search','')), '');
  v_rows jsonb;
begin
  if not (core.has_cap('warehouse','approve_stock_adjustment')
    or core.has_cap('warehouse','approve_stock_adjustment_finance')) then
    raise exception 'Not authorized: warehouse stock approvals';
  end if;
  select coalesce(
    jsonb_agg(to_jsonb(listed) order by listed.requested_at desc,listed.id desc),
    '[]'::jsonb
  )
  into v_rows from (
    select request.*,
      (select supervisor_step.decided_by from core.approvals supervisor_step
        where supervisor_step.entity_type='warehouse_stock_change'
          and supervisor_step.entity_id=request.id::text and supervisor_step.step=1
          and supervisor_step.decision='approved' limit 1) as supervisor_approved_by,
      (request.requested_by <> auth.uid()
       and current_step.id is not null
       and approval_group.is_active
       and approval_group.request_status = request.status
       and ((request.status='pending_supervisor'
               and approval_group.capability='approve_stock_adjustment')
            or (request.status='pending_finance'
               and approval_group.capability='approve_stock_adjustment_finance'))
       and core.has_cap(approval_group.module,approval_group.capability)
       and exists (
          select 1 from core.user_roles membership
          join core.roles catalogue_role
            on catalogue_role.module=membership.module
           and catalogue_role.role=membership.role
          where membership.user_id=auth.uid()
            and membership.module=approval_group.module
            and membership.role=any(approval_group.member_roles)
            and catalogue_role.is_active
       )
       and not (request.status='pending_finance' and exists (
         select 1 from core.approvals supervisor_step
          where supervisor_step.entity_type='warehouse_stock_change'
            and supervisor_step.entity_id=request.id::text and supervisor_step.step=1
            and supervisor_step.decision='approved'
            and supervisor_step.decided_by=auth.uid()
       ))) as can_decide
    from warehouse.stock_change_requests request
    left join lateral (
      select approval.id,approval.approver_role
      from core.approvals approval
      where approval.entity_type='warehouse_stock_change'
        and approval.entity_id=request.id::text
        and approval.decision='pending'
      order by approval.step
      limit 1
    ) current_step on true
    left join core.approval_groups approval_group
      on approval_group.entity_type='warehouse_stock_change'
     and approval_group.group_code=current_step.approver_role
    where (v_status is null or request.status=v_status)
      and (v_search is null or request.product_id ilike '%' || v_search || '%'
        or request.reason ilike '%' || v_search || '%')
    order by request.requested_at desc,request.id desc limit v_limit
  ) listed;
  return jsonb_build_object('rows',v_rows,'next_cursor',null);
end $$;

revoke all on function private.warehouse_list_stock_change_requests(jsonb) from public,anon,authenticated;
grant execute on function private.warehouse_list_stock_change_requests(jsonb) to service_role;
