-- Names are disclosed only through readable request IDs, never an actor directory.
create function private.department_request_actor_names(p_request_ids uuid[])
returns table(request_id uuid, requested_by_name text, approved_by_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_request_ids), 0) > 200 then
    raise exception 'At most 200 request IDs are allowed' using errcode = '22023';
  end if;
  return query
  select r.id, nullif(btrim(requester.full_name), ''), nullif(btrim(approver.full_name), '')
  from warehouse.department_stock_requests r
  left join core.profiles requester on requester.id = r.requested_by
  left join core.profiles approver on approver.id = r.approved_by
  where r.id = any(p_request_ids)
    and (r.requested_by = auth.uid()
      or core.has_cap('warehouse', 'issue_items')
      or core.has_cap('procurement', 'approve_request'));
end;
$$;

create function warehouse.department_request_actor_names(p_request_ids uuid[])
returns table(request_id uuid, requested_by_name text, approved_by_name text)
language sql stable security invoker set search_path = ''
as $$ select * from private.department_request_actor_names(p_request_ids); $$;

revoke all on function private.department_request_actor_names(uuid[]) from public, anon;
revoke all on function warehouse.department_request_actor_names(uuid[]) from public, anon;
grant execute on function private.department_request_actor_names(uuid[]) to authenticated;
grant execute on function warehouse.department_request_actor_names(uuid[]) to authenticated;
