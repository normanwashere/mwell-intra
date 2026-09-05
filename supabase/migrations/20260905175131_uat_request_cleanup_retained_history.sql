-- Vaulted certification cleanup only; ordinary retention permissions stay intact.
create or replace function private.cleanup_certification_requests(p_marker text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ids text[]; removed integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_marker is null or p_marker !~ '^QA-[0-9]{8}-[A-F0-9]{8}-(desktop-1440|mobile-390)$' then
    raise exception 'Invalid certification marker';
  end if;
  select coalesce(array_agg(id), '{}'::text[]) into ids from (
    select id from procurement.requests
    where left(id, length(p_marker) + 1) = p_marker || '-'
       or title = p_marker || ' Procurement draft'
    for update
  ) scoped;
  if exists(select 1 from procurement.purchase_orders where request_id = any(ids)) then
    raise exception 'Linked purchase orders remain';
  end if;
  -- Retention triggers must see the parent revision while steps are deleted.
  delete from procurement.approval_steps where request_id = any(ids);
  delete from procurement.approval_step_audit where request_id = any(ids);
  delete from procurement.request_revisions where request_id = any(ids);
  delete from procurement.requests where id = any(ids);
  get diagnostics removed = row_count;
  return jsonb_build_object('marker', p_marker, 'removed', removed, 'remaining',
    (select count(*) from procurement.requests where id = any(ids)));
end;
$$;
revoke all on function private.cleanup_certification_requests(text) from public, anon, authenticated;
grant execute on function private.cleanup_certification_requests(text) to service_role;

create or replace function procurement.cleanup_certification_requests(p_marker text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.cleanup_certification_requests(p_marker);
$$;
revoke all on function procurement.cleanup_certification_requests(text) from public, anon, authenticated;
grant execute on function procurement.cleanup_certification_requests(text) to service_role;
notify pgrst, 'reload schema';
