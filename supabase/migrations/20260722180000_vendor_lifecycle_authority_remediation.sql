-- Vendor invitation lifecycle authority.
-- Delivery establishes only a pending Auth identity. Vendor profile and role
-- activation happen exclusively inside accept_current_vendor_invite.

create table if not exists legal.vendor_invite_policy (
  id text primary key default 'default' check (id = 'default'),
  ttl_seconds integer not null default 3600 check (ttl_seconds between 300 and 86400),
  updated_at timestamptz not null default now(),
  updated_by uuid references core.profiles(id) on delete set null
);

insert into legal.vendor_invite_policy(id, ttl_seconds)
values ('default', 3600)
on conflict (id) do nothing;

alter table legal.vendor_invite_policy enable row level security;
alter table legal.vendor_invite_policy force row level security;
revoke all on legal.vendor_invite_policy from public, anon, authenticated;
grant all on legal.vendor_invite_policy to service_role;

alter table legal.vendor_invites
  alter column status set default 'pending_delivery',
  add column if not exists accepted_generation integer,
  add column if not exists acceptance_nonce uuid,
  add column if not exists acceptance_token_hash text;

create table if not exists legal.vendor_invite_commands (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references core.profiles(id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  invite_id text references legal.vendor_invites(id) on delete restrict,
  delivery_claimed_at timestamptz,
  claimed_generation integer,
  created_at timestamptz not null default now(),
  unique (actor_id, idempotency_key)
);

alter table legal.vendor_invite_commands enable row level security;
alter table legal.vendor_invite_commands force row level security;
revoke all on legal.vendor_invite_commands from public, anon, authenticated;
grant all on legal.vendor_invite_commands to service_role;

-- Remove access granted by the previous delivery-time activation contract.
delete from core.user_roles role_assignment
where role_assignment.module = 'core'
  and role_assignment.role = 'vendor_portal'
  and exists (
    select 1
    from legal.vendor_invites invite
    where invite.auth_user_id = role_assignment.user_id
      and invite.status <> 'accepted'
  )
  and not exists (
    select 1
    from legal.vendor_invites accepted_invite
    where accepted_invite.auth_user_id = role_assignment.user_id
      and accepted_invite.status = 'accepted'
  );

update core.profiles profile
set status = 'disabled', vendor_id = null
where profile.kind = 'vendor'
  and exists (
    select 1
    from legal.vendor_invites invite
    where invite.auth_user_id = profile.id
      and invite.status <> 'accepted'
  )
  and not exists (
    select 1
    from legal.vendor_invites accepted_invite
    where accepted_invite.auth_user_id = profile.id
      and accepted_invite.status = 'accepted'
  );

-- Vendor RLS identity is valid only after a current invitation was accepted.
create or replace function core.current_vendor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.vendor_id
  from core.profiles profile
  where profile.id = auth.uid()
    and profile.kind = 'vendor'
    and profile.status = 'active'
    and exists (
      select 1
      from legal.vendor_invites invite
      where invite.auth_user_id = auth.uid()
        and invite.vendor_id = profile.vendor_id
        and invite.status = 'accepted'
        and invite.accepted_generation = invite.link_generation
    );
$$;

create or replace function core.is_vendor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from core.profiles profile
    join legal.vendor_invites invite
      on invite.auth_user_id = profile.id
     and invite.vendor_id = profile.vendor_id
    where profile.id = auth.uid()
      and profile.kind = 'vendor'
      and profile.status = 'active'
      and invite.status = 'accepted'
      and invite.accepted_generation = invite.link_generation
  );
$$;

revoke all on function core.current_vendor_id() from public, anon;
revoke all on function core.is_vendor() from public, anon;
grant execute on function core.current_vendor_id() to authenticated, service_role;
grant execute on function core.is_vendor() to authenticated, service_role;

