-- Preserve the deployed intake/auth/idempotency chain. Line identity is durable
-- even after independent QC changes a returned unit's stock state.
-- Retain the legacy RPC signature so stale clients receive an actionable error,
-- but never delegate caller-authored inventory mutations to the old implementation.
create or replace function warehouse.record_return(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Legacy return intake is retired. Reload or upgrade the app and retry using record_return_v2.'
    using errcode = '0A000';
end $$;
revoke all on function warehouse.record_return(jsonb) from public, anon;
revoke all on function warehouse.record_return_uncertified_impl(jsonb) from public, anon, authenticated;

create or replace function private.enforce_allocation_return_balance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  line jsonb;
  normalized jsonb := '[]'::jsonb;
  allocation warehouse.allocations;
  allocation_id text;
  prior bigint;
  incoming bigint;
begin
  if new.source <> 'event' and not exists (select 1 from jsonb_array_elements(new.lines) l
    where nullif(l->>'allocationId','') is not null) then return new; end if;
  for line in select value from jsonb_array_elements(new.lines) loop
    allocation_id := nullif(line->>'allocationId', '');
    if allocation_id is null then
      select case when count(*) = 1 then min(id) end into allocation_id
      from warehouse.allocations where event_id = new.event_id
        and product_id = line->>'productId' and status in ('issued', 'returned');
    end if;
    if allocation_id is null then
      raise exception 'Select an exact issued allocation for this event return';
    end if;
    select * into allocation from warehouse.allocations where id = allocation_id for update;
    if not found or allocation.event_id is distinct from new.event_id
       or allocation.product_id is distinct from line->>'productId'
       or allocation.status <> 'issued' then
      raise exception 'Return allocation identity does not match custody';
    end if;
    if exists (select 1 from warehouse.returns r, lateral jsonb_array_elements(r.lines) l
      where r.source = 'event' and r.event_id = new.event_id
        and l->>'productId' = allocation.product_id and nullif(l->>'allocationId', '') is null) then
      raise exception 'Legacy return allocation lineage needs reconciliation before further intake';
    end if;
    select coalesce(sum((l->>'quantity')::bigint), 0) into prior
      from warehouse.returns r, lateral jsonb_array_elements(r.lines) l
      where r.event_id = allocation.event_id and l->>'allocationId' = allocation.id;
    select coalesce(sum((l->>'quantity')::bigint), 0) into incoming
      from jsonb_array_elements(normalized) l where l->>'allocationId' = allocation.id;
    incoming := incoming + (line->>'quantity')::bigint;
    if prior + incoming > allocation.quantity then
      raise exception 'Return quantity exceeds outstanding allocation custody';
    end if;
    normalized := normalized || jsonb_build_array(line || jsonb_build_object('allocationId', allocation.id));
    if prior + incoming = allocation.quantity then
      update warehouse.allocations set status = 'returned' where id = allocation.id;
    end if;
  end loop;
  new.lines := normalized;
  return new;
end $$;
revoke all on function private.enforce_allocation_return_balance() from public, anon, authenticated;

-- Backfill only unambiguous historical identities. Ambiguous rows remain visible
-- in the audit view and block further intake, rather than inventing attribution.
update warehouse.returns r set lines = (
  select coalesce(jsonb_agg(case when candidate.id is not null and nullif(l->>'allocationId','') is null
    then l || jsonb_build_object('allocationId',candidate.id) else l end order by ordinal), '[]'::jsonb)
  from jsonb_array_elements(r.lines) with ordinality as entry(l,ordinal)
  left join lateral (select case when count(*) = 1 then min(a.id) end id
    from warehouse.allocations a where a.event_id = r.event_id
      and a.product_id = l->>'productId' and a.status in ('issued','returned')) candidate on true
) where r.source = 'event';

create or replace view warehouse.return_lineage_audit with (security_invoker = true) as
select r.id return_id, r.event_id, l line
from warehouse.returns r cross join lateral jsonb_array_elements(r.lines) l
where r.source = 'event' and (nullif(l->>'allocationId','') is null or
  (select sum((x->>'quantity')::bigint) from warehouse.returns h,
    lateral jsonb_array_elements(h.lines) x where x->>'allocationId' = l->>'allocationId') >
  (select a.quantity from warehouse.allocations a where a.id = l->>'allocationId'));
grant select on warehouse.return_lineage_audit to authenticated;

update warehouse.allocations a set status = 'returned'
where a.status = 'issued' and a.quantity = (
  select sum((l->>'quantity')::bigint) from warehouse.returns r,
    lateral jsonb_array_elements(r.lines) l where l->>'allocationId' = a.id
);

create or replace view warehouse.allocation_return_totals with (security_invoker = true) as
select a.id allocation_id, a.quantity issued_units,
  coalesce(r.returned,0) returned_units, a.quantity - coalesce(r.returned,0) remaining_units
from warehouse.allocations a left join lateral (
  select sum((l->>'quantity')::bigint) returned from warehouse.returns h,
    lateral jsonb_array_elements(h.lines) l where h.event_id = a.event_id and l->>'allocationId' = a.id
) r on true;
grant select on warehouse.allocation_return_totals to authenticated;

create trigger enforce_allocation_return_balance before insert on warehouse.returns
for each row execute function private.enforce_allocation_return_balance();

do $$
declare definition text := pg_get_functiondef('warehouse.record_return_v2(jsonb)'::regprocedure);
begin
  if position('''productId'', v_product.id, ''quantity'', v_quantity' in definition) = 0 then
    raise exception 'Unexpected return intake implementation; review before migration';
  end if;
  definition := replace(definition, '''productId'', v_product.id, ''quantity'', v_quantity',
    '''allocationId'', coalesce(v_allocation.id, nullif(v_line->>''allocationId'', '''')), ''productId'', v_product.id, ''quantity'', v_quantity');
  -- Completion belongs exclusively to cumulative line accounting above.
  if position('if v_allocation.id is not null and (' in definition) = 0 then
    raise exception 'Unexpected allocation completion implementation';
  end if;
  execute replace(definition, 'if v_allocation.id is not null and (', 'if false and v_allocation.id is not null and (');
end $$;

notify pgrst, 'reload schema';

-- Security-invoker aggregation retains all underlying RLS read boundaries.
create or replace view warehouse.event_custody_totals with (security_invoker = true) as
select e.id event_id,
  coalesce(a.issued,0) issued_units, coalesce(a.reserved,0) reserved_units,
  coalesce(r.returned,0) returned_units,
  coalesce(a.issued,0) - coalesce(r.returned,0) outstanding_units
from warehouse.events e
left join lateral (
  select sum(quantity) filter (where status in ('issued','returned')) issued,
    sum(quantity) filter (where status in ('reserved','allocated')) reserved
  from warehouse.allocations where event_id = e.id
) a on true
left join lateral (
  select sum(quantity) returned from warehouse.movements where event_id = e.id and type = 'return'
) r on true;
grant select on warehouse.event_custody_totals to authenticated;

-- Retain both deployed authorization/evidence wrappers and replace only their
-- lifetime-issued expression with the same read model used by both UIs.
do $$
declare
  signature text;
  definition text;
  revised text;
begin
  foreach signature in array array[
    'warehouse.save_event_reconciliation_uncertified_impl(jsonb)',
    'warehouse.save_event_reconciliation_pre_action_evidence(jsonb)'
  ] loop
    if to_regprocedure(signature) is null then continue; end if;
    definition := pg_get_functiondef(to_regprocedure(signature));
    revised := regexp_replace(definition,
      'select coalesce\(sum\(allocation.quantity\), 0\)::integer[[:space:]]+into v_issued[[:space:]]+from warehouse.allocations allocation[[:space:]]+where allocation.event_id = (v_event.id|payload->>''event_id'')[[:space:]]+and allocation.status in \(''issued'', ''returned''\);',
      'select issued_units::integer into v_issued from warehouse.event_custody_totals where event_id = \1;');
    if revised = definition then raise exception 'Unexpected reconciliation custody expression in %', signature; end if;
    execute revised;
  end loop;
end $$;

-- manage_event already takes FOR UPDATE on this same event row. Replay is
-- intentionally resolved before the lock/status test in reserve_batch.
do $$
declare definition text := pg_get_functiondef('warehouse.reserve_batch(jsonb)'::regprocedure);
begin
  if position('if not exists (select 1 from warehouse.events where id = payload->>''event_id'') then' in definition) = 0 then
    raise exception 'Unexpected reserve_batch implementation; review before migration';
  end if;
  execute replace(definition,
    'if not exists (select 1 from warehouse.events where id = payload->>''event_id'') then',
    'perform 1 from warehouse.events where id = payload->>''event_id'' and status in (''planned'',''active'') for update;
     if not found then');
end $$;
notify pgrst, 'reload schema';

-- Never backfill historical issue costs from today's editable catalogue.
alter table warehouse.movements add column unit_cost_at_movement numeric;
create or replace function private.snapshot_issue_valuation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.unit_cost_at_movement := null;
  if new.type = 'issue' then
    select unit_cost into new.unit_cost_at_movement from warehouse.products
      where id = new.product_id for share;
  elsif new.type = 'return' and new.event_id is not null then
    -- A uniform historical issue cost is unambiguous even for mixed purposes.
    -- Mixed-cost custody requires explicit issue-lot attribution; leave unknown.
    select case when count(*) = count(unit_cost_at_movement)
      and min(unit_cost_at_movement) = max(unit_cost_at_movement)
      then min(unit_cost_at_movement) end into new.unit_cost_at_movement
    from warehouse.movements where type = 'issue' and event_id = new.event_id
      and product_id = new.product_id;
  end if;
  return new;
end $$;
revoke all on function private.snapshot_issue_valuation() from public, anon, authenticated;
create trigger snapshot_issue_valuation before insert on warehouse.movements
for each row execute function private.snapshot_issue_valuation();
notify pgrst, 'reload schema';
