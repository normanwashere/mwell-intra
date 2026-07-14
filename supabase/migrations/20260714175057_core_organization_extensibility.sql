-- Configurable organization hierarchy and runtime RBAC bundles.
-- core.has_cap(module, cap) remains the authoritative authorization check.

create extension if not exists btree_gist with schema extensions;

create table if not exists core.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  parent_id uuid references core.departments(id) on delete restrict,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  purpose text,
  created_at timestamptz not null default now(),
  created_by uuid references core.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references core.profiles(id) on delete set null,
  constraint departments_code_check
    check (code = lower(code) and code ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)*$'),
  constraint departments_name_check check (btrim(name) <> ''),
  constraint departments_parent_check check (parent_id is null or parent_id <> id)
);

create index if not exists departments_parent_order_idx
  on core.departments(parent_id, sort_order, name);

create table if not exists core.profile_department_scopes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references core.profiles(id) on delete restrict,
  department_id uuid not null references core.departments(id) on delete restrict,
  scope_type text not null default 'member',
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid references core.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references core.profiles(id) on delete set null,
  constraint profile_department_scope_type_check
    check (scope_type ~ '^[a-z][a-z0-9_]*$'),
  constraint profile_department_scope_dates_check
    check (effective_to is null or effective_to >= effective_from),
  unique(profile_id, department_id, scope_type, effective_from)
);

create index if not exists profile_department_scopes_profile_idx
  on core.profile_department_scopes(profile_id, effective_from, effective_to);
create index if not exists profile_department_scopes_department_idx
  on core.profile_department_scopes(department_id, effective_from, effective_to);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'core.profile_department_scopes'::pg_catalog.regclass
      and conname = 'profile_department_scopes_no_overlap'
  ) then
    alter table core.profile_department_scopes
      add constraint profile_department_scopes_no_overlap
      exclude using gist (
        profile_id with =,
        department_id with =,
        scope_type with =,
        daterange(
          effective_from,
          coalesce(effective_to + 1, 'infinity'::date),
          '[)'
        ) with &&
      );
  end if;
end;
$$;

alter table core.roles
  add column if not exists description text,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_protected boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

insert into core.capabilities(module, cap)
values ('warehouse', 'approve_stock_adjustment_finance')
on conflict do nothing;

-- Approval ledgers retain their stable group code in approver_role for
-- backwards compatibility. Authority is resolved from this governed catalogue,
-- never from a literal user-role assignment.
create table if not exists core.approval_groups (
  entity_type text not null,
  group_code text not null,
  module text not null,
  capability text not null,
  request_status text not null,
  is_active boolean not null default true,
  primary key (entity_type, group_code),
  unique (entity_type, request_status),
  foreign key (module, capability)
    references core.capabilities(module, cap)
    on delete restrict
    deferrable initially immediate
);

insert into core.approval_groups(
  entity_type, group_code, module, capability, request_status, is_active
) values
  (
    'warehouse_stock_change', 'logistics_supervisor', 'warehouse',
    'approve_stock_adjustment', 'pending_supervisor', true
  ),
  (
    'warehouse_stock_change', 'finance', 'warehouse',
    'approve_stock_adjustment_finance', 'pending_finance', true
  )
on conflict (entity_type, group_code) do update set
  module = excluded.module,
  capability = excluded.capability,
  request_status = excluded.request_status,
  is_active = true;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'core.user_roles'::pg_catalog.regclass
      and conname = 'user_roles_role_integrity_fk'
  ) then
    alter table core.user_roles
      add constraint user_roles_role_integrity_fk
      foreign key (module, role)
      references core.roles(module, role)
      on delete restrict
      deferrable initially immediate
      not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'core.roles'::regclass
      and conname = 'roles_module_format_check'
  ) then
    alter table core.roles add constraint roles_module_format_check
      check (module ~ '^[a-z][a-z0-9_]*$') not valid;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'core.roles'::regclass
      and conname = 'roles_role_format_check'
  ) then
    alter table core.roles add constraint roles_role_format_check
      check (role ~ '^[a-z][a-z0-9_]*$') not valid;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'core.roles'::regclass
      and conname = 'roles_label_nonempty_check'
  ) then
    alter table core.roles add constraint roles_label_nonempty_check
      check (pg_catalog.btrim(label) <> '') not valid;
  end if;
end;
$$;

-- Bootstrap roles establish access to the administration surface and cannot be
-- reshaped by the runtime bundle editor.
update core.roles
set is_protected = true
where (module, role) in (
  ('core', 'platform_admin'),
  ('core', 'staff'),
  ('core', 'vendor_portal')
);

-- Runtime authorization ignores assignments to inactive bundles. These helpers
-- remain the database authority; JWT claims are only a client snapshot.
create or replace function core.has_cap(p_module text, p_cap text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from core.user_roles ur
    join core.roles r
      on r.module = ur.module
     and r.role = ur.role
     and r.is_active = true
    join core.role_capabilities rc
      on rc.module = ur.module
     and rc.role = ur.role
    where ur.user_id = auth.uid()
      and ur.module = p_module
      and rc.cap = p_cap
  );
$$;

create or replace function core.has_any_cap(p_cap text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from core.user_roles ur
    join core.roles r
      on r.module = ur.module
     and r.role = ur.role
     and r.is_active = true
    join core.role_capabilities rc
      on rc.module = ur.module
     and rc.role = ur.role
    where ur.user_id = auth.uid()
      and rc.cap = p_cap
  );
$$;

