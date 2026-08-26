alter table warehouse.locations
  add column if not exists active boolean not null default true;

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

    if not exists (
      select 1
      from warehouse.locations location
      where location.id = new.third_party_location_id
        and location.type in ('event_site', 'vendor')
        and location.active
    ) then
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

drop trigger if exists fulfillment_orders_third_party_custody_guard
  on warehouse.fulfillment_orders;
create trigger fulfillment_orders_third_party_custody_guard
before insert or update of source, third_party_location_id
on warehouse.fulfillment_orders
for each row
execute function private.warehouse_enforce_third_party_custody_location();
