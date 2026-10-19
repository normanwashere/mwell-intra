-- External purchase evidence is not a Procurement approval. Existing PO routes
-- and records are unchanged; only this new source uses the functions below.
create table private.external_po_orders (
  id uuid primary key, po_number text, supplier_id text not null references warehouse.suppliers(id),
  location_id text not null references warehouse.locations(id),
  status text not null default 'draft' check(status in ('draft','confirmed','returned')),
  email_sender text not null default '', email_date date, notes text not null default '',
  evidence_urls jsonb not null default '[]', version integer not null default 1,
  created_by uuid not null references core.profiles(id), created_at timestamptz not null default now(),
  confirmed_by uuid references core.profiles(id), confirmed_at timestamptz, review_note text,
  check(length(po_number)<=120), check(length(notes)<=4000), check(length(email_sender)<=320),
  check(jsonb_typeof(evidence_urls)='array'), check(version>0),
  check(status<>'confirmed' or (confirmed_by is not null and confirmed_by<>created_by and confirmed_at is not null))
);
create unique index external_po_supplier_number on private.external_po_orders(supplier_id,lower(btrim(po_number))) where po_number is not null;
create index external_po_orders_queue on private.external_po_orders(created_at desc,id);
create table private.external_po_lines (
  id uuid primary key, order_id uuid not null references private.external_po_orders(id),
  product_id text not null references warehouse.products(id), quantity integer not null check(quantity between 1 and 100000),
  uom text not null, received_quantity integer not null default 0 check(received_quantity>=0),
  unique(order_id,product_id), check(received_quantity<=quantity)
);
create table private.external_po_shipments (
  id uuid primary key, order_id uuid not null references private.external_po_orders(id),
  delivery_reference text not null, actual_delivery_date date not null,
  bin_id text not null references warehouse.storage_areas(id), evidence_urls jsonb not null default '[]',
  notes text not null default '', lines jsonb not null,
  status text not null default 'draft' check(status in ('draft','posted')),
  receipt_id text unique references warehouse.receipts(id), version integer not null default 1,
  created_by uuid not null references core.profiles(id), created_at timestamptz not null default now(),
  posted_by uuid references core.profiles(id), posted_at timestamptz,
  check(length(btrim(delivery_reference)) between 1 and 120), check(length(notes)<=4000),
  check(jsonb_typeof(lines)='array'), check(jsonb_typeof(evidence_urls)='array'),
  check((status='posted')=(receipt_id is not null)), check(version>0)
);
create unique index external_shipment_reference on private.external_po_shipments(order_id,lower(btrim(delivery_reference)));
alter table private.external_po_orders enable row level security;
alter table private.external_po_orders force row level security;
alter table private.external_po_lines enable row level security;
alter table private.external_po_lines force row level security;
alter table private.external_po_shipments enable row level security;
alter table private.external_po_shipments force row level security;
revoke all on private.external_po_orders,private.external_po_lines,private.external_po_shipments from public,anon,authenticated,service_role;

create function private.external_po_can_confirm() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and core.has_live_cap('warehouse','receive_stock') and exists(
    select 1 from core.user_roles a join core.profiles p on p.id=a.user_id and p.status='active' and p.kind='employee'
    join core.roles r on r.module=a.module and r.role=a.role and r.is_active
    where a.user_id=auth.uid() and a.module='warehouse' and a.role in ('warehouse_supervisor','logistics_supervisor')
      and a.effective_at<=statement_timestamp() and (a.expires_at is null or a.expires_at>statement_timestamp())
  )