create or replace function legal.prepare_vendor_invite_delivery(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite legal.vendor_invites;
  v_policy legal.vendor_invite_policy;
  v_command legal.vendor_invite_commands;
  v_creation_key text := nullif(trim(payload->>'creation_idempotency_key'), '');
  v_acceptance_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into v_invite
  from legal.vendor_invites invite
  where invite.id = payload->>'invite_id'
  for update;
  if not found then
    return jsonb_build_object('prepared', false, 'rejection_code', 'not_found');
  end if;

  if v_creation_key is not null then
    select * into v_command
    from legal.vendor_invite_commands command
    where command.actor_id = nullif(payload->>'actor_id', '')::uuid
      and command.idempotency_key = v_creation_key
      and command.invite_id = v_invite.id
    for update;
    if not found then
      return jsonb_build_object('prepared', false, 'rejection_code', 'idempotency_command_missing');
    end if;
    if v_command.delivery_claimed_at is not null then
      return (to_jsonb(v_invite) - 'acceptance_token_hash') || jsonb_build_object(
        'prepared', false,
        'rejection_code', 'already_claimed',
        'idempotent_replay', true
      );
    end if;
    update legal.vendor_invite_commands
    set delivery_claimed_at = now()
    where id = v_command.id;
  end if;

  if v_invite.status = 'accepted' then
    update legal.vendor_invites
    set replay_rejected_at = now(), lifecycle_updated_at = now()
    where id = v_invite.id;
    return jsonb_build_object('prepared', false, 'rejection_code', 'accepted');
  end if;
  if v_invite.status in ('expired', 'superseded') then
    update legal.vendor_invites
    set replay_rejected_at = now(), lifecycle_updated_at = now()
    where id = v_invite.id;
    return jsonb_build_object('prepared', false, 'rejection_code', v_invite.status);
  end if;

  select * into v_policy
  from legal.vendor_invite_policy
  where id = 'default'
  for share;
  if not found then raise exception 'Vendor invite policy is not configured'; end if;

  update legal.vendor_invites prior_invite
  set status = 'superseded', superseded_at = now(), lifecycle_updated_at = now()
  where lower(prior_invite.email) = lower(v_invite.email)
    and prior_invite.id <> v_invite.id
    and prior_invite.status not in ('accepted', 'expired', 'superseded');

  if v_invite.auth_user_id is not null and not exists (
    select 1 from legal.vendor_invites accepted_invite
    where accepted_invite.auth_user_id = v_invite.auth_user_id
      and accepted_invite.status = 'accepted'
  ) then
    delete from core.user_roles role_assignment
    where role_assignment.user_id = v_invite.auth_user_id
      and role_assignment.module = 'core'
      and role_assignment.role = 'vendor_portal';
    update core.profiles
    set status = 'disabled', vendor_id = null
    where id = v_invite.auth_user_id and kind = 'vendor';
  end if;

  update legal.vendor_invites
  set status = 'pending_delivery',
      link_generation = link_generation + 1,
      last_link_issued_at = now(),
      superseded_at = case when link_generation > 0 then now() else superseded_at end,
      expires_at = now() + make_interval(secs => v_policy.ttl_seconds),
      delivered_at = null,
      delivery_error = null,
      accepted_at = null,
      accepted_generation = null,
      acceptance_nonce = null,
      acceptance_token_hash = encode(
        extensions.digest(convert_to(v_acceptance_token, 'UTF8'), 'sha256'),
        'hex'
      ),
      lifecycle_updated_at = now()
  where id = v_invite.id
  returning * into v_invite;

  if v_creation_key is not null then
    update legal.vendor_invite_commands
    set claimed_generation = v_invite.link_generation
    where id = v_command.id;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'vendor_invite', v_invite.id, 'delivery_prepared', null,
    jsonb_build_object(
      'vendor_id', v_invite.vendor_id,
      'case_id', v_invite.case_id,
      'link_generation', v_invite.link_generation,
      'expires_at', v_invite.expires_at
    ));

  return (to_jsonb(v_invite) - 'acceptance_token_hash') || jsonb_build_object(
    'prepared', true,
    'acceptance_token', v_acceptance_token
  );
end;
$$;

