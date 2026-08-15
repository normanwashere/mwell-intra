-- AUDIT-20260815-L5-001 security/database launch-blocker convergence.
-- Forward-only: this migration repairs the effective schema without rewriting
-- migration history and is safe whether the earlier Task 1 migration ran or
-- was skipped by a database whose migration clock had already advanced.

-- ---------------------------------------------------------------------------
-- Effective role authority
-- ---------------------------------------------------------------------------

alter table core.user_roles
  add column if not exists effective_at timestamptz,
  add column if not exists expires_at timestamptz;

update core.user_roles
set effective_at = coalesce(effective_at, pg_catalog.now())
where effective_at is null;

alter table core.user_roles
  alter column effective_at set default pg_catalog.now(),
  alter column effective_at set not null;

do $constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'core.user_roles'::regclass
      and conname = 'user_roles_effective_window_check'
  ) then
    alter table core.user_roles
      add constraint user_roles_effective_window_check
      check (expires_at is null or expires_at > effective_at);
  end if;
end;
$constraint$;

create index if not exists core_user_roles_effective_authority_idx
  on core.user_roles(user_id, module, effective_at, expires_at);

create or replace function core.has_cap(p_module text, p_cap text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.role() = 'service_role', false) or exists (
    select 1
    from core.user_roles role_assignment
    join core.profiles profile
      on profile.id = role_assignment.user_id
     and profile.status = 'active'
    join core.roles role_definition
      on role_definition.module = role_assignment.module
     and role_definition.role = role_assignment.role
     and role_definition.is_active = true
    join core.role_capabilities role_capability
      on role_capability.module = role_assignment.module
     and role_capability.role = role_assignment.role
    where role_assignment.user_id = auth.uid()
      and role_assignment.module = p_module
      and role_capability.cap = p_cap
      and role_assignment.effective_at <= pg_catalog.statement_timestamp()
      and (
        role_assignment.expires_at is null
        or role_assignment.expires_at > pg_catalog.statement_timestamp()
      )
  );
$$;

create or replace function core.has_any_cap(p_cap text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.role() = 'service_role', false) or exists (
    select 1
    from core.user_roles role_assignment
    join core.profiles profile
      on profile.id = role_assignment.user_id
     and profile.status = 'active'
    join core.roles role_definition
      on role_definition.module = role_assignment.module
     and role_definition.role = role_assignment.role
     and role_definition.is_active = true
    join core.role_capabilities role_capability
      on role_capability.module = role_assignment.module
     and role_capability.role = role_assignment.role
    where role_assignment.user_id = auth.uid()
      and role_capability.cap = p_cap
      and role_assignment.effective_at <= pg_catalog.statement_timestamp()
      and (
        role_assignment.expires_at is null
        or role_assignment.expires_at > pg_catalog.statement_timestamp()
      )
  );
$$;

create or replace function core.has_module_role(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.role() = 'service_role', false) or exists (
    select 1
    from core.user_roles role_assignment
    join core.profiles profile
      on profile.id = role_assignment.user_id
     and profile.status = 'active'
    join core.roles role_definition
      on role_definition.module = role_assignment.module
     and role_definition.role = role_assignment.role
     and role_definition.is_active = true
    where role_assignment.user_id = auth.uid()
      and role_assignment.module = p_module
      and role_assignment.effective_at <= pg_catalog.statement_timestamp()
      and (
        role_assignment.expires_at is null
        or role_assignment.expires_at > pg_catalog.statement_timestamp()
      )
  );
$$;

create or replace function core.prevent_last_platform_admin_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_effective boolean := false;
  v_new_effective boolean := false;
  v_other_admins integer;
