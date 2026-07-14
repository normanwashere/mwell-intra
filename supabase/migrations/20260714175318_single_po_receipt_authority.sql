-- Warehouse is the single authority for physical procurement PO receipts.
-- Procurement retains only the safe aggregate handoff/status projection.

-- Keep the two legacy operating-role names as exact migration aliases until
-- assignments are remapped to the canonical Operator/Supervisor roles.
delete from core.role_capabilities
where module = 'warehouse' and role in ('operations', 'logistics_supervisor');

insert into core.role_capabilities(module, role, cap)
select module, 'operations', cap
from core.role_capabilities
where module = 'warehouse' and role = 'warehouse_operator'
union all
select module, 'logistics_supervisor', cap
from core.role_capabilities
where module = 'warehouse' and role = 'warehouse_supervisor'
on conflict do nothing;

do $$
begin
  if to_regprocedure('procurement.receive_purchase_order(jsonb)') is not null then
    execute 'revoke all on function procurement.receive_purchase_order(jsonb) from public, anon, authenticated';
    execute 'drop function if exists procurement.receive_purchase_order(jsonb)';
  end if;
  if to_regprocedure('warehouse.receive_against_procurement_po(jsonb)') is not null then
    execute 'revoke all on function warehouse.receive_against_procurement_po(jsonb) from public, anon, authenticated';
    execute 'drop function if exists warehouse.receive_against_procurement_po(jsonb)';
  end if;
end
$$;

alter table procurement.purchase_order_lines
  add column if not exists receiving_status text not null default 'open';

alter table warehouse.quality_inspections
  add column if not exists procurement_po_line_id text;

create index if not exists warehouse_quality_procurement_line_idx
  on warehouse.quality_inspections(procurement_po_line_id, source_id)
  where procurement_po_line_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'procurement_po_line_receiving_status_check'
  ) then
    alter table procurement.purchase_order_lines
      add constraint procurement_po_line_receiving_status_check
      check (receiving_status in ('open', 'rejected', 'cancelled'));
  end if;
end
$$;

do $$
begin
  if to_regprocedure('private.warehouse_receive_procurement_po_legacy(jsonb)') is null
     and to_regprocedure('private.warehouse_receive_procurement_po(jsonb)') is not null then
    alter function private.warehouse_receive_procurement_po(jsonb)
      rename to warehouse_receive_procurement_po_legacy;
  end if;
end
$$;