create or replace function legal.finalize_vendor_invite_delivery(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite legal.vendor_invites;
  v_status text := nullif(payload->>'status', '');
  v_expected_generation integer := nullif(payload->>'expected_generation', '')::integer;
  v_auth_user_id uuid := nullif(payload->>'auth_user_id', '')::uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if v_status not in ('sent', 'delivery_failed') then
    raise exception 'Invalid vendor invitation delivery status';
  end if;
  if v_expected_generation is null or v_expected_generation < 1 then
    raise exception 'expected_generation is required';
  end if;

  select * into v_invite
  from legal.vendor_invites invite
  where invite.id = payload->>'invite_id'
  for update;
  if not found then return jsonb_build_object('updated', false, 'rejection_code', 'not_found'); end if;
  if v_invite.status <> 'pending_delivery'
     or v_invite.link_generation <> v_expected_generation then
    update legal.vendor_invites
    set replay_rejected_at = now(), lifecycle_updated_at = now()
    where id = v_invite.id;
    return jsonb_build_object('updated', false, 'rejection_code', 'stale_generation');
  end if;
  if v_invite.expires_at is null or v_invite.expires_at <= now() then
    update legal.vendor_invites
    set status = 'expired', replay_rejected_at = now(), lifecycle_updated_at = now()
    where id = v_invite.id
    returning * into v_invite;
    return to_jsonb(v_invite) || jsonb_build_object('updated', false, 'rejection_code', 'expired');
  end if;

  if v_status = 'sent' then
    if v_auth_user_id is null then raise exception 'auth_user_id is required'; end if;
    update legal.vendor_invites
    set status = 'sent', auth_user_id = v_auth_user_id, delivered_at = now(),
        delivery_error = null, lifecycle_updated_at = now()
    where id = v_invite.id
    returning * into v_invite;
  else
    update legal.vendor_invites
    set status = 'delivery_failed',
        auth_user_id = coalesce(v_auth_user_id, auth_user_id),
        delivery_error = left(coalesce(payload->>'error', 'Delivery failed'), 500),
        delivered_at = null, lifecycle_updated_at = now()
    where id = v_invite.id
    returning * into v_invite;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'vendor_invite', v_invite.id, v_status, null,
    jsonb_build_object(
      'vendor_id', v_invite.vendor_id,
      'case_id', v_invite.case_id,
      'link_generation', v_invite.link_generation
    ));
  return to_jsonb(v_invite) || jsonb_build_object('updated', true);
end;
$$;

create or replace function legal.reconcile_vendor_invite_lifecycle(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  update legal.vendor_invites
  set status = 'expired', lifecycle_updated_at = now()
  where status in ('pending_delivery', 'sent')
    and expires_at <= now()
    and (payload->>'invite_id' is null or id = payload->>'invite_id');
  get diagnostics v_count = row_count;
  return jsonb_build_object('expired', v_count);
end;
$$;

create or replace function legal.accept_current_vendor_invite(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite legal.vendor_invites;
  v_expected_generation integer := nullif(payload->>'expected_generation', '')::integer;
  v_nonce uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(payload->>'invite_id', '') is null or v_expected_generation is null then
    raise exception 'invite_id and expected_generation are required';
  end if;

  select * into v_invite
  from legal.vendor_invites invite
  where invite.id = payload->>'invite_id'
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'rejection_code', 'not_found');
  end if;
  if v_invite.auth_user_id is distinct from auth.uid()
     or lower(v_invite.email) is distinct from lower(auth.jwt()->>'email') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'identity_mismatch');
  end if;
  if v_invite.status = 'accepted' then
    update legal.vendor_invites
    set replay_rejected_at = now(), lifecycle_updated_at = now()
    where id = v_invite.id;
    return jsonb_build_object('accepted', false, 'rejection_code', 'replayed');
  end if;
  if v_invite.link_generation <> v_expected_generation then
    update legal.vendor_invites
    set replay_rejected_at = now(), lifecycle_updated_at = now()
    where id = v_invite.id;
    return jsonb_build_object('accepted', false, 'rejection_code', 'superseded_generation');
  end if;
  if nullif(payload->>'acceptance_token', '') is null
     or v_invite.acceptance_token_hash is distinct from encode(
       extensions.digest(convert_to(payload->>'acceptance_token', 'UTF8'), 'sha256'),
       'hex'
     ) then
    update legal.vendor_invites
    set replay_rejected_at = now(), lifecycle_updated_at = now()
    where id = v_invite.id;
    return jsonb_build_object('accepted', false, 'rejection_code', 'invalid_token');
  end if;
  if v_invite.status in ('expired', 'superseded') then
    update legal.vendor_invites
    set replay_rejected_at = now(), lifecycle_updated_at = now()
    where id = v_invite.id;
    return jsonb_build_object('accepted', false, 'rejection_code', v_invite.status);
  end if;
  if v_invite.status <> 'sent' then
    return jsonb_build_object('accepted', false, 'rejection_code', 'not_delivered');
  end if;
  if v_invite.expires_at is null or v_invite.expires_at <= now() then
    update legal.vendor_invites
    set status = 'expired', replay_rejected_at = now(), lifecycle_updated_at = now()
    where id = v_invite.id;
    return jsonb_build_object('accepted', false, 'rejection_code', 'expired');
  end if;
  if exists (
    select 1
    from legal.vendor_invites newer_invite
    where lower(newer_invite.email) = lower(v_invite.email)
      and newer_invite.id <> v_invite.id
      and row(newer_invite.last_link_issued_at, newer_invite.created_at, newer_invite.id)
          > row(v_invite.last_link_issued_at, v_invite.created_at, v_invite.id)
  ) then
    update legal.vendor_invites
    set status = 'superseded', superseded_at = now(), replay_rejected_at = now(),
        lifecycle_updated_at = now()
    where id = v_invite.id;
    return jsonb_build_object('accepted', false, 'rejection_code', 'superseded');
  end if;
  if exists (
    select 1 from core.profiles profile
    where lower(profile.email) = lower(v_invite.email)
      and profile.id <> auth.uid()
  ) then
    return jsonb_build_object('accepted', false, 'rejection_code', 'email_in_use');
  end if;

  update legal.vendor_invites
  set status = 'accepted', accepted_at = now(), accepted_generation = link_generation,
      acceptance_nonce = v_nonce, lifecycle_updated_at = now()
  where id = v_invite.id
  returning * into v_invite;

  insert into core.profiles(id, email, full_name, kind, vendor_id, status)
  values (v_invite.auth_user_id, lower(v_invite.email), v_invite.company_name,
    'vendor', v_invite.vendor_id, 'active')
  on conflict (id) do update
  set email = excluded.email, full_name = excluded.full_name, kind = 'vendor',
      vendor_id = excluded.vendor_id, status = 'active';

  insert into core.user_roles(user_id, module, role)
  values (v_invite.auth_user_id, 'core', 'vendor_portal')
  on conflict do nothing;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'vendor_invite', v_invite.id, 'accepted', auth.uid(),
    jsonb_build_object(
      'vendor_id', v_invite.vendor_id,
      'case_id', v_invite.case_id,
      'link_generation', v_invite.link_generation
    ));

  return jsonb_build_object(
    'accepted', true,
    'invite_id', v_invite.id,
    'vendor_id', v_invite.vendor_id,
    'case_id', v_invite.case_id,
    'link_generation', v_invite.link_generation,
    'acceptance_nonce', v_nonce
  );
