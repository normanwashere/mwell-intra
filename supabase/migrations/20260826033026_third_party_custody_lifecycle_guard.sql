-- Forward convergence for 20260826030637: third-party custody validation must
-- remain true for the full nonterminal order lifecycle, not only at intake.

create or replace function private.warehouse_enforce_third_party_custody_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'third_party' then
    if nullif(pg_catalog.btrim(coalesce(new.third_party_location_id, '')), '') is null then
      raise exception 'A third-party location is required';
    end if;

    -- Serialize order intake against location deactivation/reclassification.
    perform 1
    from warehouse.locations location
    where location.id = new.third_party_location_id
      and location.type in ('event_site', 'vendor')
      and location.active
    for key share;

    if not found then
      raise exception 'Third-party location must be an active event site or vendor custody location';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.warehouse_enforce_third_party_custody_location()
  from public, anon, authenticated;
grant execute on function private.warehouse_enforce_third_party_custody_location()
  to service_role;

create index if not exists warehouse_fulfillment_active_third_party_custody_idx
  on warehouse.fulfillment_orders (third_party_location_id)
  where source = 'third_party'
    and status not in ('completed', 'cancelled');

create or replace function private.warehouse_guard_third_party_custody_location_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    new.type is distinct from old.type
    or (old.active and not new.active)
  ) and exists (
    select 1
    from warehouse.fulfillment_orders fulfillment
    where fulfillment.source = 'third_party'
      and fulfillment.third_party_location_id = old.id
      and fulfillment.status not in ('completed', 'cancelled')
  ) then
    raise exception 'Cannot deactivate or reclassify a location with nonterminal third-party fulfillment custody';
  end if;

  return new;
end;
$$;

revoke all on function private.warehouse_guard_third_party_custody_location_lifecycle()
  from public, anon, authenticated;
grant execute on function private.warehouse_guard_third_party_custody_location_lifecycle()
  to service_role;

drop trigger if exists locations_third_party_custody_lifecycle_guard
  on warehouse.locations;
create trigger locations_third_party_custody_lifecycle_guard
before update of type, active
on warehouse.locations
for each row
execute function private.warehouse_guard_third_party_custody_location_lifecycle();
