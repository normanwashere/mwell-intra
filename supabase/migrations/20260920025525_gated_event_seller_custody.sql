-- Prospective opt-in only. No user provisioning, stock issue, or historical backfill.
insert into core.capabilities(module,cap) values ('events','view_event_custody'),('events','record_event_outcome') on conflict do nothing;
insert into core.roles(module,role,label,description,is_active) values
  ('events','seller','Event Seller','Named account limited to explicitly assigned event custody.',true) on conflict do nothing;
insert into core.role_capabilities(module,role,cap) values
  ('events','seller','view_event_custody'),('events','seller','record_event_outcome') on conflict do nothing;
insert into learning.mutation_capability_rules(module,capability) values ('events','record_event_outcome') on conflict do nothing;

create table private.event_custody_sessions (
  event_id text primary key references warehouse.events(id), enabled boolean not null default false,
  created_at timestamptz not null default clock_timestamp(), configured_by uuid not null references core.profiles(id)
);
create table private.event_sellers (
  event_id text not null references private.event_custody_sessions(event_id), user_id uuid not null references core.profiles(id),
  valid_from timestamptz not null, valid_until timestamptz not null, revoked_at timestamptz,
  primary key(event_id,user_id), check(valid_until>valid_from)
);
create table private.event_custody_sources (
  allocation_id text primary key references warehouse.allocations(id), event_id text not null references private.event_custody_sessions(event_id),
  order_id uuid not null references warehouse.fulfillment_orders(id), product_id text not null references warehouse.products(id),
  quantity integer not null check(quantity>0), serial_numbers text[] not null default '{}',
  acknowledged_at timestamptz not null, created_at timestamptz not null default clock_timestamp(), unique(order_id,product_id)
);
create table private.event_custody_entries (
  id uuid primary key default gen_random_uuid(), event_id text not null references private.event_custody_sessions(event_id),
  allocation_id text not null references private.event_custody_sources(allocation_id), seller_id uuid not null references core.profiles(id),
  kind text not null check(kind in ('sale','giveaway','reversal')), quantity integer not null check(quantity>0),
  serial_numbers text[] not null default '{}', amount numeric(14,2) not null check(amount>=0),
  external_reference text not null check(length(btrim(external_reference)) between 1 and 120),
  reverses_id uuid unique references private.event_custody_entries(id), reason text,
  created_at timestamptz not null default clock_timestamp(), unique(event_id,external_reference),
  check((kind='reversal')=(reverses_id is not null)),check(kind<>'giveaway' or amount=0)
);
create index event_custody_entries_allocation on private.event_custody_entries(allocation_id);
create table private.event_custody_setup_log (
  id uuid primary key default gen_random_uuid(),event_id text not null,actor_id uuid not null,action text not null,
  detail jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table private.event_custody_sessions enable row level security;
alter table private.event_sellers enable row level security;
alter table private.event_custody_sources enable row level security;
alter table private.event_custody_entries enable row level security;
alter table private.event_custody_setup_log enable row level security;
revoke all on private.event_custody_sessions,private.event_sellers,private.event_custody_sources,
  private.event_custody_entries,private.event_custody_setup_log from public,anon,authenticated,service_role;

create function private.event_custody_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Event custody history is immutable; append a reversal';end $$;
create trigger immutable_event_custody_entries before update or delete or truncate on private.event_custody_entries
for each statement execute function private.event_custody_immutable();
create trigger immutable_event_custody_sources before update or delete or truncate on private.event_custody_sources
for each statement execute function private.event_custody_immutable();
create trigger immutable_event_custody_setup before update or delete or truncate on private.event_custody_setup_log
for each statement execute function private.event_custody_immutable();

create function private.is_event_seller(p_event text) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from private.event_sellers s join core.profiles p on p.id=s.user_id
    join warehouse.events e on e.id=s.event_id
    where s.event_id=p_event and s.user_id=auth.uid() and s.revoked_at is null
      and statement_timestamp()>=s.valid_from and statement_timestamp()<s.valid_until and p.status='active'
      and statement_timestamp()>=(e.start_date::timestamp at time zone 'Asia/Manila')
      and statement_timestamp()<((coalesce(e.end_date,e.start_date)+1)::timestamp at time zone 'Asia/Manila')
      and nullif(btrim(p.full_name),'') is not null and nullif(btrim(p.email),'') is not null)
    and core.has_live_cap('events','view_event_custody')
    and exists(select 1 from core.user_roles where user_id=auth.uid() and module='events' and role='seller')
    and not exists(select 1 from core.user_roles where user_id=auth.uid()
      and not ((module='events' and role='seller') or (module='core' and role='staff')))
$$;
create function private.is_event_custody_owner(p_event text) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and core.has_live_cap('events','manage_events') and exists(
    select 1 from warehouse.events e join core.profiles p on p.id=auth.uid() and p.status='active'
    where e.id=p_event and (lower(e.owner_email)=lower(p.email) or core.has_cap('events','admin')))