begin
  if tg_op <> 'DELETE' then
    if not exists (
      select 1
      from core.profiles profile
      where profile.id = new.user_id
        and profile.status = 'active'
    ) then
      raise exception 'Role assignments require an active profile';
    end if;
    if new.expires_at is not null and new.expires_at <= new.effective_at then
      raise exception 'Role expiry must follow its effective timestamp';
    end if;
    if new.module = 'core'
       and new.role = 'platform_admin'
       and new.expires_at is not null then
      raise exception 'Platform administrator assignments cannot expire';
    end if;
  end if;

  if tg_op <> 'INSERT' then
    v_old_effective := old.module = 'core'
      and old.role = 'platform_admin'
      and old.effective_at <= pg_catalog.statement_timestamp()
      and (old.expires_at is null or old.expires_at > pg_catalog.statement_timestamp())
      and exists (
        select 1 from core.profiles profile
        where profile.id = old.user_id and profile.status = 'active'
      );
  end if;

  if tg_op <> 'DELETE' then
    v_new_effective := new.module = 'core'
      and new.role = 'platform_admin'
      and new.effective_at <= pg_catalog.statement_timestamp()
      and (new.expires_at is null or new.expires_at > pg_catalog.statement_timestamp());
  end if;

  if v_old_effective and not v_new_effective then
    if pg_catalog.current_setting('app.core_governed_admin_revoke', true) is distinct from 'on' then
      raise exception 'Direct platform administrator removal is denied; use core.revoke_user_role';
    end if;
    select count(*)::integer
    into v_other_admins
    from core.user_roles role_assignment
    join core.profiles profile
      on profile.id = role_assignment.user_id
     and profile.status = 'active'
    where role_assignment.module = 'core'
      and role_assignment.role = 'platform_admin'
      and role_assignment.effective_at <= pg_catalog.statement_timestamp()
      and (
        role_assignment.expires_at is null
        or role_assignment.expires_at > pg_catalog.statement_timestamp()
      )
      and not (
        role_assignment.user_id = old.user_id
        and role_assignment.module = old.module
        and role_assignment.role = old.role
      );
    if v_other_admins = 0 then
      raise exception 'Cannot remove the last effective platform administrator';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists core_user_roles_last_admin_guard on core.user_roles;
create trigger core_user_roles_last_admin_guard
before insert or update or delete on core.user_roles
for each row execute function core.prevent_last_platform_admin_expiry();

create or replace function core.prevent_last_platform_admin_profile_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
begin
  if old.status <> 'active' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = 'active' then
    return new;
  end if;
  if exists (
    select 1
    from core.user_roles role_assignment
    where role_assignment.user_id = old.id
      and role_assignment.module = 'core'
      and role_assignment.role = 'platform_admin'
      and role_assignment.effective_at <= pg_catalog.statement_timestamp()
      and (
        role_assignment.expires_at is null
        or role_assignment.expires_at > pg_catalog.statement_timestamp()
      )
  ) then
    raise exception 'Cannot disable a profile holding an effective platform administrator role because it could remove the last effective platform administrator; revoke it through core.revoke_user_role first';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists core_profiles_last_admin_guard on core.profiles;
create trigger core_profiles_last_admin_guard
before update of status or delete on core.profiles
for each row execute function core.prevent_last_platform_admin_profile_disable();

