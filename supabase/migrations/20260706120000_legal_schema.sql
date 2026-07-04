-- Mwell Intra — legal schema MVP (Step 3b)
--
-- Accreditation cases + requirement checklists (spec §4.3 vendor accreditation).
-- Legal owns the case lifecycle; core.vendors.accreditation_status is updated on
-- approval via legal.approve_accreditation_case (Step 3d may centralize further).
--
-- Case status: draft → submitted → under_review → approved|rejected|expired|renewal_due
-- Checklist item status: pending → submitted → approved|rejected|waived
--
-- Re-runnable: create if not exists + create-or-replace functions.

create schema if not exists legal;

create table if not exists legal.accreditation_cases (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references core.vendors(id),
  status       text not null default 'draft',
  submitted_at timestamptz,
  reviewed_at  timestamptz,
  expires_at   date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint accreditation_cases_status_check check (
    status in (
      'draft', 'submitted', 'under_review', 'approved',
      'rejected', 'expired', 'renewal_due'
    )
  )
);

create index if not exists accreditation_cases_vendor_idx on legal.accreditation_cases (vendor_id);
create index if not exists accreditation_cases_status_idx on legal.accreditation_cases (status);

create table if not exists legal.requirement_checklist_items (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references legal.accreditation_cases(id) on delete cascade,
  requirement_code text not null,
  label            text not null,
  required         boolean not null default true,
  status           text not null default 'pending',
  document_id      uuid references core.documents(id) on delete set null,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint checklist_items_status_check check (
    status in ('pending', 'submitted', 'approved', 'rejected', 'waived')
  ),
  unique (case_id, requirement_code)
);

create index if not exists checklist_items_case_idx on legal.requirement_checklist_items (case_id);

-- ---------------------------------------------------------------------------
-- RLS — internal reviewers vs vendor-tier (own vendor_id only)
-- ---------------------------------------------------------------------------
alter table legal.accreditation_cases enable row level security;
alter table legal.requirement_checklist_items enable row level security;

drop policy if exists read_cases_internal on legal.accreditation_cases;
create policy read_cases_internal on legal.accreditation_cases for select to authenticated
  using (core.has_cap('legal', 'view_dashboard'));

drop policy if exists read_cases_vendor on legal.accreditation_cases;
create policy read_cases_vendor on legal.accreditation_cases for select to authenticated
  using (
    core.has_cap('legal', 'view_own_accreditation')
    and vendor_id = core.current_vendor_id()
  );

drop policy if exists read_checklist_internal on legal.requirement_checklist_items;
create policy read_checklist_internal on legal.requirement_checklist_items for select to authenticated
  using (
    exists (
      select 1 from legal.accreditation_cases c
      where c.id = case_id and core.has_cap('legal', 'view_dashboard')
    )
  );

drop policy if exists read_checklist_vendor on legal.requirement_checklist_items;
create policy read_checklist_vendor on legal.requirement_checklist_items for select to authenticated
  using (
    exists (
      select 1 from legal.accreditation_cases c
      where c.id = case_id
        and c.vendor_id = core.current_vendor_id()
        and core.has_cap('legal', 'view_own_accreditation')
    )
  );

grant usage on schema legal to authenticated, service_role;
grant select on all tables in schema legal to authenticated, service_role;
grant all on all tables in schema legal to service_role;

revoke insert, update, delete on legal.accreditation_cases from authenticated;
revoke insert, update, delete on legal.requirement_checklist_items from authenticated;

-- ---------------------------------------------------------------------------
-- RPCs — capability-gated writes
-- ---------------------------------------------------------------------------

