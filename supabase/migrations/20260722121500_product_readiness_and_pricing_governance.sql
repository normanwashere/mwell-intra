-- Governed Product readiness, go-live handoff, and effective-dated pricing.
-- UI mirror: packages/rbac/src/modules/product.ts.

create schema if not exists product;
grant usage on schema product to authenticated, service_role;

alter role authenticator set "pgrst.db_schemas" =
  'public, core, warehouse, procurement, legal, product, graphql_public';
notify pgrst, 'reload config';

insert into core.capabilities(module, cap) values
  ('product', 'view_readiness'),
  ('product', 'prepare_readiness'),
  ('product', 'decide_go_live'),
  ('product', 'acknowledge_operations_handoff'),
  ('product', 'view_pricing'),
  ('product', 'propose_pricing'),
  ('product', 'approve_pricing')
on conflict do nothing;

delete from core.role_capabilities
where module = 'warehouse' and cap = 'set_pricing';

insert into core.roles(module, role, label, description, is_active) values
  ('product', 'contributor', 'Product Contributor', 'Prepares readiness evidence and governed price proposals.', true),
  ('product', 'product_owner', 'Product Owner', 'Makes final go-live and independent pricing decisions.', true),
  ('product', 'operations_partner', 'Operations Partner', 'Acknowledges approved launch conditions before Operations execution.', true)
on conflict (module, role) do update set
  label = excluded.label,
  description = excluded.description,
  is_active = true,
  updated_at = now();

delete from core.role_capabilities where module = 'product';
insert into core.role_capabilities(module, role, cap) values
  ('product', 'contributor', 'view_readiness'),
  ('product', 'contributor', 'prepare_readiness'),
  ('product', 'contributor', 'view_pricing'),
  ('product', 'contributor', 'propose_pricing'),
  ('product', 'product_owner', 'view_readiness'),
  ('product', 'product_owner', 'decide_go_live'),
  ('product', 'product_owner', 'view_pricing'),
  ('product', 'product_owner', 'approve_pricing'),
  ('product', 'operations_partner', 'view_readiness'),
  ('product', 'operations_partner', 'acknowledge_operations_handoff')
on conflict do nothing;

create table if not exists product.readiness_packages (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references warehouse.products(id) on delete restrict,
  title text not null check (char_length(btrim(title)) >= 6),
  version integer not null check (version > 0),
  status text not null check (status in ('submitted', 'approved', 'rejected', 'superseded')),
  is_current boolean not null default false,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array'),
  conditions text not null default '',
  prepared_by uuid not null references core.profiles(id) on delete restrict,
  submitted_by uuid not null references core.profiles(id) on delete restrict,
  submitted_at timestamptz not null,
  decided_by uuid references core.profiles(id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  operations_acknowledged_by uuid references core.profiles(id) on delete restrict,
  operations_acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, version),
  check ((decided_at is null) = (decided_by is null)),
  check ((operations_acknowledged_at is null) = (operations_acknowledged_by is null))
);

create unique index if not exists readiness_one_current_approved_idx
  on product.readiness_packages(product_id)
  where is_current and status = 'approved';
create index if not exists readiness_status_updated_idx
  on product.readiness_packages(status, updated_at desc);

