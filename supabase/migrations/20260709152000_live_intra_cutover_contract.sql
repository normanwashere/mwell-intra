-- Mwell Intra - live cutover contract for Core, Legal, and Procurement.
--
-- The live project already had an older public schema and a working warehouse
-- schema, but the Intra app expected core/legal/procurement schemas through
-- PostgREST. This migration creates the missing schemas with app-stable text
-- workflow ids (for existing deep links such as case_seed_001 / req_seed_001),
-- keeps core.profiles tied to auth.users UUIDs, exposes the schemas, and
-- backfills roles from auth.users.raw_app_meta_data.roles.

create extension if not exists pgcrypto;

create schema if not exists core;
create schema if not exists legal;
create schema if not exists procurement;

-- ---------------------------------------------------------------------------
-- Core identity, RBAC, master data, documents, approvals, audit, notifications
-- ---------------------------------------------------------------------------

create table if not exists core.vendors (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text,
  tin text,
  category text,
  accreditation_status text not null default 'draft',
  accreditation_expires_at date,
  owner_module text not null default 'legal',
  created_at timestamptz not null default now(),
  constraint vendors_status_check check (
    accreditation_status in (
      'draft', 'submitted', 'under_review', 'approved',
      'provisional', 'rejected', 'expired', 'renewal_due'
    )
  )
);

create table if not exists core.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  title text,
  kind text not null default 'employee',
  vendor_id uuid references core.vendors(id) on delete set null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint profiles_kind_check check (kind in ('employee', 'vendor'))
);

create table if not exists core.capabilities (
  module text not null,
  cap text not null,
  primary key (module, cap)
);

create table if not exists core.roles (
  module text not null,
  role text not null,
  label text not null,
  primary key (module, role)
);

create table if not exists core.role_capabilities (
  module text not null,
  role text not null,
  cap text not null,
  primary key (module, role, cap),
  foreign key (module, role) references core.roles(module, role) on delete cascade,
  foreign key (module, cap) references core.capabilities(module, cap) on delete cascade
);

create table if not exists core.user_roles (
  user_id uuid not null references core.profiles(id) on delete cascade,
  module text not null,
  role text not null,
  primary key (user_id, module, role),
  foreign key (module, role) references core.roles(module, role) on delete restrict
);