$$;
create function warehouse.event_custody_readiness(payload jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare schema_ready boolean; caps_ready boolean; learning_ready boolean:=false;
begin
  if private.is_event_custody_owner(payload->>'event_id') is distinct from true then raise exception 'Not authorized: event custody owner';end if;
  schema_ready:=to_regprocedure('warehouse.record_event_outcome(jsonb)') is not null
    and to_regprocedure('private.assert_event_conversion_return(text,text,text,text,text)') is not null
    and (select count(*)=6 from pg_catalog.pg_trigger where not tgisinternal and tgenabled='O'
      and tgname in ('capture_acknowledged_event_custody','event_allocation_source','aa_event_custody_return_write','event_custody_settlement','event_custody_close','event_custody_new_order'));
  caps_ready:=(select count(*)=2 from core.capabilities where module='events' and cap in ('view_event_custody','record_event_outcome'))
    and exists(select 1 from core.roles where module='events' and role='seller' and is_active)
    and (select count(*)=2 and bool_and(cap in ('view_event_custody','record_event_outcome')) from core.role_capabilities where module='events' and role='seller')
    and exists(select 1 from learning.mutation_capability_rules where module='events' and capability='record_event_outcome');
  if to_regprocedure('private.event_seller_learning_ready()') is not null then execute 'select private.event_seller_learning_ready()' into learning_ready;end if;
  return jsonb_build_object('schema',coalesce(schema_ready,false),'capabilities',coalesce(caps_ready,false),'learning',coalesce(learning_ready,false),
    'ready',coalesce(schema_ready and caps_ready and learning_ready,false));
end $$;
create function warehouse.configure_event_custody(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e warehouse.events; started jsonb; target uuid; action text:=payload->>'action'; result jsonb;
begin
  if private.is_event_custody_owner(payload->>'event_id') is distinct from true then raise exception 'Not authorized: event custody owner';end if;
  started:=private.begin_idempotent_command('configure_event_custody',payload->>'idempotency_key',payload);
  if (started->>'replayed')::boolean then return started->'response';end if;
  select * into e from warehouse.events where id=payload->>'event_id' for update;
  if private.is_event_custody_owner(e.id) is distinct from true then raise exception 'Not authorized: event custody owner';end if;
  if e.status in ('closed','cancelled') then raise exception 'Event is closed';end if;
  if action='enable' then
    if (warehouse.event_custody_readiness(payload)->>'ready')::boolean is distinct from true then raise exception 'Event custody rollout prerequisites are not ready';end if;
    if not exists(select 1 from private.event_custody_sessions where event_id=e.id) and (
      exists(select 1 from warehouse.allocations where event_id=e.id)
      or exists(select 1 from warehouse.movements where event_id=e.id and type in ('issue','fulfillment_release','return'))
      or exists(select 1 from warehouse.returns where event_id=e.id)) then
      raise exception 'Historical custody lineage unresolved; enable only before the first issue';
    end if;
    insert into private.event_custody_sessions(event_id,enabled,configured_by) values(e.id,true,auth.uid())
      on conflict(event_id) do update set enabled=true,configured_by=auth.uid();
  elsif action='disable' then
    update private.event_custody_sessions set enabled=false,configured_by=auth.uid() where event_id=e.id;
  elsif action in ('assign','revoke') then
    if not exists(select 1 from private.event_custody_sessions where event_id=e.id and enabled) then raise exception 'Event custody is disabled';end if;
    target:=nullif(payload->>'user_id','')::uuid;
    if target is null then select id into target from core.profiles where lower(email)=lower(btrim(payload->>'seller_email'));end if;
    if action='assign' then
      if not exists(select 1 from core.profiles where id=target and status='active' and nullif(btrim(full_name),'') is not null and nullif(btrim(email),'') is not null)
        or not exists(select 1 from core.user_roles where user_id=target and module='events' and role='seller')
        or exists(select 1 from core.user_roles where user_id=target and not ((module='events' and role='seller') or (module='core' and role='staff'))) then
        raise exception 'Use an active named event-limited seller account';
      end if;
      if ((coalesce(e.end_date,e.start_date)+1)::timestamp at time zone 'Asia/Manila')<=statement_timestamp() then raise exception 'Event seller period has ended';end if;
      insert into private.event_sellers(event_id,user_id,valid_from,valid_until)
        values(e.id,target,e.start_date::timestamp at time zone 'Asia/Manila',(coalesce(e.end_date,e.start_date)+1)::timestamp at time zone 'Asia/Manila')
        on conflict(event_id,user_id) do update set valid_from=excluded.valid_from,valid_until=excluded.valid_until,revoked_at=null;
    else update private.event_sellers set revoked_at=clock_timestamp() where event_id=e.id and user_id=target;end if;
  else raise exception 'Unknown custody setup action';end if;
  insert into private.event_custody_setup_log(event_id,actor_id,action,detail) values(e.id,auth.uid(),action,payload-'idempotency_key');
  result:=jsonb_build_object('event_id',e.id,'action',action,'user_id',target);
  return private.finish_idempotent_command((started->>'command_id')::uuid,result);
end $$;

create function warehouse.event_demand_availability(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ids text[]; result jsonb;
begin
  if auth.uid() is null or core.has_live_cap('events','request_fulfillment') is distinct from true then raise exception 'Not authorized: events.request_fulfillment';end if;
  if not exists(select 1 from warehouse.events where id=payload->>'event_id' and status not in ('closed','cancelled')) then raise exception 'Active event required';end if;
  if jsonb_typeof(payload->'product_ids') is distinct from 'array' or jsonb_array_length(payload->'product_ids')>100 then raise exception 'Invalid demand products';end if;
  if exists(select 1 from jsonb_array_elements(payload->'product_ids') p where jsonb_typeof(p)<>'string') then raise exception 'Invalid demand products';end if;
  ids:=array(select distinct value from jsonb_array_elements_text(payload->'product_ids'));
  if exists(select 1 from unnest(ids) id where not exists(select 1 from warehouse.products p where p.id=id and p.item_class in ('sellable_sku','merchandise','event_material'))) then raise exception 'Invalid event product';end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id',id,'eligible_quantity',greatest(0,warehouse.available_to_promise(id))) order by id),'[]'::jsonb) into result from unnest(ids) id;
  return result;
end $$;

create function private.assert_event_custody_open(p_event text) returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from warehouse.events where id=p_event for update;
  if exists(select 1 from private.event_custody_sessions where event_id=p_event) and (
    exists(select 1 from warehouse.events where id=p_event and status in ('closed','cancelled')) or
    exists(select 1 from warehouse.event_reconciliations where event_id=p_event and status in ('submitted','approved'))) then
    raise exception 'Event settlement is locked; no new demand or custody';end if;
end $$;
create function private.guard_event_custody_new_order() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.assert_event_custody_open(new.event_id);return new;end $$;
create trigger event_custody_new_order before insert on warehouse.fulfillment_orders for each row execute function private.guard_event_custody_new_order();
create function private.assert_event_demand(payload jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_event_custody_open(payload->>'event_id');
  if jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines') not between 1 and 100 then raise exception 'One to 100 demand lines required';end if;
  if exists(select 1 from jsonb_array_elements(payload->'lines') l where jsonb_typeof(l->'quantity') is distinct from 'number'
    or (l->>'quantity')::numeric not between 1 and 2147483647 or (l->>'quantity')::numeric<>trunc((l->>'quantity')::numeric)) then raise exception 'Positive whole demand quantity required';end if;
  if exists(select 1 from jsonb_array_elements(payload->'lines') l group by l->>'productId' having count(*)>1) then raise exception 'Duplicate demand product';end if;
end $$;
do $$ declare definition text:=pg_get_functiondef('warehouse.request_event_fulfillment_uncertified_impl(jsonb)'::regprocedure);
anchor text:='v_command_id := (v_started->>''command_id'')::uuid;';
begin
  if strpos(definition,anchor)=0 then raise exception 'Event demand replay boundary drift; review before migrating';end if;
  execute replace(definition,anchor,anchor||E'\n  perform private.assert_event_demand(payload);');
end $$;

-- An acknowledgment is the only source of this prospective custody projection.
-- No issue RPC or inventory decrement is called here.
create function private.capture_acknowledged_event_custody() returns trigger language plpgsql security definer set search_path='' as $$
declare gate private.event_custody_sessions; line jsonb; product warehouse.products; serials text[]; serial text; allocation text; qty integer; unit warehouse.inventory_units;
begin
  if new.event_id is null or new.acknowledged_at is null or old.acknowledged_at is not null then return new;end if;
  select * into gate from private.event_custody_sessions where event_id=new.event_id;
  if not found then return new;end if;
  perform private.assert_event_custody_open(new.event_id);
  perform 1 from warehouse.events where id=new.event_id and status not in ('closed','cancelled') for update;
  if not found then raise exception 'Event is closed';end if;
  select * into gate from private.event_custody_sessions where event_id=new.event_id;
  if not gate.enabled then raise exception 'Event custody is disabled';end if;
  if new.created_at<gate.created_at or new.status<>'completed' or new.acknowledged_by is null then raise exception 'Acknowledged custody lineage unresolved';end if;
  if exists(select 1 from private.event_custody_sources where order_id=new.id) then raise exception 'Acknowledged custody already captured';end if;
  if exists(select 1 from warehouse.allocations a where a.event_id=new.event_id and not exists(
    select 1 from private.event_custody_sources s where s.allocation_id=a.id)) then raise exception 'Unresolved allocation custody';end if;
  for line in select value from jsonb_array_elements(new.lines) order by value->>'productId' loop
    select * into product from warehouse.products where id=line->>'productId';
    qty:=(line->>'quantity')::integer;
    if not found or qty<1 then raise exception 'Invalid acknowledged product';end if;
    serials:=array(select upper(btrim(value)) from jsonb_array_elements_text(coalesce(line->'pickedSerialNumbers','[]'::jsonb)) order by 1);
    if product.serialized then
      if cardinality(serials)<>qty or (select count(distinct x) from unnest(serials) x)<>qty then raise exception 'Acknowledged serial custody is not unique';end if;
      foreach serial in array serials loop
        select * into unit from warehouse.inventory_units where serial_number=serial and product_id=product.id for update;
        if not found or unit.status<>'issued' or unit.assigned_to is distinct from new.external_reference
          or (unit.event_id is not null and unit.event_id<>new.event_id) then raise exception 'Acknowledged serial custody mismatch';end if;
        if (select count(*) from warehouse.movements m where m.type='fulfillment_release' and m.reference=new.id::text
          and m.event_id=new.event_id and m.product_id=product.id and m.serial_number=serial and m.quantity=1)<>1 then raise exception 'Exact issued serial lineage missing';end if;
        if exists(select 1 from private.event_custody_sources s where serial=any(s.serial_numbers) and not exists(
          select 1 from warehouse.returns r,lateral jsonb_array_elements(r.lines) l where r.event_id=s.event_id and r.source='event'
            and l->>'allocationId'=s.allocation_id and l->>'serialNumber'=serial)) then raise exception 'Serial already has event custody';end if;
      end loop;
    elsif cardinality(serials)>0 then raise exception 'Bulk custody cannot carry serials';end if;
    if (select coalesce(sum(m.quantity),0) from warehouse.movements m where m.type='fulfillment_release' and m.reference=new.id::text
      and m.event_id=new.event_id and m.product_id=product.id)<>qty then raise exception 'Exact issued quantity lineage missing';end if;
    allocation:='event-custody-'||new.id||'-'||product.id;
    insert into warehouse.allocations(id,event_id,product_id,quantity,status) values(allocation,new.event_id,product.id,qty,'issued');
    insert into private.event_custody_sources(allocation_id,event_id,order_id,product_id,quantity,serial_numbers,acknowledged_at)
      values(allocation,new.event_id,new.id,product.id,qty,serials,new.acknowledged_at);
    update warehouse.inventory_units set event_id=new.event_id where product_id=product.id and serial_number=any(serials);
  end loop;
  return new;
end $$;
create trigger capture_acknowledged_event_custody after update of acknowledged_at on warehouse.fulfillment_orders
for each row execute function private.capture_acknowledged_event_custody();

create function private.lock_event_fulfillment_custody(p_order_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from warehouse.events e where e.id=(select event_id from warehouse.fulfillment_orders where id=p_order_id) for update;
end $$;
do $$ declare definition text:=pg_get_functiondef('private.warehouse_advance_fulfillment_order_v2(jsonb)'::regprocedure);
anchor text:='v_command_id := (v_started->>''command_id'')::uuid;';
begin
  if strpos(definition,anchor)=0 then raise exception 'Fulfillment replay boundary drift; review before migrating';end if;
  execute replace(definition,anchor,anchor||E'\n  perform private.lock_event_fulfillment_custody((payload->>''order_id'')::uuid);');
end $$;

-- Serialize opt-in with legacy event mutations before any allocation/product lock.
create function private.lock_legacy_event_custody(p_event text) returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from warehouse.events where id=p_event for update;
  if exists(select 1 from private.event_custody_sessions where event_id=p_event) then raise exception 'Gated event custody requires the acknowledged demand fulfillment path';end if;
end $$;
do $$ declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('warehouse.reserve_uncertified_impl(jsonb)'::regprocedure);
  anchor:='perform private.lock_warehouse_products(array[v_pid]);';
  if strpos(definition,anchor)=0 then raise exception 'Reserve lock boundary drift; review before migrating';end if;
  execute replace(definition,anchor,E'perform private.lock_legacy_event_custody(payload#>>''{allocation,event_id}'');\n  '||anchor);
  definition:=pg_get_functiondef('warehouse.issue_uncertified_impl(jsonb)'::regprocedure);
  anchor:='select * into v_alloc';
  if strpos(definition,anchor)=0 then raise exception 'Issue lock boundary drift; review before migrating';end if;
  execute replace(definition,anchor,E'perform private.lock_legacy_event_custody((select event_id from warehouse.allocations where id=payload->>''allocation_id''));\n  '||anchor);
end $$;

create function private.guard_event_allocation_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and exists(select 1 from private.event_custody_sources where allocation_id=old.id) then
    if new.id<>old.id or new.event_id<>old.event_id or new.product_id<>old.product_id or new.quantity<>old.quantity then
      raise exception 'Acknowledged event custody identity is immutable';end if;
    if new.status not in ('issued','returned') then raise exception 'Acknowledged event custody status cannot be cancelled or reserved';end if;
    return new;
  end if;
  if exists(select 1 from private.event_custody_sessions where event_id=new.event_id) and not exists(
    select 1 from warehouse.fulfillment_orders o,lateral jsonb_array_elements(o.lines) l
    where o.event_id=new.event_id and o.status='completed' and o.acknowledged_at is not null
      and new.id='event-custody-'||o.id||'-'||new.product_id and new.status='issued'
      and l->>'productId'=new.product_id and (l->>'quantity')::integer=new.quantity) then
    raise exception 'Gated event custody requires the acknowledged demand fulfillment path';
  end if;
  return new;
end $$;
create trigger event_allocation_source before insert or update on warehouse.allocations
for each row execute function private.guard_event_allocation_source();

create function private.event_allocation_remaining(p_allocation text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source private.event_custody_sources; returned bigint; sold bigint; giveaway bigint; eligible text[];
begin
  select * into source from private.event_custody_sources where allocation_id=p_allocation;
  if not found then raise exception 'Event custody lineage unresolved';end if;
  if exists(select 1 from warehouse.returns r,lateral jsonb_array_elements(r.lines) l where r.event_id=source.event_id
    and l->>'productId'=source.product_id and nullif(l->>'allocationId','') is null) then raise exception 'Historical return lineage unresolved';end if;
  select coalesce(sum((l->>'quantity')::bigint),0) into returned from warehouse.returns r,lateral jsonb_array_elements(r.lines) l
    where r.event_id=source.event_id and l->>'allocationId'=p_allocation;
  select coalesce(sum(e.quantity) filter(where e.kind='sale'),0),coalesce(sum(e.quantity) filter(where e.kind='giveaway'),0) into sold,giveaway
    from private.event_custody_entries e where e.allocation_id=p_allocation and e.kind<>'reversal'
      and not exists(select 1 from private.event_custody_entries reversal where reversal.reverses_id=e.id);
  select coalesce(array_agg(s order by s),'{}') into eligible from unnest(source.serial_numbers) s where
    not exists(select 1 from private.event_custody_entries e where e.allocation_id=p_allocation and s=any(e.serial_numbers)
      and e.kind<>'reversal' and not exists(select 1 from private.event_custody_entries r where r.reverses_id=e.id))
    and not exists(select 1 from warehouse.returns r,lateral jsonb_array_elements(r.lines) l where l->>'allocationId'=p_allocation and l->>'serialNumber'=s)
    and exists(select 1 from warehouse.inventory_units u where u.product_id=source.product_id and u.serial_number=s and u.status='issued' and u.event_id=source.event_id)
    and not exists(select 1 from warehouse.inventory_holds h where h.serial_number=s and h.status='active');
  if returned+sold+giveaway>source.quantity then raise exception 'Event custody balance is invalid';end if;
  return jsonb_build_object('allocation_id',p_allocation,'event_id',source.event_id,'product_id',source.product_id,
    'issued_units',source.quantity,'returned_units',returned,'sold_units',sold,'giveaway_units',giveaway,
    'remaining_units',source.quantity-returned-sold-giveaway,'eligible_serials',eligible,'serialized',cardinality(source.serial_numbers)>0);
end $$;

create function warehouse.record_event_outcome(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare started jsonb; e warehouse.events; source private.event_custody_sources; balance jsonb;
  original private.event_custody_entries; entry private.event_custody_entries; serials text[]; qty integer; amount numeric; kind text:=payload->>'kind';
begin
  if private.is_event_seller(payload->>'event_id') is distinct from true or core.has_live_cap('events','record_event_outcome') is distinct from true then raise exception 'Not authorized: assigned event seller';end if;
  started:=private.begin_idempotent_command('record_event_outcome',payload->>'idempotency_key',payload);
  if (started->>'replayed')::boolean then return started->'response';end if;
  select * into e from warehouse.events where id=payload->>'event_id' for update;
  if private.is_event_seller(e.id) is distinct from true or core.has_live_cap('events','record_event_outcome') is distinct from true then raise exception 'Not authorized: assigned event seller';end if;
  if e.status in ('closed','cancelled') then raise exception 'Event is closed';end if;
  if not exists(select 1 from private.event_custody_sessions where event_id=e.id and enabled) then raise exception 'Event custody is disabled';end if;
  if exists(select 1 from warehouse.event_reconciliations where event_id=e.id and status in ('submitted','approved')) then raise exception 'Event settlement is locked; reopen through governed review';end if;
  perform 1 from warehouse.allocations where id=payload->>'allocation_id' and event_id=e.id for update;
  select * into source from private.event_custody_sources where allocation_id=payload->>'allocation_id' and event_id=e.id;
  if not found then raise exception 'Event custody lineage unresolved';end if;
  perform 1 from warehouse.products where id=source.product_id for update;
  perform 1 from warehouse.inventory_units where product_id=source.product_id and serial_number=any(source.serial_numbers) order by serial_number for update;
  if nullif(btrim(payload->>'external_reference'),'') is null or length(btrim(payload->>'external_reference'))>120 then raise exception 'External reference is required';end if;
  if exists(select 1 from private.event_custody_entries where event_id=e.id and external_reference=btrim(payload->>'external_reference')) then raise exception 'Duplicate external reference for event';end if;
  if kind='reversal' then
    select x.* into original from private.event_custody_entries x where x.id=(payload->>'reverses_id')::uuid and x.allocation_id=source.allocation_id and x.event_id=e.id and x.seller_id=auth.uid() and x.kind<>'reversal';
    if not found then raise exception 'Not authorized: reverse only your own event outcome';end if;
    if exists(select 1 from private.event_custody_entries where reverses_id=original.id) then raise exception 'Outcome already reversed';end if;
    if nullif(btrim(payload->>'reason'),'') is null then raise exception 'Reversal reason required';end if;
    qty:=original.quantity;amount:=original.amount;serials:=original.serial_numbers;
  elsif kind in ('sale','giveaway') then
    if jsonb_typeof(payload->'quantity') is distinct from 'number' or (payload->>'quantity')::numeric<>trunc((payload->>'quantity')::numeric)
      or (payload->>'quantity')::numeric not between 1 and 2147483647 then raise exception 'Positive whole quantity required';end if;
    qty:=(payload->>'quantity')::integer;
    if jsonb_typeof(payload->'amount') is distinct from 'number' or (payload->>'amount')::numeric<0
      or (payload->>'amount')::numeric<>round((payload->>'amount')::numeric,2) then raise exception 'Nonnegative exact currency amount required';end if;
    amount:=(payload->>'amount')::numeric;
    if (kind='giveaway' and amount<>0) or (kind='sale' and amount<=0) then raise exception 'Sales require an amount; giveaways require zero';end if;
    if jsonb_typeof(payload->'serial_numbers') is distinct from 'array' then raise exception 'Serial numbers must be an array';end if;
    serials:=array(select upper(btrim(value)) from jsonb_array_elements_text(payload->'serial_numbers') order by 1);
    balance:=private.event_allocation_remaining(source.allocation_id);
    if qty>(balance->>'remaining_units')::integer then raise exception 'Quantity exceeds remaining event custody';end if;
    if cardinality(source.serial_numbers)>0 then
      if cardinality(serials)<>qty or (select count(distinct s) from unnest(serials) s)<>qty
        or exists(select 1 from unnest(serials) s where not (balance->'eligible_serials' ? s)) then raise exception 'Serial unavailable in remaining event custody';end if;
    elsif cardinality(serials)>0 then raise exception 'Bulk event custody cannot carry serials';end if;
  else raise exception 'Unknown event outcome';end if;
  insert into private.event_custody_entries(event_id,allocation_id,seller_id,kind,quantity,serial_numbers,amount,external_reference,reverses_id,reason)
    values(e.id,source.allocation_id,auth.uid(),kind,qty,serials,amount,btrim(payload->>'external_reference'),original.id,nullif(btrim(payload->>'reason'),'')) returning * into entry;
  return private.finish_idempotent_command((started->>'command_id')::uuid,to_jsonb(entry));
end $$;

create function warehouse.event_custody_ledger(payload jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare privileged boolean; result jsonb; entries jsonb; totals jsonb; offset_rows integer:=coalesce((payload->>'offset')::integer,0);
begin
  privileged:=private.is_event_custody_owner(payload->>'event_id') or (auth.uid() is not null and core.has_cap('events','approve_settlement'));
  if not coalesce(privileged,false) and private.is_event_seller(payload->>'event_id') is distinct from true then raise exception 'Not authorized: event custody read';end if;
  if offset_rows<0 then raise exception 'Invalid ledger offset';end if;
  select coalesce(jsonb_agg(private.event_allocation_remaining(s.allocation_id) order by s.product_id),'[]') into result
    from private.event_custody_sources s where s.event_id=payload->>'event_id';
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into entries from(select e.* from private.event_custody_entries e
    where e.event_id=payload->>'event_id' and (privileged or e.seller_id=auth.uid()) order by e.created_at,e.id limit 100 offset offset_rows) x;
  select jsonb_build_object('sold_units',coalesce(sum(e.quantity) filter(where e.kind='sale'),0),
    'giveaway_units',coalesce(sum(e.quantity) filter(where e.kind='giveaway'),0),'gross_sales_amount',coalesce(sum(e.amount) filter(where e.kind='sale'),0)) into totals
    from private.event_custody_entries e where e.event_id=payload->>'event_id' and e.kind<>'reversal' and (privileged or e.seller_id=auth.uid())
      and not exists(select 1 from private.event_custody_entries r where r.reverses_id=e.id);
  return jsonb_build_object('event_id',payload->>'event_id','allocations',result,'entries',entries,'totals',totals,
    'event_name',(select name from warehouse.events where id=payload->>'event_id'),
    'readiness',case when private.is_event_custody_owner(payload->>'event_id') then warehouse.event_custody_readiness(payload) else null end,
    'may_configure',private.is_event_custody_owner(payload->>'event_id'),
    'event_status',(select status from warehouse.events where id=payload->>'event_id'),
    'sellers',case when private.is_event_custody_owner(payload->>'event_id') then (select coalesce(jsonb_agg(jsonb_build_object(
      'user_id',s.user_id,'full_name',p.full_name,'email',p.email,'valid_until',s.valid_until,'revoked_at',s.revoked_at)),'[]')
      from private.event_sellers s join core.profiles p on p.id=s.user_id where s.event_id=payload->>'event_id') else '[]'::jsonb end,
    'next_offset',case when jsonb_array_length(entries)=100 then offset_rows+100 end,
    'enabled',coalesce((select enabled from private.event_custody_sessions where event_id=payload->>'event_id'),false));
end $$;
create function warehouse.my_event_custody_events(payload jsonb default '{}') returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'status',e.status,'start_date',e.start_date,'end_date',e.end_date) order by e.start_date),'[]')
  from warehouse.events e where private.is_event_seller(e.id)
$$;

create function private.assert_event_return_payload(payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare event text:=payload#>>'{return,event_id}';line jsonb;source private.event_custody_sources;balance jsonb; incoming record;
begin
  if payload#>>'{return,source}' is distinct from 'event' or not exists(select 1 from private.event_custody_sessions where event_id=event) then return;end if;
  if jsonb_typeof(payload#>'{return,lines}') is distinct from 'array' or jsonb_array_length(payload#>'{return,lines}') not between 1 and 1000 then raise exception 'Invalid event return lines';end if;
  if exists(select 1 from jsonb_array_elements(payload#>'{return,lines}') l where jsonb_typeof(l->'quantity') is distinct from 'number'
    or (l->>'quantity')::numeric not between 1 and 2147483647 or (l->>'quantity')::numeric<>trunc((l->>'quantity')::numeric)) then raise exception 'Positive whole return quantity required';end if;
  if exists(select 1 from jsonb_array_elements(payload#>'{return,lines}') l where nullif(btrim(l->>'serialNumber'),'') is not null
    group by upper(btrim(l->>'serialNumber')) having count(*)>1) then raise exception 'Duplicate serial in event return';end if;
  perform 1 from warehouse.events where id=event and status not in ('closed','cancelled') for update;
  if not found then raise exception 'Event is closed';end if;
  perform 1 from warehouse.allocations where event_id=event and id in(select coalesce(nullif(l->>'allocationId',''),nullif(payload->>'allocation_id','')) from jsonb_array_elements(payload#>'{return,lines}') l) order by id for update;
  for incoming in select coalesce(nullif(l->>'allocationId',''),nullif(payload->>'allocation_id','')) allocation_id,sum((l->>'quantity')::numeric) qty
    from jsonb_array_elements(payload#>'{return,lines}') l group by 1 loop
    balance:=private.event_allocation_remaining(incoming.allocation_id);
    if balance->>'event_id' is distinct from event or incoming.qty>(balance->>'remaining_units')::numeric then raise exception 'Return exceeds remaining event custody';end if;
  end loop;
  for line in select value from jsonb_array_elements(payload#>'{return,lines}') loop
    select * into source from private.event_custody_sources where allocation_id=coalesce(nullif(line->>'allocationId',''),nullif(payload->>'allocation_id',''));
    if not found or source.event_id<>event or source.product_id is distinct from line->>'productId' then raise exception 'Return custody lineage unresolved';end if;
    if cardinality(source.serial_numbers)>0 then
      balance:=private.event_allocation_remaining(source.allocation_id);
      if (line->>'quantity')::numeric<>1 or not (balance->'eligible_serials' ? upper(btrim(coalesce(line->>'serialNumber','')))) then raise exception 'Serial unavailable in remaining event custody';end if;
    elsif nullif(btrim(line->>'serialNumber'),'') is not null then raise exception 'Bulk return cannot carry a serial';end if;
  end loop;
end $$;
-- Guard after the retained command replay boundary, before its event/product locks.
do $$ declare definition text:=pg_get_functiondef('warehouse.record_return_v2_certified_impl(jsonb)'::regprocedure);
anchor text:='v_command_id := (v_started->>''command_id'')::uuid;';
begin
  if strpos(definition,anchor)=0 then raise exception 'Return replay boundary drift; review before migrating';end if;
  execute replace(definition,anchor,anchor||E'\n  perform private.assert_event_return_payload(payload);');
end $$;
create or replace function warehouse.record_return_v2(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required';end if;
  if core.has_live_cap('warehouse','manage_returns') is distinct from true then raise exception 'Not authorized: warehouse.manage_returns';end if;
  return warehouse.record_return_v2_certified_impl(payload);
end $$;

create function private.assert_event_conversion_return(p_return_id text,p_allocation_id text,p_event_id text,p_product_id text,p_serial_number text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from warehouse.events where id=p_event_id for update;
  perform 1 from warehouse.allocations where id=p_allocation_id and event_id=p_event_id for update;
  if not exists(select 1 from private.event_custody_sources s where s.allocation_id=p_allocation_id and s.event_id=p_event_id
      and s.product_id=p_product_id and p_serial_number=any(s.serial_numbers))
    or not exists(select 1 from warehouse.returns r,lateral jsonb_array_elements(r.lines) l where r.id=p_return_id and r.source='event'
      and r.event_id=p_event_id and l->>'allocationId'=p_allocation_id and l->>'productId'=p_product_id and l->>'serialNumber'=p_serial_number and (l->>'quantity')::integer=1)
    or exists(select 1 from private.event_custody_sources newer join private.event_custody_sources original on original.allocation_id=p_allocation_id
      where newer.created_at>original.created_at and p_serial_number=any(newer.serial_numbers))
    or exists(select 1 from private.event_custody_entries e where e.allocation_id=p_allocation_id and p_serial_number=any(e.serial_numbers)
      and e.kind<>'reversal' and not exists(select 1 from private.event_custody_entries r where r.reverses_id=e.id)) then
    raise exception 'Verified unsold event return lineage required';
  end if;
end $$;

create function private.guard_event_custody_return_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op<>'INSERT' then
    if exists(select 1 from private.event_custody_sessions where event_id=old.event_id) then raise exception 'Event custody returns are immutable';end if;
    if tg_op='DELETE' then return old;end if;
  end if;
  perform private.assert_event_return_payload(jsonb_build_object('return',to_jsonb(new)));
  return new;
end $$;
create trigger aa_event_custody_return_write before insert or update or delete on warehouse.returns
for each row execute function private.guard_event_custody_return_write();

create function private.guard_event_custody_settlement() returns trigger language plpgsql security definer set search_path='' as $$
declare sold bigint;giveaway bigint;gross numeric; returned bigint; remaining bigint;
begin
  if not exists(select 1 from private.event_custody_sessions where event_id=new.event_id) or new.status='draft' then return new;end if;
  perform 1 from warehouse.events where id=new.event_id for update;
  if exists(select 1 from warehouse.fulfillment_orders where event_id=new.event_id and status<>'cancelled' and acknowledged_at is null)
    or exists(select 1 from warehouse.department_stock_requests where event_id=new.event_id and fulfillment_order_id is null and status not in ('rejected','cancelled')) then
    raise exception 'Outstanding event handover or demand prevents settlement';end if;
  select coalesce(sum(e.quantity) filter(where e.kind='sale'),0),coalesce(sum(e.quantity) filter(where e.kind='giveaway'),0),
    coalesce(sum(e.amount) filter(where e.kind='sale'),0) into sold,giveaway,gross from private.event_custody_entries e
    where e.event_id=new.event_id and e.kind<>'reversal' and not exists(select 1 from private.event_custody_entries r where r.reverses_id=e.id);
  if new.sold_units is distinct from sold or new.giveaway_units is distinct from giveaway or new.gross_sales_amount is distinct from gross then raise exception 'Settlement must match the event custody ledger';end if;
  select coalesce(sum((b->>'returned_units')::bigint),0),coalesce(sum((b->>'remaining_units')::bigint),0) into returned,remaining
    from private.event_custody_sources s cross join lateral private.event_allocation_remaining(s.allocation_id) b where s.event_id=new.event_id;
  if new.returned_units is distinct from returned or remaining<>0 or new.lost_units is distinct from 0 or new.damaged_units is distinct from 0 or new.rekit_units is distinct from 0 then
    raise exception 'Settlement requires resolved physical event custody; unsupported exceptions need governed review';end if;
  return new;
end $$;
create trigger event_custody_settlement before insert or update on warehouse.event_reconciliations
for each row execute function private.guard_event_custody_settlement();

create function private.guard_event_custody_close() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('closed','cancelled') and exists(select 1 from private.event_custody_sessions where event_id=new.id)
    and exists(select 1 from warehouse.fulfillment_orders o where o.event_id=new.id and o.status<>'cancelled' and o.acknowledged_at is null) then
    raise exception 'Outstanding event handover prevents closure or cancellation';end if;
  if new.status in ('closed','cancelled') and exists(select 1 from private.event_custody_sessions where event_id=new.id)
    and exists(select 1 from private.event_custody_sources s where s.event_id=new.id and
      (private.event_allocation_remaining(s.allocation_id)->>'remaining_units')::bigint<>0) then raise exception 'Unresolved event custody prevents closure';end if;
  return new;
end $$;
create trigger event_custody_close before update of status on warehouse.events for each row execute function private.guard_event_custody_close();

revoke all on function private.event_custody_immutable(),private.is_event_seller(text),private.is_event_custody_owner(text),
  private.capture_acknowledged_event_custody(),private.event_allocation_remaining(text),private.assert_event_return_payload(jsonb),
  private.assert_event_conversion_return(text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function private.guard_event_custody_return_write(),private.guard_event_custody_settlement(),private.guard_event_custody_close() from public,anon,authenticated,service_role;
revoke all on function private.lock_event_fulfillment_custody(uuid),private.guard_event_allocation_source() from public,anon,authenticated,service_role;
revoke all on function private.lock_legacy_event_custody(text) from public,anon,authenticated,service_role;
revoke all on function private.assert_event_custody_open(text),private.guard_event_custody_new_order() from public,anon,authenticated,service_role;
revoke all on function private.assert_event_demand(jsonb) from public,anon,authenticated,service_role;
revoke all on function warehouse.configure_event_custody(jsonb),warehouse.record_event_outcome(jsonb),warehouse.event_custody_ledger(jsonb),warehouse.my_event_custody_events(jsonb) from public,anon,service_role;
grant execute on function warehouse.configure_event_custody(jsonb),warehouse.record_event_outcome(jsonb),warehouse.event_custody_ledger(jsonb),warehouse.my_event_custody_events(jsonb) to authenticated;
revoke all on function warehouse.event_demand_availability(jsonb) from public,anon,service_role;
grant execute on function warehouse.event_demand_availability(jsonb) to authenticated;
revoke all on function warehouse.event_custody_readiness(jsonb) from public,anon,service_role;
grant execute on function warehouse.event_custody_readiness(jsonb) to authenticated;
revoke all on function warehouse.record_return_v2(jsonb) from public,anon;
grant execute on function warehouse.record_return_v2(jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
