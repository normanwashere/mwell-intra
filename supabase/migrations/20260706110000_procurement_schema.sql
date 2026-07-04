-- Mwell Intra — procurement schema MVP (Step 3a)
--
-- Requests → PO authoring (`origin='procurement'`). Award gating on vendor
-- accreditation lands in Step 3d; this migration establishes tables, RLS, and
-- minimal SECURITY DEFINER RPCs gated via core.has_cap('procurement', cap).
--
-- Status workflows:
--   requests: draft → submitted → under_review → approved|rejected|cancelled
--   purchase_orders: draft → pending_approval → approved → issued → closed|cancelled
--
-- Re-runnable: create if not exists + create-or-replace functions.

create schema if not exists procurement;

-- ---------------------------------------------------------------------------
-- Purchase requests (internal intake)
-- ---------------------------------------------------------------------------
create table if not exists procurement.requests (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  requester_id     uuid not null references core.profiles(id),
  department       text,
  status           text not null default 'draft',
  core_vendor_id   uuid references core.vendors(id),
  estimated_amount numeric(14, 2),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint requests_status_check check (
    status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled')
  )
);

create index if not exists requests_requester_idx on procurement.requests (requester_id);
create index if not exists requests_status_idx on procurement.requests (status);

-- ---------------------------------------------------------------------------
-- Procurement-origin POs (hand off to warehouse.receive_against_po in Step 3d)
-- ---------------------------------------------------------------------------
create table if not exists procurement.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid references procurement.requests(id) on delete set null,
  core_vendor_id uuid not null references core.vendors(id),
  status         text not null default 'draft',
  origin         text not null default 'procurement',
  actor_id       uuid not null references core.profiles(id),
  expected_date  date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint purchase_orders_status_check check (
    status in ('draft', 'pending_approval', 'approved', 'issued', 'closed', 'cancelled')
  ),
  constraint purchase_orders_origin_check check (origin = 'procurement')
);

create index if not exists purchase_orders_vendor_idx on procurement.purchase_orders (core_vendor_id);
create index if not exists purchase_orders_status_idx on procurement.purchase_orders (status);

create table if not exists procurement.purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references procurement.purchase_orders(id) on delete cascade,
  line_no           int not null,
  description       text not null,
  quantity          numeric(14, 4) not null default 1 check (quantity > 0),
  unit_price        numeric(14, 2),
  created_at        timestamptz not null default now(),
  unique (purchase_order_id, line_no)
);

-- ---------------------------------------------------------------------------
-- RLS — reads capability-scoped; writes RPC-only
-- ---------------------------------------------------------------------------
alter table procurement.requests enable row level security;
alter table procurement.purchase_orders enable row level security;
alter table procurement.purchase_order_lines enable row level security;

drop policy if exists read_requests on procurement.requests;
create policy read_requests on procurement.requests for select to authenticated
  using (
    core.has_cap('procurement', 'view_dashboard')
    or requester_id = auth.uid()
  );

drop policy if exists read_purchase_orders on procurement.purchase_orders;
create policy read_purchase_orders on procurement.purchase_orders for select to authenticated
  using (core.has_cap('procurement', 'view_dashboard'));

drop policy if exists read_purchase_order_lines on procurement.purchase_order_lines;
create policy read_purchase_order_lines on procurement.purchase_order_lines for select to authenticated
  using (
    exists (
      select 1 from procurement.purchase_orders po
      where po.id = purchase_order_id
        and core.has_cap('procurement', 'view_dashboard')
    )
  );

grant usage on schema procurement to authenticated, service_role;
grant select on all tables in schema procurement to authenticated, service_role;
grant all on all tables in schema procurement to service_role;

revoke insert, update, delete on procurement.requests from authenticated;
revoke insert, update, delete on procurement.purchase_orders from authenticated;
revoke insert, update, delete on procurement.purchase_order_lines from authenticated;

-- ---------------------------------------------------------------------------
-- RPCs — capability-gated writes
-- ---------------------------------------------------------------------------

create or replace function procurement.create_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path = procurement, core, public as $$
declare v procurement.requests;
begin
  if not core.has_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.create_request';
  end if;
  insert into procurement.requests (
    title, description, requester_id, department, status, core_vendor_id, estimated_amount
  ) values (
    payload->>'title',
    nullif(payload->>'description', ''),
    auth.uid(),
    nullif(payload->>'department', ''),
    coalesce(nullif(payload->>'status', ''), 'draft'),
    nullif(payload->>'core_vendor_id', '')::uuid,
    nullif(payload->>'estimated_amount', '')::numeric
  ) returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v.id, 'created', auth.uid(),
          jsonb_build_object('title', v.title, 'status', v.status));
  return to_jsonb(v);
end; $$;

create or replace function procurement.submit_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path = procurement, core, public as $$
declare v procurement.requests; v_id uuid;
begin
  v_id := (payload->>'id')::uuid;
  if v_id is null then raise exception 'request id is required'; end if;
  select * into v from procurement.requests where id = v_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v.requester_id <> auth.uid()
     and not core.has_cap('procurement', 'admin') then
    raise exception 'Not authorized to submit this request';
  end if;
  if v.status <> 'draft' then raise exception 'Only draft requests can be submitted'; end if;
  update procurement.requests
     set status = 'submitted', updated_at = now()
   where id = v_id
   returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v.id, 'submitted', auth.uid(), '{}'::jsonb);
  return to_jsonb(v);
end; $$;

create or replace function procurement.create_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = procurement, core, public as $$
declare v procurement.purchase_orders; v_lines jsonb; line jsonb; i int := 0;
begin
  if not core.has_cap('procurement', 'author_po') then
    raise exception 'Not authorized: procurement.author_po';
  end if;
  insert into procurement.purchase_orders (
    request_id, core_vendor_id, status, origin, actor_id, expected_date, notes
  ) values (
    nullif(payload->>'request_id', '')::uuid,
    (payload->>'core_vendor_id')::uuid,
    coalesce(nullif(payload->>'status', ''), 'draft'),
    'procurement',
    auth.uid(),
    nullif(payload->>'expected_date', '')::date,
    nullif(payload->>'notes', '')
  ) returning * into v;
  v_lines := coalesce(payload->'lines', '[]'::jsonb);
  for line in select * from jsonb_array_elements(v_lines)
  loop
    i := i + 1;
    insert into procurement.purchase_order_lines (
      purchase_order_id, line_no, description, quantity, unit_price
    ) values (
      v.id,
      coalesce((line->>'line_no')::int, i),
      line->>'description',
      coalesce((line->>'quantity')::numeric, 1),
      nullif(line->>'unit_price', '')::numeric
    );
  end loop;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'purchase_order', v.id, 'created', auth.uid(),
          jsonb_build_object('core_vendor_id', v.core_vendor_id, 'origin', v.origin));
  return to_jsonb(v);
end; $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'create_request(jsonb)', 'submit_request(jsonb)', 'create_purchase_order(jsonb)'
  ]
  loop
    execute format('revoke all on function procurement.%s from public, anon;', fn);
    execute format('grant execute on function procurement.%s to authenticated, service_role;', fn);
  end loop;
end $$;
