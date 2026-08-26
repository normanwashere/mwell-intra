-- Final convergence for third-party custody lifecycle integrity.
-- Serialize the migration preflight against both order intake and location
-- lifecycle changes so a concurrent write cannot pass between validation and
-- trigger replacement.

lock table warehouse.fulfillment_orders in share row exclusive mode;
lock table warehouse.locations in share row exclusive mode;

do $$
declare
  invalid_count integer;
  invalid_sample text;
begin
  select
    count(*)::integer,
    string_agg(
      pg_catalog.format(
        'order=%s location=%s state=%s',
        fulfillment.id,
        coalesce(fulfillment.third_party_location_id, '<missing>'),
        case
          when location.id is null then 'missing location'
          when not location.active then 'inactive location'
          else 'invalid location type ' || location.type
        end
      ),
      '; '
      order by fulfillment.id
    ) filter (where sample_rank <= 10)
  into invalid_count, invalid_sample
  from (
    select
      candidate.*,
      row_number() over (order by candidate.id) as sample_rank
    from warehouse.fulfillment_orders candidate
    where candidate.source = 'third_party'
      and candidate.status not in ('completed', 'cancelled')
  ) fulfillment
  left join warehouse.locations location
    on location.id = fulfillment.third_party_location_id
  where location.id is null
     or not location.active
     or location.type not in ('event_site', 'vendor');

  if invalid_count > 0 then
    raise exception using
      errcode = '23514',
      message = pg_catalog.format(
        'Third-party custody convergence blocked: %s nonterminal order(s) reference a missing, inactive, or non-event/vendor location. Reassign or close these orders, then rerun the migration. Sample: %s',
        invalid_count,
        coalesce(invalid_sample, '<none>')
      );
  end if;
end;
$$;

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

    -- FOR SHARE conflicts with the row lock taken by updates to active/type.
    -- This serializes order intake with the location lifecycle guard.
    perform 1
    from warehouse.locations location
    where location.id = new.third_party_location_id
      and location.type in ('event_site', 'vendor')
      and location.active
    for share;

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
