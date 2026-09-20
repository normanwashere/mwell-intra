-- Additive, opt-in stock conversion. Existing customer-return re-kit RPCs are
-- unchanged. No recipes, capabilities, inventory or event history are seeded.
create table private.stock_conversion_recipes (
  id uuid primary key default gen_random_uuid(),
  kit_definition_id uuid not null references warehouse.kit_definitions(id) on delete restrict,
  kit_version integer not null,
  event_id text not null references warehouse.events(id) on delete restrict,
  direction text not null check (direction in ('conversion','recovery')),
  source_product_id text not null references warehouse.products(id) on delete restrict,
  output_product_id text not null references warehouse.products(id) on delete restrict,
  packaging jsonb not null check (jsonb_typeof(packaging)='array'),
  approval_reference text not null check (length(btrim(approval_reference)) > 0),
  evidence_urls jsonb not null,
  approved_by uuid not null references core.profiles(id) on delete restrict,
  approved_at timestamptz not null default now(),
  check(source_product_id <> output_product_id)
);
create table private.stock_conversion_batches (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references private.stock_conversion_recipes(id) on delete restrict,
  event_id text not null references warehouse.events(id) on delete restrict,
  status text not null check(status in ('inspection','ready','completed','cancelled')),
  source_location_id text not null references warehouse.locations(id) on delete restrict,
  source_bin_id text not null references warehouse.storage_areas(id) on delete restrict,
  destination_location_id text not null references warehouse.locations(id) on delete restrict,
  destination_bin_id text not null references warehouse.storage_areas(id) on delete restrict,
  units jsonb not null check(jsonb_typeof(units)='array' and jsonb_array_length(units) between 1 and 100),
  condition text check(condition='open_box'),
  evidence_urls jsonb not null,
  approval_evidence_urls jsonb,
  completion_evidence_urls jsonb,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_by uuid references core.profiles(id) on delete restrict,
  approved_at timestamptz,
  completed_by uuid references core.profiles(id) on delete restrict,
  completed_at timestamptz,
  cancelled_by uuid references core.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  cancellation_reason text,
  check(approved_by is null or approved_by <> created_by),
  check(completed_by is null or completed_by <> approved_by)
);
create table private.stock_conversion_claims (
  batch_id uuid not null references private.stock_conversion_batches(id) on delete restrict,
  unit_id text not null references warehouse.inventory_units(id) on delete restrict,
  serial_number text not null,
  original_lot_id text,
  original_event_id text,
  released_at timestamptz,
  primary key(batch_id,unit_id)
);
create unique index stock_conversion_active_unit on private.stock_conversion_claims(unit_id) where released_at is null;
create table private.stock_conversion_parts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references private.stock_conversion_batches(id) on delete restrict,
  product_id text not null references warehouse.products(id) on delete restrict,
  location_id text not null,
  bin_id text not null,
  lot_id text,
  quantity integer not null check(quantity > 0),
  disposition text not null check(disposition in ('consume','recover','discard'))
);
create table private.stock_conversion_lines (
  sequence bigint generated always as identity unique,
  applied_xid xid8 not null default pg_current_xact_id(),
  applied_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  batch_id uuid not null references private.stock_conversion_batches(id) on delete restrict,
  unit_id text not null references warehouse.inventory_units(id) on delete restrict,
  serial_number text not null,
  source_product_id text not null,
  output_product_id text not null,
  source_lot_id text,
  inspection_id uuid not null references warehouse.quality_inspections(id) on delete restrict,
  return_id text references warehouse.returns(id) on delete restrict,
  allocation_id text,
  original_conversion_id uuid references private.stock_conversion_batches(id) on delete restrict,
  primary key(batch_id,unit_id)
);
create unique index stock_conversion_recovery_once on private.stock_conversion_lines(original_conversion_id,unit_id) where original_conversion_id is not null;
create index stock_conversion_recipe_event on private.stock_conversion_recipes(event_id);
create index stock_conversion_batch_recipe on private.stock_conversion_batches(recipe_id);
create index stock_conversion_batch_event on private.stock_conversion_batches(event_id,created_at desc);

alter table private.stock_conversion_recipes enable row level security;
alter table private.stock_conversion_batches enable row level security;
alter table private.stock_conversion_claims enable row level security;
alter table private.stock_conversion_parts enable row level security;
alter table private.stock_conversion_lines enable row level security;
revoke all on private.stock_conversion_recipes,private.stock_conversion_batches,private.stock_conversion_claims,private.stock_conversion_parts,private.stock_conversion_lines from public,anon,authenticated,service_role;