create or replace function core.has_module_role(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from core.user_roles ur
    join core.roles r
      on r.module = ur.module
     and r.role = ur.role
     and r.is_active = true
    where ur.user_id = auth.uid()
      and ur.module = p_module
  );
$$;

create or replace function core.sync_user_role_claims(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles jsonb;
begin
  -- Serialize claim rebuilds with auth updates before reading role assignments.
  perform 1
  from auth.users u
  where u.id = target_user_id
  for update;
  if not found then
    raise exception 'Unknown auth user %', target_user_id;
  end if;

  select coalesce(pg_catalog.jsonb_object_agg(grouped.module, grouped.roles order by grouped.module), '{}'::jsonb)
  into v_roles
  from (
    select ur.module, pg_catalog.jsonb_agg(ur.role order by ur.role) as roles
    from core.user_roles ur
    join core.roles r
      on r.module = ur.module
     and r.role = ur.role
     and r.is_active = true
    where ur.user_id = target_user_id
    group by ur.module
  ) grouped;

  update auth.users u
  set raw_app_meta_data = pg_catalog.jsonb_set(
    coalesce(u.raw_app_meta_data, '{}'::jsonb),
    '{roles}', v_roles, true
  )
  where u.id = target_user_id;

  return v_roles;
end;
$$;

create or replace function core.prevent_department_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.departments.hierarchy', 0)
  );
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Department hierarchy cycle: a department cannot parent itself';
  end if;

  if not exists (
    select 1 from core.departments d
    where d.id = new.parent_id and d.is_active
  ) then
    raise exception 'Parent department must exist and be active';
  end if;

  if tg_op = 'UPDATE' then
    if exists (
      with recursive descendants as (
        select d.id
        from core.departments d
        where d.parent_id = new.id
        union all
        select child.id
        from core.departments child
        join descendants parent on child.parent_id = parent.id
      )
      select 1 from descendants where id = new.parent_id
    ) then
      raise exception 'Department hierarchy cycle: parent cannot be a descendant';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists departments_prevent_cycle on core.departments;
create trigger departments_prevent_cycle
before insert or update of parent_id on core.departments
for each row execute function core.prevent_department_cycle();

create or replace function core.department_has_unresolved_work(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from core.departments child
      where child.parent_id = target_department_id and child.is_active
    )
    or exists (
      select 1 from core.profile_department_scopes scope
      where scope.department_id = target_department_id
        and (scope.effective_to is null or scope.effective_to >= current_date)
    );
$$;

create or replace function core.list_departments()
returns table (
  id uuid,
  code text,
  name text,
  parent_id uuid,
  parent_code text,
  is_active boolean,
  sort_order integer,
  purpose text,
  updated_at timestamptz,
  active_scope_count bigint,
  can_deactivate boolean,
  deactivation_blocked_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;

  return query select
    d.id,
    d.code,
    d.name,
    d.parent_id,
    parent.code,
    d.is_active,
    d.sort_order,
    d.purpose,
    d.updated_at,
    count(scope.id) filter (
      where scope.effective_to is null or scope.effective_to >= current_date
    ) as active_scope_count,
    not core.department_has_unresolved_work(d.id) as can_deactivate,
    case when core.department_has_unresolved_work(d.id)
      then 'Resolve active child departments or current/future profile assignments before deactivation.'
      else null
    end as deactivation_blocked_reason
  from core.departments d
  left join core.departments parent on parent.id = d.parent_id
  left join core.profile_department_scopes scope on scope.department_id = d.id
  group by d.id, parent.code
  order by d.sort_order, d.name;
end;
$$;

create or replace function core.upsert_department(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := case
    when nullif(payload->>'id', '') is null then gen_random_uuid()
    else (payload->>'id')::uuid
  end;
  v_existing core.departments;
  v_saved core.departments;
  v_code text := lower(nullif(btrim(payload->>'code'), ''));
  v_name text := nullif(btrim(payload->>'name'), '');
  v_parent_id uuid := case
    when nullif(payload->>'parent_id', '') is null then null
    else (payload->>'parent_id')::uuid
  end;
  v_is_active boolean := coalesce((payload->>'is_active')::boolean, true);
  v_sort_order integer := coalesce((payload->>'sort_order')::integer, 0);
  v_purpose text;
  v_expected_updated_at timestamptz := nullif(payload->>'expected_updated_at', '')::timestamptz;
  v_before jsonb;
  v_after jsonb;
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.departments.hierarchy', 0)
  );

  select * into v_existing from core.departments where id = v_id for update;
  v_before := case when found then to_jsonb(v_existing) else null end;

  if v_existing.id is null then
    if v_code is null then raise exception 'Department code is required'; end if;
    if v_name is null then raise exception 'Department name is required'; end if;
  else
    if v_expected_updated_at is null
      or v_expected_updated_at is distinct from v_existing.updated_at then
      raise exception 'Stale editor version: reload the department before saving';
    end if;
    if v_code is not null and v_code <> v_existing.code then
      raise exception 'Department code is stable and cannot be changed';
    end if;
    v_code := v_existing.code;
    v_name := coalesce(v_name, v_existing.name);
    v_parent_id := case
      when payload ? 'parent_id' then v_parent_id
      else v_existing.parent_id
    end;
    v_is_active := case
      when payload ? 'is_active' then v_is_active
      else v_existing.is_active
    end;
    v_sort_order := case
      when payload ? 'sort_order' then v_sort_order
      else v_existing.sort_order
    end;
  end if;

  v_purpose := case
    when payload ? 'purpose' then nullif(pg_catalog.btrim(payload->>'purpose'), '')
    else v_existing.purpose
  end;

  if v_existing.is_active and not v_is_active
    and core.department_has_unresolved_work(v_id) then
    raise exception 'Department has unresolved work; resolve active child departments or current/future profile assignments before deactivation';
  end if;

  if v_existing.id is not null
    and v_existing.name is not distinct from v_name
    and v_existing.parent_id is not distinct from v_parent_id
    and v_existing.is_active is not distinct from v_is_active
    and v_existing.sort_order is not distinct from v_sort_order
    and v_existing.purpose is not distinct from v_purpose then
    return pg_catalog.to_jsonb(v_existing);
  end if;

  insert into core.departments(
    id, code, name, parent_id, is_active, sort_order, purpose,
    created_by, updated_by
  ) values (
    v_id, v_code, v_name, v_parent_id, v_is_active, v_sort_order,
    v_purpose, auth.uid(), auth.uid()
  )
  on conflict (id) do update set
    name = excluded.name,
    parent_id = excluded.parent_id,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order,
    purpose = excluded.purpose,
    updated_at = pg_catalog.clock_timestamp(),
    updated_by = auth.uid()
  returning * into v_saved;

  v_after := to_jsonb(v_saved);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'department', v_saved.id::text,
    case when v_before is null then 'department_created' else 'department_updated' end,
    auth.uid(), jsonb_build_object('before', v_before, 'after', v_after)
  );
  return v_after;
