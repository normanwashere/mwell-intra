-- Serialize both sides of the receipt-serial custody boundary on one normalized
-- identity. The advisory lock closes the cross-table race that separate unique
-- indexes cannot prevent. A clean claim and its same-product inventory unit are
-- the sole intentional overlap; exception custody must never become stock.

lock table warehouse.procurement_receipt_serial_claims in share row exclusive mode;
lock table warehouse.inventory_units in share row exclusive mode;

do $migration$
begin
  if exists (
    select 1
      from warehouse.procurement_receipt_serial_claims claim
      join warehouse.inventory_units unit
        on pg_catalog.upper(pg_catalog.btrim(unit.serial_number))
         = pg_catalog.upper(pg_catalog.btrim(claim.serial_number))
     where claim.status in ('pending', 'held', 'posted')
       and (
         claim.outcome <> 'clean'
         or claim.product_id is distinct from unit.product_id
       )
  ) then
    raise exception 'Active non-clean receipt serial claims already overlap inventory units';
  end if;
end;
$migration$;

create or replace function private.lock_serial_custody_identity(p_serial_number text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serial_number text := pg_catalog.upper(
    pg_catalog.btrim(coalesce(p_serial_number, ''))
  );
begin
  if v_serial_number = '' then
    raise exception 'Serial identity cannot be blank';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mwell.serial-custody:' || v_serial_number, 0)
  );
  return v_serial_number;
end;
$$;

create or replace function private.normalize_receipt_serial_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_serial_number text;
  v_unit warehouse.inventory_units;
begin
  new.serial_number := pg_catalog.upper(
    pg_catalog.btrim(coalesce(new.serial_number, ''))
  );
  if new.serial_number = '' then
    raise exception 'Receipt serial number cannot be blank';
  end if;

  if tg_op = 'UPDATE' then
    v_old_serial_number := pg_catalog.upper(
      pg_catalog.btrim(coalesce(old.serial_number, ''))
    );
  end if;

  -- Serial changes acquire both identities in lexical order so two concurrent
  -- swaps cannot deadlock while still protecting the released identity.
  if tg_op = 'UPDATE'
     and v_old_serial_number is distinct from new.serial_number then
    if v_old_serial_number < new.serial_number then
      perform private.lock_serial_custody_identity(v_old_serial_number);
      new.serial_number := private.lock_serial_custody_identity(new.serial_number);
    else
      new.serial_number := private.lock_serial_custody_identity(new.serial_number);
      perform private.lock_serial_custody_identity(v_old_serial_number);
    end if;
  else
    new.serial_number := private.lock_serial_custody_identity(new.serial_number);
  end if;

  if new.status in ('pending', 'held', 'posted')
     and (
       tg_op = 'INSERT'
       or new.serial_number is distinct from old.serial_number
       or new.product_id is distinct from old.product_id
       or new.outcome is distinct from old.outcome
       or new.status is distinct from old.status
     ) then
    select unit.* into v_unit
      from warehouse.inventory_units unit
     where pg_catalog.upper(pg_catalog.btrim(unit.serial_number)) = new.serial_number;

    if found and (
      new.outcome <> 'clean'
      or new.product_id is distinct from v_unit.product_id
    ) then
      raise exception 'Receipt serial number already exists in inventory: %',
        new.serial_number;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.normalize_inventory_unit_serial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_serial_number text;
  v_claim warehouse.procurement_receipt_serial_claims;
begin
  new.serial_number := pg_catalog.upper(
    pg_catalog.btrim(coalesce(new.serial_number, ''))
  );
  if new.serial_number = '' then
    raise exception 'Inventory-unit serial number cannot be blank';
  end if;

  if tg_op = 'UPDATE' then
    v_old_serial_number := pg_catalog.upper(
      pg_catalog.btrim(coalesce(old.serial_number, ''))
    );
  end if;

  if tg_op = 'UPDATE'
     and v_old_serial_number is distinct from new.serial_number then
    if v_old_serial_number < new.serial_number then
      perform private.lock_serial_custody_identity(v_old_serial_number);
      new.serial_number := private.lock_serial_custody_identity(new.serial_number);
    else
      new.serial_number := private.lock_serial_custody_identity(new.serial_number);
      perform private.lock_serial_custody_identity(v_old_serial_number);
    end if;
  else
    new.serial_number := private.lock_serial_custody_identity(new.serial_number);
  end if;

  if tg_op = 'INSERT'
     or new.serial_number is distinct from old.serial_number
     or new.product_id is distinct from old.product_id
     or new.status is distinct from old.status then
    select claim.* into v_claim
      from warehouse.procurement_receipt_serial_claims claim
     where pg_catalog.upper(pg_catalog.btrim(claim.serial_number)) = new.serial_number
       and claim.status in ('pending', 'held', 'posted');

    if found and (
      v_claim.outcome <> 'clean'
      or v_claim.product_id is distinct from new.product_id
    ) then
      raise exception 'Inventory-unit serial number is reserved by governed non-clean receipt custody: %',
        new.serial_number;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists procurement_receipt_serial_normalize
  on warehouse.procurement_receipt_serial_claims;