create or replace function core.assign_user_role(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_module text := payload->>'module';
  v_role text := payload->>'role';
  v_approval_reference text := nullif(pg_catalog.btrim(payload->>'approval_reference'), '');
  v_reason text := nullif(pg_catalog.btrim(payload->>'reason'), '');
  v_effective_at timestamptz := nullif(payload->>'effective_at', '')::timestamptz;
  v_expires_at timestamptz := nullif(payload->>'expires_at', '')::timestamptz;
  v_before jsonb;
  v_after jsonb;
  v_evidence_id uuid;
begin
  if not core.has_live_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'Self-assignment is not allowed: cannot modify your own role assignment';
  end if;
  if v_approval_reference is null then raise exception 'Approval reference is required'; end if;
  if v_reason is null then raise exception 'Business reason is required'; end if;
  if v_effective_at is null then raise exception 'Effective date is required'; end if;
  if v_effective_at > pg_catalog.now() + interval '5 minutes' then
    raise exception 'Future grants require scheduled activation';
  end if;
  if v_expires_at is not null and v_expires_at <= greatest(v_effective_at, pg_catalog.now()) then
    raise exception 'Expiry must be after the effective date';
  end if;
  if v_module = 'core' and v_role = 'platform_admin' and v_expires_at is not null then
    raise exception 'Platform administrator assignments cannot expire';
  end if;
  perform core.lock_role_bundle_keys(v_module, v_role);
  if not exists (
    select 1 from core.roles role_definition
    where role_definition.module = v_module
      and role_definition.role = v_role
      and role_definition.is_active
  ) then
    raise exception 'Unknown or inactive role %:%', v_module, v_role;
  end if;
  if not exists (
    select 1 from core.profiles profile
    where profile.id = v_user_id
      and profile.status = 'active'
  ) then
    raise exception 'Unknown or inactive profile %', v_user_id;
  end if;

  select pg_catalog.to_jsonb(role_assignment)
  into v_before
  from core.user_roles role_assignment
  where role_assignment.user_id = v_user_id
    and role_assignment.module = v_module
    and role_assignment.role = v_role;

  insert into core.user_roles(user_id, module, role, effective_at, expires_at)
  values (v_user_id, v_module, v_role, v_effective_at, v_expires_at)
  on conflict (user_id, module, role) do update
    set effective_at = excluded.effective_at,
        expires_at = excluded.expires_at;

  v_after := pg_catalog.jsonb_build_object(
    'user_id', v_user_id,
    'module', v_module,
    'role', v_role,
    'assigned', true,
    'effective_at', v_effective_at,
    'expires_at', v_expires_at
  );

  insert into core.role_change_evidence(
    user_id, module, role, action, approval_reference, reason,
    effective_at, expires_at, changed_by
  ) values (
    v_user_id, v_module, v_role, 'grant', v_approval_reference, v_reason,
    v_effective_at, v_expires_at, auth.uid()
  ) returning id into v_evidence_id;

  perform core.sync_user_role_claims(v_user_id);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'user_role', v_user_id::text, 'role_granted', auth.uid(),
    pg_catalog.jsonb_build_object(
      'before', v_before,
      'after', v_after,
      'evidence_id', v_evidence_id,
      'approval_reference', v_approval_reference,
      'reason', v_reason
    )
  );
  return v_after;
end;
$$;

create or replace function core.revoke_user_role(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_module text := payload->>'module';
  v_role text := payload->>'role';
  v_approval_reference text := nullif(pg_catalog.btrim(payload->>'approval_reference'), '');
  v_reason text := nullif(pg_catalog.btrim(payload->>'reason'), '');
  v_effective_at timestamptz := nullif(payload->>'effective_at', '')::timestamptz;
  v_before jsonb;
  v_after jsonb;
  v_changed integer;
  v_evidence_id uuid;
  v_other_admins integer;
begin
  if not core.has_live_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'Self-assignment is not allowed: cannot modify your own role assignment';
  end if;
  if v_approval_reference is null then raise exception 'Approval reference is required'; end if;
  if v_reason is null then raise exception 'Business reason is required'; end if;
  if v_effective_at is null then raise exception 'Effective date is required'; end if;

  perform core.lock_role_bundle_keys(v_module, v_role);
  lock table core.user_roles in share row exclusive mode;

  if v_module = 'core'
     and v_role = 'platform_admin'
     and exists (
       select 1
       from core.user_roles role_assignment
       join core.profiles profile
         on profile.id = role_assignment.user_id
        and profile.status = 'active'
       where role_assignment.user_id = v_user_id
         and role_assignment.module = 'core'
         and role_assignment.role = 'platform_admin'
         and role_assignment.effective_at <= pg_catalog.statement_timestamp()
         and (
           role_assignment.expires_at is null
           or role_assignment.expires_at > pg_catalog.statement_timestamp()
         )
     ) then
    select count(*)::integer
    into v_other_admins
    from core.user_roles role_assignment
    join core.profiles profile
      on profile.id = role_assignment.user_id
     and profile.status = 'active'
    where role_assignment.user_id <> v_user_id
      and role_assignment.module = 'core'
      and role_assignment.role = 'platform_admin'
      and role_assignment.effective_at <= pg_catalog.statement_timestamp()
      and (
        role_assignment.expires_at is null
        or role_assignment.expires_at > pg_catalog.statement_timestamp()
      );
    if v_other_admins = 0 then
      raise exception 'Cannot remove the last effective platform administrator';
    end if;
  end if;

  perform pg_catalog.set_config('app.core_governed_admin_revoke', 'on', true);

  select pg_catalog.to_jsonb(role_assignment)
  into v_before
  from core.user_roles role_assignment
  where role_assignment.user_id = v_user_id
    and role_assignment.module = v_module
    and role_assignment.role = v_role;

  delete from core.user_roles
  where user_id = v_user_id and module = v_module and role = v_role;
  get diagnostics v_changed = row_count;
  v_after := pg_catalog.jsonb_build_object(
    'user_id', v_user_id, 'module', v_module, 'role', v_role, 'assigned', false
  );
  if v_changed = 0 then return v_after; end if;

  insert into core.role_change_evidence(
    user_id, module, role, action, approval_reference, reason,
    effective_at, expires_at, changed_by
  ) values (
    v_user_id, v_module, v_role, 'revoke', v_approval_reference, v_reason,
    v_effective_at, null, auth.uid()
  ) returning id into v_evidence_id;

  perform core.sync_user_role_claims(v_user_id);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'user_role', v_user_id::text, 'role_revoked', auth.uid(),
    pg_catalog.jsonb_build_object(
      'before', v_before,
      'after', v_after,
      'evidence_id', v_evidence_id,
      'approval_reference', v_approval_reference,
      'reason', v_reason,
      'effective_at', v_effective_at
    )
  );
  return v_after;