end;
$$;

create or replace function core.assign_profile_department(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := case
    when nullif(payload->>'id', '') is null then gen_random_uuid()
    else (payload->>'id')::uuid
  end;
  v_profile_id uuid;
  v_department_id uuid;
  v_scope_type text;
  v_from date;
  v_to date;
  v_expected_updated_at timestamptz := nullif(payload->>'expected_updated_at', '')::timestamptz;
  v_existing core.profile_department_scopes;
  v_saved core.profile_department_scopes;
  v_department core.departments;
  v_before jsonb;
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;

  select * into v_existing
  from core.profile_department_scopes where id = v_id for update;
  v_before := case when found then to_jsonb(v_existing) else null end;

  if v_existing.id is not null and (
    v_expected_updated_at is null
    or v_expected_updated_at is distinct from v_existing.updated_at
  ) then
    raise exception 'Stale editor version: reload the department scope before saving';
  end if;

  v_profile_id := coalesce(nullif(payload->>'profile_id', '')::uuid, v_existing.profile_id);
  v_department_id := coalesce(nullif(payload->>'department_id', '')::uuid, v_existing.department_id);
  v_scope_type := coalesce(
    nullif(pg_catalog.btrim(payload->>'scope_type'), ''),
    v_existing.scope_type,
    'member'
  );
  v_from := coalesce(nullif(payload->>'effective_from', '')::date, v_existing.effective_from, current_date);
  v_to := case
    when payload ? 'effective_to' then nullif(payload->>'effective_to', '')::date
    else v_existing.effective_to
  end;

  if v_existing.id is not null
    and v_existing.profile_id is not distinct from v_profile_id
    and v_existing.department_id is not distinct from v_department_id
    and v_existing.scope_type is not distinct from v_scope_type
    and v_existing.effective_from is not distinct from v_from
    and v_existing.effective_to is not distinct from v_to then
    return pg_catalog.to_jsonb(v_existing);
  end if;

  if v_profile_id = auth.uid() then
    raise exception 'Self-assignment is not allowed: cannot modify your own department scope';
  end if;
  if not exists (select 1 from core.profiles p where p.id = v_profile_id) then
    raise exception 'Unknown profile %', v_profile_id;
  end if;

  if v_existing.id is not null and v_existing.effective_from <= current_date then
    if v_profile_id is distinct from v_existing.profile_id
      or v_department_id is distinct from v_existing.department_id
      or v_scope_type is distinct from v_existing.scope_type
      or v_from is distinct from v_existing.effective_from then
      raise exception 'Effective scope history is append-only after start';
    end if;
    if v_existing.effective_to is not null and v_to is null then
      raise exception 'Effective scope history is append-only: cannot reopen an effective scope';
    end if;
    if v_existing.effective_to is not null and v_to > v_existing.effective_to then
      raise exception 'Effective scope history is append-only: cannot extend an effective scope';
    end if;
    if v_to is not null and v_to < current_date then
      raise exception 'Effective scope history is append-only: close an effective scope today or later';
    end if;
  end if;

  select * into v_department
  from core.departments d
  where d.id = v_department_id
  for update;
  if v_department.id is null or not v_department.is_active then
    raise exception 'Department must exist and be active';
  end if;

  if v_existing.id is null then
    insert into core.profile_department_scopes(
      id, profile_id, department_id, scope_type, effective_from, effective_to,
      created_by, updated_by
    ) values (
      v_id, v_profile_id, v_department_id, v_scope_type, v_from, v_to,
      auth.uid(), auth.uid()
    ) returning * into v_saved;
  else
    update core.profile_department_scopes scope
    set profile_id = v_profile_id,
        department_id = v_department_id,
        scope_type = v_scope_type,
        effective_from = v_from,
        effective_to = v_to,
        updated_at = pg_catalog.clock_timestamp(),
        updated_by = auth.uid()
    where scope.id = v_id
    returning * into v_saved;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'profile_department_scope', v_saved.id::text,
    case when v_before is null then 'department_scope_assigned' else 'department_scope_updated' end,
    auth.uid(), jsonb_build_object('before', v_before, 'after', to_jsonb(v_saved))
  );
  return to_jsonb(v_saved);
end;
$$;