create trigger procurement_receipt_serial_normalize
before insert or update of serial_number, product_id, outcome, status
on warehouse.procurement_receipt_serial_claims
for each row execute function private.normalize_receipt_serial_claim();

drop trigger if exists warehouse_inventory_unit_serial_normalize
  on warehouse.inventory_units;
create trigger warehouse_inventory_unit_serial_normalize
before insert or update of serial_number, product_id, status
on warehouse.inventory_units
for each row execute function private.normalize_inventory_unit_serial();

-- The already-applied exception resolver used to create an in-stock unit while
-- its damaged/unidentified claim was still active, then mark that claim posted.
-- Release accepted exception custody first; quarantined serials remain claims
-- and therefore never become inventory units.
do $migration$
declare
  v_definition text;
  v_repaired text;
  v_anchor text := $anchor$      for v_serial in
        select serial_claim.serial_number
        from warehouse.procurement_receipt_serial_claims serial_claim
        where serial_claim.decision_id=v_decision.id and serial_claim.status='pending'
        order by serial_claim.serial_number
      loop
        insert into warehouse.inventory_units(
          id,product_id,serial_number,location_id,status,bin_id
        ) values(
          'unit-'||replace(gen_random_uuid()::text,'-',''),v_product.id,v_serial,
          v_receipt.location_id,'in_stock',nullif(v_fact->>'bin_id','')
        );
      end loop;$anchor$;
  v_replacement text := $replacement$      if v_decision_outcome='accept' then
        update warehouse.procurement_receipt_serial_claims
           set status='released', transitioned_by=auth.uid(), transitioned_at=now()
         where decision_id=v_decision.id and status='pending';
        for v_serial in
          select serial_claim.serial_number
          from warehouse.procurement_receipt_serial_claims serial_claim
          where serial_claim.decision_id=v_decision.id and serial_claim.status='released'
          order by serial_claim.serial_number
        loop
          insert into warehouse.inventory_units(
            id,product_id,serial_number,location_id,status,bin_id
          ) values(
            'unit-'||replace(gen_random_uuid()::text,'-',''),v_product.id,v_serial,
            v_receipt.location_id,'in_stock',nullif(v_fact->>'bin_id','')
          );
        end loop;
      end if;$replacement$;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'private.warehouse_resolve_procurement_po_breakdown_outcome(jsonb)'
      ::pg_catalog.regprocedure
  );
  v_repaired := pg_catalog.replace(v_definition, v_anchor, v_replacement);
  if v_repaired = v_definition
     or v_repaired not like '%set status=''released''%'
     or v_repaired not like '%v_decision_outcome=''accept''%' then
    raise exception 'Expected serialized exception resolver custody anchor was not found';
  end if;
  execute v_repaired;
end;
$migration$;

alter function private.lock_serial_custody_identity(text) owner to postgres;
alter function private.normalize_receipt_serial_claim() owner to postgres;
alter function private.normalize_inventory_unit_serial() owner to postgres;
alter function private.warehouse_resolve_procurement_po_breakdown_outcome(jsonb)
  owner to postgres;

revoke all on function private.lock_serial_custody_identity(text)
  from public, anon, authenticated;
revoke all on function private.normalize_receipt_serial_claim()
  from public, anon, authenticated;
revoke all on function private.normalize_inventory_unit_serial()
  from public, anon, authenticated;

grant execute on function private.lock_serial_custody_identity(text) to service_role;
grant execute on function private.normalize_receipt_serial_claim() to service_role;
grant execute on function private.normalize_inventory_unit_serial() to service_role;

notify pgrst, 'reload schema';