$$;
create function private.external_po_can_read() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (core.has_live_cap('warehouse','receive_stock')
    or core.has_live_cap('warehouse','inspect_quality') or core.has_live_cap('warehouse','view_procurement'))
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('warehouse-po-evidence','warehouse-po-evidence',false,8388608,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create function private.external_po_evidence_readable(object_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.external_po_can_read() and (
    exists(select 1 from storage.objects o where o.bucket_id='warehouse-po-evidence' and o.name=object_name
      and coalesce(o.owner_id,o.owner::text)=auth.uid()::text)
    or exists(select 1 from private.external_po_orders p where p.evidence_urls ? ('warehouse-po-evidence/'||object_name) or p.evidence_urls ? object_name)
  )
$$;
create policy external_po_upload on storage.objects for insert to authenticated
with check(bucket_id='warehouse-po-evidence' and core.has_live_cap('warehouse','receive_stock')
  and split_part(name,'/',1)=auth.uid()::text and coalesce(owner_id,owner::text)=auth.uid()::text
  and name !~ '(^|/)\.\.?(/|$)');
create policy external_po_document_read on storage.objects for select to authenticated
using(bucket_id='warehouse-po-evidence' and private.external_po_evidence_readable(name));

-- New attachments must be the actor's real uploads. A saved attachment can be
-- retained unchanged by another authorized operator, but never attached elsewhere.
create function private.external_po_check_evidence(values_json jsonb,bucket text,retained jsonb default '[]') returns void
language plpgsql security definer set search_path='' as $$
declare value text; path text;
begin
  if jsonb_typeof(values_json) is distinct from 'array' or jsonb_array_length(values_json)>20 then
    raise exception 'Attach up to 20 supporting files.';
  end if;
  for value in select jsonb_array_elements_text(values_json) loop
    if value is null or length(value)>1024 then raise exception 'Invalid evidence attachment.';end if;
    path:=case when value like bucket||'/%' then substr(value,length(bucket)+2) else value end;
    if path !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+$' or path ~ '(^|/)\.\.?(/|$)' then
      raise exception 'Upload the supporting file in this form.';
    end if;
    perform 1 from storage.objects o where o.bucket_id=bucket and o.name=path
      and ((coalesce(o.owner_id,o.owner::text)=auth.uid()::text and (o.owner is null or o.owner=auth.uid()))
        or retained ? value) for key share;
    if not found then raise exception 'Upload the supporting file using your own account.' using errcode='42501';end if;
  end loop;
end $$;

create function private.external_po_workspace(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; offset_rows integer:=coalesce((payload->>'offset')::integer,0);
begin
  if not private.external_po_can_read() then raise exception 'Not authorized to view external purchase orders.' using errcode='42501';end if;
  if offset_rows<0 then raise exception 'Invalid queue position.';end if;
  select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
    'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from private.external_po_lines l where l.order_id=p.id),'[]'),
    'shipments',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at,s.id) from private.external_po_shipments s where s.order_id=p.id),'[]')) order by p.created_at desc,p.id),'[]') into result
  from (select * from private.external_po_orders where nullif(payload->>'order_id','') is null or id=(payload->>'order_id')::uuid order by created_at desc,id limit 100 offset offset_rows) p;
  return jsonb_build_object('can_confirm',private.external_po_can_confirm(),'orders',result,
    'has_more',nullif(payload->>'order_id','') is null and exists(select 1 from private.external_po_orders offset offset_rows+100),
    'next_offset',offset_rows+100);
end $$;