end;
$$;

revoke all on function core.assign_user_role(jsonb) from public, anon;
revoke all on function core.revoke_user_role(jsonb) from public, anon;
grant execute on function core.assign_user_role(jsonb) to authenticated, service_role;
grant execute on function core.revoke_user_role(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Principal-bound My Work contract
-- ---------------------------------------------------------------------------

drop view if exists core.v_my_work;
drop function if exists core.my_work();
create or replace function core.my_work()
returns table(
  id text,
  principal_id uuid,
  source text,
  title text,
  description text,
  status text,
  priority text,
  due_at timestamptz,
  href text,
  required_module text,
  required_capability text,
  source_record_exists boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    'receipt:' || receipt.id,
    auth.uid(),
    'warehouse',
    'Inspect receipt ' || receipt.id,
    'Receipt evidence and line disposition require quality review.',
    receipt.quality_status,
    'high',
    receipt.created_at + interval '1 day',
    '/warehouse/quality',
    'warehouse',
    'inspect_quality',
    true
  from warehouse.receipts receipt
  where core.has_live_cap('warehouse', 'inspect_quality')
    and receipt.quality_status in ('pending', 'partial')
  union all
  select
    'count:' || cycle_count.id,
    auth.uid(),
    'warehouse',
    'Review cycle count ' || cycle_count.id,
    'A submitted stock count requires variance review.',
    cycle_count.status,
    'high',
    coalesce(cycle_count.submitted_at, cycle_count.created_at) + interval '1 day',
    '/warehouse/cycle-counts',
    'warehouse',
    'approve_stock_adjustment',
    true
  from warehouse.cycle_counts cycle_count
  where core.has_live_cap('warehouse', 'approve_stock_adjustment')
    and cycle_count.status in ('submitted', 'pending_approval')
  union all
  select
    'request:' || request.id::text,
    auth.uid(),
    'procurement',
    'Review purchase request ' || request.id::text,
    request.title,
    request.status,
    'normal',
    request.updated_at + interval '2 days',
    '/procurement/approvals',
    'procurement',
    'approve_request',
    true
  from procurement.requests request
  where core.has_live_cap('procurement', 'approve_request')
    and request.status in ('submitted', 'under_review')
  union all
  select
    'legal:' || accreditation.id::text,
    auth.uid(),
    'legal',
    'Review vendor accreditation',
    'The submitted vendor case needs a legal determination.',
    accreditation.status,
    'normal',
    coalesce(accreditation.submitted_at, accreditation.created_at) + interval '3 days',
    '/legal/accreditation',
    'legal',
    'review_accreditation',
    true
  from legal.accreditation_cases accreditation
  where core.has_live_cap('legal', 'review_accreditation')
    and accreditation.status in ('submitted', 'under_review')
  union all
  select
    'payment:' || payment_pack.id::text,
    auth.uid(),
    'finance',
    'Review payment readiness pack',
    'A reconciled acceptance and invoice pack is ready for Finance.',
    payment_pack.status,
    'high',
    payment_pack.prepared_at + interval '2 days',
    '/procurement/purchase-orders/' || payment_pack.purchase_order_id,
    'procurement',
    'view_finance',
    true
  from procurement.payment_readiness_packs payment_pack
  where core.has_live_cap('procurement', 'view_finance')
    and payment_pack.status = 'ready_for_finance'
  union all
  select
    'event:' || event.id,
    auth.uid(),
    'events',
    'Confirm event fulfillment: ' || event.name,
    'Review reservations, issue readiness, and the return plan.',
    'planned',
    'normal',
    event.start_date::timestamptz - interval '1 day',
    '/events/' || event.id,
    'events',
    'view_events',
    true
  from warehouse.events event
  where core.has_live_cap('events', 'view_events')
    and event.start_date between current_date and current_date + 30;
$$;

revoke all on function core.my_work() from public, anon;
grant execute on function core.my_work() to authenticated, service_role;
create view core.v_my_work with (security_invoker=true) as
select * from core.my_work();
grant select on core.v_my_work to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Certification-controlled authenticated RPC convergence
-- ---------------------------------------------------------------------------

-- Preserve JSONB functions with a single certification-controlled capability
-- behind a service-only implementation, then replace the public boundary with
-- a core.has_live_cap wrapper. Ambiguous signatures fail closed below.
do $converge$
declare
  candidate record;
  matched text[];
  controlled_pairs integer;
  controlled_module text;
  controlled_capability text;
  implementation_name text;
  definition text;
  capability_pattern constant text :=
    'core[.]has_cap[[:space:]]*[(][[:space:]]*''([^'']+)''[[:space:]]*,[[:space:]]*''([^'']+)''[[:space:]]*[)]';
begin
  for candidate in
    select
      procedure.oid,
      namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
      procedure.pronargs,
      procedure.proargtypes,
      procedure.prorettype,
      pg_catalog.pg_get_functiondef(procedure.oid) as definition
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where procedure.prokind = 'f'
      and procedure.prosecdef
      and namespace.nspname not in ('pg_catalog', 'information_schema')
      and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)), 'core.has_cap('
      ) > 0
      and exists (
        select 1
        from pg_catalog.regexp_matches(
          pg_catalog.pg_get_functiondef(procedure.oid),
          capability_pattern,
          'gi'
        ) as raw_pair
        join learning.mutation_capability_rules rule
          on rule.module = raw_pair[1]
         and rule.capability = raw_pair[2]
      )
  loop
    definition := candidate.definition;
    select
      count(distinct raw_pair[1] || pg_catalog.chr(31) || raw_pair[2])::integer,
      min(raw_pair[1]),
      min(raw_pair[2])
    into controlled_pairs, controlled_module, controlled_capability
    from pg_catalog.regexp_matches(definition, capability_pattern, 'gi') as raw_pair
    join learning.mutation_capability_rules rule
      on rule.module = raw_pair[1]
     and rule.capability = raw_pair[2];

    if controlled_pairs = 1
       and candidate.pronargs = 1
       and candidate.proargtypes[0] = 'jsonb'::regtype::oid
       and candidate.prorettype = 'jsonb'::regtype::oid then
      implementation_name := pg_catalog.left(candidate.function_name, 34)
        || '_rawcap_20260816_impl_'
        || pg_catalog.substr(pg_catalog.md5(candidate.oid::text), 1, 6);

      execute pg_catalog.format(
        'alter function %I.%I(%s) rename to %I',
        candidate.schema_name,
        candidate.function_name,
        candidate.identity_arguments,
        implementation_name
      );
      execute pg_catalog.format(
        'revoke all on function %I.%I(%s) from public, anon, authenticated',
        candidate.schema_name,
        implementation_name,
        candidate.identity_arguments
      );
      execute pg_catalog.format(
        'grant execute on function %I.%I(%s) to service_role',
        candidate.schema_name,
        implementation_name,
        candidate.identity_arguments
      );
      execute pg_catalog.format(
        $wrapper$
          create function %I.%I(payload jsonb)
          returns jsonb
          language plpgsql
          security definer
          set search_path = ''
          as $body$
          begin
            if auth.role() <> 'service_role'
               and not core.has_live_cap(%L, %L) then
              raise exception 'Not authorized: %%', %L;
            end if;
            return %I.%I(payload);
          end;
          $body$
        $wrapper$,
        candidate.schema_name,
        candidate.function_name,
        controlled_module,
        controlled_capability,
        controlled_module || '.' || controlled_capability,
        candidate.schema_name,
        implementation_name
      );
      execute pg_catalog.format(
        'revoke all on function %I.%I(jsonb) from public, anon',
        candidate.schema_name,
        candidate.function_name
      );
      execute pg_catalog.format(
        'grant execute on function %I.%I(jsonb) to authenticated, service_role',
        candidate.schema_name,
        candidate.function_name
      );
      insert into core.activity_log(
        module, entity_type, entity_id, action, actor, detail
      ) values (
        'core',
        'database_function',
        pg_catalog.format(
          '%I.%I(%s)',
          candidate.schema_name,
          candidate.function_name,
          candidate.identity_arguments
        ),
        'certification_boundary_wrapped',
        null,
        pg_catalog.jsonb_build_object(
          'audit', 'AUDIT-20260815-L5-001',
          'module', controlled_module,
          'capability', controlled_capability,
          'implementation', implementation_name
        )
      );
    end if;
  end loop;

  -- Revoke remaining ambiguous, multi-capability, or unsupported boundaries.
  -- This is deliberately fail closed: an authenticated raw-cap RPC is never
  -- left callable merely because an automatic wrapper would be unsafe.
  for candidate in
    select
      procedure.oid,
      namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where procedure.prokind = 'f'
      and procedure.prosecdef
      and namespace.nspname not in ('pg_catalog', 'information_schema')
      and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)), 'core.has_cap('
      ) > 0
      and exists (
        select 1
        from pg_catalog.regexp_matches(
          pg_catalog.pg_get_functiondef(procedure.oid),
          capability_pattern,
          'gi'
        ) as raw_pair
        join learning.mutation_capability_rules rule
          on rule.module = raw_pair[1]
         and rule.capability = raw_pair[2]
      )
  loop
    execute pg_catalog.format(
      'revoke execute on function %I.%I(%s) from authenticated',
      candidate.schema_name,
      candidate.function_name,
      candidate.identity_arguments
    );
    execute pg_catalog.format(
      'revoke execute on function %I.%I(%s) from public, anon',
      candidate.schema_name,
      candidate.function_name,
      candidate.identity_arguments
    );
    insert into core.activity_log(
      module, entity_type, entity_id, action, actor, detail
    ) values (
      'core',
      'database_function',
      pg_catalog.format(
        '%I.%I(%s)',
        candidate.schema_name,
        candidate.function_name,
        candidate.identity_arguments
      ),
      'uncertified_authenticated_execute_revoked',
      null,
      pg_catalog.jsonb_build_object(
        'audit', 'AUDIT-20260815-L5-001',
        'reason', 'ambiguous, multi-capability, or unsupported boundary'
      )
    );
  end loop;
