alter table legal.vendor_invites
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_error text;

create index if not exists legal_vendor_invites_auth_user_idx
  on legal.vendor_invites(auth_user_id);

create or replace function legal.finalize_vendor_invite_delivery(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invite legal.vendor_invites;
  v_status text;
  v_auth_user_id uuid;
begin
  v_status := nullif(payload->>'status', '');
  if v_status not in ('sent', 'delivery_failed') then
    raise exception 'Invalid vendor invitation delivery status';
  end if;

  select *
    into v_invite
    from legal.vendor_invites i
   where i.id = payload->>'invite_id'
   for update;
  if not found then
    raise exception 'Vendor invite not found';
  end if;

  if v_status = 'sent' then
    v_auth_user_id := nullif(payload->>'auth_user_id', '')::uuid;
    if v_auth_user_id is null then
      raise exception 'auth_user_id is required for a delivered invitation';
    end if;

    insert into core.profiles (
      id,
      email,
      full_name,
      kind,
      vendor_id,
      status
    ) values (
      v_auth_user_id,
      lower(v_invite.email),
      v_invite.company_name,
      'vendor',
      v_invite.vendor_id,
      'active'
    )
    on conflict (id) do update set
      email = excluded.email,
      full_name = excluded.full_name,
      kind = 'vendor',
      vendor_id = excluded.vendor_id,
      status = 'active';

    insert into core.user_roles(user_id, module, role)
    values (v_auth_user_id, 'core', 'vendor_portal')
    on conflict do nothing;

    update legal.vendor_invites
       set status = 'sent',
           auth_user_id = v_auth_user_id,
           delivered_at = now(),
           delivery_error = null
     where id = v_invite.id
     returning * into v_invite;
  else
    update legal.vendor_invites
       set status = 'delivery_failed',
           delivery_error = left(coalesce(payload->>'error', 'Delivery failed'), 500),
           delivered_at = null
     where id = v_invite.id
     returning * into v_invite;
  end if;

  insert into core.activity_log (
    module,
    entity_type,
    entity_id,
    action,
    actor,
    detail
  ) values (
    'legal',
    'vendor_invite',
    v_invite.id,
    case when v_status = 'sent' then 'delivered' else 'delivery_failed' end,
    null,
    jsonb_build_object(
      'vendor_id', v_invite.vendor_id,
      'case_id', v_invite.case_id,
      'status', v_status
    )
  );

  return to_jsonb(v_invite);
end;
$$;

revoke all on function legal.finalize_vendor_invite_delivery(jsonb)
  from public, anon, authenticated;
grant execute on function legal.finalize_vendor_invite_delivery(jsonb)
  to service_role;

select pg_notify('pgrst', 'reload schema');