create function private.external_po_command(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<external_po_command>>
declare
  action text:=payload->>'action'; started jsonb; command_id uuid;
  order_row private.external_po_orders; shipment private.external_po_shipments; po_line private.external_po_lines;
  product warehouse.products; item jsonb; serial text; serials jsonb; normalized_lines jsonb:='[]'; receipt_lines jsonb:='[]';
  order_id uuid:=(payload->>'order_id')::uuid; shipment_id uuid; expected_version integer:=coalesce((payload->>'version')::integer,0);
  quantity integer; lot_id text; receipt_id text; inspection_id uuid; source_evidence jsonb; response jsonb;
  sender text; po_number text; email_date date; delivery_date date;
begin
  if auth.uid() is null or not core.has_live_cap('warehouse','receive_stock') then
    raise exception 'Not authorized to record external PO deliveries.' using errcode='42501';
  end if;
  if action is null or action not in ('save_order','confirm_order','return_order','save_shipment','post_shipment') or order_id is null then raise exception 'Choose a valid external PO action.';end if;
  if octet_length(payload::text)>524288 then raise exception 'This delivery is too large. Split it into smaller shipments.';end if;
  if action in ('confirm_order','return_order') and not private.external_po_can_confirm() then
    raise exception 'Only Operations Lead can confirm or return the emailed PO.' using errcode='42501';
  end if;
  started:=private.begin_idempotent_command('external_po_'||action,payload->>'idempotency_key',payload);
  if (started->>'replayed')::boolean then return started->'response';end if;
  command_id:=(started->>'command_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(order_id::text,0));
  select * into order_row from private.external_po_orders where id=order_id for update;

  if action='save_order' then
    if (order_row.id is null and expected_version<>0) or (order_row.id is not null and expected_version<>order_row.version) then raise exception 'This PO changed. Reload it before saving.';end if;
    if order_row.status='confirmed' then raise exception 'Confirmed PO details are locked. Record a separately evidenced amendment instead.';end if;
    if order_row.id is not null and order_row.created_by<>auth.uid() then raise exception 'Only the person who registered this PO can edit its draft.' using errcode='42501';end if;
    if not exists(select 1 from warehouse.locations where id=payload->>'location_id' and type='warehouse' and active) then raise exception 'Choose an active receiving warehouse.';end if;
    if not exists(select 1 from warehouse.suppliers where id=payload->>'supplier_id') then raise exception 'Choose a registered supplier.';end if;
    if jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines') not between 1 and 100 then raise exception 'Add between 1 and 100 PO lines.';end if;
    source_evidence:=coalesce(payload->'evidence_urls','[]');
    perform private.external_po_check_evidence(source_evidence,'warehouse-po-evidence',coalesce(order_row.evidence_urls,'[]'));
    select coalesce(jsonb_agg(case when value like 'warehouse-po-evidence/%' then value else 'warehouse-po-evidence/'||value end),'[]')
      into source_evidence from jsonb_array_elements_text(source_evidence) value;
    po_number:=nullif(btrim(payload->>'po_number'),''); sender:=btrim(coalesce(payload->>'email_sender','')); email_date:=nullif(payload->>'email_date','')::date;
    if email_date>(now() at time zone 'Asia/Manila')::date then raise exception 'The email date cannot be in the future.';end if;
    if exists(select 1 from private.external_po_orders p where p.supplier_id=payload->>'supplier_id' and lower(btrim(p.po_number))=lower(external_po_command.po_number) and p.id<>external_po_command.order_id) then raise exception 'This supplier PO is already registered. Open the existing record.';end if;
    if order_row.id is not null and exists(select 1 from private.external_po_shipments where private.external_po_shipments.order_id=order_row.id) then
      if order_row.supplier_id<>payload->>'supplier_id' or order_row.location_id<>payload->>'location_id' then raise exception 'A delivery is already attached. Keep its supplier and warehouse unchanged.';end if;
      if exists(select 1 from private.external_po_lines l where l.order_id=order_row.id and not exists(select 1 from jsonb_array_elements(payload->'lines') x where (x->>'id')::uuid=l.id and x->>'product_id'=l.product_id)) then raise exception 'Keep the PO lines already used by a saved delivery.';end if;
    end if;
    insert into private.external_po_orders(id,po_number,supplier_id,location_id,email_sender,email_date,notes,evidence_urls,created_by)
    values(order_id,external_po_command.po_number,payload->>'supplier_id',payload->>'location_id',sender,external_po_command.email_date,coalesce(payload->>'notes',''),source_evidence,auth.uid())
    on conflict(id) do update set po_number=excluded.po_number,supplier_id=excluded.supplier_id,location_id=excluded.location_id,email_sender=excluded.email_sender,email_date=excluded.email_date,notes=excluded.notes,evidence_urls=excluded.evidence_urls,status='draft',review_note=null,version=private.external_po_orders.version+1;
    if exists(select 1 from jsonb_array_elements(payload->'lines') l group by l->>'id' having count(*)>1) or exists(select 1 from jsonb_array_elements(payload->'lines') l group by l->>'product_id' having count(*)>1) then raise exception 'Use each SKU once on this PO.';end if;
    for item in select jsonb_array_elements(payload->'lines') loop
      select * into product from warehouse.products where id=item->>'product_id';
      if not found then raise exception 'Select a product from the catalogue.';end if;
      if item->>'quantity' is null or item->>'quantity' !~ '^[0-9]+$' or (item->>'quantity')::numeric not between 1 and 100000 then raise exception 'Enter a positive whole-number PO quantity.';end if;
      if item->>'uom' is distinct from product.uom then raise exception 'Use the catalogue unit of measure. Pack conversions must be resolved first.';end if;
      if exists(select 1 from private.external_po_lines l where l.id=(item->>'id')::uuid and l.order_id<>external_po_command.order_id) then raise exception 'This PO line belongs to another record.';end if;
      insert into private.external_po_lines(id,order_id,product_id,quantity,uom) values((item->>'id')::uuid,external_po_command.order_id,product.id,(item->>'quantity')::integer,product.uom)
      on conflict(id) do update set product_id=excluded.product_id,quantity=excluded.quantity,uom=excluded.uom
        where private.external_po_lines.order_id=excluded.order_id;
      if not found then raise exception 'This PO line belongs to another record. Reload the PO.' using errcode='42501';end if;
    end loop;
    delete from private.external_po_lines l where l.order_id=order_row.id and not exists(select 1 from jsonb_array_elements(payload->'lines') x where (x->>'id')::uuid=l.id);
  else
    if order_row.id is null then raise exception 'External PO not found. Reload the list.';end if;
    if action in ('confirm_order','return_order') then
      if order_row.created_by=auth.uid() then raise exception 'Ask another Operations Lead to check the PO you registered.';end if;
      if expected_version<>order_row.version then raise exception 'This PO changed. Reload it before reviewing.';end if;
      if order_row.status='confirmed' then raise exception 'This PO is already confirmed.';end if;
      if nullif(btrim(payload->>'review_note'),'') is null then raise exception 'Record what you checked or what needs correcting.';end if;
      if action='confirm_order' then
        if order_row.po_number is null or order_row.email_date is null or nullif(order_row.email_sender,'') is null or jsonb_array_length(order_row.evidence_urls)=0 then raise exception 'Add the PO number, sender, email date and supporting document before confirmation.';end if;
        perform private.external_po_check_evidence(order_row.evidence_urls,'warehouse-po-evidence',order_row.evidence_urls);
        update private.external_po_orders set status='confirmed',confirmed_by=auth.uid(),confirmed_at=now(),review_note=btrim(payload->>'review_note'),version=version+1 where id=order_id;
      else
        update private.external_po_orders set status='returned',review_note=btrim(payload->>'review_note'),version=version+1 where id=order_id;
      end if;
    else
      shipment_id:=(payload->>'shipment_id')::uuid;
      if shipment_id is null then raise exception 'Choose a delivery record.';end if;
      select * into shipment from private.external_po_shipments where id=shipment_id for update;
      if shipment.id is not null and shipment.order_id<>order_id then raise exception 'This delivery belongs to another PO.';end if;
      if (shipment.id is null and expected_version<>0) or (shipment.id is not null and shipment.version<>expected_version) then raise exception 'This delivery changed. Reload it before continuing.';end if;
      if shipment.status='posted' then raise exception 'This delivery has already been received. Open its receipt instead.';end if;
      if shipment.id is not null and shipment.created_by<>auth.uid() then raise exception 'Only the receiver who saved this delivery can change or post it.' using errcode='42501';end if;
      if action='save_shipment' then
        if not exists(select 1 from warehouse.storage_areas where id=payload->>'bin_id' and location_id=order_row.location_id and active) then raise exception 'Choose a receiving bin in this warehouse.';end if;
        delivery_date:=nullif(payload->>'actual_delivery_date','')::date;
        if delivery_date is null or delivery_date>(now() at time zone 'Asia/Manila')::date then raise exception 'Enter the actual delivery date, no later than today.';end if;
        if jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines') not between 1 and 100 then raise exception 'Add the items that physically arrived.';end if;
        if exists(select 1 from jsonb_array_elements(payload->'lines') l group by l->>'po_line_id' having count(*)>1) then raise exception 'Use each PO line once per delivery.';end if;
        source_evidence:=coalesce(payload->'evidence_urls','[]');
        perform private.external_po_check_evidence(source_evidence,'evidence',coalesce(shipment.evidence_urls,'[]'));
        for item in select jsonb_array_elements(payload->'lines') loop
          select * into po_line from private.external_po_lines l where l.id=(item->>'po_line_id')::uuid and l.order_id=order_row.id;
          if not found then raise exception 'Select a line from this PO.';end if;
          if item->>'quantity' is null or item->>'quantity' !~ '^[0-9]+$' or (item->>'quantity')::numeric not between 1 and 100000 then raise exception 'Enter the positive whole-number delivered quantity.';end if;
          if jsonb_typeof(coalesce(item->'serial_numbers','[]')) is distinct from 'array' then raise exception 'Enter the scanned serial numbers.';end if;
        end loop;
        if exists(select 1 from private.external_po_shipments s where s.order_id=external_po_command.order_id and lower(btrim(s.delivery_reference))=lower(btrim(payload->>'delivery_reference')) and s.id<>shipment_id) then raise exception 'This delivery reference is already recorded for the PO.';end if;
        insert into private.external_po_shipments(id,order_id,delivery_reference,actual_delivery_date,bin_id,evidence_urls,notes,lines,created_by)
        values(shipment_id,order_id,btrim(payload->>'delivery_reference'),delivery_date,payload->>'bin_id',source_evidence,coalesce(payload->>'notes',''),payload->'lines',auth.uid())
        on conflict(id) do update set delivery_reference=excluded.delivery_reference,actual_delivery_date=excluded.actual_delivery_date,bin_id=excluded.bin_id,evidence_urls=excluded.evidence_urls,notes=excluded.notes,lines=excluded.lines,version=private.external_po_shipments.version+1
          where private.external_po_shipments.order_id=excluded.order_id and private.external_po_shipments.created_by=auth.uid()
            and private.external_po_shipments.version=expected_version and private.external_po_shipments.status='draft';
        if not found then raise exception 'This delivery changed or belongs to another receiver. Reload the PO.' using errcode='42501';end if;
      else
        if shipment.id is null then raise exception 'Save the delivery before receiving it.';end if;
        if order_row.status<>'confirmed' then raise exception 'Awaiting Operations Lead PO confirmation. This delivery is saved but not available stock.';end if;
        if not exists(select 1 from warehouse.locations where id=order_row.location_id and active and type='warehouse') or not exists(select 1 from warehouse.storage_areas where id=shipment.bin_id and location_id=order_row.location_id and active) then raise exception 'The receiving warehouse or bin is inactive. Ask Operations Lead to review it.';end if;
        if jsonb_array_length(shipment.evidence_urls)=0 then raise exception 'Attach delivery evidence before receiving into inspection.';end if;
        perform private.external_po_check_evidence(shipment.evidence_urls,'evidence',shipment.evidence_urls);
        perform private.lock_warehouse_products(array(select l.product_id from private.external_po_lines l where l.order_id=order_row.id));
        receipt_id:='external-'||shipment.id::text;
        for item in select jsonb_array_elements(shipment.lines) loop
          select * into po_line from private.external_po_lines l where l.id=(item->>'po_line_id')::uuid and l.order_id=order_row.id for update;
          if not found then raise exception 'A saved line no longer belongs to this PO.';end if;
          if item->>'quantity' is null or item->>'quantity' !~ '^[0-9]+$' or (item->>'quantity')::numeric not between 1 and 100000 then raise exception 'Enter the positive whole-number delivered quantity.';end if;
          quantity:=(item->>'quantity')::integer;
          if quantity>po_line.quantity-po_line.received_quantity then raise exception 'Delivered quantity exceeds the remaining PO quantity. Keep the excess aside and ask Operations Lead for a corrected external PO.';end if;
          select * into product from warehouse.products where id=po_line.product_id for key share;
          select coalesce(jsonb_agg(upper(btrim(s))),'[]') into serials from jsonb_array_elements_text(coalesce(item->'serial_numbers','[]')) s;
          if product.serialized and (jsonb_array_length(serials)<>quantity or exists(select 1 from jsonb_array_elements_text(serials) s where s is null or length(s) not between 1 and 200) or (select count(distinct s) from jsonb_array_elements_text(serials) s)<>quantity) then raise exception 'Scan one different serial number for every received unit.';end if;
          if not product.serialized and jsonb_array_length(serials)>0 then raise exception 'This product is quantity-tracked; do not enter serial numbers.';end if;
          if product.expiry_tracked and nullif(item->>'expiry_date','') is null then raise exception 'Enter the expiry date for this product.';end if;
          if nullif(item->>'expiry_date','')::date<shipment.actual_delivery_date then raise exception 'This stock was expired on arrival. Keep it in exception custody for review.';end if;
          normalized_lines:=normalized_lines||jsonb_build_array(item||jsonb_build_object('serial_numbers',serials));
          lot_id:='external-lot-'||shipment.id||'-'||po_line.id;
          receipt_lines:=receipt_lines||jsonb_build_array(jsonb_build_object('productId',product.id,'quantity',quantity,'serialNumbers',serials,'lotCode',lot_id,'supplierLotCode',nullif(item->>'lot_code',''),'externalPOLineId',po_line.id));
        end loop;
        insert into warehouse.receipts(id,supplier_id,location_id,actual_delivery_date,delivery_reference,lines,evidence_urls,quality_status,actor,received_by)
        values(receipt_id,order_row.supplier_id,order_row.location_id,shipment.actual_delivery_date,shipment.delivery_reference,receipt_lines,shipment.evidence_urls,'pending',warehouse.authoritative_actor(),auth.uid());
        for item in select jsonb_array_elements(normalized_lines) loop
          select * into po_line from private.external_po_lines where id=(item->>'po_line_id')::uuid;
          select * into product from warehouse.products where id=po_line.product_id;
          quantity:=(item->>'quantity')::integer; lot_id:='external-lot-'||shipment.id||'-'||po_line.id;
          insert into warehouse.lots(id,product_id,lot_code,supplier_id,unit_cost,received_at,expiry_date)
          values(lot_id,product.id,lot_id,order_row.supplier_id,product.unit_cost,now(),nullif(item->>'expiry_date','')::date);
          -- The physical receiving bin stays on the shipment. Operational stock
          -- remains unassigned staging until Quality releases its hold and the
          -- existing putaway command assigns its final bin. In-stock plus hold
          -- matches existing ATP math; pending_inspection plus hold double-counts.
          if product.serialized then
            for serial in select jsonb_array_elements_text(item->'serial_numbers') loop
              perform pg_advisory_xact_lock(hashtextextended(serial,1));
              if exists(select 1 from warehouse.inventory_units where upper(btrim(serial_number))=serial) then raise exception 'A scanned serial number is already in inventory. Review the existing unit.';end if;
              insert into warehouse.inventory_units(id,product_id,serial_number,lot_id,location_id,bin_id,status)
              values('external-unit-'||gen_random_uuid(),product.id,serial,lot_id,order_row.location_id,null,'in_stock');
              insert into warehouse.quality_inspections(source_type,source_id,product_id,lot_id,serial_number,location_id,bin_id,quantity,disposition,reason,evidence_urls,inspected_by,inspected_by_email)
              values('receipt',receipt_id,product.id,lot_id,serial,order_row.location_id,null,1,'pending','Awaiting external PO quality inspection',shipment.evidence_urls,auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text)) returning id into inspection_id;
              insert into warehouse.inventory_holds(inspection_id,product_id,lot_id,serial_number,location_id,bin_id,quantity,reason,evidence_urls,created_by)
              values(inspection_id,product.id,lot_id,serial,order_row.location_id,null,1,'Awaiting external PO quality inspection',shipment.evidence_urls,auth.uid());
            end loop;
          else
            insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity) values(product.id,order_row.location_id,null,lot_id,quantity);
            insert into warehouse.quality_inspections(source_type,source_id,product_id,lot_id,location_id,bin_id,quantity,disposition,reason,evidence_urls,inspected_by,inspected_by_email)
            values('receipt',receipt_id,product.id,lot_id,order_row.location_id,null,quantity,'pending','Awaiting external PO quality inspection',shipment.evidence_urls,auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text)) returning id into inspection_id;
            insert into warehouse.inventory_holds(inspection_id,product_id,lot_id,location_id,bin_id,quantity,reason,evidence_urls,created_by)
            values(inspection_id,product.id,lot_id,order_row.location_id,null,quantity,'Awaiting external PO quality inspection',shipment.evidence_urls,auth.uid());
          end if;
          insert into warehouse.movements(id,type,product_id,quantity,to_location_id,to_bin_id,lot_id,reference,evidence_urls,actor)
          values('external-move-'||shipment.id||'-'||po_line.id,'receipt',product.id,quantity,order_row.location_id,null,lot_id,receipt_id,shipment.evidence_urls,warehouse.authoritative_actor());
          update private.external_po_lines set received_quantity=received_quantity+external_po_command.quantity where id=po_line.id;
        end loop;
        update private.external_po_shipments set status='posted',receipt_id=external_po_command.receipt_id,posted_by=auth.uid(),posted_at=now(),version=version+1 where id=shipment.id;
      end if;
    end if;
  end if;
  response:=jsonb_strip_nulls(jsonb_build_object('order_id',order_id,'shipment_id',shipment_id,'receipt_id',receipt_id));
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail) values('warehouse','external_po',order_id::text,action,auth.uid(),response||jsonb_build_object('review_note',payload->>'review_note'));
  return private.finish_idempotent_command(command_id,response);
