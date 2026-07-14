-- Configurable organization hierarchy and runtime RBAC bundles.
-- core.has_cap(module, cap) remains the authoritative authorization check.

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

alter table core.roles
  add column if not exists description text,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_protected boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Bootstrap roles establish access to the administration surface and cannot be
-- reshaped by the runtime bundle editor.
update core.roles
set is_protected = true
where (module, role) in (
  ('core', 'platform_admin'),
  ('core', 'staff'),
  ('core', 'vendor_portal')
);

create or replace function core.prevent_department_cycle()
returns trigger
language plpgsql
set search_path = core, public
as $$
begin
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

create or replace function core.prevent_department_scope_overlap()
returns trigger
language plpgsql
set search_path = core, public
as $$
begin
  if exists (
    select 1
    from core.profile_department_scopes existing
    where existing.profile_id = new.profile_id
      and existing.department_id = new.department_id
      and existing.scope_type = new.scope_type
      and existing.id <> new.id
      and daterange(
        existing.effective_from,
        coalesce(existing.effective_to + 1, 'infinity'::date),
        '[)'
      ) && daterange(
        new.effective_from,
        coalesce(new.effective_to + 1, 'infinity'::date),
        '[)'
      )
  ) then
    raise exception 'Department scope dates overlap an existing assignment';
  end if;
  return new;
end;
$$;

drop trigger if exists profile_department_scopes_prevent_overlap
  on core.profile_department_scopes;
create trigger profile_department_scopes_prevent_overlap
before insert or update on core.profile_department_scopes
for each row execute function core.prevent_department_scope_overlap();