revoke all on function private.warehouse_receive_procurement_po_legacy(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_receive_procurement_po_legacy(jsonb)
  to service_role;

create or replace function private.warehouse_receive_procurement_po(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po procurement.purchase_orders;
  v_line procurement.purchase_order_lines;
  v_payload_line jsonb;
  v_quantity numeric;
  v_payload_hash text;
  v_existing warehouse.command_log;
  v_response jsonb;
  v_receipt_id text;
  v_short boolean;
  v_closed boolean;
begin
  if not core.has_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: warehouse.receive_stock';
  end if;
  if nullif(payload->>'idempotency_key', '') is null then
    raise exception 'Idempotency key is required';
  end if;
  if jsonb_typeof(payload->'lines') <> 'array'
     or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'At least one procurement PO line is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload->'lines') item
     group by item->>'line_id' having count(*) > 1
  ) then
    raise exception 'A procurement PO line cannot be received twice in one command';
  end if;

  select * into v_po
    from procurement.purchase_orders
   where id::text = payload->>'po_id'
   for update;
  if not found then raise exception 'Procurement purchase order not found'; end if;

  v_payload_hash := private.warehouse_payload_hash(payload);
  select * into v_existing
    from warehouse.command_log
   where actor_id = auth.uid()
     and command_name = 'receive_procurement_po'
     and idempotency_key = payload->>'idempotency_key'
   for update;
  if found then
    if v_existing.payload_hash <> v_payload_hash then
      raise exception 'Idempotency key was already used with a different payload';
    end if;
    if v_existing.completed_at is null or v_existing.response is null then
      raise exception 'Receipt command is already in progress';
    end if;
    return v_existing.response;
  end if;

  if v_po.status <> 'issued' then
    raise exception 'Only issued procurement POs can be received';
  end if;

  -- Lock and validate every requested line before the legacy poster performs
  -- any inventory, movement, quality, or receipt write.
  for v_payload_line in select value from jsonb_array_elements(payload->'lines')
  loop
    select * into v_line
      from procurement.purchase_order_lines
     where id::text = v_payload_line->>'line_id'
       and purchase_order_id = v_po.id
     for update;
    if not found then raise exception 'Procurement PO line not found'; end if;
    if v_line.receiving_status <> 'open' then
      raise exception 'Cancelled or rejected procurement PO lines cannot be received';
    end if;
    if coalesce(nullif(v_payload_line->>'disposition', ''), 'accepted') <> 'accepted' then
      raise exception 'Rejected or quarantined receipt lines cannot post inventory';
    end if;
    begin
      v_quantity := (v_payload_line->>'quantity')::numeric;
    exception when others then
      raise exception 'Warehouse receipt quantity must be a positive whole number';
    end;
    if v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
      raise exception 'Warehouse receipt quantity must be a positive whole number';
    end if;
    if v_line.received_quantity + v_quantity > v_line.quantity then
      raise exception 'Receipt quantity exceeds the procurement PO line balance';
    end if;
  end loop;

  -- The legacy poster inserts one QC row immediately after each payload line.
  -- Feed that trigger an ordered, transaction-local queue so duplicate-product
  -- PO lines retain their exact identity without a product-based guess.
  perform set_config('warehouse.procurement_po_line_queue', (payload->'lines')::text, true);
  v_response := private.warehouse_receive_procurement_po_legacy(payload);
  v_receipt_id := v_response #>> '{receipt,id}';

  if coalesce(current_setting('warehouse.procurement_po_line_queue', true), '[]')::jsonb <> '[]'::jsonb
     or exists (
       select 1 from warehouse.quality_inspections
        where source_type='receipt' and source_id=v_receipt_id
          and procurement_po_line_id is null
     ) then
    raise exception 'Receipt QC could not be bound to every procurement PO line';
  end if;
  perform set_config('warehouse.procurement_po_line_queue', '[]', true);

  select exists (
    select 1
      from procurement.purchase_order_lines line
     where line.purchase_order_id = v_po.id
       and line.receiving_status = 'open'
       and line.received_quantity < line.quantity
  ) into v_short;

  select not exists (
    select 1
      from procurement.purchase_order_lines line
     where line.purchase_order_id = v_po.id
       and line.receiving_status = 'open'
       and line.received_quantity < line.quantity
  ) into v_closed;

  update procurement.purchase_orders
     set status = case when v_closed then 'closed' else 'issued' end,
         updated_at = now()
   where id = v_po.id
   returning * into v_po;

  update warehouse.quality_inspections
     set disposition = 'accepted'
   where source_type = 'receipt'
     and source_id = v_receipt_id
     and disposition = 'pending';
  update warehouse.receipts
     set quality_status = case when v_short then 'partial' else 'accepted' end
   where id = v_receipt_id;

  if v_short then
    insert into warehouse.exceptions(
      exception_type, severity, source_type, source_id, status,
      resolution, created_by
    ) values (
      'po_receipt', 'P2', 'receipt', v_receipt_id, 'open',
      'Short or partial procurement PO receipt requires Warehouse Supervisor review.',
      auth.uid()
    );
  end if;

  v_response := jsonb_set(
    v_response,
    '{receipt,quality_status}',
    to_jsonb(case when v_short then 'partial'::text else 'accepted'::text end),
    true
  );
  v_response := jsonb_set(v_response, '{purchase_order}', to_jsonb(v_po), true);
  update warehouse.command_log
     set response = v_response
   where actor_id = auth.uid()
     and command_name = 'receive_procurement_po'
     and idempotency_key = payload->>'idempotency_key';
  return v_response;
end;
$$;

revoke all on function private.warehouse_receive_procurement_po(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_receive_procurement_po(jsonb)
  to service_role;

create or replace function warehouse.receive_procurement_po(payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.warehouse_receive_procurement_po(payload) $$;

revoke all on function warehouse.receive_procurement_po(jsonb) from public, anon;
grant execute on function warehouse.receive_procurement_po(jsonb)
  to authenticated, service_role;

create table if not exists warehouse.procurement_receipt_exception_decisions (
  id uuid primary key default gen_random_uuid(),
  receipt_id text not null unique references warehouse.receipts(id) on delete restrict,
  purchase_order_id text not null references procurement.purchase_orders(id) on delete restrict,
  exception_id uuid not null unique references warehouse.exceptions(id) on delete restrict,
  requested_disposition text not null check (requested_disposition in ('damaged','quarantine')),
  request_reason text not null,
  request_evidence_urls jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','decided')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decision text check (decision in ('quarantine','reject')),
  decision_reason text,
  decision_evidence_urls jsonb not null default '[]'::jsonb,
  decided_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz
);
alter table warehouse.procurement_receipt_exception_decisions enable row level security;
alter table warehouse.procurement_receipt_exception_decisions force row level security;
revoke all on warehouse.procurement_receipt_exception_decisions from public, anon, authenticated;
grant all on warehouse.procurement_receipt_exception_decisions to service_role;

create or replace function private.warehouse_receive_procurement_po_exception(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_po procurement.purchase_orders;
  v_line procurement.purchase_order_lines;
  v_payload_line jsonb;
  v_product warehouse.products;
  v_receipt warehouse.receipts;
  v_receipt_id text := 'rcpt-' || replace(gen_random_uuid()::text, '-', '');
  v_receipt_lines jsonb := '[]'::jsonb;
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_quantity numeric;
  v_route_id uuid;
  v_exception warehouse.exceptions;
  v_decision warehouse.procurement_receipt_exception_decisions;
  v_exception_type text := payload->>'exception_type';
  v_disposition text;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'receive_procurement_po_exception', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: warehouse.receive_stock';
  end if;
  if v_exception_type not in ('damaged','quarantine') then
    raise exception 'Exception receipt must be damaged or quarantine';
  end if;
  if jsonb_typeof(v_evidence) <> 'array' or jsonb_array_length(v_evidence)=0 then
    raise exception 'Exception receipt evidence is required';
  end if;
  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines')=0 then
    raise exception 'At least one procurement PO line is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload->'lines') item
    group by item->>'line_id' having count(*) > 1
  ) then
    raise exception 'A procurement PO line cannot be received twice in one command';
  end if;

  select * into v_po from procurement.purchase_orders
   where id::text=payload->>'po_id' for update;
  if not found then raise exception 'Procurement purchase order not found'; end if;
  if v_po.status <> 'issued' then raise exception 'Only issued procurement POs can be received'; end if;
  if not exists (
    select 1 from warehouse.locations location
     where location.id=payload->>'location_id' and location.type='warehouse'
  ) then raise exception 'Receiving destination must be a warehouse'; end if;

  select route.id into v_route_id
  from warehouse.operation_routes route
  join warehouse.operation_types operation on operation.id=route.operation_type_id
  where operation.code='receipt' and operation.active and route.active
    and 'vendor'=any(route.source_location_types)
    and 'warehouse'=any(route.destination_location_types)
  order by route.created_at, route.id limit 1;
  if v_route_id is null then raise exception 'No active vendor-to-warehouse receipt route'; end if;

  for v_payload_line in select value from jsonb_array_elements(payload->'lines') loop
    select * into v_line from procurement.purchase_order_lines line
     where line.id::text=v_payload_line->>'line_id'
       and line.purchase_order_id=v_po.id
     for update;
    if not found then raise exception 'Procurement PO line not found'; end if;
    if v_line.receiving_status <> 'open' then
      raise exception 'Cancelled or rejected procurement PO lines cannot be received';
    end if;
    begin v_quantity := (v_payload_line->>'quantity')::numeric;
    exception when others then raise exception 'Exception quantity must be a positive whole number'; end;
    if v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
      raise exception 'Exception quantity must be a positive whole number';
    end if;
    if v_line.received_quantity + v_quantity > v_line.quantity then
      raise exception 'Exception quantity exceeds the procurement PO line balance';
    end if;
    select * into v_product from warehouse.products product
     where product.id=v_payload_line->>'product_id';
    if not found then raise exception 'Warehouse product mapping not found'; end if;
    if v_line.warehouse_product_id is not null and v_line.warehouse_product_id <> v_product.id then
      raise exception 'Procurement PO line is mapped to a different Warehouse product';
    end if;
    update procurement.purchase_order_lines
       set warehouse_product_id=v_product.id
     where id=v_line.id and warehouse_product_id is null;
    v_receipt_lines := v_receipt_lines || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'quantity', v_quantity::integer,
      'procurementLineId', v_line.id::text,
      'exceptionType', v_exception_type
    ));
  end loop;

  insert into warehouse.receipts(
    id,supplier_id,location_id,lines,evidence_urls,actor,created_at,
    operation_route_id,procurement_po_id,quality_status
  ) values (
    v_receipt_id,'proc-' || v_po.core_vendor_id::text,payload->>'location_id',
    v_receipt_lines,v_evidence,coalesce(auth.jwt()->>'email',auth.uid()::text),now(),
    v_route_id,v_po.id::text,'hold'
  ) returning * into v_receipt;

  v_disposition := 'pending';
  for v_payload_line in select value from jsonb_array_elements(payload->'lines') loop
    insert into warehouse.quality_inspections(
      source_type,source_id,product_id,location_id,quantity,disposition,reason,
      evidence_urls,inspected_by,inspected_by_email,procurement_po_line_id
    ) values (
      'receipt',v_receipt.id,v_payload_line->>'product_id',payload->>'location_id',
      (v_payload_line->>'quantity')::integer,v_disposition,
      coalesce(nullif(payload->>'reason',''), initcap(v_exception_type) || ' on receipt'),
      v_evidence,auth.uid(),coalesce(auth.jwt()->>'email',''),v_payload_line->>'line_id'
    );
  end loop;

  insert into warehouse.exceptions(
    exception_type,severity,source_type,source_id,status,resolution,created_by
  ) values (
    'po_receipt','P1','receipt',v_receipt.id,'open',
    initcap(v_exception_type) || ' receipt requires Warehouse Supervisor disposition.',auth.uid()
  ) returning * into v_exception;
  insert into warehouse.procurement_receipt_exception_decisions(
    receipt_id,purchase_order_id,exception_id,requested_disposition,request_reason,
    request_evidence_urls,requested_by
  ) values (
    v_receipt.id,v_po.id::text,v_exception.id,v_exception_type,
    coalesce(nullif(btrim(payload->>'reason'),''),initcap(v_exception_type) || ' on receipt'),
    v_evidence,auth.uid()
  ) returning * into v_decision;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values ('warehouse','procurement_purchase_order',v_po.id::text,'receipt_exception',auth.uid(),
    jsonb_build_object('warehouse_receipt_id',v_receipt.id,'exception_type',v_exception_type,'lines',v_receipt_lines));

  v_response := jsonb_build_object(
    'receipt',to_jsonb(v_receipt),'purchase_order',to_jsonb(v_po),
    'exception',to_jsonb(v_exception),'decision',to_jsonb(v_decision)
  );
  return private.finish_idempotent_command(v_command_id,v_response);
end;
$$;

create or replace function warehouse.receive_procurement_po_exception(payload jsonb)
returns jsonb language sql security definer set search_path=''
as $$ select private.warehouse_receive_procurement_po_exception(payload) $$;
revoke all on function private.warehouse_receive_procurement_po_exception(jsonb) from public, anon, authenticated;
revoke all on function warehouse.receive_procurement_po_exception(jsonb) from public, anon;
grant execute on function private.warehouse_receive_procurement_po_exception(jsonb) to service_role;
grant execute on function warehouse.receive_procurement_po_exception(jsonb) to authenticated, service_role;

create or replace function private.warehouse_resolve_procurement_po_exception(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_decision warehouse.procurement_receipt_exception_decisions;
  v_receipt warehouse.receipts;
  v_exception warehouse.exceptions;
  v_outcome text := payload->>'decision';
  v_evidence jsonb := coalesce(payload->'evidence_urls','[]'::jsonb);
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'resolve_procurement_po_exception',payload->>'idempotency_key',payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if not core.has_cap('warehouse','release_quality_hold')
     or not core.has_cap('warehouse','resolve_exceptions') then
    raise exception 'Not authorized: Warehouse Supervisor controlled receipt decision';
  end if;
  select * into v_decision from warehouse.procurement_receipt_exception_decisions
   where id=(payload->>'decision_id')::uuid for update;
  if v_decision.id is null then raise exception 'Receipt exception decision not found'; end if;
  if v_decision.requested_by = auth.uid() then
    raise exception 'The receiving Operator cannot approve their own exception, including through delegation';
  end if;
  if v_decision.status <> 'pending' then raise exception 'Receipt exception decision is no longer pending'; end if;
  if v_outcome not in ('quarantine','reject') then raise exception 'Invalid receipt exception decision'; end if;
  if nullif(btrim(payload->>'reason'),'') is null then raise exception 'Decision reason is required'; end if;
  if jsonb_typeof(v_evidence) <> 'array' or jsonb_array_length(v_evidence)=0 then
    raise exception 'Decision evidence is required';
  end if;
  select * into v_receipt from warehouse.receipts where id=v_decision.receipt_id for update;
  select * into v_exception from warehouse.exceptions where id=v_decision.exception_id for update;
  update warehouse.quality_inspections
     set disposition=case when v_outcome='quarantine' then 'hold' else 'vendor_return' end,
         reason=payload->>'reason', evidence_urls=v_evidence
   where source_type='receipt' and source_id=v_decision.receipt_id and disposition='pending';
  if not found then raise exception 'Pending receipt quality inspection not found'; end if;
  update warehouse.receipts
     set quality_status=case when v_outcome='quarantine' then 'hold' else 'closed' end
   where id=v_decision.receipt_id
   returning * into v_receipt;
  update warehouse.exceptions
     set status='resolved', resolution=payload->>'reason', evidence_urls=v_evidence, updated_at=now()
   where id=v_decision.exception_id;
  update warehouse.procurement_receipt_exception_decisions
     set status='decided',decision=v_outcome,decision_reason=payload->>'reason',
         decision_evidence_urls=v_evidence,decided_by=auth.uid(),decided_at=now()
   where id=v_decision.id returning * into v_decision;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values ('warehouse','receipt_exception_decision',v_decision.id::text,'decide',auth.uid(),
    jsonb_build_object('receipt_id',v_receipt.id,'exception_id',v_exception.id,'decision',v_outcome));
  v_response := jsonb_build_object('decision',to_jsonb(v_decision),'receipt',to_jsonb(v_receipt));
  return private.finish_idempotent_command(v_command_id,v_response);
end $$;

create or replace function warehouse.resolve_procurement_po_exception(payload jsonb)
returns jsonb language sql security definer set search_path=''
as $$ select private.warehouse_resolve_procurement_po_exception(payload) $$;
revoke all on function private.warehouse_resolve_procurement_po_exception(jsonb) from public, anon, authenticated;
revoke all on function warehouse.resolve_procurement_po_exception(jsonb) from public, anon;
grant execute on function private.warehouse_resolve_procurement_po_exception(jsonb) to service_role;
grant execute on function warehouse.resolve_procurement_po_exception(jsonb) to authenticated, service_role;

create or replace function warehouse.procurement_receipt_exception_work_items(payload jsonb default '{}'::jsonb)
returns table(decision_id uuid,receipt_id text,purchase_order_id text,po_number text,
  requested_disposition text,requested_by uuid,requested_at timestamptz,reason text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not core.has_cap('warehouse','release_quality_hold')
     or not core.has_cap('warehouse','resolve_exceptions') then
    raise exception 'Not authorized to view controlled receipt decisions';
  end if;
  return query select decision.id,decision.receipt_id,decision.purchase_order_id,po.po_number,
    decision.requested_disposition,decision.requested_by,decision.requested_at,decision.request_reason
  from warehouse.procurement_receipt_exception_decisions decision
  join procurement.purchase_orders po on po.id=decision.purchase_order_id
  where decision.status=coalesce(nullif(payload->>'status',''),'pending')
  order by decision.requested_at;
end $$;
revoke all on function warehouse.procurement_receipt_exception_work_items(jsonb) from public, anon;
grant execute on function warehouse.procurement_receipt_exception_work_items(jsonb) to authenticated, service_role;

create or replace function private.bind_quality_procurement_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line_id text;
  v_queue jsonb;
  v_queue_line jsonb;
begin
  if new.source_type <> 'receipt' or new.procurement_po_line_id is not null then return new; end if;
  v_line_id := nullif(current_setting('warehouse.procurement_po_line_id', true), '');
  v_queue := coalesce(nullif(current_setting('warehouse.procurement_po_line_queue', true), '')::jsonb, '[]'::jsonb);
  if v_line_id is null and jsonb_typeof(v_queue)='array' and jsonb_array_length(v_queue)>0 then
    v_queue_line := v_queue->0;
    if v_queue_line->>'product_id' <> new.product_id
       or (v_queue_line->>'quantity')::numeric <> new.quantity then
      raise exception 'Receipt QC does not match the ordered procurement PO-line queue';
    end if;
    v_line_id := nullif(v_queue_line->>'line_id', '');
    perform set_config('warehouse.procurement_po_line_queue', (v_queue - 0)::text, true);
  end if;
  if v_line_id is null then
    select min(line->>'procurementLineId') into v_line_id
      from warehouse.receipts receipt
      cross join lateral jsonb_array_elements(receipt.lines) line
     where receipt.id=new.source_id and line->>'productId'=new.product_id
    having count(distinct line->>'procurementLineId') = 1;
  end if;
  new.procurement_po_line_id := v_line_id;
  return new;
end;
$$;

drop trigger if exists warehouse_quality_procurement_line on warehouse.quality_inspections;
create trigger warehouse_quality_procurement_line
before insert on warehouse.quality_inspections for each row
execute function private.bind_quality_procurement_line();
revoke all on function private.bind_quality_procurement_line() from public, anon, authenticated;
grant execute on function private.bind_quality_procurement_line() to service_role;

create or replace function warehouse.inspect_quality(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_line_id text;
  v_receipt warehouse.receipts;
begin
  v_line_id := nullif(payload->>'procurement_po_line_id', '');
  if payload->>'source_type'='receipt' then
    select * into v_receipt from warehouse.receipts receipt
     where receipt.id=payload->>'source_id';
    if v_receipt.procurement_po_id is not null then
      if v_line_id is null then
        raise exception 'Procurement PO-line identity is required for receipt quality disposition';
      end if;
      if not exists (
        select 1 from jsonb_array_elements(v_receipt.lines) receipt_line
         where receipt_line->>'procurementLineId'=v_line_id
           and receipt_line->>'productId'=payload->>'product_id'
      ) then
        raise exception 'Quality disposition PO line does not belong to the receipt';
      end if;
    end if;
  end if;
  perform set_config('warehouse.procurement_po_line_id', coalesce(v_line_id, ''), true);
  return private.warehouse_inspect_quality(payload);
end;
$$;
revoke all on function warehouse.inspect_quality(jsonb) from public, anon;
grant execute on function warehouse.inspect_quality(jsonb) to authenticated, service_role;
revoke all on function private.warehouse_inspect_quality(jsonb) from public, anon, authenticated;
grant execute on function private.warehouse_inspect_quality(jsonb) to service_role;

create or replace function private.procurement_po_receipt_status()
returns table (
  purchase_order_id text,
  ordered_quantity numeric,
  accepted_quantity numeric,
  rejected_or_quarantined_quantity numeric,
  outstanding_quantity numeric,
  latest_warehouse_receipt_reference text,
  qc_status text,
  last_received_at timestamptz,
  accepted_lines jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with receipt_lines as (
    select
      receipt.procurement_po_id as po_id,
      receipt.id as receipt_id,
      receipt.created_at,
      receipt.quality_status,
      line->>'procurementLineId' as procurement_po_line_id,
      coalesce((line->>'quantity')::numeric, 0) as quantity
    from warehouse.receipts receipt
    cross join lateral jsonb_array_elements(receipt.lines) line
    join procurement.purchase_order_lines po_line
      on po_line.id = line->>'procurementLineId'
     and po_line.purchase_order_id = receipt.procurement_po_id
     and po_line.receiving_status = 'open'
    where receipt.procurement_po_id is not null
  ), dispositions as (
    select
      receipt_line.*,
      coalesce(inspection.disposition, receipt_line.quality_status, 'pending') as disposition
    from receipt_lines receipt_line
    left join lateral (
      select quality.disposition
      from warehouse.quality_inspections quality
      where quality.source_type = 'receipt'
        and quality.source_id = receipt_line.receipt_id
        and quality.procurement_po_line_id = receipt_line.procurement_po_line_id
      order by quality.inspected_at desc, quality.id desc
      limit 1
    ) inspection on true
  ), line_totals as (
    select
      po_id,
      procurement_po_line_id,
      sum(quantity) filter (where disposition='accepted') as accepted_quantity,
      sum(quantity) filter (where disposition in ('damaged','hold','vendor_return','unavailable')) as rejected_quantity
    from dispositions
    group by po_id, procurement_po_line_id
  ), totals as (
    select
      po_id,
      sum(coalesce(accepted_quantity,0)) as accepted_quantity,
      sum(coalesce(rejected_quantity,0)) as rejected_quantity
    from line_totals
    group by po_id
  ), received_at as (
    select po_id, max(created_at) as last_received_at
    from dispositions group by po_id
  )
  select
    po.id,
    coalesce(lines.ordered_quantity, 0),
    coalesce(totals.accepted_quantity, 0),
    coalesce(totals.rejected_quantity, 0),
    greatest(
      coalesce(lines.ordered_quantity, 0)
        - coalesce(totals.accepted_quantity, 0),
      0
    ) as outstanding_quantity,
    latest.receipt_id,
    case
      when coalesce(totals.rejected_quantity, 0) > 0 then 'exception'
      when coalesce(totals.accepted_quantity, 0) >= coalesce(lines.ordered_quantity, 0)
        and coalesce(lines.ordered_quantity, 0) > 0 then 'accepted'
      when coalesce(totals.accepted_quantity, 0) > 0 then 'partial'
      else 'not_received'
    end,
    received_at.last_received_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'poLineId', line_total.procurement_po_line_id,
        'acceptedQuantity', coalesce(line_total.accepted_quantity,0),
        'rejectedOrQuarantinedQuantity', coalesce(line_total.rejected_quantity,0)
      ) order by line_total.procurement_po_line_id)
      from line_totals line_total where line_total.po_id=po.id
    ), '[]'::jsonb)
  from procurement.purchase_orders po
  left join lateral (
    select sum(line.quantity) as ordered_quantity
    from procurement.purchase_order_lines line
    where line.purchase_order_id = po.id
      and line.receiving_status = 'open'
  ) lines on true
  left join totals on totals.po_id = po.id
  left join received_at on received_at.po_id = po.id
  left join lateral (
    select receipt.id as receipt_id
    from warehouse.receipts receipt
    where receipt.procurement_po_id = po.id::text
    order by receipt.created_at desc, receipt.id desc
    limit 1
  ) latest on true
  where core.has_cap('procurement', 'view_dashboard')
     or core.has_cap('procurement', 'author_po')
     or core.has_cap('warehouse', 'receive_stock');
$$;

revoke all on function private.procurement_po_receipt_status()
  from public, anon;
grant execute on function private.procurement_po_receipt_status()
  to authenticated, service_role;

create or replace view procurement.v_purchase_order_receipt_status
with (security_invoker = true)
as
select * from private.procurement_po_receipt_status();

revoke all on procurement.v_purchase_order_receipt_status from public, anon;
grant select on procurement.v_purchase_order_receipt_status
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Database-authoritative commitment evidence and readiness
-- ---------------------------------------------------------------------------

create table if not exists procurement.policy_evidence (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references procurement.requests(id) on delete restrict,
  control_code text not null,
  evidence_type text not null,
  facts jsonb not null default '{}'::jsonb,
  review_status text not null default 'submitted',
  reviewed_by uuid references core.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint procurement_policy_evidence_review_check check (
    review_status in ('submitted', 'approved', 'rejected', 'expired', 'superseded')
  )
);

create index if not exists procurement_policy_evidence_request_idx
  on procurement.policy_evidence(request_id, control_code, review_status, created_at desc);

alter table procurement.policy_evidence enable row level security;
alter table procurement.policy_evidence force row level security;
drop policy if exists procurement_policy_evidence_read on procurement.policy_evidence;
create policy procurement_policy_evidence_read on procurement.policy_evidence
  for select to authenticated
  using (core.has_cap('procurement', 'view_dashboard') or core.has_cap('procurement', 'author_po'));
revoke all on procurement.policy_evidence from public, anon, authenticated;
grant select on procurement.policy_evidence to authenticated;
grant all on procurement.policy_evidence to service_role;

-- Converge the legacy Legal checklist shape before runtime accreditation reads.
alter table legal.requirement_checklist_items
  add column if not exists code text,
  add column if not exists decision text,
  add column if not exists reviewer_email text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewer_note text;

create or replace function private.sync_legal_requirement_checklist_contract()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  new.code := coalesce(new.code, nullif(v_new->>'requirement_code',''));
  if v_new ? 'status' and (
    tg_op='INSERT' or v_new->>'status' is distinct from v_old->>'status'
  ) then
    new.decision := case
      when v_new->>'status'='waived' and nullif(btrim(coalesce(new.reviewer_note,'')),'') is not null then 'na'
      when v_new->>'status'='waived' then 'pending'
      else v_new->>'status'
    end;
  else
    new.decision := coalesce(new.decision, 'pending');
  end if;
  return new;
end;
$$;
drop trigger if exists legal_requirement_checklist_contract_sync on legal.requirement_checklist_items;
create trigger legal_requirement_checklist_contract_sync
before insert or update on legal.requirement_checklist_items
for each row execute function private.sync_legal_requirement_checklist_contract();
revoke all on function private.sync_legal_requirement_checklist_contract() from public, anon, authenticated;
grant execute on function private.sync_legal_requirement_checklist_contract() to service_role;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='legal' and table_name='requirement_checklist_items' and column_name='requirement_code') then
    execute 'update legal.requirement_checklist_items set code=coalesce(code, requirement_code) where code is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='legal' and table_name='requirement_checklist_items' and column_name='status') then
    execute 'update legal.requirement_checklist_items set decision=coalesce(decision, case when status=''waived'' and nullif(btrim(coalesce(reviewer_note,'''')),'''') is not null then ''na'' when status=''waived'' then ''pending'' else status end) where decision is null';
  end if;