end $$;

create function private.external_po_inspect(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<external_po_inspect>>
declare started jsonb; receipt warehouse.receipts; inspection warehouse.quality_inspections; held warehouse.inventory_holds; exception_row warehouse.exceptions;
  disposition text:=payload->>'disposition'; reason text:=nullif(btrim(payload->>'reason'),''); evidence jsonb:=coalesce(payload->'evidence_urls','[]');
begin
  if auth.uid() is null or not core.has_live_cap('warehouse','inspect_quality') then raise exception 'Not authorized to inspect this delivery.' using errcode='42501';end if;
  select r.* into receipt from warehouse.receipts r join private.external_po_shipments s on s.receipt_id=r.id where r.id=payload->>'source_id' for update of r;
  if not found then raise exception 'External PO receipt not found.';end if;
  if receipt.received_by=auth.uid() then raise exception 'Ask another Quality inspector to check the delivery you received.' using errcode='42501';end if;
  started:=private.begin_idempotent_command('inspect_quality',payload->>'idempotency_key',payload);
  if (started->>'replayed')::boolean then return started->'response';end if;
  if disposition is null or disposition not in ('accepted','hold','damaged','vendor_return','unavailable') then raise exception 'Choose the inspection result.';end if;
  if disposition<>'accepted' and reason is null then raise exception 'Describe why these items cannot be accepted.';end if;
  if jsonb_array_length(evidence)=0 then raise exception 'Attach inspection evidence.';end if;
  perform private.external_po_check_evidence(evidence,'evidence');
  perform private.lock_warehouse_products(array[payload->>'product_id']);
  select * into inspection from warehouse.quality_inspections i where i.source_type='receipt' and i.source_id=receipt.id
    and i.product_id=payload->>'product_id' and i.bin_id is not distinct from nullif(payload->>'bin_id','')
    and i.lot_id is not distinct from nullif(payload->>'lot_id','') and i.serial_number is not distinct from nullif(upper(btrim(payload->>'serial_number')),'')
    and i.disposition='pending' for update;
  if not found or inspection.quantity is distinct from (payload->>'quantity')::integer then raise exception 'The inspection quantity or item changed. Reload the Quality queue.';end if;
  select * into held from warehouse.inventory_holds where inspection_id=inspection.id and status='active' for update;
  if not found then raise exception 'The inspection hold is missing. Contact Operations Lead.';end if;
  update warehouse.quality_inspections set disposition=external_po_inspect.disposition,reason=case when external_po_inspect.disposition='accepted' then 'Accepted by independent quality inspection' else external_po_inspect.reason end,
    evidence_urls=evidence,inspected_by=auth.uid(),inspected_by_email=coalesce(auth.jwt()->>'email',auth.uid()::text),inspected_at=now() where id=inspection.id returning * into inspection;
  update warehouse.inventory_units u set status='in_stock' where u.product_id=inspection.product_id and u.serial_number=inspection.serial_number and u.lot_id=inspection.lot_id and u.status='pending_inspection';
  if disposition='accepted' then
    update warehouse.inventory_holds set status='released',released_by=auth.uid(),released_at=now(),release_reason='Accepted by independent quality inspection',release_evidence_urls=evidence where id=held.id returning * into held;
  else
    update warehouse.inventory_holds set reason=external_po_inspect.reason,evidence_urls=evidence where id=held.id returning * into held;
    insert into warehouse.exceptions(exception_type,severity,source_type,source_id,status,resolution,evidence_urls,created_by)
    values('quality','P2','quality_inspection',inspection.id::text,'open','Awaiting independent hold disposition',evidence,auth.uid()) returning * into exception_row;
  end if;
  update warehouse.receipts set quality_status=case when exists(select 1 from warehouse.quality_inspections i where i.source_id=receipt.id and i.source_type='receipt' and i.disposition='pending') then 'pending'
    when exists(select 1 from warehouse.inventory_holds h join warehouse.quality_inspections i on i.id=h.inspection_id where i.source_id=receipt.id and i.source_type='receipt' and h.status='active') then 'hold' else 'accepted' end where id=receipt.id;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail) values('warehouse','quality_inspection',inspection.id::text,'external_po_inspected',auth.uid(),jsonb_build_object('receipt_id',receipt.id,'disposition',disposition));
  return private.finish_idempotent_command((started->>'command_id')::uuid,jsonb_build_object('inspection',to_jsonb(inspection),'hold',to_jsonb(held),'exception',case when exception_row.id is null then null else to_jsonb(exception_row) end));