-- Every role-definition and role-assignment writer uses the same sorted lock
-- keys so create, rename, deactivate, grant, and revoke cannot pass each other.
create or replace function core.lock_role_bundle_keys(
  p_module text,
  p_first_role text,
  p_second_role text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  for v_role in
    select distinct requested.role
    from pg_catalog.unnest(array[p_first_role, p_second_role]) requested(role)
    where requested.role is not null
    order by requested.role
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_module || ':' || v_role, 0)
    );
  end loop;
end;
$$;

create or replace function core.list_rbac_catalog()
returns table (
  module text,
  role text,
  label text,
  description text,
  is_active boolean,
  is_protected boolean,
  updated_at timestamptz,
  capabilities text[],
  assignment_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;

  return query select
    r.module,
    r.role,
    r.label,
    r.description,
    r.is_active,
    r.is_protected,
    r.updated_at,
    coalesce(array_agg(rc.cap order by rc.cap) filter (where rc.cap is not null), array[]::text[]),
    count(distinct ur.user_id)
  from core.roles r
  left join core.role_capabilities rc
    on rc.module = r.module and rc.role = r.role
  left join core.user_roles ur
    on ur.module = r.module and ur.role = r.role
  group by
    r.module, r.role, r.label, r.description, r.is_active, r.is_protected,
    r.updated_at
  order by r.module, r.label, r.role;
end;
$$;

create or replace function core.upsert_role_bundle(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_module text := lower(nullif(btrim(payload->>'module'), ''));
  v_role text := lower(nullif(btrim(payload->>'role'), ''));
  v_original_role text := lower(coalesce(
    nullif(btrim(payload->>'original_role'), ''),
    nullif(btrim(payload->>'role'), '')
  ));
  v_label text := nullif(btrim(payload->>'label'), '');
  v_description text := nullif(btrim(payload->>'description'), '');
  v_is_active boolean := coalesce((payload->>'is_active')::boolean, true);
  v_expected_updated_at timestamptz := nullif(payload->>'expected_updated_at', '')::timestamptz;
  v_existing core.roles;
  v_caps text[];
  v_before jsonb;
  v_after jsonb;
  v_assigned_users uuid[] := array[]::uuid[];
  v_user_id uuid;
  v_unknown_caps text[];
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_module is null or v_role is null or v_label is null then
    raise exception 'Role module, code, and label are required';
  end if;
  if v_role !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Role code must use lowercase letters, numbers, and underscores';
  end if;
  if not exists (
    select 1 from core.capabilities where module = v_module
  ) then
    raise exception 'Unknown capability module %', v_module;
  end if;
  if jsonb_typeof(coalesce(payload->'capabilities', '[]'::jsonb)) <> 'array' then
    raise exception 'Capabilities must be an array of existing capability codes';
  end if;

  select coalesce(array_agg(value order by value), array[]::text[])
  into v_caps
  from (
    select distinct jsonb_array_elements_text(
      coalesce(payload->'capabilities', '[]'::jsonb)
    ) as value
  ) requested;

  select array_agg(requested_cap order by requested_cap)
  into v_unknown_caps
  from unnest(v_caps) requested_cap
  left join core.capabilities existing
    on existing.module = v_module and existing.cap = requested_cap
  where existing.cap is null;
  if coalesce(cardinality(v_unknown_caps), 0) > 0 then
    raise exception 'Unknown capabilities for module %: %', v_module, v_unknown_caps;
  end if;
  if v_module = 'core' and 'manage_rbac' = any(v_caps) then
    raise exception 'Self-escalation is not allowed: cannot grant core:manage_rbac through a runtime role bundle';
  end if;

  perform core.lock_role_bundle_keys(v_module, v_original_role, v_role);

  select * into v_existing
  from core.roles r
  where r.module = v_module and r.role = v_original_role
  for update;

  if v_existing.module is not null and (
    v_expected_updated_at is null
    or v_expected_updated_at is distinct from v_existing.updated_at
  ) then
    raise exception 'Stale editor version: reload the role catalogue before saving';
  end if;

  select pg_catalog.jsonb_build_object(
    'module', r.module,
    'role', r.role,
    'label', r.label,
    'description', r.description,
    'is_active', r.is_active,
    'capabilities', coalesce((
      select pg_catalog.jsonb_agg(rc.cap order by rc.cap)
      from core.role_capabilities rc
      where rc.module = r.module and rc.role = r.role
    ), '[]'::jsonb)
  )
  into v_before
  from core.roles r
  where r.module = v_module and r.role = v_original_role
  ;

  if exists (
    select 1 from core.roles r
    where r.module = v_module and r.role = v_original_role and r.is_protected
  ) then
    raise exception 'Protected bootstrap role cannot be changed';
  end if;
  if exists (
    select 1 from core.user_roles ur
    where ur.user_id = auth.uid() and ur.module = v_module and ur.role = v_original_role
  ) then
    raise exception 'Cannot modify your own role assignment through a role bundle';
  end if;

  perform 1
  from core.user_roles ur
  where ur.module = v_module and ur.role = v_original_role
  order by ur.user_id
  for update;

  select coalesce(pg_catalog.array_agg(ur.user_id order by ur.user_id), array[]::uuid[])
  into v_assigned_users
  from core.user_roles ur
  where ur.module = v_module and ur.role = v_original_role;

  v_after := pg_catalog.jsonb_build_object(
    'module', v_module,
    'role', v_role,
    'label', v_label,
    'description', v_description,
    'is_active', v_is_active,
    'capabilities', pg_catalog.to_jsonb(v_caps)
  );

  if v_original_role = v_role and v_before = v_after then
    return v_before;
  end if;

  if v_original_role <> v_role then
    if v_before is null then raise exception 'Role to rename does not exist'; end if;
    if exists (
      select 1 from core.roles r where r.module = v_module and r.role = v_role
    ) then
      raise exception 'Role %:% already exists', v_module, v_role;
    end if;

    insert into core.roles(module, role, label, description, is_active, is_protected)
    values (v_module, v_role, v_label, v_description, v_is_active, false);
    insert into core.user_roles(user_id, module, role)
    select user_id, v_module, v_role
    from core.user_roles
    where module = v_module and role = v_original_role
    on conflict do nothing;
    delete from core.user_roles
    where module = v_module and role = v_original_role;
    delete from core.role_capabilities
    where module = v_module and role = v_original_role;
    delete from core.roles
    where module = v_module and role = v_original_role;
  else
    insert into core.roles(module, role, label, description, is_active, is_protected)
    values (v_module, v_role, v_label, v_description, v_is_active, false)
    on conflict (module, role) do update set
      label = excluded.label,
      description = excluded.description,
      is_active = excluded.is_active,
      updated_at = pg_catalog.clock_timestamp();
  end if;

  delete from core.role_capabilities
  where module = v_module and role = v_role;
  insert into core.role_capabilities(module, role, cap)
  select v_module, v_role, cap from unnest(v_caps) cap;

  foreach v_user_id in array v_assigned_users loop
    perform core.sync_user_role_claims(v_user_id);
  end loop;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'role_bundle', v_module || ':' || v_role,
    case when v_before is null then 'role_bundle_created' else 'role_bundle_updated' end,
    auth.uid(), pg_catalog.jsonb_build_object(
      'before', v_before,
      'after', v_after,
      'affected_user_ids', pg_catalog.to_jsonb(v_assigned_users)
    )
  );
  return v_after;
end;
$$;

-- Assignment writes stay separate from bundle definition and cannot target the
-- caller. Unknown or inactive bundles remain visible and revocable, but cannot
-- receive new assignments.
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
  v_before jsonb;
  v_after jsonb;
  v_changed integer;
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'Self-assignment is not allowed: cannot modify your own role assignment';
  end if;
  perform core.lock_role_bundle_keys(v_module, v_role);
  if not exists (
    select 1 from core.roles
    where module = v_module and role = v_role and is_active
  ) then
    raise exception 'Unknown or inactive role %:%', v_module, v_role;
  end if;
  if not exists (select 1 from core.profiles where id = v_user_id) then
    raise exception 'Unknown profile %', v_user_id;
  end if;

  v_before := jsonb_build_object('assigned', exists(
    select 1 from core.user_roles
    where user_id = v_user_id and module = v_module and role = v_role
  ));
  insert into core.user_roles(user_id, module, role)
  values (v_user_id, v_module, v_role)
  on conflict do nothing;
  get diagnostics v_changed = row_count;
  v_after := jsonb_build_object(
    'user_id', v_user_id, 'module', v_module, 'role', v_role, 'assigned', true
  );
  if v_changed = 0 then
    return v_after;
  end if;
  perform core.sync_user_role_claims(v_user_id);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'user_role', v_user_id::text, 'role_granted', auth.uid(),
    jsonb_build_object('before', v_before, 'after', v_after)
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
  v_before jsonb;
  v_after jsonb;
  v_changed integer;
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'Self-assignment is not allowed: cannot modify your own role assignment';
  end if;
  perform core.lock_role_bundle_keys(v_module, v_role);
  v_before := jsonb_build_object('assigned', exists(
    select 1 from core.user_roles
    where user_id = v_user_id and module = v_module and role = v_role
  ));
  delete from core.user_roles
  where user_id = v_user_id and module = v_module and role = v_role;
  get diagnostics v_changed = row_count;
  v_after := jsonb_build_object(
    'user_id', v_user_id, 'module', v_module, 'role', v_role, 'assigned', false
  );
  if v_changed = 0 then
    return v_after;
  end if;
  perform core.sync_user_role_claims(v_user_id);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'user_role', v_user_id::text, 'role_revoked', auth.uid(),
    jsonb_build_object('before', v_before, 'after', v_after)
  );
  return v_after;
