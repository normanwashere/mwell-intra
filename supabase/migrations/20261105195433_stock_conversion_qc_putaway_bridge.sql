-- Future external-receipt QC may follow exactly one same-warehouse putaway.
-- No backfill, Quality decision rewrite, transfer wrapper replacement or grants.
begin;

do $$
declare spec record;
begin
  for spec in select * from (values
    ('private.warehouse_transfer_pre_lot_putaway(jsonb)','c11d45eeafb0a75c01d631af51cef34d'),
    ('private.external_po_inspect(jsonb)','f464a8e9e5712d0ee6b64c94592f6abe'),
    ('private.warehouse_record_unit_history()','3c7dfcf8c4acc69faa8cd8b2cc1cd534')
  ) prerequisites(signature,expected_hash) loop
    if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(spec.signature)) is distinct from spec.expected_hash then
      raise exception 'QC putaway authority predecessor drift: %',spec.signature;
    end if;
  end loop;
end $$;

create table private.stock_conversion_qc_origins (
  inspection_id uuid primary key,
  unit_id text not null unique,
  registration_id bigint not null,
  unit_state jsonb not null,
  inspection_state jsonb not null,
  receipt_state jsonb not null,
  lot_state jsonb not null,
  hold_state jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create table private.stock_conversion_qc_breaks (
  inspection_id uuid primary key references private.stock_conversion_qc_origins(inspection_id),
  source_table text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create table private.stock_conversion_putaway_bridges (
  unit_id text primary key,
  inspection_id uuid not null unique references private.stock_conversion_qc_origins(inspection_id),
  history_id bigint not null unique,
  movement_id text not null unique,
  unit_state jsonb not null,
  movement_state jsonb not null,
  actor_id text not null,
  intent_key text not null,
  command_input jsonb not null,
  applied_xid xid8 not null default pg_current_xact_id(),
  recorded_at timestamptz not null default clock_timestamp()
);
create index stock_conversion_origin_serial_lookup on private.stock_conversion_qc_origins((unit_state->>'serial_number'));
create index stock_conversion_origin_scope_lookup on private.stock_conversion_qc_origins((unit_state->>'product_id'),(unit_state->>'location_id'));
create index stock_conversion_origin_receipt_lookup on private.stock_conversion_qc_origins((receipt_state->>'id'));
create index stock_conversion_origin_lot_lookup on private.stock_conversion_qc_origins((unit_state->>'lot_id'));
create index stock_conversion_bridge_serial_lookup on private.stock_conversion_putaway_bridges((unit_state->>'serial_number'));
create index stock_conversion_bridge_scope_lookup on private.stock_conversion_putaway_bridges((unit_state->>'product_id'),(unit_state->>'location_id'));
create index stock_conversion_bridge_intent_lookup on private.stock_conversion_putaway_bridges(actor_id,intent_key);
alter table private.stock_conversion_qc_origins enable row level security;
alter table private.stock_conversion_qc_breaks enable row level security;
alter table private.stock_conversion_putaway_bridges enable row level security;
revoke all on private.stock_conversion_qc_origins,private.stock_conversion_qc_breaks,private.stock_conversion_putaway_bridges from public,anon,authenticated,service_role;
create trigger stock_conversion_qc_origins_immutable before update or delete on private.stock_conversion_qc_origins for each row execute function private.stock_conversion_preserve_history();
create trigger stock_conversion_qc_origins_no_truncate before truncate on private.stock_conversion_qc_origins for each statement execute function private.stock_conversion_preserve_history();
create trigger stock_conversion_qc_breaks_immutable before update or delete on private.stock_conversion_qc_breaks for each row execute function private.stock_conversion_preserve_history();
create trigger stock_conversion_qc_breaks_no_truncate before truncate on private.stock_conversion_qc_breaks for each statement execute function private.stock_conversion_preserve_history();
create trigger stock_conversion_putaway_immutable before update or delete on private.stock_conversion_putaway_bridges for each row execute function private.stock_conversion_preserve_history();
create trigger stock_conversion_putaway_no_truncate before truncate on private.stock_conversion_putaway_bridges for each statement execute function private.stock_conversion_preserve_history();

create function private.stock_conversion_hold_scope(h jsonb,u jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(h->>'product_id'=u->>'product_id' and
    (h->>'serial_number'=u->>'serial_number' or (h->>'serial_number' is null
      and h->>'location_id'=u->>'location_id'
      and (h->>'bin_id' is null or h->>'bin_id'=u->>'bin_id')
      and (h->>'lot_id' is null or h->>'lot_id'=u->>'lot_id'))),false)
$$;

-- Record only the actual pending -> accepted decision, never a later lookup.
create function private.stock_conversion_record_qc_origin() returns trigger
language plpgsql security definer set search_path='' as $$
declare u warehouse.inventory_units; r warehouse.receipts; h warehouse.inventory_holds;
  history private.warehouse_unit_history; lot warehouse.lots;
begin
  if old.disposition is distinct from 'pending' or new.disposition is distinct from 'accepted'
    or new.source_type is distinct from 'receipt' or new.bin_id is not null or new.quantity is distinct from 1
    or auth.uid() is null or new.inspected_by is distinct from auth.uid()
    or not coalesce(core.has_live_cap('warehouse','inspect_quality'),false)
    or jsonb_typeof(new.evidence_urls) is distinct from 'array' or jsonb_array_length(new.evidence_urls)=0 then return new; end if;
  select * into u from warehouse.inventory_units where serial_number=new.serial_number;
  if not found or u.product_id is distinct from new.product_id or u.lot_id is distinct from new.lot_id
    or u.location_id is distinct from new.location_id or u.bin_id is not null
    or u.status is distinct from 'in_stock' or u.event_id is not null or u.assigned_to is not null then return new; end if;
  select * into r from warehouse.receipts where id=new.source_id;
  if not found or r.location_id is distinct from u.location_id or r.received_by is null
    or r.received_by=new.inspected_by or not exists(select 1 from private.external_po_shipments s
      where s.receipt_id=r.id and s.status='posted' and s.posted_by=r.received_by)
    or not exists(select 1 from jsonb_array_elements(r.lines) line where line->>'productId'=u.product_id
      and line->>'lotCode'=u.lot_id and line->'serialNumbers' ? u.serial_number) then return new; end if;
  select * into lot from warehouse.lots where id=u.lot_id and product_id=u.product_id;
  if not found then return new; end if;
  select * into history from private.warehouse_unit_history where unit_id=u.id order by id desc limit 1;
  if not found or history.operation<>'registered' or history.before_state is not null
    or history.after_state is distinct from to_jsonb(u) or history.actor_id is distinct from r.received_by
    or (select count(*) from private.warehouse_unit_history where unit_id=u.id)<>1 then return new; end if;
  select * into h from warehouse.inventory_holds where inspection_id=new.id and status='active';
  if not found or h.reason is distinct from 'Awaiting external PO quality inspection'
    or h.product_id is distinct from u.product_id or h.serial_number is distinct from u.serial_number
    or h.lot_id is distinct from u.lot_id or h.location_id is distinct from u.location_id
    or h.bin_id is not null or h.quantity is distinct from 1
    or exists(select 1 from warehouse.inventory_holds other where other.id<>h.id
      and private.stock_conversion_hold_scope(to_jsonb(other),to_jsonb(u)))
    or exists(select 1 from warehouse.quality_inspections other where other.serial_number=u.serial_number and other.id<>new.id)
    or exists(select 1 from warehouse.returns ret cross join lateral jsonb_array_elements(ret.lines) line
      where line->>'serialNumber'=u.serial_number or line->'serialNumbers' ? u.serial_number) then return new; end if;
  insert into private.stock_conversion_qc_origins(inspection_id,unit_id,registration_id,unit_state,inspection_state,receipt_state,lot_state,hold_state)
    values(new.id,u.id,history.id,to_jsonb(u),to_jsonb(new),to_jsonb(r)-'quality_status',to_jsonb(lot),to_jsonb(h))
    on conflict do nothing;
  return new;
end $$;

-- Persist invalidation, including released/deleted holds and reverted evidence.
-- This does not deny or change any existing Warehouse operation.
create function private.stock_conversion_watch_qc_origin() returns trigger
language plpgsql security definer set search_path='' as $$
declare o private.stock_conversion_qc_origins; row_state jsonb; before_row jsonb; after_row jsonb;
  candidate_ids uuid[]; serials text[];
begin
  if tg_op='TRUNCATE' then
    insert into private.stock_conversion_qc_breaks(inspection_id,source_table)
      select inspection_id,tg_table_name from private.stock_conversion_qc_origins on conflict do nothing;
    return null;
  end if;
  if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
  for row_state in select value from jsonb_array_elements(jsonb_build_array(before_row,after_row)) where value<>'null'::jsonb loop
    -- Separate SPI statements keep reusable plans indexable. Both hold snapshots
    -- retain the original scope predicate; the union prevents duplicate matches.
    case tg_table_name
      when 'inventory_holds' then
        if row_state->>'serial_number' is not null then
          select array_agg(origin.inspection_id) into candidate_ids from private.stock_conversion_qc_origins origin join (
            select src.inspection_id from private.stock_conversion_qc_origins src
              where src.unit_state->>'serial_number'=row_state->>'serial_number'
                and private.stock_conversion_hold_scope(row_state,src.unit_state)
            union
            select dst.inspection_id from private.stock_conversion_putaway_bridges dst
              where dst.unit_state->>'serial_number'=row_state->>'serial_number'
                and private.stock_conversion_hold_scope(row_state,dst.unit_state)
          ) ids on ids.inspection_id=origin.inspection_id;
        else
          select array_agg(origin.inspection_id) into candidate_ids from private.stock_conversion_qc_origins origin join (
            select src.inspection_id from private.stock_conversion_qc_origins src
              where src.unit_state->>'product_id'=row_state->>'product_id'
                and src.unit_state->>'location_id'=row_state->>'location_id'
                and (row_state->>'bin_id' is null or src.unit_state->>'bin_id'=row_state->>'bin_id')
                and (row_state->>'lot_id' is null or src.unit_state->>'lot_id'=row_state->>'lot_id')
                and private.stock_conversion_hold_scope(row_state,src.unit_state)
            union
            select dst.inspection_id from private.stock_conversion_putaway_bridges dst
              where dst.unit_state->>'product_id'=row_state->>'product_id'
                and dst.unit_state->>'location_id'=row_state->>'location_id'
                and (row_state->>'bin_id' is null or dst.unit_state->>'bin_id'=row_state->>'bin_id')
                and (row_state->>'lot_id' is null or dst.unit_state->>'lot_id'=row_state->>'lot_id')
                and private.stock_conversion_hold_scope(row_state,dst.unit_state)
          ) ids on ids.inspection_id=origin.inspection_id;
        end if;
      when 'quality_inspections' then
        select array_agg(origin.inspection_id) into candidate_ids from private.stock_conversion_qc_origins origin
          where origin.inspection_id=(row_state->>'id')::uuid or origin.unit_state->>'serial_number'=row_state->>'serial_number';
      when 'returns' then
        -- JSONB '?' also matches object keys and a scalar string, not numeric
        -- array entries. Preserve those existing match sets without a table scan.
        select array_agg(distinct token.serial) into serials
        from jsonb_array_elements(row_state->'lines') item(line)
        cross join lateral (
          select item.line->>'serialNumber' serial
          union all
          select element.value#>>'{}' from jsonb_array_elements(case when jsonb_typeof(item.line->'serialNumbers')='array'
            then item.line->'serialNumbers' else '[]'::jsonb end) element(value) where jsonb_typeof(element.value)='string'
          union all
          select key.value from jsonb_object_keys(case when jsonb_typeof(item.line->'serialNumbers')='object'
            then item.line->'serialNumbers' else '{}'::jsonb end) key(value)
          union all
          select item.line->>'serialNumbers' where jsonb_typeof(item.line->'serialNumbers')='string'
        ) token where token.serial is not null;
        select array_agg(origin.inspection_id) into candidate_ids from private.stock_conversion_qc_origins origin where origin.unit_state->>'serial_number'=any(serials);
      when 'receipts' then
        select array_agg(origin.inspection_id) into candidate_ids from private.stock_conversion_qc_origins origin where origin.receipt_state->>'id'=row_state->>'id';
      when 'lots' then
        select array_agg(origin.inspection_id) into candidate_ids from private.stock_conversion_qc_origins origin where origin.unit_state->>'lot_id'=row_state->>'id';
      when 'movements' then
        select array_agg(origin.inspection_id) into candidate_ids from private.stock_conversion_qc_origins origin join (
          select bridge.inspection_id from private.stock_conversion_putaway_bridges bridge where bridge.movement_id=row_state->>'id'
          union
          select matched.inspection_id from private.stock_conversion_qc_origins matched
            join private.stock_conversion_putaway_bridges bridge on bridge.inspection_id=matched.inspection_id
            where matched.unit_state->>'serial_number'=row_state->>'serial_number'
        ) ids on ids.inspection_id=origin.inspection_id;
      when 'warehouse_unit_history' then
        select array_agg(origin.inspection_id) into candidate_ids from private.stock_conversion_qc_origins origin where origin.unit_id=row_state->>'unit_id';
      when 'warehouse_offline_receipts' then
        select array_agg(origin.inspection_id) into candidate_ids from private.stock_conversion_putaway_bridges bridge
          join private.stock_conversion_qc_origins origin on origin.inspection_id=bridge.inspection_id
          where row_state->>'method'='transfer' and bridge.actor_id=row_state->>'actor_id' and bridge.intent_key=row_state->>'intent_key';
      else continue;
    end case;
    -- One set lookup avoids per-row cached scans while this command fills breaks.
    -- Existing immutable evidence stays stored; only redundant work is removed.
    candidate_ids:=array(select id from unnest(candidate_ids) candidates(id)
      except select broken.inspection_id from private.stock_conversion_qc_breaks broken where broken.inspection_id=any(candidate_ids));
    for o in select origin.* from private.stock_conversion_qc_origins origin where origin.inspection_id=any(candidate_ids) loop
      if tg_table_name='inventory_holds' and tg_op='UPDATE' and before_row=o.hold_state
        and auth.uid()::text=o.inspection_state->>'inspected_by'
        and after_row=o.hold_state||jsonb_build_object('status','released',
          'released_by',o.inspection_state->'inspected_by','released_at',o.inspection_state->'inspected_at',
          'release_reason','Accepted by independent quality inspection','release_evidence_urls',o.inspection_state->'evidence_urls') then continue; end if;
      if tg_table_name='receipts' and tg_op='UPDATE' and before_row-'quality_status'=after_row-'quality_status' then continue; end if;
      insert into private.stock_conversion_qc_breaks(inspection_id,source_table) values(o.inspection_id,tg_table_name) on conflict do nothing;
    end loop;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger stock_conversion_00_qc_watch after insert or update or delete on warehouse.quality_inspections for each row execute function private.stock_conversion_watch_qc_origin();
create trigger stock_conversion_10_qc_origin after update on warehouse.quality_inspections for each row execute function private.stock_conversion_record_qc_origin();
create trigger stock_conversion_hold_watch after insert or update or delete on warehouse.inventory_holds for each row execute function private.stock_conversion_watch_qc_origin();
create trigger stock_conversion_return_watch after insert or update or delete on warehouse.returns for each row execute function private.stock_conversion_watch_qc_origin();
create trigger stock_conversion_receipt_watch after update or delete on warehouse.receipts for each row execute function private.stock_conversion_watch_qc_origin();
create trigger stock_conversion_lot_watch after update or delete on warehouse.lots for each row execute function private.stock_conversion_watch_qc_origin();
create trigger stock_conversion_movement_watch after insert or update or delete on warehouse.movements for each row execute function private.stock_conversion_watch_qc_origin();
create trigger stock_conversion_history_watch after update or delete on private.warehouse_unit_history for each row execute function private.stock_conversion_watch_qc_origin();
create trigger stock_conversion_receipt_proof_watch after update or delete on private.warehouse_offline_receipts for each row execute function private.stock_conversion_watch_qc_origin();
do $$
declare source_table text;
begin
  foreach source_table in array array['warehouse.quality_inspections','warehouse.inventory_holds','warehouse.returns','warehouse.receipts','warehouse.lots','warehouse.movements','private.warehouse_unit_history','private.warehouse_offline_receipts'] loop
    execute format('create trigger stock_conversion_truncate_watch before truncate on %s for each statement execute function private.stock_conversion_watch_qc_origin()',source_table);
  end loop;
end $$;

create function private.stock_conversion_qc_origin_clean(o private.stock_conversion_qc_origins,u warehouse.inventory_units,p_batch_id uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select not exists(select 1 from private.stock_conversion_qc_breaks where inspection_id=o.inspection_id)
    and exists(select 1 from warehouse.quality_inspections q where q.id=o.inspection_id and to_jsonb(q)=o.inspection_state)
    and exists(select 1 from warehouse.receipts r where r.id=o.receipt_state->>'id' and to_jsonb(r)-'quality_status'=o.receipt_state)
    and exists(select 1 from warehouse.lots lot where lot.id=u.lot_id and to_jsonb(lot)=o.lot_state)
    and exists(select 1 from private.warehouse_unit_history h where h.id=o.registration_id and h.unit_id=u.id
      and h.operation='registered' and h.before_state is null and h.after_state=o.unit_state)
    and exists(select 1 from warehouse.inventory_holds h where h.id=(o.hold_state->>'id')::uuid
      and to_jsonb(h)=o.hold_state||jsonb_build_object('status','released',
        'released_by',o.inspection_state->'inspected_by','released_at',o.inspection_state->'inspected_at',
        'release_reason','Accepted by independent quality inspection','release_evidence_urls',o.inspection_state->'evidence_urls'))
    and not exists(select 1 from warehouse.inventory_holds h where h.id<>(o.hold_state->>'id')::uuid
      and (private.stock_conversion_hold_scope(to_jsonb(h),o.unit_state) or private.stock_conversion_hold_scope(to_jsonb(h),to_jsonb(u))))
    and not exists(select 1 from warehouse.quality_inspections q where q.serial_number=u.serial_number and q.id<>o.inspection_id)
    and not exists(select 1 from warehouse.returns r cross join lateral jsonb_array_elements(r.lines) line
      where line->>'serialNumber'=u.serial_number or line->'serialNumbers' ? u.serial_number)
    and not exists(select 1 from warehouse.procurement_receipt_serial_claims c where upper(btrim(c.serial_number))=upper(btrim(u.serial_number)) and c.status in ('pending','held'))
    and not exists(select 1 from warehouse.fulfillment_reservations r where r.product_id=u.product_id and r.status='active'
      and (r.location_id is null or r.location_id=u.location_id) and (r.bin_id is null or r.bin_id=u.bin_id))
    and not exists(select 1 from warehouse.allocations a where a.product_id=u.product_id and a.status in ('reserved','allocated'))
    and not exists(select 1 from private.stock_conversion_claims c where c.unit_id=u.id and c.released_at is null and c.batch_id is distinct from p_batch_id)
$$;

-- The receipt is inserted only after the trusted transfer returns its movement.
-- No key/no eligible provenance means ordinary transfer succeeds without a bridge.
create function private.stock_conversion_capture_putaway() returns trigger
language plpgsql security definer set search_path='' as $$
declare o private.stock_conversion_qc_origins; u warehouse.inventory_units; m warehouse.movements;
  h private.warehouse_unit_history; current_xid text:=new.xmin::text;
begin
  if new.method<>'transfer' or auth.uid() is null or new.actor_id is distinct from auth.uid()::text
    or not coalesce(core.has_live_cap('warehouse','transfer_stock'),false)
    or not coalesce(core.has_cap('warehouse','transfer_stock'),false) then return new; end if;
  select * into m from warehouse.movements where id=new.result->>'id' and xmin::text=current_xid;
  if not found or to_jsonb(m) is distinct from new.result or m.type is distinct from 'transfer'
    or m.quantity is distinct from 1 or m.from_bin_id is not null or m.to_bin_id is null
    or m.from_location_id is distinct from m.to_location_id or m.actor is distinct from new.actor_id
    or new.command_input->>'productId' is distinct from m.product_id or new.command_input->'quantity' is distinct from '1'::jsonb
    or coalesce(new.command_input->>'locationId',new.command_input->>'fromLocationId') is distinct from m.from_location_id
    or coalesce(new.command_input->>'locationId',new.command_input->>'toLocationId') is distinct from m.to_location_id
    or nullif(new.command_input->>'fromBinId','') is not null or new.command_input->>'toBinId' is distinct from m.to_bin_id
    or jsonb_typeof(new.command_input->'serialNumbers') is distinct from 'array'
    or jsonb_array_length(new.command_input->'serialNumbers')<>1 then return new; end if;
  -- The production mapper omits movement serial/lot. The authoritative inner
  -- transfer binds the exact one-serial command to one locked unit; do not guess.
  select * into u from warehouse.inventory_units where serial_number=new.command_input->'serialNumbers'->>0 and xmin::text=current_xid;
  if not found or u.product_id is distinct from m.product_id
    or (m.lot_id is not null and u.lot_id is distinct from m.lot_id)
    or (m.serial_number is not null and u.serial_number is distinct from m.serial_number)
    or u.location_id is distinct from m.to_location_id or u.bin_id is distinct from m.to_bin_id
    or u.status is distinct from 'in_stock' or u.event_id is not null or u.assigned_to is not null
    or not exists(select 1 from warehouse.storage_areas b join warehouse.locations l on l.id=b.location_id
      where b.id=u.bin_id and b.location_id=u.location_id and b.active and l.active and l.type='warehouse') then return new; end if;
  select * into o from private.stock_conversion_qc_origins where unit_id=u.id;
  if not found or not coalesce(private.stock_conversion_qc_origin_clean(o,u,null),false) then return new; end if;
  select * into h from private.warehouse_unit_history where unit_id=u.id and xmin::text=current_xid order by id desc limit 1;
  if not found or h.operation<>'changed' or h.before_state is distinct from o.unit_state
    or h.after_state is distinct from to_jsonb(u) or h.actor_id is distinct from auth.uid()
    or h.before_state-'bin_id' is distinct from h.after_state-'bin_id'
    or (select count(*) from private.warehouse_unit_history where unit_id=u.id)<>2 then return new; end if;
  insert into private.stock_conversion_putaway_bridges(unit_id,inspection_id,history_id,movement_id,unit_state,movement_state,actor_id,intent_key,command_input)
    values(u.id,o.inspection_id,h.id,m.id,to_jsonb(u),to_jsonb(m),new.actor_id,new.intent_key,new.command_input);
  return new;
end $$;
create trigger stock_conversion_capture_putaway after insert on private.warehouse_offline_receipts for each row execute function private.stock_conversion_capture_putaway();

create function private.stock_conversion_qc_matches(u warehouse.inventory_units,q warehouse.quality_inspections,p_batch_id uuid,p_allow_bridge boolean)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare b private.stock_conversion_putaway_bridges; o private.stock_conversion_qc_origins;
begin
  if q.location_id=u.location_id and q.bin_id is not distinct from u.bin_id then return true; end if;
  if not coalesce(p_allow_bridge,false) or q.source_type is distinct from 'receipt' or q.bin_id is not null then return false; end if;
  select * into b from private.stock_conversion_putaway_bridges where unit_id=u.id and inspection_id=q.id;
  if not found then return false; end if;
  select * into o from private.stock_conversion_qc_origins where inspection_id=b.inspection_id;
  if not found or to_jsonb(q) is distinct from o.inspection_state or not coalesce(private.stock_conversion_qc_origin_clean(o,u,p_batch_id),false)
    or not exists(select 1 from warehouse.movements m where m.id=b.movement_id and to_jsonb(m)=b.movement_state)
    or not exists(select 1 from private.warehouse_offline_receipts r where r.actor_id=b.actor_id and r.method='transfer'
      and r.intent_key=b.intent_key and r.command_input=b.command_input and r.result=b.movement_state)
    or not exists(select 1 from private.warehouse_unit_history h where h.id=b.history_id and h.unit_id=u.id
      and h.before_state=o.unit_state and h.after_state=b.unit_state and h.operation='changed' and h.actor_id::text=b.actor_id)
    or not exists(select 1 from warehouse.storage_areas area join warehouse.locations l on l.id=area.location_id
      where area.id=u.bin_id and area.location_id=u.location_id and area.active and l.active and l.type='warehouse') then return false; end if;
  if p_batch_id is null then
    return to_jsonb(u)=b.unit_state and (select count(*) from private.warehouse_unit_history where unit_id=u.id)=2;
  end if;
  -- The batch's own claim is the only permitted history after putaway.
  return to_jsonb(u)=b.unit_state||jsonb_build_object('status','conversion_pending')
    and (select count(*) from private.warehouse_unit_history where unit_id=u.id)=3
    and exists(select 1 from private.stock_conversion_claims c join private.stock_conversion_batches batch on batch.id=c.batch_id
      join private.warehouse_unit_history h on h.unit_id=c.unit_id and h.id>b.history_id
      where c.batch_id=p_batch_id and c.unit_id=u.id and c.serial_number=u.serial_number
        and c.original_lot_id is not distinct from u.lot_id and c.released_at is null
        and batch.status in ('inspection','ready') and batch.source_location_id=u.location_id and batch.source_bin_id=u.bin_id
        and batch.units @> jsonb_build_array(jsonb_build_object('serial_number',u.serial_number,'inspection_id',q.id))
        and h.operation='changed' and h.before_state=b.unit_state and h.after_state=to_jsonb(u) and h.actor_id=batch.created_by);
end $$;

-- Keep original functions/OIDs/ACLs and every non-coordinate authority guard.
do $migration$
declare spec record; definition text; old_text text; new_text text;
begin
  for spec in select * from (values
    ('private.stock_conversion_validate_unit(private.stock_conversion_batches,private.stock_conversion_recipes,jsonb,boolean)','2e041a7ff94b18e96b4cbb2e88cea299'),
    ('warehouse.stock_conversion_workspace(jsonb)','ef7f77f53415117c639a2c97694b66d6')
  ) functions(signature,expected_hash) loop
    if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(spec.signature)) is distinct from spec.expected_hash then
      raise exception 'QC putaway predecessor drift: %',spec.signature;
    end if;
    definition:=pg_get_functiondef(spec.signature::regprocedure);
    if spec.signature like 'private.%' then
      old_text:='q.location_id<>u.location_id or q.bin_id is distinct from u.bin_id';
      new_text:='not coalesce(private.stock_conversion_qc_matches(u,q,case when p_claimed then p_batch.id end,p_recipe.direction=''conversion''),false)';
    else
      old_text:='q.bin_id is not distinct from u.bin_id and q.location_id=u.location_id';
      new_text:='coalesce(private.stock_conversion_qc_matches(u,q,null,true),false)';
    end if;
    if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'QC coordinate guard drift'; end if;
    execute replace(definition,old_text,new_text);
  end loop;
end $migration$;
revoke all on function private.stock_conversion_hold_scope(jsonb,jsonb),private.stock_conversion_record_qc_origin(),private.stock_conversion_watch_qc_origin(),private.stock_conversion_qc_origin_clean(private.stock_conversion_qc_origins,warehouse.inventory_units,uuid),private.stock_conversion_capture_putaway(),private.stock_conversion_qc_matches(warehouse.inventory_units,warehouse.quality_inspections,uuid,boolean) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