create or replace function private.stock_conversion_preserve_history()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Stock conversion history cannot be deleted or rewritten'; end;
$$;
create trigger stock_conversion_recipe_immutable before update or delete on private.stock_conversion_recipes for each row execute function private.stock_conversion_preserve_history();
create trigger stock_conversion_line_immutable before update or delete on private.stock_conversion_lines for each row execute function private.stock_conversion_preserve_history();
create trigger stock_conversion_batch_no_delete before delete on private.stock_conversion_batches for each row execute function private.stock_conversion_preserve_history();

create or replace function private.stock_conversion_product_transition(p_old warehouse.inventory_units,p_new warehouse.inventory_units)
returns boolean language sql volatile security definer set search_path='' as $$
  select p_old.id=p_new.id and p_old.serial_number=p_new.serial_number
    and p_old.status='conversion_pending' and p_new.status='in_stock'
    and coalesce(core.has_live_cap('warehouse','manage_returns'),false)
    and exists(select 1 from private.stock_conversion_lines l join private.stock_conversion_batches b on b.id=l.batch_id
      where l.unit_id=p_old.id and l.serial_number=p_new.serial_number
        and l.sequence=(select max(latest.sequence) from private.stock_conversion_lines latest where latest.unit_id=p_old.id)
        and l.applied_xid=pg_current_xact_id() and l.applied_by=auth.uid()
        and l.source_product_id=p_old.product_id and l.output_product_id=p_new.product_id
        and b.status='ready' and b.approved_by is not null and b.approved_by<>auth.uid() and b.approved_by<>b.created_by
        and p_new.location_id=b.destination_location_id and p_new.bin_id=b.destination_bin_id
        and p_new.assigned_to is null and p_new.event_id is null);
$$;

create or replace function private.stock_conversion_procurement_identity(
  p_old warehouse.inventory_units,p_new warehouse.inventory_units,p_claim_product text,p_claim_status text
) returns boolean language sql volatile security definer set search_path='' as $$
  select p_claim_status='posted' and p_old.id=p_new.id and p_old.serial_number=p_new.serial_number
    and exists(select 1 from private.stock_conversion_lines origin where origin.unit_id=p_old.id
      and origin.serial_number=p_new.serial_number and origin.source_product_id=p_claim_product)
    and (private.stock_conversion_product_transition(p_old,p_new)
      or (p_old.product_id=p_new.product_id and exists(
        select 1 from private.stock_conversion_lines l join private.stock_conversion_batches b on b.id=l.batch_id
        where l.unit_id=p_old.id and l.serial_number=p_new.serial_number and l.output_product_id=p_new.product_id
          and b.status='completed' and l.sequence=(select max(latest.sequence) from private.stock_conversion_lines latest where latest.unit_id=p_old.id))));
$$;

-- Retain normalization, shared serial locking, uniqueness and non-clean custody
-- denial. Only the posted clean source SKU may differ after governed conversion.
do $migration$
declare definition text:=pg_get_functiondef('private.normalize_inventory_unit_serial()'::regprocedure);
  anchor text:='or v_claim.product_id is distinct from new.product_id';
begin
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Procurement serial guard drift; review before installing conversion exception';
  end if;
  definition:=replace(definition,anchor,'or (v_claim.product_id is distinct from new.product_id
      and not (case when tg_op = ''UPDATE'' then coalesce(private.stock_conversion_procurement_identity(old,new,v_claim.product_id,v_claim.status),false) else false end))');
  execute definition;
end;
$migration$;

-- This also blocks legacy RPCs which do not know about conversion claims.
create or replace function private.stock_conversion_guard_claimed_unit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and exists(select 1 from private.stock_conversion_lines where unit_id=old.id) then
    if old.id is distinct from new.id or old.serial_number is distinct from new.serial_number then
      raise exception 'Converted device identity cannot be replaced';
    end if;
    if old.product_id is distinct from new.product_id and not coalesce(private.stock_conversion_product_transition(old,new),false) then
      raise exception 'Converted device product changes require a new approved conversion';
    end if;
  end if;
  if exists(select 1 from private.stock_conversion_claims where unit_id=old.id and released_at is null) then
    raise exception 'Device % is claimed by a stock conversion',old.serial_number;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger stock_conversion_claim_guard before update or delete on warehouse.inventory_units for each row execute function private.stock_conversion_guard_claimed_unit();