create or replace function core.department_has_unresolved_work(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select
    exists (
      select 1 from core.departments child
      where child.parent_id = target_department_id and child.is_active
    )
    or exists (
      select 1 from core.profile_department_scopes scope
      where scope.department_id = target_department_id
        and scope.effective_from <= current_date
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
  active_scope_count bigint,
  can_deactivate boolean,
  deactivation_blocked_reason text
)
language sql
stable
security definer
set search_path = core, public
as $$
  select
    d.id,
    d.code,
    d.name,
    d.parent_id,
    parent.code,
    d.is_active,
    d.sort_order,
    d.purpose,
    count(scope.id) filter (
      where scope.effective_from <= current_date
        and (scope.effective_to is null or scope.effective_to >= current_date)
    ) as active_scope_count,
    not core.department_has_unresolved_work(d.id) as can_deactivate,
    case when core.department_has_unresolved_work(d.id)
      then 'Resolve active child departments or current profile assignments before deactivation.'
      else null
    end as deactivation_blocked_reason
  from core.departments d
  left join core.departments parent on parent.id = d.parent_id
  left join core.profile_department_scopes scope on scope.department_id = d.id
  group by d.id, parent.code
  order by d.sort_order, d.name;
$$;

create or replace function core.upsert_department(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = core, public
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
  v_before jsonb;
  v_after jsonb;
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;

  select * into v_existing from core.departments where id = v_id for update;
  v_before := case when found then to_jsonb(v_existing) else null end;

  if v_existing.id is null then
    if v_code is null then raise exception 'Department code is required'; end if;
    if v_name is null then raise exception 'Department name is required'; end if;
  else
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

  if v_existing.is_active and not v_is_active
    and core.department_has_unresolved_work(v_id) then
    raise exception 'Department has unresolved work; resolve active child departments or profile assignments before deactivation';
  end if;

  insert into core.departments(
    id, code, name, parent_id, is_active, sort_order, purpose,
    created_by, updated_by
  ) values (
    v_id, v_code, v_name, v_parent_id, v_is_active, v_sort_order,
    nullif(btrim(payload->>'purpose'), ''), auth.uid(), auth.uid()
  )
  on conflict (id) do update set
    name = excluded.name,
    parent_id = excluded.parent_id,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order,
    purpose = case
      when payload ? 'purpose' then excluded.purpose
      else core.departments.purpose
    end,
    updated_at = now(),
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
set search_path = core, public
as $$
declare
  v_id uuid := case
    when nullif(payload->>'id', '') is null then gen_random_uuid()
    else (payload->>'id')::uuid
  end;
  v_profile_id uuid := (payload->>'profile_id')::uuid;
  v_department_id uuid := (payload->>'department_id')::uuid;
  v_scope_type text := coalesce(nullif(btrim(payload->>'scope_type'), ''), 'member');
  v_from date := coalesce((payload->>'effective_from')::date, current_date);
  v_to date := nullif(payload->>'effective_to', '')::date;
  v_existing core.profile_department_scopes;
  v_saved core.profile_department_scopes;
  v_before jsonb;
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_profile_id = auth.uid() then
    raise exception 'Self-assignment is not allowed: cannot modify your own department scope';
  end if;
  if not exists (select 1 from core.profiles where id = v_profile_id) then
    raise exception 'Unknown profile %', v_profile_id;
  end if;
  if not exists (
    select 1 from core.departments
    where id = v_department_id and is_active
  ) then
    raise exception 'Department must exist and be active';
  end if;

  select * into v_existing
  from core.profile_department_scopes where id = v_id for update;
  v_before := case when found then to_jsonb(v_existing) else null end;

  insert into core.profile_department_scopes(
    id, profile_id, department_id, scope_type, effective_from, effective_to,
    created_by, updated_by
  ) values (
    v_id, v_profile_id, v_department_id, v_scope_type, v_from, v_to,
    auth.uid(), auth.uid()
  )
  on conflict (id) do update set
    profile_id = excluded.profile_id,
    department_id = excluded.department_id,
    scope_type = excluded.scope_type,
    effective_from = excluded.effective_from,
    effective_to = excluded.effective_to,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into v_saved;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'profile_department_scope', v_saved.id::text,
    case when v_before is null then 'department_scope_assigned' else 'department_scope_updated' end,
    auth.uid(), jsonb_build_object('before', v_before, 'after', to_jsonb(v_saved))
  );
  return to_jsonb(v_saved);
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
  capabilities text[],
  assignment_count bigint
)
language sql
stable
security definer
set search_path = core, public
as $$
  select
    r.module,
    r.role,
    r.label,
    r.description,
    r.is_active,
    r.is_protected,
    coalesce(array_agg(rc.cap order by rc.cap) filter (where rc.cap is not null), array[]::text[]),
    count(distinct ur.user_id)
  from core.roles r
  left join core.role_capabilities rc
    on rc.module = r.module and rc.role = r.role
  left join core.user_roles ur
    on ur.module = r.module and ur.role = r.role
  group by r.module, r.role, r.label, r.description, r.is_active, r.is_protected
  order by r.module, r.label, r.role;
$$;