end $$;

create function private.guard_external_po_hold() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='active' and old.reason='Awaiting external PO quality inspection' then
    if tg_op='DELETE' then raise exception 'Complete the independent Quality inspection before changing this hold.';end if;
    if (to_jsonb(new)-array['status','reason','evidence_urls','released_by','released_at','release_reason','release_evidence_urls'])
       is distinct from (to_jsonb(old)-array['status','reason','evidence_urls','released_by','released_at','release_reason','release_evidence_urls']) then
      raise exception 'The receipt item and held quantity cannot be changed. Complete the independent Quality inspection.';
    end if;
    if (new.status is distinct from old.status or new.reason is distinct from old.reason) and not exists(
      select 1 from warehouse.quality_inspections i join warehouse.receipts r on r.id=i.source_id
      join private.external_po_shipments s on s.receipt_id=r.id
      where i.id=old.inspection_id and i.disposition<>'pending' and i.inspected_by=auth.uid()
        and r.received_by<>auth.uid() and i.product_id=old.product_id and i.quantity=old.quantity
        and i.location_id=old.location_id and i.bin_id is not distinct from old.bin_id
        and i.lot_id is not distinct from old.lot_id and i.serial_number is not distinct from old.serial_number
        and ((new.status='active' and i.disposition<>'accepted' and new.reason=i.reason and new.evidence_urls=i.evidence_urls)
          or (new.status='released' and i.disposition='accepted' and new.released_by=auth.uid()
            and new.released_at=i.inspected_at and new.release_evidence_urls=i.evidence_urls
            and new.release_reason='Accepted by independent quality inspection'))
    ) then raise exception 'Complete the independent Quality inspection before releasing this hold.';end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger guard_external_po_hold before update or delete on warehouse.inventory_holds for each row execute function private.guard_external_po_hold();