end
$$;

alter table procurement.exception_packs
  add column if not exists route_decision_id uuid references procurement.route_decisions(id) on delete restrict,
  add column if not exists route_method text,
  add column if not exists request_version integer;

with latest_route as (
  select distinct on (decision.request_id)
    decision.request_id, decision.id, decision.method, decision.request_version
  from procurement.route_decisions decision
  where decision.status='confirmed'
  order by decision.request_id, decision.request_version desc, decision.confirmed_at desc
)
update procurement.exception_packs exception_pack set
  route_decision_id=latest_route.id,
  route_method=latest_route.method,
  request_version=latest_route.request_version
from latest_route
where exception_pack.route_decision_id is null
  and latest_route.request_id=exception_pack.request_id;

create or replace function private.enforce_exception_pack_binding_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.request_id is distinct from new.request_id
     or old.vendor_id is distinct from new.vendor_id
     or old.route_decision_id is distinct from new.route_decision_id
     or old.route_method is distinct from new.route_method
     or old.request_version is distinct from new.request_version
     or old.exception_type is distinct from new.exception_type then
    raise exception 'Exception pack request, vendor, route, version, and type binding is immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists procurement_exception_pack_binding_immutable on procurement.exception_packs;
create trigger procurement_exception_pack_binding_immutable before update on procurement.exception_packs
for each row execute function private.enforce_exception_pack_binding_immutable();
revoke all on function private.enforce_exception_pack_binding_immutable() from public, anon, authenticated;
grant execute on function private.enforce_exception_pack_binding_immutable() to service_role;

create table if not exists procurement.acceptance_reviewer_assignments (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references procurement.requests(id) on delete restrict,
  reviewer_id uuid not null references core.profiles(id) on delete restrict,
  assigned_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique(request_id, reviewer_id)
);
alter table procurement.acceptance_reviewer_assignments enable row level security;
alter table procurement.acceptance_reviewer_assignments force row level security;
revoke all on procurement.acceptance_reviewer_assignments from public, anon, authenticated;
grant all on procurement.acceptance_reviewer_assignments to service_role;