create or replace function core.upsert_role_bundle(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = core, public
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

  select jsonb_build_object(
    'module', r.module,
    'role', r.role,
    'label', r.label,
    'description', r.description,
    'is_active', r.is_active,
    'capabilities', coalesce((
      select jsonb_agg(rc.cap order by rc.cap)
      from core.role_capabilities rc
      where rc.module = r.module and rc.role = r.role
    ), '[]'::jsonb)
  )
  into v_before
  from core.roles r
  where r.module = v_module and r.role = v_original_role
  for update;

  if exists (
    select 1 from core.roles
    where module = v_module and role = v_original_role and is_protected
  ) then
    raise exception 'Protected bootstrap role cannot be changed';
  end if;
  if exists (
    select 1 from core.user_roles
    where user_id = auth.uid() and module = v_module and role = v_original_role
  ) then
    raise exception 'Cannot modify your own role assignment through a role bundle';
  end if;

  if v_original_role <> v_role then
    if v_before is null then raise exception 'Role to rename does not exist'; end if;
    if exists (
      select 1 from core.roles where module = v_module and role = v_role
    ) then
      raise exception 'Role %:% already exists', v_module, v_role;
    end if;

    select coalesce(array_agg(user_id), array[]::uuid[])
    into v_assigned_users
    from core.user_roles
    where module = v_module and role = v_original_role;

    insert into core.roles(module, role, label, description, is_active, is_protected)
    values (v_module, v_role, v_label, v_description, v_is_active, false);
    insert into core.user_roles(user_id, module, role)
    select user_id, v_module, v_role
    from core.user_roles
    where module = v_module and role = v_original_role
    on conflict do nothing;
    delete from core.user_roles
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
      updated_at = now();
  end if;

  delete from core.role_capabilities
  where module = v_module and role = v_role;
  insert into core.role_capabilities(module, role, cap)
  select v_module, v_role, cap from unnest(v_caps) cap;

  foreach v_user_id in array v_assigned_users loop
    perform core.sync_user_role_claims(v_user_id);
  end loop;

  select jsonb_build_object(
    'module', r.module,
    'role', r.role,
    'label', r.label,
    'description', r.description,
    'is_active', r.is_active,
    'capabilities', to_jsonb(v_caps)
  ) into v_after
  from core.roles r
  where r.module = v_module and r.role = v_role;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'role_bundle', v_module || ':' || v_role,
    case when v_before is null then 'role_bundle_created' else 'role_bundle_updated' end,
    auth.uid(), jsonb_build_object('before', v_before, 'after', v_after)
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
set search_path = core, auth, public
as $$
declare
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_module text := payload->>'module';
  v_role text := payload->>'role';
  v_before jsonb;
  v_after jsonb;
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'Self-assignment is not allowed: cannot modify your own role assignment';
  end if;
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
  perform core.sync_user_role_claims(v_user_id);
  v_after := jsonb_build_object(
    'user_id', v_user_id, 'module', v_module, 'role', v_role, 'assigned', true
  );
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
set search_path = core, auth, public
as $$
declare
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_module text := payload->>'module';
  v_role text := payload->>'role';
  v_before jsonb;
  v_after jsonb;
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'Self-assignment is not allowed: cannot modify your own role assignment';
  end if;
  v_before := jsonb_build_object('assigned', exists(
    select 1 from core.user_roles
    where user_id = v_user_id and module = v_module and role = v_role
  ));
  delete from core.user_roles
  where user_id = v_user_id and module = v_module and role = v_role;
  perform core.sync_user_role_claims(v_user_id);
  v_after := jsonb_build_object(
    'user_id', v_user_id, 'module', v_module, 'role', v_role, 'assigned', false
  );
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
set search_path = core, public
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

-- Legacy Operations and Logistics Supervisor roles remain assignment aliases
-- until active users are explicitly remapped to the canonical bundles.
insert into core.roles(module, role, label, description, is_active) values
  ('warehouse', 'operations', 'Operations', 'Legacy Warehouse operating-role alias.', true),
  ('warehouse', 'logistics_supervisor', 'Logistics Supervisor', 'Legacy Warehouse supervisor-role alias.', true)
on conflict (module, role) do update set is_active = true;

alter table core.departments enable row level security;
alter table core.profile_department_scopes enable row level security;

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
revoke all on function core.prevent_department_scope_overlap() from public, anon, authenticated;
revoke all on function core.department_has_unresolved_work(uuid) from public, anon;
revoke all on function core.list_departments() from public, anon;
revoke all on function core.upsert_department(jsonb) from public, anon;
revoke all on function core.assign_profile_department(jsonb) from public, anon;
revoke all on function core.list_rbac_catalog() from public, anon;
revoke all on function core.upsert_role_bundle(jsonb) from public, anon;
revoke all on function core.my_capabilities() from public, anon;
revoke all on function core.assign_user_role(jsonb) from public, anon;
revoke all on function core.revoke_user_role(jsonb) from public, anon;

grant execute on function core.department_has_unresolved_work(uuid) to authenticated, service_role;
grant execute on function core.list_departments() to authenticated, service_role;
grant execute on function core.upsert_department(jsonb) to authenticated, service_role;
grant execute on function core.assign_profile_department(jsonb) to authenticated, service_role;
grant execute on function core.list_rbac_catalog() to authenticated, service_role;
grant execute on function core.upsert_role_bundle(jsonb) to authenticated, service_role;
grant execute on function core.my_capabilities() to authenticated, service_role;
grant execute on function core.assign_user_role(jsonb) to authenticated, service_role;
grant execute on function core.revoke_user_role(jsonb) to authenticated, service_role;