create table if not exists product.readiness_events (
  id bigint generated always as identity primary key,
  readiness_id uuid not null references product.readiness_packages(id) on delete restrict,
  version integer not null,
  action text not null,
  actor uuid not null references core.profiles(id) on delete restrict,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists product.price_proposals (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references warehouse.products(id) on delete restrict,
  product_name text not null,
  version integer not null check (version > 0),
  status text not null check (status in ('submitted', 'approved', 'rejected', 'superseded')),
  current_price numeric(14,2) not null check (current_price >= 0),
  proposed_price numeric(14,2) not null check (proposed_price > 0),
  cost_basis numeric(14,2) not null check (cost_basis >= 0),
  reason text not null check (char_length(btrim(reason)) >= 12),
  effective_at timestamptz not null,
  proposed_by uuid not null references core.profiles(id) on delete restrict,
  submitted_at timestamptz not null,
  decided_by uuid references core.profiles(id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (product_id, version),
  check ((decided_at is null) = (decided_by is null))
);

create index if not exists price_proposals_status_effective_idx
  on product.price_proposals(status, effective_at, created_at);

create table if not exists product.price_events (
  id bigint generated always as identity primary key,
  proposal_id uuid not null references product.price_proposals(id) on delete restrict,
  version integer not null,
  action text not null,
  actor uuid references core.profiles(id) on delete restrict,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function product.reject_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Product governance history is append-only';
end;
$$;

drop trigger if exists readiness_events_immutable on product.readiness_events;
create trigger readiness_events_immutable
before update or delete on product.readiness_events
for each row execute function product.reject_history_mutation();

drop trigger if exists price_events_immutable on product.price_events;
create trigger price_events_immutable
before update or delete on product.price_events
for each row execute function product.reject_history_mutation();

alter table product.readiness_packages enable row level security;
alter table product.readiness_events enable row level security;
alter table product.price_proposals enable row level security;
alter table product.price_events enable row level security;

drop policy if exists product_readiness_read on product.readiness_packages;
create policy product_readiness_read on product.readiness_packages
for select to authenticated using (core.has_cap('product', 'view_readiness'));
drop policy if exists product_readiness_events_read on product.readiness_events;
create policy product_readiness_events_read on product.readiness_events
for select to authenticated using (core.has_cap('product', 'view_readiness'));
drop policy if exists product_price_read on product.price_proposals;
create policy product_price_read on product.price_proposals
for select to authenticated using (core.has_cap('product', 'view_pricing'));
drop policy if exists product_price_events_read on product.price_events;
create policy product_price_events_read on product.price_events
for select to authenticated using (core.has_cap('product', 'view_pricing'));

grant select on product.readiness_packages, product.readiness_events to authenticated;
grant select on product.price_proposals, product.price_events to authenticated;
revoke insert, update, delete on product.readiness_packages from authenticated;
revoke insert, update, delete on product.readiness_events from authenticated;
revoke insert, update, delete on product.price_proposals from authenticated;
revoke insert, update, delete on product.price_events from authenticated;

create or replace function product.submit_readiness_package(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = product, warehouse, core, pg_catalog, public
as $$
declare
  v_input jsonb := payload->'readiness';
  v_evidence jsonb := payload->'readiness'->'evidence';
  v_product_id text := btrim(coalesce(payload->'readiness'->>'productId', ''));
  v_title text := btrim(coalesce(payload->'readiness'->>'title', ''));
  v_version integer;
  v_row product.readiness_packages;
begin
  if not core.has_cap('product', 'prepare_readiness') then
    raise exception 'Not authorized: product/prepare_readiness';
  end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_product_id = '' or not exists (select 1 from warehouse.products where id = v_product_id) then
    raise exception 'Product not found';
  end if;
  if char_length(v_title) < 6 then raise exception 'Readiness title is required'; end if;
  if jsonb_typeof(v_evidence) <> 'array' or jsonb_array_length(v_evidence) = 0 then
    raise exception 'At least one readiness evidence item is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_evidence) item
    where coalesce((item->>'required')::boolean, true)
      and (
        not coalesce((item->>'verified')::boolean, false)
        or btrim(coalesce(item->>'reference', '')) = ''
      )
  ) then
    raise exception 'Every required readiness evidence item must be verified';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('product.readiness:' || v_product_id, 0));
  select coalesce(max(version), 0) + 1 into v_version
  from product.readiness_packages where product_id = v_product_id;

  insert into product.readiness_packages(
    product_id, title, version, status, evidence, conditions,
    prepared_by, submitted_by, submitted_at
  ) values (
    v_product_id, v_title, v_version, 'submitted', v_evidence,
    btrim(coalesce(v_input->>'conditions', '')),
    auth.uid(), auth.uid(), now()
  ) returning * into v_row;

  insert into product.readiness_events(readiness_id, version, action, actor, detail)
  values (v_row.id, v_row.version, 'submitted', auth.uid(), jsonb_build_object('evidence_count', jsonb_array_length(v_evidence)));
  return to_jsonb(v_row);
end;
$$;

create or replace function product.decide_readiness_package(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = product, core, pg_catalog, public
as $$
declare
  v_row product.readiness_packages;
  v_decision text := payload->>'decision';
  v_note text := btrim(coalesce(payload->>'note', ''));
begin
  if not core.has_cap('product', 'decide_go_live') then
    raise exception 'Not authorized: product/decide_go_live';
  end if;
  if v_decision not in ('approved', 'rejected') then raise exception 'Invalid decision'; end if;
  if char_length(v_note) < 8 then raise exception 'Decision note is required'; end if;
  select * into v_row from product.readiness_packages
  where id = (payload->>'id')::uuid for update;
  if not found or v_row.status <> 'submitted' then raise exception 'Readiness package is not awaiting decision'; end if;
  if v_row.submitted_by = auth.uid() then raise exception 'Independent Product decision required'; end if;

  if v_decision = 'approved' then
    update product.readiness_packages
    set status = 'superseded', is_current = false, updated_at = now()
    where product_id = v_row.product_id and status = 'approved' and is_current and id <> v_row.id;
  end if;

  update product.readiness_packages
  set status = v_decision,
      is_current = (v_decision = 'approved'),
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = v_note,
      updated_at = now()
  where id = v_row.id returning * into v_row;

  insert into product.readiness_events(readiness_id, version, action, actor, detail)
  values (v_row.id, v_row.version, v_decision, auth.uid(), jsonb_build_object('note', v_note));

  if v_decision = 'approved' then
    insert into core.notifications(user_id, kind, entity_type, entity_id)
    select distinct ur.user_id, 'product_go_live_approved', 'product_readiness', v_row.id::text
    from core.user_roles ur
    where ur.module = 'product' and ur.role = 'operations_partner';
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function product.acknowledge_operations_handoff(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = product, core, pg_catalog, public
as $$
declare v_row product.readiness_packages;
begin
  if not core.has_cap('product', 'acknowledge_operations_handoff') then
    raise exception 'Not authorized: product/acknowledge_operations_handoff';
  end if;
  update product.readiness_packages
  set operations_acknowledged_by = auth.uid(),
      operations_acknowledged_at = now(),
      updated_at = now()
  where id = (payload->>'id')::uuid
    and status = 'approved' and is_current
    and operations_acknowledged_at is null
  returning * into v_row;
  if not found then raise exception 'Approved handoff is unavailable or already acknowledged'; end if;
  insert into product.readiness_events(readiness_id, version, action, actor)
  values (v_row.id, v_row.version, 'operations_acknowledged', auth.uid());
  return to_jsonb(v_row);
end;
$$;

create or replace function product.can_launch(p_product_id text)
returns boolean
language sql
stable
security definer
set search_path = product, pg_catalog
as $$
  select exists (
    select 1 from product.readiness_packages
    where product_id = p_product_id
      and status = 'approved'
      and is_current
      and operations_acknowledged_at is not null
  );
$$;

create or replace function product.submit_price_proposal(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = product, warehouse, core, pg_catalog, public
as $$
declare
  v_input jsonb := payload->'proposal';
  v_product warehouse.products;
  v_version integer;
  v_effective_at timestamptz;
  v_row product.price_proposals;
begin
  if not core.has_cap('product', 'propose_pricing') then
    raise exception 'Not authorized: product/propose_pricing';
  end if;
  select * into v_product from warehouse.products where id = v_input->>'productId' for share;
  if not found then raise exception 'Product not found'; end if;
  if (v_input->>'proposedPrice')::numeric <= 0 then raise exception 'Proposed price must be greater than zero'; end if;
  if (v_input->>'costBasis')::numeric < 0 then raise exception 'Cost basis must be zero or more'; end if;
  if char_length(btrim(coalesce(v_input->>'reason', ''))) < 12 then raise exception 'Reason is required'; end if;
  v_effective_at := (v_input->>'effectiveAt')::timestamptz;

  perform pg_advisory_xact_lock(hashtextextended('product.price:' || v_product.id, 0));
  select coalesce(max(version), 0) + 1 into v_version
  from product.price_proposals where product_id = v_product.id;
  insert into product.price_proposals(
    product_id, product_name, version, status, current_price, proposed_price,
    cost_basis, reason, effective_at, proposed_by, submitted_at
  ) values (
    v_product.id, v_product.name, v_version, 'submitted', coalesce(v_product.price, 0),
    (v_input->>'proposedPrice')::numeric, (v_input->>'costBasis')::numeric,
    btrim(v_input->>'reason'), v_effective_at, auth.uid(), now()
  ) returning * into v_row;
  insert into product.price_events(proposal_id, version, action, actor, detail)
  values (v_row.id, v_row.version, 'submitted', auth.uid(), jsonb_build_object('effective_at', v_effective_at));
  return to_jsonb(v_row);
end;
$$;

create or replace function product.apply_due_price_revisions()
returns integer
language plpgsql
security definer
set search_path = product, warehouse, core, pg_catalog, public
as $$
declare v_row product.price_proposals; v_count integer := 0;
begin
  if auth.role() <> 'service_role' and not core.has_cap('product', 'approve_pricing') then
    raise exception 'Not authorized: product/approve_pricing';
  end if;
  for v_row in
    select * from product.price_proposals
    where status = 'approved' and activated_at is null and effective_at <= now()
    order by effective_at, version
    for update skip locked
  loop
    update warehouse.products set price = v_row.proposed_price where id = v_row.product_id;
    update product.price_proposals set activated_at = now() where id = v_row.id;
    insert into product.price_events(proposal_id, version, action, actor, detail)
    values (v_row.id, v_row.version, 'activated', auth.uid(), jsonb_build_object('price', v_row.proposed_price));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function product.decide_price_proposal(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = product, core, pg_catalog, public
as $$
declare
  v_proposal product.price_proposals;
  v_decision text := payload->>'decision';
  v_note text := btrim(coalesce(payload->>'note', ''));
begin
  if not core.has_cap('product', 'approve_pricing') then
    raise exception 'Not authorized: product/approve_pricing';
  end if;
  if v_decision not in ('approved', 'rejected') then raise exception 'Invalid decision'; end if;
  if char_length(v_note) < 8 then raise exception 'Decision note is required'; end if;
  select * into v_proposal from product.price_proposals
  where id = (payload->>'id')::uuid for update;
  if not found or v_proposal.status <> 'submitted' then raise exception 'Price proposal is not awaiting decision'; end if;
  if v_proposal.proposed_by = auth.uid() then raise exception 'Independent price approval required'; end if;

  update product.price_proposals
  set status = v_decision,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = v_note
  where id = v_proposal.id returning * into v_proposal;
  insert into product.price_events(proposal_id, version, action, actor, detail)
  values (v_proposal.id, v_proposal.version, v_decision, auth.uid(), jsonb_build_object('note', v_note));
  if v_decision = 'approved' then perform product.apply_due_price_revisions(); end if;
  return to_jsonb(v_proposal);
end;
$$;

revoke all on function product.submit_readiness_package(jsonb) from public, anon;
revoke all on function product.decide_readiness_package(jsonb) from public, anon;
revoke all on function product.acknowledge_operations_handoff(jsonb) from public, anon;
revoke all on function product.can_launch(text) from public, anon;
revoke all on function product.submit_price_proposal(jsonb) from public, anon;
revoke all on function product.decide_price_proposal(jsonb) from public, anon;
revoke all on function product.apply_due_price_revisions() from public, anon, authenticated;
grant execute on function product.submit_readiness_package(jsonb) to authenticated, service_role;
grant execute on function product.decide_readiness_package(jsonb) to authenticated, service_role;
grant execute on function product.acknowledge_operations_handoff(jsonb) to authenticated, service_role;
grant execute on function product.can_launch(text) to authenticated, service_role;
grant execute on function product.submit_price_proposal(jsonb) to authenticated, service_role;
grant execute on function product.decide_price_proposal(jsonb) to authenticated, service_role;
grant execute on function product.apply_due_price_revisions() to service_role;

-- Retire the authenticated direct-overwrite path. Warehouse keeps price context;
-- Product proposals and approvals own every future price change.
revoke all on function warehouse.set_product_price(jsonb) from authenticated;

notify pgrst, 'reload schema';