create or replace function private.stock_conversion_evidence(p_evidence jsonb)
returns void language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence) not between 1 and 20 then
    raise exception 'At least one HTTPS evidence reference is required';
  end if;
  if exists(select 1 from jsonb_array_elements(p_evidence) e where jsonb_typeof(e)<>'string'
    or (e#>>'{}') !~ '^https://[^/@[:space:]]+([/:?][^[:space:]]*)?$' or length(e#>>'{}') > 2048) then
    raise exception 'Valid HTTPS evidence references are required';
  end if;
end;
$$;

create or replace function private.stock_conversion_validate_unit(
  p_batch private.stock_conversion_batches,p_recipe private.stock_conversion_recipes,p_line jsonb,p_claimed boolean
) returns warehouse.inventory_units language plpgsql security definer set search_path='' as $$
declare u warehouse.inventory_units; q warehouse.quality_inspections; v_serial text:=p_line->>'serial_number';
begin
  if v_serial is null or btrim(v_serial)='' or (select count(*) from warehouse.inventory_units where upper(btrim(serial_number))=upper(btrim(v_serial)))<>1 then
    raise exception 'Device serial % is missing or ambiguous',v_serial;
  end if;
  select * into u from warehouse.inventory_units where serial_number=v_serial for update;
  if not found or u.product_id<>p_recipe.source_product_id or u.location_id<>p_batch.source_location_id
    or u.bin_id is distinct from p_batch.source_bin_id or u.assigned_to is not null
    or (p_recipe.direction='conversion' and u.event_id is not null)
    or (p_recipe.direction='recovery' and u.event_id is not null and u.event_id<>p_batch.event_id)
    or u.status is distinct from (case when p_claimed then 'conversion_pending' else 'in_stock' end) then
    raise exception 'Device % is not available in the selected source bin',v_serial;
  end if;
  if p_claimed and not exists(select 1 from private.stock_conversion_claims where batch_id=p_batch.id and unit_id=u.id and released_at is null) then
    raise exception 'Device % has no active batch claim',v_serial;
  end if;
  if exists(select 1 from warehouse.procurement_receipt_serial_claims c where upper(btrim(c.serial_number))=upper(btrim(u.serial_number)) and c.status in ('pending','held')) then
    raise exception 'Device % still has pending or held procurement custody',v_serial;
  end if;
  if exists(select 1 from warehouse.inventory_holds h where h.status='active' and h.product_id=u.product_id
    and (h.serial_number=u.serial_number or (h.serial_number is null and h.location_id=u.location_id
      and (h.bin_id is null or h.bin_id=u.bin_id) and (h.lot_id is null or h.lot_id is not distinct from u.lot_id)))) then
    raise exception 'Device % is held',v_serial;
  end if;
  if exists(select 1 from warehouse.fulfillment_reservations r where r.product_id=u.product_id and r.status='active'
      and (r.location_id is null or r.location_id=u.location_id) and (r.bin_id is null or r.bin_id=u.bin_id))
    or exists(select 1 from warehouse.allocations a where a.product_id=u.product_id and a.status in ('reserved','allocated')) then
    raise exception 'Source product has active allocations or reservations';
  end if;
  select * into q from warehouse.quality_inspections where id=(p_line->>'inspection_id')::uuid for share;
  if not found or q.disposition<>'accepted' or q.product_id<>u.product_id or q.serial_number is distinct from u.serial_number
    or q.quantity<>1 or q.location_id<>u.location_id or q.bin_id is distinct from u.bin_id
    or q.lot_id is distinct from u.lot_id or jsonb_array_length(q.evidence_urls)=0 then
    raise exception 'Device % requires an accepted exact-source inspection with evidence',v_serial;
  end if;
  if exists(select 1 from warehouse.quality_inspections newer where newer.serial_number=u.serial_number and newer.inspected_at>q.inspected_at)
    or exists(select 1 from warehouse.returns r cross join lateral jsonb_array_elements(r.lines) line
      where line->>'serialNumber'=u.serial_number and r.created_at>q.inspected_at) then
    raise exception 'Device % inspection is stale',v_serial;
  end if;
  if p_recipe.direction='recovery' then
    if q.source_type<>'return' or q.source_id is distinct from p_line->>'return_id' then
      raise exception 'Recovery requires the exact accepted return inspection';
    end if;
    if not exists(select 1 from private.stock_conversion_lines l
      join private.stock_conversion_batches b on b.id=l.batch_id
      join private.stock_conversion_recipes r on r.id=b.recipe_id
      where l.batch_id=(p_line->>'original_conversion_id')::uuid and l.unit_id=u.id and l.serial_number=u.serial_number
        and l.source_product_id=p_recipe.output_product_id and l.output_product_id=p_recipe.source_product_id
        and b.event_id=p_batch.event_id and b.status='completed' and r.direction='conversion'
        and r.kit_definition_id=p_recipe.kit_definition_id and r.kit_version=p_recipe.kit_version)
      or exists(select 1 from private.stock_conversion_lines where original_conversion_id=(p_line->>'original_conversion_id')::uuid and unit_id=u.id) then
      raise exception 'Recovery requires unused original conversion lineage for device %',v_serial;
    end if;
  elsif nullif(p_line->>'return_id','') is not null or nullif(p_line->>'original_conversion_id','') is not null then
    raise exception 'Stock-origin conversion cannot include recovery lineage';
  end if;
  return u;
end;
$$;

create or replace function warehouse.execute_stock_conversion(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_action text:=payload->>'action'; v_cap text; v_module text; started jsonb; command_id uuid;
  recipe private.stock_conversion_recipes; batch private.stock_conversion_batches;
  kit warehouse.kit_definitions; unit warehouse.inventory_units; part warehouse.stock_levels;
  line jsonb; component jsonb; packaging jsonb; claim record; v_need integer; v_take integer; v_count integer;
  v_serials text[]; v_products text[]; v_event text; v_result jsonb;
begin
  if v_action not in ('approve_recipe','create','approve','complete','cancel') or v_action is null then raise exception 'Invalid stock conversion action'; end if;
  v_module:=case when v_action='approve_recipe' then 'product' else 'warehouse' end;
  v_cap:=case v_action when 'approve_recipe' then 'decide_go_live' when 'approve' then 'inspect_quality' else 'manage_returns' end;
  if auth.uid() is null or not coalesce(core.has_live_cap(v_module,v_cap),false) then raise exception 'Not authorized: %.%',v_module,v_cap; end if;
  perform private.stock_conversion_evidence(payload->'evidence_urls');
  if payload ? 'output_serial_number' then raise exception 'Output serial numbers cannot be replaced'; end if;
  started:=private.begin_idempotent_command('stock_conversion_'||v_action,payload->>'idempotency_key',payload);
  if (started->>'replayed')::boolean then return started->'response'; end if;
  command_id:=(started->>'command_id')::uuid;
  if v_action in ('approve_recipe','create') then v_event:=payload->>'event_id';
  else select event_id into v_event from private.stock_conversion_batches where id=(payload->>'batch_id')::uuid; end if;
  perform 1 from warehouse.events where id=v_event for update;
  if not found then raise exception 'A saved event is required'; end if;
  if v_action<>'cancel' and exists(select 1 from warehouse.events where id=v_event and status='cancelled') then
    raise exception 'Cancelled events cannot execute conversion work';
  end if;
  if v_action='approve_recipe' and payload->>'direction'='conversion' and exists(select 1 from warehouse.events where id=v_event and status='closed') then
    raise exception 'Closed or cancelled events cannot start conversion work';
  end if;

  if v_action='approve_recipe' then
    select * into kit from warehouse.kit_definitions where id=(payload->>'kit_definition_id')::uuid for share;
    if not found or kit.status<>'active' or kit.owner_department<>'product' or nullif(btrim(kit.product_approval_reference),'') is null then
      raise exception 'An active Product-approved kit definition is required';
    end if;
    if not coalesce(product.can_launch(kit.product_id),false) or not coalesce(product.can_launch(payload->>'output_product_id'),false) then
      raise exception 'Product readiness approval and Operations acknowledgement are required';
    end if;
    if payload->>'direction' not in ('conversion','recovery') or payload->>'direction' is null
      or nullif(btrim(payload->>'approval_reference'),'') is null then raise exception 'Explicit Product recipe approval is required'; end if;
    if (payload->>'direction'='conversion' and kit.product_id is distinct from payload->>'output_product_id')
      or (payload->>'direction'='recovery' and kit.product_id is distinct from payload->>'source_product_id') then raise exception 'Recipe does not match the approved kit output'; end if;
    if (select count(*) from jsonb_array_elements(kit.components) c where c->>'serializationPolicy'<>'none')<>1
      or not exists(select 1 from jsonb_array_elements(kit.components) c where c->>'serializationPolicy'='required'
        and (c->>'quantity')::integer=1 and c->>'productId'=case when payload->>'direction'='conversion' then payload->>'source_product_id' else payload->>'output_product_id' end) then
      raise exception 'Serial-preserving conversion requires exactly one approved base device';
    end if;
    if (select count(*) from warehouse.products where id in (payload->>'source_product_id',payload->>'output_product_id') and serialized and serialization_policy='required')<>2 then
      raise exception 'Source and output must be distinct serialized products';
    end if;
    packaging:=payload->'packaging';
    if jsonb_typeof(packaging) is distinct from 'array' or jsonb_array_length(packaging)<> (select count(*) from jsonb_array_elements(kit.components) c where c->>'serializationPolicy'='none')
      or (select count(distinct p->>'product_id') from jsonb_array_elements(packaging) p)<>jsonb_array_length(packaging) then
      raise exception 'Explicit packaging must match every approved kit component';
    end if;
    for component in select value from jsonb_array_elements(packaging) loop
      if coalesce((component->>'quantity')::integer,0)<=0 or not exists(select 1 from jsonb_array_elements(kit.components) c
        join warehouse.products p on p.id=c->>'productId' where c->>'productId'=component->>'product_id'
        and c->>'serializationPolicy'='none' and not p.serialized and p.serialization_policy='none'
        and c->>'quantity'=component->>'quantity')
        or (payload->>'direction'='conversion' and component->>'disposition' is distinct from 'consume')
        or (payload->>'direction'='recovery' and coalesce(component->>'disposition','') not in ('recover','discard')) then
        raise exception 'Invalid approved packaging quantity or disposition';
      end if;
    end loop;
    insert into private.stock_conversion_recipes(kit_definition_id,kit_version,event_id,direction,source_product_id,output_product_id,packaging,approval_reference,evidence_urls,approved_by)
      values(kit.id,kit.version,v_event,payload->>'direction',payload->>'source_product_id',payload->>'output_product_id',packaging,btrim(payload->>'approval_reference'),payload->'evidence_urls',auth.uid()) returning * into recipe;
    v_result:=to_jsonb(recipe);
  else
    if v_action='create' then
      select * into recipe from private.stock_conversion_recipes where id=(payload->>'recipe_id')::uuid;
      if not found or recipe.event_id is distinct from v_event then raise exception 'Approved event recipe not found'; end if;
      if recipe.direction='conversion' and exists(select 1 from warehouse.events where id=v_event and status='closed') then raise exception 'Closed events cannot start new conversion work'; end if;
      batch.id:=gen_random_uuid(); batch.recipe_id:=recipe.id; batch.event_id:=v_event; batch.units:=payload->'units';
      batch.source_location_id:=payload->>'source_location_id'; batch.source_bin_id:=payload->>'source_bin_id';
      batch.destination_location_id:=payload->>'destination_location_id'; batch.destination_bin_id:=payload->>'destination_bin_id';
      if jsonb_typeof(batch.units) is distinct from 'array' or jsonb_array_length(batch.units) not between 1 and 100 then raise exception 'Select between 1 and 100 devices'; end if;
      if (select count(distinct upper(btrim(l->>'serial_number'))) from jsonb_array_elements(batch.units) l)<>jsonb_array_length(batch.units) then raise exception 'Duplicate or missing device serial'; end if;
    else
      select * into batch from private.stock_conversion_batches where id=(payload->>'batch_id')::uuid for update;
      if not found then raise exception 'Conversion batch not found'; end if;
      select * into recipe from private.stock_conversion_recipes where id=batch.recipe_id;
    end if;

    -- The event ledger owns this proof and lock order. No historical inference.
    if recipe.direction='recovery' and v_action<>'cancel' then
      if to_regprocedure('private.assert_event_conversion_return(text,text,text,text,text)') is null then raise exception 'Verified event return lineage integration is not available'; end if;
      for line in select value from jsonb_array_elements(batch.units) order by value->>'allocation_id',value->>'serial_number' loop
        if nullif(line->>'return_id','') is null or nullif(line->>'allocation_id','') is null or nullif(line->>'original_conversion_id','') is null then raise exception 'Recovery requires return, allocation and original conversion lineage'; end if;
        execute 'select private.assert_event_conversion_return($1,$2,$3,$4,$5)' using line->>'return_id',line->>'allocation_id',batch.event_id,recipe.source_product_id,line->>'serial_number';
      end loop;
    end if;
    select array_agg(distinct p) into v_products from (
      select recipe.source_product_id p union select recipe.output_product_id union select value->>'product_id' from jsonb_array_elements(recipe.packaging)
    ) products;
    perform private.lock_warehouse_products(v_products);
    if v_action<>'cancel' then
      select * into kit from warehouse.kit_definitions where id=recipe.kit_definition_id for share;
      if kit.status<>'active' or kit.version<>recipe.kit_version or not coalesce(product.can_launch(recipe.output_product_id),false) then raise exception 'Approved recipe readiness is no longer active'; end if;
      if not exists(select 1 from warehouse.storage_areas b join warehouse.locations l on l.id=b.location_id where b.id=batch.source_bin_id and b.location_id=batch.source_location_id and b.active and l.active and l.type='warehouse')
        or not exists(select 1 from warehouse.storage_areas b join warehouse.locations l on l.id=b.location_id where b.id=batch.destination_bin_id and b.location_id=batch.destination_location_id and b.active and l.active and l.type='warehouse') then raise exception 'Active source and destination warehouse bins are required'; end if;
    end if;

    if v_action='create' then
      insert into private.stock_conversion_batches(id,recipe_id,event_id,status,source_location_id,source_bin_id,destination_location_id,destination_bin_id,units,evidence_urls,created_by)
      values(batch.id,recipe.id,v_event,'inspection',batch.source_location_id,batch.source_bin_id,batch.destination_location_id,batch.destination_bin_id,batch.units,payload->'evidence_urls',auth.uid()) returning * into batch;
      for line in select value from jsonb_array_elements(batch.units) order by value->>'serial_number' loop
        unit:=private.stock_conversion_validate_unit(batch,recipe,line,false);
        update warehouse.inventory_units set status='conversion_pending' where id=unit.id;
        insert into private.stock_conversion_claims(batch_id,unit_id,serial_number,original_lot_id,original_event_id) values(batch.id,unit.id,unit.serial_number,unit.lot_id,unit.event_id);
      end loop;
      for component in select value from jsonb_array_elements(recipe.packaging) order by value->>'product_id' loop
        v_need:=(component->>'quantity')::integer*jsonb_array_length(batch.units);
        if component->>'disposition'='consume' then
          if v_need>warehouse.available_to_promise(component->>'product_id') then raise exception 'Packaging exceeds available stock after holds and allocations'; end if;
          if exists(select 1 from warehouse.inventory_holds h where h.status='active' and h.product_id=component->>'product_id' and h.location_id=batch.source_location_id and (h.bin_id is null or h.bin_id=batch.source_bin_id))
            or exists(select 1 from warehouse.fulfillment_reservations r where r.status='active' and r.product_id=component->>'product_id')
            or exists(select 1 from warehouse.allocations a where a.status in ('reserved','allocated') and a.product_id=component->>'product_id') then raise exception 'Packaging has active holds or reservations'; end if;
          for part in select * from warehouse.stock_levels where product_id=component->>'product_id' and location_id=batch.source_location_id and bin_id=batch.source_bin_id and quantity>0 order by lot_id nulls first for update loop
            v_take:=least(v_need,part.quantity);
            insert into private.stock_conversion_parts(batch_id,product_id,location_id,bin_id,lot_id,quantity,disposition) values(batch.id,part.product_id,part.location_id,part.bin_id,part.lot_id,v_take,'consume');
            update warehouse.stock_levels set quantity=quantity-v_take where product_id=part.product_id and location_id=part.location_id and bin_id is not distinct from part.bin_id and lot_id is not distinct from part.lot_id;
            v_need:=v_need-v_take; exit when v_need=0;
          end loop;
          if v_need<>0 then raise exception 'Insufficient available packaging'; end if;
        else
          insert into private.stock_conversion_parts(batch_id,product_id,location_id,bin_id,quantity,disposition) values(batch.id,component->>'product_id',batch.destination_location_id,batch.destination_bin_id,v_need,component->>'disposition');
        end if;
      end loop;
    elsif v_action='cancel' then
      if batch.status not in ('inspection','ready') or nullif(btrim(payload->>'reason'),'') is null then raise exception 'Only unconsumed work can be cancelled with a reason'; end if;
      for claim in select * from private.stock_conversion_claims where batch_id=batch.id and released_at is null order by unit_id for update loop
        perform 1 from warehouse.inventory_units where id=claim.unit_id for update;
        update private.stock_conversion_claims set released_at=now() where batch_id=batch.id and unit_id=claim.unit_id;
        update warehouse.inventory_units set status='in_stock' where id=claim.unit_id;
      end loop;
      for claim in select * from private.stock_conversion_parts where batch_id=batch.id and disposition='consume' order by product_id,lot_id loop
        insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity) values(claim.product_id,claim.location_id,claim.bin_id,claim.lot_id,claim.quantity)
        on conflict(product_id,location_id,bin_id,lot_id) do update set quantity=warehouse.stock_levels.quantity+excluded.quantity;
      end loop;
      update private.stock_conversion_batches set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=btrim(payload->>'reason'),completion_evidence_urls=payload->'evidence_urls' where id=batch.id returning * into batch;
    else
      if (v_action='approve' and batch.status<>'inspection') or (v_action='complete' and batch.status<>'ready') then raise exception 'Conversion requires the expected independent approval stage'; end if;
      if exists(select 1 from private.stock_conversion_parts p join warehouse.inventory_holds h
        on h.product_id=p.product_id and h.location_id=p.location_id and h.status='active'
          and (h.bin_id is null or h.bin_id=p.bin_id) and (h.lot_id is null or h.lot_id is not distinct from p.lot_id)
        where p.batch_id=batch.id and p.disposition='consume') then
        raise exception 'Packaging is held; resolve the hold before approving or completing conversion';
      end if;
      if (v_action='approve' and batch.created_by=auth.uid()) or (v_action='complete' and batch.approved_by=auth.uid()) then raise exception 'An independent Quality actor is required'; end if;
      if v_action='approve' then
        if jsonb_typeof(payload->'inspected_serial_numbers') is distinct from 'array'
          or (select array_agg(value order by value) from jsonb_array_elements_text(payload->'inspected_serial_numbers')) is distinct from
             (select array_agg(value->>'serial_number' order by value->>'serial_number') from jsonb_array_elements(batch.units)) then raise exception 'Quality must explicitly confirm every device'; end if;
      end if;
      for line in select value from jsonb_array_elements(batch.units) order by value->>'serial_number' loop
        unit:=private.stock_conversion_validate_unit(batch,recipe,line,true);
        if v_action='complete' then
          insert into private.stock_conversion_lines(batch_id,unit_id,serial_number,source_product_id,output_product_id,source_lot_id,inspection_id,return_id,allocation_id,original_conversion_id)
            values(batch.id,unit.id,unit.serial_number,recipe.source_product_id,recipe.output_product_id,unit.lot_id,(line->>'inspection_id')::uuid,nullif(line->>'return_id',''),nullif(line->>'allocation_id',''),nullif(line->>'original_conversion_id','')::uuid);
          update private.stock_conversion_claims set released_at=now() where batch_id=batch.id and unit_id=unit.id;
          update warehouse.inventory_units set product_id=recipe.output_product_id,status='in_stock',location_id=batch.destination_location_id,bin_id=batch.destination_bin_id,event_id=null,lot_id=null where id=unit.id;
          insert into warehouse.movements(id,type,product_id,quantity,from_location_id,from_bin_id,serial_number,event_id,reference,reason,evidence_urls,actor)
            values(gen_random_uuid()::text,'stock_conversion_out',recipe.source_product_id,1,unit.location_id,unit.bin_id,unit.serial_number,batch.event_id,batch.id::text,recipe.direction,payload->'evidence_urls',auth.uid()::text);
          insert into warehouse.movements(id,type,product_id,quantity,to_location_id,to_bin_id,serial_number,event_id,reference,reason,evidence_urls,actor)
            values(gen_random_uuid()::text,'stock_conversion_in',recipe.output_product_id,1,batch.destination_location_id,batch.destination_bin_id,unit.serial_number,batch.event_id,batch.id::text,recipe.direction,payload->'evidence_urls',auth.uid()::text);
        end if;
      end loop;
      if v_action='approve' then
        update private.stock_conversion_batches set status='ready',condition='open_box',approved_by=auth.uid(),approved_at=now(),approval_evidence_urls=payload->'evidence_urls' where id=batch.id returning * into batch;
      else
        for claim in select * from private.stock_conversion_parts where batch_id=batch.id order by product_id,lot_id loop
          if claim.disposition='recover' then
            insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity) values(claim.product_id,claim.location_id,claim.bin_id,null,claim.quantity)
              on conflict(product_id,location_id,bin_id,lot_id) do update set quantity=warehouse.stock_levels.quantity+excluded.quantity;
          end if;
          insert into warehouse.movements(id,type,product_id,quantity,from_location_id,from_bin_id,to_location_id,to_bin_id,lot_id,event_id,reference,reason,evidence_urls,actor)
            values(gen_random_uuid()::text,'stock_conversion_packaging_'||case claim.disposition when 'consume' then 'consumed' when 'recover' then 'recovered' else 'discarded' end,claim.product_id,claim.quantity,
              case when claim.disposition='consume' then claim.location_id end,case when claim.disposition='consume' then claim.bin_id end,
              case when claim.disposition='recover' then claim.location_id end,case when claim.disposition='recover' then claim.bin_id end,
              claim.lot_id,batch.event_id,batch.id::text,claim.disposition,payload->'evidence_urls',auth.uid()::text);
        end loop;
        update private.stock_conversion_batches set status='completed',completed_by=auth.uid(),completed_at=now(),completion_evidence_urls=payload->'evidence_urls' where id=batch.id returning * into batch;
      end if;
    end if;
    v_result:=to_jsonb(batch);
  end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
    values('warehouse','stock_conversion',coalesce(batch.id,recipe.id),v_action,auth.uid(),v_result);
  return private.finish_idempotent_command(command_id,v_result);
end;
$$;

create or replace function warehouse.stock_conversion_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not (coalesce(core.has_live_cap('warehouse','manage_returns'),false) or coalesce(core.has_live_cap('warehouse','inspect_quality'),false)) then raise exception 'Not authorized to view stock conversion work'; end if;
  return jsonb_build_object(
    'recipes',coalesce((select jsonb_agg(r order by approved_at desc) from (select * from private.stock_conversion_recipes order by approved_at desc limit 200) r),'[]'::jsonb),
    'batches',coalesce((select jsonb_agg(b order by created_at desc) from (select * from private.stock_conversion_batches order by created_at desc limit 200) b),'[]'::jsonb),
    'candidates',coalesce((select jsonb_agg(candidate) from (
      select u.id unit_id,u.serial_number,u.product_id,u.location_id,u.bin_id,q.id inspection_id,
        case when q.source_type='return' then q.source_id end return_id,
        (select line->>'allocationId' from warehouse.returns r cross join lateral jsonb_array_elements(r.lines) line
          where r.id=q.source_id and q.source_type='return' and line->>'serialNumber'=u.serial_number limit 1) allocation_id,
        (select l.batch_id from private.stock_conversion_lines l join private.stock_conversion_batches b on b.id=l.batch_id
          join private.stock_conversion_recipes r on r.id=b.recipe_id where l.unit_id=u.id and l.output_product_id=u.product_id and r.direction='conversion'
            and not exists(select 1 from private.stock_conversion_lines recovered where recovered.original_conversion_id=l.batch_id and recovered.unit_id=l.unit_id)
          order by b.completed_at desc limit 1) original_conversion_id
      from warehouse.inventory_units u join lateral (
        select * from warehouse.quality_inspections q where q.serial_number=u.serial_number and q.product_id=u.product_id
        order by q.inspected_at desc limit 1
      ) q on q.disposition='accepted' and q.bin_id is not distinct from u.bin_id and q.location_id=u.location_id
      where u.status='in_stock' and u.assigned_to is null and u.bin_id is not null
      order by u.serial_number limit 500
    ) candidate),'[]'::jsonb),
    'recovery_available',to_regprocedure('private.assert_event_conversion_return(text,text,text,text,text)') is not null);
end;
$$;
create or replace function warehouse.stock_conversion_recipe_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(core.has_live_cap('product','decide_go_live'),false) then
    raise exception 'Not authorized: product.decide_go_live';
  end if;
  return jsonb_build_object(
    'kits',coalesce((select jsonb_agg(k order by name,version) from (
      select kit.id,kit.name,kit.version,kit.product_id,output.name product_name,
        base.id base_product_id,base.name base_product_name,coalesce(product.can_launch(base.id),false) recovery_ready,
        coalesce((select jsonb_agg(jsonb_build_object('product_id',p.id,'name',p.name,'quantity',c->'quantity') order by p.name)
          from jsonb_array_elements(kit.components) c join warehouse.products p on p.id=c->>'productId'
          where c->>'serializationPolicy'='none'),'[]'::jsonb) packaging
      from warehouse.kit_definitions kit join warehouse.products output on output.id=kit.product_id
      cross join lateral jsonb_array_elements(kit.components) device
      join warehouse.products base on base.id=device->>'productId'
      where kit.status='active' and kit.owner_department='product' and nullif(btrim(kit.product_approval_reference),'') is not null
        and product.can_launch(kit.product_id) and device->>'serializationPolicy'='required' and device->>'quantity'='1'
        and base.id<>output.id and base.serialized and base.serialization_policy='required'
        and output.serialized and output.serialization_policy='required'
        and (select count(*) from jsonb_array_elements(kit.components) c where c->>'serializationPolicy'='required')=1
        and not exists(select 1 from jsonb_array_elements(kit.components) c left join warehouse.products p on p.id=c->>'productId'
          where c->>'serializationPolicy' is null or c->>'serializationPolicy' not in ('required','none') or p.id is null
            or (c->>'serializationPolicy'='none' and (p.serialized or p.serialization_policy<>'none')))
      order by kit.name,kit.version limit 200
    ) k),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(e order by start_date desc) from (
      select id,name,status,start_date from warehouse.events where status<>'cancelled' order by start_date desc limit 200
    ) e),'[]'::jsonb),
    'recipes',coalesce((select jsonb_agg(r order by approved_at desc) from (
      select r.*,kit.name kit_name,e.name event_name,s.name source_product_name,o.name output_product_name
      from private.stock_conversion_recipes r join warehouse.kit_definitions kit on kit.id=r.kit_definition_id
      join warehouse.events e on e.id=r.event_id join warehouse.products s on s.id=r.source_product_id
      join warehouse.products o on o.id=r.output_product_id order by r.approved_at desc limit 200
    ) r),'[]'::jsonb));
end;
$$;
revoke all on function private.stock_conversion_preserve_history(),private.stock_conversion_guard_claimed_unit(),private.stock_conversion_evidence(jsonb),private.stock_conversion_validate_unit(private.stock_conversion_batches,private.stock_conversion_recipes,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function private.stock_conversion_product_transition(warehouse.inventory_units,warehouse.inventory_units),private.stock_conversion_procurement_identity(warehouse.inventory_units,warehouse.inventory_units,text,text) from public,anon,authenticated,service_role;
revoke all on function warehouse.execute_stock_conversion(jsonb),warehouse.stock_conversion_workspace(jsonb) from public,anon;
grant execute on function warehouse.execute_stock_conversion(jsonb),warehouse.stock_conversion_workspace(jsonb) to authenticated;
revoke all on function warehouse.stock_conversion_recipe_workspace(jsonb) from public,anon;
grant execute on function warehouse.stock_conversion_recipe_workspace(jsonb) to authenticated;