end;
$$;

create or replace function core.my_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(module, capabilities order by module), '{}'::jsonb)
  from (
    select rc.module, jsonb_agg(distinct rc.cap order by rc.cap) as capabilities
    from core.user_roles ur
    join core.roles r on r.module = ur.module and r.role = ur.role and r.is_active
    join core.role_capabilities rc on rc.module = ur.module and rc.role = ur.role
    where ur.user_id = auth.uid()
    group by rc.module
  ) effective;
$$;

create or replace function private.warehouse_list_stock_change_requests(payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := pg_catalog.least(pg_catalog.greatest(coalesce((payload->>'limit')::integer, 50), 1), 100);
  v_status text := nullif(payload->>'status', '');
  v_search text := nullif(pg_catalog.btrim(coalesce(payload->>'search', '')), '');
  v_rows jsonb;
begin
  if not (
    core.has_cap('warehouse', 'approve_stock_adjustment')
    or core.has_cap('warehouse', 'approve_stock_adjustment_finance')
  ) then
    raise exception 'Not authorized: warehouse stock approvals';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(listed) order by listed.requested_at desc, listed.id desc),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      request.*,
      (
        request.requested_by <> auth.uid()
        and current_step.id is not null
        and approval_group.is_active
        and approval_group.request_status = request.status
        and core.has_cap(approval_group.module, approval_group.capability)
      ) as can_decide
    from warehouse.stock_change_requests request
    left join lateral (
      select approval.id, approval.approver_role
      from core.approvals approval
      where approval.entity_type = 'warehouse_stock_change'
        and approval.entity_id = request.id
        and approval.decision = 'pending'
      order by step
      limit 1
    ) current_step on true
    left join core.approval_groups approval_group
      on approval_group.entity_type = 'warehouse_stock_change'
     and approval_group.group_code = current_step.approver_role
    where (v_status is null or request.status = v_status)
      and (
        v_search is null
        or request.product_id ilike '%' || v_search || '%'
        or request.reason ilike '%' || v_search || '%'
      )
    order by request.requested_at desc, request.id desc
    limit v_limit
  ) listed;

  return pg_catalog.jsonb_build_object(
    'rows', v_rows,
    'next_cursor', null
  );