end;
$converge$;

-- ---------------------------------------------------------------------------
-- Learning certification reconciliation and duplicate prevention
-- ---------------------------------------------------------------------------

do $compatibility$
begin
  if exists (
    select 1
    from learning.assignments assignment
    where assignment.status = 'completed'
    group by
      assignment.user_id,
      assignment.curriculum_version_id,
      assignment.source_type,
      assignment.source_id
    having count(distinct (assignment.profile_kind, assignment.department_id, assignment.audience)) > 1
  ) then
    raise exception 'Completed learning duplicates cross an identity scope and require manual reconciliation';
  end if;
end;
$compatibility$;

create temporary table learning_assignment_dedup on commit drop as
with ranked as (
  select
    assignment.id as duplicate_id,
    pg_catalog.first_value(assignment.id) over (
      partition by
        assignment.user_id,
        assignment.curriculum_version_id,
        assignment.source_type,
        assignment.source_id
      order by
        case when exists (
          select 1 from learning.certifications certification
          where certification.assignment_id = assignment.id
        ) then 0 else 1 end,
        assignment.completed_at desc,
        assignment.created_at desc,
        assignment.id
    ) as canonical_id,
    pg_catalog.row_number() over (
      partition by
        assignment.user_id,
        assignment.curriculum_version_id,
        assignment.source_type,
        assignment.source_id
      order by
        case when exists (
          select 1 from learning.certifications certification
          where certification.assignment_id = assignment.id
        ) then 0 else 1 end,
        assignment.completed_at desc,
        assignment.created_at desc,
        assignment.id
    ) as duplicate_rank
  from learning.assignments assignment
  where assignment.status = 'completed'
)
select duplicate_id, canonical_id
from ranked
where duplicate_rank > 1;

insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
select
  'learning',
  'assignment',
  duplicate.duplicate_id::text,
  'duplicate_assignment_reconciled',
  null,
  pg_catalog.jsonb_build_object(
    'audit', 'AUDIT-20260815-L5-001',
    'canonical_assignment_id', duplicate.canonical_id
  )
from learning_assignment_dedup duplicate;

alter table learning.certifications
  disable trigger learning_certifications_read_committed_guard;
alter table learning.certifications
  disable trigger learning_certifications_lifecycle_guard;

update learning.certifications certification
set assignment_id = duplicate.canonical_id,
    evidence_references = certification.evidence_references
      || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'type', 'migration_reconciliation',
          'audit', 'AUDIT-20260815-L5-001',
          'previous_assignment_id', duplicate.duplicate_id
        )
      )
from learning_assignment_dedup duplicate
where certification.assignment_id = duplicate.duplicate_id;

alter table learning.certifications
  enable trigger learning_certifications_lifecycle_guard;
alter table learning.certifications
  enable trigger learning_certifications_read_committed_guard;

alter table learning.assignments
  disable trigger learning_assignments_read_committed_guard;
alter table learning.assignments
  disable trigger learning_assignments_lifecycle_guard;

update learning.assignments assignment
set status = 'superseded',
    completed_at = null,
    blocked_reason = null,
    superseded_by_id = duplicate.canonical_id