create or replace function legal.create_accreditation_case(payload jsonb)
returns jsonb language plpgsql security definer set search_path = legal, core, public as $$
declare v legal.accreditation_cases; v_vendor uuid;
begin
  v_vendor := nullif(payload->>'vendor_id', '')::uuid;
  if v_vendor is null then raise exception 'vendor_id is required'; end if;

  if core.is_vendor() then
    if not core.has_cap('legal', 'submit_accreditation') then
      raise exception 'Not authorized: legal.submit_accreditation';
    end if;
    if v_vendor <> core.current_vendor_id() then
      raise exception 'Vendors may only create cases for their own vendor record';
    end if;
  elsif not core.has_cap('legal', 'manage_checklist') then
    raise exception 'Not authorized: legal.manage_checklist';
  end if;

  insert into legal.accreditation_cases (vendor_id, status, notes)
  values (v_vendor, 'draft', nullif(payload->>'notes', ''))
  returning * into v;

  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'accreditation_case', v.id, 'created', auth.uid(),
          jsonb_build_object('vendor_id', v.vendor_id));
  return to_jsonb(v);
end; $$;

create or replace function legal.submit_accreditation_case(payload jsonb)
returns jsonb language plpgsql security definer set search_path = legal, core, public as $$
declare v legal.accreditation_cases; v_id uuid;
begin
  if not core.has_cap('legal', 'submit_accreditation') then
    raise exception 'Not authorized: legal.submit_accreditation';
  end if;
  v_id := (payload->>'id')::uuid;
  select * into v from legal.accreditation_cases where id = v_id for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  if v.vendor_id <> core.current_vendor_id() then
    raise exception 'Vendors may only submit their own accreditation cases';
  end if;
  if v.status <> 'draft' then raise exception 'Only draft cases can be submitted'; end if;
  update legal.accreditation_cases
     set status = 'submitted', submitted_at = now(), updated_at = now()
   where id = v_id
   returning * into v;
  update core.vendors set accreditation_status = 'submitted'
   where id = v.vendor_id and accreditation_status = 'draft';
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'accreditation_case', v.id, 'submitted', auth.uid(), '{}'::jsonb);
  return to_jsonb(v);
end; $$;

create or replace function legal.review_checklist_item(payload jsonb)
returns jsonb language plpgsql security definer set search_path = legal, core, public as $$
declare v legal.requirement_checklist_items; v_id uuid; v_status text;
begin
  if not core.has_cap('legal', 'review_accreditation') then
    raise exception 'Not authorized: legal.review_accreditation';
  end if;
  v_id := (payload->>'id')::uuid;
  v_status := payload->>'status';
  if v_status is null then raise exception 'status is required'; end if;
  update legal.requirement_checklist_items
     set status = v_status,
         document_id = case when payload ? 'document_id'
           then nullif(payload->>'document_id', '')::uuid else document_id end,
         updated_at = now()
   where id = v_id
   returning * into v;
  if not found then raise exception 'Checklist item not found'; end if;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'checklist_item', v.id, 'reviewed', auth.uid(),
          jsonb_build_object('status', v.status));
  return to_jsonb(v);
end; $$;

create or replace function legal.approve_accreditation_case(payload jsonb)
returns jsonb language plpgsql security definer set search_path = legal, core, public as $$
declare v legal.accreditation_cases; v_id uuid;
begin
  if not core.has_cap('legal', 'approve_accreditation') then
    raise exception 'Not authorized: legal.approve_accreditation';
  end if;
  v_id := (payload->>'id')::uuid;
  select * into v from legal.accreditation_cases where id = v_id for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  update legal.accreditation_cases
     set status = 'approved',
         reviewed_at = now(),
         expires_at = coalesce(nullif(payload->>'expires_at', '')::date, expires_at),
         updated_at = now()
   where id = v_id
   returning * into v;
  update core.vendors
     set accreditation_status = 'approved',
         accreditation_expires_at = v.expires_at
   where id = v.vendor_id;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'accreditation_case', v.id, 'approved', auth.uid(), '{}'::jsonb);
  return to_jsonb(v);
end; $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'create_accreditation_case(jsonb)',
    'submit_accreditation_case(jsonb)',
    'review_checklist_item(jsonb)',
    'approve_accreditation_case(jsonb)'
  ]
  loop
    execute format('revoke all on function legal.%s from public, anon;', fn);
    execute format('grant execute on function legal.%s to authenticated, service_role;', fn);
  end loop;
end $$;
