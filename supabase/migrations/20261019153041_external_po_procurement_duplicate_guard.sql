begin;

-- Transitional source exclusion, not Procurement approval or reconciliation.
-- No applied function bodies or existing Procurement records are changed.
create table private.po_receiving_source_claims (
  normalized_po_number text primary key,
  source text not null check (source in ('external','procurement')),
  check (normalized_po_number <> '' and normalized_po_number = lower(btrim(normalized_po_number)))
);
alter table private.po_receiving_source_claims owner to postgres;
alter table private.po_receiving_source_claims enable row level security;
alter table private.po_receiving_source_claims force row level security;
revoke all on private.po_receiving_source_claims from public,anon,authenticated,service_role;

create function private.lock_po_receiving_number(p_po_number text) returns text
language plpgsql volatile security definer set search_path='' as $$
declare normalized text := nullif(lower(btrim(p_po_number)),'');
begin
  if normalized is not null then
    perform pg_advisory_xact_lock(hashtextextended('warehouse.po-receiving:'||normalized,0));
  end if;
  return normalized;
end $$;

create function private.guard_external_po_procurement_number() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare normalized text;
begin
  -- Returning a document for correction must remain possible after a collision.
  if new.status not in ('draft','confirmed') then return new; end if;
  normalized := private.lock_po_receiving_number(new.po_number);
  if normalized is not null and exists (
    select 1 from procurement.purchase_orders p
    where lower(btrim(p.po_number))=normalized
  ) then
    raise exception 'This PO number already exists in Procurement. Use its existing receiving workflow or ask Operations Lead to review it. External receiving is not allowed.';
  end if;
  return new;
end $$;

create trigger external_po_procurement_number_guard
before insert or update of po_number,status on private.external_po_orders
for each row execute function private.guard_external_po_procurement_number();

create function private.guard_po_receipt_source() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare po_number text; normalized text; receipt_source text;
begin
  if new.procurement_po_id is not null then
    select p.po_number into po_number from procurement.purchase_orders p
    where p.id=new.procurement_po_id;
    if not found then return new; end if;
    receipt_source := 'procurement';
  elsif left(new.id,9)='external-' then
    -- The command inserts the receipt BEFORE updating shipment.receipt_id/status.
    -- Require its existing shipment, not merely an externally supplied ID prefix.
    select p.po_number into po_number
    from private.external_po_shipments s
    join private.external_po_orders p on p.id=s.order_id
    where s.id::text=substr(new.id,10);
    if not found then return new; end if;
    receipt_source := 'external';
  else
    return new;
  end if;

  normalized := private.lock_po_receiving_number(po_number);
  if normalized is null then
    if receipt_source='external' then raise exception 'Add the PO number before receiving this external delivery.'; end if;
    return new;
  end if;

  -- This query runs after the shared lock; all statuses and suppliers participate.
  if receipt_source='external' and exists (
    select 1 from procurement.purchase_orders p
    where lower(btrim(p.po_number))=normalized
  ) then
    raise exception 'This PO number already exists in Procurement. Use its existing receiving workflow or ask Operations Lead to review it. External receiving is not allowed.';
  end if;

  if receipt_source='procurement' and exists (
    select 1 from private.external_po_orders p
    join private.external_po_shipments s on s.order_id=p.id
    where s.status='posted' and lower(btrim(p.po_number))=normalized
  ) then
    raise exception 'This PO has already been received through External PO. Ask Operations Lead to reconcile the existing receipt instead of receiving it again.';
  end if;

  -- A unique-key write also arbitrates against transactions with older snapshots.
  -- Same-source partial deliveries proceed; opposite-source claims never change owner.
  insert into private.po_receiving_source_claims as claim(normalized_po_number,source)
  values(normalized,receipt_source)
  on conflict(normalized_po_number) do update set source=excluded.source
  where claim.source=excluded.source;
  if not found then
    if receipt_source='procurement' then
      raise exception 'This PO has already been received through External PO. Ask Operations Lead to reconcile the existing receipt instead of receiving it again.';
    end if;
    raise exception 'This PO has already been received through Procurement. Ask Operations Lead to reconcile the existing receipt instead of receiving it again.';
  end if;
  return new;
end $$;

create trigger warehouse_po_receipt_source_guard
before insert on warehouse.receipts
for each row execute function private.guard_po_receipt_source();

-- Trigger installation holds table locks until commit. Seed AFTER those locks
-- so a receipt that committed while migration DDL was waiting is included.
insert into private.po_receiving_source_claims(normalized_po_number,source)
select distinct lower(btrim(p.po_number)), 'external'
from private.external_po_orders p
join private.external_po_shipments s on s.order_id=p.id
where s.status='posted' and nullif(btrim(p.po_number),'') is not null;

alter function private.lock_po_receiving_number(text) owner to postgres;
alter function private.guard_external_po_procurement_number() owner to postgres;
alter function private.guard_po_receipt_source() owner to postgres;
revoke all on function private.lock_po_receiving_number(text),
  private.guard_external_po_procurement_number(),private.guard_po_receipt_source()
  from public,anon,authenticated,service_role;

commit;
