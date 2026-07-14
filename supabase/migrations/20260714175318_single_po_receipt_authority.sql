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

  v_response := private.warehouse_receive_procurement_po_legacy(payload);
  v_receipt_id := v_response #>> '{receipt,id}';

  select exists (
    select 1
      from procurement.purchase_order_lines line
     where line.purchase_order_id = v_po.id
       and line.receiving_status = 'open'
       and line.received_quantity < line.quantity
  ) into v_short;

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
  update warehouse.command_log
     set response = v_response
   where actor_id = auth.uid()
     and command_name = 'receive_procurement_po'
     and idempotency_key = payload->>'idempotency_key';
  return v_response;
end;
$$;

revoke all on function private.warehouse_receive_procurement_po(jsonb)
  from public, anon;
grant execute on function private.warehouse_receive_procurement_po(jsonb)
  to authenticated, service_role;

create or replace function warehouse.receive_procurement_po(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_receive_procurement_po(payload) $$;

revoke all on function warehouse.receive_procurement_po(jsonb) from public, anon;
grant execute on function warehouse.receive_procurement_po(jsonb)
  to authenticated, service_role;

create or replace function private.procurement_po_receipt_status()
returns table (
  purchase_order_id uuid,
  ordered_quantity numeric,
  accepted_quantity numeric,
  rejected_or_quarantined_quantity numeric,
  outstanding_quantity numeric,
  latest_warehouse_receipt_reference text,
  qc_status text,
  last_received_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with receipt_lines as (
    select
      receipt.procurement_po_id::uuid as po_id,
      receipt.id as receipt_id,
      receipt.created_at,
      receipt.quality_status,
      line->>'productId' as product_id,
      coalesce((line->>'quantity')::numeric, 0) as quantity
    from warehouse.receipts receipt
    cross join lateral jsonb_array_elements(receipt.lines) line
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
        and quality.product_id = receipt_line.product_id
      order by quality.inspected_at desc, quality.id desc
      limit 1
    ) inspection on true
  ), totals as (
    select
      po_id,
      sum(quantity) filter (where disposition = 'accepted') as accepted_quantity,
      sum(quantity) filter (where disposition in ('damaged', 'hold', 'vendor_return', 'unavailable'))
        as rejected_quantity,
      max(created_at) as last_received_at
    from dispositions
    group by po_id
  )
  select
    po.id,
    coalesce(lines.ordered_quantity, 0),
    coalesce(totals.accepted_quantity, 0),
    coalesce(totals.rejected_quantity, 0),
    greatest(
      coalesce(lines.ordered_quantity, 0)
        - coalesce(totals.accepted_quantity, 0)
        - coalesce(totals.rejected_quantity, 0),
      0
    ),
    latest.receipt_id,
    case
      when coalesce(totals.rejected_quantity, 0) > 0 then 'exception'
      when coalesce(totals.accepted_quantity, 0) >= coalesce(lines.ordered_quantity, 0)
        and coalesce(lines.ordered_quantity, 0) > 0 then 'accepted'
      when coalesce(totals.accepted_quantity, 0) > 0 then 'partial'
      else 'not_received'
    end,
    totals.last_received_at
  from procurement.purchase_orders po
  left join lateral (
    select sum(line.quantity) as ordered_quantity
    from procurement.purchase_order_lines line
    where line.purchase_order_id = po.id
  ) lines on true
  left join totals on totals.po_id = po.id
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
