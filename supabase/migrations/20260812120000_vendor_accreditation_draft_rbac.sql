-- Split vendor-owned draft work from the controlled final submission transition.
-- Additive only: existing vendor row scope remains in the private Legal commands.

insert into core.capabilities(module, cap)
values ('core', 'manage_own_accreditation_draft')
on conflict (module, cap) do nothing;

insert into core.role_capabilities(module, role, cap)
values ('core', 'vendor_portal', 'manage_own_accreditation_draft')
on conflict (module, role, cap) do nothing;

create or replace function legal.save_vendor_application_draft(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
     and not core.has_cap('core', 'manage_own_accreditation_draft') then
    raise exception 'Not authorized: core.manage_own_accreditation_draft';
  end if;
  return private.save_vendor_application_draft(payload);
end;
$$;

create or replace function legal.discard_vendor_application_draft(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
     and not core.has_cap('core', 'manage_own_accreditation_draft') then
    raise exception 'Not authorized: core.manage_own_accreditation_draft';
  end if;
  return private.discard_vendor_application_draft(payload);
end;
$$;

create or replace function legal.submit_vendor_application(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
     and not core.has_cap('core', 'submit_accreditation') then
    raise exception 'Not authorized: core.submit_accreditation';
  end if;
  return private.policy_submit_vendor_application(payload);
end;
$$;

revoke all on function legal.save_vendor_application_draft(jsonb) from public, anon;
revoke all on function legal.discard_vendor_application_draft(jsonb) from public, anon;
revoke all on function legal.submit_vendor_application(jsonb) from public, anon;
grant execute on function legal.save_vendor_application_draft(jsonb) to authenticated, service_role;
grant execute on function legal.discard_vendor_application_draft(jsonb) to authenticated, service_role;
grant execute on function legal.submit_vendor_application(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