create function warehouse.external_po_workspace(payload jsonb default '{}') returns jsonb
language sql stable security invoker set search_path='' as $$ select private.external_po_workspace(payload) $$;
create function warehouse.external_po_command(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.external_po_command(payload) $$;
create or replace function warehouse.inspect_quality(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' and not core.has_live_cap('warehouse','inspect_quality') then raise exception 'Not authorized: warehouse.inspect_quality';end if;
  if payload->>'source_type'='receipt' and exists(select 1 from private.external_po_shipments where receipt_id=payload->>'source_id') then return private.external_po_inspect(payload);end if;
  if payload->>'source_type'='return' and exists(select 1 from warehouse.command_log c where c.command_name='record_return_v2' and c.response->>'id'=inspect_quality.payload->>'source_id') then return private.inspect_return_intake(payload);end if;
  return private.warehouse_inspect_quality_v3(payload);
end $$;

revoke all on function private.external_po_can_read(),private.external_po_can_confirm(),private.external_po_evidence_readable(text),private.external_po_check_evidence(jsonb,text,jsonb),private.external_po_workspace(jsonb),private.external_po_command(jsonb),private.external_po_inspect(jsonb),private.guard_external_po_hold(),warehouse.external_po_workspace(jsonb),warehouse.external_po_command(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.external_po_workspace(jsonb),private.external_po_command(jsonb),warehouse.external_po_workspace(jsonb),warehouse.external_po_command(jsonb),private.external_po_evidence_readable(text) to authenticated;
notify pgrst,'reload schema';