end;
$$;

-- Compensates only a just-completed acceptance when Auth metadata projection
-- fails. The nonce prevents this service-only recovery path from revoking an
-- unrelated or later acceptance.
create or replace function legal.rollback_vendor_invite_acceptance(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_invite legal.vendor_invites;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  select * into v_invite
  from legal.vendor_invites invite
  where invite.id = payload->>'invite_id'
    and invite.status = 'accepted'
    and invite.acceptance_nonce = nullif(payload->>'acceptance_nonce', '')::uuid
  for update;
  if not found then return jsonb_build_object('rolled_back', false); end if;

  delete from core.user_roles
  where user_id = v_invite.auth_user_id and module = 'core' and role = 'vendor_portal';
  update core.profiles
  set status = 'disabled', vendor_id = null
  where id = v_invite.auth_user_id and vendor_id = v_invite.vendor_id;
  update legal.vendor_invites
  set status = case when expires_at > now() then 'sent' else 'expired' end,
      accepted_at = null, accepted_generation = null, acceptance_nonce = null,
      lifecycle_updated_at = now()
  where id = v_invite.id
  returning * into v_invite;
  return jsonb_build_object('rolled_back', true, 'status', v_invite.status);
end;
$$;

create or replace function legal.invite_vendor(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor core.vendors;
  v_invite legal.vendor_invites;
  v_case legal.accreditation_cases;
  v_command legal.vendor_invite_commands;
  v_idempotency_key text := nullif(trim(payload->>'idempotency_key'), '');
  v_request_hash text;
begin
  if not core.has_cap('legal', 'manage_checklist') then
    raise exception 'Not authorized: legal.manage_checklist';
  end if;
  if v_idempotency_key is null or v_idempotency_key !~ '^[A-Za-z0-9_-]{12,128}$' then
    raise exception 'A valid idempotency key is required';
  end if;
  v_request_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'email', lower(trim(payload->>'email')),
    'company_name', trim(payload->>'company_name'),
    'category', nullif(payload->>'category', ''),
    'profile', coalesce(payload->'profile', '{}'::jsonb),
    'origin_country', nullif(payload->>'origin_country', '')
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into legal.vendor_invite_commands(actor_id, idempotency_key, request_hash)
  values (auth.uid(), v_idempotency_key, v_request_hash)
  on conflict (actor_id, idempotency_key) do nothing;
  select * into v_command
  from legal.vendor_invite_commands command
  where command.actor_id = auth.uid()
    and command.idempotency_key = v_idempotency_key
  for update;
  if v_command.request_hash <> v_request_hash then
    raise exception 'Idempotency key reused with different content';
  end if;
  if v_command.invite_id is not null then
    select * into v_invite from legal.vendor_invites where id = v_command.invite_id;
    select * into v_case from legal.accreditation_cases where id = v_invite.case_id;
    select * into v_vendor from core.vendors where id = v_invite.vendor_id;
    return jsonb_build_object(
      'invite', to_jsonb(v_invite), 'case', to_jsonb(v_case),
      'vendor', to_jsonb(v_vendor), 'idempotent_replay', true
    );
  end if;

  if exists (
    select 1 from core.profiles profile
    where lower(profile.email) = lower(trim(payload->>'email'))
      and (profile.kind = 'employee' or profile.status = 'active')
  ) then
    raise exception 'This email already belongs to an active account';
  end if;
  insert into core.vendors(legal_name, category, accreditation_status, owner_module)
  values (payload->>'company_name', nullif(payload->>'category', ''), 'draft', 'legal')
  returning * into v_vendor;
  insert into legal.accreditation_cases(
    vendor_id, vendor_name, category, jurisdiction, origin_country, entity_type,
    vendor_category, risk_tier, contract_type, expected_annual_spend,
    handles_personal_data, contact_email, invited_by_email
  ) values (
    v_vendor.id, v_vendor.legal_name, nullif(payload->>'category', ''),
    payload#>>'{profile,jurisdiction}', nullif(payload->>'origin_country', ''),
    payload#>>'{profile,entityType}', payload#>>'{profile,category}',
    payload#>>'{profile,riskTier}', payload#>>'{profile,contractType}',
    payload#>>'{profile,spendBand}',
    nullif(payload#>>'{profile,handlesPersonalData}', '')::boolean,
    lower(payload->>'email'), coalesce(payload->>'actor', auth.jwt()->>'email')
  ) returning * into v_case;
  insert into legal.vendor_invites(
    email, company_name, category, created_by_email, vendor_id, case_id, profile, status
  ) values (
    lower(payload->>'email'), payload->>'company_name', nullif(payload->>'category', ''),
    coalesce(payload->>'actor', auth.jwt()->>'email'), v_vendor.id, v_case.id,
    coalesce(payload->'profile', '{}'::jsonb), 'pending_delivery'
  ) returning * into v_invite;
  update legal.vendor_invite_commands
  set invite_id = v_invite.id
  where id = v_command.id;
  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (v_case.id, v_invite.created_by_email, 'created',
    'Case opened for ' || v_case.vendor_name);
  return jsonb_build_object(
    'invite', to_jsonb(v_invite), 'case', to_jsonb(v_case),
    'vendor', to_jsonb(v_vendor), 'idempotent_replay', false
  );
end;
$$;

drop policy if exists legal_invites_read on legal.vendor_invites;
create policy legal_invites_read on legal.vendor_invites
for select to authenticated
using (
  core.has_cap('legal', 'manage_checklist')
  or (
    status = 'accepted'
    and auth_user_id = auth.uid()
    and vendor_id = core.current_vendor_id()
  )
);

revoke all on function legal.prepare_vendor_invite_delivery(jsonb) from public, anon, authenticated;
revoke all on function legal.finalize_vendor_invite_delivery(jsonb) from public, anon, authenticated;
revoke all on function legal.reconcile_vendor_invite_lifecycle(jsonb) from public, anon, authenticated;
revoke all on function legal.rollback_vendor_invite_acceptance(jsonb) from public, anon, authenticated;
revoke all on function legal.accept_current_vendor_invite(jsonb) from public, anon;
revoke all on function legal.invite_vendor(jsonb) from public, anon;
grant execute on function legal.prepare_vendor_invite_delivery(jsonb) to service_role;
grant execute on function legal.finalize_vendor_invite_delivery(jsonb) to service_role;
grant execute on function legal.reconcile_vendor_invite_lifecycle(jsonb) to service_role;
grant execute on function legal.rollback_vendor_invite_acceptance(jsonb) to service_role;
grant execute on function legal.accept_current_vendor_invite(jsonb) to authenticated, service_role;
grant execute on function legal.invite_vendor(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