create or replace function private.vendor_accreditation_readiness(
  p_vendor_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vendor core.vendors;
  v_request procurement.requests;
  v_case legal.accreditation_cases;
  v_snapshot legal.vendor_application_snapshots;
  v_required text[];
  v_code text;
  v_technology boolean := false;
  v_blockers jsonb := '[]'::jsonb;
begin
  select * into v_vendor from core.vendors where id = p_vendor_id;
  select * into v_request from procurement.requests where id = p_request_id;
  if v_vendor.id is null then return jsonb_build_array('selected vendor record'); end if;

  if exists (
    select 1
      from legal.accreditation_dispositions disposition
      join legal.accreditation_cases accreditation_case on accreditation_case.id = disposition.case_id
     where accreditation_case.vendor_id = p_vendor_id
       and disposition.disposition = 'temporary_clearance'
       and (disposition.conditions->>'approved')::boolean is true
       and coalesce((disposition.conditions->>'valid_from')::timestamptz, disposition.decided_at) <= now()
       and coalesce((disposition.conditions->>'valid_until')::timestamptz, disposition.follow_up_due_at) > now()
       and (disposition.conditions->>'request_id' is null or disposition.conditions->>'request_id' = p_request_id)
       and (disposition.conditions->>'category' is null or disposition.conditions->>'category' = v_request.category)
       and (disposition.conditions->>'max_amount' is null
         or coalesce(v_request.estimated_amount, 0) <= (disposition.conditions->>'max_amount')::numeric)
  ) then
    return v_blockers;
  end if;

  if v_vendor.accreditation_status <> 'approved'
     or (v_vendor.accreditation_expires_at is not null and v_vendor.accreditation_expires_at < current_date) then
    v_blockers := v_blockers || jsonb_build_array('current full accreditation or approved scoped temporary clearance');
    return v_blockers;
  end if;

  select * into v_case
    from legal.accreditation_cases
   where vendor_id = p_vendor_id and status = 'approved'
     and (expires_at is null or expires_at >= current_date)
   order by decided_at desc nulls last, created_at desc
   limit 1;
  if v_case.id is null then
    return v_blockers || jsonb_build_array('approved LGL004 accreditation case');
  end if;

  select * into v_snapshot
    from legal.vendor_application_snapshots
   where case_id = v_case.id and status = 'submitted' and policy_version = '2025'
   order by submitted_at desc nulls last, created_at desc
   limit 1;
  if v_snapshot.id is null then
    v_blockers := v_blockers || jsonb_build_array('signed Vendor Accreditation Form V2025 snapshot');
  end if;
  if v_case.entity_type not in ('sole_prop', 'partnership', 'corporation', 'branch_foreign') then
    return v_blockers || jsonb_build_array('supported LGL004 entity type');
  end if;

  v_required := case v_case.entity_type
    when 'sole_prop' then array['PH_DTI_REG','PH_BIR_2303','PH_MAYORS_PERMIT','PH_CLIENT_LIST']
    when 'partnership' then array['PH_SEC_REG','PH_PARTNERSHIP_ARTICLES','PH_BIR_2303','PH_PARTNERSHIP_RESOLUTION','PH_MAYORS_PERMIT','PH_CLIENT_LIST']
    when 'corporation' then array['PH_SEC_REG_ARTICLES_BYLAWS','PH_BIR_2303','PH_SECRETARY_CERT','PH_GIS','PH_MAYORS_PERMIT','PH_EXPERTISE_CERTS','PH_CLIENT_PORTFOLIO']
    else array['PH_SEC_REG_ARTICLES_BYLAWS','PH_BIR_2303','PH_SECRETARY_CERT','PH_GIS','PH_MAYORS_PERMIT','PH_EXPERTISE_CERTS','PH_CLIENT_PORTFOLIO']
  end;
  v_required := v_required || array['PH_AFS_3Y','PH_COMPANY_PROFILE','PH_BANK_PROOF','PH_OFFICIAL_RECEIPT','SIGN_NDA'];
  if v_case.handles_personal_data then v_required := v_required || 'PH_PRIVACY_COMPLIANCE'; end if;
  v_technology := coalesce((v_snapshot.payload->>'technologyServiceProvider')::boolean, false)
    or coalesce((v_request.compliance#>>'{riskFacts,technologyServiceProvider}')::boolean, false)
    or coalesce((v_request.compliance#>>'{risk_facts,technology_service_provider}')::boolean, false);
  if v_technology then v_required := v_required || 'PH_CYBERSECURITY_POLICIES'; end if;

  foreach v_code in array v_required loop
    if not exists (
      select 1
       from legal.requirement_checklist_items item
       where item.case_id = v_case.id and item.code = v_code and item.required
         and (item.decision = 'approved' or (
           v_code <> 'SIGN_NDA' and item.decision = 'na'
           and item.reviewer_email is not null and item.reviewed_at is not null
           and nullif(btrim(item.reviewer_note),'') is not null
         ))
    ) and not (
      v_code <> 'SIGN_NDA' and coalesce(v_case.jurisdiction, 'PH') <> 'PH' and exists (
        select 1 from legal.accreditation_dispositions disposition
         where disposition.case_id = v_case.id and disposition.requirement_code = v_code
           and disposition.disposition in ('foreign_equivalent', 'not_applicable')
           and disposition.decided_by is not null and disposition.decided_at is not null
           and nullif(btrim(disposition.reason),'') is not null
      )
    ) then
      v_blockers := v_blockers || jsonb_build_array('approved accreditation requirement ' || v_code);
    end if;
  end loop;

  if v_technology and (
    jsonb_array_length(coalesce(v_snapshot.payload->'technologyQualifications','[]'::jsonb)) = 0
    or exists (
      select 1 from jsonb_array_elements(coalesce(v_snapshot.payload->'technologyQualifications','[]'::jsonb)) qualification
       where not exists (
         select 1 from legal.vendor_technology_qualifications reviewed
          where reviewed.application_snapshot_id=v_snapshot.id
            and reviewed.pool=qualification->>'pool' and reviewed.qualified
            and reviewed.reviewed_by is not null and reviewed.reviewed_at is not null
       )
    )
  ) then
    v_blockers := v_blockers || jsonb_build_array('reviewed V2025 technology qualification pools');
  end if;

  if v_technology and not exists (
    select 1
      from legal.instrument_documents document
     where document.case_id = v_case.id
       and document.template_version like 'mnda-tech-service-provider-%'
       and document.status = 'executed'
       and document.executed_at is not null
       and now() < least(
         document.executed_at + interval '2 years',
         coalesce(document.definitive_agreement_executed_at, 'infinity'::timestamptz)
       )
       and (select count(*) from legal.instrument_signatures signature
             where signature.instrument_document_id = document.id and signature.revoked_at is null) = 2
  ) then
    v_blockers := v_blockers || jsonb_build_array('current fully executed technology MNDA');
  end if;
  return v_blockers;
end;
$$;

alter table procurement.financial_protection_requirements
  add column if not exists waiver_basis text,
  add column if not exists waiver_evidence_storage_path text;

create or replace function private.lock_procurement_request(p_request_id text)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  perform 1 from procurement.requests where id=p_request_id for update;
  if not found then raise exception 'Procurement request not found'; end if;
end $$;
revoke all on function private.lock_procurement_request(text) from public, anon, authenticated;
grant execute on function private.lock_procurement_request(text) to service_role;

create or replace function private.procurement_commitment_readiness(
  p_request_id text,
  p_vendor_id uuid default null,
  p_phase text default 'issue'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request procurement.requests;
  v_route procurement.route_decisions;
  v_pack procurement.exception_packs;
  v_blockers jsonb := '[]'::jsonb;
  v_context jsonb := '{}'::jsonb;
  v_required_code text;
  v_required_codes text[] := '{}';
begin
  if p_phase not in ('submit','award','issue') then
    raise exception 'Unsupported commitment-readiness phase';
  end if;
  perform private.lock_procurement_request(p_request_id);
  select * into v_request from procurement.requests where id = p_request_id;
  if v_request.id is null then return jsonb_build_object('ready', false, 'blockers', jsonb_build_array('procurement request')); end if;
  select * into v_route from procurement.route_decisions
   where request_id = p_request_id and status = 'confirmed'
   order by request_version desc limit 1;
  if v_route.id is null then
    v_blockers := v_blockers || jsonb_build_array('Procurement-confirmed sourcing route');
  else
    v_context := coalesce(v_request.compliance, '{}'::jsonb) || coalesce(v_route.risk_facts, '{}'::jsonb);
    if p_phase in ('award','issue') then
    if v_route.method = 'rfq' then
      v_required_codes := array['RFQ_COMMERCIAL_COMPARISON'];
    elsif v_route.method = 'rfp' then
      v_required_codes := array['RFP_TECHNICAL_EVALUATION','RFP_COMMERCIAL_EVALUATION','RFP_AWARD_RECOMMENDATION'];
    end if;
    if v_route.method in ('rfq', 'rfp') and not exists (
      select 1 from procurement.sourcing_events event
       where event.request_id = p_request_id and event.route_decision_id = v_route.id
         and event.status in ('issued', 'closed') and exists (
           select 1 from procurement.sourcing_responses response
            where response.sourcing_event_id = event.id and response.received_at is not null
         )
    ) then
      v_blockers := v_blockers || jsonb_build_array('documented ' || upper(v_route.method) || ' sourcing event and received response');
    end if;
    foreach v_required_code in array v_required_codes loop
      if not exists (
        select 1 from procurement.policy_evidence evidence
         where evidence.request_id = p_request_id and evidence.control_code = v_required_code
           and evidence.review_status = 'approved'
           and (evidence.expires_at is null or evidence.expires_at > now())
      ) then v_blockers := v_blockers || jsonb_build_array('approved policy evidence ' || v_required_code); end if;
    end loop;
    end if;
  end if;

  if p_phase = 'submit' then
    return jsonb_build_object(
      'ready', jsonb_array_length(v_blockers)=0, 'phase', p_phase,
      'request_id', p_request_id, 'vendor_id', p_vendor_id,
      'route', v_route.method, 'blockers', v_blockers,
      'evidence', '[]'::jsonb, 'protections', '[]'::jsonb
    );
  end if;

  if p_phase in ('award','issue') and v_route.method in ('direct_award','repeat_order','emergency','petty_cash') then
    select * into v_pack from procurement.exception_packs exception_pack
     where exception_pack.request_id = p_request_id and exception_pack.status = 'approved'
       and exception_pack.vendor_id = p_vendor_id
       and exception_pack.route_decision_id = v_route.id
       and exception_pack.request_version = v_route.request_version
       and exception_pack.route_method = v_route.method
       and exception_pack.exception_type = case v_route.method
         when 'direct_award' then 'direct_award'
         when 'repeat_order' then 'repeat_continuity'
         when 'emergency' then 'emergency'
         else 'petty_cash_non_accredited'
       end
     order by created_at desc limit 1;
    if v_pack.id is null then
      v_blockers := v_blockers || jsonb_build_array('approved exception pack');
    elsif v_route.method = 'direct_award' then
      if v_pack.exception_type <> 'direct_award'
         or v_pack.vendor_id is null
         or nullif(btrim(v_pack.justification), '') is null
         or nullif(btrim(v_pack.price_reasonableness), '') is null
         or nullif(v_pack.evidence->>'allowed_basis', '') is null
         or nullif(v_pack.evidence->>'requested_vendor', '') is null
         or nullif(v_pack.evidence->>'price_support', '') is null
         or nullif(v_pack.accreditation_state, '') is null
         or v_pack.procurement_head_reviewed_by is null
         or v_pack.procurement_head_reviewed_at is null then
        v_blockers := v_blockers || jsonb_build_array('complete Direct Award pack and Procurement Head review');
      end if;
      if (v_pack.final_approval_step_id is null or not exists (
        select 1 from procurement.approval_steps step
         where step.id = v_pack.final_approval_step_id and step.request_id = p_request_id and step.status = 'approved'
      )) then v_blockers := v_blockers || jsonb_build_array('final DOA approval for Direct Award'); end if;
    elsif v_route.method = 'petty_cash' and (
      v_pack.exception_type <> 'petty_cash_non_accredited'
      or not coalesce(v_pack.finance_eligibility_confirmed, false)
      or not coalesce(v_pack.non_recurring_non_split_attested, false)
      or nullif(btrim(v_pack.justification), '') is null
    ) then v_blockers := v_blockers || jsonb_build_array('Finance-approved one-time non-split petty-cash exception'); end if;
  end if;

  if p_phase in ('award','issue') and p_vendor_id is not null and not (
    v_route.method = 'petty_cash' and v_pack.exception_type = 'petty_cash_non_accredited'
      and coalesce(v_pack.finance_eligibility_confirmed, false)
      and coalesce(v_pack.non_recurring_non_split_attested, false)
  ) then
    v_blockers := v_blockers || private.vendor_accreditation_readiness(p_vendor_id, p_request_id);
  elsif p_phase in ('award','issue') and p_vendor_id is null then
    v_blockers := v_blockers || jsonb_build_array('selected vendor');
  end if;

  if p_phase = 'issue' and (coalesce((v_context->>'importation')::boolean, false)
     or coalesce((v_context->>'foreignVendor')::boolean, false)
     or exists (
       select 1 from legal.accreditation_cases accreditation_case
        where accreditation_case.vendor_id=p_vendor_id
          and coalesce(accreditation_case.jurisdiction,'PH') <> 'PH'
     )) then
    if not exists (
      select 1 from procurement.policy_evidence evidence
       where evidence.request_id = p_request_id and evidence.control_code = 'IMPORT_PLAN'
         and evidence.review_status = 'approved'
         and evidence.facts ?& array['incoterms','importerOfRecord','permitsAndRegistrations','customsBrokerAndLogistics','dutiesTaxesFreightInsurance','foreignPaymentTiming','deliveryAcceptanceAndWarranty']
    ) then v_blockers := v_blockers || jsonb_build_array('approved complete importation plan'); end if;
  end if;

  if p_phase = 'issue' and coalesce((v_context->>'downPayment')::boolean, false) and not exists (
    select 1 from procurement.financial_protection_requirements protection
     where protection.request_id = p_request_id and protection.protection_type = 'down_payment_bond'
       and protection.status = 'approved' and protection.reviewed_by is not null
       and coalesce(protection.required_amount, 0) >= coalesce((v_context->>'downPaymentAmount')::numeric, 0)
  ) then v_blockers := v_blockers || jsonb_build_array('approved down-payment bond equal to the down payment'); end if;
  if p_phase = 'issue' and v_request.category = 'manpower' and not exists (
    select 1 from procurement.financial_protection_requirements protection
     where protection.request_id = p_request_id and protection.protection_type = 'payment_bond'
          and (protection.status='approved' or (
            protection.status='waived' and protection.reviewed_by is not null
            and nullif(btrim(protection.waiver_reason),'') is not null
            and nullif(btrim(protection.waiver_basis),'') is not null
            and nullif(btrim(protection.waiver_evidence_storage_path),'') is not null
          ))
  ) then v_blockers := v_blockers || jsonb_build_array('reviewed manpower payment-bond or equivalent protection'); end if;
  if p_phase = 'issue' and v_request.category = 'construction' then
    foreach v_required_code in array array['performance_bond','warranty_bond','cari','eari'] loop
      if not exists (select 1 from procurement.financial_protection_requirements protection
        where protection.request_id = p_request_id and protection.protection_type = v_required_code
          and (protection.status='approved' or (
            protection.status='waived' and protection.reviewed_by is not null
            and nullif(btrim(protection.waiver_reason),'') is not null
            and nullif(btrim(protection.waiver_basis),'') is not null
            and nullif(btrim(protection.waiver_evidence_storage_path),'') is not null
          )))
      then v_blockers := v_blockers || jsonb_build_array('approved construction protection ' || v_required_code); end if;
    end loop;
    if coalesce((v_context->>'pcabRequired')::boolean, false) and not exists (
      select 1 from procurement.policy_evidence evidence where evidence.request_id=p_request_id
        and evidence.control_code='PCAB_LICENSE' and evidence.review_status='approved'
    ) then v_blockers := v_blockers || jsonb_build_array('applicable approved PCAB evidence'); end if;
  end if;
  if p_phase = 'issue' and coalesce((v_context->>'equipmentInstallation')::boolean, false) and not exists (
    select 1 from procurement.policy_evidence evidence where evidence.request_id=p_request_id
      and evidence.control_code='INSTALLATION_PROTECTIONS' and evidence.review_status='approved'
  ) then v_blockers := v_blockers || jsonb_build_array('approved installation commissioning, defects, warranty, acceptance, and risk protections'); end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'phase', p_phase,
    'request_id', p_request_id,
    'vendor_id', p_vendor_id,
    'route', v_route.method,
    'blockers', v_blockers,
    'evidence', coalesce((select jsonb_agg(jsonb_build_object(
      'id', evidence.id,
      'controlCode', evidence.control_code, 'evidenceType', evidence.evidence_type,
      'reviewStatus', evidence.review_status, 'reviewedAt', evidence.reviewed_at,
      'expiresAt', evidence.expires_at
    ) order by evidence.created_at) from procurement.policy_evidence evidence
      where evidence.request_id = p_request_id and evidence.review_status <> 'superseded'), '[]'::jsonb),
    'protections', coalesce((select jsonb_agg(jsonb_build_object(
      'id', protection.id, 'protectionType', protection.protection_type,
      'triggerBasis', protection.trigger_basis, 'requiredAmount', protection.required_amount,
      'requiredPercentage', protection.required_percentage, 'dueBefore', protection.due_before,
      'status', protection.status, 'reviewedAt', protection.reviewed_at,
      'waiverReason', protection.waiver_reason,
      'waiverBasis', protection.waiver_basis,
      'waiverEvidenceStoragePath', protection.waiver_evidence_storage_path
    ) order by protection.id) from procurement.financial_protection_requirements protection
      where protection.request_id=p_request_id and protection.status <> 'superseded'), '[]'::jsonb)
  );
end;
$$;

create or replace function procurement.commitment_readiness(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_requester_id uuid;
begin
  select requester_id into v_requester_id from procurement.requests where id=payload->>'request_id';
  if v_requester_id is null then raise exception 'Procurement request not found'; end if;
  if auth.uid() <> v_requester_id
     and not core.has_cap('procurement','view_dashboard')
     and not core.has_cap('procurement','author_po')
     and not core.has_cap('procurement','approve_award') then
    raise exception 'Not authorized to view commitment readiness';
  end if;
  return private.procurement_commitment_readiness(
    payload->>'request_id', nullif(payload->>'vendor_id','')::uuid,
    coalesce(nullif(payload->>'phase',''), 'issue')
  ) || jsonb_build_object(
    'canRecordAcceptance',
    auth.uid() = v_requester_id or exists (
      select 1 from procurement.acceptance_reviewer_assignments assignment
       where assignment.request_id=payload->>'request_id'
         and assignment.reviewer_id=auth.uid()
         and assignment.superseded_at is null
    )
  );
end;
$$;

revoke all on function private.vendor_accreditation_readiness(uuid,text) from public, anon, authenticated;
revoke all on function private.procurement_commitment_readiness(text,uuid,text) from public, anon, authenticated;
revoke all on function procurement.commitment_readiness(jsonb) from public, anon;
grant execute on function private.vendor_accreditation_readiness(uuid,text) to service_role;
grant execute on function private.procurement_commitment_readiness(text,uuid,text) to service_role;
grant execute on function procurement.commitment_readiness(jsonb) to authenticated, service_role;

create or replace view procurement.v_purchase_order_commitment_readiness
with (security_invoker = true)
as
select
  purchase_order.id as purchase_order_id,
  private.procurement_commitment_readiness(
    purchase_order.request_id,
    purchase_order.core_vendor_id,
    case when purchase_order.status in ('draft','pending_approval') then 'award' else 'issue' end
  ) as readiness
from procurement.purchase_orders purchase_order
where purchase_order.request_id is not null;

revoke all on procurement.v_purchase_order_commitment_readiness from public, anon, authenticated;
grant select on procurement.v_purchase_order_commitment_readiness to service_role;

alter table procurement.financial_protection_requirements
  drop constraint if exists financial_protection_status_check;
alter table procurement.financial_protection_requirements
  add constraint financial_protection_status_check check (
    status in ('required','provided','approved','waived','expired','claim_pending','claimed','superseded')
  );

create or replace function private.create_policy_evidence(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row procurement.policy_evidence;
begin
  if not core.has_cap('procurement','author_po') then raise exception 'Not authorized to create policy evidence'; end if;
  perform private.lock_procurement_request(payload->>'request_id');
  insert into procurement.policy_evidence(request_id,control_code,evidence_type,facts,expires_at,created_by)
  values(payload->>'request_id',payload->>'control_code',payload->>'evidence_type',coalesce(payload->'facts','{}'::jsonb),nullif(payload->>'expires_at','')::timestamptz,auth.uid())
  returning * into v_row; return to_jsonb(v_row);
end $$;
create or replace function procurement.create_policy_evidence(payload jsonb) returns jsonb
language sql security definer set search_path='' as $$ select private.create_policy_evidence(payload) $$;

create or replace function private.review_policy_evidence(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row procurement.policy_evidence; v_decision text:=payload->>'decision';
begin
  if not core.has_cap('procurement','approve_award') and not core.has_cap('procurement','admin') then raise exception 'Not authorized to review policy evidence'; end if;
  if v_decision not in ('approved','rejected') then raise exception 'Invalid evidence decision'; end if;
  select * into v_row from procurement.policy_evidence where id=(payload->>'id')::uuid;
  if v_row.id is null then raise exception 'Submitted policy evidence not found'; end if;
  perform private.lock_procurement_request(v_row.request_id);
  update procurement.policy_evidence set review_status=v_decision,reviewed_by=auth.uid(),reviewed_at=now()
  where id=(payload->>'id')::uuid and review_status='submitted' returning * into v_row;
  if v_row.id is null then raise exception 'Submitted policy evidence not found'; end if;
  return to_jsonb(v_row);
end $$;
create or replace function procurement.review_policy_evidence(payload jsonb) returns jsonb
language sql security definer set search_path='' as $$ select private.review_policy_evidence(payload) $$;

create or replace function private.supersede_policy_evidence(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row procurement.policy_evidence;
begin
  if not core.has_cap('procurement','author_po') and not core.has_cap('procurement','admin') then raise exception 'Not authorized to supersede policy evidence'; end if;
  select * into v_row from procurement.policy_evidence where id=(payload->>'id')::uuid;
  if v_row.id is null then raise exception 'Policy evidence not found'; end if;
  perform private.lock_procurement_request(v_row.request_id);
  update procurement.policy_evidence set review_status='superseded' where id=v_row.id returning * into v_row;
  if v_row.id is null then raise exception 'Policy evidence not found'; end if; return to_jsonb(v_row);
end $$;
create or replace function procurement.supersede_policy_evidence(payload jsonb) returns jsonb
language sql security definer set search_path='' as $$ select private.supersede_policy_evidence(payload) $$;

create or replace function private.create_financial_protection(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row procurement.financial_protection_requirements;
begin
  if not core.has_cap('procurement','author_po') then raise exception 'Not authorized to create financial protection'; end if;
  perform private.lock_procurement_request(payload->>'request_id');
  insert into procurement.financial_protection_requirements(request_id,protection_type,trigger_basis,required_amount,required_percentage,due_before,status,evidence_storage_path)
  values(payload->>'request_id',payload->>'protection_type',payload->>'trigger_basis',nullif(payload->>'required_amount','')::numeric,nullif(payload->>'required_percentage','')::numeric,coalesce(nullif(payload->>'due_before',''),'before_commitment'),'required',nullif(payload->>'evidence_storage_path',''))
  returning * into v_row; return to_jsonb(v_row);
end $$;
create or replace function procurement.create_financial_protection(payload jsonb) returns jsonb
language sql security definer set search_path='' as $$ select private.create_financial_protection(payload) $$;

create or replace function private.review_financial_protection(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row procurement.financial_protection_requirements; v_decision text:=payload->>'decision';
begin
  if not core.has_cap('procurement','approve_award') and not core.has_cap('procurement','view_finance') then raise exception 'Not authorized to review financial protection'; end if;
  if v_decision not in ('approved','waived') then raise exception 'Invalid protection decision'; end if;
  select * into v_row from procurement.financial_protection_requirements where id=(payload->>'id')::uuid;
  if v_row.id is null then raise exception 'Reviewable financial protection not found'; end if;
  perform private.lock_procurement_request(v_row.request_id);
  if v_decision='waived' and (
    nullif(btrim(payload->>'waiver_reason'),'') is null
    or nullif(btrim(payload->>'waiver_basis'),'') is null
    or nullif(btrim(payload->>'waiver_evidence_storage_path'),'') is null
  ) then raise exception 'A waiver requires reason, authorized basis, and supporting evidence'; end if;
  update procurement.financial_protection_requirements set
    status=v_decision,reviewed_by=auth.uid(),reviewed_at=now(),
    waiver_reason=case when v_decision='waived' then btrim(payload->>'waiver_reason') end,
    waiver_basis=case when v_decision='waived' then btrim(payload->>'waiver_basis') end,
    waiver_evidence_storage_path=case when v_decision='waived' then btrim(payload->>'waiver_evidence_storage_path') end
  where id=v_row.id and status in ('required','provided') returning * into v_row;
  if v_row.id is null then raise exception 'Reviewable financial protection not found'; end if; return to_jsonb(v_row);
end $$;
create or replace function procurement.review_financial_protection(payload jsonb) returns jsonb
language sql security definer set search_path='' as $$ select private.review_financial_protection(payload) $$;

create or replace function private.supersede_financial_protection(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row procurement.financial_protection_requirements;
begin
  if not core.has_cap('procurement','author_po') and not core.has_cap('procurement','admin') then raise exception 'Not authorized to supersede financial protection'; end if;
  select * into v_row from procurement.financial_protection_requirements where id=(payload->>'id')::uuid;
  if v_row.id is null then raise exception 'Financial protection not found'; end if;
  perform private.lock_procurement_request(v_row.request_id);
  update procurement.financial_protection_requirements set status='superseded' where id=v_row.id returning * into v_row;
  if v_row.id is null then raise exception 'Financial protection not found'; end if; return to_jsonb(v_row);
end $$;
create or replace function procurement.supersede_financial_protection(payload jsonb) returns jsonb
language sql security definer set search_path='' as $$ select private.supersede_financial_protection(payload) $$;

create or replace function private.assign_acceptance_reviewer(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row procurement.acceptance_reviewer_assignments;
begin
  if not core.has_cap('procurement','author_po') then raise exception 'Not authorized to assign technical reviewer'; end if;
  perform private.lock_procurement_request(payload->>'request_id');
  insert into procurement.acceptance_reviewer_assignments(request_id,reviewer_id,assigned_by)
  values(payload->>'request_id',(payload->>'reviewer_id')::uuid,auth.uid())
  on conflict(request_id,reviewer_id) do update set superseded_at=null,assigned_by=auth.uid(),assigned_at=now()
  returning * into v_row; return to_jsonb(v_row);
end $$;
create or replace function procurement.assign_acceptance_reviewer(payload jsonb) returns jsonb
language sql security definer set search_path='' as $$ select private.assign_acceptance_reviewer(payload) $$;

do $$ declare fn text; begin
  foreach fn in array array['create_policy_evidence','review_policy_evidence','supersede_policy_evidence','create_financial_protection','review_financial_protection','supersede_financial_protection','assign_acceptance_reviewer'] loop
    execute format('revoke all on function private.%I(jsonb) from public, anon, authenticated',fn);
    execute format('grant execute on function private.%I(jsonb) to service_role',fn);
    execute format('revoke all on function procurement.%I(jsonb) from public, anon',fn);
    execute format('grant execute on function procurement.%I(jsonb) to authenticated, service_role',fn);
  end loop;
end $$;

do $$
begin
  if to_regprocedure('private.policy_submit_procurement_request_legacy(jsonb)') is null then
    alter function private.policy_submit_procurement_request(jsonb)
      rename to policy_submit_procurement_request_legacy;
  end if;
  if to_regprocedure('private.policy_approve_purchase_order_legacy(jsonb)') is null then
    alter function private.policy_approve_purchase_order(jsonb)
      rename to policy_approve_purchase_order_legacy;
  end if;
  if to_regprocedure('private.policy_issue_purchase_order_legacy(jsonb)') is null then
    alter function private.policy_issue_purchase_order(jsonb)
      rename to policy_issue_purchase_order_legacy;
  end if;
end
$$;

create or replace function private.policy_submit_procurement_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request procurement.requests;
  v_route procurement.route_decisions;
  v_required_tiers text[];
  v_readiness jsonb;
  v_result jsonb;
begin
  select * into v_request from procurement.requests where id=payload->>'id' for update;
  if v_request.id is null then raise exception 'Request not found'; end if;
  select * into v_route
  from procurement.route_decisions
  where request_id=v_request.id and status='confirmed'
  order by request_version desc, confirmed_at desc
  limit 1;
  if v_route.id is null then
    raise exception 'policy_decision_required: Procurement-confirmed sourcing route';
  end if;
  v_required_tiers := procurement.derive_approval_tiers(
    v_request.category,
    coalesce(v_request.estimated_amount, 0),
    v_route.method
  );
  if coalesce(cardinality(v_required_tiers), 0) = 0 then
    raise exception 'policy_decision_required: determinate approval ladder';
  end if;
  v_readiness := private.procurement_commitment_readiness(v_request.id, v_request.core_vendor_id, 'submit');
  if not (v_readiness->>'ready')::boolean then
    raise exception 'commitment_blocked: %', v_readiness->'blockers';
  end if;
  v_result := private.policy_submit_procurement_request_legacy(payload);
  return v_result || jsonb_build_object('commitment_readiness', v_readiness);
end;
$$;

create or replace function private.policy_approve_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po procurement.purchase_orders;
  v_request procurement.requests;
  v_readiness jsonb;
  v_result jsonb;
begin
  select * into v_po from procurement.purchase_orders where id=payload->>'id' for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  select * into v_request from procurement.requests where id=v_po.request_id for update;
  v_readiness := private.procurement_commitment_readiness(v_po.request_id, v_po.core_vendor_id, 'award');
  if not (v_readiness->>'ready')::boolean then
    raise exception 'commitment_blocked: %', v_readiness->'blockers';
  end if;
  v_result := private.policy_approve_purchase_order_legacy(payload);
  return v_result || jsonb_build_object('commitment_readiness', v_readiness);
end;
$$;

create or replace function private.policy_issue_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po procurement.purchase_orders;
  v_request procurement.requests;
  v_readiness jsonb;
  v_result jsonb;
begin
  select * into v_po from procurement.purchase_orders where id=payload->>'id' for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  select * into v_request from procurement.requests where id=v_po.request_id for update;
  v_readiness := private.procurement_commitment_readiness(v_po.request_id, v_po.core_vendor_id, 'issue');
  if not (v_readiness->>'ready')::boolean then
    raise exception 'commitment_blocked: %', v_readiness->'blockers';
  end if;
  v_result := private.policy_issue_purchase_order_legacy(payload);
  return v_result || jsonb_build_object('commitment_readiness', v_readiness);
end;
$$;

create or replace function private.policy_assert_po_vendor_eligible(p_vendor_id uuid, p_request_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_readiness jsonb;
begin
  v_readiness := private.procurement_commitment_readiness(p_request_id, p_vendor_id, 'issue');
  if not (v_readiness->>'ready')::boolean then
    raise exception 'commitment_blocked: %', v_readiness->'blockers';
  end if;
end;
$$;

revoke all on function private.policy_submit_procurement_request_legacy(jsonb) from public, anon, authenticated;
revoke all on function private.policy_approve_purchase_order_legacy(jsonb) from public, anon, authenticated;
revoke all on function private.policy_issue_purchase_order_legacy(jsonb) from public, anon, authenticated;
revoke all on function private.policy_submit_procurement_request(jsonb) from public, anon;
revoke all on function private.policy_approve_purchase_order(jsonb) from public, anon;
revoke all on function private.policy_issue_purchase_order(jsonb) from public, anon;
grant execute on function private.policy_submit_procurement_request(jsonb) to authenticated, service_role;
grant execute on function private.policy_approve_purchase_order(jsonb) to authenticated, service_role;
grant execute on function private.policy_issue_purchase_order(jsonb) to authenticated, service_role;

-- Preserve the legacy receipt ledger as read-only history. Warehouse is the
-- sole authority for all new receipt writes; reconciliation is explicit.
alter table procurement.receipts
  add column if not exists authority_status text not null default 'legacy_archived',
  add column if not exists archived_at timestamptz,
  add column if not exists warehouse_receipt_id text,
  add column if not exists lines jsonb not null default '[]'::jsonb;
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='procurement' and table_name='receipts' and column_name='line_id'
  ) and exists (
    select 1 from information_schema.columns
     where table_schema='procurement' and table_name='receipts' and column_name='quantity'
  ) then
    execute $backfill$
      update procurement.receipts
         set lines=jsonb_build_array(jsonb_build_object(
           'poLineId', line_id::text,
           'quantity', quantity
         ))
       where lines='[]'::jsonb
    $backfill$;
  end if;
end
$$;
update procurement.receipts set archived_at=coalesce(archived_at, now()), authority_status='legacy_archived';
create table if not exists procurement.receipt_reconciliations (
  legacy_receipt_id text primary key,
  purchase_order_id text not null,
  warehouse_receipt_id text,
  legacy_line_total numeric not null default 0,
  reconciliation_status text not null default 'pending',
  reconciled_at timestamptz,
  reconciled_by uuid references core.profiles(id) on delete restrict,
  note text
);
insert into procurement.receipt_reconciliations(legacy_receipt_id,purchase_order_id,legacy_line_total)
select receipt.id::text, receipt.purchase_order_id::text,
  coalesce((select sum(coalesce((line->>'quantity')::numeric,0)) from jsonb_array_elements(receipt.lines) line),0)
from procurement.receipts receipt on conflict (legacy_receipt_id) do nothing;
alter table procurement.receipts enable row level security;
alter table procurement.receipts force row level security;
drop policy if exists read_procurement_receipts on procurement.receipts;
drop policy if exists procurement_receipts_read on procurement.receipts;
drop policy if exists procurement_legacy_receipts_read on procurement.receipts;
create policy procurement_legacy_receipts_read on procurement.receipts
  for select to authenticated
  using (
    core.has_cap('procurement','view_dashboard')
    or core.has_cap('procurement','author_po')
    or exists (
      select 1
      from procurement.purchase_orders purchase_order
      join procurement.requests request on request.id=purchase_order.request_id
      where purchase_order.id::text=procurement.receipts.purchase_order_id::text
        and request.requester_id=auth.uid()
    )
  );
revoke insert, update, delete on procurement.receipts from authenticated;
revoke all on procurement.receipt_reconciliations from public, anon, authenticated;
grant select on procurement.receipts to authenticated;
grant all on procurement.receipts, procurement.receipt_reconciliations to service_role;

create or replace function private.policy_record_acceptance_pack(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po procurement.purchase_orders;
  v_pack procurement.acceptance_packs;
  v_scope jsonb := payload->'accepted_scope';
  v_scope_line jsonb;
  v_acceptance_type text;
  v_requested numeric;
  v_accepted numeric;
  v_hash text;
begin
  select * into v_po from procurement.purchase_orders
   where id=payload->>'purchase_order_id' for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  if auth.uid() <> (select requester_id from procurement.requests where id=v_po.request_id)
     and not exists (
       select 1 from procurement.acceptance_reviewer_assignments assignment
        where assignment.request_id=v_po.request_id
          and assignment.reviewer_id=auth.uid()
          and assignment.superseded_at is null
     ) then
    raise exception 'Not authorized to record acceptance';
  end if;
  v_acceptance_type := case payload->>'acceptance_type'
    when 'goods' then 'goods_receipt'
    when 'service' then 'service_completion'
    when 'milestone' then 'technical_acceptance'
    else payload->>'acceptance_type'
  end;
  if v_acceptance_type = 'goods_receipt' then
    if nullif(payload->>'warehouse_receipt_reference','') is null or not exists (
      select 1 from warehouse.receipts receipt
       where receipt.id=payload->>'warehouse_receipt_reference'
         and receipt.procurement_po_id=v_po.id
    ) then raise exception 'A governed Warehouse receipt is required for goods acceptance'; end if;
    if jsonb_typeof(v_scope) <> 'object' or jsonb_typeof(v_scope->'lines') <> 'array'
       or jsonb_array_length(v_scope->'lines') = 0 then
      raise exception 'Goods acceptance requires PO-line quantities';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_scope->'lines') scope_line
      group by scope_line->>'poLineId'
      having count(*) > 1
    ) then
      raise exception 'Goods acceptance cannot contain duplicate PO-line ids';
    end if;
    for v_scope_line in select value from jsonb_array_elements(v_scope->'lines') loop
      begin v_requested := (v_scope_line->>'quantity')::numeric;
      exception when others then raise exception 'Accepted quantity must be positive'; end;
      if v_requested <= 0 then raise exception 'Accepted quantity must be positive'; end if;
      if not exists (
        select 1 from procurement.purchase_order_lines line
         where line.id=v_scope_line->>'poLineId' and line.purchase_order_id=v_po.id
           and line.receiving_status='open'
      ) then raise exception 'Accepted scope contains an invalid or closed PO line'; end if;
      select coalesce(grouped.accepted_quantity,0) into v_accepted
      from (
        select quality.procurement_po_line_id, sum(quality.quantity) as accepted_quantity
        from warehouse.quality_inspections quality
        join warehouse.receipts receipt on receipt.id=quality.source_id
        where quality.source_type='receipt'
          and receipt.procurement_po_id=v_po.id
          and quality.disposition='accepted'
        group by quality.procurement_po_line_id
      ) grouped
      where grouped.procurement_po_line_id=v_scope_line->>'poLineId';
      v_accepted := coalesce(v_accepted, 0);
      if v_requested > v_accepted then
        raise exception 'Accepted scope exceeds Warehouse QC-accepted quantity for PO line %', v_scope_line->>'poLineId';
      end if;
    end loop;
  elsif jsonb_typeof(v_scope) = 'string' then
    v_scope := jsonb_build_object('summary', payload->>'accepted_scope');
  end if;
  if v_scope is null or v_scope = '{}'::jsonb then raise exception 'Accepted scope is required'; end if;
  v_hash := encode(digest(convert_to(v_scope::text,'UTF8'),'sha256'),'hex');
  update procurement.acceptance_packs set status='superseded'
   where purchase_order_id=v_po.id and status in ('accepted','accepted_with_exceptions');
  insert into procurement.acceptance_packs(
    purchase_order_id,request_id,warehouse_receipt_reference,acceptance_type,
    accepted_scope,exceptions,accepted_by,document_hash,status
  ) values (
    v_po.id,v_po.request_id,payload->>'warehouse_receipt_reference',v_acceptance_type,
    v_scope,coalesce(payload->'exceptions','[]'::jsonb),auth.uid(),v_hash,
    case when jsonb_array_length(coalesce(payload->'exceptions','[]'::jsonb))>0
      then 'accepted_with_exceptions' else 'accepted' end
  ) returning * into v_pack;
  return to_jsonb(v_pack);
end;
$$;

create or replace function procurement.record_acceptance_pack(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.policy_record_acceptance_pack(payload) $$;
revoke all on function private.policy_record_acceptance_pack(jsonb) from public, anon, authenticated;
revoke all on function procurement.record_acceptance_pack(jsonb) from public, anon;
grant execute on function private.policy_record_acceptance_pack(jsonb) to service_role;
grant execute on function procurement.record_acceptance_pack(jsonb) to authenticated, service_role;

create or replace function procurement.acceptance_work_items(payload jsonb default '{}'::jsonb)
returns table(
  purchase_order_id text,
  po_number text,
  request_id text,
  status text,
  latest_warehouse_receipt_reference text,
  latest_qc_status text,
  lines jsonb
)
language sql stable security definer set search_path='' as $$
  select
    po.id::text,
    po.po_number,
    po.request_id,
    po.status,
    latest_receipt.id,
    latest_receipt.quality_status,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'poLineId', line.id::text,
        'description', line.description,
        'uom', coalesce(line.uom,'ea'),
        'orderedQuantity', line.quantity,
        'qcAcceptedQuantity', coalesce(quality.accepted_quantity,0),
        'rejectedOrQuarantinedQuantity', coalesce(quality.rejected_quantity,0)
      ) order by line.line_no)
      from procurement.purchase_order_lines line
      left join lateral (
        select
          sum(inspection.quantity) filter (where inspection.disposition='accepted') as accepted_quantity,
          sum(inspection.quantity) filter (where inspection.disposition in ('damaged','hold','vendor_return','unavailable')) as rejected_quantity
        from warehouse.quality_inspections inspection
        join warehouse.receipts receipt on receipt.id=inspection.source_id
        where inspection.source_type='receipt'
          and receipt.procurement_po_id=po.id
          and inspection.procurement_po_line_id=line.id::text
      ) quality on true
      where line.purchase_order_id=po.id and line.receiving_status='open'
    ),'[]'::jsonb)
  from procurement.purchase_orders po
  join procurement.requests request on request.id=po.request_id
  left join lateral (
    select receipt.id,receipt.quality_status
    from warehouse.receipts receipt
    where receipt.procurement_po_id=po.id
    order by receipt.created_at desc,receipt.id desc limit 1
  ) latest_receipt on true
  where (nullif(payload->>'purchase_order_id','') is null or po.id::text=payload->>'purchase_order_id')
    and (
      request.requester_id = auth.uid()
      or exists (
        select 1 from procurement.acceptance_reviewer_assignments assignment
        where assignment.request_id=po.request_id
          and assignment.reviewer_id=auth.uid()
          and assignment.superseded_at is null
      )
    )
  order by po.created_at desc;
$$;
revoke all on function procurement.acceptance_work_items(jsonb) from public, anon;
grant execute on function procurement.acceptance_work_items(jsonb) to authenticated, service_role;

do $$
begin
  if to_regprocedure('private.policy_prepare_payment_readiness_legacy(jsonb)') is null then
    alter function private.policy_prepare_payment_readiness(jsonb)
      rename to policy_prepare_payment_readiness_legacy;
  end if;
end
$$;

create or replace function private.policy_prepare_payment_readiness(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po procurement.purchase_orders;
  v_route procurement.route_decisions;
  v_result jsonb;
begin
  select * into v_po from procurement.purchase_orders
   where id=payload->>'purchase_order_id' for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  select * into v_route from procurement.route_decisions
   where request_id=v_po.request_id and status='confirmed'
   order by request_version desc limit 1;
  if v_route.method='petty_cash' and (
    nullif(payload->>'invoice_or_si_storage_path','') is null
    or not exists (
      select 1 from procurement.policy_evidence evidence
       where evidence.request_id=v_po.request_id
         and evidence.control_code='PETTY_CASH_LIQUIDATION'
         and evidence.review_status='approved'
    )
  ) then
    raise exception 'Petty-cash payment requires OR/SI and approved liquidation evidence';
  end if;
  v_result := private.policy_prepare_payment_readiness_legacy(payload);
  return v_result;
end;
$$;

revoke all on function private.policy_prepare_payment_readiness_legacy(jsonb) from public, anon, authenticated;
revoke all on function private.policy_prepare_payment_readiness(jsonb) from public, anon;
grant execute on function private.policy_prepare_payment_readiness(jsonb) to authenticated, service_role;

create or replace function private.enforce_technology_mnda_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_trigger_at timestamptz;
begin
  if new.template_version not like 'mnda-tech-service-provider-%' then return new; end if;
  if new.executed_at is not null then
    new.expires_at := least(
      new.executed_at + interval '2 years',
      coalesce(new.definitive_agreement_executed_at, 'infinity'::timestamptz)
    );
  end if;
  return new;
end;
$$;

create or replace function private.add_business_days(p_started_at timestamptz, p_days integer)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_policy_timezone constant text := 'Asia/Manila';
  v_local_time time := (p_started_at at time zone v_policy_timezone)::time;
  v_due_date date := (p_started_at at time zone v_policy_timezone)::date;
  v_remaining integer := p_days;
begin
  while v_remaining > 0 loop
    v_due_date := v_due_date + 1;
    if extract(isodow from v_due_date) < 6 then v_remaining := v_remaining - 1; end if;
  end loop;
  return (v_due_date + v_local_time) at time zone v_policy_timezone;
end;
$$;
revoke all on function private.add_business_days(timestamptz,integer) from public, anon, authenticated;
grant execute on function private.add_business_days(timestamptz,integer) to service_role;

create or replace function private.record_technology_mnda_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_trigger_at timestamptz;
begin
  if new.template_version not like 'mnda-tech-service-provider-%' then return new; end if;
  v_trigger_at := case
    when new.definitive_agreement_executed_at is distinct from old.definitive_agreement_executed_at
      then new.definitive_agreement_executed_at
    when new.status in ('expired','terminated') and new.status is distinct from old.status then now()
    else null
  end;
  if v_trigger_at is not null and not exists (
    select 1 from legal.instrument_lifecycle_events event
     where event.instrument_document_id=new.id and event.event_type='return_or_destroy_requested'
       and event.occurred_at=v_trigger_at
  ) then
    insert into legal.instrument_lifecycle_events(
      instrument_document_id,document_hash,event_type,occurred_at,due_at,retention_basis,actor_id
    ) values (
      new.id,new.document_hash,'return_or_destroy_requested',v_trigger_at,
      private.add_business_days(v_trigger_at, 5),'MNDA five-business-day return or destruction obligation',
      coalesce(auth.uid(), new.created_by)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists legal_technology_mnda_expiry on legal.instrument_documents;
create trigger legal_technology_mnda_expiry
before insert or update of executed_at, definitive_agreement_executed_at
on legal.instrument_documents for each row execute function private.enforce_technology_mnda_lifecycle();
drop trigger if exists legal_technology_mnda_lifecycle on legal.instrument_documents;
create trigger legal_technology_mnda_lifecycle
after update of status, definitive_agreement_executed_at
on legal.instrument_documents for each row execute function private.record_technology_mnda_lifecycle();
revoke all on function private.enforce_technology_mnda_lifecycle() from public, anon, authenticated;
revoke all on function private.record_technology_mnda_lifecycle() from public, anon, authenticated;
grant execute on function private.enforce_technology_mnda_lifecycle() to service_role;
grant execute on function private.record_technology_mnda_lifecycle() to service_role;

delete from core.role_capabilities
where module='warehouse' and role='finance' and cap='approve_stock_adjustment';

create or replace function warehouse.adjust_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int; v_actor text;
begin
  if not core.has_cap('warehouse','approve_stock_adjustment') then raise exception 'Not authorized: adjust_stock'; end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'movement' then payload := jsonb_set(payload, '{movement}', warehouse.force_actor_on_object(payload->'movement', v_actor)); end if;
  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected := coalesce(array_length(v_unit_ids, 1), 0);
    update warehouse.inventory_units set status='lost',assigned_to=null
     where id=any(v_unit_ids) and status='in_stock';
    get diagnostics v_updated = row_count;
    if v_updated < v_expected then raise exception 'Some units were no longer in stock (% of %)',v_updated,v_expected; end if;
  end if;
  if jsonb_typeof(payload->'stock_delta')='object' then
    insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity)
    values(payload->'stock_delta'->>'product_id',payload->'stock_delta'->>'location_id',payload->'stock_delta'->>'bin_id',null,greatest(0,(payload->'stock_delta'->>'delta')::int))
    on conflict(product_id,location_id,bin_id,lot_id) do update
      set quantity=greatest(0,warehouse.stock_levels.quantity+excluded.quantity);
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements,payload->'movement') returning * into v_mv;
  return to_jsonb(v_mv);
end $$;
revoke all on function warehouse.adjust_stock(jsonb) from public, anon;
grant execute on function warehouse.adjust_stock(jsonb) to authenticated, service_role;

create or replace function private.warehouse_list_stock_change_requests(payload jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_limit integer := least(greatest(coalesce((payload->>'limit')::integer,50),1),100);
  v_status text := nullif(payload->>'status','');
  v_rows jsonb;
begin
  if not (core.has_cap('warehouse','approve_stock_adjustment')
    or core.has_cap('warehouse','approve_stock_adjustment_finance')) then
    raise exception 'Not authorized: warehouse stock approvals';
  end if;
  select coalesce(jsonb_agg(to_jsonb(listed) order by listed.requested_at desc),'[]'::jsonb)
  into v_rows from (
    select request.*,
      request.requested_by <> auth.uid() and (
        (request.status='pending_supervisor' and core.has_cap('warehouse','approve_stock_adjustment'))
        or (request.status='pending_finance' and core.has_cap('warehouse','approve_stock_adjustment_finance'))
      ) as can_decide
    from warehouse.stock_change_requests request
    where (v_status is null or request.status=v_status)
    order by request.requested_at desc limit v_limit
  ) listed;
  return jsonb_build_object('rows',v_rows,'next_cursor',null);
end $$;
create or replace function warehouse.list_stock_change_requests(payload jsonb)
returns jsonb language sql security definer set search_path=''
as $$ select private.warehouse_list_stock_change_requests(payload) $$;
revoke all on function private.warehouse_list_stock_change_requests(jsonb) from public, anon, authenticated;
revoke all on function warehouse.list_stock_change_requests(jsonb) from public, anon;
grant execute on function private.warehouse_list_stock_change_requests(jsonb) to service_role;
grant execute on function warehouse.list_stock_change_requests(jsonb) to authenticated, service_role;

-- Final Task 2 capability convergence: the latest authoritative mutation body
-- agrees with the store contract while preserving its atomic custody controls.
+create or replace function private.warehouse_create_vendor_return(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_hold warehouse.inventory_holds;
  v_inspection warehouse.quality_inspections;
  v_vendor_return warehouse.vendor_returns;
  v_movement_id text := 'mv-' || replace(gen_random_uuid()::text, '-', '');
  v_reason text := nullif(pg_catalog.btrim(coalesce(payload->>'reason', '')), '');
  v_reference text := nullif(pg_catalog.btrim(coalesce(payload->>'reference', '')), '');
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_source_supplier_id text;
  v_total_source integer := 0;
  v_total_inspected integer := 0;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'create_vendor_return', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'manage_returns') then
    raise exception 'Not authorized: warehouse.manage_returns';
  end if;
  if v_reason is null or v_reference is null then
    raise exception 'Vendor return reason and reference are required';
  end if;
  if jsonb_typeof(v_evidence) <> 'array' then raise exception 'Evidence must be an array'; end if;

  select * into v_hold
    from warehouse.inventory_holds
   where id = (payload->>'hold_id')::uuid
     and status = 'active'
   for update;
  if not found then raise exception 'Active hold not found'; end if;
  if v_hold.created_by = auth.uid() then
    raise exception 'The hold creator cannot return their own hold to a vendor';
  end if;

  select * into v_inspection
    from warehouse.quality_inspections
   where id = v_hold.inspection_id
   for update;
  if v_inspection.disposition <> 'vendor_return' then
    raise exception 'The inspection is not marked for vendor return';
  end if;
  if v_inspection.source_type = 'receipt' then
    select supplier_id into v_source_supplier_id
      from warehouse.receipts
     where id = v_inspection.source_id;
    if v_source_supplier_id is distinct from payload->>'supplier_id' then
      raise exception 'Vendor return supplier must match the source receipt';
    end if;
  end if;
  if not exists (
    select 1 from warehouse.suppliers where id = payload->>'supplier_id'
  ) then
    raise exception 'Supplier not found';
  end if;

  if v_hold.serial_number is not null then
    update warehouse.inventory_units
       set status = 'vendor_return', assigned_to = null
     where product_id = v_hold.product_id
       and serial_number = v_hold.serial_number
       and location_id = v_hold.location_id
       and status in ('in_stock', 'returned');
    if not found then raise exception 'Held serialized unit is not available for vendor return'; end if;
  else
    update warehouse.stock_levels
       set quantity = quantity - v_hold.quantity
     where product_id = v_hold.product_id
       and location_id = v_hold.location_id
       and bin_id is not distinct from v_hold.bin_id
       and lot_id is not distinct from v_hold.lot_id
       and quantity >= v_hold.quantity;
    if not found then raise exception 'Held quantity is not available for vendor return'; end if;
  end if;

  insert into warehouse.vendor_returns(
    hold_id, supplier_id, source_receipt_id, source_return_id,
    product_id, lot_id, serial_number, quantity, reason, reference,
    status, evidence_urls, created_by
  ) values (
    v_hold.id, payload->>'supplier_id',
    case when v_inspection.source_type = 'receipt' then v_inspection.source_id end,
    case when v_inspection.source_type = 'return' then v_inspection.source_id end,
    v_hold.product_id, v_hold.lot_id, v_hold.serial_number, v_hold.quantity,
    v_reason, v_reference, 'ready', v_evidence, auth.uid()
  ) returning * into v_vendor_return;

  update warehouse.inventory_holds
     set status = 'vendor_return',
         released_by = auth.uid(),
         released_at = now(),
         release_reason = v_reason,
         release_evidence_urls = v_evidence
   where id = v_hold.id;

  insert into warehouse.movements(
    id, type, product_id, quantity, from_location_id, from_bin_id, lot_id,
    serial_number, reason, reference, evidence_urls, actor, created_at
  ) values (
    v_movement_id, 'vendor_return', v_hold.product_id, v_hold.quantity,
    v_hold.location_id, v_hold.bin_id, v_hold.lot_id, v_hold.serial_number, v_reason,
    v_vendor_return.id::text, v_evidence,
    coalesce(auth.jwt()->>'email', auth.uid()::text), now()
  );

  update warehouse.exceptions
     set status = 'resolved',
         resolution = 'Vendor return ' || v_reference || ' created',
         evidence_urls = v_evidence,
         updated_at = now()
   where source_type = 'quality_inspection'
     and source_id = v_hold.inspection_id::text
     and status in ('open', 'in_progress');

  if v_inspection.source_type = 'receipt' then
    select coalesce(sum((line->>'quantity')::integer), 0)
      into v_total_source
      from warehouse.receipts r
      cross join lateral jsonb_array_elements(r.lines) line
     where r.id = v_inspection.source_id;
    select coalesce(sum(quantity), 0)
      into v_total_inspected
      from warehouse.quality_inspections
     where source_type = 'receipt' and source_id = v_inspection.source_id
       and disposition <> 'pending';
    update warehouse.receipts
       set quality_status = case
         when exists (
           select 1 from warehouse.inventory_holds h
           join warehouse.quality_inspections i on i.id = h.inspection_id
           where i.source_type = 'receipt' and i.source_id = v_inspection.source_id
             and h.status = 'active'
         ) then 'hold'
         when v_total_inspected >= v_total_source then 'closed'
         else 'partial'
       end
     where id = v_inspection.source_id;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'vendor_return', v_vendor_return.id, 'created', auth.uid(),
    jsonb_build_object(
      'hold_id', v_hold.id,
      'supplier_id', v_vendor_return.supplier_id,
      'product_id', v_vendor_return.product_id,
      'quantity', v_vendor_return.quantity,
      'movement_id', v_movement_id
    )
  );

  v_response := to_jsonb(v_vendor_return);
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;