create table if not exists core.documents (
  id text primary key default ('doc_' || replace(gen_random_uuid()::text, '-', '')),
  entity_type text not null,
  entity_id text not null,
  doc_type text not null,
  storage_path text not null,
  version int not null default 1,
  status text not null default 'submitted',
  expires_at date,
  uploaded_by uuid references core.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists core.approvals (
  id bigserial primary key,
  entity_type text not null,
  entity_id text not null,
  step int not null,
  approver_role text not null,
  decision text not null default 'pending',
  decided_by uuid references core.profiles(id) on delete set null,
  decided_at timestamptz,
  note text,
  sla_due_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists core.activity_log (
  id bigserial primary key,
  module text not null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  actor uuid references core.profiles(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists core.notifications (
  id text primary key default ('ntf_' || replace(gen_random_uuid()::text, '-', '')),
  user_id uuid not null references core.profiles(id) on delete cascade,
  kind text not null,
  entity_type text,
  entity_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists profiles_vendor_idx on core.profiles(vendor_id);
create index if not exists user_roles_user_idx on core.user_roles(user_id);
create index if not exists documents_entity_idx on core.documents(entity_type, entity_id);
create index if not exists approvals_entity_idx on core.approvals(entity_type, entity_id);
create index if not exists activity_log_entity_idx on core.activity_log(entity_type, entity_id);
create index if not exists notifications_user_idx on core.notifications(user_id, read_at);

-- ---------------------------------------------------------------------------
-- RBAC helpers
-- ---------------------------------------------------------------------------

create or replace function core.has_cap(p_module text, p_cap text)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
      from core.user_roles ur
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
set search_path = core, public
as $$
  select exists (
    select 1
      from core.user_roles ur
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
set search_path = core, public
as $$
  select exists (
    select 1
      from core.user_roles ur
     where ur.user_id = auth.uid()
       and ur.module = p_module
  );
$$;

create or replace function core.current_vendor_id()
returns uuid
language sql
stable
security definer
set search_path = core, public
as $$
  select vendor_id from core.profiles where id = auth.uid();
$$;

create or replace function core.is_vendor()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select coalesce((select kind = 'vendor' from core.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- Legal workflow tables
-- ---------------------------------------------------------------------------

create table if not exists legal.accreditation_cases (
  id text primary key default ('case_' || replace(gen_random_uuid()::text, '-', '')),
  vendor_id uuid not null references core.vendors(id) on delete cascade,
  vendor_name text not null,
  status text not null default 'draft',
  category text,
  jurisdiction text,
  origin_country text,
  entity_type text,
  vendor_category text,
  risk_tier text,
  contract_type text,
  expected_annual_spend text,
  handles_personal_data boolean,
  contact_email text,
  opened_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by_email text,
  decision_note text,
  expires_at date,
  scope text,
  invited_by_email text,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accreditation_cases_status_check check (
    status in (
      'draft', 'submitted', 'under_review', 'approved',
      'provisional', 'rejected', 'expired', 'renewal_due'
    )
  )
);

create table if not exists legal.requirement_checklist_items (
  id text primary key default ('rq_' || replace(gen_random_uuid()::text, '-', '')),
  case_id text not null references legal.accreditation_cases(id) on delete cascade,
  code text,
  requirement text not null,
  description text,
  why_we_need_it text,
  help_url text,
  authority text,
  evidence_format text,
  requirement_group text,
  required boolean not null default true,
  instrument boolean not null default false,
  instrument_code text,
  template_version text,
  renews_after_months int,
  decision text not null default 'pending',
  reviewer_email text,
  reviewed_at timestamptz,
  reviewer_note text,
  document_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists legal.vendor_invites (
  id text primary key default ('inv_' || replace(gen_random_uuid()::text, '-', '')),
  email text not null,
  company_name text not null,
  category text,
  created_at timestamptz not null default now(),
  created_by_email text,
  accepted_at timestamptz,
  status text not null default 'sent',
  vendor_id uuid references core.vendors(id) on delete set null,
  case_id text references legal.accreditation_cases(id) on delete set null,
  profile jsonb not null default '{}'::jsonb
);

create table if not exists legal.accreditation_docs (
  id text primary key default ('doc_' || replace(gen_random_uuid()::text, '-', '')),
  case_id text not null references legal.accreditation_cases(id) on delete cascade,
  vendor_id uuid not null references core.vendors(id) on delete cascade,
  requirement_id text references legal.requirement_checklist_items(id) on delete set null,
  doc_type text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  storage_path text,
  status text not null default 'submitted',
  version int not null default 1,
  uploaded_at timestamptz not null default now(),
  uploaded_by_email text,
  expires_at date,
  reviewer_note text
);

create table if not exists legal.case_timeline (
  id text primary key default ('tl_' || replace(gen_random_uuid()::text, '-', '')),
  case_id text not null references legal.accreditation_cases(id) on delete cascade,
  at timestamptz not null default now(),
  actor_email text,
  action text not null,
  detail text
);

create table if not exists legal.signed_instruments (
  id text primary key default ('sig_' || replace(gen_random_uuid()::text, '-', '')),
  case_id text not null references legal.accreditation_cases(id) on delete cascade,
  code text not null,
  template_version text not null,
  signer_name text not null,
  signer_email text,
  signer_title text,
  signature_png text,
  signature_method text not null default 'typed',
  signed_at timestamptz not null default now(),
  signer_ua text,
  fields jsonb,
  revoked_at timestamptz,
  revoked_by_email text
);

create index if not exists accreditation_cases_vendor_idx on legal.accreditation_cases(vendor_id);
create index if not exists checklist_case_idx on legal.requirement_checklist_items(case_id);
create unique index if not exists checklist_case_code_idx
  on legal.requirement_checklist_items(case_id, coalesce(code, id));
create index if not exists legal_docs_case_idx on legal.accreditation_docs(case_id);
create index if not exists legal_timeline_case_idx on legal.case_timeline(case_id);
create index if not exists legal_invites_email_idx on legal.vendor_invites(email);

-- ---------------------------------------------------------------------------
-- Procurement workflow tables
-- ---------------------------------------------------------------------------

create table if not exists procurement.requests (
  id text primary key default ('req_' || replace(gen_random_uuid()::text, '-', '')),
  title text not null,
  description text,
  requester_id uuid references core.profiles(id) on delete set null,
  requester_name text,
  requester_email text,
  department text,
  cost_center text,
  project_code text,
  budget_code text,
  needed_by date,
  status text not null default 'draft',
  core_vendor_id uuid references core.vendors(id) on delete set null,
  vendor_name text,
  estimated_amount numeric(14, 2),
  category text,
  sourcing_method text,
  sourcing_override boolean not null default false,
  justification jsonb,
  attachments jsonb not null default '[]'::jsonb,
  compliance jsonb,
  lines jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  decided_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint requests_status_check check (
    status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled')
  )
);

create table if not exists procurement.approval_steps (
  id text primary key default ('step_' || replace(gen_random_uuid()::text, '-', '')),
  request_id text not null references procurement.requests(id) on delete cascade,
  step_order int not null,
  tier text not null,
  status text not null default 'pending',
  label text,
  note text,
  decided_at timestamptz,
  decided_by_email text,
  signature jsonb,
  created_at timestamptz not null default now(),
  unique (request_id, step_order)
);

create table if not exists procurement.purchase_orders (
  id text primary key default ('po_' || replace(gen_random_uuid()::text, '-', '')),
  po_number text not null unique,
  request_id text references procurement.requests(id) on delete set null,
  core_vendor_id uuid references core.vendors(id) on delete restrict,
  vendor_name text not null,
  status text not null default 'draft',
  origin text not null default 'procurement',
  actor_id uuid references core.profiles(id) on delete set null,
  actor_email text,
  expected_date date,
  notes text,
  lines jsonb not null default '[]'::jsonb,
  total numeric(14, 2) not null default 0,
  approved_at timestamptz,
  approved_by_email text,
  approval_signature jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_orders_status_check check (
    status in ('draft', 'pending_approval', 'approved', 'issued', 'closed', 'cancelled')
  )
);

create table if not exists procurement.purchase_order_lines (
  id text primary key default ('pl_' || replace(gen_random_uuid()::text, '-', '')),
  purchase_order_id text not null references procurement.purchase_orders(id) on delete cascade,
  line_no int not null,
  description text not null,
  quantity numeric(14, 4) not null default 1,
  uom text,
  unit_price numeric(14, 2),
  received_quantity numeric(14, 4) not null default 0,
  created_at timestamptz not null default now(),
  unique (purchase_order_id, line_no)
);

create table if not exists procurement.receipts (
  id text primary key default ('rcpt_' || replace(gen_random_uuid()::text, '-', '')),
  purchase_order_id text not null references procurement.purchase_orders(id) on delete cascade,
  received_at timestamptz not null default now(),
  received_by_email text,
  note text,
  lines jsonb not null default '[]'::jsonb,
  closed_po boolean not null default false
);

create index if not exists procurement_requests_requester_idx on procurement.requests(requester_id);
create index if not exists procurement_requests_status_idx on procurement.requests(status);
create index if not exists procurement_approval_steps_request_idx on procurement.approval_steps(request_id);
create index if not exists procurement_po_request_idx on procurement.purchase_orders(request_id);
create index if not exists procurement_receipts_po_idx on procurement.receipts(purchase_order_id);

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table core.vendors enable row level security;
alter table core.profiles enable row level security;
alter table core.capabilities enable row level security;
alter table core.roles enable row level security;
alter table core.role_capabilities enable row level security;
alter table core.user_roles enable row level security;
alter table core.documents enable row level security;
alter table core.approvals enable row level security;
alter table core.activity_log enable row level security;
alter table core.notifications enable row level security;

alter table legal.accreditation_cases enable row level security;
alter table legal.requirement_checklist_items enable row level security;
alter table legal.vendor_invites enable row level security;
alter table legal.accreditation_docs enable row level security;
alter table legal.case_timeline enable row level security;
alter table legal.signed_instruments enable row level security;

alter table procurement.requests enable row level security;
alter table procurement.approval_steps enable row level security;
alter table procurement.purchase_orders enable row level security;
alter table procurement.purchase_order_lines enable row level security;
alter table procurement.receipts enable row level security;

grant usage on schema core, legal, procurement, warehouse to anon, authenticated, service_role;
grant select on all tables in schema core to anon, authenticated;
grant select on all tables in schema legal to anon, authenticated;
grant select on all tables in schema procurement to anon, authenticated;
grant select on all tables in schema warehouse to anon;
grant all on all tables in schema core to service_role;
grant all on all tables in schema legal to service_role;
grant all on all tables in schema procurement to service_role;
grant usage, select on all sequences in schema core, legal, procurement to authenticated, service_role;
grant usage, select on all sequences in schema core, legal, procurement to anon;

revoke insert, update, delete on all tables in schema core from anon, authenticated;
revoke insert, update, delete on all tables in schema legal from anon, authenticated;
revoke insert, update, delete on all tables in schema procurement from anon, authenticated;

-- Core policies
drop policy if exists core_profiles_read on core.profiles;
create policy core_profiles_read on core.profiles
  for select to authenticated
  using (id = auth.uid() or core.has_any_cap('view_directory') or core.has_any_cap('manage_rbac'));

drop policy if exists core_user_roles_read on core.user_roles;
create policy core_user_roles_read on core.user_roles
  for select to authenticated
  using (user_id = auth.uid() or core.has_any_cap('manage_rbac'));

drop policy if exists core_catalog_read_caps on core.capabilities;
create policy core_catalog_read_caps on core.capabilities
  for select to authenticated
  using (core.has_any_cap('manage_rbac'));

drop policy if exists core_catalog_read_roles on core.roles;
create policy core_catalog_read_roles on core.roles
  for select to authenticated
  using (core.has_any_cap('manage_rbac'));

drop policy if exists core_catalog_read_role_caps on core.role_capabilities;
create policy core_catalog_read_role_caps on core.role_capabilities
  for select to authenticated
  using (core.has_any_cap('manage_rbac'));

drop policy if exists core_vendors_read on core.vendors;
create policy core_vendors_read on core.vendors
  for select to authenticated
  using (
    core.has_any_cap('view_vendors')
    or (core.is_vendor() and id = core.current_vendor_id())
  );

drop policy if exists core_documents_read on core.documents;
create policy core_documents_read on core.documents
  for select to authenticated
  using (
    core.has_any_cap('view_documents')
    or (
      core.is_vendor()
      and entity_type = 'vendor'
      and entity_id = core.current_vendor_id()::text
    )
  );

drop policy if exists core_approvals_read on core.approvals;
create policy core_approvals_read on core.approvals
  for select to authenticated
  using (core.has_any_cap('view_approvals'));

drop policy if exists core_activity_read on core.activity_log;
create policy core_activity_read on core.activity_log
  for select to authenticated
  using (core.has_any_cap('view_audit') or actor = auth.uid());

drop policy if exists core_notifications_read on core.notifications;
create policy core_notifications_read on core.notifications
  for select to authenticated
  using (user_id = auth.uid());

-- Legal policies
drop policy if exists legal_cases_read on legal.accreditation_cases;
create policy legal_cases_read on legal.accreditation_cases
  for select to authenticated
  using (
    core.has_cap('legal', 'view_dashboard')
    or (core.is_vendor() and vendor_id = core.current_vendor_id())
  );

drop policy if exists legal_checklist_read on legal.requirement_checklist_items;
create policy legal_checklist_read on legal.requirement_checklist_items
  for select to authenticated
  using (
    exists (
      select 1 from legal.accreditation_cases c
      where c.id = case_id
        and (
          core.has_cap('legal', 'view_dashboard')
          or (core.is_vendor() and c.vendor_id = core.current_vendor_id())
        )
    )
  );

drop policy if exists legal_invites_read on legal.vendor_invites;
create policy legal_invites_read on legal.vendor_invites
  for select to authenticated
  using (core.has_cap('legal', 'manage_checklist') or email = (auth.jwt() ->> 'email'));

drop policy if exists legal_docs_read on legal.accreditation_docs;
create policy legal_docs_read on legal.accreditation_docs
  for select to authenticated
  using (
    core.has_cap('legal', 'view_dashboard')
    or (core.is_vendor() and vendor_id = core.current_vendor_id())
  );

drop policy if exists legal_timeline_read on legal.case_timeline;
create policy legal_timeline_read on legal.case_timeline
  for select to authenticated
  using (
    exists (
      select 1 from legal.accreditation_cases c
      where c.id = case_id
        and (
          core.has_cap('legal', 'view_dashboard')
          or (core.is_vendor() and c.vendor_id = core.current_vendor_id())
        )
    )
  );

drop policy if exists legal_signed_read on legal.signed_instruments;
create policy legal_signed_read on legal.signed_instruments
  for select to authenticated
  using (
    exists (
      select 1 from legal.accreditation_cases c
      where c.id = case_id
        and (
          core.has_cap('legal', 'view_dashboard')
          or (core.is_vendor() and c.vendor_id = core.current_vendor_id())
        )
    )
  );

-- Procurement policies
drop policy if exists procurement_requests_read on procurement.requests;
create policy procurement_requests_read on procurement.requests
  for select to authenticated
  using (
    requester_id = auth.uid()
    or core.has_cap('procurement', 'view_dashboard')
    or core.has_module_role('legal')
  );

drop policy if exists procurement_steps_read on procurement.approval_steps;
create policy procurement_steps_read on procurement.approval_steps
  for select to authenticated
  using (
    exists (
      select 1 from procurement.requests r
      where r.id = request_id
        and (
          r.requester_id = auth.uid()
          or core.has_cap('procurement', 'view_dashboard')
          or core.has_module_role('legal')
        )
    )
  );

drop policy if exists procurement_pos_read on procurement.purchase_orders;
create policy procurement_pos_read on procurement.purchase_orders
  for select to authenticated
  using (
    core.has_cap('procurement', 'author_po')
    or core.has_cap('procurement', 'approve_award')
    or core.has_cap('procurement', 'view_finance')
    or core.has_cap('procurement', 'admin')
  );

drop policy if exists procurement_po_lines_read on procurement.purchase_order_lines;
create policy procurement_po_lines_read on procurement.purchase_order_lines
  for select to authenticated
  using (
    exists (
      select 1 from procurement.purchase_orders po
      where po.id = purchase_order_id
        and (
          core.has_cap('procurement', 'author_po')
          or core.has_cap('procurement', 'approve_award')
          or core.has_cap('procurement', 'view_finance')
          or core.has_cap('procurement', 'admin')
        )
    )
  );

drop policy if exists procurement_receipts_read on procurement.receipts;
create policy procurement_receipts_read on procurement.receipts
  for select to authenticated
  using (
    exists (
      select 1 from procurement.purchase_orders po
      where po.id = purchase_order_id
        and (
          core.has_cap('procurement', 'author_po')
          or core.has_cap('procurement', 'approve_award')
          or core.has_cap('procurement', 'view_finance')
          or core.has_cap('procurement', 'admin')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- RPC write paths
-- ---------------------------------------------------------------------------

create or replace function core.upsert_profile(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = core, public
as $$
declare v core.profiles;
begin
  if not core.has_any_cap('manage_rbac') then
    raise exception 'Not authorized: manage_rbac';
  end if;
  insert into core.profiles (id, email, full_name, title, kind, vendor_id, status)
  values (
    (payload->>'id')::uuid,
    payload->>'email',
    nullif(payload->>'full_name', ''),
    nullif(payload->>'title', ''),
    coalesce(nullif(payload->>'kind', ''), 'employee'),
    case
      when nullif(payload->>'vendor_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (payload->>'vendor_id')::uuid
      else null
    end,
    coalesce(nullif(payload->>'status', ''), 'active')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    title = excluded.title,
    kind = excluded.kind,
    vendor_id = excluded.vendor_id,
    status = excluded.status
  returning * into v;
  return to_jsonb(v);
end;
$$;

create or replace function core.assign_user_role(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = core, public
as $$
declare v core.user_roles;
begin
  if not core.has_any_cap('manage_rbac') then
    raise exception 'Not authorized: manage_rbac';
  end if;
  insert into core.user_roles (user_id, module, role)
  values ((payload->>'user_id')::uuid, payload->>'module', payload->>'role')
  on conflict do nothing
  returning * into v;
  if v.user_id is null then
    select * into v from core.user_roles
    where user_id = (payload->>'user_id')::uuid
      and module = payload->>'module'
      and role = payload->>'role';
  end if;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('core', 'user_role', payload->>'user_id', 'assigned', auth.uid(), payload);
  return to_jsonb(v);
end;
$$;

create or replace function core.revoke_user_role(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = core, public
as $$
begin
  if not core.has_any_cap('manage_rbac') then
    raise exception 'Not authorized: manage_rbac';
  end if;
  delete from core.user_roles
  where user_id = (payload->>'user_id')::uuid
    and module = payload->>'module'
    and role = payload->>'role';
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('core', 'user_role', payload->>'user_id', 'revoked', auth.uid(), payload);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function core.mark_notification_read(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = core, public
as $$
declare v core.notifications;
begin
  update core.notifications
     set read_at = coalesce(read_at, now())
   where id = payload->>'notification_id'
     and user_id = auth.uid()
   returning * into v;
  if v.id is null then
    raise exception 'Notification not found';
  end if;
  return to_jsonb(v);
end;
$$;

create or replace function legal.create_accreditation_case(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = legal, core, public
as $$
declare v legal.accreditation_cases;
begin
  if core.is_vendor() then
    if not core.has_any_cap('submit_accreditation') then
      raise exception 'Not authorized: submit_accreditation';
    end if;
    if (payload->>'vendor_id')::uuid is distinct from core.current_vendor_id() then
      raise exception 'Vendors may only create cases for their own vendor record';
    end if;
  elsif not core.has_cap('legal', 'manage_checklist') then
    raise exception 'Not authorized: legal.manage_checklist';
  end if;

  insert into legal.accreditation_cases (
    id, vendor_id, vendor_name, status, category, jurisdiction, origin_country,
    entity_type, vendor_category, risk_tier, contract_type, expected_annual_spend,
    handles_personal_data, contact_email, invited_by_email
  )
  values (
    coalesce(nullif(payload->>'id', ''), 'case_' || replace(gen_random_uuid()::text, '-', '')),
    (payload->>'vendor_id')::uuid,
    payload->>'vendor_name',
    coalesce(nullif(payload->>'status', ''), 'draft'),
    nullif(payload->>'category', ''),
    nullif(payload->>'jurisdiction', ''),
    nullif(payload->>'origin_country', ''),
    nullif(payload->>'entity_type', ''),
    nullif(payload->>'vendor_category', ''),
    nullif(payload->>'risk_tier', ''),
    nullif(payload->>'contract_type', ''),
    nullif(payload->>'expected_annual_spend', ''),
    nullif(payload->>'handles_personal_data', '')::boolean,
    nullif(payload->>'contact_email', ''),
    nullif(payload->>'actor', '')
  )
  returning * into v;

  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (v.id, payload->>'actor', 'created', 'Case opened for ' || v.vendor_name);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'accreditation_case', v.id, 'created', auth.uid(), to_jsonb(v));
  return to_jsonb(v);
end;
$$;

create or replace function legal.submit_accreditation_case(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = legal, core, public
as $$
declare v legal.accreditation_cases;
begin
  if not core.has_any_cap('submit_accreditation') then
    raise exception 'Not authorized: submit_accreditation';
  end if;
  update legal.accreditation_cases
     set status = 'submitted',
         submitted_at = now(),
         updated_at = now()
   where id = payload->>'id'
     and vendor_id = core.current_vendor_id()
   returning * into v;
  if v.id is null then raise exception 'Accreditation case not found'; end if;
  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (v.id, auth.jwt() ->> 'email', 'submitted', 'Vendor submitted the intake for legal review.');
  return to_jsonb(v);
end;
$$;

create or replace function legal.review_checklist_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = legal, core, public
as $$
declare v legal.requirement_checklist_items;
begin
  if not core.has_cap('legal', 'review_accreditation') then
    raise exception 'Not authorized: legal.review_accreditation';
  end if;
  update legal.requirement_checklist_items
     set decision = payload->>'decision',
         reviewer_email = coalesce(payload->>'reviewer_email', auth.jwt() ->> 'email'),
         reviewer_note = nullif(payload->>'reviewer_note', ''),
         reviewed_at = now(),
         updated_at = now()
   where id = payload->>'id'
   returning * into v;
  if v.id is null then raise exception 'Checklist item not found'; end if;
  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (v.case_id, coalesce(payload->>'reviewer_email', auth.jwt() ->> 'email'), 'checklist_decided', v.requirement || ' -> ' || v.decision);
  return to_jsonb(v);
end;
$$;

create or replace function legal.approve_accreditation_case(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = legal, core, public
as $$
declare v legal.accreditation_cases; v_status text;
begin
  if not core.has_cap('legal', 'approve_accreditation') then
    raise exception 'Not authorized: legal.approve_accreditation';
  end if;
  v_status := coalesce(nullif(payload->>'status', ''), 'approved');
  update legal.accreditation_cases
     set status = v_status,
         decided_at = now(),
         decided_by_email = coalesce(payload->>'actor', auth.jwt() ->> 'email'),
         decision_note = nullif(payload->>'note', ''),
         expires_at = nullif(payload->>'expires_at', '')::date,
         scope = nullif(payload->>'scope', ''),
         updated_at = now()
   where id = payload->>'id'
   returning * into v;
  if v.id is null then raise exception 'Accreditation case not found'; end if;
  update core.vendors
     set accreditation_status = v.status,
         accreditation_expires_at = v.expires_at
   where id = v.vendor_id;
  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (v.id, v.decided_by_email, v.status, coalesce(v.decision_note, 'Decision recorded'));
  return to_jsonb(v);
end;
$$;

create or replace function legal.invite_vendor(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = legal, core, public
as $$
declare v_vendor core.vendors; v_inv legal.vendor_invites; v_case legal.accreditation_cases;
begin
  if not core.has_cap('legal', 'manage_checklist') then
    raise exception 'Not authorized: legal.manage_checklist';
  end if;
  insert into core.vendors (legal_name, category, accreditation_status, owner_module)
  values (payload->>'company_name', nullif(payload->>'category', ''), 'draft', 'legal')
  returning * into v_vendor;
  insert into legal.accreditation_cases (
    vendor_id, vendor_name, category, jurisdiction, origin_country, entity_type,
    vendor_category, risk_tier, contract_type, expected_annual_spend,
    handles_personal_data, contact_email, invited_by_email
  )
  values (
    v_vendor.id,
    v_vendor.legal_name,
    nullif(payload->>'category', ''),
    payload#>>'{profile,jurisdiction}',
    nullif(payload->>'origin_country', ''),
    payload#>>'{profile,entityType}',
    payload#>>'{profile,category}',
    payload#>>'{profile,riskTier}',
    payload#>>'{profile,contractType}',
    payload#>>'{profile,spendBand}',
    nullif(payload#>>'{profile,handlesPersonalData}', '')::boolean,
    payload->>'email',
    coalesce(payload->>'actor', auth.jwt() ->> 'email')
  )
  returning * into v_case;
  insert into legal.vendor_invites (
    email, company_name, category, created_by_email, vendor_id, case_id, profile
  )
  values (
    payload->>'email',
    payload->>'company_name',
    nullif(payload->>'category', ''),
    coalesce(payload->>'actor', auth.jwt() ->> 'email'),
    v_vendor.id,
    v_case.id,
    coalesce(payload->'profile', '{}'::jsonb)
  )
  returning * into v_inv;
  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (v_case.id, v_inv.created_by_email, 'created', 'Case opened for ' || v_case.vendor_name);
  return jsonb_build_object('invite', to_jsonb(v_inv), 'case', to_jsonb(v_case), 'vendor', to_jsonb(v_vendor));
end;
$$;

create or replace function procurement.create_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = procurement, core, public
as $$
declare v procurement.requests;
begin
  if not core.has_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.create_request';
  end if;
  insert into procurement.requests (
    title, description, requester_id, requester_name, requester_email,
    department, cost_center, project_code, budget_code, needed_by,
    core_vendor_id, vendor_name, estimated_amount, category, sourcing_method,
    sourcing_override, justification, attachments, compliance, lines
  )
  values (
    payload->>'title',
    nullif(payload->>'description', ''),
    auth.uid(),
    nullif(payload->>'requester_name', ''),
    coalesce(nullif(payload->>'requester_email', ''), auth.jwt() ->> 'email'),
    nullif(payload->>'department', ''),
    nullif(payload->>'cost_center', ''),
    nullif(payload->>'project_code', ''),
    nullif(payload->>'budget_code', ''),
    nullif(payload->>'needed_by', '')::date,
    nullif(payload->>'vendor_id', '')::uuid,
    nullif(payload->>'vendor_name', ''),
    nullif(payload->>'estimated_amount', '')::numeric,
    nullif(payload->>'category', ''),
    nullif(payload->>'sourcing_method', ''),
    case
      when nullif(payload->>'sourcing_override', '') is null then false
      else (payload->>'sourcing_override')::boolean
    end,
    payload->'justification',
    coalesce(payload->'attachments', '[]'::jsonb),
    payload->'compliance',
    coalesce(payload->'lines', '[]'::jsonb)
  )
  returning * into v;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v.id, 'created', auth.uid(), to_jsonb(v));
  return to_jsonb(v);
end;
$$;

create or replace function procurement.submit_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = procurement, core, public
as $$
declare v procurement.requests; v_tiers text[];
begin
  update procurement.requests
     set status = 'submitted',
         submitted_at = now(),
         updated_at = now()
   where id = payload->>'id'
     and (requester_id = auth.uid() or core.has_cap('procurement', 'admin'))
     and status = 'draft'
   returning * into v;
  if v.id is null then raise exception 'Request not found or not submittable'; end if;
  v_tiers := array['dept_head','procurement_head'];
  if coalesce(v.estimated_amount, 0) >= 100000 then v_tiers := v_tiers || 'finance'; end if;
  if v.category in ('construction','manpower','it_software','medical') then v_tiers := v_tiers || 'legal'; end if;
  if coalesce(v.estimated_amount, 0) >= 1000000 then v_tiers := v_tiers || 'final_approver'; end if;
  delete from procurement.approval_steps where request_id = v.id;
  insert into procurement.approval_steps (request_id, step_order, tier, label)
  select v.id, ord, tier, replace(initcap(replace(tier, '_', ' ')), 'Dept', 'Department')
  from unnest(v_tiers) with ordinality as t(tier, ord);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v.id, 'submitted', auth.uid(), '{}'::jsonb);
  return to_jsonb(v);
end;
$$;

create or replace function procurement.decide_request_step(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = procurement, core, public
as $$
declare v_step procurement.approval_steps; v_req procurement.requests; v_decision text;
begin
  if not (
    core.has_cap('procurement', 'approve_request')
    or core.has_module_role('legal')
  ) then
    raise exception 'Not authorized: procurement.approve_request';
  end if;
  v_decision := payload->>'decision';
  update procurement.approval_steps
     set status = v_decision,
         note = nullif(payload->>'note', ''),
         decided_at = now(),
         decided_by_email = coalesce(payload->>'decided_by_email', auth.jwt() ->> 'email'),
         signature = payload->'signature'
   where id = payload->>'step_id'
     and status = 'pending'
   returning * into v_step;
  if v_step.id is null then raise exception 'Approval step not found or already decided'; end if;

  select * into v_req from procurement.requests where id = v_step.request_id for update;
  if v_decision = 'rejected' then
    update procurement.requests
       set status = 'rejected',
           decided_at = now(),
           decided_by_email = v_step.decided_by_email,
           decision_note = v_step.note,
           updated_at = now()
     where id = v_req.id
     returning * into v_req;
  elsif not exists (
    select 1 from procurement.approval_steps
    where request_id = v_req.id and status = 'pending'
  ) then
    update procurement.requests
       set status = 'approved',
           decided_at = now(),
           decided_by_email = v_step.decided_by_email,
           decision_note = v_step.note,
           updated_at = now()
     where id = v_req.id
     returning * into v_req;
  else
    update procurement.requests
       set status = 'under_review',
           updated_at = now()
     where id = v_req.id
     returning * into v_req;
  end if;
  return to_jsonb(v_req);
end;
$$;

create or replace function procurement.create_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = procurement, core, public
as $$
declare v procurement.purchase_orders; v_line jsonb; v_idx int := 0; v_po text;
begin
  if not core.has_cap('procurement', 'author_po') then
    raise exception 'Not authorized: procurement.author_po';
  end if;
  select coalesce(
           nullif(payload->>'po_number', ''),
           'PO-' || to_char(now(), 'YYYY') || '-' ||
             lpad((count(*) + 1)::text, 4, '0')
         )
    into v_po
    from procurement.purchase_orders;
  insert into procurement.purchase_orders (
    po_number, request_id, core_vendor_id, vendor_name, actor_id, actor_email,
    expected_date, notes, lines, total
  )
  values (
    v_po,
    nullif(payload->>'request_id', ''),
    (payload->>'vendor_id')::uuid,
    payload->>'vendor_name',
    auth.uid(),
    coalesce(payload->>'actor_email', auth.jwt() ->> 'email'),
    nullif(payload->>'expected_date', '')::date,
    nullif(payload->>'notes', ''),
    coalesce(payload->'lines', '[]'::jsonb),
    coalesce(nullif(payload->>'total', '')::numeric, 0)
  )
  returning * into v;
  for v_line in select * from jsonb_array_elements(coalesce(payload->'lines', '[]'::jsonb)) loop
    v_idx := v_idx + 1;
    insert into procurement.purchase_order_lines (
      purchase_order_id, line_no, description, quantity, uom, unit_price, received_quantity
    )
    values (
      v.id,
      v_idx,
      v_line->>'description',
      coalesce(nullif(v_line->>'quantity', '')::numeric, 1),
      nullif(v_line->>'uom', ''),
      nullif(v_line->>'unitPrice', '')::numeric,
      coalesce(nullif(v_line->>'receivedQuantity', '')::numeric, 0)
    );
  end loop;
  return to_jsonb(v);
end;
$$;

create or replace function procurement.approve_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = procurement, core, public
as $$
declare v procurement.purchase_orders;
begin
  if not core.has_cap('procurement', 'approve_award') then
    raise exception 'Not authorized: procurement.approve_award';
  end if;
  update procurement.purchase_orders
     set status = 'approved',
         approved_at = now(),
         approved_by_email = coalesce(payload->>'actor_email', auth.jwt() ->> 'email'),
         approval_signature = payload->'signature',
         updated_at = now()
   where id = payload->>'id'
   returning * into v;
  if v.id is null then raise exception 'Purchase order not found'; end if;
  return to_jsonb(v);
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'has_cap(text,text)', 'has_any_cap(text)', 'has_module_role(text)',
    'current_vendor_id()', 'is_vendor()'
  ]
  loop
    execute format('revoke all on function core.%s from public, anon;', fn);
    execute format('grant execute on function core.%s to authenticated, service_role;', fn);
  end loop;

  foreach fn in array array[
    'upsert_profile(jsonb)', 'assign_user_role(jsonb)', 'revoke_user_role(jsonb)',
    'mark_notification_read(jsonb)'
  ]
  loop
    execute format('revoke all on function core.%s from public, anon;', fn);
    execute format('grant execute on function core.%s to authenticated, service_role;', fn);
  end loop;

  foreach fn in array array[
    'create_accreditation_case(jsonb)', 'submit_accreditation_case(jsonb)',
    'review_checklist_item(jsonb)', 'approve_accreditation_case(jsonb)',
    'invite_vendor(jsonb)'
  ]
  loop
    execute format('revoke all on function legal.%s from public, anon;', fn);
    execute format('grant execute on function legal.%s to authenticated, service_role;', fn);
  end loop;

  foreach fn in array array[
    'create_request(jsonb)', 'submit_request(jsonb)', 'decide_request_step(jsonb)',
    'create_purchase_order(jsonb)', 'approve_purchase_order(jsonb)'
  ]
  loop
    execute format('revoke all on function procurement.%s from public, anon;', fn);
    execute format('grant execute on function procurement.%s to authenticated, service_role;', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Seed RBAC catalogue from the current @intra/rbac matrix.
-- ---------------------------------------------------------------------------

insert into core.capabilities(module, cap) values
  ('core','view_directory'), ('core','manage_rbac'), ('core','view_vendors'),
  ('core','manage_vendors'), ('core','manage_accreditation'),
  ('core','view_documents'), ('core','manage_documents'),
  ('core','submit_documents'), ('core','submit_accreditation'),
  ('core','view_own_accreditation'), ('core','view_approvals'),
  ('core','manage_approvals'), ('core','record_approval'),
  ('core','view_audit'), ('core','manage_notifications'),
  ('warehouse','view_dashboard'), ('warehouse','receive_stock'),
  ('warehouse','manage_inventory'), ('warehouse','manage_products'),
  ('warehouse','manage_locations'), ('warehouse','cycle_count'),
  ('warehouse','manage_returns'), ('warehouse','reserve_allocate'),
  ('warehouse','issue_items'), ('warehouse','transfer_stock'),
  ('warehouse','view_finance'), ('warehouse','view_analytics'),
  ('warehouse','view_procurement'), ('warehouse','view_pricing'),
  ('warehouse','set_pricing'),
  ('procurement','view_dashboard'), ('procurement','create_request'),
  ('procurement','manage_rfp'), ('procurement','author_po'),
  ('procurement','approve_request'), ('procurement','approve_award'),
  ('procurement','manage_vendors'), ('procurement','view_finance'),
  ('procurement','admin'),
  ('legal','view_dashboard'), ('legal','review_accreditation'),
  ('legal','manage_checklist'), ('legal','approve_accreditation'),
  ('legal','manage_documents'), ('legal','admin')
on conflict do nothing;

insert into core.roles(module, role, label) values
  ('core','platform_admin','Platform Administrator'),
  ('core','staff','Internal Staff'),
  ('core','vendor_portal','Vendor Portal User'),
  ('warehouse','logistics_supervisor','Logistics Supervisor'),
  ('warehouse','operations','Operations'),
  ('warehouse','finance','Finance'),
  ('warehouse','bi_analyst','BI Analyst'),
  ('warehouse','business_unit','Business Unit'),
  ('warehouse','marketing','Marketing'),
  ('warehouse','procurement','Procurement'),
  ('warehouse','pricing','Pricing'),
  ('procurement','requester','Requester'),
  ('procurement','procurement_officer','Procurement Officer'),
  ('procurement','approver','Approver'),
  ('procurement','finance','Finance'),
  ('procurement','admin','Procurement Admin'),
  ('legal','legal_reviewer','Legal Reviewer'),
  ('legal','compliance','Compliance'),
  ('legal','admin','Legal Admin')
on conflict do update set label = excluded.label;

insert into core.role_capabilities(module, role, cap) values
  ('core','platform_admin','view_directory'), ('core','platform_admin','manage_rbac'),
  ('core','platform_admin','view_vendors'), ('core','platform_admin','manage_vendors'),
  ('core','platform_admin','manage_accreditation'), ('core','platform_admin','view_documents'),
  ('core','platform_admin','manage_documents'), ('core','platform_admin','view_approvals'),
  ('core','platform_admin','manage_approvals'), ('core','platform_admin','record_approval'),
  ('core','platform_admin','view_audit'), ('core','platform_admin','manage_notifications'),
  ('core','staff','view_directory'), ('core','staff','view_vendors'),
  ('core','staff','view_documents'), ('core','staff','view_approvals'),
  ('core','vendor_portal','submit_documents'), ('core','vendor_portal','submit_accreditation'),
  ('core','vendor_portal','view_own_accreditation'),
  ('warehouse','logistics_supervisor','view_dashboard'), ('warehouse','logistics_supervisor','manage_inventory'),
  ('warehouse','logistics_supervisor','receive_stock'), ('warehouse','logistics_supervisor','manage_products'),
  ('warehouse','logistics_supervisor','manage_locations'), ('warehouse','logistics_supervisor','cycle_count'),
  ('warehouse','logistics_supervisor','manage_returns'), ('warehouse','logistics_supervisor','issue_items'),
  ('warehouse','logistics_supervisor','transfer_stock'),
  ('warehouse','operations','view_dashboard'), ('warehouse','operations','manage_inventory'),
  ('warehouse','operations','reserve_allocate'), ('warehouse','operations','issue_items'),
  ('warehouse','operations','manage_returns'), ('warehouse','operations','transfer_stock'),
  ('warehouse','finance','view_dashboard'), ('warehouse','finance','manage_inventory'),
  ('warehouse','finance','view_finance'), ('warehouse','finance','cycle_count'),
  ('warehouse','bi_analyst','view_dashboard'), ('warehouse','bi_analyst','manage_inventory'),
  ('warehouse','bi_analyst','view_analytics'),
  ('warehouse','business_unit','view_dashboard'), ('warehouse','business_unit','manage_inventory'),
  ('warehouse','business_unit','reserve_allocate'),
  ('warehouse','marketing','view_dashboard'), ('warehouse','marketing','manage_inventory'),
  ('warehouse','marketing','reserve_allocate'), ('warehouse','marketing','manage_returns'),
  ('warehouse','procurement','view_dashboard'), ('warehouse','procurement','manage_inventory'),
  ('warehouse','procurement','view_procurement'), ('warehouse','procurement','manage_products'),
  ('warehouse','pricing','view_dashboard'), ('warehouse','pricing','manage_inventory'),
  ('warehouse','pricing','view_pricing'), ('warehouse','pricing','set_pricing'),
  ('warehouse','pricing','view_finance'),
  ('procurement','requester','view_dashboard'), ('procurement','requester','create_request'),
  ('procurement','procurement_officer','view_dashboard'), ('procurement','procurement_officer','create_request'),
  ('procurement','procurement_officer','manage_rfp'), ('procurement','procurement_officer','author_po'),
  ('procurement','procurement_officer','manage_vendors'), ('procurement','procurement_officer','approve_request'),
  ('procurement','approver','view_dashboard'), ('procurement','approver','approve_request'),
  ('procurement','approver','approve_award'), ('procurement','finance','view_dashboard'),
  ('procurement','finance','view_finance'), ('procurement','finance','approve_request'),
  ('procurement','admin','view_dashboard'), ('procurement','admin','create_request'),
  ('procurement','admin','manage_rfp'), ('procurement','admin','author_po'),
  ('procurement','admin','approve_request'), ('procurement','admin','approve_award'),
  ('procurement','admin','manage_vendors'), ('procurement','admin','view_finance'),
  ('procurement','admin','admin'),
  ('legal','legal_reviewer','view_dashboard'), ('legal','legal_reviewer','review_accreditation'),
  ('legal','legal_reviewer','manage_checklist'), ('legal','legal_reviewer','approve_accreditation'),
  ('legal','legal_reviewer','manage_documents'),
  ('legal','compliance','view_dashboard'), ('legal','compliance','review_accreditation'),
  ('legal','compliance','approve_accreditation'), ('legal','compliance','manage_documents'),
  ('legal','admin','view_dashboard'), ('legal','admin','review_accreditation'),
  ('legal','admin','manage_checklist'), ('legal','admin','approve_accreditation'),
  ('legal','admin','manage_documents'), ('legal','admin','admin')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Backfill demo/live users and seed stable records used by E2E.
-- ---------------------------------------------------------------------------

insert into core.vendors (
  id, legal_name, trade_name, category, accreditation_status,
  accreditation_expires_at, owner_module
) values
  ('00000000-0000-4000-8000-000000000001', 'Acme Medical Supplies, Inc.', 'Acme Medical', 'Medical devices', 'approved', '2027-01-31', 'legal'),
  ('00000000-0000-4000-8000-000000000002', 'North Star Logistics Corp.', null, 'Freight & logistics', 'approved', '2026-11-15', 'legal'),
  ('00000000-0000-4000-8000-000000000003', 'BrightPath Print & Signage', null, 'Marketing collateral', 'renewal_due', '2026-08-01', 'legal'),
  ('00000000-0000-4000-8000-000000000004', 'MediConsult Advisory Partners', null, 'Consulting', 'submitted', null, 'legal')
on conflict (id) do update set
  legal_name = excluded.legal_name,
  category = excluded.category,
  accreditation_status = excluded.accreditation_status,
  accreditation_expires_at = excluded.accreditation_expires_at;

update auth.users
   set raw_app_meta_data =
     jsonb_set(
       coalesce(raw_app_meta_data, '{}'::jsonb),
       '{vendor_id}',
       to_jsonb('00000000-0000-4000-8000-000000000001'::text),
       true
     )
 where email = 'intra.test.vendor@mwell.com.ph';

insert into core.profiles (id, email, full_name, kind, vendor_id, status)
select
  u.id,
  u.email,
  initcap(replace(split_part(u.email, '@', 1), '.', ' ')),
  coalesce(u.raw_app_meta_data->>'kind', 'employee'),
  case
    when nullif(u.raw_app_meta_data->>'vendor_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (u.raw_app_meta_data->>'vendor_id')::uuid
    else null
  end,
  'active'
from auth.users u
where u.email is not null
on conflict (id) do update set
  email = excluded.email,
  full_name = coalesce(core.profiles.full_name, excluded.full_name),
  kind = excluded.kind,
  vendor_id = excluded.vendor_id,
  status = excluded.status;

insert into core.user_roles (user_id, module, role)
select
  u.id,
  module_key,
  role_value
from auth.users u
cross join lateral jsonb_each(coalesce(u.raw_app_meta_data->'roles', '{}'::jsonb)) as module_roles(module_key, roles_json)
cross join lateral jsonb_array_elements_text(roles_json) as role_value
join core.roles r on r.module = module_key and r.role = role_value
on conflict do nothing;

-- Users with no explicit roles remain visible as staff until Admin assigns a
-- scoped role.
insert into core.user_roles (user_id, module, role)
select p.id, 'core', 'staff'
from core.profiles p
where p.kind = 'employee'
on conflict do nothing;

insert into legal.accreditation_cases (
  id, vendor_id, vendor_name, status, category, jurisdiction, entity_type,
  vendor_category, risk_tier, contract_type, expected_annual_spend,
  handles_personal_data, contact_email, opened_at, submitted_at, expires_at,
  invited_by_email
) values (
  'case_seed_001',
  '00000000-0000-4000-8000-000000000001',
  'Acme Medical Supplies, Inc.',
  'submitted',
  'Medical devices',
  'PH',
  'corporation',
  'medical_pharma',
  'high',
  'master_supply',
  '1m_10m',
  true,
  'intra.test.vendor@mwell.com.ph',
  now() - interval '25 days',
  now() - interval '21 days',
  '2027-01-31',
  'intra.test.legal.reviewer@mwell.com.ph'
) on conflict (id) do nothing;

insert into legal.requirement_checklist_items (
  id, case_id, code, requirement, description, why_we_need_it,
  authority, evidence_format, requirement_group, required, decision,
  document_ids
) values
  ('rq_seed_001', 'case_seed_001', 'PH_SEC_REG', 'SEC Registration', 'Latest SEC certificate of registration.', 'Confirms legal existence and registration.', 'SEC', 'pdf', 'statutory', true, 'approved', '{}'),
  ('rq_seed_002', 'case_seed_001', 'PH_BIR_2303', 'BIR Form 2303', 'Certificate of registration.', 'Confirms tax registration.', 'BIR', 'pdf', 'tax', true, 'approved', '{}'),
  ('rq_seed_003', 'case_seed_001', 'PH_MAYORS_PERMIT', 'Mayor''s / Business Permit', 'Current-year LGU permit.', 'Confirms operating authority.', 'LGU', 'pdf', 'statutory', true, 'submitted', '{}'),
  ('rq_seed_004', 'case_seed_001', 'PH_FDA_LTO', 'FDA License to Operate', 'Required for medical/pharma suppliers.', 'Confirms sector regulatory authorization.', 'FDA', 'pdf', 'regulatory', true, 'pending', '{}'),
  ('rq_seed_005', 'case_seed_001', 'SIGN_NDA', 'Mutual NDA', 'Sign the latest mWell confidentiality instrument.', 'Protects confidential health and business information.', 'mWell Legal', 'signed', 'legal_instruments', true, 'pending', '{}')
on conflict (id) do nothing;

insert into legal.case_timeline(case_id, actor_email, action, detail) values
  ('case_seed_001', 'intra.test.legal.reviewer@mwell.com.ph', 'created', 'Case opened for Acme Medical Supplies, Inc.'),
  ('case_seed_001', 'intra.test.vendor@mwell.com.ph', 'submitted', 'Vendor submitted the intake for legal review.')
on conflict do nothing;

insert into procurement.requests (
  id, title, description, requester_id, requester_name, requester_email,
  department, cost_center, needed_by, status, core_vendor_id, vendor_name,
  estimated_amount, category, sourcing_method, justification, compliance, lines,
  submitted_at, created_at
)
select
  'req_seed_001',
  'Emergency aircon repair - server room',
  'Repair of server room air-conditioning to protect infrastructure uptime.',
  p.id,
  p.full_name,
  p.email,
  'IT Operations',
  'OPS-IT',
  current_date + 7,
  'submitted',
  '00000000-0000-4000-8000-000000000001',
  'Acme Medical Supplies, Inc.',
  185000,
  'services',
  'emergency',
  jsonb_build_object('need', 'Server room thermal control must be restored.', 'risk', 'Service degradation and hardware risk.'),
  jsonb_build_object('directAwardReason', 'emergency', 'priceReasonableness', 'Comparable to prior emergency repair.'),
  jsonb_build_array(jsonb_build_object('id','rl_seed_001','description','Emergency HVAC repair','quantity',1,'uom','job','unitPrice',185000)),
  now() - interval '2 days',
  now() - interval '3 days'
from core.profiles p
where p.email = 'intra.test.proc.requester@mwell.com.ph'
on conflict (id) do nothing;

insert into procurement.approval_steps (id, request_id, step_order, tier, status, label) values
  ('step_seed_001', 'req_seed_001', 1, 'dept_head', 'pending', 'Department Head'),
  ('step_seed_002', 'req_seed_001', 2, 'procurement_head', 'pending', 'Procurement Head')
on conflict (id) do nothing;

insert into procurement.purchase_orders (
  id, po_number, request_id, core_vendor_id, vendor_name, status, origin,
  actor_id, actor_email, lines, total, created_at
)
select
  'po_seed_001',
  'PO-2026-0001',
  'req_seed_001',
  '00000000-0000-4000-8000-000000000001',
  'Acme Medical Supplies, Inc.',
  'approved',
  'procurement',
  p.id,
  p.email,
  jsonb_build_array(jsonb_build_object('id','pl_seed_001','description','Emergency HVAC repair','quantity',1,'uom','job','unitPrice',185000,'receivedQuantity',0)),
  185000,
  now() - interval '1 day'
from core.profiles p
where p.email = 'intra.test.proc.officer@mwell.com.ph'
on conflict (id) do nothing;

insert into procurement.purchase_order_lines (
  id, purchase_order_id, line_no, description, quantity, uom, unit_price, received_quantity
) values (
  'pl_seed_001', 'po_seed_001', 1, 'Emergency HVAC repair', 1, 'job', 185000, 0
) on conflict (id) do nothing;

alter role authenticator set pgrst.db_schemas =
  'public, core, warehouse, procurement, legal, graphql_public';

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