end;
$$;

create or replace function warehouse.list_stock_change_requests(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.warehouse_list_stock_change_requests(payload)
$$;

create or replace function private.warehouse_decide_stock_change(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_request warehouse.stock_change_requests;
  v_step core.approvals;
  v_group core.approval_groups;
  v_count warehouse.cycle_counts;
  v_product warehouse.products;
  v_line jsonb;
  v_decision text := payload->>'decision';
  v_note text := nullif(pg_catalog.btrim(coalesce(payload->>'note', '')), '');
  v_movement_id text := 'mv-' || replace(gen_random_uuid()::text, '-', '');
  v_updated integer := 0;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'decide_stock_change', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if v_decision not in ('approved', 'rejected') then
    raise exception 'Invalid stock-change decision';
  end if;
  if v_decision = 'rejected' and v_note is null then
    raise exception 'A rejection note is required';
  end if;

  select * into v_request
  from warehouse.stock_change_requests
  where id = (payload->>'request_id')::uuid
    and status in ('pending_supervisor', 'pending_finance')
  for update;
  if not found then raise exception 'Pending stock-change request not found'; end if;
  if v_request.requested_by = auth.uid() then
    raise exception 'The requester cannot approve their own stock change';
  end if;

  select * into v_step
  from core.approvals
  where entity_type = 'warehouse_stock_change'
    and entity_id = v_request.id
    and decision = 'pending'
  order by step
  limit 1
  for update;
  if not found then raise exception 'Pending approval step not found'; end if;

  select * into v_group
  from core.approval_groups approval_group
  where approval_group.entity_type = v_step.entity_type
    and approval_group.group_code = v_step.approver_role
    and approval_group.is_active
  for share;
  if not found or v_group.request_status <> v_request.status then
    raise exception 'Approval state and current group are inconsistent';
  end if;
  if not core.has_cap(v_group.module, v_group.capability) then
    raise exception 'Not authorized for approval group %', v_group.group_code;
  end if;

  update core.approvals
  set decision = v_decision,
      decided_by = auth.uid(),
      decided_at = now(),
      note = v_note
  where id = v_step.id;

  if v_decision = 'rejected' then
    update core.approvals
    set decision = 'rejected',
        decided_by = auth.uid(),
        decided_at = now(),
        note = 'Cancelled after an earlier approval step was rejected'
    where entity_type = 'warehouse_stock_change'
      and entity_id = v_request.id
      and decision = 'pending';
    update warehouse.stock_change_requests
    set status = 'rejected', decided_at = now()
    where id = v_request.id
    returning * into v_request;
    if v_request.source_type = 'cycle_count' then
      update warehouse.cycle_counts set status = 'rejected' where id = v_request.source_id;
    end if;
    update warehouse.exceptions
    set status = 'in_progress',
        resolution = v_note,
        owner_id = auth.uid(),
        updated_at = now()
    where source_type = 'stock_change_request'
      and source_id = v_request.id::text
      and status = 'open';
  elsif exists (
    select 1 from core.approvals
    where entity_type = 'warehouse_stock_change'
      and entity_id = v_request.id
      and decision = 'pending'
  ) then
    update warehouse.stock_change_requests
    set status = 'pending_finance'
    where id = v_request.id
    returning * into v_request;
  else
    select * into v_product from warehouse.products where id = v_request.product_id;
    if not found then raise exception 'Stock-change product not found'; end if;

    if v_product.serialized then
      if v_request.quantity_delta > 0 then
        raise exception 'Serialized cycle counts cannot add unknown units';
      end if;
      select * into v_count
      from warehouse.cycle_counts
      where id = v_request.source_id
      for update;
      select value into v_line
      from jsonb_array_elements(v_count.lines)
      where value->>'productId' = v_request.product_id;
      with missing_units as (
        select id
        from warehouse.inventory_units
        where product_id = v_request.product_id
          and location_id = v_request.location_id
          and bin_id is not distinct from v_request.bin_id
          and status in ('in_stock', 'returned')
          and not (serial_number = any (
            array(select jsonb_array_elements_text(coalesce(v_line->'serialNumbers', '[]'::jsonb)))
          ))
        order by id
        limit abs(v_request.quantity_delta)
        for update
      )
      update warehouse.inventory_units
      set status = 'lost', assigned_to = null, event_id = null
      where id in (select id from missing_units);
      get diagnostics v_updated = row_count;
      if v_updated <> abs(v_request.quantity_delta) then
        raise exception 'Serialized variance no longer matches locked inventory';
      end if;
    else
      update warehouse.stock_levels
      set quantity = quantity + v_request.quantity_delta
      where product_id = v_request.product_id
        and location_id = v_request.location_id
        and bin_id is not distinct from v_request.bin_id
        and lot_id is null
        and quantity + v_request.quantity_delta >= 0;
      if not found and v_request.quantity_delta > 0 then
        insert into warehouse.stock_levels(product_id, location_id, bin_id, lot_id, quantity)
        values (
          v_request.product_id, v_request.location_id, v_request.bin_id,
          null, v_request.quantity_delta
        );
      elsif not found then
        raise exception 'Stock variance would make inventory negative';
      end if;
    end if;

    insert into warehouse.movements(
      id, type, product_id, quantity, to_location_id, to_bin_id,
      reason, reference, evidence_urls, actor, created_at
    ) values (
      v_movement_id,
      case when v_request.source_type = 'cycle_count' then 'cycle_count' else 'adjustment' end,
      v_request.product_id, v_request.quantity_delta,
      v_request.location_id, v_request.bin_id, v_request.reason,
      v_request.id::text, v_request.evidence_urls,
      coalesce(auth.jwt()->>'email', auth.uid()::text), now()
    );

    update warehouse.stock_change_requests
    set status = 'approved', decided_at = now()
    where id = v_request.id
    returning * into v_request;
    update warehouse.exceptions
    set status = 'resolved',
        resolution = coalesce(v_note, 'Approved stock change posted'),
        owner_id = auth.uid(),
        updated_at = now()
    where source_type = 'stock_change_request'
      and source_id = v_request.id::text
      and status in ('open', 'in_progress');
    if v_request.source_type = 'cycle_count' and not exists (
      select 1 from warehouse.stock_change_requests sibling
      where sibling.source_type = 'cycle_count'
        and sibling.source_id = v_request.source_id
        and sibling.status <> 'approved'
    ) then
      update warehouse.cycle_counts set status = 'approved' where id = v_request.source_id;
    end if;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'stock_change_request', v_request.id, v_decision, auth.uid(),
    jsonb_build_object(
      'step', v_step.step,
      'approval_group', v_group.group_code,
      'status', v_request.status,
      'note', v_note,
      'movement_id', case when v_request.status = 'approved' then v_movement_id end
    )
  );

  v_response := to_jsonb(v_request);
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

-- Initial organization hierarchy. Product is the recorded go-live authority.
insert into core.departments(code, name, parent_id, sort_order, purpose) values
  ('marketing', 'Marketing', null, 10, null),
  ('sales', 'Sales', null, 20, null),
  ('product', 'Product', null, 30, 'Final client and product go-live authority'),
  ('technology', 'Technology', null, 40, 'Technical integration readiness'),
  ('pmo', 'Project Management Office', null, 50, null),
  ('operations', 'Operations', null, 60, 'Operational readiness'),
  ('finance', 'Finance', null, 70, null),
  ('procurement', 'Procurement', null, 80, 'Independent enterprise procurement authority'),
  ('legal_compliance', 'Legal & Compliance', null, 90, null),
  ('people_culture', 'People & Culture', null, 100, null),
  ('administration', 'Administration', null, 110, null)
on conflict (code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  purpose = excluded.purpose;

insert into core.departments(code, name, parent_id, sort_order, purpose) values
  (
    'operations.warehouse_logistics', 'Warehouse & Logistics',
    (select id from core.departments where code = 'operations'), 61,
    'Physical custody, inventory, receipt, issue, and return operations'
  ),
  (
    'operations.customer_service', 'Customer Service',
    (select id from core.departments where code = 'operations'), 62,
    'Post-launch customer support'
  ),
  (
    'operations.client_product_implementation', 'Client & Product Implementation',
    (select id from core.departments where code = 'operations'), 63,
    'Coordinates client and product implementation delivery'
  )
on conflict (code) do update set
  name = excluded.name,
  parent_id = excluded.parent_id,
  sort_order = excluded.sort_order,
  purpose = excluded.purpose;

insert into core.roles(module, role, label, description, is_active, is_protected) values
  (
    'warehouse', 'warehouse_operator', 'Warehouse Operator',
    'Routine receiving, inspection, putaway, picking, issue, returns, and counts.',
    true, false
  ),
  (
    'warehouse', 'warehouse_supervisor', 'Warehouse Supervisor',
    'Controlled Warehouse exceptions, quality disposition, adjustments, configuration, and imports.',
    true, false
  )
on conflict (module, role) do update set
  label = excluded.label,
  description = excluded.description,
  is_active = true,
  updated_at = now();

delete from core.role_capabilities
where module = 'warehouse' and role in ('warehouse_operator', 'warehouse_supervisor');

insert into core.role_capabilities(module, role, cap) values
  ('warehouse', 'warehouse_operator', 'view_dashboard'),
  ('warehouse', 'warehouse_operator', 'receive_stock'),
  ('warehouse', 'warehouse_operator', 'manage_inventory'),
  ('warehouse', 'warehouse_operator', 'cycle_count'),
  ('warehouse', 'warehouse_operator', 'manage_returns'),
  ('warehouse', 'warehouse_operator', 'reserve_allocate'),
  ('warehouse', 'warehouse_operator', 'issue_items'),
  ('warehouse', 'warehouse_operator', 'transfer_stock'),
  ('warehouse', 'warehouse_operator', 'inspect_quality'),
  ('warehouse', 'warehouse_operator', 'view_exceptions'),
  ('warehouse', 'warehouse_supervisor', 'view_dashboard'),
  ('warehouse', 'warehouse_supervisor', 'receive_stock'),
  ('warehouse', 'warehouse_supervisor', 'manage_inventory'),
  ('warehouse', 'warehouse_supervisor', 'manage_products'),
  ('warehouse', 'warehouse_supervisor', 'manage_locations'),
  ('warehouse', 'warehouse_supervisor', 'cycle_count'),
  ('warehouse', 'warehouse_supervisor', 'manage_returns'),
  ('warehouse', 'warehouse_supervisor', 'reserve_allocate'),
  ('warehouse', 'warehouse_supervisor', 'issue_items'),
  ('warehouse', 'warehouse_supervisor', 'transfer_stock'),
  ('warehouse', 'warehouse_supervisor', 'manage_operation_routes'),
  ('warehouse', 'warehouse_supervisor', 'inspect_quality'),
  ('warehouse', 'warehouse_supervisor', 'release_quality_hold'),
  ('warehouse', 'warehouse_supervisor', 'approve_stock_adjustment'),
  ('warehouse', 'warehouse_supervisor', 'view_exceptions'),
  ('warehouse', 'warehouse_supervisor', 'resolve_exceptions'),
  ('warehouse', 'warehouse_supervisor', 'import_warehouse_data')
on conflict do nothing;

insert into core.role_capabilities(module, role, cap)
select 'warehouse', role.role, 'approve_stock_adjustment_finance'
from core.roles role
where role.module = 'warehouse'
  and role.role in ('finance', 'warehouse_admin')
on conflict do nothing;

-- Legacy Operations and Logistics Supervisor roles remain assignment aliases
-- until active users are explicitly remapped to the canonical bundles.
insert into core.roles(module, role, label, description, is_active) values
  ('warehouse', 'operations', 'Operations', 'Legacy Warehouse operating-role alias.', true),
  ('warehouse', 'logistics_supervisor', 'Logistics Supervisor', 'Legacy Warehouse supervisor-role alias.', true)
on conflict (module, role) do update set is_active = true;

delete from core.role_capabilities
where module = 'warehouse'
  and role in ('operations', 'logistics_supervisor');

insert into core.role_capabilities(module, role, cap)
select 'warehouse', aliases.alias_role, canonical.cap
from (
  values
    ('operations', 'warehouse_operator'),
    ('logistics_supervisor', 'warehouse_supervisor')
) aliases(alias_role, canonical_role)
join core.role_capabilities canonical
  on canonical.module = 'warehouse'
 and canonical.role = aliases.canonical_role
on conflict do nothing;

-- Known aliases are repaired above. Reject any other orphan user role
-- assignments before making the deferred integrity contract authoritative.
do $$
declare
  orphan_user_roles text;
begin
  select pg_catalog.string_agg(
    pg_catalog.format('%s:%s', orphan.module, orphan.role),
    ', ' order by orphan.module, orphan.role
  )
  into orphan_user_roles
  from (
    select distinct ur.module, ur.role
    from core.user_roles ur
    left join core.roles r
      on r.module = ur.module
     and r.role = ur.role
    where r.module is null
  ) orphan;

  if orphan_user_roles is not null then
    raise exception 'Orphan user role assignments must be repaired before migration: %',
      orphan_user_roles;
  end if;

  alter table core.user_roles
    validate constraint user_roles_role_integrity_fk;
end;
$$;

alter table core.departments enable row level security;
alter table core.profile_department_scopes enable row level security;
alter table core.approval_groups enable row level security;

drop policy if exists departments_read on core.departments;
create policy departments_read on core.departments
  for select to authenticated
  using (true);

drop policy if exists profile_department_scopes_read on core.profile_department_scopes;
create policy profile_department_scopes_read on core.profile_department_scopes
  for select to authenticated
  using (
    profile_id = auth.uid()
    or core.has_cap('core', 'manage_rbac')
  );

revoke insert, update, delete on core.departments from authenticated;
revoke insert, update, delete on core.profile_department_scopes from authenticated;
grant select on core.departments to authenticated;
grant select on core.profile_department_scopes to authenticated;
grant all on core.departments to service_role;
grant all on core.profile_department_scopes to service_role;

revoke all on function core.prevent_department_cycle() from public, anon, authenticated;
revoke all on function core.lock_role_bundle_keys(text, text, text) from public, anon, authenticated;
revoke all on function core.department_has_unresolved_work(uuid) from public, anon, authenticated;
revoke all on function core.list_departments() from public, anon;
revoke all on function core.upsert_department(jsonb) from public, anon;
revoke all on function core.assign_profile_department(jsonb) from public, anon;
revoke all on function core.list_rbac_catalog() from public, anon;
revoke all on function core.upsert_role_bundle(jsonb) from public, anon;
revoke all on function core.my_capabilities() from public, anon;
revoke all on function core.assign_user_role(jsonb) from public, anon;
revoke all on function core.revoke_user_role(jsonb) from public, anon;
revoke all on function private.warehouse_list_stock_change_requests(jsonb) from public, anon;
revoke all on function warehouse.list_stock_change_requests(jsonb) from public, anon;

grant execute on function core.department_has_unresolved_work(uuid) to service_role;
grant execute on function core.list_departments() to authenticated, service_role;
grant execute on function core.upsert_department(jsonb) to authenticated, service_role;
grant execute on function core.assign_profile_department(jsonb) to authenticated, service_role;
grant execute on function core.list_rbac_catalog() to authenticated, service_role;
grant execute on function core.upsert_role_bundle(jsonb) to authenticated, service_role;
grant execute on function core.my_capabilities() to authenticated, service_role;
grant execute on function core.assign_user_role(jsonb) to authenticated, service_role;
grant execute on function core.revoke_user_role(jsonb) to authenticated, service_role;
grant execute on function private.warehouse_list_stock_change_requests(jsonb) to authenticated, service_role;
grant execute on function warehouse.list_stock_change_requests(jsonb) to authenticated, service_role;