from learning_assignment_dedup duplicate
where assignment.id = duplicate.duplicate_id;

alter table learning.assignments
  enable trigger learning_assignments_lifecycle_guard;
alter table learning.assignments
  enable trigger learning_assignments_read_committed_guard;

create unique index if not exists learning_one_completed_assignment_idx
  on learning.assignments(user_id, curriculum_version_id, source_type, source_id)
  where status = 'completed';

do $certification_reconciliation$
declare
  learner record;
  prior_sub text := pg_catalog.current_setting('request.jwt.claim.sub', true);
  prior_role text := pg_catalog.current_setting('request.jwt.claim.role', true);
begin
  if pg_catalog.to_regprocedure('learning.evaluate_certifications()') is null then
    raise exception 'learning.evaluate_certifications() is required for certification reconciliation';
  end if;

  for learner in
    select distinct assignment.user_id
    from learning.assignments assignment
    join core.profiles profile
      on profile.id = assignment.user_id
     and profile.status = 'active'
    where assignment.status = 'completed'
  loop
    perform pg_catalog.set_config('request.jwt.claim.sub', learner.user_id::text, true);
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
    perform learning.evaluate_certifications();
  end loop;

  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
  perform pg_catalog.set_config('request.jwt.claim.role', coalesce(prior_role, ''), true);
end;
$certification_reconciliation$;

-- ---------------------------------------------------------------------------
-- Advisor-confirmed foreign-key indexes
-- ---------------------------------------------------------------------------

create index if not exists learning_assessment_answer_keys_created_by_fkey_idx
  on private.learning_assessment_answer_keys(created_by);

create index if not exists learning_assessment_answer_keys_updated_by_fkey_idx
  on private.learning_assessment_answer_keys(updated_by);

select pg_catalog.pg_notify('pgrst', 'reload schema');
